// SPDX-License-Identifier: GPL-3.0-or-later
// Image-adaptive tone controls. Analysis belongs to the whole, exposed photo, before tone
// adjustments; neither the viewport nor the controls themselves change that analysis.
import { toneForward } from './tone';
import { EXPOSURE_BOOST } from './toneequalizer';

export const TONE_KEYS = ['shadows', 'highlights', 'blacks', 'whites'] as const;
export type ToneKey = typeof TONE_KEYS[number];
export type ToneControls = Record<ToneKey, number>;
/** Missing = original units; Shadows 1 = normalized legacy extended lift; 2 = adaptive. */
export type ToneVersions = Partial<Record<ToneKey, 1 | 2>>;
export const ADAPTIVE_TONE: ToneVersions = { shadows: 2, highlights: 2, blacks: 2, whites: 2 };
export const TONE_CURVE_SIZE = 128;
export const TONE_EV_MIN = -16;
export const TONE_EV_MAX = 8;
const SCENE_GREY_EV = Math.log2(0.18 * Math.sqrt(3) * EXPOSURE_BOOST);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (lo: number, hi: number, x: number) => {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};

export function normalizeToneVersions(input: unknown): ToneVersions | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const source = input as Record<string, unknown>;
  const entries = TONE_KEYS.filter(k => source[k] === 2 || k === 'shadows' && source[k] === 1).map(k => [k, source[k]]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Transfer processing together with each selected value, leaving other controls alone. */
export function copyToneVersions(from: ToneVersions | undefined, to: ToneVersions | undefined, keys: readonly string[]): ToneVersions | undefined {
  const result = { ...to };
  for (const k of TONE_KEYS) if (keys.includes(k)) {
    if (from?.[k]) result[k] = from[k];
    else delete result[k];
  }
  return normalizeToneVersions(result);
}

/** Version 1 preserves legacy extended positive lift on the normalized -100..100 slider. */
export const legacyShadowValue = (value: number, versions?: ToneVersions) => versions?.shadows === 2 ? 0 : value > 0 && versions?.shadows === 1 ? value * 4 : value;

/** Robust log-brightness percentiles: black, shadow, highlight, white. */
export type ToneAnalysis = [number, number, number, number];
export const DEFAULT_TONE_ANALYSIS: ToneAnalysis = [-8, -5, -1, 1];

/** Samples use the tone equalizer's brightness measure, expressed in stops. */
export function analyzeTone(samples: ArrayLike<number>): ToneAnalysis {
  const values = Array.from(samples).filter(Number.isFinite).map(v => clamp(v, TONE_EV_MIN, TONE_EV_MAX)).sort((a, b) => a - b);
  if (!values.length) return [...DEFAULT_TONE_ANALYSIS];
  const percentile = (p: number) => {
    const x = p * (values.length - 1), i = Math.floor(x);
    return values[i] + (values[Math.min(i + 1, values.length - 1)] - values[i]) * (x - i);
  };
  // Minimum separations make flat, all-black and all-white images well-defined. These are
  // adjustment ranges, never an instruction to stretch the unedited image to fill them.
  // Relative percentiles alone classified most of a dark/backlit subject as midtones. Keep
  // the split within one stop of scene middle grey; zero still applies no correction at all.
  const pivot = clamp(percentile(0.5), SCENE_GREY_EV - 1, SCENE_GREY_EV + 1);
  const shadow = Math.min(percentile(0.2), pivot - 1);
  const highlight = Math.max(percentile(0.8), pivot + 1);
  return [Math.min(percentile(0.005), shadow - 1), shadow, highlight, Math.max(percentile(0.995), highlight + 1)];
}

/**
 * Fit a monotone log-lightness curve. Shadows/Highlights act over broad ranges; lowering Whites
 * concentrates on the bright tail. Isotonic regression prevents tonal reversals when strong,
 * overlapping adjustments compress the same range, retaining a minimum slope for detail.
 */
export function adaptiveToneCurve(analysis: ToneAnalysis, controls: ToneControls): number[] {
  const [, shadow, highlight, white] = analysis;
  if (controls.shadows === 0 && controls.highlights === 0 && controls.whites >= 0) return new Array<number>(TONE_CURVE_SIZE).fill(0);
  // Keep the adaptive transitions anchored to scene grey. A predominantly dark image must
  // not use up the entire Shadows transition below its still-dark foreground or shopfront.
  const shadowStart = clamp(shadow - 0.25, SCENE_GREY_EV - 3, SCENE_GREY_EV - 1);
  const shadowEnd = clamp(highlight, SCENE_GREY_EV, SCENE_GREY_EV + 1);
  const highlightStart = clamp(shadow, SCENE_GREY_EV - 1.5, SCENE_GREY_EV - 0.5);
  const highlightEnd = clamp(highlight + 1, SCENE_GREY_EV + 1, SCENE_GREY_EV + 3);
  const s = controls.shadows >= 0 ? 3.5 * Math.log1p(controls.shadows / 25) / Math.log(5) : 3 * controls.shadows / 100;
  const h = 3 * controls.highlights / 100;
  const w = 2 * Math.min(controls.whites, 0) / 100;
  const step = (TONE_EV_MAX - TONE_EV_MIN) / (TONE_CURVE_SIZE - 1);
  const minimumSlope = 0.15;
  const blocks: { start: number; end: number; sum: number; count: number }[] = [];
  const evs = Array.from({ length: TONE_CURVE_SIZE }, (_, i) => TONE_EV_MIN + i * step);
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    // Carry useful lift through the visible shadow/low-midtone range. Ending around the
    // median spent most of the advertised reach on near-black pixels in backlit photos.
    const delta = s * (1 - smooth(shadowStart, shadowEnd, e))
      + h * smooth(highlightStart, highlightEnd, e)
      + w * smooth(highlight, white + 1, e);
    blocks.push({ start: i, end: i, sum: (1 - minimumSlope) * e + delta, count: 1 });
    while (blocks.length > 1) {
      const a = blocks[blocks.length - 2], z = blocks[blocks.length - 1];
      if (a.sum / a.count <= z.sum / z.count) break;
      blocks.splice(-2, 2, { start: a.start, end: z.end, sum: a.sum + z.sum, count: a.count + z.count });
    }
  }
  const gains = new Array<number>(TONE_CURVE_SIZE);
  for (const block of blocks) for (let i = block.start; i <= block.end; i++) gains[i] = block.sum / block.count - (1 - minimumSlope) * evs[i];
  return gains;
}

