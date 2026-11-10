// SPDX-License-Identifier: GPL-3.0-or-later
// Runs denoise (profiled) on the GPU: shaders/eawdn.frag.glsl, in the order of darktable's
// process_wavelets (engine/denoiseprofile.ts): precondition, then per scale decompose → sum the
// squared detail → threshold and accumulate, then backtransform.
import eawdnShader from './shaders/eawdn.frag.glsl?raw';
import { SHADERS } from './shaders';
import { columnMajor } from './color';
import { VARF, type DenoiseSetup } from './denoiseprofile';
import type { Gpu, Program, Target } from './gpu';
import type { Mat3 } from '../film/stocks';

const BLOCK = 8;

/** How long the working images are kept after the last run, for the next slider step. */
const KEEP_MS = 4000;

export class ProfiledDenoiser {
  private p: Program;
  /** Working images not in use, by size: making fresh large float targets is slow on Metal. */
  private pool = new Map<string, Target[]>();
  /** The tiling limits (tilesFor); the probe makes them small to test the seams. */
  tiling = { oneTile: ONE_TILE_PIXELS, core: TILE_CORE };
  private dropTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private g: Gpu) {
    this.p = g.program(SHADERS.vertex, eawdnShader);
  }

  private take(w: number, h: number): Target {
    return this.pool.get(`${w}x${h}`)?.pop() ?? this.g.target(w, h, true, true);
  }

  private give(t: Target) {
    const key = `${t.w}x${t.h}`;
    this.pool.set(key, [...(this.pool.get(key) ?? []), t]);
    if (this.dropTimer) clearTimeout(this.dropTimer);
    this.dropTimer = setTimeout(() => this.dispose(), KEEP_MS);
  }

  /** Free the kept working images. */
  dispose() {
    if (this.dropTimer) clearTimeout(this.dropTimer);
    this.dropTimer = null;
    for (const ts of this.pool.values()) ts.forEach((t) => this.g.free(t));
    this.pool.clear();
  }

  /**
   * Denoise `input` (working Rec.2020, w × h) into a new half-float target the caller owns
   * (32-bit with `precise`). With `encode` the domain is the sRGB encoding of a linear input, as
   * darktable sees a JPEG before its input profile. Needs 32-bit float targets (Gpu.float32). Its
   * working images are kept for a few seconds for the next run.
   */
  run(input: WebGLTexture, w: number, h: number, s: DenoiseSetup, toDt: Mat3, fromDt: Mat3, precise = false, encode = false): Target {
    const steps = this.steps(input, w, h, s, toDt, fromDt, precise, encode);
    for (;;) { const r = steps.next(); if (r.done) return r.value; }
  }

  /** `input` (w × h) reduced by n (2 or 4): the mean of each n × n block, into a 32-bit target. */
  reduce(input: WebGLTexture, w: number, h: number, n: number): Target {
    const tw = Math.ceil(w / n), th = Math.ceil(h / n);
    const t = this.g.target(tw, th, true, true);
    this.pass(t, { uMode: 7, uMult: n }, input);
    return t;
  }

  /** `small` scaled up to w × h (bilinear), into a half-float target. */
  enlarge(small: WebGLTexture, w: number, h: number): Target {
    const t = this.g.target(w, h, true);
    this.pass(t, { uMode: 8 }, small);
    return t;
  }

  private pass(t: Target, mode: Record<string, number>, input: WebGLTexture) {
    const g = this.g, clip = g.clip;
    g.clip = null;
    g.bind(0, input);
    for (const u of [1, 2, 3]) g.bind(u, g.blackTexture);
    this.p.set({ uIn: 0, uCoarse: 1, uAcc: 2, uSum: 3, ...mode });
    try { g.draw(this.p, t, t.w, t.h); } finally { g.clip = clip; }
  }

  /**
   * `run` one pass at a time: it yields after each draw, so idle preparation can spread it out.
   * An image larger than one tile is done in tiles, as darktable tiles the module: each tile is
   * grown by the filter's reach (tiling_callback's overlap, 1 << scales) and takes its thresholds
   * from its own statistics, and only its core is written.
   */
  *steps(input: WebGLTexture, w: number, h: number, s: DenoiseSetup, toDt: Mat3, fromDt: Mat3, precise = false, encode = false): Generator<void, Target> {
    const out = this.g.target(w, h, true, precise);
    let done = false;
    try {
      for (const t of tilesFor(w, h, 1 << s.scales, this.tiling.oneTile, this.tiling.core)) yield* this.tileSteps(input, out, w, h, t, s, toDt, fromDt, encode);
      done = true;
      return out;
    } finally {
      if (!done) this.g.free(out);
    }
  }

  private *tileSteps(input: WebGLTexture, out: Target, W: number, H: number, t: Tile, s: DenoiseSetup, toDt: Mat3, fromDt: Mat3, encode: boolean): Generator<void> {
    const g = this.g, p = this.p;
    const w = t.pw, h = t.ph;
    // Other passes run between yields: each draw sets up its own state and leaves theirs as it was.
    // (Another run of this program may also have set its uniforms in between.)
    const common = {
      uIn: 0, uCoarse: 1, uAcc: 2, uSum: 3, uOffset: [t.px, t.py],
      uToDt: columnMajor(toDt), uFromDt: columnMajor(fromDt), uToY: columnMajor(s.toY), uToRgb: columnMajor(s.toRgb),
      uP: s.p, uA: s.a, uB: s.b, uBiasWb: s.biasWb, uAdjt: s.adjt, uPixels: w * h, uEncode: encode ? 1 : 0,
    };
    const black = g.blackTexture;
    // Each draw binds all four units: a texture left on one by other work must never be read
    // from while it is drawn into. The output is drawn only within the tile's core.
    const draw = (target: Target, tw: number, th: number, mode: Record<string, number>, units: WebGLTexture[], core = false) => {
      const clip = g.clip;
      g.clip = core ? { x: t.cx, y: t.cy, w: t.cw, h: t.ch, tw, th } : null;
      for (let u = 0; u < 4; u++) g.bind(u, units[u] ?? black);
      p.set({ ...common, ...mode });
      try { g.draw(p, target, tw, th); } finally { g.clip = clip; }
    };
    const temps: Target[] = [];
    const make = (tw: number, th: number) => { const x = this.take(tw, th); temps.push(x); return x; };
    try {
      // Upstream passes small images through when its coarsest band would not fit.
      const maxMult = s.scales > 0 ? 1 << (s.scales - 1) : 0;
      if (w < 2 * maxMult || h < 2 * maxMult) {
        draw(out, W, H, { uMode: 6 }, [input], true); // upstream's memcpy
        return;
      }
      let cur = make(w, h);
      draw(cur, w, h, { uMode: 0 }, [input]);
      yield;
      let next = make(w, h);
      let acc = make(w, h), accNext = make(w, h);
      for (let scale = 0; scale < s.scales; scale++) {
        const sigma = Math.pow(VARF, scale);
        draw(next, w, h, { uMode: 1, uMult: 1 << scale, uInvSigma2: 1 / (sigma * sigma) }, [cur.tex]);
        yield;
        // The sum of the squared detail, down to one texel.
        let sw = Math.ceil(w / BLOCK), sh = Math.ceil(h / BLOCK);
        let sum = make(sw, sh);
        draw(sum, sw, sh, { uMode: 2 }, [cur.tex, next.tex]);
        while (sw > 1 || sh > 1) {
          const tw = Math.ceil(sw / BLOCK), th = Math.ceil(sh / BLOCK);
          const x = make(tw, th);
          draw(x, tw, th, { uMode: 3 }, [sum.tex]);
          sum = x; sw = tw; sh = th;
        }
        draw(accNext, w, h, { uMode: 4, uSb2: sigma * sigma, uFirst: scale === 0 ? 1 : 0 }, [cur.tex, next.tex, acc.tex, sum.tex]);
        yield;
        [acc, accNext] = [accNext, acc];
        [cur, next] = [next, cur];
      }
      draw(out, W, H, { uMode: 5, uFirst: s.scales === 0 ? 1 : 0 }, [black, cur.tex, acc.tex], true);
      yield;
    } finally {
      temps.forEach((x) => this.give(x));
    }
  }
}

/** A tile: its core (written) and the core grown by the reach (processed), in image pixels. */
export interface Tile { cx: number; cy: number; cw: number; ch: number; px: number; py: number; pw: number; ph: number }

/** Images up to this many pixels are one tile (a 2560 px preview is); larger ones, cores of TILE_CORE. */
export const ONE_TILE_PIXELS = 4.5e6;
export const TILE_CORE = 2048;

export function tilesFor(w: number, h: number, reach: number, oneTile = ONE_TILE_PIXELS, core = TILE_CORE): Tile[] {
  if (w * h <= oneTile) return [{ cx: 0, cy: 0, cw: w, ch: h, px: 0, py: 0, pw: w, ph: h }];
  const out: Tile[] = [];
  for (let cy = 0; cy < h; cy += core) for (let cx = 0; cx < w; cx += core) {
    const cw = Math.min(core, w - cx), ch = Math.min(core, h - cy);
    const px = Math.max(0, cx - reach), py = Math.max(0, cy - reach);
    out.push({ cx, cy, cw, ch, px, py, pw: Math.min(w, cx + cw + reach) - px, ph: Math.min(h, cy + ch + reach) - py });
  }
  return out;
}
