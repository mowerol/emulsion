// Copyright (c) 2012 Oliver Duis <www.oliverduis.de>
// Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
// Ported from RawTherapee rtengine/dcp.cc, color.h, curves.h/cc, diagonalcurves.cc
// and iccmatrices.h at b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c.
// DCP matrices/dual-illuminant interpolation, HSV calibration/look tables and Adobe
// tone curve, translated to TypeScript; per-pixel twin in stages/dcp.glsl.
// Native camera neutral is supplied directly instead of RT's sRGB WB/pre_mul wrapper.
// RT's D50-adapted Rec2020 matrices connect the same working primaries to its D50 PCS.
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Mat3, Vec3 } from '../film/stocks';
import type { CameraMetadata } from '../film/profiles';
import { invert3, mulMat, mulVec } from './color';
import adobeDefault from './dcp-adobe-curve.json';

export interface DcpTable {
  dims: Vec3;
  gamma: boolean;
  data: Float32Array;
}
export interface DcpProfile {
  name: string;
  camera: string;
  copyright: string;
  matrix1: Mat3;
  matrix2: Mat3 | null;
  forward1: Mat3 | null;
  forward2: Mat3 | null;
  temperature1: number;
  temperature2: number;
  map1: DcpTable | null;
  map2: DcpTable | null;
  look: DcpTable | null;
  curve: Float32Array | null;
  exposure: number;
}
export interface DcpState {
  profile: DcpProfile;
  matrix: Mat3;
  toCamera: Mat3;
  map: DcpTable | null;
  scale: number;
  key: string;
}
export const XYZ_PROPHOTO: Mat3 = [
  [0.7976749, 0.1351917, 0.0313534],
  [0.2880402, 0.7118741, 0.0000857],
  [0, 0, 0.82521],
];
export const PROPHOTO_XYZ: Mat3 = [
  [1.3459433, -0.2556075, -0.0511118],
  [-0.5445989, 1.5081673, 0.0205351],
  [0, 0, 1.2118128],
];
export const XYZ_REC2020_D50: Mat3 = [
  [0.6734241, 0.1656411, 0.1251286],
  [0.2790177, 0.6753402, 0.0456377],
  [-0.00193, 0.0299784, 0.797333],
];
export const REC2020_XYZ_D50: Mat3 = [
  [1.6473376, -0.3935675, -0.2359961],
  [-0.6826036, 1.6475887, 0.012819],
  [0.0296524, -0.0628993, 1.2531279],
];
export const TO_PROPHOTO = mulMat(PROPHOTO_XYZ, XYZ_REC2020_D50);
export const FROM_PROPHOTO = mulMat(REC2020_XYZ_D50, XYZ_PROPHOTO);
const XYZ_SRGB: Mat3 = [
  [0.4360747, 0.3850649, 0.1430804],
  [0.2225045, 0.7168786, 0.0606169],
  [0.0139322, 0.0971045, 0.7141733],
];
const BRADFORD: Mat3 = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
];
const I: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const mixMatrix = (a: Mat3, b: Mat3, w: number): Mat3 =>
  a.map((row, i) => row.map((v, j) => v * w + b[i][j] * (1 - w))) as Mat3;
export const illuminantTemperature = (light: number) =>
  (
    ({
      3: 2850,
      17: 2850,
      24: 3200,
      23: 5000,
      20: 5500,
      1: 5500,
      9: 5500,
      4: 5500,
      18: 5500,
      21: 6500,
      19: 6500,
      10: 6500,
      22: 7500,
      11: 7500,
      12: 6400,
      13: 5050,
      14: 4150,
      2: 4150,
      15: 3525,
      16: 2925,
    }) as Record<number, number>
  )[light] ?? 0;

