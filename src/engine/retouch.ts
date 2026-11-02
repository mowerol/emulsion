// Copyright (C) 2017-2026 darktable developers.
// Copyright (C) 2013-2025 darktable developers (circle and ellipse masks).
// Ported from darktable src/iop/retouch.c (process, rt_process_forms, rt_masks_point_calc_delta
// with distort_mode 2, rt_intersect_2_rois, rt_copy_in_to_out, rt_build_scaled_mask,
// rt_copy_image_masked, _retouch_clone, _retouch_heal, _retouch_fill, _retouch_blur,
// rt_process_stats, rt_clamp_minmax, rt_adjust_levels), src/develop/masks/circle.c
// (_points_to_transform, _bounding_box, _circle_get_mask) and src/develop/masks/ellipse.c
// (_ellipse_points_to_transform, _bounding_box, _ellipse_get_area, _ellipse_get_mask, _fill_mask)
// at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2). Translated from C to
// TypeScript. The wavelet decomposition is engine/dwt.ts, the bilateral grid engine/bilateral.ts.
// retouchInputs follows rt_compute_roi_in's source dependency closure conservatively: grow the
// input bounding rectangle until every included form's complete destination and source fit.
//
// Emulsion runs this on the CPU over the part of the photo the spots touch (Engine.retouched),
// like darktable's heal on its OpenCL path, and the result replaces the source for every later
// pass. Deviations, agreed with Oli:
// - Position: before haze removal, right after lens correction and the camera profile's early
//   pass. darktable runs retouch after haze removal; with Dehaze on, a cloned patch is dehazed
//   for where it lands rather than where it came from.
// - A brush's mask buffer covers its strokes' bounding box from the sampled segments
//   (engine/brush.ts) rather than _brush_get_area's border points; values outside are 0 either way.
// - Zoomed-out view only (retouchReduced): darktable's darkroom runs the whole pipe at the zoom's
//   scale; Emulsion retouches the spots' region at that scale and scales the result back into the
//   spots' masks, leaving the other pixels of the working source as they are. Exports and 1:1
//   views run at full size.
// Not yet agreed with Oli (2026-11-02, raised in HANDOFF.md):
// - Fill blends the three colour channels and leaves alpha; darktable's for_each_channel also
//   fades alpha toward 0, which it uses only for its mask display.
// - Showing a wavelet scale always uses darktable's auto levels (computed each time it is drawn);
//   darktable computes them once and lets the person drag the three levels.
// - The wavelet hat's step follows darktable's OpenCL path at reduced previews (engine/dwt.ts).
// - Emulsion decomposes only the spots' region plus the wavelets' reach, which gives the same
//   pixels there as decomposing the whole image (tested); darktable decomposes its whole ROI.
// Shapes are in source coordinates, so there are no distortions to transform them through.
// SPDX-License-Identifier: GPL-3.0-or-later

import type { RetouchEllipse, RetouchShape, RetouchSpot } from '../film/retouch';
import { spotAnchor, usesSource } from '../film/retouch';
import { brushSegments, segmentValue } from './brush';
import { heal, MAX_HEAL_ITER } from './heal';
import { gaussianBlur } from './maskrefine';
import { BilateralGrid } from './bilateral';
import { REC2020_XYZ_D50, XYZ_REC2020_D50 } from './dcp';
import { dwtDecompose, dwtReach, type DwtParams } from './dwt';

/** darktable's dt_iop_roi_t without the scale: a rectangle of pixels. */
export interface Roi {
  x: number;
  y: number;
  w: number;
  h: number;
}

const f = Math.fround;
// C's float to int conversion.
const int = Math.trunc;

/** darktable's _points_to_transform and _bounding_box: the circle's area in full-size pixels. */
export function circleArea(center: [number, number], outer: number, W: number, H: number): Roi {
  const r = f(outer * Math.min(W, H));
  const l = Math.max(10, int(f(2 * Math.PI) * r));
  const cx = f(center[0] * W), cy = f(center[1] * H);
  // darktable starts xmax at FLT_MIN, the smallest positive float.
  let xmin = Infinity, xmax = 1.17549435e-38, ymin = Infinity, ymax = 1.17549435e-38;
  for (let i = 1; i < l + 1; i++) {
    const alpha = f(f((i - 1) * f(2 * Math.PI)) / l);
    const x = f(cx + f(r * f(Math.cos(alpha))));
    const y = f(cy + f(r * f(Math.sin(alpha))));
    xmin = Math.min(x, xmin); xmax = Math.max(x, xmax);
    ymin = Math.min(y, ymin); ymax = Math.max(y, ymax);
  }
  return { x: int(xmin), y: int(ymin), w: int(f(xmax - xmin)), h: int(f(ymax - ymin)) };
}

