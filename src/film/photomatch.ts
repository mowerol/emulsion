// SPDX-License-Identifier: GPL-3.0-or-later
// Experimental reference-photo fitting, approved by Oli on 2026-11-04. Tone
// quantiles, per-hue chroma, neutral-axis tint and circular hue-profile alignment
// are baked into a display-sRGB LUT. These are Emulsion's fitting heuristics, not
// a faithful port of Reinhard or darktable's color mapping. Colour conversions
// and monotone interpolation reuse the existing credited darktable ports.
import type { Clut } from '../engine/lut3d';
import { REC2020_TO_SRGB, SRGB_TO_REC2020, mulVec, srgbEotf, srgbOetf } from '../engine/color';
import { REC2020_TO_XYZ, XYZ_TO_REC2020, xyYToUcsJCH, xyYToXyz, xyzToXyY, ucsJCHToXyY } from '../engine/colorbalance';
import { sampleCurve, type CurvePoint } from './curve';
import { matchAnalysisImage } from './photomatch-sampling';

export interface MatchImage { width: number; height: number; data: ArrayLike<number> }
export const MATCH_ANALYSIS_EDGE = 192;
export interface MatchOptions {
  keepExposure?: boolean;
  /** Disable only hue alignment to compare with the original LUT fitter. */
  matchHue?: boolean;
  level?: number;
  sampleSide?: number;
}
export interface MatchReport {
  tone: CurvePoint[];
  chroma: number;
  /** Per-hue chroma ratios. */
  hues: number[];
  /** Per-hue angular offsets, radians. */
  hueShifts: number[];
  casts: [number, number][];
  samples: [number, number];
}
export interface PhotoMatch { lut: Clut; report: MatchReport }
interface Sample { j: number; c: number; h: number; a: number; b: number }
const TAU = Math.PI * 2, HUE_BINS = 12;
const QUANTILES = [.005, .02, .08, .2, .35, .5, .65, .8, .92, .98, .995];
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const clamp01 = (value: number) => clamp(value, 0, 1);
const wrap = (hue: number) => ((hue % TAU) + TAU) % TAU;
const angle = (hue: number) => Math.atan2(Math.sin(hue), Math.cos(hue));
function quantile(sorted: Float64Array, q: number): number {
  const pos = clamp01(q) * (sorted.length - 1), i = Math.floor(pos), f = pos - i;
  return i + 1 < sorted.length ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i];
}
const sortedOf = (samples: Sample[], pick: (sample: Sample) => number) => Float64Array.from(samples, pick).sort();

