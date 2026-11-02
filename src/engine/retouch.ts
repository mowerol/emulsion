// Copyright (C) 2017-2026 darktable developers.
// Copyright (C) 2013-2025 darktable developers (circle masks).
// Ported from darktable src/iop/retouch.c (process with no wavelet scales, rt_process_forms,
// rt_masks_point_calc_delta with distort_mode 2, rt_intersect_2_rois, rt_copy_in_to_out,
// rt_build_scaled_mask, rt_copy_image_masked, _retouch_clone, _retouch_heal) and
// src/develop/masks/circle.c (_points_to_transform, _bounding_box, _circle_get_mask) at commit
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2). Translated from C to TypeScript.
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
// Shapes are in source coordinates, so there are no distortions to transform them through.
// SPDX-License-Identifier: GPL-3.0-or-later

import type { RetouchSpot } from '../film/retouch';
import { spotAnchor } from '../film/retouch';
import { brushSegments, segmentValue } from './brush';
import { heal, MAX_HEAL_ITER } from './heal';

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

/** A spot's mask over its area in full-size pixels (darktable's dt_masks_get_mask). */
export function spotMask(shape: RetouchSpot['shape'], W: number, H: number): { roi: Roi; mask: Float32Array } {
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

/** A spot's area in full-size pixels: the circle's from its outline, a brush's from its mask. */
function spotArea(shape: RetouchSpot['shape'], W: number, H: number): Roi {
  return shape.kind === 'circle' ? circleArea(shape.center, shape.radius + shape.border, W, H) : spotMask(shape, W, H).roi;
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
export function retouch(img: Float32Array, roiIn: Roi, W: number, H: number, scale: number, spots: RetouchSpot[], maxIter = MAX_HEAL_ITER, cache?: RetouchCache, coverage?: Float32Array) {
  scale = f(scale);
  for (const spot of spots) {
    const [fdx, fdy] = spotDelta(spot, W, H, scale);
    if (fdx === 0 && fdy === 0) continue;
    const dx = int(fdx), dy = int(fdy);
    const area = spotArea(spot.shape, W, H);
    if (area.w < 1 || area.h < 1) continue;
    const padding = spot.tool === 'heal' ? 1 : 0;
    // rt_build_scaled_mask's rectangle, known before the mask is made.
    const r0 = { x: int(area.x * scale), y: int(area.y * scale), w: int(f(area.w * scale) + 0.5), h: int(f(area.h * scale) + 0.5) };
    const roi = intersect(r0, roiIn, dx, dy, padding);
    if (roi.w <= 2 || roi.h <= 2) continue;
    const n = 4 * roi.w * roi.h;
    const src = new Float32Array(n);
    copyInToOut(img, roiIn, src, roi, dx, dy);
    const dest = new Float32Array(n);
    copyInToOut(img, roiIn, dest, roi, 0, 0);
    const key = cache ? `${JSON.stringify([spot.tool, spot.shape, spot.source, spot.opacity, W, H, scale, maxIter, roi])}|${hashPixels(hashPixels(2166136261, src), dest)}` : '';
    // A cache entry holds the result's pixels, then the spot's mask over the same rectangle.
    const hit = cache?.get(key);
    let maskOut: Float32Array;
    if (!hit) {
      const { roi: roiMask, mask } = spotMask(spot.shape, W, H);
      const scaled = scaledMask(mask, roiMask, roiIn, scale, dx, dy, padding)!;
      maskOut = scaled.mask;
      if (spot.tool === 'clone') {
        copyMasked(src, img, roiIn, scaled.mask, scaled.roi, spot.opacity);
      } else {
        heal(src, dest, scaled.mask, scaled.roi.w, scaled.roi.h, maxIter);
        copyMasked(dest, img, roiIn, scaled.mask, scaled.roi, spot.opacity);
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
export function retouchReduced(px: Float32Array, region: Roi, W: number, H: number, scale: number, spots: RetouchSpot[], k: number, cache?: RetouchCache) {
  if (k <= 1) { retouch(px, region, W, H, scale, spots, MAX_HEAL_ITER, cache); return; }
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
  retouch(small, rs, W, H, scale / k, spots, MAX_HEAL_ITER, cache, coverage);
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
export function reducedRegion(spots: RetouchSpot[], W: number, H: number, scale: number, w: number, h: number, k: number): Roi | null {
  if (k <= 1) return retouchRegion(spots, W, H, scale, w, h);
  const rs = retouchRegion(spots, W, H, scale / k, Math.ceil(w / k), Math.ceil(h / k));
  if (!rs) return null;
  const x = rs.x * k, y = rs.y * k;
  return { x, y, w: Math.min(rs.w * k, w - x), h: Math.min(rs.h * k, h - y) };
}

/**
 * The pixels the spots read or write, at `scale` within a w × h working image: each target's
 * area (with heal's one-pixel border) and its source, clipped to the image. Retouching only this
 * rectangle gives the same result as the whole image. Null when nothing is touched.
 */
export function retouchRegion(spots: RetouchSpot[], W: number, H: number, scale: number, w: number, h: number): Roi | null {
  scale = f(scale);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const spot of spots) {
    const [fdx, fdy] = spotDelta(spot, W, H, scale);
    if (fdx === 0 && fdy === 0) continue;
    const dx = int(fdx), dy = int(fdy);
    const outer = spotArea(spot.shape, W, H);
    const r = { x: int(outer.x * scale) - 1, y: int(outer.y * scale) - 1, w: int(f(outer.w * scale) + 0.5) + 4, h: int(f(outer.h * scale) + 0.5) + 4 };
    x0 = Math.min(x0, r.x, r.x - dx); y0 = Math.min(y0, r.y, r.y - dy);
    x1 = Math.max(x1, r.x + r.w, r.x + r.w - dx); y1 = Math.max(y1, r.y + r.h, r.y + r.h - dy);
  }
  const x = Math.max(0, x0), y = Math.max(0, y0);
  const rw = Math.min(w, x1) - x, rh = Math.min(h, y1) - y;
  return rw > 0 && rh > 0 ? { x, y, w: rw, h: rh } : null;
}