const deg2rad = (d: number) => f(d * f(Math.PI / 180));

/** ellipse.c's semi-axes, their outer (feathered) lengths and angle, in full-size pixels, the longer axis first. */
function ellipseAxes(e: RetouchEllipse, W: number, H: number) {
  const m = Math.min(W, H);
  const grow = (r: number) => f((e.proportional ? f(r * f(1 + e.border)) : f(r + e.border)) * m);
  const r0 = f(e.radius[0] * m), r1 = f(e.radius[1] * m);
  const t0 = grow(e.radius[0]), t1 = grow(e.radius[1]);
  return r0 >= r1
    ? { a: r0, b: r1, ta: t0, tb: t1, alpha: deg2rad(e.rotation) }
    : { a: r1, b: r0, ta: t1, tb: t0, alpha: deg2rad(e.rotation - 90) };
}

/** darktable's _ellipse_get_area: _ellipse_points_to_transform around the feathered ellipse, then _bounding_box. */
export function ellipseArea(e: RetouchEllipse, W: number, H: number): Roi {
  const m = Math.min(W, H);
  const grow = (r: number) => f((e.proportional ? f(r * f(1 + e.border)) : f(r + e.border)) * m);
  const dim1 = grow(e.radius[0]), dim2 = grow(e.radius[1]);
  const [a, b, v] = dim1 >= dim2 ? [dim1, dim2, deg2rad(e.rotation)] : [dim2, dim1, deg2rad(e.rotation - 90)];
  const sinv = f(Math.sin(v)), cosv = f(Math.cos(v));
  const lambda = f(f(a - b) / f(a + b));
  const l2 = f(lambda * lambda);
  const l = int(f(f(f(Math.PI) * f(a + b)) * f(1 + f(f(3 * l2) / f(10 + f(Math.sqrt(f(4 - f(3 * l2)))))))));
  const x = f(e.center[0] * W), y = f(e.center[1] * H);
  const pts: number[] = [
    f(x + f(a * f(Math.cos(v)))), f(y + f(a * f(Math.sin(v)))),
    f(x - f(a * f(Math.cos(v)))), f(y - f(a * f(Math.sin(v)))),
    f(x + f(b * f(Math.cos(f(v - f(Math.PI / 2)))))), f(y + f(b * f(Math.sin(f(v - f(Math.PI / 2)))))),
    f(x - f(b * f(Math.cos(f(v - f(Math.PI / 2)))))), f(y - f(b * f(Math.sin(f(v - f(Math.PI / 2)))))),
  ];
  for (let i = 5; i < l + 5; i++) {
    const alpha = f(f((i - 5) * f(2 * Math.PI)) / l);
    const ca = f(Math.cos(alpha)), sa = f(Math.sin(alpha));
    pts.push(f(f(x + f(f(a * ca) * cosv)) - f(f(b * sa) * sinv)), f(f(y + f(f(a * ca) * sinv)) + f(f(b * sa) * cosv)));
  }
  // _bounding_box, which skips the centre; darktable starts the maxima at FLT_MIN.
  let xmin = Infinity, xmax = 1.17549435e-38, ymin = Infinity, ymax = 1.17549435e-38;
  for (let i = 0; i < pts.length; i += 2) {
    xmin = Math.min(pts[i], xmin); xmax = Math.max(pts[i], xmax);
    ymin = Math.min(pts[i + 1], ymin); ymax = Math.max(pts[i + 1], ymax);
  }
  return { x: int(xmin), y: int(ymin), w: int(f(xmax - xmin)), h: int(f(ymax - ymin)) };
}

