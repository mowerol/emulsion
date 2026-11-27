// SPDX-License-Identifier: GPL-3.0-or-later
// Film grain on the GPU (filmgrain.ts): the baked film (each texel's threshold, made once per
// grain spread) and its integrated pyramid, the grain's change at every output pixel, made in tiles
// from the developed frame and the film, and the pass that adds it to the frame.
import vertex from './shaders/quad.vert.glsl?raw';
import common from './shaders/filmgrain-common.glsl?raw';
import printShader from './shaders/filmgrain-print.glsl?raw';
import bakeShader from './shaders/filmgrain-bake.frag.glsl?raw';
import pyramidShader from './shaders/filmgrain-pyramid.frag.glsl?raw';
import gridShader from './shaders/filmgrain.frag.glsl?raw';
import cellsShader from './shaders/filmgrain-cells.frag.glsl?raw';
import blurShader from './shaders/filmgrain-blur.frag.glsl?raw';
import composeShader from './shaders/filmgrain-compose.frag.glsl?raw';
import { assemble } from './glsl';
import { grainGeometry, type BoolGrainParams } from './boolgrain';
import { FILM_BLOCK, FILM_SEED, LEVELS, U_TOP_VALUE, PYRAMID_FIRST, PYRAMID_KNOTS, PYRAMID_LAST, TEXEL_PHASE, blurMargin, filmPlan, filterEnergy, filterTaps, pixelTaps, pyramidKnot, varianceShape, type FilmKind, type FilmTile } from './filmgrain';
import { GpuError, type Gpu, type Program, type Target } from './gpu';

/** Where the output's pixels are on the film (develop.frag's view and geometry). */
export interface FilmView {
  /** Output size, in pixels. */
  size: [number, number];
  /** The part of the frame the output shows. */
  view: [number, number, number, number];
  /** A frame point's place on the whole source (uGeoU, uGeoV, uGeoW). */
  geo: number[][];
  /** The whole source's full-resolution size. */
  full: [number, number];
  /** Output pixels per frame pixel. */
  scale: number;
}

/**
 * Grid points per tile: a point reads a texel or two, so 24 million are a few ms of GPU work, few
 * enough tiles that a settle's steps (each waits for the GPU) don't add up.
 */
const TILE_POINTS = 24e6;
/** Texels of the baked film per draw: small, as each texel's work is the heaviest of the passes. */
const BAKE_TEXELS = 2.5e5;

export class FilmGrainGpu {
  /** Probe only: draw only the passes up to this one (0 grid, 1 filter along x, 2 all). */
  static passes = 2;
  private bakeP: Program;
  private pyramidP: Program;
  private gridP: Program;
  private cellsP: Program;
  private blurP: Program;
  composeP: Program;
  private grid: Target | null = null;
  private mid: Target | null = null;
  /** The photo's own coverage filtered along x (blur mode 3), for the softening. */
  private meanMid: Target | null = null;
  /** The filter's taps (filterTaps) and, for packed grid rows, their sums per byte (filterLut). */
  private weights: WebGLTexture | null = null;
  private lut: WebGLTexture | null = null;
  private filterKey = '';
  /** The baked film, its integrated pyramid (levels PYRAMID_FIRST to PYRAMID_LAST), and what they
   * were made for (null while a bake is unfinished). */
  private filmT: Target | null = null;
  private pyramid: WebGLTexture[] = [];
  private filmMade: string | null = null;

  constructor(private g: Gpu) {
    const files = { 'filmgrain-common.glsl': common, 'filmgrain-print.glsl': printShader };
    this.bakeP = g.program(vertex, assemble(bakeShader, files));
    this.pyramidP = g.program(vertex, pyramidShader);
    this.gridP = g.program(vertex, assemble(gridShader, files));
    this.cellsP = g.program(vertex, assemble(cellsShader, files));
    this.blurP = g.program(vertex, assemble(blurShader, files));
    this.composeP = g.program(vertex, composeShader);
  }

  /** The output tile size for k grid points per pixel and a filter margin of M pixels. */
  static tile(k: number, M: number) {
    return Math.max(32, Math.min(1536, Math.floor(Math.sqrt(TILE_POINTS) / k) - 2 * M));
  }

