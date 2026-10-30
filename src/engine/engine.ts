// SPDX-License-Identifier: GPL-3.0-or-later
// The develop engine: uploads sources and runs the pass graph.
//
//   source ─┬─ extract (1/4) ─ blur ─┬─────────────── halation ─┐
//           │                        └─ down (1/8) ─ blur ─ glow ┤
//           ├─ down (1/2) ─ blur ────────────────── sharpen ─────┤
//           └────────────────────────────────────────────── develop ─ output

import type { Recipe } from '../film/recipe';
import { FULL, cropAffine, type Rect } from '../film/crop';
import { Gpu, GpuError, Lru, type Program, type Target } from './gpu';
import { InputMode, developUniforms, needsPasses, type Uniforms } from './params';
import { GLOW_SIGMA, HALATION_SIGMA, blurPlan, pyramidFor, type Pyramid } from './pyramid';
import { MASK_SIGMA } from './toneequalizer';
import { GAMMAS, levelSize, numLevels } from './locallaplacian';
import { CURVE_RES, curveTable } from '../film/curve';
import type { Xy } from './whitebalance';
import { SHADERS } from './shaders';

export { GpuError, InputMode };

/** Pixels decoded by the backend: RGBA half floats. */
export interface HalfImage {
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
  tex: WebGLTexture;
  w: number;
  h: number;
  mode: InputMode;
  /** As-shot white point; null for D65 (anything that is not a RAW, or not known yet). */
  white: Xy | null;
  /** Size of the full-resolution image; the texture may be smaller. */
  fullW: number;
  fullH: number;
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

export class Engine {
  readonly gpu: Gpu;
  private develop: Program;
  private extract: Program;
  private teqMask: Program;
  private sampleP: Program;
  /** The point curve's lookup table, re-uploaded only when the curve changes. */
  private curveTex: WebGLTexture | null = null;
  private curveKey = '';
  private blurP: Program;
  private down: Program;
  private chains: Lru<Chain>;
  private lls: Lru<Ll>;
  private llCurve: Program;
  private llReduce: Program;
  private llCollapse: Program;
  /** What the clarity map in `lls` was last made from, so panning and zooming reuse it. */
  private llMade: { tex: WebGLTexture; key: string } | null = null;
  private outs: Lru<Target>;
  private store: number;

  constructor(canvas: HTMLCanvasElement) {
    this.gpu = new Gpu(canvas);
    this.develop = this.gpu.program(SHADERS.vertex, SHADERS.develop);
    this.extract = this.gpu.program(SHADERS.vertex, SHADERS.extract);
    this.teqMask = this.gpu.program(SHADERS.vertex, SHADERS.toneeqmask);
    this.sampleP = this.gpu.program(SHADERS.vertex, SHADERS.sample);
    this.blurP = this.gpu.program(SHADERS.vertex, SHADERS.blur);
    this.down = this.gpu.program(SHADERS.vertex, SHADERS.down);
    this.store = this.gpu.hdr ? 1 : 0.25;
    this.chains = new Lru<Chain>(6, (c) => [...c.levels, c.halTmp, c.glowTmp, c.hA, c.hB, ...(c.teq ?? []), ...(c.teqTmp ? [c.teqTmp] : [])].forEach((t) => this.gpu.free(t)));
    this.outs = new Lru<Target>(12, (t) => this.gpu.free(t));
    this.llCurve = this.gpu.program(SHADERS.vertex, SHADERS.llcurve);
    this.llReduce = this.gpu.program(SHADERS.vertex, SHADERS.llreduce);
    this.llCollapse = this.gpu.program(SHADERS.vertex, SHADERS.llcollapse);
    // Full-size pyramids are large: keep only the latest two sizes (preview and full resolution).
    this.lls = new Lru<Ll>(2, (l) => [...l.A, ...l.B, ...l.O].forEach((t) => this.gpu.free(t)));
  }

  get maxTextureSize() { return this.gpu.maxTextureSize; }

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
    return { tex, w: img.width, h: img.height, mode: img.mode, white: img.white, fullW: img.fullWidth, fullH: img.fullHeight };
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
    if (src) this.gpu.gl.deleteTexture(src.tex);
  }

