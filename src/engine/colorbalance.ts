// Copyright (C) 2020-2026 darktable developers.
// Copyright (C) 2017-2023 darktable developers (colour space conversions).
// darktable Uniform Color Space 2022 © Aurélien Pierre.
// Ported from darktable src/iop/colorbalancergb.c, src/common/colorspaces_inline_conversions.h
// and src/common/darktable_ucs_22_helpers.h at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773
// (release 5.6.2). Translated from C to TypeScript: the whole module with the darktable UCS
// saturation formula (hue shift, chroma, vibrance, the four ways, luminance power, contrast,
// saturation and brilliance by tone, mask fall-offs, gamut mapping). The working space is D65
// Rec.2020, so darktable's D50 adaptation drops out, and negative output is clipped because later
// Emulsion stages expect non-negative light.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Reference implementation of the colour balance stage (stages/colorbalance.glsl).
// The shader does the per-pixel work; this file builds its gamut table and
// uniforms, and lets tests check the maths.

import type { Mat3, Vec3 } from '../film/stocks';
import { mulMat, mulVec } from './color';
import { TONE } from './tone';

/** Linear Rec.2020 to CIE 1931 XYZ, D65. */
export const REC2020_TO_XYZ: Mat3 = [
  [0.636958048301291, 0.144616903586208, 0.168880975164172],
  [0.262700212011267, 0.677998071518871, 0.059301716469862],
  [0.0, 0.028072693049087, 1.060985057710791],
];
export const XYZ_TO_REC2020: Mat3 = [
  [1.716651187971268, -0.355670783776392, -0.25336628137366],
  [-0.666684351832489, 1.616481236634939, 0.015768545813911],
  [0.017639857445311, -0.042770613257809, 0.942103121235474],
];

// CIE 1931 XYZ D65 to CIE 2006 LMS D65 (Kirk 2019), and back.
export const XYZ_TO_LMS: Mat3 = [
  [0.257085, 0.859943, -0.031061],
  [-0.394427, 1.1758, 0.106423],
  [0.064856, -0.07625, 0.559067],
];
export const LMS_TO_XYZ: Mat3 = [
  [1.80794659, -1.2997166, 0.34785879],
  [0.6178396, 0.39595453, -0.04104687],
  [-0.1254696, 0.20478038, 1.74274183],
];
// LMS to Filmlight grading RGB, and back.
export const LMS_TO_GRADING: Mat3 = [
  [1.0877193, -0.66666667, 0.02061856],
  [-0.0877193, 1.66666667, -0.05154639],
  [0, 0, 1.03092784],
];
export const GRADING_TO_LMS: Mat3 = [
  [0.95, 0.38, 0],
  [0.05, 0.62, 0.03],
  [0, 0, 0.97],
];

export const REC2020_TO_LMS = mulMat(XYZ_TO_LMS, REC2020_TO_XYZ);
export const LMS_TO_REC2020 = mulMat(XYZ_TO_REC2020, LMS_TO_XYZ);

const D65_R = 0.21902143;
const D65_G = 0.54371398;
const D65_XY = [0.31271, 0.32902];

// ---------- Filmlight Yrg and its polar form Ych (Y, chroma, cos h, sin h) ----------

export type Ych = [number, number, number, number];

export function lmsToYrg(lms: Vec3): Vec3 {
  const Y = 0.68990272 * lms[0] + 0.34832189 * lms[1];
  const a = lms[0] + lms[1] + lms[2];
  const n: Vec3 = a === 0 ? [0, 0, 0] : [lms[0] / a, lms[1] / a, lms[2] / a];
  const rgb = mulVec(LMS_TO_GRADING, n);
  return [Y, rgb[0], rgb[1]];
}

export function yrgToLms(yrg: Vec3): Vec3 {
  const [Y, r, g] = yrg;
  const lms = mulVec(GRADING_TO_LMS, [r, g, 1 - r - g]);
  const denom = 0.68990272 * lms[0] + 0.34832189 * lms[1];
  const a = denom === 0 ? 0 : Y / denom;
  return [lms[0] * a, lms[1] * a, lms[2] * a];
}

