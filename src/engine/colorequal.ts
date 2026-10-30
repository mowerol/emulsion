// Copyright (C) 2022-2026 darktable developers.
// Ported from darktable src/iop/colorequal.c (process, _prefilter_chromaticity,
// _guide_with_chromaticity, _periodic_RBF_interpolate, commit_params), src/common/darktable_ucs_22_helpers.h
// (gamut_map_HSB), src/common/math.h (scharr_gradient) and src/iop/choleski.h (pseudo_solve, through
// choleskySolve in toneequalizer.ts) at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2).
// Translated from C to TypeScript (and GLSL, in shaders/ce.frag.glsl and stages/colorequal.glsl).
// Changes: darktable's recursive Gaussian mean blur is an exact Gaussian here, borders clamp, and the
// saturation weight is its logistic evaluated directly rather than from a 8193-entry table. Only
// darktable's defaults for the options not exposed (saturation threshold 0.1, hue curve 1, contrast 0,
// white level +1 EV, hue analysis radius 1.5, effect radius 1, guided filter on, node placement 0); at
// those radii darktable never downsamples, so that path is not ported. Lab-free: everything is in
// darktable UCS 22 from scene-linear Rec.2020 (D65), as darktable's working space.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Reference implementation of Colour: darktable's color equalizer. Eight hue
// nodes (red to magenta) each shift hue and scale saturation and brightness;
// smooth periodic curves spread them across all hues. Two guided filters
// keep the changes even across a coloured area, and keep them off greys.

import { REC2020_TO_SRGB, mulMat, mulVec } from './color';
import { REC2020_TO_XYZ, XYZ_TO_REC2020, GAMUT_LUT_SIZE, jchToHsb, lookupGamut, ucsJCHToXyY, workingGamut, xyYToUcsUV, xyYToXyz, xyzToXyY, yToLStar } from './colorbalance';
import { gaussian1d } from './capture';
import { choleskySolve } from './toneequalizer';
import type { Vec3 } from '../film/stocks';

export const NODES = 8;
export const NODE_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Lavender', 'Magenta'] as const;
const SAT_EFFECT = 2;
const BRIGHT_EFFECT = 8;
const NORM_MIN = 1.52587890625e-5;
/** sRGB red sits at 20° of hue in darktable UCS 22, so the nodes start there. */
const ANGLE_SHIFT = 20;

/** darktable's defaults for the options Emulsion does not expose. */
export const DEFAULTS = { threshold: 0.1, smoothingHue: 1, contrast: 0, whiteLevel: 1, chromaSize: 1.5, paramSize: 1, hueShift: 0 };

export interface ColorEqParams {
  /** Hue shift per node, degrees (-180 to 180). */
  hue: number[];
  /** Saturation per node, a gain (0 to 2; 1 leaves it). */
  sat: number[];
  /** Brightness per node, a gain (0 to 2; 1 leaves it). */
  bright: number[];
}

export const isNeutral = (p: ColorEqParams) => p.hue.every((v) => v === 0) && p.sat.every((v) => v === 1) && p.bright.every((v) => v === 1);

const deg = (d: number) => (d * Math.PI) / 180;
const nodeAngle = (k: number) => deg((k * 360) / NODES + DEFAULTS.hueShift + ANGLE_SHIFT);

/**
 * _periodic_RBF_interpolate: a LUT over hue (GAMUT_LUT_SIZE entries from -π)
 * through the nodes, with radial basis functions on a cosine series.
 */
export function periodicRbf(nodes: number[], smoothing: number, clip: boolean): Float32Array {
  const m = Math.ceil(3 * Math.sqrt(smoothing));
  const kernel = (d: number) => {
    let s = 0;
    for (let l = 0; l < m; l++) s += Math.exp((-l * l) / smoothing) * Math.cos(l * Math.abs(d));
    return Math.exp(s);
  };
  const A = Array.from({ length: NODES }, (_, i) => Array.from({ length: NODES }, (_, j) => kernel(nodeAngle(i) - nodeAngle(j))));
  // pseudo_solve: least squares through AᵀA x = Aᵀy; on failure darktable keeps the node values.
  const AtA = A.map((_, i) => A.map((__, j) => A.reduce((s, row) => s + row[i] * row[j], 0)));
  const Aty = A.map((_, i) => A.reduce((s, row, k) => s + row[i] * nodes[k], 0));
  const lambda = choleskySolve(AtA, Aty) ?? nodes;
  const lut = new Float32Array(GAMUT_LUT_SIZE);
  for (let i = 0; i < GAMUT_LUT_SIZE; i++) {
    const hue = deg((i * 360) / GAMUT_LUT_SIZE) - Math.PI;
    let v = 0;
    for (let k = 0; k < NODES; k++) v += lambda[k] * kernel(hue - nodeAngle(k));
    lut[i] = clip ? Math.max(0, v) : v;
  }
  return lut;
}

