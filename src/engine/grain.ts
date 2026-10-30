// SPDX-License-Identifier: GPL-3.0-or-later
// Film grain from the statistics of the Boolean grain model of A. Newson,
// N. Faraj, B. Galerne and J. Delon, "A Stochastic Film Grain Model for
// Resolution-Independent Rendering", Computer Graphics Forum 36(8), 2017.
// Implemented from the paper, not from its code.
//
// In the model, developed film is silver grains scattered by a Poisson process
// at the density that makes them cover a fraction u of the film, the tone.
// Rather than placing every grain, which takes hundreds of grains per pixel,
// Emulsion draws the number of grains N in each pixel's footprint directly:
// N is Poisson with mean m = -ln(1 - u) / k, where k is a grain's area over the
// footprint's, and the pixel shows 1 - (1 - k)^N. That keeps the model's mean
// (exactly u) and its variance, (1 - u)^(2 - k) - (1 - u)^2, at a fixed cost.
// Neighbouring pixels draw their counts from one smooth random field, so grain
// clumps rather than fizzes.
//
// What follows from it, as on film: where the film is thin (u small) the count
// is a few grains, so the texture is coarse and broken up; where it is dense
// the count is large and evens out into smooth tone; the fluctuation is
// largest in the midtones. Emulsion also makes grains larger in thin areas:
// the larger crystals are the more sensitive, so they are what develops with
// little light, and underexposed film clumps.
//
// Reference implementation of the grain stage (stages/grain.glsl), which uses
// the same noise and hash.

export interface GrainShape {
  /** Grain area over the pixel footprint's at mid tone; sets how strong grain is. */
  kappa: number;
  /** How much larger grains are in thin areas: k × (1 + clump (1 − u)²). */
  clump: number;
  /** Size of grain clumps in pixels at the output size. */
  size: number;
}

/** Tones are kept off 0 and 1, where the grain count would be zero or infinite. */
export const U_MIN = 0.0005;
export const U_MAX = 0.995;
/** Above this many grains the count is drawn from its normal approximation. */
export const NORMAL_ABOVE = 24;

export const kappaAt = (g: GrainShape, u: number) => Math.min(0.9, g.kappa * (1 + g.clump * (1 - u) ** 2));

/** Expected grains in a footprint at tone u. */
export const expectedGrains = (g: GrainShape, u: number) => -Math.log(1 - u) / kappaAt(g, u);

/** Standard normal CDF (Abramowitz and Stegun 26.2.17, error below 1e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/** Poisson count with mean m for a standard normal draw z: inverse CDF while small, normal approximation when large. */
export function grainCount(m: number, z: number): number {
  if (m > NORMAL_ABOVE) return Math.max(0, m + Math.sqrt(m) * z);
  const v = normalCdf(z);
  let p = Math.exp(-m);
  let s = p;
  let k = 0;
  while (v > s && k < 3 * NORMAL_ABOVE) {
    k++;
    p *= m / k;
    s += p;
  }
  return k;
}

/** The tone a pixel shows: tone u with grain, for a standard normal draw z. */
export function grainTone(u: number, z: number, g: GrainShape): number {
  const v = Math.min(U_MAX, Math.max(U_MIN, u));
  const k = kappaAt(g, v);
  return 1 - Math.exp(grainCount(-Math.log(1 - v) / k, z) * log1m(k));
}

/**
 * ln(1 - k), by series when k is tiny: at small output sizes a grain is a
 * minute share of a pixel, and 1 - k loses precision in 32-bit floats.
 */
export const log1m = (k: number) => (k < 1e-3 ? -k * (1 + k * (0.5 + k / 3)) : Math.log(1 - k));

// ---------- The random field, identical to the shader ----------

/** PCG-style 3D hash on 32-bit unsigned integers (Jarzynski and Olano, 2020). */
export function pcg3(x: number, y: number, z: number): [number, number, number] {
  let a = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  let b = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  let c = (Math.imul(z, 1664525) + 1013904223) >>> 0;
  a = (a + Math.imul(b, c)) >>> 0;
  b = (b + Math.imul(c, a)) >>> 0;
  c = (c + Math.imul(a, b)) >>> 0;
  a ^= a >>> 16;
  b ^= b >>> 16;
  c ^= c >>> 16;
  a = (a + Math.imul(b, c)) >>> 0;
  b = (b + Math.imul(c, a)) >>> 0;
  c = (c + Math.imul(a, b)) >>> 0;
  return [a, b, c];
}

const unit = (v: number) => (v >>> 8) / 16777216;

/** Lattice value in [-1, 1) at integer point (x, y) of layer `layer`. */
const lattice = (x: number, y: number, layer: number) => 2 * unit(pcg3(x >>> 0, y >>> 0, layer >>> 0)[0]) - 1;