export function yrgToYch(yrg: Vec3): Ych {
  const r = yrg[1] - D65_R;
  const g = yrg[2] - D65_G;
  const c = Math.hypot(g, r);
  return [yrg[0], c, c !== 0 ? r / c : 1, c !== 0 ? g / c : 0];
}

export function ychToYrg(ych: Ych): Vec3 {
  return [ych[0], ych[1] * ych[2] + D65_R, ych[1] * ych[3] + D65_G];
}

/** Clip chroma at constant hue and luminance so the colour stays inside Yrg. */
export function gamutCheckYrg(ych: Ych): Ych {
  const yrg = ychToYrg(ych);
  let maxC = ych[1];
  const [, , cosH, sinH] = ych;
  if (yrg[1] < 0) maxC = Math.min(-D65_R / cosH, maxC);
  if (yrg[2] < 0) maxC = Math.min(-D65_G / sinH, maxC);
  if (yrg[1] + yrg[2] > 1) maxC = Math.min((1 - D65_R - D65_G) / (cosH + sinH), maxC);
  return [ych[0], maxC, cosH, sinH];
}

// ---------- darktable UCS 2022 ----------

const L_STAR_RANGE = 2.098883786377;
const L_STAR_UPPER_LIMIT = 2.09885;
// darktable uses FLT_MIN; 1e-30 behaves the same and cannot overflow to infinity
// when divided into on a GPU.
const FLT_MIN = 1e-30;

export const yToLStar = (Y: number) => {
  const h = Math.pow(Y, 0.631651345306265);
  return (L_STAR_RANGE * h) / (h + 1.12426773749357);
};
export const lStarToY = (L: number) => Math.pow((1.12426773749357 * L) / (L_STAR_RANGE - L), 1.5831518565279648);

export function xyzToXyY(xyz: Vec3): Vec3 {
  const X = Math.max(xyz[0], 0);
  const Y = Math.max(xyz[1], 0);
  const Z = Math.max(xyz[2], 0);
  const sum = X + Y + Z;
  return [sum > 0 ? X / sum : D65_XY[0], sum > 0 ? Y / sum : D65_XY[1], Y];
}

export function xyYToXyz(xyY: Vec3): Vec3 {
  if (xyY[1] === 0) return [0, 0, 0];
  return [(xyY[2] * xyY[0]) / xyY[1], xyY[2], (xyY[2] * (1 - xyY[0] - xyY[1])) / xyY[1]];
}

export function xyYToUcsUV(xyY: Vec3): [number, number] {
  const xf = [-0.783941002840055, 0.745273540913283, 0.318707282433486];
  const yf = [0.277512987809202, -0.205375866083878, 2.16743692732158];
  const off = [0.153836578598858, -0.165478376301988, 0.291320554395942];
  const uvd = [0, 1, 2].map((c) => xf[c] * xyY[0] + yf[c] * xyY[1] + off[c]);
  const div = uvd[2] >= 0 ? Math.max(FLT_MIN, uvd[2]) : Math.min(-FLT_MIN, uvd[2]);
  const uv = [uvd[0] / div, uvd[1] / div];
  const factors = [1.39656225667, 1.4513954287];
  const half = [1.49217352929, 1.52488637914];
  const s = [0, 1].map((c) => (factors[c] * uv[c]) / (Math.abs(uv[c]) + half[c]));
  return [-1.124983854323892 * s[0] - 0.980483721769325 * s[1], 1.86323315098672 * s[0] + 1.971853092390862 * s[1]];
}

/** xyY to darktable UCS lightness J, chroma C and hue H (radians). */
export function xyYToUcsJCH(xyY: Vec3, lWhite: number): Vec3 {
  const uv = xyYToUcsUV(xyY);
  const L = yToLStar(xyY[2]);
  const M2 = uv[0] * uv[0] + uv[1] * uv[1];
  return [L / lWhite, (15.932993652962535 * Math.pow(L, 0.6523997524738018) * Math.pow(M2, 0.6007557017508491)) / lWhite, Math.atan2(uv[1], uv[0])];
}