/** Bounded DCP TIFF reader. DCPs contain a single IFD; external offsets are checked. */
export function parseDcp(bytes: ArrayBuffer, fallbackName = 'Camera profile'): DcpProfile {
  if (bytes.byteLength < 8 || bytes.byteLength > 16 * 1024 * 1024) throw Error('DCP size is invalid');
  const d = new DataView(bytes),
    le = d.getUint16(0) === 0x4949;
  if (!le && d.getUint16(0) !== 0x4d4d) throw Error('Not a DCP camera profile');
  const magic = d.getUint16(2, le);
  if (magic !== 42 && magic !== 0x4352) throw Error('Unsupported DCP header');
  const ifd = d.getUint32(4, le);
  const within = (at: number, n: number) => {
    if (!Number.isSafeInteger(at) || at < 0 || n < 0 || at + n > bytes.byteLength) throw Error('DCP tag is truncated');
  };
  within(ifd, 2);
  const count = d.getUint16(ifd, le);
  if (count > 4096) throw Error('Too many DCP tags');
  within(ifd + 2, count * 12 + 4);
  const tags = new Map<number, { type: number; count: number; at: number }>();
  for (let i = 0; i < count; i++) {
    const p = ifd + 2 + i * 12,
      id = d.getUint16(p, le),
      type = d.getUint16(p + 2, le),
      n = d.getUint32(p + 4, le);
    const size = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][type];
    if (!size || n > 4 * 1024 * 1024) throw Error('Unsupported DCP tag type/size');
    const at = n * size <= 4 ? p + 8 : d.getUint32(p + 8, le);
    within(at, n * size);
    tags.set(id, { type, count: n, at });
  }
  const numbers = (id: number): number[] => {
    const t = tags.get(id);
    if (!t) return [];
    const out: number[] = [];
    for (let i = 0; i < t.count; i++) {
      const p = t.at + i * [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][t.type];
      let v: number;
      switch (t.type) {
        case 1:
        case 7:
          v = d.getUint8(p);
          break;
        case 3:
          v = d.getUint16(p, le);
          break;
        case 4:
          v = d.getUint32(p, le);
          break;
        case 5:
          v = d.getUint32(p, le) / d.getUint32(p + 4, le);
          break;
        case 9:
          v = d.getInt32(p, le);
          break;
        case 10:
          v = d.getInt32(p, le) / d.getInt32(p + 4, le);
          break;
        case 11:
          v = d.getFloat32(p, le);
          break;
        case 12:
          v = d.getFloat64(p, le);
          break;
        default:
          throw Error('DCP numeric tag has wrong type');
      }
      if (!Number.isFinite(v)) throw Error('DCP contains a non-finite value');
      out.push(v);
    }
    return out;
  };
  const text = (id: number) => {
    const t = tags.get(id);
    return t
      ? new TextDecoder()
          .decode(new Uint8Array(bytes, t.at, t.count))
          .replace(/\0.*$/s, '')
          .trim()
      : '';
  };
  const matrix = (id: number): Mat3 | null => {
    const a = numbers(id);
    if (!a.length) return null;
    if (a.length !== 9) throw Error('DCP matrix must have nine values');
    const m = [a.slice(0, 3), a.slice(3, 6), a.slice(6, 9)] as Mat3;
    if (!invert3(m).flat().every(Number.isFinite)) throw Error('DCP matrix is singular');
    return m;
  };
  const table = (dimsId: number, dataId: number, encodingId: number): DcpTable | null => {
    const dims = numbers(dimsId);
    if (!dims.length) return null;
    if (
      dims.length !== 3 ||
      dims.some((v) => !Number.isInteger(v) || v < 1 || v > 256) ||
      dims[1] < 2 ||
      dims[0] * dims[1] * dims[2] > 1048576
    )
      throw Error('Unsupported DCP HSV table dimensions');
    const data = numbers(dataId);
    if (data.length !== dims[0] * dims[1] * dims[2] * 3) throw Error('DCP HSV table is incomplete');
    const enc = numbers(encodingId)[0] ?? 0;
    if (enc !== 0 && enc !== 1) throw Error('Unsupported DCP table encoding');
    return { dims: dims as Vec3, data: new Float32Array(data), gamma: enc === 1 };
  };
  const matrix1 = matrix(50721) ?? matrix(50722);
  if (!matrix1) throw Error('DCP has no camera colour matrix');
  const copyright = text(50942),
    points = numbers(50940);
  let curve: Float32Array | null = null;
  if (points.length) {
    if (points.length < 4 || points.length % 2) throw Error('DCP tone curve is incomplete');
    if (points.some((v, i) => v < 0 || v > 1 || (i % 2 === 0 && i > 0 && v <= points[i - 2])))
      throw Error('DCP tone points are invalid');
    if (points.some((v, i) => i % 2 === 1 && v !== points[i - 1])) curve = toneCurve(points);
  } else if (copyright.includes('Adobe Systems'))
    curve = toneCurve(adobeDefault.flatMap((v, i) => [i / (adobeDefault.length - 1), v]));
  const exposure = numbers(51109)[0] ?? 0;
  if (Math.abs(exposure) > 16) throw Error('DCP baseline exposure is unsupported');
  const map1 = table(50937, 50938, 51107),
    map2 = tags.has(50939) ? table(50937, 50939, 51107) : null;
  return {
    name: text(50936) || fallbackName,
    camera: text(50708),
    copyright,
    matrix1,
    matrix2: matrix(50722),
    forward1: matrix(50964),
    forward2: matrix(50965),
    temperature1: illuminantTemperature(numbers(50778)[0] ?? -1),
    temperature2: illuminantTemperature(numbers(50779)[0] ?? -1),
    map1,
    map2,
    look: table(50981, 50982, 51108),
    curve,
    exposure,
  };
}