  /** The key of the film for these grains (in radii: only the radius's relative deviation). */
  static filmKey(bake: BoolGrainParams, tile: FilmTile) {
    return `${bake.sigmaR}|${tile.perCell}|${tile.cells}`;
  }

  /** The baked film's target (for the probe). */
  get filmTarget() { return this.filmMade ? this.filmT : null; }
  /** The integrated film's level (for the probe). */
  pyramidLevel(level: number) { return this.filmMade ? this.pyramid[level - PYRAMID_FIRST] : null; }

  /** Whether the film for this key is baked. */
  baked(key: string) { return this.filmMade === key; }

  /**
   * Bake the film's grains `p` (bakeParams: in radii) laid out as `tile`, in bands of rows, then
   * integrate it (the pyramid's levels, a knot at a time), yielding after each draw (flushed).
   */
  *bakeSteps(p: BoolGrainParams, tile: FilmTile, key: string): Generator<void> {
    const g = this.g, gl = g.gl;
    if (this.filmMade === key) return;
    // Made before any binding (see Gpu.scratch).
    if (this.filmT && this.filmT.w !== tile.side) this.freeFilm();
    const t = this.filmT ??= levelTarget(g, tile.side);
    if (!this.pyramid.length) for (let L = PYRAMID_FIRST; L <= PYRAMID_LAST; L++) this.pyramid.push(shareArray(g, tile.side >> L));
    this.filmMade = null;
    const geo = grainGeometry(p);
    const clip = g.clip;
    const fbo = gl.createFramebuffer()!;
    try {
      const rows = Math.max(1, Math.floor(BAKE_TEXELS / tile.side));
      for (let y = 0; y < tile.side; y += rows) {
        this.bakeP.set({
          uTexel: tile.texel, uCells: tile.cells, uRadius: p.radius, uSigmaR: p.sigmaR, uMu: geo.mu, uSigma: geo.sigma, uMaxRadius: geo.maxRadius, uAg: geo.ag,
          uLambdaK: (geo.ag * geo.ag) / (Math.PI * (p.radius * p.radius + p.sigmaR * p.sigmaR)), uSeed: FILM_SEED,
        });
        g.clip = { x: 0, y, w: tile.side, h: Math.min(rows, tile.side - y), tw: tile.side, th: tile.side };
        g.draw(this.bakeP, t, tile.side, tile.side);
        gl.flush();
        yield;
      }
      g.clip = null;
      // The pyramid: the first level counts the tile's texels, each next one averages the last.
      for (let L = PYRAMID_FIRST; L <= PYRAMID_LAST; L++) {
        const n = tile.side >> L, layers = this.pyramid[L - PYRAMID_FIRST];
        for (let j = 0; j < PYRAMID_KNOTS; j++) {
          if (L === PYRAMID_FIRST) g.bind(0, t.tex);
          else { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.pyramid[L - 1 - PYRAMID_FIRST]); }
          this.pyramidP.set({ uTile: 0, uPrev: 1, uFromTile: L === PYRAMID_FIRST ? 1 : 0, uNeed: Math.floor(pyramidKnot(j) * LEVELS), uLayer: j });
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
          gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, layers, 0, j);
          g.draw(this.pyramidP, { tex: layers, fbo, w: n, h: n, hdr: true }, n, n);
          gl.flush();
          if (L === PYRAMID_FIRST) yield;
        }
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
        yield;
      }
    } finally {
      g.clip = clip;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
    }
    this.filmMade = key;
  }

  /**
   * The grain's change (the model's render printed, less the shown value's own; filmChange: its
   * softening in .r, its grain in .g) at every pixel of `to` (the output's size, two channels), from `shown`, the developed frame with `margin` pixels
   * around the output, and the baked film (bakeSteps first), in radii of p.radius frame pixels, its
   * blocks placed by the photo's seed (p.seed), printed as `kind`. Grains far smaller than a pixel
   * read the integrated film by cells (filmPlan); larger ones are tested point by point. Yields
   * after each tile, each flushed.
   */
  *deltaSteps(shown: Target, margin: number, to: Target, fv: FilmView, p: BoolGrainParams, tile: FilmTile, kind: FilmKind): Generator<void> {
    const g = this.g, gl = g.gl;
    const film = this.filmT;
    if (!film || !this.filmMade) throw Error('Film grain: the film is not baked');
    const plan = filmPlan(p, fv.scale, tile), k = plan.k;
    const [W, H] = fv.size;
    const M = blurMargin(p.sigmaFilter, fv.scale), T = FilmGrainGpu.tile(k, M), C = T + 2 * M, G = C * k;
    // Made before any binding (see Gpu.scratch). The point path packs a row's points in a texel.
    const gridW = plan.integrated ? G : C;
    if (!this.grid || this.grid.w !== gridW || this.grid.h !== G || this.grid.hdr !== plan.integrated || this.mid?.w !== T || this.mid.h !== G) {
      if (this.grid) g.free(this.grid);
      if (this.mid) g.free(this.mid);
      this.grid = plan.integrated ? g.target(G, G, true, false, true) : g.target(C, G, false);
      this.mid = g.target(T, G, true, false, true);
    }
    if (!this.meanMid || this.meanMid.w !== T || this.meanMid.h !== C) {
      if (this.meanMid) g.free(this.meanMid);
      this.meanMid = g.target(T, C, true, false, true);
    }
    const taps = filterTaps(k, p.sigmaFilter, fv.scale), ptaps = pixelTaps(k, p.sigmaFilter, fv.scale);
    const spread = p.radius > 0 ? p.sigmaR / p.radius : 0;
    const filterKey = `${k}|${p.sigmaFilter}|${fv.scale}|${M}|${spread}`;
    if (this.filterKey !== filterKey) {
      this.weights ??= gl.createTexture();
      this.lut ??= gl.createTexture();
      g.scratch();
      // Row 0 the grid's taps, row 1 the pixels', row 2 the model's variance at 256 coverages.
      const tw = Math.max(taps.w.length, ptaps.w.length, 256), rows = new Float32Array(3 * tw);
      rows.set(taps.w); rows.set(ptaps.w, tw);
      for (let i = 0; i < 256; i++) rows[2 * tw + i] = varianceShape((i / 255) * U_TOP_VALUE, spread);
      upload(gl, this.weights!, tw, 3, rows);
      upload(gl, this.lut!, 256, 2 * (2 * M + 1), filterLut(k, taps, M));
      this.filterKey = filterKey;
    }
    const common = {
      uShown: 0, uMargin: margin, uSize: fv.size, uView: fv.view, uGeoU: fv.geo[0], uGeoV: fv.geo[1], uGeoW: fv.geo[2], uFull: fv.full,
      uK: k, uSide: tile.side, uTexel: tile.texel, uCells: tile.cells, uPerCell: tile.perCell, uRadius: p.radius,
      uBlock: FILM_BLOCK, uSeed: p.seed >>> 0, uPhase: TEXEL_PHASE, uKind: kind === 'slide' ? 1 : 0,
    };
    const first = plan.integrated ? this.cellsP : this.gridP;
    const clip = g.clip;
    try {
      for (let ty = 0; ty < H; ty += T) for (let tx = 0; tx < W; tx += T) {
        const tw = Math.min(T, W - tx), th = Math.min(T, H - ty);
        const cw = tw + 2 * M, gh = (th + 2 * M) * k;
        g.clip = null;
        g.bind(0, shown.tex);
        if (plan.integrated) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.pyramid[plan.level - PYRAMID_FIRST]); }
        else g.bind(2, film.tex);
        first.set({ ...common, uTile: 2, uPyr: 2, uLevel: plan.level, uKnots: PYRAMID_KNOTS, uGridOrigin: [(tx - M) * k, (ty - M) * k] });
        g.draw(first, this.grid, plan.integrated ? cw * k : cw, gh);
        if (plan.integrated) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D_ARRAY, null); }
        if (FilmGrainGpu.passes === 0) { gl.flush(); yield; continue; }
        g.bind(0, this.grid.tex);
        g.bind(1, shown.tex);
        g.bind(3, this.lut!);
        g.bind(4, this.weights!);
        this.blurP.set({ uSrc: 0, uShown: 1, uLut: 3, uWeights: 4, uMean: 5, uLo: taps.lo, uTaps: taps.w.length, uPLo: ptaps.lo, uPTaps: ptaps.w.length, uReach: M, uMargin: margin, uMode: plan.integrated ? 2 : 0, uTile: [0, 0], uK: k, uKind: common.uKind });
        g.draw(this.blurP, this.mid!, tw, gh);
        if (FilmGrainGpu.passes === 1) { gl.flush(); yield; continue; }
        // The photo's own coverage along x, for the softening. Unbound first: the last tile's step
        // left it bound for reading, and drawing into a texture a sampler holds is skipped.
        g.bind(5, g.blackTexture);
        this.blurP.set({ uMode: 3, uTile: [tx, ty] });
        g.draw(this.blurP, this.meanMid!, tw, th + 2 * M);
        g.bind(0, this.mid!.tex);
        g.bind(1, shown.tex);
        g.bind(5, this.meanMid!.tex);
        this.blurP.set({ uMode: 1, uTile: [tx, ty], uVarScale: (p.radius * fv.scale) ** 2 * filterEnergy(k, taps) });
        g.clip = { x: tx, y: ty, w: tw, h: th, tw: W, th: H };
        g.draw(this.blurP, to, W, H);
        gl.flush();
        yield;
      }
    } finally { g.clip = clip; }
  }

  /** Bind and set the compose pass: the developed frame (`margin` pixels around the output) with
   * the grain's change added; the caller draws `composeP` to the screen or a target. */
  compose(shown: Target, margin: number, delta: Target | null, amount: { soft: number; grain: number }, split: number, w: number, h: number) {
    const g = this.g;
    g.bind(0, shown.tex);
    g.bind(1, delta?.tex ?? g.blackTexture);
    this.composeP.set({ uShown: 0, uMargin: margin, uSize: [w, h], uDelta: 1, uDeltaOn: delta ? 1 : 0, uSoft: amount.soft, uGrain: amount.grain, uSplit: split });
  }

  private freeFilm() {
    if (this.filmT) this.g.free(this.filmT);
    for (const t of this.pyramid) this.g.gl.deleteTexture(t);
    this.filmT = null;
    this.pyramid = [];
    this.filmMade = null;
  }

  free() {
    for (const t of [this.grid, this.mid, this.meanMid]) if (t) this.g.free(t);
    this.meanMid = null;
    for (const t of [this.weights, this.lut]) if (t) this.g.gl.deleteTexture(t);
    this.grid = this.mid = null;
    this.weights = this.lut = null;
    this.filterKey = '';
    this.freeFilm();
  }
}

