// Copyright (C) 2010-2024 darktable developers.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// denoise (profiled), wavelets mode with the Y0U0V0 colour mode and the v2 variance-stabilising
// transform: a port of darktable's src/iop/denoiseprofile.c (process_wavelets,
// precondition_Y0U0V0, backtransform_Y0U0V0, set_up_conversion_matrices, invert_matrix,
// variance_stabilizing_xform, compute_wb_factors, infer_shadows/bias_from_profile) and
// src/common/eaw.c (eaw_dn_decompose, dn_weight, eaw_synthesize/accumulate) with
// src/common/math.h fast_mexp2f, at darktable 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (5.6.2).
// GLSL twin: shaders/eawdn.frag.glsl. Plan: docs/plans/noise-reduction.md, phase 1.
//
// The per-band force curves are flat (the module's default shape): Luma is the Y0 curve, Chroma
// the U0V0 curve, each 0 to 1 with upstream's default 0.5. darktable's other modes (non-local
// means, RGB, auto, compute variance) are not ported.
//
// Domain: the module runs on white-balanced camera RGB, scaled so 1 is the raw white level
// ((raw - black) / (white - black) times the as-shot coefficients normalised to green), as
// darktable's pipe holds it before colorin. `workingToDt` and `dtToWorking` map Emulsion's RAW
// source (scene-linear Rec.2020 times BASELINE_GAIN, LibRaw's white balance normalised to its
// smallest multiplier) to and from that domain.
import { invert3 } from './color';
import type { Mat3, Vec3 } from '../film/stocks';

/** darktable's noise profile, `V(X) = a·E[X] + b` per raw channel (src-tauri/src/noiseprofiles.rs). */
export interface NoiseProfile { name: string; iso: number; a: Vec3; b: Vec3; generic: boolean }

/** darktable's dt_noiseprofile_generic, for a camera without a profile and for non-RAW images. */
export const GENERIC_NOISE: NoiseProfile = { name: 'generic poissonian', iso: 0, a: [0.0001, 0.0001, 0.0001], b: [0, 0, 0], generic: true };

export const BANDS = 7; // DT_IOP_DENOISE_PROFILE_BANDS
const P_FULCRUM = 0.05; // DT_IOP_DENOISE_PROFILE_P_FULCRUM
/** Y0U0V0 smooths less than RGB; upstream's compensation. */
const COMPENSATE_STRENGTH = 2.5;
/** Noise of a unit-variance signal after one level of the 5-tap à-trous filter (about 0.5). */
export const VARF = Math.sqrt(2 + 2 * 4 * 4 + 6 * 6) / 16;
/** The B3-spline 5×5 kernel of eaw_dn_decompose, row-major, ×256. */
export const FILTER = [1, 4, 6, 4, 1].flatMap((a) => [1, 4, 6, 4, 1].map((b) => (a * b) / 256));

const f32 = Math.fround;

/** infer_shadows_from_profile: upstream's default "preserve shadows" for the green channel's a. */
export const inferShadows = (a: number) => Math.min(Math.max(0.1 - 0.1 * Math.log(a), 0.7), 1.8);
/** infer_bias_from_profile: upstream's default "bias correction". */
export const inferBias = (a: number) => -Math.max(5 + 0.5 * Math.log(a), 0);

/**
 * The number of wavelet scales at this input scale (process_wavelets): 7 at full resolution,
 * fewer on a downscaled preview so each band covers the same part of the full image.
 */
export function maxScale(inScale: number, fullW: number, fullH: number): number {
  const s = Math.min(inScale, 1);
  const supp0 = Math.min(2 * (2 << (BANDS - 1)) + 1, Math.max(fullW, fullH) * 0.2);
  const i0 = Math.log2((supp0 - 1) * 0.5);
  let n = 0;
  for (; n < BANDS; n++) {
    const supp = 2 * (2 << n) + 1;
    const suppIn = supp * (1 / s);
    const iIn = Math.log2((suppIn - 1) * 0.5) - 1;
    if (1 - (iIn + 0.5) / i0 < 0) break;
  }
  return n;
}

/** fast_mexp2f: darktable's bit-trick approximation of 2^-x, kept bit-exact in single precision. */
const scratch = new DataView(new ArrayBuffer(4));
export function fastMexp2f(x: number): number {
  const i1 = 0x3f800000, i2 = 0x3f000000;
  const k0 = f32(i1 + f32(x * (i2 - i1)));
  scratch.setInt32(0, k0 >= 0x800000 ? Math.trunc(k0) : 0);
  return scratch.getFloat32(0);
}

/** invert_matrix (row-major, null when singular). */
function invert(m: Mat3): Mat3 | null {
  const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) + m[0][1] * (-m[1][0] * m[2][2] + m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  return det === 0 ? null : invert3(m);
}