export function ucsJCHToXyY(jch: Vec3, lWhite: number): Vec3 {
  const L = Math.min(Math.max(jch[0] * lWhite, 0), L_STAR_UPPER_LIMIT);
  const M = L !== 0 ? Math.pow((jch[1] * lWhite) / (15.932993652962535 * Math.pow(L, 0.6523997524738018)), 0.8322850678616855) : 0;
  const u = M * Math.cos(jch[2]);
  const v = M * Math.sin(jch[2]);
  const s = [-5.037522385190711 * u - 2.504856328185843 * v, 4.760029407436461 * u + 2.874012963239247 * v];
  const factors = [1.39656225667, 1.4513954287];
  const half = [1.49217352929, 1.52488637914];
  const uv = [0, 1].map((c) => (-half[c] * s[c]) / (Math.abs(s[c]) - factors[c]));
  const uf = [0.167171472114775, -0.150959086409163, 0.940254742367256];
  const vf = [0.141299802443708, -0.155185060382272, 1.0];
  const off = [-0.00801531300850582, -0.00843312433578007, -0.0256325967652889];
  const xyd = [0, 1, 2].map((c) => uf[c] * uv[0] + vf[c] * uv[1] + off[c]);
  const div = xyd[2] >= 0 ? Math.max(FLT_MIN, xyd[2]) : Math.min(-FLT_MIN, xyd[2]);
  return [xyd[0] / div, xyd[1] / div, lStarToY(L)];
}

const HK = 1.33654221029386;
/** JCH to hue, chroma, brightness. */
export const jchToHcb = (j: Vec3): Vec3 => [j[2], j[1], j[0] * (Math.pow(j[1], HK) + 1)];
export const hcbToJch = (h: Vec3): Vec3 => [h[2] / (Math.pow(h[1], HK) + 1), h[1], h[0]];
/** JCH to hue, saturation, brightness. */
export function jchToHsb(j: Vec3): Vec3 {
  const B = j[0] * (Math.pow(j[1], HK) + 1);
  return [j[2], B > 0 ? j[1] / B : 0, B];
}
export function hsbToJch(h: Vec3): Vec3 {
  const C = h[1] * h[2];
  return [h[2] / (Math.pow(C, HK) + 1), C, h[0]];
}

export function softClip(x: number, soft: number, hard: number): number {
  const norm = hard - soft;
  return x > soft ? soft + (1 - Math.exp(-(x - soft) / norm)) * norm : x;
}

// ---------- Gamut boundary of the working space ----------

export const GAMUT_LUT_SIZE = 512;

function deltaH(a: number, b: number): number {
  let d = a - b;
  if (d < -Math.PI) d += 2 * Math.PI;
  if (d > Math.PI) d -= 2 * Math.PI;
  return d;
}

