import { ProfileGpu } from './profilegpu';
import { prepareProfile, profilePending } from './profilestore';
// SPDX-License-Identifier: GPL-3.0-or-later
// The develop engine: uploads sources and runs the pass graph.
//
//   source ─┬─ extract (1/4) ─ blur ─┬─────────────── halation ─┐
//           │                        └─ down (1/8) ─ blur ─ glow ┤
//           ├─ down (1/2) ─ blur ────────────────── sharpen ─────┤
//           └────────────────────────────────────────────── develop ─ output

import type { Recipe } from '../film/recipe';
import { lensCenter, lensColourUniforms, lensSpline, lensUniforms, type LensMetadata } from './lenscorrection';
import { FULL, cropAffine, type Rect } from '../film/crop';
import { Gpu, GpuError, Lru, type Program, type Target } from './gpu';
import { InputMode, LUT_UNIT, colorBalanceUniforms, developUniforms, needsPasses, type Uniforms } from './params';
import { textureData } from './lut3d';
import { type LoadedLut, loadLut, lutFor, lutPending } from './lutstore';
import { recipeLookFile } from '../film/looks';
import { GLOW_SIGMA, HALATION_SIGMA, blurPlan, pyramidFor, type Pyramid } from './pyramid';
import { MASK_SIGMA } from './toneequalizer';
import { GAMMAS, levelSize, numLevels } from './locallaplacian';
import { scales } from './equalizer';
import { usmKernel, usmParams, type UsmParams } from './usm';
import { DEFAULTS as CE, SAT_SHIFT, WHITE, colorEqLuts, pixelUvl, type ColorEqLuts, type ColorEqParams } from './colorequal';
import { BRIGHT_RANGE, HUE_DEGREES, HUE_MAX, SAT_RANGE, type ColorAdjust } from '../film/recipe';
import { autoContrast, borderFor, gaussian1d, iterationsFor, kernelFor, TILE } from './capture';
import { columnMajor } from './color';
import type { Mat3 } from '../film/stocks';
import { CURVE_RES } from '../film/curve';
import { composedCurveTable } from '../film/creative';
import { profileSettingsFor } from '../film/looks';
import type { Xy } from './whitebalance';
import { SHADERS, SHADER_FILES } from './shaders';

export { GpuError, InputMode };

/** Pixels decoded by the backend: RGBA half floats. */
export interface HalfImage {
  camera?: import('../film/profiles').CameraMetadata | null;
  lens?: LensMetadata | null;
  width: number;
  height: number;
  mode: InputMode;
  /** As-shot white point of a RAW, CIE xy. */
  white: Xy | null;
  /** Size of the full-resolution image this was decoded from. */
  fullWidth: number;
  fullHeight: number;
  data: Uint16Array;
}

/** The part of the image a render shows, in image texture coordinates (y = 0 at the top). */
export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_VIEW: View = { x: 0, y: 0, w: 1, h: 1 };

export interface Source {
  camera?: import('../film/profiles').CameraMetadata | null;
  lens?: LensMetadata | null;
  tex: WebGLTexture;
  w: number;
  h: number;
  mode: InputMode;
  /** As-shot white point; null for D65 (anything that is not a RAW, or not known yet). */
  white: Xy | null;
  /** Size of the full-resolution image; the texture may be smaller. */
  fullW: number;
  fullH: number;
  /** A RAW's capture sharpening data, once attached (see attachCapture). */
  capture?: Capture;
}

/** What capture sharpening reads from a RAW's sensor data (src-tauri/src/capture.rs). */
export interface Capture {
  /** RawTherapee's auto radius, in sensor pixels. */
  radius: number;
  /** Working Rec.2020 to 16-bit camera RGB, row major. */
  toCam: number[];
  /** The clip mask at the texture's size: 0 near clipped sensor pixels. */
  clip: WebGLTexture;
  /** RawTherapee's auto contrast threshold, once measured. */
  threshold?: number;
}

interface Chain {
  /** Highlight pyramid; levels[0] is quarter resolution. */
  levels: Target[];
  halTmp: Target;
  glowTmp: Target;
  pyramid: Pyramid;
  /** Half-resolution blur for scanner sharpness. */
  hA: Target;
  hB: Target;
  /** Tone equalizer brightness map, quarter resolution down to the halation level; made on first use. */
  teq?: Target[];
  teqTmp?: Target;
}

/** The clarity filter's pyramids, from full size down: remapped images (A: levels 0-3, B: 4-5 and the lightness), and the output. */
interface Ll {
  A: Target[];
  B: Target[];
  O: Target[];
}

/** The uniforms a stage file declares, read from its source. */
const uniformsOf = (file: string) => [...SHADER_FILES[file].matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1]);

/**
 * The uniforms of the stages before each whole-photo map's input, in pipeline
 * order (see develop.frag), so a map is remade only when something upstream of
 * it changes. optics.glsl holds both the scanner's sharpness (first) and
 * halation and glow (later), so it is split by hand.
 */
const BEFORE_TEXTURE = ['stages/input.glsl', 'stages/exposure.glsl', 'stages/toneequalizer.glsl'].flatMap(uniformsOf).concat('uSharp', 'uStore');
const TEXTURE_STAGE = uniformsOf('stages/texture.glsl').concat('uTextureMix');
const COLOR_STAGE = uniformsOf('stages/colorequal.glsl');
const BEFORE_CLARITY = ['stages/colorbalance.glsl', 'stages/lens.glsl', 'stages/tone.glsl', 'stages/lut.glsl', 'stages/dcp.glsl'].flatMap(uniformsOf).concat('uHal', 'uHalCol', 'uGlow', 'uLutId');
const CLARITY_STAGE = uniformsOf('stages/clarity.glsl').concat('uLl');
const pick = (u: Uniforms, names: string[]) => JSON.stringify(names.map((n) => u[n] ?? null));