/** A spot's mask over its area in full-size pixels (darktable's dt_masks_get_mask). */
export function spotMask(shape: RetouchShape, W: number, H: number): { roi: Roi; mask: Float32Array } {
  if (shape.kind === 'ellipse') {
    // _ellipse_get_mask and _fill_mask: 1 inside, a quadratic falloff across the feather.
    const roi = ellipseArea(shape, W, H);
    const mask = new Float32Array(Math.max(0, roi.w * roi.h));
    const { a, b, ta, tb, alpha } = ellipseAxes(shape, W, H);
    const a2 = f(a * a), b2 = f(b * b), ta2 = f(ta * ta), tb2 = f(tb * tb);
    const ca = f(Math.cos(alpha)), sa = f(Math.sin(alpha));
    const cx = f(shape.center[0] * W), cy = f(shape.center[1] * H);
    for (let i = 0; i < roi.h; i++) for (let j = 0; j < roi.w; j++) {
      const x = f(roi.x + j - cx), y = f(roi.y + i - cy);
      const l2 = f(f(x * x) + f(y * y));
      const l = f(Math.sqrt(l2));
      const xn = l ? f(x / l) : 0, yn = l ? f(y / l) : 1;
      const xr = f(f(xn * ca) + f(yn * sa)), yr = f(f(-xn * sa) + f(yn * ca));
      const cos2 = f(xr * xr), sin2 = f(yr * yr);
      const radius2 = f(f(a2 * b2) / f(f(a2 * sin2) + f(b2 * cos2)));
      const total2 = f(f(ta2 * tb2) / f(f(ta2 * sin2) + f(tb2 * cos2)));
      const v = Math.min(1, Math.max(0, f(f(total2 - l2) / f(total2 - radius2))));
      mask[i * roi.w + j] = f(v * v);
    }
    return { roi, mask };
  }
  if (shape.kind === 'circle') {
    // _circle_get_mask: 1 inside the radius, a quadratic falloff across the feather.
    const roi = circleArea(shape.center, shape.radius + shape.border, W, H);
    const mask = new Float32Array(Math.max(0, roi.w * roi.h));
    const m = Math.min(W, H);
    const cx = f(shape.center[0] * W), cy = f(shape.center[1] * H);
    const radius2 = f(f(shape.radius * m) * f(shape.radius * m));
    const total2 = f(f((shape.radius + shape.border) * m) * f((shape.radius + shape.border) * m));
    const border2 = f(total2 - radius2);
    for (let i = 0; i < roi.h; i++) for (let j = 0; j < roi.w; j++) {
      const l2 = f((roi.x + j - cx) ** 2 + (roi.y + i - cy) ** 2);
      const v = Math.min(1, Math.max(0, f(f(total2 - l2) / border2)));
      mask[i * roi.w + j] = v * v;
    }
    return { roi, mask };
  }
  const segs = brushSegments({ id: '', kind: 'brush', mode: 'add', invert: false, opacity: 1, strokes: [shape.nodes] }, W, H);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of segs) {
    const r = Math.max(s[4], s[5]);
    x0 = Math.min(x0, s[0] - r, s[2] - r); x1 = Math.max(x1, s[0] + r, s[2] + r);
    y0 = Math.min(y0, s[1] - r, s[3] - r); y1 = Math.max(y1, s[1] + r, s[3] + r);
  }
  if (!segs.length) return { roi: { x: 0, y: 0, w: 0, h: 0 }, mask: new Float32Array(0) };
  const roi = { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1) - Math.floor(x0) + 1, h: Math.ceil(y1) - Math.floor(y0) + 1 };
  const mask = new Float32Array(roi.w * roi.h);
  for (let i = 0; i < roi.h; i++) for (let j = 0; j < roi.w; j++) {
    let best = 0;
    for (const s of segs) best = Math.max(best, segmentValue(s, roi.x + j, roi.y + i));
    mask[i * roi.w + j] = best;
  }
  return { roi, mask };
}

/** rt_masks_point_calc_delta (distort_mode 2): from the source to the target, in pixels at `scale`. */
export function spotDelta(spot: RetouchSpot, W: number, H: number, scale: number): [number, number] {
  const [tx, ty] = spotAnchor(spot.shape);
  return [f(f(f(tx * W) - f(spot.source[0] * W)) * scale), f(f(f(ty * H) - f(spot.source[1] * H)) * scale)];
}