/** Squared colourfulness M² of the gamut boundary of `rgbToXyz`, for 512 hue angles in [-π, π). */
export function buildGamutLut(rgbToXyz: Mat3): Float32Array {
  const n = GAMUT_LUT_SIZE;
  const lut = new Float64Array(n);
  const count = new Float64Array(n);
  const prim = [0, 1, 2].map((i) => xyzToXyY(mulVec(rgbToXyz, [0, 1, 2].map((j) => (j === i ? 1 : 0)) as Vec3)));
  const [red, green, blue] = prim;
  const hue = (p: Vec3) => Math.atan2(p[1] - D65_XY[1], p[0] - D65_XY[0]);
  const [hR, hG, hB] = [hue(red), hue(green), hue(blue)];
  const edge = (a: Vec3, b: Vec3, tan: number) => {
    const t = (D65_XY[1] - a[1] + tan * (a[0] - D65_XY[0])) / (b[1] - a[1] + tan * (a[0] - b[0]));
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  };
  const inUnit = (t: number) => t >= 0 && t <= 1;
  for (let i = 0; i < 50 * n; i++) {
    const angle = -Math.PI + (i / (50 * n)) * 2 * Math.PI;
    const tan = Math.tan(angle);
    let xy = [0, 0];
    if (inUnit(deltaH(angle, hB) / deltaH(hR, hB))) xy = edge(blue, red, tan);
    else if (inUnit(deltaH(angle, hR) / deltaH(hG, hR))) xy = edge(red, green, tan);
    else if (inUnit(deltaH(angle, hG) / deltaH(hB, hG))) xy = edge(green, blue, tan);
    const uv = xyYToUcsUV([xy[0], xy[1], 1]);
    let idx = Math.round(((n - 1) * (Math.atan2(uv[1], uv[0]) + Math.PI)) / (2 * Math.PI));
    if (idx < 0) idx += n;
    if (idx >= n) idx -= n;
    lut[idx] += uv[0] * uv[0] + uv[1] * uv[1];
    count[idx] += 1;
  }
  return Float32Array.from(lut, (v, k) => v / Math.max(1, count[k]));
}

export function lookupGamut(lut: ArrayLike<number>, hue: number): number {
  const n = GAMUT_LUT_SIZE;
  const x = (n * (hue + Math.PI)) / (2 * Math.PI);
  const x0 = Math.floor(x);
  const x1 = Math.ceil(x);
  const i0 = x0 & (n - 1);
  const i1 = x1 & (n - 1);
  return lut[i0] + (i0 !== i1 ? (x - x0) * (lut[i1] - lut[i0]) : 0);
}

let gamut: Float32Array | null = null;
/** The working space's gamut table, built once. */
export const workingGamut = () => (gamut ??= buildGamutLut(REC2020_TO_XYZ));

// ---------- The stage ----------

export interface ColorBalance {
  /** -1 to 1. 0 keeps contrast; darktable's `contrast` parameter. */
  contrast: number;
  /** -1 to 1; darktable's `vibrance`. */
  vibrance: number;
  /** -1 to 1; darktable's `saturation_global`, darktable UCS formula. */
  saturation: number;
  /** -1 to 1; darktable's `shadows_Y`, the luminance of the shadows lift. */
  shadows: number;
}

/**
 * Contrast pivots on Emulsion's middle grey rather than darktable's default
 * 0.1845, expressed as Yrg luminance, which is what the contrast acts on.
 */
export const CONTRAST_FULCRUM = lmsToYrg(mulVec(REC2020_TO_LMS, [TONE.grey, TONE.grey, TONE.grey]))[0];
/** darktable's white fulcrum at its default of 0 EV. */
export const WHITE_FULCRUM = 1;

// The luminance masks, at darktable's defaults: middle grey 0.1845 and fall-offs of 1,
// which darktable's commit_params turns into weights of 2 + 2 * fall-off.
export const MASK_POWER = 0.4101205819200422;
/** The mask's middle grey, on the scale the masks work on (Y to the power 0.41, grey near 50%). */
export const MASK_GREY_FULCRUM = Math.pow(0.1845, MASK_POWER);
export const SHADOWS_WEIGHT = 4;
export const HIGHLIGHTS_WEIGHT = 4;

/**
 * Luminance gain of the shadows lift for a pixel of Yrg luminance `Y`
 * (darktable's opacity_masks and the lift/gain slopes, with no highlights gain
 * and no lift colour, which reduce to one gain on all three channels).
 */
export function shadowsGain(Y: number, shadows: number): number {
  const offset = (Math.pow(Math.max(Y, 0), MASK_POWER) - MASK_GREY_FULCRUM) / MASK_GREY_FULCRUM;
  const alpha = 1 / (1 + Math.exp(offset * SHADOWS_WEIGHT));
  const beta = 1 / (1 + Math.exp(-offset * HIGHLIGHTS_WEIGHT));
  return (1 - beta) * (1 - alpha + alpha * (1 + shadows)) + beta;
}