/** RawTherapee natural spline -> 65536-entry float ToneCurve::Set(gamma=0). */
export function toneCurve(points: number[]): Float32Array {
  const n = points.length / 2,
    x = points.filter((_, i) => i % 2 === 0),
    y = points.filter((_, i) => i % 2 === 1),
    second = new Array(n).fill(0),
    u = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const sig = (x[i] - x[i - 1]) / (x[i + 1] - x[i - 1]),
      p = sig * second[i - 1] + 2;
    second[i] = (sig - 1) / p;
    u[i] =
      ((6 * ((y[i + 1] - y[i]) / (x[i + 1] - x[i]) - (y[i] - y[i - 1]) / (x[i] - x[i - 1]))) / (x[i + 1] - x[i - 1]) -
        sig * u[i - 1]) /
      p;
  }
  for (let k = n - 2; k >= 0; k--) second[k] = second[k] * second[k + 1] + u[k];
  const out = new Float32Array(65536);
  let lo = 0;
  for (let i = 0; i < 65536; i++) {
    const t = Math.fround(i / 65535);
    if (t < x[0]) {
      out[i] = y[0];
      continue;
    }
    if (t > x[n - 1]) {
      out[i] = y[n - 1];
      continue;
    }
    while (lo < n - 2 && t > x[lo + 1]) lo++;
    const hi = lo + 1,
      h = x[hi] - x[lo],
      a = (x[hi] - t) / h,
      b = (t - x[lo]) / h;
    out[i] = clamp(a * y[lo] + b * y[hi] + (((a * a * a - a) * second[lo] + (b * b * b - b) * second[hi]) * h * h) / 6);
  }
  return out;
}

const TEMPERATURE_LINES = [
  [0.0, 0.18006, 0.26352, -0.24341],
  [10.0, 0.18066, 0.26589, -0.25479],
  [20.0, 0.18133, 0.26846, -0.26876],
  [30.0, 0.18208, 0.27119, -0.28539],
  [40.0, 0.18293, 0.27407, -0.3047],
  [50.0, 0.18388, 0.27709, -0.32675],
  [60.0, 0.18494, 0.28021, -0.35156],
  [70.0, 0.18611, 0.28342, -0.37915],
  [80.0, 0.1874, 0.28668, -0.40955],
  [90.0, 0.1888, 0.28997, -0.44278],
  [100.0, 0.19032, 0.29326, -0.47888],
  [125.0, 0.19462, 0.30141, -0.58204],
  [150.0, 0.19962, 0.30921, -0.70471],
  [175.0, 0.20525, 0.31647, -0.84901],
  [200.0, 0.21142, 0.32312, -1.0182],
  [225.0, 0.21807, 0.32909, -1.2168],
  [250.0, 0.22511, 0.33439, -1.4512],
  [275.0, 0.23247, 0.33904, -1.7298],
  [300.0, 0.2401, 0.34308, -2.0637],
  [325.0, 0.24702, 0.34655, -2.4681],
  [350.0, 0.25591, 0.34951, -2.9641],
  [375.0, 0.264, 0.352, -3.5814],
  [400.0, 0.27218, 0.35407, -4.3633],
  [425.0, 0.28039, 0.35577, -5.3762],
  [450.0, 0.28863, 0.35714, -6.7262],
  [475.0, 0.29685, 0.35823, -8.5955],
  [500.0, 0.30505, 0.35907, -11.324],
  [525.0, 0.3132, 0.35968, -15.628],
  [550.0, 0.32129, 0.36011, -23.325],
  [575.0, 0.32931, 0.36038, -40.77],
  [600.0, 0.33724, 0.36051, -116.45],
];