/** rt_intersect_2_rois. */
function intersect(a: Roi, b: Roi, dx: number, dy: number, padding: number): Roi {
  const x0 = Math.max(a.x + 1 - padding, b.x, b.x + dx);
  const x1 = Math.min(a.x + a.w + 1 + padding, b.x + b.w, b.x + b.w + dx);
  const y0 = Math.max(a.y + 1 - padding, b.y, b.y + dy);
  const y1 = Math.min(a.y + a.h + 1 + padding, b.y + b.h, b.y + b.h + dy);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** rt_build_scaled_mask: the mask resampled (nearest) to `scale` and cut to what both source and target can reach. */
function scaledMask(mask: Float32Array, roiMask: Roi, roiIn: Roi, scale: number, dx: number, dy: number, padding: number): { roi: Roi; mask: Float32Array } | null {
  const r0 = { x: int(roiMask.x * scale), y: int(roiMask.y * scale), w: int(f(roiMask.w * scale) + 0.5), h: int(f(roiMask.h * scale) + 0.5) };
  const roi = intersect(r0, roiIn, dx, dy, padding);
  if (roi.w < 1 || roi.h < 1) return null;
  const out = new Float32Array(roi.w * roi.h);
  for (let yy = roi.y; yy < roi.y + roi.h; yy++) {
    const mi = int(f(yy / scale)) - roiMask.y;
    if (mi < 0 || mi >= roiMask.h) continue;
    for (let xx = roi.x; xx < roi.x + roi.w; xx++) {
      const mx = int(f(xx / scale)) - roiMask.x;
      if (mx < 0 || mx >= roiMask.w) continue;
      out[(yy - roi.y) * roi.w + xx - roi.x] = mask[mi * roiMask.w + mx];
    }
  }
  return { roi, mask: out };
}

/** rt_copy_in_to_out: `out` (its roi) filled from `img` (its roi) shifted by (dx, dy). */
function copyInToOut(img: Float32Array, roiIn: Roi, out: Float32Array, roiOut: Roi, dx: number, dy: number) {
  const row = 4 * Math.min(roiOut.w, roiIn.w);
  const xo = roiOut.x - roiIn.x - dx;
  const yo = roiOut.y - roiIn.y - dy;
  for (let y = 0; y < Math.min(roiOut.h, roiIn.h); y++) {
    const i = 4 * ((y + yo) * roiIn.w + xo);
    out.set(img.subarray(i, i + row), 4 * y * roiOut.w);
  }
}

/** rt_copy_image_masked: `src` (the mask's roi) blended over `dest` by mask × opacity. */
function copyMasked(src: Float32Array, dest: Float32Array, roiDest: Roi, mask: Float32Array, roiM: Roi, opacity: number) {
  for (let yy = 0; yy < roiM.h; yy++) {
    const s = 4 * yy * roiM.w;
    const d = 4 * ((yy + roiM.y - roiDest.y) * roiDest.w + roiM.x - roiDest.x);
    for (let xx = 0; xx < roiM.w; xx++) {
      const k = f(mask[yy * roiM.w + xx] * opacity);
      const k1 = f(1 - k);
      for (let c = 0; c < 4; c++) dest[d + 4 * xx + c] = dest[d + 4 * xx + c] * k1 + src[s + 4 * xx + c] * k;
    }
  }
}

/** The pixels of `roi` from `img` (its roi `roiIn`). */
function copyOf(img: Float32Array, roiIn: Roi, roi: Roi): Float32Array {
  const out = new Float32Array(4 * roi.w * roi.h);
  copyInToOut(img, roiIn, out, roi, 0, 0);
  return out;
}

/** darktable's fill colour for a spot: erase fills with its brightness as grey, colour adds the brightness to the colour. */
export const fillColor = (s: RetouchSpot): [number, number, number] =>
  s.fillMode === 'erase' ? [s.fillBrightness, s.fillBrightness, s.fillBrightness] : [s.fillColor[0] + s.fillBrightness, s.fillColor[1] + s.fillBrightness, s.fillColor[2] + s.fillBrightness];

/** _retouch_fill: the colour blended in by mask × opacity (colour channels; see the header). */
function fill(img: Float32Array, roiIn: Roi, mask: Float32Array, roiM: Roi, opacity: number, color: [number, number, number]) {
  for (let yy = 0; yy < roiM.h; yy++) {
    const d = 4 * ((yy + roiM.y - roiIn.y) * roiIn.w + roiM.x - roiIn.x);
    for (let xx = 0; xx < roiM.w; xx++) {
      const k = f(mask[yy * roiM.w + xx] * opacity);
      for (let c = 0; c < 3; c++) img[d + 4 * xx + c] = f(img[d + 4 * xx + c] * f(1 - k) + f(color[c] * k));
    }
  }
}

const D50: [number, number, number] = [0.9642, 1, 0.8249];
const LAB_EPS = 216 / 24389, LAB_KAPPA = 24389 / 27;

/** dt_ioppr_transform_image_colorspace from linear Rec.2020 to Lab (D50), in place, alpha kept. */
function rgbToLab(px: Float32Array) {
  const m = XYZ_REC2020_D50;
  const lf = (x: number) => (x > LAB_EPS ? Math.cbrt(x) : (LAB_KAPPA * x + 16) / 116);
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const fx = lf((m[0][0] * r + m[0][1] * g + m[0][2] * b) / D50[0]);
    const fy = lf((m[1][0] * r + m[1][1] * g + m[1][2] * b) / D50[1]);
    const fz = lf((m[2][0] * r + m[2][1] * g + m[2][2] * b) / D50[2]);
    px[i] = 116 * fy - 16; px[i + 1] = 500 * (fx - fy); px[i + 2] = 200 * (fy - fz);
  }
}

/** The reverse of rgbToLab (dt_Lab_to_XYZ, lab_f_inv). */
function labToRgb(px: Float32Array) {
  const m = REC2020_XYZ_D50;
  const inv = (x: number) => (x > 0.20689655172413796 ? x * x * x : (116 * x - 16) / LAB_KAPPA);
  for (let i = 0; i < px.length; i += 4) {
    const fy = (px[i] + 16) / 116;
    const X = D50[0] * inv(fy + px[i + 1] / 500), Y = D50[1] * inv(fy), Z = D50[2] * inv(fy - px[i + 2] / 200);
    px[i] = m[0][0] * X + m[0][1] * Y + m[0][2] * Z;
    px[i + 1] = m[1][0] * X + m[1][1] * Y + m[1][2] * Z;
    px[i + 2] = m[2][0] * X + m[2][1] * Y + m[2][2] * Z;
  }
}

