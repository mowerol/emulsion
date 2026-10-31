// Copyright (C) 2020-2026 darktable developers (src/iop/sigmoid.c).
// Copyright (C) 2023 darktable developers (src/common/custom_primaries.c).
// Copyright (C) 2010-2026 darktable developers (src/common/colorspaces.c).
// Ported from darktable at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2):
// sigmoid.c _calculate_adjusted_primaries, custom_primaries.c dt_rotate_and_scale_primary and
// colorspaces.c dt_make_transposed_matrices_from_primaries_and_whitepoint. Translated from C to
// TypeScript, with matrices in the ordinary (not transposed) layout. The base primaries are
// darktable's linear Rec.2020 profile, which is also Emulsion's working space, so the pipe to base
// matrix is the identity, as in darktable's special case.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Sigmoid's primaries: before the per-channel curve, the pixel is moved into a set of primaries
// pulled in towards white (inset, "attenuation" in darktable's interface) and turned (rotation), so
// bright saturated colours desaturate gracefully and hues shift as film's do; after the curve, it is
// moved back through the same primaries scaled out again by "recover purity".

import type { Mat3, Vec3 } from '../film/stocks';
import { mulMat } from './color';

type Xy = [number, number];

/** Sigmoid's primaries settings. Rotation in degrees, as darktable's sliders show it (radians in its params). */
export interface SigmoidPrimaries {
  /** Per-primary attenuation, 0 to 0.99, red, green, blue. */
  inset: Vec3;
  /** Per-primary rotation in degrees, -0.4 to 0.4 rad (about ±22.9°). */
  rotation: Vec3;
  /** Recover purity, 0 to 1. */
  purity: number;
}

export const NO_PRIMARIES: SigmoidPrimaries = { inset: [0, 0, 0], rotation: [0, 0, 0], purity: 0 };

/** darktable's "smooth" preset. */
export const SMOOTH_PRIMARIES: SigmoidPrimaries = { inset: [0.1, 0.1, 0.15], rotation: [2, -1, -3], purity: 0 };

export function invert3(m: Mat3): Mat3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

const FLT_EPSILON = 1.1920929e-7;

function sanitizeY(y: number) {
  if (y < FLT_EPSILON && y >= 0) return FLT_EPSILON;
  if (y < 0 && y > -FLT_EPSILON) return -FLT_EPSILON;
  return y;
}

/** dt_make_transposed_matrices_from_primaries_and_whitepoint, as an RGB to XYZ matrix. */
export function rgbToXyzFromPrimaries(primaries: [Xy, Xy, Xy], white: Xy): Mat3 {
  // columns: each primary's XYZ at Y = 1 (darktable stores them as rows of the transposed matrix)
  const cols = primaries.map(([x, yy]) => {
    const y = sanitizeY(yy);
    return [x / y, 1, (1 - x - y) / y];
  });
  const P: Mat3 = [0, 1, 2].map((r) => [cols[0][r], cols[1][r], cols[2][r]]) as Mat3;
  const y = sanitizeY(white[1]);
  const W: Vec3 = [white[0] / y, 1, (1 - white[0] - y) / y];
  const inv = invert3(P);
  const scale = [0, 1, 2].map((i) => inv[i][0] * W[0] + inv[i][1] * W[1] + inv[i][2] * W[2]);
  return P.map((row) => row.map((v, j) => v * scale[j])) as Mat3;
}

// ---------- darktable's linear Rec.2020 profile, as darktable's pipe sees it ----------
// darktable makes the profile with lcms from the Rec.2020 primaries and its D65; lcms adapts the
// colorants to the ICC's D50 with Bradford and writes D50 as the media white. Those colorants and
// that white are the profile's primaries and whitepoint (dt_colorspaces_get_primaries_and_whitepoint_from_profile).

const REC2020_XY: [Xy, Xy, Xy] = [[0.708, 0.292], [0.17, 0.797], [0.131, 0.046]];
const DT_D65_XYZ: Vec3 = [0.95045471, 1, 1.08905029];
const LCMS_D50_XYZ: Vec3 = [0.9642, 1, 0.8249];
const BRADFORD: Mat3 = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
];