/** set_up_conversion_matrices: white-balance-adapted Y0U0V0 rows, each scaled to unit noise. */
export function conversionMatrices(wb: Vec3): { toY: Mat3; toRgb: Mat3 } {
  const sum = (1 / wb[0] + 1 / wb[1] + 1 / wb[2]) * Math.sqrt(3);
  const su = Math.sqrt(0.25 * wb[0] * wb[0] + 0.25 * wb[2] * wb[2]);
  const sv = Math.sqrt(0.0625 * wb[0] * wb[0] + 0.25 * wb[1] * wb[1] + 0.0625 * wb[2] * wb[2]);
  const toY: Mat3 = [
    [sum / wb[0], sum / wb[1], sum / wb[2]],
    [0.5 / su, 0, -0.5 / su],
    [0.25 / sv, -0.5 / sv, 0.25 / sv],
  ];
  const toRgb = invert(toY);
  if (toRgb) return { toY, toRgb };
  // The standard form when the adapted matrix cannot be inverted.
  const sy = Math.sqrt((wb[0] * wb[0] + wb[1] * wb[1] + wb[2] * wb[2]) / 9);
  toY[0] = [1 / (3 * sy), 1 / (3 * sy), 1 / (3 * sy)];
  return { toY, toRgb: invert(toY)! };
}

export interface DenoiseParams {
  /** darktable strength, 0.001 to 4 here (upstream allows up to 1000). */
  strength: number;
  /** Flat Y0 and U0V0 force, 0 to 1 (upstream default 0.5). */
  luma: number;
  chroma: number;
  /** Upstream's "preserve shadows" and "bias correction"; default inferred from the profile. */
  shadows?: number;
  bias?: number;
}

/** Everything per image that the per-pixel passes need, as process_wavelets sets it up. */
export interface DenoiseSetup {
  scales: number;
  /** Forward Y0U0V0 matrix, already divided by strength · 2.5 · inScale. */
  toY: Mat3;
  toRgb: Mat3;
  /** VST exponent per channel. */
  p: Vec3;
  /** a[1] · compensate_p, the VST's a. */
  a: number;
  /** b[1]. */
  b: number;
  /** bias - 0.5·ln(inScale), times the scaled white balance per channel. */
  biasWb: Vec3;
  /** Y0 and U0V0 threshold factors, 8 · force² · 4. */
  adjt: [number, number];
}

/**
 * process_wavelets' set-up. `wb` is the as-shot coefficients normalised to green
 * (compute_wb_factors with wb_adaptive_anscombe; [1, 1, 1] for an image without them).
 */
export function denoiseSetup(profile: Pick<NoiseProfile, 'a' | 'b'>, wb: Vec3, params: DenoiseParams, inScale: number, fullW: number, fullH: number): DenoiseSetup {
  const s = Math.min(inScale, 1);
  const shadows = params.shadows ?? inferShadows(profile.a[1]);
  const bias = params.bias ?? inferBias(profile.a[1]);
  const p = wb.map((w) => Math.max(shadows + 0.1 * Math.log(s / w), 0)) as Vec3;
  const compensateP = P_FULCRUM / Math.pow(P_FULCRUM, shadows);
  const { toY, toRgb } = conversionMatrices(wb);
  const k = params.strength * COMPENSATE_STRENGTH * s;
  const bt = bias - 0.5 * Math.log(s);
  return {
    scales: maxScale(s, fullW, fullH),
    toY: toY.map((r) => r.map((v) => v / k)) as Mat3,
    toRgb: toRgb.map((r) => r.map((v) => v * k)) as Mat3,
    p,
    a: profile.a[1] * compensateP,
    b: profile.b[1],
    biasWb: wb.map((w) => bt * w * k) as Vec3,
    adjt: [8 * params.luma * params.luma * 4, 8 * params.chroma * params.chroma * 4],
  };
}

/** precondition_Y0U0V0 for one pixel. */
export function precondition(rgb: Vec3, s: DenoiseSetup): Vec3 {
  const t = rgb.map((v, c) => Math.pow(Math.max(v + s.b, 0), 1 - s.p[c] / 2) * (2 / ((2 - s.p[c]) * Math.sqrt(s.a)))) as Vec3;
  return s.toY.map((r) => r[0] * t[0] + r[1] * t[1] + r[2] * t[2]) as Vec3;
}

/** backtransform_Y0U0V0 for one pixel: the low-bias inverse with upstream's bias term. */
export function backtransform(yuv: Vec3, s: DenoiseSetup): Vec3 {
  return s.toRgb.map((r, c) => {
    const x = Math.max(r[0] * yuv[0] + r[1] * yuv[1] + r[2] * yuv[2], 0);
    const delta = x * x + s.biasWb[c];
    const z = (x + Math.sqrt(Math.max(delta, 0))) * ((Math.sqrt(s.a) * (2 - s.p[c])) / 4);
    return Math.pow(z, 1 / (1 - s.p[c] / 2)) - s.b;
  }) as Vec3;
}

/** dn_weight: the edge-avoiding weight between two preconditioned pixels. */
export function dnWeight(c1: ArrayLike<number>, i1: number, c2: ArrayLike<number>, i2: number, invSigma2: number): number {
  let dot = 0;
  for (let c = 0; c < 3; c++) { const d = f32(c1[i1 + c] - c2[i2 + c]); dot = f32(dot + f32(d * d)); }
  dot = f32(dot * f32(invSigma2));
  return fastMexp2f(Math.max(0, f32(f32(dot * f32(0.02)) - 9)));
}

