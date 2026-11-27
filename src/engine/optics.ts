// Copyright (C) 2026 darktable developers.
// Ported from darktable src/common/spektra_core.c (diffusion plan and its four filter
// families, and halation bounce mix) at c96cf1d0de8fff468e9eddee28621e91f83bdf1a. Halation's still/weak preset (v3),
// and the saved still/strong preset (v2), are from
// spektrafilm runtime/params_builder.py at 3bb2c2d2801ff68b92019cf1dbcbb133d60832bc.
// Film modeling powered by spektrafilm, GPLv3, © Andrea Volpato.
// Approved deviations (Oli, 2026-11-10): working RGB instead of spectral film exposures;
// Gaussian pyramid instead of the upstream full-resolution FIR/recursive blur.
// The upstream profiles, strength curve, bounce weights and normalization are unchanged.
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Vec3 } from '../film/stocks';

/** A virtual 35mm frame, measured along its long edge, as in darktable's default. */
export const FRAME_UM = 36000;
export interface OpticsComponent { sigma: number; weight: Vec3 }

/** darktable's four diffusion filters, in its menu order (dt_iop_spektrafilm_diffusion_family_t). */
export const GLOW_FILTERS = ['black-pro-mist', 'glimmerglass', 'pro-mist', 'cinebloom'] as const;
export type GlowFilter = typeof GLOW_FILTERS[number];
export const isGlowFilter = (v: unknown): v is GlowFilter => GLOW_FILTERS.includes(v as GlowFilter);

/** One group of radial exponentials: centre λ (µm), spread, count, bloom's power-law α (0: uniform). */
type DiffGroup = [lambda: number, spread: number, n: number, alpha: number];
interface DiffFamily { core: DiffGroup; halo: DiffGroup; bloom: DiffGroup; weights: Vec3; gain: number; warmth: number }

/** darktable spektra_core.c's SF_FAMILY_* (from spektrafilm's _DIFFUSION_FILTER_SHAPES), unchanged. */
export const DIFFUSION_FAMILIES: Record<GlowFilter, DiffFamily> = {
  'black-pro-mist': { core: [16, 1.5, 2, 0], halo: [95, 2, 3, 0], bloom: [380, 2.5, 4, 3.5], weights: [.40, .47, .13], gain: .75, warmth: .65 },
  glimmerglass: { core: [10, 1.5, 2, 0], halo: [50, 2, 3, 0], bloom: [260, 2.5, 4, 3.2], weights: [.60, .30, .10], gain: .65, warmth: 0 },
  'pro-mist': { core: [14, 1.5, 2, 0], halo: [150, 2, 3, 0], bloom: [650, 2.5, 4, 2.9], weights: [.28, .42, .30], gain: 1.05, warmth: .40 },
  cinebloom: { core: [20, 1.5, 2, 0], halo: [200, 2, 3, 0], bloom: [1000, 2.5, 4, 2.5], weights: [.22, .30, .48], gain: 1, warmth: .85 },
};

/** sf_diff_expand: a group's radii and weights, summing to 1. */
function expand([lambda, spread, count, alpha]: DiffGroup, bloom: boolean) {
  const n = Math.min(4, Math.max(1, count));
  if (n === 1 || spread <= 1) return { radii: [lambda], weights: [1] };
  const lo = Math.log(lambda / spread), hi = Math.log(lambda * spread);
  const radii = Array.from({ length: n }, (_, k) => Math.exp(lo + (hi - lo) * k / (n - 1)));
  const raw = radii.map(r => bloom ? r ** (2 - alpha) : 1);
  const total = raw.reduce((a, b) => a + b, 0);
  return { radii, weights: raw.map(w => w / total) };
}

/** sf_diff_halo_warmth: the halo's per-channel weights after the energy-conserving redistribution. */
function haloWarmth(weights: number[], warmth: number): number[][] {
  const n = weights.length;
  if (n < 2) return [0, 1, 2].map(() => weights);
  warmth = Math.min(1.5, Math.max(-1.5, warmth));
  const tt = weights.reduce((a, b) => a + b, 0);
  const g0 = weights.map((_, k) => -1 + 2 * k / (n - 1));
  const mean = weights.reduce((s, w, k) => s + w * g0[k], 0) / tt;
  const g = g0.map(v => v - mean);
  return [1.30, .15, -1.45].map(axis => {
    const raw = weights.map((w, k) => Math.max(0, w * (1 + warmth * axis * g[k])));
    const s = raw.reduce((a, b) => a + b, 0);
    return raw.map((r, k) => s > 0 ? r * (tt / s) : weights[k]);
  });
}