/**
 * darktable colour balance rgb's parameters (dt_iop_colorbalancergb_params_t, v5, with the
 * darktable UCS saturation formula). Hues are in conventional degrees, as darktable shows them.
 */
export interface CbParams {
  shadows_Y: number; shadows_C: number; shadows_H: number;
  midtones_Y: number; midtones_C: number; midtones_H: number;
  highlights_Y: number; highlights_C: number; highlights_H: number;
  global_Y: number; global_C: number; global_H: number;
  shadows_weight: number; white_fulcrum: number; highlights_weight: number;
  chroma_shadows: number; chroma_highlights: number; chroma_global: number; chroma_midtones: number;
  saturation_global: number; saturation_highlights: number; saturation_midtones: number; saturation_shadows: number;
  hue_angle: number;
  brilliance_global: number; brilliance_highlights: number; brilliance_midtones: number; brilliance_shadows: number;
  mask_grey_fulcrum: number;
  vibrance: number; grey_fulcrum: number; contrast: number;
}

/** darktable's defaults: the module does nothing. */
export const CB_DEFAULTS: CbParams = {
  shadows_Y: 0, shadows_C: 0, shadows_H: 0, midtones_Y: 0, midtones_C: 0, midtones_H: 0,
  highlights_Y: 0, highlights_C: 0, highlights_H: 0, global_Y: 0, global_C: 0, global_H: 0,
  shadows_weight: 1, white_fulcrum: 0, highlights_weight: 1,
  chroma_shadows: 0, chroma_highlights: 0, chroma_global: 0, chroma_midtones: 0,
  saturation_global: 0, saturation_highlights: 0, saturation_midtones: 0, saturation_shadows: 0,
  hue_angle: 0, brilliance_global: 0, brilliance_highlights: 0, brilliance_midtones: 0, brilliance_shadows: 0,
  mask_grey_fulcrum: 0.1845, vibrance: 0, grey_fulcrum: 0.1845, contrast: 0,
};

/** commit_params: what the per-pixel loop reads. */
export interface CbData {
  vibrance: number;
  contrast: number;
  greyFulcrum: number;
  whiteFulcrum: number;
  /** global, then [shadows, midtones, highlights] */
  chroma: [number, number, number, number];
  saturation: [number, number, number, number];
  brilliance: [number, number, number, number];
  hueCos: number;
  hueSin: number;
  global: Vec3;
  shadows: Vec3;
  highlights: Vec3;
  midtones: Vec3;
  midtonesY: number;
  shadowsWeight: number;
  highlightsWeight: number;
  midtonesWeight: number;
  maskGreyFulcrum: number;
  lWhite: number;
}

/** darktable's ANGLE_SHIFT: conventional degrees to Yrg radians. */
const degToYrg = (d: number) => ((d - 30) * Math.PI) / 180;

/** Ych (Y, chroma, hue in Yrg radians) to Filmlight grading RGB. */
function ychToGrading(Y: number, c: number, h: number): Vec3 {
  return mulVec(LMS_TO_GRADING, yrgToLms(ychToYrg([Y, c, Math.cos(h), Math.sin(h)])));
}