/**
 * _retouch_blur on the w × h rectangle `px`, in place: darktable's recursive Gaussian on all four
 * channels, or its bilateral grid (sigma_r 100) on Lab lightness, keeping the base layer. The
 * radius is in full-size pixels. False when the radius is too small to blur (≤ 0.1).
 */
export function blurRect(px: Float32Array, w: number, h: number, type: 'gaussian' | 'bilateral', radius: number, scale: number): boolean {
  if (Math.abs(radius) <= 0.1) return false;
  const sigma = f(radius * scale);
  if (type === 'gaussian') {
    const ch = new Float32Array(w * h);
    for (let c = 0; c < 4; c++) {
      for (let i = 0; i < w * h; i++) ch[i] = px[4 * i + c];
      const out = gaussianBlur(ch, w, h, sigma, -Infinity, Infinity);
      for (let i = 0; i < w * h; i++) px[4 * i + c] = out[i];
    }
    return true;
  }
  rgbToLab(px);
  const grid = new BilateralGrid(w, h, sigma, 100);
  grid.splat(px);
  grid.blur();
  grid.slice(px, px, -1);
  labToRgb(px);
  return true;
}

/** A spot's area in full-size pixels: the circle's from its outline, a brush's from its mask. */
function spotArea(shape: RetouchShape, W: number, H: number): Roi {
  return shape.kind === 'circle' ? circleArea(shape.center, shape.radius + shape.border, W, H) : shape.kind === 'ellipse' ? ellipseArea(shape, W, H) : spotMask(shape, W, H).roi;
}

/** A 32-bit FNV-1a hash of float pixels, by their bits. */
function hashPixels(h: number, px: Float32Array): number {
  const u = new Uint32Array(px.buffer, px.byteOffset, px.length);
  for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619);
  return h >>> 0;
}

/**
 * Each spot's result, by the spot, where it lands and the exact pixels it reads. Spots run in
 * order on the result of the ones before, so moving one changes the input of only the spots that
 * read where it was or is; the others are pasted back from here instead of healed again. A hit
 * needs bit-identical input, so the result is exactly what running the spot would give.
 */
export class RetouchCache {
  private entries = new Map<string, Float32Array>();
  private size = 0;
  constructor(private maxFloats = 16 << 20) {}
  get(key: string): Float32Array | undefined {
    const v = this.entries.get(key);
    if (v) { this.entries.delete(key); this.entries.set(key, v); }
    return v;
  }
  set(key: string, v: Float32Array) {
    if (v.length > this.maxFloats) return;
    this.entries.set(key, v);
    this.size += v.length;
    for (const [k, old] of this.entries) {
      if (this.size <= this.maxFloats) break;
      this.entries.delete(k);
      this.size -= old.length;
    }
  }
  clear() { this.entries.clear(); this.size = 0; }
}

/**
 * darktable's retouch on `img`, the pixels of `roiIn` within the photo at `scale` (its working
 * size over the full size W × H), in place. Spots run in order. With a cache, a spot whose input
 * is unchanged is pasted from its last result.
 */
export function retouch(img: Float32Array, roiIn: Roi, W: number, H: number, scale: number, spots: RetouchSpot[], maxIter = MAX_HEAL_ITER, cache?: RetouchCache, coverage?: Float32Array, setup: RetouchSetup = NO_SCALES) {
  scale = f(scale);
  const numScales = setup.scales;
  const show = setup.show > 0 && numScales > 0 ? Math.min(setup.show, numScales + 1) : 0;
  const p: DwtParams = { image: img, width: roiIn.w, height: roiIn.h, scales: numScales, returnLayer: show, mergeFromScale: setup.mergeFrom, previewScale: scale, fullWidth: W, fullHeight: H };
  // rt_process_forms: each layer's forms, as dwt_decompose passes the layers.
  dwtDecompose(p, (layer, scale1) => {
    let s = scale1;
    if (p.mergeFromScale === 0 && p.returnLayer > 0 && s !== p.returnLayer && s !== 0) return;
    if (s > p.scales + 1) return;
    // With fewer scales than asked for (the image is too small), the residual keeps its number.
    if (p.scales < numScales && p.returnLayer === 0 && s === p.scales + 1) s = numScales + 1;
    for (const spot of spots) if (spot.scale === s) retouchSpot(layer, roiIn, W, H, scale, spot, maxIter, cache, coverage);
  });
  if (p.returnLayer > 0) {
    // One scale shown: a detail scale with darktable's auto levels; the whole region changes.
    if (p.returnLayer < p.scales + 1) adjustLevels(img, autoLevels(img));
    coverage?.fill(1);
  }
}

