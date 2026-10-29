// SPDX-License-Identifier: GPL-3.0-or-later
// Colour space constants. The working space is linear Rec.2020.

import type { Mat3, Vec3 } from '../film/stocks';

/** Linear sRGB (Rec.709 primaries) to linear Rec.2020, from ITU-R BT.2087. */
export const SRGB_TO_REC2020: Mat3 = [
  [0.627403895934699, 0.329283038377884, 0.043313065687417],
  [0.069097289358232, 0.919540395075459, 0.011362315566309],
  [0.01639143887515, 0.088013307877226, 0.895595253247624],
];

/** Linear Rec.2020 to linear sRGB, the inverse of the above. */
export const REC2020_TO_SRGB: Mat3 = [
  [1.660491002108435, -0.58764113878855, -0.072849863319885],
  [-0.124550474521591, 1.13289989712596, -0.008349422604369],
  [-0.018150763354905, -0.100578898008007, 1.118729661362913],
];

export const LUMA_REC2020: Vec3 = [0.2627, 0.678, 0.0593];
export const LUMA_REC709: Vec3 = [0.2126, 0.7152, 0.0722];

/** WebGL expects column-major matrices. */
export function columnMajor(m: Mat3): number[] {
  return [m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]];
}

export function mulMat(a: Mat3, b: Mat3): Mat3 {
  const r = [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));
  return r as Mat3;
}

export function mulVec(m: Mat3, v: Vec3): Vec3 {
  return [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as Vec3;
}

export const srgbEotf = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
export const srgbOetf = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
