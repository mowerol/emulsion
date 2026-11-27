// Copyright (C) 2017 Alasdair Newson, Noura Faraj, Bruno Galerne, Julie Delon.
// Ported from the reference implementation of "Realistic Film Grain Rendering", Image Processing
// On Line 7 (2017), pp. 165-183, https://www.ipol.im/pub/art/2017/192 (Film_grain_rendering_IPOL:
// src/film_grain_rendering.cpp render_pixel and film_grain_rendering_pixel_wise,
// src/pseudo_random_number_generator.cpp), licence GPL v3+. Method: Newson, Delon, Galerne,
// "A Stochastic Film Grain Model for Resolution-Independent Rendering", Computer Graphics Forum 2017.
// Emulsion renders the model with filmgrain.ts (the same grains and filter, the filter evaluated on a
// grid); this file is the reference's own Monte Carlo rendering, which filmgrain.test.ts checks it against.
// Changes: TypeScript, in doubles rounded to binary32 at the steps that place and test grains;
// the Poisson intensity is computed from the value directly rather than from its 256-entry table
// of 8-bit grey levels (the value is still clamped to the table's top, 255 / 255.1); the Monte
// Carlo filter offsets come from a seeded generator (the reference draws them from
// std::random_device, so differently on every run); positions are absolute pixels of the frame
// so a region renders the same grains as the whole.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Film grain from the Boolean model: an image value u in [0, 1] is the share of film covered by
// grains, discs of radius r (log-normal with deviation sigmaR, or all r) whose centres are a
// Poisson process of intensity -log(1 - u) / (pi E[R^2]). A pixel is the share of its area,
// weighted by a Gaussian of deviation sigmaFilter, that grains cover, measured by Monte Carlo:
// N points scattered around the pixel's centre, each tested against the grains of the cells
// around it. Each cell of side ag (about r) draws its grains from its own seed, so grains are
// fixed in the frame and any region or zoom renders the same film.

const f = Math.fround;
export const MAX_GREY = 255;
export const EPSILON_GREY = 0.1;
const NORMAL_QUANTILE = 3.0902;