/** A float texture of w × h, uploaded (made before any binding: Gpu.scratch first). */
function upload(gl: WebGL2RenderingContext, tex: WebGLTexture, w: number, h: number, data: Float32Array) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, data);
  for (const q of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, q, gl.NEAREST);
}

/** A target of 16-bit unsigned levels (the baked film's thresholds), read with texelFetch. */
function levelTarget(g: Gpu, side: number): Target {
  const gl = g.gl, tex = gl.createTexture()!;
  g.scratch();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, side, side, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, null);
  for (const q of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, q, gl.NEAREST);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) { gl.deleteTexture(tex); gl.deleteFramebuffer(fbo); throw new GpuError(`Could not create a ${side}x${side} R16UI target for the film`); }
  return { tex, fbo, w: side, h: side, hdr: false };
}

/** One level of the integrated film: n × n blocks, a layer per knot, their covered shares. */
function shareArray(g: Gpu, n: number): WebGLTexture {
  const gl = g.gl, tex = gl.createTexture()!;
  g.scratch();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R16F, n, n, PYRAMID_KNOTS, 0, gl.RED, gl.HALF_FLOAT, null);
  for (const q of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, q, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  return tex;
}

/**
 * The filter along x for packed grid rows: for each column d (-M to M) from an output column, the
 * taps (filterTaps) of the points set in its low and high byte, summed for each byte value (rows
 * 2 (d + M) and 2 (d + M) + 1, 256 wide).
 */
export function filterLut(k: number, taps: { lo: number; w: Float32Array }, M: number): Float32Array {
  const weight = (q: number) => (q < taps.lo || q >= taps.lo + taps.w.length ? 0 : taps.w[q - taps.lo]);
  const out = new Float32Array(256 * 2 * (2 * M + 1));
  for (let d = -M; d <= M; d++) for (let b = 0; b < 2; b++) for (let v = 0; v < 256; v++) {
    let sum = 0;
    for (let bit = 0; bit < 8; bit++) if (v & (1 << bit)) { const i = b * 8 + bit; if (i < k) sum += weight(d * k + i); }
    out[(2 * (d + M) + b) * 256 + v] = sum;
  }
  return out;
}