/** sf_diffusion_build_plan's bank: core, halo, bloom, each exponential as a Gaussian of σ = λ√3. */
export function diffusionBank(filter: GlowFilter = 'black-pro-mist'): OpticsComponent[] {
  const f = DIFFUSION_FAMILIES[filter];
  const core = expand(f.core, false), halo = expand(f.halo, false), bloom = expand(f.bloom, true);
  const warm = haloWarmth(halo.weights, f.warmth);
  const L2 = 1.7320508075688772;
  const flat = (w: number): Vec3 => [w, w, w].map(Math.fround) as Vec3;
  return [
    ...core.radii.map((r, k) => ({ sigma: Math.fround(r * L2), weight: flat(f.weights[0] * core.weights[k]) })),
    ...halo.radii.map((r, k) => ({ sigma: Math.fround(r * L2), weight: [0, 1, 2].map(c => Math.fround(f.weights[1] * warm[c][k])) as Vec3 })),
    ...bloom.radii.map((r, k) => ({ sigma: Math.fround(r * L2), weight: flat(f.weights[2] * bloom.weights[k]) })),
  ];
}

export const DIFFUSION_BANK = diffusionBank();
export const DIFFUSION_BANKS = Object.fromEntries(GLOW_FILTERS.map(f => [f, diffusionBank(f)])) as Record<GlowFilter, OpticsComponent[]>;
export const HALATION_BANK: OpticsComponent[] = [1, 2, 3].map((bounce, k) => ({
  sigma: 65 * Math.sqrt(bounce),
  weight: Array(3).fill((.5 ** k) / 1.75) as Vec3,
}));

/** Slider 0–100 maps to darktable's 0–2 diffusion strength, through the filter's gain (sf_diff_strength_to_ps). */
export function diffusionFraction(amount: number, filter: GlowFilter = 'black-pro-mist'): number {
  const strength = amount / 50;
  if (strength <= 0) return 0;
  const breaks = [.125, .25, .5, 1, 2], fractions = [.10, .20, .35, .55, .75];
  let base = fractions[4];
  if (strength <= breaks[0]) base = fractions[0] * strength / breaks[0];
  else for (let i = 1; i < breaks.length; i++) {
    if (strength <= breaks[i]) {
      const t = Math.log2(strength / breaks[i - 1]);
      base = fractions[i - 1] + t * (fractions[i] - fractions[i - 1]);
      break;
    }
  }
  return Math.fround(Math.min(.99, Math.max(0, base * DIFFUSION_FAMILIES[filter].gain)));
}

/** Slider 0–100 maps to upstream's 0–8 multiplier; v2 keeps saved still/strong edits. */
export const halationStrength = (amount: number, version: 2 | 3 = 3): Vec3 =>
  (version === 2 ? [.015, .005, 0] : [.08, .02, 0]).map(a => a * amount * .08) as Vec3;
export const halationMix = (rgb: Vec3, blur: Vec3, amount: number, version: 2 | 3 = 3): Vec3 => {
  const a = halationStrength(amount, version);
  return rgb.map((x, c) => (x + a[c] * blur[c]) / (1 + a[c])) as Vec3;
};
export const diffusionMix = (rgb: Vec3, blur: Vec3, amount: number, filter: GlowFilter = 'black-pro-mist'): Vec3 => {
  const p = diffusionFraction(amount, filter);
  return rgb.map((x, c) => (1 - p) * x + p * blur[c]) as Vec3;
};

/**
 * A mask's Glow: a second diffusion instance, after the photo's optics, on its own input and
 * with its own blurred field, blended in by the mask's value as darktable's normal blend.
 */
export const maskedDiffusionMix = (rgb: Vec3, blur: Vec3, amount: number, mask: number, filter: GlowFilter = 'black-pro-mist'): Vec3 => {
  const mixed = diffusionMix(rgb, blur, amount, filter);
  return rgb.map((x, c) => x + mask * (mixed[c] - x)) as Vec3;
};

/** Approved pyramid renderer: keep the smallest components at the source's density. */
export function componentPlan(sigma: number, width: number, height: number) {
  let level = 0;
  while (sigma / 2 >= 3 && Math.max(width, height) >= 4) {
    sigma /= 2; width = Math.ceil(width / 2); height = Math.ceil(height / 2); level++;
  }
  // Account for the box downsampling and bilinear reconstruction's variance.
  if (level) sigma = Math.sqrt(Math.max(.09, sigma * sigma - (3 - 1 / 4 ** level) / 12));
  const radius = sigma < .3 ? 0 : Math.floor(3 * sigma + .5);
  const weights = Array.from({ length: radius + 1 }, (_, k) => radius ? Math.exp(-.5 * (k / sigma) ** 2) : 1);
  const sum = weights[0] + 2 * weights.slice(1).reduce((a, b) => a + b, 0);
  return { level, width, height, weights: weights.map(w => w / sum), radius };
}