export interface ColorEqLuts {
  hue: Float32Array;
  sat: Float32Array;
  bright: Float32Array;
  maxBrightness: number;
}

/** commit_params: the three hue LUTs and the largest brightness gain (at least 1). */
export function colorEqLuts(p: ColorEqParams): ColorEqLuts {
  return {
    sat: periodicRbf(p.sat, Math.PI, true),
    hue: periodicRbf(p.hue.map(deg), (1 / DEFAULTS.smoothingHue) * Math.PI, false),
    bright: periodicRbf(p.bright, Math.PI, true),
    maxBrightness: Math.max(1, ...p.bright),
  };
}

/** commit_params's threshold: the saturation at which the weight is one half. */
export const SAT_SHIFT = -0.015 + 0.3 * (5 * DEFAULTS.threshold) ** 2;

/** _get_satweight: a logistic of saturation, 0.5 at zero, steep (darktable's contrast 0). */
export function satWeight(s: number): number {
  const factor = -60 - 40 * DEFAULTS.contrast;
  const c = Math.min(Math.max(s, -1), 1 - 1 / 4096);
  return 1 / (1 + Math.exp((factor * c) / 2));
}

/** The white of darktable UCS for +1 EV, as _prepare_process. */
export const WHITE = yToLStar(2 ** DEFAULTS.whiteLevel);

/** The per-pixel values STEP 1 makes: UCS UV, lightness L* and RGB saturation. */
export function pixelUvl(rgb: Vec3): { u: number; v: number; L: number; sat: number } {
  const xyY = xyzToXyY(mulVec(REC2020_TO_XYZ, rgb));
  const [u, v] = xyYToUcsUV(xyY);
  const max = Math.max(...rgb);
  const delta = max - Math.min(...rgb);
  return { u, v, L: yToLStar(xyY[2]), sat: max > NORM_MIN && delta > NORM_MIN ? delta / max : 0 };
}

/** dt_UCS_LUV_to_JCH then JCH to HSB. */
export function uvlToHsb(u: number, v: number, L: number): { hsb: Vec3; chroma: number } {
  const M2 = u * u + v * v;
  const jch: Vec3 = [L / WHITE, (15.932993652962535 * Math.pow(L, 0.6523997524738018) * Math.pow(M2, 0.6007557017508491)) / WHITE, Math.atan2(v, u)];
  return { hsb: jchToHsb(jch), chroma: jch[1] };
}

/** gamut_map_HSB: soft-clip saturation at constant brightness to the working gamut. */
export function gamutMapHsb(hsb: Vec3, lut: ArrayLike<number> = workingGamut(), lWhite = WHITE): Vec3 {
  const C = hsb[1] * hsb[2];
  const J = hsb[2] / (Math.pow(C, 1.33654221029386) + 1);
  const maxM2 = lookupGamut(lut, hsb[0]);
  const maxC = (15.932993652962535 * Math.pow(J * lWhite, 0.6523997524738018) * Math.pow(maxM2, 0.6007557017508491)) / lWhite;
  const boundary = jchToHsb([J, maxC, hsb[0]]);
  const soft = 0.8 * boundary[1];
  const hard = boundary[1];
  const s = hsb[1] > soft ? soft + (1 - Math.exp(-(hsb[1] - soft) / (hard - soft))) * (hard - soft) : hsb[1];
  return [hsb[0], s, hsb[2]];
}

/** dt_UCS_HSB_to_XYZ. */
export function hsbToXyz(hsb: Vec3, lWhite = WHITE): Vec3 {
  const C = hsb[1] * hsb[2];
  const jch: Vec3 = [hsb[2] / (Math.pow(C, 1.33654221029386) + 1), C, hsb[0]];
  return xyYToXyz(ucsJCHToXyY(jch, lWhite));
}