export function wangHash(seed: number): number {
  let s = seed >>> 0;
  s = ((s ^ 61) ^ (s >>> 16)) >>> 0;
  s = Math.imul(s, 9) >>> 0;
  s = (s ^ (s >>> 4)) >>> 0;
  s = Math.imul(s, 668265261) >>> 0;
  s = (s ^ (s >>> 15)) >>> 0;
  return s;
}
export function cellSeed(x: number, y: number, offset: number): number {
  const period = 65536;
  const xm = ((x % period) + period) % period, ym = ((y % period) + period) % period;
  // unsigned arithmetic, as the reference (x and y are passed as unsigned ints)
  let s = (Math.imul(ym, period) + xm + offset) >>> 0;
  if (s === 0) s = 1;
  return s;
}
/** Marsaglia's xorshift, as myrand. */
export class Prng {
  state: number;
  constructor(seed: number) { this.state = wangHash(seed); }
  next(): number {
    let s = this.state;
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    this.state = s;
    return s;
  }
  uniform(): number { return f(this.next() / 4294967295); }
  gaussian(): number {
    const u = this.uniform(), v = this.uniform();
    return f(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
  }
  /** my_rand_poisson: inverse transform sampling. */
  poisson(lambda: number, expLambda: number): number {
    const u = this.uniform();
    let x = 0, prod = expLambda, sum = prod;
    const cap = Math.floor(10000 * lambda);
    while (u > sum && x < cap) {
      x++;
      prod = f(f(prod * lambda) / x);
      sum = f(sum + prod);
    }
    return x;
  }
}

export interface BoolGrainParams {
  /** Mean grain radius, in input pixels. The reference's default is 0.1. */
  radius: number;
  /** Deviation of the grain radius (log-normal), in input pixels; 0 for equal grains (the default). */
  sigmaR: number;
  /** Deviation of the Gaussian filter, in output pixels; 0.8 by default. */
  sigmaFilter: number;
  /** Monte Carlo samples per pixel; 800 by default. */
  samples: number;
  /** The grain seed (the reference's grainSeed). */
  seed: number;
}
export const BOOL_GRAIN_DEFAULTS: BoolGrainParams = { radius: 0.1, sigmaR: 0, sigmaFilter: 0.8, samples: 800, seed: 1 };

/** The Monte Carlo filter offsets, standard normal (scaled by sigmaFilter when used). */
export function filterOffsets(n: number, seed = 2016): Float32Array {
  const p = new Prng(seed);
  const out = new Float32Array(2 * n);
  for (let i = 0; i < 2 * n; i++) out[i] = p.gaussian();
  return out;
}

/** Cell side ag, the log-normal's mu and sigma, and the largest radius tested. */
export function grainGeometry(p: BoolGrainParams) {
  const ag = f(1 / Math.ceil(1 / p.radius));
  let mu = 0, sigma = 0, maxRadius = p.radius;
  if (p.sigmaR > 0) {
    sigma = f(Math.sqrt(Math.log((p.sigmaR / p.radius) ** 2 + 1)));
    mu = f(Math.log(p.radius) - (sigma * sigma) / 2);
    maxRadius = f(Math.exp(mu + sigma * NORMAL_QUANTILE));
  }
  return { ag, mu, sigma, maxRadius };
}

/** Poisson intensity per cell for value u (0 to 1). */
export function cellLambda(u: number, p: BoolGrainParams, ag: number): number {
  const uc = Math.min(Math.max(u, 0), MAX_GREY / (MAX_GREY + EPSILON_GREY));
  return f(-((ag * ag) / (Math.PI * (p.radius * p.radius + p.sigmaR * p.sigmaR))) * Math.log(1 - uc));
}

export interface GrainImage {
  /** Values 0 to 1, row major. */
  data: Float32Array;
  w: number;
  h: number;
  /** Absolute position of data's (0, 0) in the frame, in input pixels. */
  x0: number;
  y0: number;
}

/**
 * Whether the film point (xg, yg), in input pixels, lies in a grain: render_pixel's test of one
 * Monte Carlo point against the grains of every cell within reach of it. `valueAt` is the image
 * value the model reads for a cell, given the cell's corner (the reference reads the input pixel
 * the corner lies in).
 */
export function coveredAt(xg: number, yg: number, p: BoolGrainParams, geo: ReturnType<typeof grainGeometry>, valueAt: (x: number, y: number) => number, lambdaCache = new Map<number, [number, number]>()): boolean {
  const { ag, mu, sigma, maxRadius } = geo;
  const r2 = p.radius * p.radius;
  const minX = Math.floor((xg - maxRadius) / ag), maxX = Math.floor((xg + maxRadius) / ag);
  const minY = Math.floor((yg - maxRadius) / ag), maxY = Math.floor((yg + maxRadius) / ag);
  for (let cx = minX; cx <= maxX; cx++) {
    for (let cy = minY; cy <= maxY; cy++) {
      const cornerX = f(ag * cx), cornerY = f(ag * cy);
      const rng = new Prng(cellSeed(cx, cy, p.seed));
      const u = valueAt(cornerX, cornerY);
      let lam = lambdaCache.get(u);
      if (!lam) { const l = cellLambda(u, p, ag); lam = [l, f(Math.exp(-l))]; lambdaCache.set(u, lam); }
      const n = rng.poisson(lam[0], lam[1]);
      for (let k = 0; k < n; k++) {
        const gx = f(cornerX + f(ag * rng.uniform()));
        const gy = f(cornerY + f(ag * rng.uniform()));
        let rr = r2;
        if (p.sigmaR > 0) { const rad = Math.min(f(Math.exp(mu + sigma * rng.gaussian())), maxRadius); rr = f(rad * rad); }
        if (f(f((gx - xg) * (gx - xg)) + f((gy - yg) * (gy - yg))) < rr) return true;
      }
    }
  }
  return false;
}

/** The input pixel a cell's corner lies in, clamped to the image, as the reference reads it. */
export const pixelValue = (img: GrainImage) => (x: number, y: number) => {
  const ix = Math.min(Math.max(Math.floor(x) - img.x0, 0), img.w - 1);
  const iy = Math.min(Math.max(Math.floor(y) - img.y0, 0), img.h - 1);
  return img.data[iy * img.w + ix];
};

/**
 * render_pixel: the output pixel (xOut, yOut) of an output grid that maps `scale` output pixels to
 * each input pixel (the reference's zoom), in absolute output pixels. Values outside `img` clamp
 * to its edge.
 */
export function renderPixel(img: GrainImage, xOut: number, yOut: number, scale: number, p: BoolGrainParams, offsets: Float32Array): number {
  const geo = grainGeometry(p), valueAt = pixelValue(img), cache = new Map<number, [number, number]>();
  const xIn = f((xOut + 0.5) / scale), yIn = f((yOut + 0.5) / scale);
  let covered = 0;
  for (let i = 0; i < p.samples; i++) {
    const xg = f(xIn + (p.sigmaFilter * offsets[2 * i]) / scale);
    const yg = f(yIn + (p.sigmaFilter * offsets[2 * i + 1]) / scale);
    if (coveredAt(xg, yg, p, geo, valueAt, cache)) covered++;
  }
  return covered / p.samples;
}

/** film_grain_rendering_pixel_wise over a region of the output grid: w × h pixels from (x0, y0). */
export function renderRegion(img: GrainImage, x0: number, y0: number, w: number, h: number, scale: number, p: BoolGrainParams, offsets = filterOffsets(p.samples)): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = renderPixel(img, x0 + x, y0 + y, scale, p, offsets);
  return out;
}