/** The GPU's linearly interpolated exposure correction, for reference checks. */
export function adaptiveToneGain(brightness: number, curve: ArrayLike<number>): number {
  const p = clamp((Math.log2(Math.max(brightness, 2 ** TONE_EV_MIN)) - TONE_EV_MIN) / (TONE_EV_MAX - TONE_EV_MIN), 0, 1) * (TONE_CURVE_SIZE - 1);
  const i = Math.min(Math.floor(p), TONE_CURVE_SIZE - 2), t = p - i;
  return 2 ** (curve[i] + (curve[i + 1] - curve[i]) * t);
}

const BRIGHTNESS_SCALE = Math.sqrt(3) * EXPOSURE_BOOST;
export const TONE_PRINT_PIVOT = toneForward(0.18);

/** The black endpoint's brightness after the broad-range correction; negative offsets clip. */
export function adaptiveBlackBrightness(brightness: number, offset: number): number {
  return offset > 0 ? brightness + offset * Math.exp(-brightness / (4 * offset)) : Math.max(0, brightness + offset);
}

/** The white endpoint's print stretch, anchored on middle grey; clipping is deliberate. */
export const adaptiveWhiteValue = (value: number, stretch: number) => value + Math.max(0, value - TONE_PRINT_PIVOT) * (stretch - 1);

/** One transform for the GPU and the CPU reference, including the two true endpoint controls. */
export function adaptiveToneTransform(analysis: ToneAnalysis, controls: ToneControls) {
  const curve = adaptiveToneCurve(analysis, controls);
  const dark = 2 ** analysis[0];
  const blackAnchor = clamp(dark * adaptiveToneGain(dark, curve), 2 ** TONE_EV_MIN, 0.02);
  const black = blackAnchor * controls.blacks / 100 * (controls.blacks > 0 ? 3 : 1);
  const amount = clamp(controls.whites / 100, 0, 1);
  // Progressively bring the clipping point in from the robust white percentile, ignoring
  // isolated speculars. An enforced distance above grey keeps flat scenes well-behaved.
  const bright = 2 ** (analysis[3] - amount * (analysis[3] - analysis[2]) * 0.25);
  const endpoint = Math.max(TONE_PRINT_PIVOT + 0.15, toneForward(adaptiveBlackBrightness(bright * adaptiveToneGain(bright, curve), black) / BRIGHTNESS_SCALE));
  const white = 1 + amount * ((1 - TONE_PRINT_PIVOT) / (endpoint - TONE_PRINT_PIVOT) - 1);
  return { curve, black, white };
}