export function dcpTemperature(xy: [number, number]): number {
  const u = (2 * xy[0]) / (1.5 - xy[0] + 6 * xy[1]),
    v = (3 * xy[1]) / (1.5 - xy[0] + 6 * xy[1]);
  let last = 0;
  for (let i = 1; i <= 30; i++) {
    const line = TEMPERATURE_LINES[i],
      len = Math.sqrt(1 + line[3] * line[3]),
      du = 1 / len,
      dv = line[3] / len;
    let dt = -(u - line[1]) * dv + (v - line[2]) * du;
    if (dt <= 0 || i === 30) {
      dt = -Math.min(dt, 0);
      const f = i === 1 ? 0 : dt / (last + dt);
      return 1e6 / (TEMPERATURE_LINES[i - 1][0] * f + line[0] * (1 - f));
    }
    last = dt;
  }
  return 0;
}
function xyToXyz(xy: [number, number]): Vec3 {
  let x = clamp(xy[0], 1e-6, 0.999999),
    y = clamp(xy[1], 1e-6, 0.999999);
  if (x + y > 0.999999) {
    const k = 0.999999 / (x + y);
    x *= k;
    y *= k;
  }
  return [x / y, 1, (1 - x - y) / y];
}
function xyzToXy(x: Vec3): [number, number] {
  const sum = x[0] + x[1] + x[2];
  return sum > 0 ? [x[0] / sum, x[1] / sum] : [0.3457, 0.3585];
}
const weight = (t: number, a: number, b: number) => (t <= a ? 1 : t >= b ? 0 : (1 / t - 1 / b) / (1 / a - 1 / b));
function profileMatrix(p: DcpProfile, xy: [number, number]): Mat3 {
  return p.matrix2
    ? mixMatrix(p.matrix1, p.matrix2, weight(dcpTemperature(xy), p.temperature1, p.temperature2))
    : p.matrix1;
}
export function dcpWhite(p: DcpProfile, neutral: Vec3): [number, number] {
  let last: [number, number] = [0.3457, 0.3585];
  for (let pass = 0; pass < 30; pass++) {
    let next = xyzToXy(mulVec(invert3(profileMatrix(p, last)), neutral));
    if (Math.abs(next[0] - last[0]) + Math.abs(next[1] - last[1]) < 1e-7) return next;
    if (pass === 29) next = [(last[0] + next[0]) * 0.5, (last[1] + next[1]) * 0.5];
    last = next;
  }
  return last;
}
function mapWhite(a: Vec3, b: Vec3): Mat3 {
  const aw = mulVec(BRADFORD, a).map((v) => Math.max(0, v)),
    bw = mulVec(BRADFORD, b).map((v) => Math.max(0, v));
  const diag = I.map((r, i) => r.map((v, j) => (i === j ? clamp(aw[i] > 0 ? bw[i] / aw[i] : 10, 0.1, 10) : v))) as Mat3;
  return mulMat(mulMat(invert3(BRADFORD), diag), BRADFORD);
}
/** Same normalized white-balanced CameraRGB -> D50 XYZ conversion as RT makeXyzCam. */
export function dcpCameraToXyz(p: DcpProfile, neutral: Vec3): Mat3 {
  const xy = dcpWhite(p, neutral),
    w = weight(dcpTemperature(xy), p.temperature1, p.temperature2),
    color = profileMatrix(p, xy),
    white = xyToXyz(xy);
  let camXyz: Mat3;
  if (p.forward1 || p.forward2) {
    const f = p.forward1 && p.forward2 ? mixMatrix(p.forward1, p.forward2, w) : (p.forward1 ?? p.forward2)!;
    const cw = mulVec(color, white);
    const diag: Mat3 = [
      [cw[0], 0, 0],
      [0, cw[1], 0],
      [0, 0, cw[2]],
    ];
    camXyz = invert3(mulMat(f, invert3(diag)));
  } else camXyz = mulMat(color, mapWhite([0.3457, 0.3585, 0.2958], white));
  const camRgb = mulMat(camXyz, XYZ_SRGB).map((r) => {
    const sum = r[0] + r[1] + r[2];
    return r.map((v) => v / sum);
  }) as Mat3;
  const out = mulMat(XYZ_SRGB, invert3(camRgb));
  if (!out.flat().every(Number.isFinite)) throw Error('DCP matrix is singular');
  return out;
}
export function dcpCommit(p: DcpProfile, camera: CameraMetadata, id: string, temperature?: number): DcpState {
  if (!camera.neutral) throw Error('Camera as-shot neutral is unavailable');
  let map = p.map1;
  if (map && p.map2 && p.temperature1 > 0 && p.temperature2 > 0 && p.temperature1 !== p.temperature2) {
    const reverse = p.temperature1 > p.temperature2,
      a = Math.min(p.temperature1, p.temperature2),
      b = Math.max(p.temperature1, p.temperature2);
    let w = weight(temperature ?? dcpTemperature(dcpWhite(p, camera.neutral)), a, b);
    if (reverse) w = 1 - w;
    const data = new Float32Array(map.data.length);
    for (let i = 0; i < data.length; i++)
      data[i] = Math.fround(w) * map.data[i] + Math.fround(1 - Math.fround(w)) * p.map2.data[i];
    map = { ...map, data };
  }
  const matrix = mulMat(PROPHOTO_XYZ, dcpCameraToXyz(p, camera.neutral));
  return {
    profile: p,
    matrix,
    toCamera: invert3(camera.cameraToWorking),
    map,
    scale: camera.baselineGain,
    key: `${id}|${JSON.stringify(camera)}|${temperature ?? ''}`,
  };
}