/** HSB back to scene-linear Rec.2020. */
export const hsbToRgb = (hsb: Vec3): Vec3 => mulVec(XYZ_TO_REC2020, hsbToXyz(hsb));

// ---------- Slider gradients ----------
// darktable's GUI draws fixed gradients (a pastel saturation, a generic brightness ramp), which
// Oli found did not show the swing. These instead run one colour of each node's hue through
// process()'s per-pixel formulas, so a track shows the change its slider makes to that colour:
// hue shifted, saturation scaled by 1 + 2 (gain - 1) and gamut-mapped, brightness scaled by
// 1 + 8 S (gain - 1). They leave out the guided filters and the curves' spread between nodes.

const XYZ_TO_SRGB = mulMat(REC2020_TO_SRGB, XYZ_TO_REC2020);
/** DT_BAUHAUS_SLIDER_MAX_STOPS */
export const GRADIENT_STOPS = 20;
/** The colour drawn: mid-grey brightness (Y 0.25), at this share of the most saturated the screen shows. */
const SWATCH_Y = 0.25;
const SWATCH_SHARE = 0.6;

const linearSrgb = (hsb: Vec3) => mulVec(XYZ_TO_SRGB, hsbToXyz(hsb));

function toHex(rgb: Vec3): string {
  const enc = (v: number) => {
    const c = Math.min(Math.max(v, 0), 1);
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  return '#' + rgb.map((v) => Math.round(enc(v) * 255).toString(16).padStart(2, '0')).join('');
}

/** The node's colour in HSB: its hue, mid brightness, and 60% of the saturation sRGB can show there. */
export function nodeSwatch(node: number): Vec3 {
  const hue = nodeAngle(node);
  const B = yToLStar(SWATCH_Y) / WHITE;
  let lo = 0;
  let hi = 4;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (Math.min(...linearSrgb([hue, mid, B])) >= 0) lo = mid;
    else hi = mid;
  }
  return [hue, SWATCH_SHARE * lo, B];
}

/**
 * The colours along a node's slider, left to right: its swatch colour as each
 * slider position changes it. `hueDegrees` is darktable's hue shift at the
 * slider's ends; `satRange` and `brightRange` how far those gains move from 1.
 */
export function sliderGradient(channel: 'hue' | 'sat' | 'bright', node: number, hueDegrees = 180, brightRange = 1, satRange = 1): string[] {
  const [h, sat, b] = nodeSwatch(node);
  return Array.from({ length: GRADIENT_STOPS }, (_, i) => {
    const t = (2 * i) / (GRADIENT_STOPS - 1) - 1;
    let hsb: Vec3;
    if (channel === 'hue') hsb = [h + deg(hueDegrees) * t, sat, b];
    else if (channel === 'sat') hsb = [h, Math.max(0, sat * (1 + SAT_EFFECT * satRange * t)), b];
    else hsb = [h, sat, Math.max(0, b * (1 + BRIGHT_EFFECT * sat * brightRange * t))];
    return toHex(linearSrgb(gamutMapHsb(hsb)));
  });
}

// ---------- Whole-image helpers ----------

type Planes = Float64Array<ArrayBufferLike>[];

const idx = (w: number, h: number, i: number, j: number) => Math.min(Math.max(j, 0), h - 1) * w + Math.min(Math.max(i, 0), w - 1);

/** dt_gaussian_mean_blur on each plane, here an exact Gaussian with clamped borders. */
export function blurPlanes(planes: Planes, w: number, h: number, sigma: number): Planes {
  const k = gaussian1d(sigma);
  const r = (k.length - 1) / 2;
  return planes.map((p) => {
    const tmp = new Float64Array(w * h);
    const out = new Float64Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let s = 0;
      for (let t = -r; t <= r; t++) s += k[t + r] * p[idx(w, h, i + t, j)];
      tmp[j * w + i] = s;
    }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let s = 0;
      for (let t = -r; t <= r; t++) s += k[t + r] * tmp[idx(w, h, i, j + t)];
      out[j * w + i] = s;
    }
    return out;
  });
}

