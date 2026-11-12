// Copyright (C) 2026 darktable developers.
// Scalar RAW strength blend from restore_raw_linear.c at
// 0c67b465033205c46735c5a194f2b23d55e68363; GLSL twin: noise.frag.glsl.
// SPDX-License-Identifier: GPL-3.0-or-later
export interface NoiseReduction { enabled: boolean; amount: number; model: 'rawnind-linear-v1' }
/** Turning it on starts at full strength. Saved edits keep their own amount. */
export const NOISE_DEFAULTS: NoiseReduction = { enabled: false, amount: 100, model: 'rawnind-linear-v1' };
export function normalizeNoiseReduction(value: unknown): NoiseReduction | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<NoiseReduction>;
  return { enabled: v.enabled === true, amount: typeof v.amount === 'number' && Number.isFinite(v.amount) ? Math.min(100, Math.max(0, v.amount)) : 50, model: 'rawnind-linear-v1' };
}
export const noiseEnabled = (recipe: { noiseReduction?: NoiseReduction | null } | null | undefined) => recipe?.noiseReduction?.enabled === true;
export const noiseBlend = (original: number, denoised: number, amount: number) => original * (1 - amount / 100) + denoised * amount / 100;

/**
 * denoise (profiled), darktable's wavelets mode (engine/denoiseprofile.ts). Stacks after the AI
 * pass when both are on. Strength is darktable's; Luma and Chroma are the flat Y0 and U0V0 force
 * curves (50 = upstream's default 0.5).
 */
export interface ProfiledDenoise {
  enabled: boolean; strength: number; luma: number; chroma: number;
  /** darktable's "preserve shadows" (0 to 1.8) and "bias correction"; absent = inferred from the profile. */
  shadows?: number; bias?: number;
}
export const PROFILED_DEFAULTS: ProfiledDenoise = { enabled: false, strength: 1, luma: 50, chroma: 50 };
/** denoiseprofile.c init_presets "wavelets: chroma only": strength 1.2, Y0 force 0, no VST shadows or bias. */
export const CHROMA_ONLY: ProfiledDenoise = { enabled: true, strength: 1.2, luma: 0, chroma: 50, shadows: 0, bias: 0 };
const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
/**
 * The recipe's value: an explicit setting, null (off), or 'auto', the photo kind's default: a RAW
 * starts with darktable's chroma-only preset (colour noise removed, as Lightroom and Capture One
 * start with colour noise reduction on); other images start with it off. Recipes saved before it
 * existed have no field and load as null, so they render as they did.
 */
export type ProfiledSetting = ProfiledDenoise | 'auto' | null;
export const RAW_PROFILED_DEFAULT = CHROMA_ONLY;
/** Both sliders at 0: what the panel shows for "off". */
export const PROFILED_OFF: ProfiledDenoise = { ...CHROMA_ONLY, enabled: false, chroma: 0 };

export function normalizeProfiledDenoise(value: unknown): ProfiledSetting {
  if (value === 'auto') return 'auto';
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<ProfiledDenoise>;
  const out: ProfiledDenoise = { enabled: v.enabled === true, strength: num(v.strength, 0, 4, 1), luma: num(v.luma, 0, 100, 50), chroma: num(v.chroma, 0, 100, 50) };
  if (typeof v.shadows === 'number' && Number.isFinite(v.shadows)) out.shadows = num(v.shadows, 0, 1.8, 0);
  if (typeof v.bias === 'number' && Number.isFinite(v.bias)) out.bias = num(v.bias, -1000, 100, 0);
  return out;
}

/** The settings that apply to this photo; null when off. A missing recipe is an unedited photo ('auto'). */
export function effectiveProfiled(recipe: { profiledDenoise?: ProfiledSetting } | null | undefined, raw: boolean): ProfiledDenoise | null {
  const d = recipe ? recipe.profiledDenoise : 'auto';
  if (d === 'auto') return raw ? RAW_PROFILED_DEFAULT : null;
  return d ?? null;
}

/** On, and doing something: strength above 0 and either force above 0. */
export const profiledEnabled = (d: ProfiledDenoise | null | undefined): d is ProfiledDenoise =>
  !!d && d.enabled && d.strength > 0 && (d.luma > 0 || d.chroma > 0);