export function cbCommit(p: CbParams): CbData {
  const norm = ychToGrading(1, 0, 0); // grading RGB of a pure white
  const wheel = (C: number, H: number) => ychToGrading(1, C, degToYrg(H));
  const g = wheel(p.global_C, p.global_H).map((v, c) => v - norm[c] + norm[c] * p.global_Y) as Vec3;
  const sh = wheel(p.shadows_C, p.shadows_H).map((v, c) => 1 + (v - norm[c]) + p.shadows_Y) as Vec3;
  const hi = wheel(p.highlights_C, p.highlights_H).map((v, c) => 1 + (v - norm[c]) + p.highlights_Y) as Vec3;
  const mid = wheel(p.midtones_C, p.midtones_H).map((v, c) => 1 / (1 + (v - norm[c]))) as Vec3;
  const sw = 2 + p.shadows_weight * 2, hw = 2 + p.highlights_weight * 2;
  const white = Math.pow(2, p.white_fulcrum);
  const angle = (p.hue_angle * Math.PI) / 180;
  return {
    vibrance: p.vibrance,
    contrast: 1 + p.contrast,
    greyFulcrum: p.grey_fulcrum,
    whiteFulcrum: white,
    chroma: [p.chroma_global, p.chroma_shadows, p.chroma_midtones, p.chroma_highlights],
    saturation: [p.saturation_global, p.saturation_shadows, p.saturation_midtones, p.saturation_highlights],
    brilliance: [p.brilliance_global, p.brilliance_shadows, p.brilliance_midtones, p.brilliance_highlights],
    hueCos: Math.cos(angle),
    hueSin: Math.sin(angle),
    global: g,
    shadows: sh,
    highlights: hi,
    midtones: mid,
    midtonesY: 1 / (1 + p.midtones_Y),
    shadowsWeight: sw,
    highlightsWeight: hw,
    midtonesWeight: (sw * sw * hw * hw) / (sw * sw + hw * hw),
    maskGreyFulcrum: Math.pow(p.mask_grey_fulcrum, MASK_POWER),
    lWhite: yToLStar(white),
  };
}

/** darktable's opacity_masks: shadows, mid-tones and highlights opacities of a pixel. */
export function opacityMasks(x: number, d: CbData): Vec3 {
  const off = x - d.maskGreyFulcrum;
  const offN = off / d.maskGreyFulcrum;
  const alpha = 1 / (1 + Math.exp(offN * d.shadowsWeight));
  const beta = 1 / (1 + Math.exp(-offN * d.highlightsWeight));
  const gamma = Math.exp((-off * off * d.midtonesWeight) / 4) * (1 - alpha) ** 2 * (1 - beta) ** 2 * 8;
  return [alpha, gamma, beta];
}

