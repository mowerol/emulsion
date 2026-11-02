// Copyright (C) 2026 darktable developers.
// Scalar RAW strength blend from restore_raw_linear.c at
// 0c67b465033205c46735c5a194f2b23d55e68363; GLSL twin: noise.frag.glsl.
// SPDX-License-Identifier: GPL-3.0-or-later
export interface NoiseReduction { enabled: boolean; amount: number; model: 'rawnind-linear-v1' }
export const NOISE_DEFAULTS: NoiseReduction = { enabled: false, amount: 50, model: 'rawnind-linear-v1' };
export function normalizeNoiseReduction(value: unknown): NoiseReduction | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<NoiseReduction>;
  return { enabled: v.enabled === true, amount: typeof v.amount === 'number' && Number.isFinite(v.amount) ? Math.min(100, Math.max(0, v.amount)) : 50, model: 'rawnind-linear-v1' };
}
export const noiseEnabled = (recipe: { noiseReduction?: NoiseReduction | null } | null | undefined) => recipe?.noiseReduction?.enabled === true;
export const noiseBlend = (original: number, denoised: number, amount: number) => original * (1 - amount / 100) + denoised * amount / 100;
