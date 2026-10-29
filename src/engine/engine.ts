// SPDX-License-Identifier: GPL-3.0-or-later
// The develop engine: uploads sources and runs the pass graph.
//
//   source ─┬─ extract (1/4) ─ blur ─┬─────────────── halation ─┐
//           │                        └─ down (1/8) ─ blur ─ glow ┤
//           ├─ down (1/2) ─ blur ────────────────── sharpen ─────┤
//           └────────────────────────────────────────────── develop ─ output

import type { Recipe } from '../film/recipe';
import { Gpu, GpuError, Lru, type Program, type Target } from './gpu';
import { InputMode, developUniforms, needsPasses, type Uniforms } from './params';
import { GLOW_SIGMA, HALATION_SIGMA, blurPlan, pyramidFor, type Pyramid } from './pyramid';
import { MASK_SIGMA } from './toneequalizer';
import { SHADERS } from './shaders';

export { GpuError, InputMode };

/** Pixels decoded by the backend: RGBA half floats. */
export interface HalfImage {
  width: number;
  height: number;
  mode: InputMode;
  data: Uint16Array;
}

export interface Source {
  tex: WebGLTexture;
  w: number;
  h: number;
  mode: InputMode;
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

export class Engine {
  readonly gpu: Gpu;
  private develop: Program;
  private extract: Program;
  private teqMask: Program;
  private blurP: Program;
  private down: Program;
  private chains: Lru<Chain>;
  private outs: Lru<Target>;
  private store: number;

  constructor(canvas: HTMLCanvasElement) {
    this.gpu = new Gpu(canvas);
    this.develop = this.gpu.program(SHADERS.vertex, SHADERS.develop);
    this.extract = this.gpu.program(SHADERS.vertex, SHADERS.extract);
    this.teqMask = this.gpu.program(SHADERS.vertex, SHADERS.toneeqmask);
    this.blurP = this.gpu.program(SHADERS.vertex, SHADERS.blur);
    this.down = this.gpu.program(SHADERS.vertex, SHADERS.down);
    this.store = this.gpu.hdr ? 1 : 0.25;
    this.chains = new Lru<Chain>(6, (c) => [...c.levels, c.halTmp, c.glowTmp, c.hA, c.hB, ...(c.teq ?? []), ...(c.teqTmp ? [c.teqTmp] : [])].forEach((t) => this.gpu.free(t)));
    this.outs = new Lru<Target>(12, (t) => this.gpu.free(t));
  }

  get maxTextureSize() { return this.gpu.maxTextureSize; }

  /** Upload decoded half-float pixels. */
  sourceFromHalf(img: HalfImage): Source {
    const gl = this.gpu.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, img.width, img.height, 0, gl.RGBA, gl.HALF_FLOAT, img.data);
    const mips = this.gpu.hdr;
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    this.gpu.params(mips);
    return { tex, w: img.width, h: img.height, mode: img.mode };
  }

  /** Upload an sRGB image (a thumbnail). */
  sourceFromImage(img: TexImageSource, w: number, h: number): Source {
    const gl = this.gpu.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.gpu.params(true);
    return { tex, w, h, mode: InputMode.DisplayEncoded };
  }

  release(src: Source | null | undefined) {
    if (src) this.gpu.gl.deleteTexture(src.tex);
  }

  /** Free the intermediate buffers for one source size (after a large export). */
  dropBuffers(w: number, h: number) {
    this.chains.delete(`${w}x${h}`);
    this.outs.delete(`${w}x${h}`);
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

  /**
   * Develop `src` with `recipe` (null = original) into `target`, or onto the
   * canvas when `target` is 'screen'.
   */
  render(src: Source, recipe: Recipe | null, opts: { target: Target | 'screen'; width: number; height: number; seed: number; compare?: boolean }) {
    const g = this.gpu;
    const u = developUniforms(recipe, {
      width: opts.width, height: opts.height, seed: opts.seed, inputMode: src.mode, store: this.store, compare: opts.compare,
    });
    const passes = needsPasses(u);
    let hal: WebGLTexture = g.blackTexture;
    let glow: WebGLTexture = g.blackTexture;
    let sharp: WebGLTexture = g.blackTexture;
    // Without float targets the map would be too coarse; the stage then corrects per pixel.
    const teqLocal = passes.toneEqualizer && g.hdr;
    const teq = teqLocal ? this.toneEqualizerMap(src, u) : g.blackTexture;
    g.bind(4, teq);
    const teqU = { uTeqTex: 4, uTeqLocal: teqLocal ? 1 : 0 };

    if (passes.highlights || passes.sharpen) {
      const ch = this.chain(src.w, src.h);
      if (passes.highlights) {
        const { levels, pyramid } = ch;
        g.bind(0, src.tex);
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

    g.bind(0, src.tex);
    g.bind(1, sharp);
    g.bind(2, hal);
    g.bind(3, glow);
    this.develop.set({ ...u, ...teqU, uSrc: 0, uBlurTex: 1, uHalTex: 2, uGlowTex: 3 });
    if (opts.target === 'screen') g.draw(this.develop, null, opts.width, opts.height, true);
    else g.draw(this.develop, opts.target, opts.width, opts.height, false);
  }

  /** Develop into RGBA8 pixels, top row first. */
  readPixels(src: Source, recipe: Recipe | null, width: number, height: number, seed: number, compare = false): Uint8Array<ArrayBuffer> {
    const g = this.gpu;
    const gl = g.gl;
    const out = this.outs.get(`${width}x${height}`, () => g.target(width, height, false));
    this.render(src, recipe, { target: out, width, height, seed, compare });
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
    this.chains.clear();
    this.outs.clear();
  }
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