/** One scene-linear Rec.2020 pixel through darktable's colour balance rgb (process()). */
export function colorBalanceRgb(rgb: Vec3, d: CbData, lut: ArrayLike<number> = workingGamut()): Vec3 {
  const lin: Vec3 = [Math.max(rgb[0], 0), Math.max(rgb[1], 0), Math.max(rgb[2], 0)];
  let ych = yrgToYch(lmsToYrg(mulVec(REC2020_TO_LMS, lin)));
  ych[0] = Math.max(ych[0], 0);
  const op = opacityMasks(Math.pow(ych[0], MASK_POWER), d);
  const zone = (v: [number, number, number, number]) => v[0] + op[0] * v[1] + op[1] * v[2] + op[2] * v[3];

  // hue shift
  const [cosH, sinH] = [ych[2], ych[3]];
  ych = [ych[0], ych[1], d.hueCos * cosH - d.hueSin * sinH, d.hueSin * cosH + d.hueCos * sinH];

  // linear chroma
  const vib = d.vibrance === 0 ? 0 : d.vibrance * (1 - Math.pow(ych[1], Math.abs(d.vibrance)));
  ych[1] *= Math.max(1 + zone(d.chroma) + vib, 0);
  ych = gamutCheckYrg(ych);

  // the four ways, in grading RGB
  let g = mulVec(LMS_TO_GRADING, yrgToLms(ychToYrg(ych)));
  g = g.map((v, c) => {
    v += d.global[c];
    v *= (1 - op[2]) * (1 - op[0] + op[0] * d.shadows[c]) + op[2] * d.highlights[c];
    const sign = v < 0 ? -1 : 1;
    return sign * Math.pow(Math.abs(v) / d.whiteFulcrum, d.midtones[c]) * d.whiteFulcrum;
  }) as Vec3;
  const yrg = lmsToYrg(mulVec(GRADING_TO_LMS, g));

  // luminance power, then contrast around the grey fulcrum
  yrg[0] = Math.pow(Math.max(yrg[0] / d.whiteFulcrum, 0), d.midtonesY) * d.whiteFulcrum;
  yrg[0] = d.greyFulcrum * Math.pow(yrg[0] / d.greyFulcrum, d.contrast);
  const xyz = mulVec(LMS_TO_XYZ, yrgToLms(yrg));

  // saturation and brilliance in darktable UCS, then gamut mapping at constant brightness
  const lWhite = d.lWhite;
  const hcb = jchToHcb(xyYToUcsJCH(xyzToXyY(xyz), lWhite));
  const radius = Math.hypot(hcb[1], hcb[2]);
  const sinT = radius > 0 ? hcb[1] / radius : 0;
  const cosT = radius > 0 ? hcb[2] / radius : 0;
  const P = Math.max(FLT_MIN, hcb[1]);
  const W = sinT * hcb[1] + cosT * hcb[2];
  const maxA = Math.hypot(P, W) / P;
  const a = softClip(Math.max(1 + zone(d.saturation), 0), 0.5 * maxA, maxA);
  const b = Math.max(1 + zone(d.brilliance), 0);
  const Pp = (a - 1) * P;
  const Wp = Math.sqrt(P * P * (1 - a * a) + W * W) * b;
  hcb[1] = Math.max(cosT * Pp + sinT * Wp, 0);
  hcb[2] = Math.max(-sinT * Pp + cosT * Wp, 0);
  const jch2 = hcbToJch(hcb);
  const maxM2 = lookupGamut(lut, jch2[2]);
  const maxC = (15.932993652962535 * Math.pow(jch2[0] * lWhite, 0.6523997524738018) * Math.pow(maxM2, 0.6007557017508491)) / lWhite;
  const boundary = jchToHsb([jch2[0], maxC, jch2[2]]);
  const hsb: Vec3 = [hcb[0], hcb[2] > 0 ? hcb[1] / hcb[2] : 0, hcb[2]];
  hsb[1] = softClip(hsb[1], 0.8 * boundary[1], boundary[1]);
  const out = xyYToXyz(ucsJCHToXyY(hsbToJch(hsb), lWhite));
  return mulVec(XYZ_TO_REC2020, out).map((v) => Math.max(v, 0)) as Vec3;
}

/** An instance's constants for stages/colorbalance.glsl (uCbP): ten vec4s. */
export function cbUniform(d: CbData): number[] {
  return [
    d.contrast, d.vibrance, d.greyFulcrum, d.whiteFulcrum,
    ...d.chroma, ...d.saturation, ...d.brilliance,
    ...d.global, 0, ...d.shadows, 0, ...d.highlights, 0, ...d.midtones, 0,
    d.midtonesY, d.shadowsWeight, d.highlightsWeight, d.midtonesWeight,
    d.maskGreyFulcrum, d.hueCos, d.hueSin, d.lWhite,
  ];
}

/** The recipe sliders' instance: contrast, vibrance, saturation and the shadows lift. */
export function sliderParams(p: ColorBalance): CbParams {
  return { ...CB_DEFAULTS, contrast: p.contrast, vibrance: p.vibrance, saturation_global: p.saturation, shadows_Y: p.shadows, grey_fulcrum: CONTRAST_FULCRUM };
}

/** One scene-linear Rec.2020 pixel through the recipe sliders' instance. */
export function colorBalance(rgb: Vec3, p: ColorBalance, lut: ArrayLike<number> = workingGamut()): Vec3 {
  return colorBalanceRgb(rgb, cbCommit(sliderParams(p)), lut);
}

/** Recipe sliders (-100 to 100, contrast -50 to 50) to the stage's parameters. */
export function colorBalanceParams(contrast: number, vibrance: number, saturation: number, shadows: number): ColorBalance {
  return { contrast: contrast / 100, vibrance: vibrance / 100, saturation: saturation / 100, shadows: shadows / 100 };
}