const xyOf = (v: readonly number[]): Xy => [v[0] / (v[0] + v[1] + v[2]), v[1] / (v[0] + v[1] + v[2])];

function bradford(from: Vec3, to: Vec3): Mat3 {
  const cone = (w: Vec3) => [0, 1, 2].map((i) => BRADFORD[i][0] * w[0] + BRADFORD[i][1] * w[1] + BRADFORD[i][2] * w[2]);
  const s = cone(from), d = cone(to);
  const D: Mat3 = [[d[0] / s[0], 0, 0], [0, d[1] / s[1], 0], [0, 0, d[2] / s[2]]];
  return mulMat(invert3(BRADFORD), mulMat(D, BRADFORD));
}

const REC2020_D50 = mulMat(bradford(DT_D65_XYZ, LCMS_D50_XYZ), rgbToXyzFromPrimaries(REC2020_XY, xyOf(DT_D65_XYZ)));

/** The base profile's primaries and whitepoint in xy, as darktable reads them from the profile. */
export const BASE = {
  primaries: [0, 1, 2].map((c) => xyOf(REC2020_D50.map((row) => row[c]))) as [Xy, Xy, Xy],
  white: xyOf(LCMS_D50_XYZ),
};

const BASE_TO_XYZ = rgbToXyzFromPrimaries(BASE.primaries, BASE.white);
const XYZ_TO_BASE = invert3(BASE_TO_XYZ);

// ---------- custom_primaries.c ----------

const determinant = (a: number, b: number, c: number, d: number) => a * d - b * c;

function intersectLineSegments(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) {
  const denominator = determinant(x1 - x2, x3 - x4, y1 - y2, y3 - y4);
  if (denominator === 0) return Infinity; // lines don't intersect
  const t = determinant(x1 - x3, x3 - x4, y1 - y3, y3 - y4) / denominator;
  return t >= 0 ? t : Infinity; // intersection is in the wrong direction
}

function distanceToEdge(cos: number, sin: number) {
  const [x1, y1] = BASE.white;
  let d = Infinity;
  for (let i = 0; i < 3; i++) {
    const [x3, y3] = BASE.primaries[i];
    const [x4, y4] = BASE.primaries[i === 2 ? 0 : i + 1];
    d = Math.min(d, intersectLineSegments(x1, y1, x1 + cos, y1 + sin, x3, y3, x4, y4));
  }
  return d;
}

/** dt_rotate_and_scale_primary: a primary turned by `rotation` radians and scaled towards white. */
export function rotateAndScalePrimary(scaling: number, rotation: number, i: number): Xy {
  const dx = BASE.primaries[i][0] - BASE.white[0];
  const dy = BASE.primaries[i][1] - BASE.white[1];
  const angle = Math.atan2(dy, dx) + rotation;
  const c = Math.cos(angle), s = Math.sin(angle);
  const d = distanceToEdge(c, s);
  return [scaling * d * c + BASE.white[0], scaling * d * s + BASE.white[1]];
}

// ---------- sigmoid.c ----------

/**
 * _calculate_adjusted_primaries: `input` takes a working-space pixel into the rendering primaries
 * (base_to_rendering), `output` takes the curve's result back (rendering_to_pipe).
 */
export function adjustedPrimaries(p: SigmoidPrimaries): { input: Mat3; output: Mat3 } {
  const rad = p.rotation.map((d) => (d * Math.PI) / 180);
  const custom = [0, 1, 2].map((i) => rotateAndScalePrimary(1 - p.inset[i], rad[i], i)) as [Xy, Xy, Xy];
  const input = mulMat(XYZ_TO_BASE, rgbToXyzFromPrimaries(custom, BASE.white));
  const scaled = [0, 1, 2].map((i) => rotateAndScalePrimary(1 - p.purity * p.inset[i], rad[i], i)) as [Xy, Xy, Xy];
  const output = invert3(mulMat(XYZ_TO_BASE, rgbToXyzFromPrimaries(scaled, BASE.white)));
  return { input, output };
}