/**
 * eaw_dn_decompose for one scale: the coarse image (an edge-avoiding B3-spline blur with taps
 * 2^scale apart, nearest pixel at the edges), the detail it removed and the sum of its squares.
 */
export function decompose(input: Float32Array, w: number, h: number, scale: number): { coarse: Float32Array; detail: Float32Array; sumSq: Vec3 } {
  const mult = 1 << scale;
  const sigmaBand = Math.pow(VARF, scale);
  const inv = 1 / (sigmaBand * sigmaBand);
  const coarse = new Float32Array(w * h * 4), detail = new Float32Array(w * h * 4);
  const sumSq: Vec3 = [0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const sum = [0, 0, 0, 0];
    let wgt = 0, k = 0;
    for (let jj = 0; jj < 5; jj++) {
      const yy = Math.min(h - 1, Math.max(0, y + mult * (jj - 2)));
      for (let ii = 0; ii < 5; ii++) {
        const xx = Math.min(w - 1, Math.max(0, x + mult * (ii - 2)));
        const j = (yy * w + xx) * 4;
        const wt = FILTER[k++] * dnWeight(input, i, input, j, inv);
        wgt += wt;
        for (let c = 0; c < 4; c++) sum[c] += wt * input[j + c];
      }
    }
    for (let c = 0; c < 4; c++) {
      coarse[i + c] = sum[c] / wgt;
      detail[i + c] = input[i + c] - coarse[i + c];
      if (c < 3) sumSq[c] += detail[i + c] * detail[i + c];
    }
  }
  return { coarse, detail, sumSq };
}

/** variance_stabilizing_xform: BayesShrink thresholds for one scale (Y0, U0, V0). */
export function thresholds(scale: number, pixels: number, sumSq: Vec3, adjt: [number, number]): Vec3 {
  const sb2 = Math.pow(VARF, scale) ** 2;
  return sumSq.map((s, c) => {
    const stdX = Math.sqrt(Math.max(1e-6, s / (pixels - 1) - sb2));
    return ((c === 0 ? adjt[0] : adjt[1]) * sb2) / stdX;
  }) as Vec3;
}

/** accumulate: soft-threshold the detail and add it to the output. */
export const shrink = (d: number, t: number) => Math.max(d - t, 0) + Math.min(d + t, 0);

/**
 * process_wavelets: denoise an RGBA image in darktable's domain (alpha passes through). An image
 * too small for its coarsest band is returned unchanged, as upstream.
 */
export function denoiseWavelets(img: Float32Array, w: number, h: number, s: DenoiseSetup): Float32Array {
  // Upstream's guard; with no scales at all its shift is negative and the guard never trips,
  // so only the two transforms run (as the compiled C does).
  const maxMult = s.scales > 0 ? 1 << (s.scales - 1) : 0;
  if (w < 2 * maxMult || h < 2 * maxMult) return img.slice();
  let buf: Float32Array = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h * 4; i += 4) {
    const v = precondition([img[i], img[i + 1], img[i + 2]], s);
    buf[i] = v[0]; buf[i + 1] = v[1]; buf[i + 2] = v[2]; buf[i + 3] = img[i + 3];
  }
  const out = new Float32Array(w * h * 4);
  for (let scale = 0; scale < s.scales; scale++) {
    const { coarse, detail, sumSq } = decompose(buf, w, h, scale);
    const t = thresholds(scale, w * h, sumSq, s.adjt);
    for (let i = 0; i < w * h * 4; i += 4) for (let c = 0; c < 3; c++) out[i + c] += shrink(detail[i + c], t[c]);
    buf = coarse;
  }
  for (let i = 0; i < w * h * 4; i += 4) {
    const v = backtransform([out[i] + buf[i], out[i + 1] + buf[i + 1], out[i + 2] + buf[i + 2]], s);
    out[i] = v[0]; out[i + 1] = v[1]; out[i + 2] = v[2]; out[i + 3] = img[i + 3];
  }
  return out;
}

/**
 * The as-shot coefficients normalised to green, darktable's `wb`, from the decoder's neutral
 * (LibRaw's 1 / multiplier normalised by its maximum).
 */
export const wbFromNeutral = (neutral: Vec3 | null): Vec3 => (neutral ? [neutral[1] / neutral[0], 1, neutral[1] / neutral[2]] : [1, 1, 1]);

/**
 * Working Rec.2020 (× baseline gain) to darktable's domain and back. LibRaw scales its output by
 * multiplier / smallest multiplier, darktable by multiplier / green multiplier, so the two differ
 * by green's neutral.
 */
export function domainMatrices(cameraToWorking: Mat3, neutral: Vec3 | null, baselineGain: number): { toDt: Mat3; fromDt: Mat3 } {
  const g = neutral ? neutral[1] : 1;
  const toCam = invert3(cameraToWorking);
  const toDt = toCam.map((r) => r.map((v) => (v * g) / baselineGain)) as Mat3;
  const fromDt = cameraToWorking.map((r) => r.map((v) => (v * baselineGain) / g)) as Mat3;
  return { toDt, fromDt };
}