export class Engine {
  readonly gpu: Gpu;
  private develop: Program;
  private dcpPass: Program;
  private profiles: ProfileGpu;
  private extract: Program;
  private teqMask: Program;
  private sampleP: Program;
  /** The point curve's lookup table, re-uploaded only when the curve changes. */
  private curveTex: WebGLTexture | null = null;
  private curveKey = '';
  /** Look LUTs on the GPU, by LUT id; a few are kept so the stock tiles do not re-upload. */
  private lutTex: Lru<WebGLTexture>;
  private blurP: Program;
  private down: Program;
  private chains: Lru<Chain>;
  private lls: Lru<Ll>;
  private llCurve: Program;
  private llReduce: Program;
  private llCollapse: Program;
  /** What the clarity map in `lls` was last made from, so panning and zooming reuse it. */
  private llMade: { tex: WebGLTexture; key: string } | null = null;
  private eqP: Program;
  private csP: Program;
  /** The capture-sharpened source for the latest size, and what it was made from. */
  private csOut: Target | null = null;
  private csMade: { tex: WebGLTexture; iterations: number } | null = null;
  /** The texture map's ping-pong targets for the latest source size, and what it was made from. */
  private eq: { w: number; h: number; a: Target; b: Target } | null = null;
  private eqMade: { tex: WebGLTexture; key: string; out: Target } | null = null;
  private usmP: Program;
  /** Sharpening's ping-pong targets for the latest source size, and what its map was made from. */
  private usm: { w: number; h: number; a: Target; b: Target } | null = null;
  private usmMade: { tex: WebGLTexture; key: string; out: Target } | null = null;
  private ceP: Program;
  /** The colour equalizer's five 32-bit targets for the latest source size, and what its map was made from. */
  private ce: { w: number; h: number; t: Target[]; pair: Target } | null = null;
  private ceMade: { tex: WebGLTexture; key: string; out: Target } | null = null;
  private ceLuts: { key: string; luts: ColorEqLuts } | null = null;
  private outs: Lru<Target>;
  private store: number;
  private lensP: Program;
  private lensMade: { input: WebGLTexture; key: string; out: Target } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.gpu = new Gpu(canvas);
    this.profiles = new ProfileGpu(this.gpu);
    this.dcpPass = this.gpu.program(SHADERS.vertex, SHADERS.dcp);
    this.lensP = this.gpu.program(SHADERS.vertex, SHADERS.lenscorrect);
    this.develop = this.gpu.program(SHADERS.vertex, SHADERS.develop);
    this.extract = this.gpu.program(SHADERS.vertex, SHADERS.extract);
    this.teqMask = this.gpu.program(SHADERS.vertex, SHADERS.toneeqmask);
    this.sampleP = this.gpu.program(SHADERS.vertex, SHADERS.sample);
    this.blurP = this.gpu.program(SHADERS.vertex, SHADERS.blur);
    this.down = this.gpu.program(SHADERS.vertex, SHADERS.down);
    this.store = this.gpu.hdr ? 1 : 0.25;
    this.lutTex = new Lru<WebGLTexture>(10, (t) => this.gpu.gl.deleteTexture(t));
    this.chains = new Lru<Chain>(6, (c) => [...c.levels, c.halTmp, c.glowTmp, c.hA, c.hB, ...(c.teq ?? []), ...(c.teqTmp ? [c.teqTmp] : [])].forEach((t) => this.gpu.free(t)));
    this.outs = new Lru<Target>(12, (t) => this.gpu.free(t));
    this.llCurve = this.gpu.program(SHADERS.vertex, SHADERS.llcurve);
    this.llReduce = this.gpu.program(SHADERS.vertex, SHADERS.llreduce);
    this.llCollapse = this.gpu.program(SHADERS.vertex, SHADERS.llcollapse);
    this.eqP = this.gpu.program(SHADERS.vertex, SHADERS.eq);
    this.csP = this.gpu.program(SHADERS.vertex, SHADERS.cs);
    this.usmP = this.gpu.program(SHADERS.vertex, SHADERS.usm);
    this.ceP = this.gpu.program(SHADERS.vertex, SHADERS.ce);
    // Full-size pyramids are large: keep only the latest two sizes (preview and full resolution).
    this.lls = new Lru<Ll>(2, (l) => [...l.A, ...l.B, ...l.O].forEach((t) => this.gpu.free(t)));
  }

  get maxTextureSize() { return this.gpu.maxTextureSize; }

  /** A fence after the last screen render, to tell when the GPU has finished it. */
  private fence: WebGLSync | null = null;

  /**
   * Whether the GPU has finished the last screen render. Rendering again before
   * then only queues more work, so a slider drag falls further and further behind.
   */
  idle(): boolean {
    if (!this.fence) return true;
    const gl = this.gpu.gl;
    if (gl.getSyncParameter(this.fence, gl.SYNC_STATUS) !== gl.SIGNALED) return false;
    gl.deleteSync(this.fence);
    this.fence = null;
    return true;
  }

  /** Upload decoded half-float pixels. */
  sourceFromHalf(img: HalfImage): Source {
    const gl = this.gpu.gl;
    const tex = gl.createTexture()!;
    this.gpu.scratch();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, img.width, img.height, 0, gl.RGBA, gl.HALF_FLOAT, img.data);
    const mips = this.gpu.hdr;
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    this.gpu.params(mips);
    return { tex, w: img.width, h: img.height, mode: img.mode, white: img.white, lens: img.lens, camera: img.camera, fullW: img.fullWidth, fullH: img.fullHeight };
  }

  /** Upload an sRGB image (a thumbnail), shot for `white` (a RAW's camera preview) or D65. */
  sourceFromImage(img: TexImageSource, w: number, h: number, white: Xy | null = null): Source {
    const gl = this.gpu.gl;
    const tex = gl.createTexture()!;
    this.gpu.scratch();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.gpu.params(true);
    return { tex, w, h, mode: InputMode.DisplayEncoded, white, fullW: w, fullH: h };
  }

  release(src: Source | null | undefined) {
    if (!src) return;
    this.gpu.gl.deleteTexture(src.tex);
    if (this.lensMade?.input === src.tex) { this.gpu.free(this.lensMade.out); this.lensMade = null; }
    if (src.capture) this.gpu.gl.deleteTexture(src.capture.clip);
  }

  /** Give a RAW source its capture sharpening data: the radius, the camera matrix and the clip mask at the source's size. */
  attachCapture(src: Source, radius: number, toCam: number[], mask: Uint8Array) {
    const gl = this.gpu.gl;
    const clip = gl.createTexture()!;
    this.gpu.scratch();
    gl.bindTexture(gl.TEXTURE_2D, clip);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, src.w, src.h, 0, gl.RED, gl.UNSIGNED_BYTE, Uint8Array.from(mask, (v) => (v ? 255 : 0)));
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.gpu.params(false);
    if (src.capture) gl.deleteTexture(src.capture.clip);
    src.capture = { radius, toCam, clip };
  }

  /**
   * RawTherapee's capture sharpening of a RAW source: a texture of the source
   * with its luminance deconvolved, kept until the source or iterations change.
   */
  private captureSharpened(src: Source, iterations: number): WebGLTexture {
    const g = this.gpu;
    const gl = g.gl;
    const cap = src.capture!;
    if (this.csOut && this.csMade?.tex === src.tex && this.csMade.iterations === iterations && this.csOut.w === src.w && this.csOut.h === src.h) return this.csOut.tex;
    const { w, h } = src;
    // The radius is in sensor pixels; a smaller texture (a preview) sees it smaller.
    const sigma = cap.radius * (w / src.fullW);
    const kernel = kernelFor(sigma);
    const border = borderFor(sigma, iterations);
    const tiles = [Math.max(1, Math.ceil((w - 2 * border) / TILE)), Math.max(1, Math.ceil((h - 2 * border) / TILE))];
    const one = () => g.target(w, h, true, true, true);
    if (this.csOut && (this.csOut.w !== w || this.csOut.h !== h)) {
      g.free(this.csOut);
      this.csOut = null;
    }
    const out = (this.csOut ??= g.target(w, h, true));
    const [Y, L, blend, estA, estB] = [one(), one(), one(), one(), one()];
    const flags = [g.target(tiles[0], tiles[1], true), g.target(tiles[0], tiles[1], true)];
    const rows = g.target(tiles[0], h, true, false, true);
    const base = {
      uS: 0, uY: 1, uL: 2, uClip: 3, uEst: 4, uR: 5, uBl: 6, uF: 8,
      uToCam: columnMajor([cap.toCam.slice(0, 3), cap.toCam.slice(3, 6), cap.toCam.slice(6, 9)] as Mat3), uK: kernel.weights.flat(), uKHalf: kernel.half, uBorder: border, uTiles: tiles,
    };
    const step = (mode: number, to: Target, tex: Partial<Record<'S' | 'Y' | 'L' | 'Clip' | 'Est' | 'R' | 'Bl' | 'F', WebGLTexture>>, extra = {}) => {
      // Every unit the program reads gets bound, the unused ones to black: a target
      // still bound from an earlier step would be a feedback loop.
      const units = { S: 0, Y: 1, L: 2, Clip: 3, Est: 4, R: 5, Bl: 6, F: 8 } as const;
      // The source is always bound: the shader takes the working images' size from it.
      const all = { S: src.tex, ...tex };
      for (const [k, unit] of Object.entries(units)) g.bind(unit, all[k as keyof typeof units] ?? g.blackTexture);
      this.csP.set({ ...base, ...extra, uMode: mode });
      g.draw(this.csP, to, to.w, to.h);
    };
    step(0, Y, { S: src.tex });
    step(1, L, { S: src.tex });
    if (cap.threshold === undefined) cap.threshold = this.measureContrast(L);
    // The blend mask, then its 2 px blur: across into estA, down into blend.
    const gk = gaussian1d(2);
    step(2, blend, { L: L.tex, Clip: cap.clip }, { uThreshold: cap.threshold });
    step(3, estA, { R: blend.tex }, { uG: gk, uGHalf: (gk.length - 1) / 2, uDir: [1, 0] });
    step(3, blend, { R: estA.tex }, { uG: gk, uGHalf: (gk.length - 1) / 2, uDir: [0, 1] });
    step(4, flags[0], { Bl: blend.tex });
    // Richardson-Lucy: the estimate starts as Y; L's target holds the ratio.
    let est = Y;
    let next = estA;
    let f = 0;
    for (let n = 0; n < iterations; n++) {
      step(5, L, { Y: Y.tex, Est: est.tex });
      step(6, next, { Est: est.tex, R: L.tex, F: flags[f].tex });
      if (n < iterations - 1) {
        // The early stop, in two steps so no pixel scans a whole tile: rows, then tiles.
        step(7, rows, { Y: Y.tex, Est: next.tex, Bl: blend.tex });
        step(10, flags[1 - f], { R: rows.tex, F: flags[f].tex });
        f = 1 - f;
      }
      est = next;
      next = next === estA ? estB : estA;
    }
    step(8, out, { S: src.tex, Y: Y.tex, Est: est.tex, Bl: blend.tex });
    for (const t of [Y, L, blend, estA, estB, rows, ...flags]) g.free(t);
    // Mipmaps, as the source has them, for views smaller than the texture.
    g.scratch();
    gl.bindTexture(gl.TEXTURE_2D, out.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    g.params(true);
    this.csMade = { tex: src.tex, iterations };
    return out.tex;
  }

  /** RawTherapee's auto contrast threshold from the lightness image, read back four values per texel. */
  private measureContrast(L: Target): number {
    const g = this.gpu;
    const gl = g.gl;
    const pw = Math.ceil(L.w / 4);
    const packed = g.target(pw, L.h, true, true);
    for (const unit of [0, 1, 3, 4, 5, 6, 8]) g.bind(unit, g.blackTexture);
    g.bind(2, L.tex);
    this.csP.set({ uMode: 9, uS: 0, uY: 1, uL: 2, uClip: 3, uEst: 4, uR: 5, uBl: 6, uF: 8 });
    g.draw(this.csP, packed, pw, L.h);
    const px = new Float32Array(pw * L.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, packed.fbo);
    gl.readPixels(0, 0, pw, L.h, gl.RGBA, gl.FLOAT, px);
    g.free(packed);
    const data = new Float64Array(L.w * L.h);
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) data[y * L.w + x] = px[y * pw * 4 + x];
    return autoContrast({ w: L.w, h: L.h, data });
  }

  /** Free the intermediate buffers for one source size (after a large export). */
  dropBuffers(w: number, h: number) {
    if (this.lensMade?.out.w === w && this.lensMade.out.h === h) { this.gpu.free(this.lensMade.out); this.lensMade = null; }
    if (this.csOut && this.csOut.w === w && this.csOut.h === h) {
      this.gpu.free(this.csOut);
      this.csOut = null;
      this.csMade = null;
    }
    this.chains.delete(`${w}x${h}`);
    this.outs.delete(`${w}x${h}`);
    this.lls.delete(`${w}x${h}`);
    if (this.eq && this.eq.w === w && this.eq.h === h) {
      this.gpu.free(this.eq.a);
      this.gpu.free(this.eq.b);
      this.eq = null;
      this.eqMade = null;
    }
  }

  private chain(w: number, h: number): Chain {
    return this.chains.get(`${w}x${h}`, () => {
      const hdr = this.gpu.hdr;
      const pyramid = pyramidFor(w, h);
      const levels = pyramid.sizes.map(([lw, lh]) => this.gpu.target(lw, lh, hdr));
      const like = (t: Target) => this.gpu.target(t.w, t.h, hdr);
      const half: [number, number] = [Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2))];
      return {
        levels,
        pyramid,
        halTmp: like(levels[pyramid.halation]),
        glowTmp: like(levels[pyramid.glow]),
        hA: this.gpu.target(half[0], half[1], hdr),
        hB: this.gpu.target(half[0], half[1], hdr),
      };
    });
  }

  private downsample(from: Target, to: Target) {
    this.gpu.bind(0, from.tex);
    this.down.set({ uTex: 0, uTexel: [0.5 / from.w, 0.5 / from.h] });
    this.gpu.draw(this.down, to, to.w, to.h);
  }

  /**
   * The tone equalizer's blurred brightness map: brightness and its square at
   * quarter resolution, halved to the halation level (at most 256 wide) and
   * blurred there, so it is the same relative size in preview and export.
   * 32-bit floats where possible, as the variance is a small difference of two
   * large numbers.
   */
  private toneEqualizerMap(src: Source, u: Uniforms): WebGLTexture {
    const g = this.gpu;
    const ch = this.chain(src.w, src.h);
    const top = ch.pyramid.halation;
    if (!ch.teq || !ch.teqTmp) {
      ch.teq = ch.pyramid.sizes.slice(0, top + 1).map(([w, h]) => g.target(w, h, true, g.float32));
      ch.teqTmp = g.target(ch.teq[top].w, ch.teq[top].h, true, g.float32);
    }
    g.bind(0, src.tex);
    this.teqMask.set({ ...u, uSrc: 0, uTexel: [1 / src.w, 1 / src.h] });
    g.draw(this.teqMask, ch.teq[0], ch.teq[0].w, ch.teq[0].h);
    for (let i = 1; i <= top; i++) this.downsample(ch.teq[i - 1], ch.teq[i]);
    const level = ch.teq[top];
    const plan = blurPlan(level.w, (MASK_SIGMA * Math.max(level.w, level.h)) / level.w);
    this.blur(level, ch.teqTmp, plan.spread, plan.iterations);
    return level.tex;
  }

  /** The clarity filter's pyramids for a w × h source, made on first use. */
  private llPyramids(w: number, h: number): Ll {
    return this.lls.get(`${w}x${h}`, () => {
      this.llMade = null;
      const levels = Array.from({ length: numLevels(w, h) }, (_, l) => [levelSize(w, l), levelSize(h, l)]);
      const make = () => levels.map(([lw, lh]) => this.gpu.target(lw, lh, true));
      return { A: make(), B: make(), O: make() };
    });
  }

  /**
   * darktable's local laplacian filter over the whole photo, on the print's
   * lightness: returns a texture of the change in lightness for each source
   * pixel. `drawInput` renders the lightness into a target.
   */
  private clarityMap(ll: Ll, uLl: number[], drawInput: (t: Target) => void): WebGLTexture {
    const g = this.gpu;
    const last = ll.A.length - 1;
    drawInput(ll.O[0]);
    g.bind(0, ll.O[0].tex);
    this.llCurve.set({ uL: 0, uGamma: GAMMAS.slice(0, 4), uCarry: 0, uLl });
    g.draw(this.llCurve, ll.A[0], ll.A[0].w, ll.A[0].h);
    this.llCurve.set({ uL: 0, uGamma: [GAMMAS[4], GAMMAS[5], 0, 0], uCarry: 1, uLl });
    g.draw(this.llCurve, ll.B[0], ll.B[0].w, ll.B[0].h);
    for (let l = 1; l <= last; l++) {
      for (const p of [ll.A, ll.B]) {
        g.bind(0, p[l - 1].tex);
        this.llReduce.set({ uFine: 0 });
        g.draw(this.llReduce, p[l], p[l].w, p[l].h);
      }
    }
    for (let l = last - 1; l >= 0; l--) {
      g.bind(0, l === last - 1 ? g.blackTexture : ll.O[l + 1].tex);
      g.bind(1, ll.A[l].tex);
      g.bind(2, ll.A[l + 1].tex);
      g.bind(3, ll.B[l].tex);
      g.bind(4, ll.B[l + 1].tex);
      this.llCollapse.set({ uCoarse: 0, uA0: 1, uA1: 2, uB0: 3, uB1: 4, uTop: l === last - 1 ? 1 : 0, uDelta: l === 0 ? 1 : 0 });
      g.draw(this.llCollapse, ll.O[l], ll.O[l].w, ll.O[l].h);
    }
    return ll.O[0].tex;
  }

  /** The texture map's two targets for a w × h source, made on first use (one size at a time). */
  private eqTargets(w: number, h: number) {
    if (!this.eq || this.eq.w !== w || this.eq.h !== h) {
      if (this.eq) {
        this.gpu.free(this.eq.a);
        this.gpu.free(this.eq.b);
      }
      // 32-bit where possible: L* runs to 100 and more, where half floats step by 0.06.
      const precise = this.gpu.float32;
      this.eq = { w, h, a: this.gpu.target(w, h, true, precise), b: this.gpu.target(w, h, true, precise) };
      this.eqMade = null;
    }
    return this.eq;
  }

  /** Sharpening's two 32-bit targets for a w × h source, made on first use (one size at a time). */
  private usmTargets(w: number, h: number) {
    if (!this.usm || this.usm.w !== w || this.usm.h !== h) {
      if (this.usm) {
        this.gpu.free(this.usm.a);
        this.gpu.free(this.usm.b);
      }
      this.usm = { w, h, a: this.gpu.target(w, h, true, true), b: this.gpu.target(w, h, true, true) };
      this.usmMade = null;
    }
    return this.usm;
  }

  /**
   * RawTherapee's unsharp mask over the whole photo, on the print's lightness:
   * returns the target holding the change in lightness (.r) and the contrast
   * mask (.g). `kernel` is the lightness blur for this source size.
   */
  private usmMap(w: number, h: number, p: UsmParams, kernel: number[], drawInput: (t: Target) => void): Target {
    const g = this.gpu;
    const { a, b } = this.usmTargets(w, h);
    const m = gaussian1d(2);
    const pad = (k: number[], n: number) => [...k, ...new Array(n - k.length).fill(0)];
    const common = {
      uIn: 0, uThreshold: p.contrast / 100, uAmount: p.amount / 100,
      uG: pad(kernel, 25), uGHalf: (kernel.length - 1) / 2, uM: pad(m, 13), uMHalf: (m.length - 1) / 2,
    };
    drawInput(a);
    [a, b, a].forEach((from, mode) => {
      const to = from === a ? b : a;
      g.bind(0, from.tex);
      this.usmP.set({ ...common, uMode: mode });
      g.draw(this.usmP, to, to.w, to.h);
    });
    return b;
  }

  /** The colour equalizer's targets for a w × h source, made on first use (one size at a time). */
  private ceTargets(w: number, h: number) {
    if (!this.ce || this.ce.w !== w || this.ce.h !== h) {
      if (this.ce) {
        this.gpu.freePair(this.ce.pair);
        this.ce.t.forEach((t) => this.gpu.free(t));
      }
      const t = Array.from({ length: 5 }, () => this.gpu.target(w, h, true, true));
      // Steps 0 and 4 write targets 1 and 2 together.
      this.ce = { w, h, t, pair: this.gpu.pair(t[1], t[2]) };
      this.ceMade = null;
    }
    return this.ce.t;
  }

  /**
   * darktable's color equalizer over the whole photo: returns the target
   * holding the finished scene colour of every source pixel. `drawInput`
   * renders ceAnalyse() of the scene into a target. `roi` is the source's
   * width over the full-resolution width.
   */
  private colorEqMap(w: number, h: number, roi: number, color: ColorAdjust, u: Uniforms, drawInput: (t: Target) => void): Target {
    const g = this.gpu;
    const [t0, t1, t2, t3, t4] = this.ceTargets(w, h);
    const key = JSON.stringify(color);
    if (this.ceLuts?.key !== key) this.ceLuts = { key, luts: colorEqLuts(colorEqParams(color)) };
    const luts = this.ceLuts.luts;
    const k = (sigma: number) => {
      const kern = sigma < 0.05 ? [1] : gaussian1d(sigma);
      return { v: [...kern, ...new Array(7 - kern.length).fill(0)], half: (kern.length - 1) / 2 };
    };
    const kh = k(Math.max(0.2, 0.5 * CE.chromaSize * roi));
    const parSigma = Math.max(0.2, 0.5 * CE.paramSize * roi);
    const kp = k(parSigma);
    const ks = k(Math.max(0.5, roi));
    const kb = k(0.1 * parSigma);
    const brightShift = SAT_SHIFT + 0.01 * luts.maxBrightness * Math.min(5, Math.sqrt(CE.paramSize));
    const common = {
      ...u, ...colorBalanceUniforms(), uA: 0, uB: 1, uC: 2, uD: 3,
      uKh: kh.v, uKhHalf: kh.half, uKp: kp.v, uKpHalf: kp.half, uKs: ks.v, uKsHalf: ks.half, uKb: kb.v, uKbHalf: kb.half,
      uCeHue: Array.from(luts.hue), uCeSat: Array.from(luts.sat), uCeBright: Array.from(luts.bright),
      uCeShift: [SAT_SHIFT, brightShift, 4 * Math.sqrt(luts.maxBrightness) * roi * roi, WHITE],
    };
    drawInput(t0);
    const step = (mode: number, to: Target, ...from: Target[]) => {
      // Every input unit is rebound: a target still bound from an earlier step would make a feedback loop.
      for (let i = 0; i < 4; i++) g.bind(i, from[i]?.tex ?? g.blackTexture);
      this.ceP.set({ ...common, uMode: mode });
      g.draw(this.ceP, to, to.w, to.h);
    };
    const both = this.ce!.pair;
    step(0, both, t0);
    step(2, t3, t0, t1, t2);
    step(3, t4, t3);
    step(4, both, t3, t4);
    step(6, t0, t3, t4, t1, t2);
    return t0;
  }

  /** The colour equalizer alone on scene-linear Rec.2020 pixels, for the probe: the finished colour per pixel. */
  probeColorEq(rgb: Float32Array, w: number, h: number, color: ColorAdjust, roi = 1): Float32Array {
    const gl = this.gpu.gl;
    this.ceMade = null;
    const u = developUniforms(null, { width: w, height: h, seed: 0, inputMode: InputMode.SceneLinear, store: 1 });
    const out = this.colorEqMap(w, h, roi, color, u, (t) => {
      // ceAnalyse on the CPU reference's terms: upload U, V, L*, saturation.
      const data = new Float32Array(w * h * 4);
      for (let k = 0; k < w * h; k++) {
        const q = pixelUvl([rgb[3 * k], rgb[3 * k + 1], rgb[3 * k + 2]]);
        data.set([q.u, q.v, q.L, q.sat], 4 * k);
      }
      this.gpu.scratch();
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data);
    });
    const px = new Float32Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, px);
    return Float32Array.from({ length: w * h * 3 }, (_, k) => px[4 * Math.floor(k / 3) + (k % 3)]);
  }

  /** Sharpening alone on a lightness plane (0 to 1), for the probe: change in lightness and mask per pixel. */
  probeUsm(L: Float32Array, w: number, h: number, p: UsmParams, scale = 1): { delta: Float32Array; mask: Float32Array } {
    const gl = this.gpu.gl;
    this.usmMade = null;
    const out = this.usmMap(w, h, p, usmKernel(p.radius * scale), (t) => {
      const rgba = new Float32Array(w * h * 4);
      L.forEach((v, k) => (rgba[4 * k] = v));
      this.gpu.scratch();
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, rgba);
    });
    const px = new Float32Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, px);
    return { delta: px.filter((_, k) => k % 4 === 0), mask: px.filter((_, k) => k % 4 === 1) };
  }

  /**
   * darktable's contrast equalizer over the whole photo, on the scene's L*:
   * returns the target holding residue, boosted detail and the starting
   * lightness. `drawInput` renders the lightness into a target.
   */
  private textureMap(src: Source, mix: number, drawInput: (t: Target) => void): Target {
    const g = this.gpu;
    const { a, b } = this.eqTargets(src.w, src.h);
    const sc = scales(src.w, src.h, src.fullW, src.fullH, mix);
    drawInput(a);
    let from = a;
    let to = b;
    sc.forEach((s, i) => {
      g.bind(0, from.tex);
      this.eqP.set({ uIn: 0, uMult: s.mult, uBoost: s.boost, uSharpen: s.sharpen, uFirst: i === 0 ? 1 : 0 });
      g.draw(this.eqP, to, to.w, to.h);
      [from, to] = [to, from];
    });
    return from;
  }

  /** Capture sharpening alone, for the probe: the sharpened source's red channel, and the threshold it used. */
  probeCapture(src: Source, iterations: number, read = true): { red: Float32Array; threshold: number } {
    const gl = this.gpu.gl;
    this.csMade = null;
    this.captureSharpened(src, iterations);
    if (!read) {
      // Wait for the GPU, for timing, with a one-pixel read.
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.csOut!.fbo);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, new Float32Array(4));
      return { red: new Float32Array(0), threshold: src.capture!.threshold! };
    }
    const px = new Float32Array(src.w * src.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.csOut!.fbo);
    gl.readPixels(0, 0, src.w, src.h, gl.RGBA, gl.FLOAT, px);
    return { red: px.filter((_, k) => k % 4 === 0), threshold: src.capture!.threshold! };
  }

  /** The texture equalizer alone on an L* plane, for the probe: the change in L* per pixel. */
  probeEqualizer(L: Float32Array, w: number, h: number, fullW: number, fullH: number, mix: number): Float32Array {
    const gl = this.gpu.gl;
    const src = { w, h, fullW, fullH } as Source;
    this.eqMade = null;
    const out = this.textureMap(src, mix, (t) => {
      const rgba = new Float32Array(w * h * 4);
      L.forEach((v, k) => (rgba[4 * k] = v));
      this.gpu.scratch();
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, rgba);
    });
    const px = new Float32Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, px);
    return Float32Array.from({ length: w * h }, (_, k) => px[4 * k] + px[4 * k + 1] - px[4 * k + 2]);
  }

  /** The clarity filter alone on a lightness plane, for the probe: the change in lightness per pixel. */
  probeLocalLaplacian(L: Float32Array, w: number, h: number, uLl: number[]): Float32Array {
    const gl = this.gpu.gl;
    const ll = this.llPyramids(w, h);
    this.llMade = null;
    this.clarityMap(ll, uLl, (t) => {
      const rgba = new Float32Array(w * h * 4);
      L.forEach((v, k) => (rgba[4 * k] = v));
      this.gpu.scratch();
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, rgba);
    });
    const px = new Float32Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ll.O[0].fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, px);
    return px.filter((_, k) => k % 4 === 0);
  }

  /**
   * Upload the point curve as a 256x1 float texture (master, red, green, blue): the photo's own,
   * after a saved creative profile's at its Amount.
   */
  private curveTexture(recipe: Recipe): WebGLTexture {
    const gl = this.gpu.gl;
    const profile = profileSettingsFor(recipe)?.curve ?? null;
    const amount = recipe.lookAmount / 100;
    const key = JSON.stringify([recipe.curve, profile, amount]);
    if (this.curveTex && key === this.curveKey) return this.curveTex;
    if (!this.curveTex) this.curveTex = gl.createTexture()!;
    this.gpu.scratch();
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, CURVE_RES, 1, 0, gl.RGBA, gl.FLOAT, composedCurveTable(recipe.curve, profile, amount));
    this.gpu.params(false);
    this.curveKey = key;
    return this.curveTex;
  }

  /** A look LUT as a 3D texture (Gpu.lutTexture makes it on the scratch unit), kept by id. */
  private lutTexture(lut: LoadedLut): WebGLTexture {
    return this.lutTex.get(String(lut.id), () => this.gpu.lutTexture(textureData(lut), lut.level, lut.eightBit));
  }

  /** Keep the previous frame until its base profile and optional creative LUT are ready. */
  waiting(recipe: Recipe | null, camera?: import('../film/profiles').CameraMetadata | null, compare = false): boolean {
    const file = compare ? null : recipeLookFile(recipe);
    return (!!file && lutPending(file)) || profilePending(recipe?.profile ?? 'auto', camera);
  }

  /** Wait for the base profile and optional creative LUT before export or thumbnails. */
  async prepare(recipe: Recipe | null, camera?: import('../film/profiles').CameraMetadata | null) {
    const file = recipeLookFile(recipe);
    await prepareProfile(recipe?.profile ?? 'auto', camera);
    if (file) await loadLut(file);
  }

  private blur(a: Target, b: Target, spread: number, iterations: number) {
    const g = this.gpu;
    for (let i = 0; i < iterations; i++) {
      g.bind(0, a.tex);
      this.blurP.set({ uTex: 0, uDir: [spread / a.w, 0] });
      g.draw(this.blurP, b, b.w, b.h);
      g.bind(0, b.tex);
      this.blurP.set({ uTex: 0, uDir: [0, spread / b.h] });
      g.draw(this.blurP, a, a.w, a.h);
    }
  }

  /** Correct the RAW once, before all analysis maps, crop and creative adjustments. Camera
   * JPEG previews already have manufacturer corrections and never enter this pass. */
  private lensCorrected(src: Source, recipe: Recipe | null): Source {
    if (src.mode !== InputMode.SceneLinear || !src.lens?.correction || !this.gpu.hdr) return src;
    const model = lensSpline(src.lens.correction, src.w, src.h, recipe?.lens ?? null);
    if (!model) return src;
    const key = JSON.stringify([model, src.lens.orientation]);
    if (this.lensMade?.input === src.tex && this.lensMade.key === key) return { ...src, tex: this.lensMade.out.tex };
    if (this.lensMade) this.gpu.free(this.lensMade.out);
    const out = this.gpu.target(src.w, src.h, true);
    this.gpu.bind(0, src.tex);
    this.lensP.set({ uTex: 0, uLensCenter: lensCenter(src.lens.orientation ?? 1, src.fullW, src.fullH), ...lensUniforms(model), ...lensColourUniforms(src.lens) });
    this.gpu.draw(this.lensP, out, src.w, src.h);
    this.gpu.scratch();
    this.gpu.gl.bindTexture(this.gpu.gl.TEXTURE_2D, out.tex);
    this.gpu.gl.generateMipmap(this.gpu.gl.TEXTURE_2D);
    this.gpu.params(true);
    this.lensMade = { input: src.tex, key, out };
    // The target's content changed; downstream maps must not reuse its old pixels.
    this.eqMade = null; this.llMade = null; this.usmMade = null; this.ceMade = null;
    return { ...src, tex: out.tex };
  }

  /**
   * Develop `src` with `recipe` (null = original) into `target`, or onto the
   * canvas when `target` is 'screen'.
   */
  render(
    src: Source,
    recipe: Recipe | null,
    opts: {
      target: Target | 'screen';
      width: number;
      height: number;
      seed: number;
      compare?: boolean;
      view?: View;
      clipping?: boolean;
      /** Show the original left of this screen x (0 to 1). */
      split?: number;
      /** Frame to show instead of the recipe's crop: a rectangle of the photo straightened by `angle`. */
      frame?: Rect & { angle: number };
      /** Display colour for parts of the frame off the photo. */
      outside?: [number, number, number];
      /** Show Sharpening's contrast mask instead of the photo. */
      sharpenMask?: boolean;
    },
  ) {
    const g = this.gpu;
    // Capture sharpening replaces the source for everything after it.
    const iterations = recipe && !opts.compare && src.capture && g.hdr && g.float32 ? iterationsFor(recipe.captureSharpening) : 0;
    if (iterations > 0) src = { ...src, tex: this.captureSharpened(src, iterations) };
    src = this.lensCorrected(src, recipe);
    const profile = this.profiles.resolve(recipe?.profile ?? 'auto', src.mode === InputMode.SceneLinear ? src.camera : null);
    if (profile) {
      if (!g.hdr) throw Error('Camera profiles require floating-point WebGL render targets');
      const input = src.tex;
      const target = this.profiles.source(input, profile.key, src.w, src.h, (out) => {
        g.bind(0, input);
        this.profiles.bind(profile);
        this.dcpPass.set({ ...this.profiles.uniforms(profile), uTex: 0 });
        g.draw(this.dcpPass, out, src.w, src.h);
      });
      src = { ...src, tex: target.tex };
    }
    const view = opts.view ?? FULL_VIEW;
    const frame = opts.frame ?? recipe?.crop ?? FULL;
    // Effects that belong to the film (grain, vignette) see the whole uncropped
    // frame at the size it is shown, so cropping enlarges them as it would a negative.
    const look = recipe && !opts.compare ? lookLut(recipe) : null;
    const u = developUniforms(recipe, {
      width: opts.width / view.w / frame.w, height: opts.height / view.h / frame.h, seed: opts.seed, inputMode: src.mode, store: this.store, compare: opts.compare, white: src.white, look,
    });
    Object.assign(u,this.profiles.uniforms(profile));
    const [a, b, c, d, e, f] = cropAffine({ ...FULL, ...frame }, src.w, src.h);
    u.uGeoU = [a, b, e];
    u.uGeoV = [c, d, f];
    u.uOutside = opts.outside ?? [0, 0, 0];
    u.uGrainFull = [src.fullW, src.fullH];
    u.uView = [view.x, view.y, view.w, view.h];
    u.uClipShow = opts.clipping ? 1 : 0;
    u.uSplit = opts.split ?? -1;
    const passes = needsPasses(u);
    let hal: WebGLTexture = g.blackTexture;
    let glow: WebGLTexture = g.blackTexture;
    let sharp: WebGLTexture = g.blackTexture;
    // Without float targets the map would be too coarse; the stage then corrects per pixel.
    const teqLocal = passes.toneEqualizer && g.hdr;
    // Make every texture this render needs before binding any: creating one can
    // disturb a binding (see Gpu.scratch).
    const teq = teqLocal ? this.toneEqualizerMap(src, u) : g.blackTexture;
    const curve = u.uCurveOn === 1 && recipe ? this.curveTexture(recipe) : g.blackTexture;
    const lutTex = look ? this.lutTexture(look) : null;
    // Clarity needs float targets and at least two pyramid levels.
    const ll = passes.clarity && g.hdr && numLevels(src.w, src.h) >= 2 ? this.llPyramids(src.w, src.h) : null;
    // Texture needs float targets and at least one wavelet scale.
    const eqOn = passes.texture && g.hdr && scales(src.w, src.h, src.fullW, src.fullH, 1).length > 0;
    if (eqOn) this.eqTargets(src.w, src.h);
    // Sharpening needs 32-bit targets, and a radius RawTherapee would blur at this size.
    const usmP = usmParams(recipe?.sharpen ?? 0, recipe?.sharpenRadius ?? 0.5, recipe?.sharpenMasking ?? 0);
    const usmKern = usmKernel(usmP.radius * (src.w / src.fullW));
    const usmOn = passes.usm && g.hdr && g.float32 && usmKern.length > 1;
    if (usmOn) this.usmTargets(src.w, src.h);
    const ceOn = passes.colorEq && g.hdr && g.float32 && !!recipe?.color;
    if (ceOn) this.ceTargets(src.w, src.h);
    if (passes.highlights || passes.sharpen) this.chain(src.w, src.h);
    const teqU = { uTeqTex: 4, uTeqLocal: teqLocal ? 1 : 0, uCurveTex: 5 };

    if (passes.highlights || passes.sharpen) {
      const ch = this.chain(src.w, src.h);
      if (passes.highlights) {
        const { levels, pyramid } = ch;
        g.bind(0, src.tex);
        g.bind(4, teq);
        this.extract.set({ ...u, ...teqU, uSrc: 0, uTexel: [1 / src.w, 1 / src.h] });
        g.draw(this.extract, levels[0], levels[0].w, levels[0].h);
        for (let i = 1; i < levels.length; i++) this.downsample(levels[i - 1], levels[i]);
        const halLevel = levels[pyramid.halation];
        const glowLevel = levels[pyramid.glow];
        const hp = blurPlan(halLevel.w, HALATION_SIGMA);
        const gp = blurPlan(glowLevel.w, GLOW_SIGMA);
        this.blur(halLevel, ch.halTmp, hp.spread, hp.iterations);
        this.blur(glowLevel, ch.glowTmp, gp.spread, gp.iterations);
        hal = halLevel.tex;
        glow = glowLevel.tex;
      }
      if (passes.sharpen) {
        g.bind(0, src.tex);
        this.down.set({ uTex: 0, uTexel: [0.5 / src.w, 0.5 / src.h] });
        g.draw(this.down, ch.hA, ch.hA.w, ch.hA.h);
        this.blur(ch.hA, ch.hB, 1, 1);
        sharp = ch.hA.tex;
      }
    }

    let usm: WebGLTexture = g.blackTexture;
    let ceTex: WebGLTexture = g.blackTexture;
    const bindDevelop = (clarity: WebGLTexture) => {
      g.bind(0, src.tex);
      g.bind(1, sharp);
      g.bind(2, hal);
      g.bind(3, glow);
      g.bind(4, teq);
      g.bind(5, curve);
      g.bind(6, clarity);
      g.bind(8, texture);
      g.bind(9, usm);
      g.bind(10, ceTex);
      g.bind3d(LUT_UNIT, lutTex);
      this.profiles.bind(profile);
    };
    // A pass over the whole source that stops at a filter's input (see uTap in develop.frag).
    const tap = (t: Target, uTap: number, extra: Uniforms) => {
      this.develop.set({
        ...u, ...teqU, uSrc: 0, uBlurTex: 1, uHalTex: 2, uGlowTex: 3, uClarityTex: 6, uTextureTex: 8, uUsmTex: 9,
        uView: [0, 0, 1, 1], uGeoU: [1, 0, 0], uGeoV: [0, 1, 0], uSplit: -1, uClipShow: 0, uUsmOn: 0, uUsmShowMask: 0, uCeTex: 10, uCeOn: ceOn ? 1 : 0, uTap, ...extra,
      });
      g.draw(this.develop, t, t.w, t.h);
    };
    // Each map depends on the photo and everything before it, not on the view or crop.
    // Each map is kept until something upstream of it changes (BEFORE_TEXTURE and on).
    const textureKey = `${src.w}x${src.h}|${pick(u, BEFORE_TEXTURE)}|${pick(u, TEXTURE_STAGE)}`;
    const ceKey = `${textureKey}|${pick(u, COLOR_STAGE)}|${JSON.stringify(recipe?.color ?? null)}`;
    // The vignette reads the frame's aspect.
    const aspect = ((u.uOut as number[])[0] / (u.uOut as number[])[1]).toFixed(6);
    const llKey = `${ceKey}|${pick(u, BEFORE_CLARITY)}|${aspect}|${pick(u, CLARITY_STAGE)}`;
    const usmKey = `${llKey}|${recipe?.sharpen},${recipe?.sharpenRadius},${recipe?.sharpenMasking}`;
    let texture: WebGLTexture = g.blackTexture;
    if (eqOn && this.eqMade?.tex === src.tex && this.eqMade.key === textureKey) texture = this.eqMade.out.tex;
    else if (eqOn) {
      const out = this.textureMap(src, u.uTextureMix as number, (t) => {
        bindDevelop(g.blackTexture);
        tap(t, 2, { uTextureOn: 0, uClarityOn: 0 });
      });
      this.eqMade = { tex: src.tex, key: textureKey, out };
      texture = out.tex;
    }
    if (ceOn && this.ceMade?.tex === src.tex && this.ceMade.key === ceKey) ceTex = this.ceMade.out.tex;
    else if (ceOn) {
      // The equalizer's input: the scene after texture, analysed, at every source pixel.
      const out = this.colorEqMap(src.w, src.h, src.w / src.fullW, recipe!.color!, u, (t) => {
        bindDevelop(g.blackTexture);
        tap(t, 4, { uTextureOn: eqOn ? 1 : 0, uClarityOn: 0, uCeOn: 0 });
      });
      this.ceMade = { tex: src.tex, key: ceKey, out };
      ceTex = out.tex;
    }
    let clarity: WebGLTexture = g.blackTexture;
    if (ll && this.llMade?.tex === src.tex && this.llMade.key === llKey) clarity = ll.O[0].tex;
    else if (ll) {
      // The filter's input: the print's lightness at every source pixel, uncropped.
      clarity = this.clarityMap(ll, u.uLl as number[], (t) => {
        bindDevelop(g.blackTexture);
        tap(t, 1, { uTextureOn: eqOn ? 1 : 0, uClarityOn: 0 });
      });
      this.llMade = { tex: src.tex, key: llKey };
    }
    if (usmOn && this.usmMade?.tex === src.tex && this.usmMade.key === usmKey) usm = this.usmMade.out.tex;
    else if (usmOn) {
      // The mask's input: the finished print's lightness at every source pixel, uncropped.
      const out = this.usmMap(src.w, src.h, usmP, usmKern, (t) => {
        bindDevelop(clarity);
        tap(t, 3, { uTextureOn: eqOn ? 1 : 0, uClarityOn: ll ? 1 : 0 });
      });
      this.usmMade = { tex: src.tex, key: usmKey, out };
      usm = out.tex;
    }
    bindDevelop(clarity);
    this.develop.set({
      ...u, ...teqU, uSrc: 0, uBlurTex: 1, uHalTex: 2, uGlowTex: 3, uClarityTex: 6, uTextureTex: 8, uUsmTex: 9, uCeTex: 10, uCeOn: ceOn ? 1 : 0, uTap: 0, uClarityOn: ll ? 1 : 0, uTextureOn: eqOn ? 1 : 0,
      uUsmOn: usmOn ? 1 : 0, uUsmShowMask: usmOn && opts.sharpenMask ? 1 : 0,
    });
    if (opts.target === 'screen') {
      g.draw(this.develop, null, opts.width, opts.height, true);
      if (this.fence) g.gl.deleteSync(this.fence);
      this.fence = g.gl.fenceSync(g.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      g.gl.flush();
    }
    else g.draw(this.develop, opts.target, opts.width, opts.height, false);
  }

  /**
   * Average scene light (linear Rec.2020, before white balance and the look)
   * over a small patch around (u, v), with v = 0 at the top of the photo.
   * The patch spans about 0.4% of the frame, whatever the source size.
   */
  sampleScene(src: Source, u: number, v: number, recipe: Recipe | null = null): [number, number, number] {
    const g = this.gpu;
    const gl = g.gl;
    src = this.lensCorrected(src, recipe);
    const t = g.target(1, 1, g.hdr, g.float32);
    try {
      const step = 0.002 * Math.max(src.w, src.h);
      g.bind(0, src.tex);
      this.sampleP.set({
        ...developUniforms(null, { width: 1, height: 1, seed: 0, inputMode: src.mode, store: 1 }),
        uSrc: 0,
        uAt: [u, v],
        uTexel: [step / src.w, step / src.h],
      });
      g.draw(this.sampleP, t, 1, 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      let rgb: [number, number, number];
      if (g.hdr) {
        const px = new Float32Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);
        rgb = [px[0], px[1], px[2]];
      } else {
        const px = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        rgb = [px[0] / 255, px[1] / 255, px[2] / 255];
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return rgb;
    } finally {
      g.free(t);
    }
  }

  /** Develop into RGBA8 pixels, top row first, at width × height; size it to the recipe's crop (`framePixels`). */
  readPixels(src: Source, recipe: Recipe | null, width: number, height: number, seed: number, compare = false, view?: View, split?: number): Uint8Array<ArrayBuffer> {
    const g = this.gpu;
    const gl = g.gl;
    const out = this.outs.get(`${width}x${height}`, () => g.target(width, height, false));
    this.render(src, recipe, { target: out, width, height, seed, compare, view, split });
    const px = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px;
  }

  /** Develop into a 2D canvas at the canvas's size. */
  renderToCanvas(src: Source, recipe: Recipe | null, canvas: HTMLCanvasElement, seed: number) {
    const px = this.readPixels(src, recipe, canvas.width, canvas.height, seed);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new GpuError('2D canvas unavailable');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer), canvas.width, canvas.height), 0, 0);
  }

  dispose() {
    this.profiles.dispose();
    if (this.lensMade) this.gpu.free(this.lensMade.out);
    this.lensMade = null;
    if (this.curveTex) this.gpu.gl.deleteTexture(this.curveTex);
    this.curveTex = null;
    this.lutTex.clear();
    this.chains.clear();
    this.outs.clear();
  }
}

/** A recipe's colour adjustment (percent and degrees) as darktable's color equalizer parameters. */
export const colorEqParams = (c: ColorAdjust): ColorEqParams => ({ hue: c.hue.map((v) => (v * HUE_DEGREES) / HUE_MAX), sat: c.sat.map((v) => 1 + (SAT_RANGE * v) / 100), bright: c.bright.map((v) => 1 + (BRIGHT_RANGE * v) / 100) });

/** A recipe's look LUT: null when its pack has none for the stock, or until it has loaded. */
export function lookLut(recipe: Recipe): LoadedLut | null {
  const file = recipeLookFile(recipe);
  return file ? lutFor(file) : null;
}

/** A stable per-photo seed so grain is fixed for each frame. */
export function seedFor(path: string): number {
  let h = 2166136261;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 4000) / 100 + 0.5;
}