export function srgbToUcs(r: number, g: number, b: number): [number, number, number] {
  const lin = mulVec(SRGB_TO_REC2020, [srgbEotf(r), srgbEotf(g), srgbEotf(b)]);
  return xyYToUcsJCH(xyzToXyY(mulVec(REC2020_TO_XYZ, lin)), 1);
}
export function ucsToSrgb(j: number, c: number, h: number): [number, number, number] {
  const xyz = xyYToXyz(ucsJCHToXyY([j, c, h], 1));
  const rgb = mulVec(REC2020_TO_SRGB, mulVec(XYZ_TO_REC2020, xyz));
  return [srgbOetf(rgb[0]), srgbOetf(rgb[1]), srgbOetf(rgb[2])];
}
function samplesOf(input: MatchImage, maxSide: number): Sample[] {
  const image = matchAnalysisImage(input);
  const step = Math.max(1, Math.ceil(Math.max(image.width, image.height) / maxSide));
  const samples: Sample[] = [];
  for (let y = 0; y < image.height; y += step) for (let x = 0; x < image.width; x += step) {
    const i = (y * image.width + x) * 4;
    if (image.data[i + 3] < 128) continue;
    const [j, c, h] = srgbToUcs(image.data[i] / 255, image.data[i + 1] / 255, image.data[i + 2] / 255);
    if ([j, c, h].every(Number.isFinite)) samples.push({ j, c, h, a: c * Math.cos(h), b: c * Math.sin(h) });
  }
  return samples;
}
function tonePoints(target: Sample[], reference: Sample[], keepExposure: boolean): CurvePoint[] {
  const t = sortedOf(target, s => s.j), r = sortedOf(reference, s => s.j);
  const offset = keepExposure ? quantile(t, .5) - quantile(r, .5) : 0;
  const groups: { x: number; sum: number; count: number }[] = [];
  for (const q of QUANTILES) {
    const x = clamp01(quantile(t, q)), y = clamp01(quantile(r, q) + offset);
    const previous = groups[groups.length - 1];
    if (previous && x - previous.x < 1e-5) { previous.sum += y; previous.count++; }
    else groups.push({ x, sum: y, count: 1 });
  }
  const points: CurvePoint[] = groups.map(g => [g.x, g.sum / g.count]);
  if (points.length < 2) return [[0, 0], [1, 1]];
  const first = points[0], second = points[1], a = points[points.length - 2], b = points[points.length - 1];
  const startSlope = (second[1] - first[1]) / (second[0] - first[0]);
  const endSlope = (b[1] - a[1]) / (b[0] - a[0]);
  if (first[0] > 0) points.unshift([0, clamp01(first[1] - startSlope * first[0])]);
  if (b[0] < 1) points.push([1, clamp01(b[1] + endSlope * (1 - b[0]))]);
  return points;
}
function neutralCast(samples: Sample[], lo: number, hi: number): [number, number] | null {
  const band = samples.filter(s => s.j >= lo && s.j < hi);
  if (band.length < 40) return null;
  band.sort((a, b) => a.c - b.c);
  const take = Math.max(1, Math.floor(band.length * .25));
  let a = 0, b = 0;
  for (let i = 0; i < take; i++) { a += band[i].a; b += band[i].b; }
  return [a / take, b / take];
}
function castsOf(target: Sample[], reference: Sample[]): [number, number][] {
  const fallbackT = neutralCast(target, 0, 1.01) ?? [0, 0];
  const fallbackR = neutralCast(reference, 0, 1.01) ?? [0, 0];
  return [[0, .34], [.34, .67], [.67, 1.01]].map(([lo, hi]) => {
    const t = neutralCast(target, lo, hi) ?? fallbackT, r = neutralCast(reference, lo, hi) ?? fallbackR;
    return [r[0] - t[0], r[1] - t[1]];
  });
}
function chromaRatio(target: Sample[], reference: Sample[]): number {
  const t = quantile(sortedOf(target, s => s.c), .75), r = quantile(sortedOf(reference, s => s.c), .75);
  return t < 1e-4 && r < 1e-4 ? 1 : clamp(r / Math.max(t, .01), 0, 2.5);
}
function hueScalesOf(target: Sample[], reference: Sample[]): number[] {
  const sums = (samples: Sample[]) => {
    const sum = Array<number>(HUE_BINS).fill(0), count = Array<number>(HUE_BINS).fill(0);
    for (const s of samples) {
      if (s.c < .008 || s.j < .03) continue;
      const bin = Math.min(HUE_BINS - 1, Math.floor(wrap(s.h) / TAU * HUE_BINS));
      sum[bin] += s.c; count[bin]++;
    }
    return { sum, count };
  };
  const t = sums(target), r = sums(reference), raw = Array<number>(HUE_BINS).fill(chromaRatio(target, reference));
  for (let i = 0; i < HUE_BINS; i++) {
    if (t.count[i] < target.length * .01 || r.count[i] < reference.length * .01) continue;
    const mean = t.sum[i] / t.count[i];
    if (mean >= .004) raw[i] = clamp((r.sum[i] / r.count[i]) / mean, .4, 2.5);
  }
  return raw.map((v, i) => (raw[(i + HUE_BINS - 1) % HUE_BINS] + 2 * v + raw[(i + 1) % HUE_BINS]) / 4);
}
/** Smooth circular hue-histogram alignment, bounded to neighbouring colour families.
 * Local normalized correlation ignores differences in a colour's scene coverage.
 * Unsupported/ambiguous matches stay at zero; circular interpolation has no red seam.
 */