  /** Free the intermediate buffers for one source size (after a large export). */
  dropBuffers(w: number, h: number) {
    this.chains.delete(`${w}x${h}`);
    this.outs.delete(`${w}x${h}`);
    this.lls.delete(`${w}x${h}`);
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

  /** Upload `recipe`'s point curve as a 256x1 float texture (master, red, green, blue). */
  private curveTexture(recipe: Recipe): WebGLTexture {
    const gl = this.gpu.gl;
    const key = JSON.stringify(recipe.curve);
    if (this.curveTex && key === this.curveKey) return this.curveTex;
    if (!this.curveTex) this.curveTex = gl.createTexture()!;
    this.gpu.scratch();
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, CURVE_RES, 1, 0, gl.RGBA, gl.FLOAT, curveTable(recipe.curve!));
    this.gpu.params(false);
    this.curveKey = key;
    return this.curveTex;
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
    },
  ) {
    const g = this.gpu;
    const view = opts.view ?? FULL_VIEW;
    const frame = opts.frame ?? recipe?.crop ?? FULL;
    // Effects that belong to the film (grain, vignette) see the whole uncropped
    // frame at the size it is shown, so cropping enlarges them as it would a negative.
    const u = developUniforms(recipe, {
      width: opts.width / view.w / frame.w, height: opts.height / view.h / frame.h, seed: opts.seed, inputMode: src.mode, store: this.store, compare: opts.compare, white: src.white,
    });
    const [a, b, c, d, e, f] = cropAffine({ ...FULL, ...frame }, src.w, src.h);
    u.uGeoU = [a, b, e];
    u.uGeoV = [c, d, f];
    u.uOutside = opts.outside ?? [0, 0, 0];
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
    // Clarity needs float targets and at least two pyramid levels.
    const ll = passes.clarity && g.hdr && numLevels(src.w, src.h) >= 2 ? this.llPyramids(src.w, src.h) : null;
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

    const bindDevelop = (clarity: WebGLTexture) => {
      g.bind(0, src.tex);
      g.bind(1, sharp);
      g.bind(2, hal);
      g.bind(3, glow);
      g.bind(4, teq);
      g.bind(5, curve);
      g.bind(6, clarity);
    };
    let clarity: WebGLTexture = g.blackTexture;
    // The map depends on the photo and everything before the print, not on the view or crop.
    const llKey = ll ? `${src.w}x${src.h}|${JSON.stringify({ ...recipe, crop: null })}` : '';
    if (ll && this.llMade?.tex === src.tex && this.llMade.key === llKey) clarity = ll.O[0].tex;
    else if (ll) {
      // The filter's input: the print's lightness at every source pixel, uncropped.
      clarity = this.clarityMap(ll, u.uLl as number[], (t) => {
        bindDevelop(g.blackTexture);
        this.develop.set({
          ...u, ...teqU, uSrc: 0, uBlurTex: 1, uHalTex: 2, uGlowTex: 3, uClarityTex: 6,
          uView: [0, 0, 1, 1], uGeoU: [1, 0, 0], uGeoV: [0, 1, 0], uSplit: -1, uClipShow: 0, uClarityOut: 1, uClarityOn: 0,
        });
        g.draw(this.develop, t, t.w, t.h);
      });
      this.llMade = { tex: src.tex, key: llKey };
    }
    bindDevelop(clarity);
    this.develop.set({ ...u, ...teqU, uSrc: 0, uBlurTex: 1, uHalTex: 2, uGlowTex: 3, uClarityTex: 6, uClarityOut: 0, uClarityOn: ll ? 1 : 0 });
    if (opts.target === 'screen') g.draw(this.develop, null, opts.width, opts.height, true);
    else g.draw(this.develop, opts.target, opts.width, opts.height, false);
  }

  /**
   * Average scene light (linear Rec.2020, before white balance and the look)
   * over a small patch around (u, v), with v = 0 at the top of the photo.
   * The patch spans about 0.4% of the frame, whatever the source size.
   */
  sampleScene(src: Source, u: number, v: number): [number, number, number] {
    const g = this.gpu;
    const gl = g.gl;
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
    if (this.curveTex) this.gpu.gl.deleteTexture(this.curveTex);
    this.curveTex = null;
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