/** scharr_gradient at a pixel, the neighbourhood moved inside the image as darktable does. */
export function scharrAt(p: Float64Array<ArrayBufferLike>, w: number, h: number, i: number, j: number): number {
  const ci = Math.min(w - 2, Math.max(1, i));
  const cj = Math.min(h - 2, Math.max(1, j));
  const at = (di: number, dj: number) => p[(cj + dj) * w + ci + di];
  const gx = (47 / 255) * (at(-1, -1) - at(1, -1) + at(-1, 1) - at(1, 1)) + (162 / 255) * (at(-1, 0) - at(1, 0));
  const gy = (47 / 255) * (at(-1, -1) - at(-1, 1) + at(1, -1) - at(1, 1)) + (162 / 255) * (at(0, -1) - at(0, 1));
  return Math.hypot(gx, gy);
}

/**
 * The 2-channel guided filter's coefficients from the blurred means of the
 * guide (mu, mv), its blurred second moments (uu, uv, vv) and the blurred
 * cross moments of two guided signals with U and V (c0u, c0v, c1u, c1v) and
 * their means (m0, m1): returns a (4) and b (2), as darktable inverts Σ + εI.
 */
export function guidedCoefficients(mu: number, mv: number, uu: number, uv: number, vv: number, c0u: number, c0v: number, c1u: number, c1v: number, m0: number, m1: number, eps: number) {
  const s0 = uu - mu * mu + eps;
  const s1 = uv - mu * mv;
  const s3 = vv - mv * mv + eps;
  const det = s0 * s3 - s1 * s1;
  let a = [0, 0, 0, 0];
  if (Math.abs(det) > 4 * 1.1920929e-7) {
    const inv = [s3 / det, -s1 / det, -s1 / det, s0 / det];
    const x0u = c0u - mu * m0, x0v = c0v - mv * m0, x1u = c1u - mu * m1, x1v = c1v - mv * m1;
    a = [x0u * inv[0] + x0v * inv[1], x0u * inv[2] + x0v * inv[3], x1u * inv[0] + x1v * inv[1], x1u * inv[2] + x1v * inv[3]];
  }
  return { a, b: [m0 - a[0] * mu - a[1] * mv, m1 - a[2] * mu - a[3] * mv] };
}

/**
 * darktable's color equalizer over a scene-linear Rec.2020 image (w × h × 3),
 * at `roiScale` = this image's width over the full-resolution width.
 */
