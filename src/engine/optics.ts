// Copyright (C) 2026 darktable developers.
// Ported from darktable src/common/spektra_core.c (diffusion plan and halation bounce mix)
// at c96cf1d0de8fff468e9eddee28621e91f83bdf1a. Halation's still/weak preset (v3),
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

/** Black Pro-Mist: core / halo / bloom, in upstream accumulation order. */
export function diffusionBank(): OpticsComponent[] {
  const bank: OpticsComponent[] = [];
  for (const [lambda, spread, n, alpha, amount] of [[16, 1.5, 2, 0, .40], [95, 2, 3, 0, .47], [380, 2.5, 4, 3.5, .13]]) {
    const lo = Math.log(lambda / spread), hi = Math.log(lambda * spread);
    const radii = Array.from({ length: n }, (_, k) => Math.exp(lo + (hi - lo) * k / (n - 1)));
    const weights = radii.map(r => alpha ? r ** (2 - alpha) : 1);
    const total = weights.reduce((a, b) => a + b, 0);
    // Upstream family warmth .65, axis [1.30, .15, -1.45], normalized per channel.
    const channels = [1.30, .15, -1.45].map(axis => {
      const raw = weights.map((w, k) => w / total * Math.max(0, 1 + .65 * axis * (-1 + 2 * k / (n - 1))));
      const sum = raw.reduce((a, b) => a + b, 0);
      return raw.map(w => w / sum);
    });
    radii.forEach((r, k) => bank.push({
      sigma: Math.fround(r * Math.sqrt(3)),
      weight: [0, 1, 2].map(c => Math.fround(amount * (lambda === 95 ? channels[c][k] : weights[k] / total))) as Vec3,
    }));
  }
  return bank;
}

export const DIFFUSION_BANK = diffusionBank();
export const HALATION_BANK: OpticsComponent[] = [1, 2, 3].map((bounce, k) => ({
  sigma: 65 * Math.sqrt(bounce),
  weight: Array(3).fill((.5 ** k) / 1.75) as Vec3,
}));

/** Slider 0–100 maps to darktable's 0–2 diffusion strength. */
export function diffusionFraction(amount: number): number {
  const strength = amount / 50;
  if (strength <= 0) return 0;
  const breaks = [.125, .25, .5, 1, 2], fractions = [.10, .20, .35, .55, .75];
  if (strength <= breaks[0]) return .75 * fractions[0] * strength / breaks[0];
  for (let i = 1; i < breaks.length; i++) {
    if (strength <= breaks[i]) {
      const t = Math.log2(strength / breaks[i - 1]);
      return Math.fround(.75 * (fractions[i - 1] + t * (fractions[i] - fractions[i - 1])));
    }
  }
  return .5625;
}

/** Slider 0–100 maps to upstream's 0–8 multiplier; v2 keeps saved still/strong edits. */
export const halationStrength = (amount: number, version: 2 | 3 = 3): Vec3 =>
  (version === 2 ? [.015, .005, 0] : [.08, .02, 0]).map(a => a * amount * .08) as Vec3;
export const halationMix = (rgb: Vec3, blur: Vec3, amount: number, version: 2 | 3 = 3): Vec3 => {
  const a = halationStrength(amount, version);
  return rgb.map((x, c) => (x + a[c] * blur[c]) / (1 + a[c])) as Vec3;
};
export const diffusionMix = (rgb: Vec3, blur: Vec3, amount: number): Vec3 => {
  const p = diffusionFraction(amount);
  return rgb.map((x, c) => (1 - p) * x + p * blur[c]) as Vec3;
};

/**
 * A mask's Glow: a second diffusion instance, after the photo's optics, on its own input and
 * with its own blurred field, blended in by the mask's value as darktable's normal blend.
 */
export const maskedDiffusionMix = (rgb: Vec3, blur: Vec3, amount: number, mask: number): Vec3 => {
  const mixed = diffusionMix(rgb, blur, amount);
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