// The exact sampled continuous sRGB gamma used by RT's LUTf, including linear extrapolation.
const rtGamma = (x: number, inverse: boolean) =>
  inverse
    ? x <= 0.039286
      ? x / 12.9231
      : Math.pow((x + 0.055) / 1.055, 2.4)
    : x <= 0.00304
      ? x * 12.9231
      : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
export function dcpGamma(x: number, inverse = false): number {
  const at = x * 65535,
    i = clamp(Math.trunc(at), 0, 65534),
    a = Math.fround(rtGamma(i / 65535, inverse)),
    b = Math.fround(rtGamma((i + 1) / 65535, inverse));
  return a + (b - a) * (at - i);
}
/** HSV uses hue 0..6; saturation/value are normalized, as in rgb2hsvdcp. */
export function dcpHsv(rgb: Vec3): Vec3 {
  const lo = Math.min(...rgb),
    hi = Math.max(...rgb),
    delta = hi - lo;
  let h = 0,
    s = 0;
  if (delta >= 1e-5 / 65535) {
    s = delta / hi;
    h =
      hi === rgb[0]
        ? (rgb[1] - rgb[2]) / delta
        : hi === rgb[1]
          ? 2 + (rgb[2] - rgb[0]) / delta
          : 4 + (rgb[0] - rgb[1]) / delta;
    if (h < 0) h += 6;
    else if (h > 6) h -= 6;
  }
  return [h, s, hi];
}
export function dcpRgb([h, s, v]: Vec3): Vec3 {
  const sector = Math.trunc(h),
    f = h - sector,
    vs = v * s,
    p = v - vs,
    q = v - f * vs,
    t = p + v - q;
  return (
    sector === 1
      ? [q, v, p]
      : sector === 2
        ? [p, v, t]
        : sector === 3
          ? [p, q, v]
          : sector === 4
            ? [t, p, v]
            : sector === 5
              ? [v, p, q]
              : [v, t, p]
  ) as Vec3;
}
export function dcpHsd(t: DcpTable, [h, s, v]: Vec3): Vec3 {
  const [nh, ns, nv] = t.dims,
    hh = h * (nh < 2 ? 0 : nh / 6),
    ss = s * (ns - 1);
  let h0 = Math.trunc(hh),
    h1 = h0 + 1;
  if (h0 >= nh - 1) {
    h0 = nh - 1;
    h1 = 0;
  }
  h0 = Math.max(h0, 0);
  const s0 = clamp(Math.trunc(ss), 0, ns - 2),
    hf = hh - h0,
    sf = ss - s0;
  let encoded = v,
    vf = 0,
    v0 = 0;
  if (nv >= 2) {
    if (t.gamma) encoded = dcpGamma(v);
    const vv = encoded * (nv - 1);
    v0 = clamp(Math.trunc(vv), 0, nv - 2);
    vf = vv - v0;
  }
  const at = (hh: number, sv: number, vv: number, c: number) => t.data[((vv * nh + hh) * ns + sv) * 3 + c];
  const sample = (sv: number, vv: number, c: number) => at(h0, sv, vv, c) * (1 - hf) + at(h1, sv, vv, c) * hf;
  const out = [0, 1, 2].map((c) => {
    const a = sample(s0, v0, c) * (1 - sf) + sample(s0 + 1, v0, c) * sf;
    return nv < 2 ? a : a * (1 - vf) + (sample(s0, v0 + 1, c) * (1 - sf) + sample(s0 + 1, v0 + 1, c) * sf) * vf;
  });
  return [h + out[0] / 60, s * out[1], t.gamma ? dcpGamma(encoded * out[2], true) : v * out[2]];
}
const wrapHue = (h: Vec3): Vec3 => [h[0] < 0 ? h[0] + 6 : h[0] >= 6 ? h[0] - 6 : h[0], h[1], h[2]];
const allOog = (x: Vec3) => x.every((v) => v < 0 || v > 1);
export function dcpTone(curve: Float32Array, x: Vec3): Vec3 {
  if (allOog(x)) return x;
  const c = x.map((v) => clamp(v)) as Vec3,
    lo = Math.min(...c),
    hi = Math.max(...c),
    lookup = (v: number) => {
      const p = v * 65535,
        i = Math.min(65534, Math.floor(p));
      return curve[i] + (curve[i + 1] - curve[i]) * (p - i);
    };
  if (hi === lo) return c.map(lookup) as Vec3;
  const a = lookup(lo),
    b = lookup(hi);
  return c.map((v) => (v === lo ? a : v === hi ? b : a + ((b - a) * (v - lo)) / (hi - lo))) as Vec3;
}
export function dcpEarly(x: Vec3, state: DcpState): Vec3 {
  let p = mulVec(state.matrix, mulVec(state.toCamera, x).map((v) => v / state.scale) as Vec3);
  if (state.map && p.every((v) => v >= 0)) p = dcpRgb(wrapHue(dcpHsd(state.map, dcpHsv(p))));
  return mulVec(FROM_PROPHOTO, p).map((v) => v * state.scale) as Vec3;
}
export function dcpLateProphoto(x: Vec3, profile: Pick<DcpProfile, 'exposure' | 'look' | 'curve'>): Vec3 {
  let p = x.map((v) => v * 2 ** profile.exposure) as Vec3;
  if (!profile.look && !profile.curve) return p;
  p = p.map((v) => Math.max(0, v)) as Vec3;
  if (profile.look && !allOog(p)) {
    let h = dcpHsd(profile.look, dcpHsv(p.map((v) => clamp(v, 0, 65535.5 / 65535)) as Vec3));
    h = [h[0], clamp(h[1]), clamp(h[2])];
    p = dcpRgb(wrapHue(h));
  }
  if (profile.curve) p = dcpTone(profile.curve, p);
  return p;
}
export function dcpLate(x: Vec3, state: DcpState): Vec3 {
  return mulVec(FROM_PROPHOTO, dcpLateProphoto(mulVec(TO_PROPHOTO, x), state.profile));
}

/** Native RT gamma tables, packed together so HDR extrapolation uses the same float samples. */
export function dcpGammaData(): Float32Array {
  const data = new Float32Array(65536 * 4);
  for (let i = 0; i < 65536; i++) {
    data[i * 4] = rtGamma(i / 65535, false);
    data[i * 4 + 1] = rtGamma(i / 65535, true);
  }
  return data;
}