export function colorEqualize(rgb: Float64Array, w: number, h: number, p: ColorEqParams, roiScale = 1, luts = colorEqLuts(p)): Float64Array {
  const n = w * h;
  const pix = (k: number): Vec3 => [rgb[3 * k], rgb[3 * k + 1], rgb[3 * k + 2]];
  // _prepare_process
  const satShift = SAT_SHIFT;
  const brightShift = satShift + 0.01 * luts.maxBrightness * Math.min(5, Math.sqrt(DEFAULTS.paramSize));
  const gradientAmp = 4 * Math.sqrt(luts.maxBrightness) * roiScale * roiScale;
  const hueSigma = Math.max(0.2, 0.5 * DEFAULTS.chromaSize * roiScale);
  const parSigma = Math.max(0.2, 0.5 * DEFAULTS.paramSize * roiScale);
  const satSigma = Math.max(0.5, roiScale);
  const scharrSigma = Math.max(0.5, roiScale);

  // STEP 1: UCS UV, L* and saturation.
  let U: Float64Array<ArrayBufferLike> = new Float64Array(n), V: Float64Array<ArrayBufferLike> = new Float64Array(n);
  const L = new Float64Array(n);
  let sat: Float64Array<ArrayBufferLike> = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const q = pixelUvl(pix(k));
    U[k] = q.u; V[k] = q.v; L[k] = q.L; sat[k] = q.sat;
  }
  [sat] = blurPlanes([sat], w, h, satSigma);

  // STEP 2: _prefilter_chromaticity, UV guided by itself. Without downsampling darktable blurs UV in place.
  {
    const uu = U.map((u) => u * u), uv = U.map((u, k) => u * V[k]), vv = V.map((v) => v * v);
    const [mu, mv, buu, buv, bvv] = blurPlanes([U, V, uu, uv, vv], w, h, hueSigma);
    const A = [0, 1, 2, 3].map(() => new Float64Array(n));
    const B = [0, 1].map(() => new Float64Array(n));
    for (let k = 0; k < n; k++) {
      const c = guidedCoefficients(mu[k], mv[k], buu[k], buv[k], bvv[k], buu[k], buv[k], buv[k], bvv[k], mu[k], mv[k], 1e-5);
      c.a.forEach((v, t) => (A[t][k] = v));
      B[0][k] = c.b[0]; B[1][k] = c.b[1];
    }
    const [a0, a1, a2, a3, b0, b1] = blurPlanes([...A, ...B], w, h, hueSigma);
    // UV was blurred in place, so the filter applies to (and falls back on) its local mean.
    const nu = new Float64Array(n), nv = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const cu = a0[k] * mu[k] + a1[k] * mv[k] + b0[k];
      const cv = a2[k] * mu[k] + a3[k] * mv[k] + b1[k];
      const wgt = satWeight(sat[k] - satShift);
      nu[k] = wgt * (cu - mu[k]) + mu[k];
      nv[k] = wgt * (cv - mv[k]) + mv[k];
    }
    U = nu; V = nv;
  }

  // STEP 3: HSB, the saturation gradient, and the raw corrections.
  const hsb: Vec3[] = new Array(n);
  let grad: Float64Array<ArrayBufferLike> = new Float64Array(n);
  let hueC: Float64Array<ArrayBufferLike> = new Float64Array(n), satC: Float64Array<ArrayBufferLike> = new Float64Array(n), brC: Float64Array<ArrayBufferLike> = new Float64Array(n);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    const { hsb: x, chroma } = uvlToHsb(U[k], V[k], L[k]);
    hsb[k] = x;
    grad[k] = gradientAmp * Math.max(0, scharrAt(sat, w, h, i, j) - 0.02) ** 2;
    if (chroma > NORM_MIN) {
      hueC[k] = lookupGamut(luts.hue, x[0]);
      satC[k] = lookupGamut(luts.sat, x[0]);
      brC[k] = x[1] * (lookupGamut(luts.bright, x[0]) - 1);
    } else {
      hueC[k] = 0; satC[k] = 1; brC[k] = 0;
    }
  }
  [grad] = blurPlanes([grad], w, h, scharrSigma);

  // STEP 4: _guide_with_chromaticity. Without downsampling darktable blurs UV and the corrections in place.
  {
    const uu = U.map((u) => u * u), uv = U.map((u, k) => u * V[k]), vv = V.map((v) => v * v);
    const su = U.map((u, k) => u * satC[k]), sv = V.map((v, k) => v * satC[k]);
    const bu = U.map((u, k) => u * brC[k]), bv = V.map((v, k) => v * brC[k]);
    const [mu, mv, buu, buv, bvv, mh, ms, csu, csv, cbu, cbv] = blurPlanes([U, V, uu, uv, vv, hueC, satC, su, sv, bu, bv], w, h, parSigma);
    const [mb] = blurPlanes([brC], w, h, 0.1 * parSigma);
    hueC = mh;
    const A = [0, 1, 2, 3].map(() => new Float64Array(n));
    const B = [0, 1].map(() => new Float64Array(n));
    for (let k = 0; k < n; k++) {
      const c = guidedCoefficients(mu[k], mv[k], buu[k], buv[k], bvv[k], csu[k], csv[k], cbu[k], cbv[k], ms[k], mb[k], 1e-6);
      c.a.forEach((v, t) => (A[t][k] = v));
      B[0][k] = c.b[0]; B[1][k] = c.b[1];
    }
    const [a0, a1, a2, a3, b0, b1] = blurPlanes([...A, ...B], w, h, parSigma);
    satC = new Float64Array(n); brC = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const c0 = a0[k] * mu[k] + a1[k] * mv[k] + b0[k];
      const c1 = a2[k] * mu[k] + a3[k] * mv[k] + b1[k];
      satC[k] = 1 + (c0 - 1) * satWeight(sat[k] - satShift);
      brC[k] = c1 * (1 - Math.min(Math.max(grad[k], 0), 1)) * satWeight(sat[k] - brightShift);
    }
  }

  // STEP 5: apply, gamut-map and back to RGB.
  const out = new Float64Array(3 * n);
  for (let k = 0; k < n; k++) {
    const x = hsb[k];
    const y: Vec3 = [x[0] + hueC[k], Math.max(0, x[1] * (1 + SAT_EFFECT * (satC[k] - 1))), Math.max(0, x[2] * (1 + BRIGHT_EFFECT * brC[k]))];
    const o = hsbToRgb(gamutMapHsb(y));
    out[3 * k] = o[0]; out[3 * k + 1] = o[1]; out[3 * k + 2] = o[2];
  }
  return out;
}