function hueShiftsOf(target: Sample[], reference: Sample[]): number[] {
  const bins = 72, maxShift = Math.PI / 4;
  const histogram = (samples: Sample[]) => {
    const hist = Array<number>(bins).fill(0);
    for (const s of samples) if (s.c >= .008 && s.j >= .03 && s.j <= .97) {
      const pos = wrap(s.h) / TAU * bins, index = Math.floor(pos), f = pos - index;
      hist[index % bins] += 1 - f; hist[(index + 1) % bins] += f;
    }
    return hist.map((value, i) => (hist[(i + bins - 1) % bins] + 2 * value + hist[(i + 1) % bins]) / 4);
  };
  const t = histogram(target), r = histogram(reference);
  const read = (hist: number[], pos: number) => {
    const index = Math.floor(pos), f = pos - index;
    return hist[((index % bins) + bins) % bins] * (1 - f) + hist[(((index + 1) % bins) + bins) % bins] * f;
  };
  const raw = Array<number>(HUE_BINS).fill(0);
  for (let i = 0; i < HUE_BINS; i++) {
    const centre = (i + .5) * TAU / HUE_BINS;
    const weights = t.map((_, bin) => Math.max(0, 1 - Math.abs(angle(bin * TAU / bins - centre)) / maxShift));
    if (t.reduce((sum, value, bin) => sum + value * weights[bin], 0) < target.length * .01) continue;
    const correlation = (shift: number) => {
      let dot = 0, tt = 0, rr = 0, mass = 0;
      for (let bin = 0; bin < bins; bin++) {
        const weight = weights[bin], a = t[bin], b = read(r, bin + shift / TAU * bins);
        dot += weight * a * b; tt += weight * a * a; rr += weight * b * b; mass += weight * b;
      }
      return mass < reference.length * .01 || tt * rr < 1e-12 ? 0 : dot / Math.sqrt(tt * rr);
    };
    const original = correlation(0);
    let best = original, picked = 0, confidence = original;
    for (let degrees = -45; degrees <= 45; degrees++) {
      const shift = degrees * Math.PI / 180, score = correlation(shift), regularized = score - .05 * (shift / maxShift) ** 2;
      if (regularized > best) { best = regularized; picked = shift; confidence = score; }
    }
    if (confidence >= .8 && confidence - original >= .1) raw[i] = picked;
  }
  const smoothed = raw.map((v, i) => (raw[(i + HUE_BINS - 1) % HUE_BINS] + 2 * v + raw[(i + 1) % HUE_BINS]) / 4);
  // Keep neighbouring hues in order: h + shift(h) must not fold backwards when
  // two local palette matches ask for rotations in opposite directions.
  const limit = .75 * TAU / HUE_BINS;
  for (let pass = 0; pass < 64; pass++) {
    let changed = false;
    for (let i = 0; i < HUE_BINS; i++) {
      const next = (i + 1) % HUE_BINS, difference = smoothed[next] - smoothed[i];
      if (Math.abs(difference) <= limit + 1e-10) continue;
      const excess = (Math.abs(difference) - limit) / 2 * Math.sign(difference);
      smoothed[i] += excess; smoothed[next] -= excess; changed = true;
    }
    if (!changed) break;
  }
  return smoothed;
}
function hueAt(values: number[], hue: number): number {
  const pos = wrap(hue) / TAU * HUE_BINS - .5, index = Math.floor(pos), f = pos - index;
  const at = (i: number) => values[((i % HUE_BINS) + HUE_BINS) % HUE_BINS];
  return at(index) * (1 - f) + at(index + 1) * f;
}
function castAt(casts: [number, number][], j: number): [number, number] {
  if (j <= .34) return casts[0];
  const index = j <= .67 ? 0 : 1, start = index === 0 ? .34 : .67, end = index === 0 ? .67 : 1;
  const f = clamp01((j - start) / (end - start));
  return [casts[index][0] * (1 - f) + casts[index + 1][0] * f, casts[index][1] * (1 - f) + casts[index + 1][1] * f];
}
function toGamut(j: number, c: number, h: number): [number, number, number] {
  const inside = (scale: number) => ucsToSrgb(j, c * scale, h).every(v => v >= -1e-4 && v <= 1 + 1e-4);
  if (inside(1)) return ucsToSrgb(j, c, h).map(clamp01) as [number, number, number];
  let lo = 0, hi = 1;
  for (let i = 0; i < 10; i++) { const mid = (lo + hi) / 2; if (inside(mid)) lo = mid; else hi = mid; }
  return ucsToSrgb(j, c * lo, h).map(clamp01) as [number, number, number];
}
export function matchPhotoLook(target: MatchImage, reference: MatchImage, options: MatchOptions = {}): PhotoMatch {
  const level = clamp(Math.round(options.level ?? 33), 2, 65), side = Math.max(64, Math.round(options.sampleSide ?? 256));
  const t = samplesOf(target, side), r = samplesOf(reference, side);
  if (!t.length || !r.length) throw Error('A photo match needs pixels from both images');
  const tj = sortedOf(t, s => s.j), rj = sortedOf(r, s => s.j);
  const flat = quantile(tj, 1) - quantile(tj, 0) < 1e-4 || quantile(rj, 1) - quantile(rj, 0) < 1e-4;
  const tone: CurvePoint[] = flat ? [[0, 0], [1, 1]] : tonePoints(t, r, options.keepExposure === true);
  const table = sampleCurve(tone, 256);
  const toneAt = (j: number) => {
    const pos = clamp01(j) * (table.length - 1), index = Math.min(table.length - 2, Math.floor(pos)), f = pos - index;
    return table[index] * (1 - f) + table[index + 1] * f;
  };
  const casts = castsOf(t, r), hues = hueScalesOf(t, r), chroma = chromaRatio(t, r);
  // Fit only the residual hue difference: the base tint/chroma mapping already
  // rotates some colours, so aligning the untouched input would count it twice.
  const baseColour = (j: number, c: number, h: number): Sample => {
    const mappedJ = clamp01(toneAt(j)), scale = hueAt(hues, h), [ca, cb] = castAt(casts, mappedJ);
    const a = c * Math.cos(h) * scale + ca, b = c * Math.sin(h) * scale + cb;
    const mappedC = Math.hypot(a, b);
    return { j: mappedJ, c: mappedC, h: mappedC > 1e-9 ? Math.atan2(b, a) : h, a, b };
  };
  const hueShifts = options.matchHue === false ? Array<number>(HUE_BINS).fill(0)
    : hueShiftsOf(t.map(s => baseColour(s.j, s.c, s.h)), r);
  const data = new Float32Array(level ** 3 * 3);
  for (let b = 0; b < level; b++) for (let g = 0; g < level; g++) for (let ri = 0; ri < level; ri++) {
    const [j, c, h] = srgbToUcs(ri / (level - 1), g / (level - 1), b / (level - 1));
    const base = baseColour(j, c, h);
    // Keep the separately fitted neutral axis intact while blending hue transfer
    // into actual colours; a reference tint must not be rotated a second time.
    const colourWeight = clamp01((c - .004) / .008);
    const rgb = toGamut(base.j, base.c, base.h + colourWeight * hueAt(hueShifts, base.h));
    const out = (ri + g * level + b * level * level) * 3;
    data[out] = rgb[0]; data[out + 1] = rgb[1]; data[out + 2] = rgb[2];
  }
  return { lut: { level, data }, report: { tone, chroma, hues, hueShifts, casts, samples: [t.length, r.length] } };
}