/** darktable's wavelet setup for a photo's spots: how many detail scales, merged from which, and the one shown (0 for the photo). */
export interface RetouchSetup {
  scales: number;
  mergeFrom: number;
  show: number;
}
export const NO_SCALES: RetouchSetup = { scales: 0, mergeFrom: 0, show: 0 };

const LVL_MIN = -3, LVL_MAX = 3;

/** Lab L (D50) of a linear Rec.2020 pixel, as dt_ioppr_rgb_matrix_to_lab gives it. */
function lightness(r: number, g: number, b: number): number {
  const m = XYZ_REC2020_D50;
  const y = m[1][0] * r + m[1][1] * g + m[1][2] * b;
  return 116 * (y > LAB_EPS ? Math.cbrt(y) : (LAB_KAPPA * y + 16) / 116) - 16;
}

/** rt_process_stats then rt_clamp_minmax: the layer's lightness range and mean, as preview levels. */
export function autoLevels(img: Float32Array): [number, number, number] {
  let lo = Infinity, hi = -Infinity, sum = 0, count = 0;
  for (let i = 0; i < img.length; i += 4) {
    const L = lightness(img[i], img[i + 1], img[i + 2]);
    lo = Math.min(lo, L); hi = Math.max(hi, L); sum += L; count++;
  }
  const lv: [number, number, number] = [lo / 100, sum / count / 100, hi / 100];
  if (lv[0] === 0 && lv[1] === 0 && lv[2] === 0) { lv[0] = -1.5; lv[1] = 0; lv[2] = 1.5; }
  if (lv[2] < lv[0] + 0.1) lv[2] = lv[0] + 0.1;
  if (lv[1] < lv[0] + 0.05) lv[1] = lv[0] + 0.05;
  if (lv[1] > lv[2] - 0.05) lv[1] = lv[2] - 0.05;
  const left = Math.max(lv[0], LVL_MIN), right = Math.min(lv[2], LVL_MAX);
  const pct = (lv[1] - lv[0]) / (lv[2] - lv[0]);
  return [left, left + (right - left) * pct, right];
}

/** rt_adjust_levels: Lab lightness stretched from [left, right] with the middle as gamma, a and b kept. */
export function adjustLevels(img: Float32Array, [left, middle, right]: [number, number, number]) {
  if (left === LVL_MIN && middle === 0 && right === LVL_MAX) return;
  const delta = (right - left) / 2;
  const invGamma = Math.pow(10, (middle - (left + delta)) / delta);
  rgbToLab(img);
  for (let i = 0; i < img.length; i += 4) {
    const L = img[i] / 100;
    img[i] = L <= left ? 0 : 100 * Math.pow((L - left) / (right - left), invGamma);
  }
  labToRgb(img);
}