/** Smooth value noise in [-1, 1] with a quintic fade. */
export function valueNoise(x: number, y: number, layer: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = lattice(ix, iy, layer);
  const b = lattice(ix + 1, iy, layer);
  const c = lattice(ix, iy + 1, layer);
  const d = lattice(ix + 1, iy + 1, layer);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Scale that brings the sum of four value noises to unit variance (measured, see grain.test.ts). */
export const FIELD_NORM = 1.106;

/**
 * A smooth, close to normal random field: four value noises on offset,
 * rotated lattices, so their sum loses the lattice's squareness and tends to
 * a normal distribution. `size` is the clump size in pixels.
 */
export function grainField(px: number, py: number, size: number, layer: number): number {
  const x = px / size;
  const y = py / size;
  let s = valueNoise(x, y, layer);
  s += valueNoise(0.8 * x - 0.6 * y + 17.3, 0.6 * x + 0.8 * y + 41.7, layer + 1);
  s += valueNoise(-0.6 * x + 0.8 * y + 83.1, -0.8 * x - 0.6 * y + 7.9, layer + 2);
  s += valueNoise(-0.8 * x - 0.6 * y + 29.5, 0.6 * x - 0.8 * y + 61.2, layer + 3);
  return s * FIELD_NORM;
}

/**
 * One display pixel through the stage (display-encoded RGB in [0, 1]): the
 * shader's stageGrain. Black and white uses one layer; colour draws each dye
 * layer's count from a mix of a shared and its own field.
 */
export function grainPixel(d: [number, number, number], px: number, py: number, g: GrainShape, amount: number, chroma: number, frameSeed: number): [number, number, number] {
  if (amount <= 0) return d;
  const seed = (Math.floor(frameSeed * 1000) * 64) >>> 0;
  const u = d.map((v) => Math.min(1, Math.max(0, v)));
  const common = grainField(px, py, g.size, seed);
  if (chroma <= 0) {
    const n = amount * (grainTone(u[1], common, g) - u[1]);
    return d.map((v) => v + n) as [number, number, number];
  }
  const norm = 1 / Math.sqrt((1 - chroma) ** 2 + chroma ** 2);
  return d.map((v, c) => {
    const own = grainField(px, py, g.size, seed + 16 * (c + 1));
    return v + amount * (grainTone(u[c], ((1 - chroma) * common + chroma * own) * norm, g) - u[c]);
  }) as [number, number, number];
}

// ---------- From the recipe ----------

/** Output long edge at which ISO 400 has grain area KAPPA_400 of a pixel's footprint. */
export const REFERENCE_EDGE = 2560;
export const KAPPA_400 = 0.005;

/** ISO presets in the grain menu. */
export const ISOS = [50, 100, 200, 400, 800, 1600, 3200] as const;

/**
 * Grain from the Size and Roughness sliders (percent) at an output long edge
 * in pixels. Size sets the clump size, relative to the frame so a preview and a
 * full-size export match. Roughness sets how few, and so how visible, the
 * grains in a footprint are, and how much more they clump in thin areas.
 * A pixel's footprint covers more film at smaller output sizes, so a grain is
 * a smaller share of it (kappa scales with pixel area) and grain averages out,
 * as when a scan is viewed smaller. At the reference size and ISO 400, the
 * midtones vary by about 0.03 (8 levels of 255) at full amount.
 * Pushing acts like faster film and clumps more in the shadows; pulling
 * (overexposed, less developed) gives finer grain, like slower film.
 */
export function grainShape(size: number, roughness: number, push: number, longEdge: number): GrainShape {
  const speed = 2 ** push;
  const r = Math.max(roughness, 0) / 100;
  return {
    kappa: Math.min(0.9, KAPPA_400 * (2 * r) ** 1.5 * speed ** 0.6 * (longEdge / REFERENCE_EDGE) ** 2) + 1e-5,
    clump: 2.4 * r + 0.6 * Math.max(push, 0),
    size: 1.4 * (size / 100) * speed ** 0.3 * (longEdge / 1600),
  };
}

/**
 * Size and Roughness for a film speed. Faster film has larger crystals: fewer
 * per footprint (rougher) in larger clumps. ISO 400 is 100% size, 50% roughness.
 */
export function isoPreset(iso: number): { size: number; roughness: number } {
  const r = iso / 400;
  return { size: Math.round(100 * r ** 0.3), roughness: Math.min(100, Math.round(50 * r ** 0.4)) };
}

/** The ISO preset these sliders match, if any. */
export const matchingIso = (size: number, roughness: number, isos: readonly number[]) =>
  isos.find((iso) => {
    const p = isoPreset(iso);
    return p.size === size && p.roughness === roughness;
  }) ?? null;