/** rt_process_forms for one form: its mask, scaled and cut to the layer, then its algorithm. */
function retouchSpot(img: Float32Array, roiIn: Roi, W: number, H: number, scale: number, spot: RetouchSpot, maxIter: number, cache?: RetouchCache, coverage?: Float32Array) {
  {
    // Blur and fill have no source (darktable leaves dx = dy = 0 for them).
    const moves = usesSource(spot.tool);
    const [fdx, fdy] = moves ? spotDelta(spot, W, H, scale) : [0, 0];
    if (moves && fdx === 0 && fdy === 0) return;
    const dx = int(fdx), dy = int(fdy);
    const area = spotArea(spot.shape, W, H);
    if (area.w < 1 || area.h < 1) return;
    const padding = spot.tool === 'heal' ? 1 : 0;
    // rt_build_scaled_mask's rectangle, known before the mask is made.
    const r0 = { x: int(area.x * scale), y: int(area.y * scale), w: int(f(area.w * scale) + 0.5), h: int(f(area.h * scale) + 0.5) };
    const roi = intersect(r0, roiIn, dx, dy, padding);
    if (roi.w <= 2 || roi.h <= 2) return;
    const n = 4 * roi.w * roi.h;
    const src = new Float32Array(n);
    copyInToOut(img, roiIn, src, roi, dx, dy);
    const { id: _id, ...settings } = spot;
    void _id;
    const key = cache ? `${JSON.stringify([settings, W, H, scale, maxIter, roi])}|${hashPixels(2166136261, src)}${moves ? `|${hashPixels(2166136261, copyOf(img, roiIn, roi))}` : ''}` : '';
    // A cache entry holds the result's pixels, then the spot's mask over the same rectangle.
    const hit = cache?.get(key);
    let maskOut: Float32Array;
    if (!hit) {
      const { roi: roiMask, mask } = spotMask(spot.shape, W, H);
      const scaled = scaledMask(mask, roiMask, roiIn, scale, dx, dy, padding)!;
      maskOut = scaled.mask;
      if (spot.tool === 'clone') {
        copyMasked(src, img, roiIn, scaled.mask, scaled.roi, spot.opacity);
      } else if (spot.tool === 'heal') {
        const dest = copyOf(img, roiIn, roi);
        heal(src, dest, scaled.mask, scaled.roi.w, scaled.roi.h, maxIter);
        copyMasked(dest, img, roiIn, scaled.mask, scaled.roi, spot.opacity);
      } else if (spot.tool === 'blur') {
        // src is the rectangle itself (dx = dy = 0).
        if (blurRect(src, roi.w, roi.h, spot.blurType, spot.blurRadius, scale)) copyMasked(src, img, roiIn, scaled.mask, scaled.roi, spot.opacity);
      } else {
        fill(img, roiIn, scaled.mask, scaled.roi, spot.opacity, fillColor(spot));
      }
    } else maskOut = hit.subarray(n);
    // Paste the remembered result, or remember this one.
    const out = hit ?? new Float32Array(n + roi.w * roi.h);
    for (let y = 0; y < roi.h; y++) {
      const i = 4 * ((roi.y + y - roiIn.y) * roiIn.w + roi.x - roiIn.x);
      if (hit) img.set(hit.subarray(4 * y * roi.w, 4 * (y + 1) * roi.w), i);
      else out.set(img.subarray(i, i + 4 * roi.w), 4 * y * roi.w);
    }
    if (cache && !hit) { out.set(maskOut, n); cache.set(key, out); }
    // How much of each pixel the spots replace, for retouchReduced.
    if (coverage) for (let y = 0; y < roi.h; y++) for (let x = 0; x < roi.w; x++) {
      const c = (roi.y + y - roiIn.y) * roiIn.w + roi.x + x - roiIn.x;
      coverage[c] = Math.max(coverage[c], maskOut[y * roi.w + x] * spot.opacity);
    }
  }
}

/**
 * Retouch for a view that shows the photo at 1/k of the working size or smaller, as darktable's
 * darkroom runs its pipe at the zoom's scale: the region (its corner on a multiple of k) is
 * averaged over k × k blocks, retouched at scale / k, and scaled back up (bilinear) into the
 * spots' masks only, so every pixel outside them is left exactly as it was. Inside a spot the
 * result is as sharp as the view shows it; zoomed in, the view runs `retouch` at full size.
 */
export function retouchReduced(px: Float32Array, region: Roi, W: number, H: number, scale: number, spots: RetouchSpot[], k: number, cache?: RetouchCache, setup: RetouchSetup = NO_SCALES) {
  if (k <= 1) { retouch(px, region, W, H, scale, spots, MAX_HEAL_ITER, cache, undefined, setup); return; }
  const rs: Roi = { x: region.x / k, y: region.y / k, w: Math.ceil(region.w / k), h: Math.ceil(region.h / k) };
  const small = new Float32Array(4 * rs.w * rs.h);
  for (let Y = 0; Y < rs.h; Y++) for (let X = 0; X < rs.w; X++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let y = Y * k; y < Math.min(region.h, Y * k + k); y++) for (let x = X * k; x < Math.min(region.w, X * k + k); x++) {
      const i = 4 * (y * region.w + x);
      r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3]; n++;
    }
    small.set([r / n, g / n, b / n, a / n], 4 * (Y * rs.w + X));
  }
  const coverage = new Float32Array(rs.w * rs.h);
  retouch(small, rs, W, H, scale / k, spots, MAX_HEAL_ITER, cache, coverage, setup);
  // Back up, into the spots only. A small pixel's centre is at k·X + (k − 1) / 2.
  const c = (k - 1) / 2;
  for (let y = 0; y < region.h; y++) {
    const fy = Math.min(rs.h - 1, Math.max(0, (y - c) / k));
    const y0 = Math.floor(fy), y1 = Math.min(rs.h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < region.w; x++) {
      const fx = Math.min(rs.w - 1, Math.max(0, (x - c) / k));
      const x0 = Math.floor(fx), x1 = Math.min(rs.w - 1, x0 + 1), tx = fx - x0;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      const a00 = y0 * rs.w + x0, a10 = y0 * rs.w + x1, a01 = y1 * rs.w + x0, a11 = y1 * rs.w + x1;
      const u = coverage[a00] * w00 + coverage[a10] * w10 + coverage[a01] * w01 + coverage[a11] * w11;
      if (u <= 0) continue;
      const i = 4 * (y * region.w + x);
      for (let ch = 0; ch < 4; ch++) {
        const v = small[4 * a00 + ch] * w00 + small[4 * a10 + ch] * w10 + small[4 * a01 + ch] * w01 + small[4 * a11 + ch] * w11;
        px[i + ch] = px[i + ch] * (1 - u) + v * u;
      }
    }
  }
}

/** The k-aligned rectangle of a w × h working image that retouchReduced needs at 1/k. */
export function reducedRegion(spots: RetouchSpot[], W: number, H: number, scale: number, w: number, h: number, k: number, setup: RetouchSetup = NO_SCALES): Roi | null {
  if (k <= 1) return retouchRegion(spots, W, H, scale, w, h, setup);
  const rs = retouchRegion(spots, W, H, scale / k, Math.ceil(w / k), Math.ceil(h / k), setup);
  if (!rs) return null;
  const x = rs.x * k, y = rs.y * k;
  return { x, y, w: Math.min(rs.w * k, w - x), h: Math.min(rs.h * k, h - y) };
}

/**
 * The pixels the spots read or write, at `scale` within a w × h working image: each target's
 * area (with heal's one-pixel border) and its source, clipped to the image. Retouching only this
 * rectangle gives the same result as the whole image. Null when nothing is touched.
 */
export function retouchRegion(spots: RetouchSpot[], W: number, H: number, scale: number, w: number, h: number, setup: RetouchSetup = NO_SCALES): Roi | null {
  scale = f(scale);
  // Showing one wavelet scale replaces the whole image.
  if (setup.show > 0 && setup.scales > 0) return { x: 0, y: 0, w, h };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const spot of spots) {
    if (spot.scale > 0 && (setup.scales === 0 || spot.scale > setup.scales + 1)) continue;
    const moves = usesSource(spot.tool);
    const [fdx, fdy] = moves ? spotDelta(spot, W, H, scale) : [0, 0];
    if (moves && fdx === 0 && fdy === 0) continue;
    const dx = int(fdx), dy = int(fdy);
    const outer = spotArea(spot.shape, W, H);
    // A spot on a wavelet scale reads that layer, which depends on the pixels the hats reach.
    const m = spot.scale > 0 ? dwtReach(Math.min(spot.scale, setup.scales), scale) + 1 : 0;
    const r = { x: int(outer.x * scale) - 1 - m, y: int(outer.y * scale) - 1 - m, w: int(f(outer.w * scale) + 0.5) + 4 + 2 * m, h: int(f(outer.h * scale) + 0.5) + 4 + 2 * m };
    x0 = Math.min(x0, r.x, r.x - dx); y0 = Math.min(y0, r.y, r.y - dy);
    x1 = Math.max(x1, r.x + r.w, r.x + r.w - dx); y1 = Math.max(y1, r.y + r.h, r.y + r.h - dy);
  }
  const x = Math.max(0, x0), y = Math.max(0, y0);
  const rw = Math.min(w, x1) - x, rh = Math.min(h, y1) - y;
  return rw > 0 && rh > 0 ? { x, y, w: rw, h: rh } : null;
}

/** retouch.c's rt_compute_roi_in dependency rule: include each intersecting form's complete
 * destination (Heal solves over the whole mask) and source; close dependencies as the input
 * grows. Coordinates remain global working-image pixels, and forms keep their original order. */
export function retouchInputs(spots: RetouchSpot[], output: Roi, W: number, H: number, scale: number, w: number, h: number, setup: RetouchSetup = NO_SCALES): { region: Roi; spots: RetouchSpot[] } {
  let region = { ...output };
  const selected = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = spots.length - 1; i >= 0; i--) {
      const spot = spots[i];
      if (selected.has(i) || spot.opacity <= 0 || (spot.scale > 0 && (setup.scales === 0 || spot.scale > setup.scales + 1))) continue;
      const area = spotArea(spot.shape, W, H);
      const pad = spot.scale > 0 ? dwtReach(Math.min(spot.scale, setup.scales), scale) + 1 : 1;
      const dest = { x: int(area.x * scale) - pad, y: int(area.y * scale) - pad, w: int(f(area.w * scale) + .5) + 4 + 2 * pad, h: int(f(area.h * scale) + .5) + 4 + 2 * pad };
      if (!(dest.x < region.x + region.w && region.x < dest.x + dest.w && dest.y < region.y + region.h && region.y < dest.y + dest.h)) continue;
      const input = retouchRegion([spot], W, H, scale, w, h, setup);
      if (!input) continue;
      selected.add(i); changed = true;
      const x = Math.min(region.x, input.x), y = Math.min(region.y, input.y);
      region = { x, y, w: Math.max(region.x + region.w, input.x + input.w) - x, h: Math.max(region.y + region.h, input.y + input.h) - y };
    }
  }
  return { region, spots: spots.filter((_, i) => selected.has(i)) };
}
