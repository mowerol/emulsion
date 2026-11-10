// IOPaint (formerly Lama Cleaner), Apache-2.0. Its source carries no copyright line; setup.py
// names its author as PanicByte (Sanster).
// Crop planning ported from IOPaint iopaint/model/base.py (InpaintModel.__call__ with
// HDStrategy.CROP, _crop_box), iopaint/helper.py (boxes_from_mask) and iopaint/schema.py
// (InpaintRequest's defaults) at commit 61a759fb3f332bacdce8b2813f4837495c9b86e0. Translated from
// Python to TypeScript. IOPaint's defaults for LaMa, as quoted from there:
// - hd_strategy CROP, hd_strategy_crop_trigger_size 800: crop only when the image's longer side
//   is over 800 pixels, otherwise inpaint the whole image;
// - hd_strategy_crop_margin 128: the crop is the mask box grown by 128 on each side, moved
//   inward at the image's edges to keep its size where it can;
// - api_inpaint and boxes_from_mask threshold the mask at 127 of 255; it is not dilated (the
//   only dilation is adjust_mask's "expand", a button the person presses: kernel_size 5 in
//   schema.py's AdjustMaskRequest, 12 in the web app's state);
// - with sd_keep_unmasked_area (on by default), _pad_forward keeps the photo outside the mask.
// Where Emulsion departs from IOPaint, and why (Oli left these calls to Claude, 2026-11-04):
// - The mask the model fills and boxes is every pixel the spot touches (over 0 of 255), not
//   over 127: a spot is blended across its whole feather (the spec's user story), so the model
//   must fill all of it. At 127 the outer feather would mix the photo with the model's resampled
//   copy of pixels it was told to keep, softening the edge. IOPaint's masks are brush strokes
//   without a feather, where the two rules differ by antialiasing only.
// - IOPaint runs LaMa at the crop's own size padded to a multiple of 8; the ONNX export
//   (Carve/LaMa-ONNX) takes a fixed 512 × 512 (required by the spec), so the crop is resized to
//   512 × 512 and the patch resized back. The filter is a triangle (PIL's antialiased bilinear),
//   not the INTER_CUBIC of IOPaint's RESIZE strategy: cv2's cubic does not widen its kernel when
//   shrinking, so a 2000-pixel crop would alias. The mask goes down by taking every 512 cell any
//   masked pixel touches: a cell the model leaves alone holds only the photo resampled, and the
//   spot must not blend that in.
// - IOPaint finds one box per contour (cv2.findContours, RETR_EXTERNAL); a spot's shape (a
//   circle, an ellipse, or one brush path) is one connected area, so its one box is that box.
//   Strokes painted together and applied at once ("Remove after each stroke" off) are split by
//   removeGroups into the 8-connected areas of their mask, a spot each, so this still holds. A
//   stroke lying wholly inside a hole of another (a ring) becomes its own spot, where
//   RETR_EXTERNAL would leave it inside the ring's box.
// - The model reads 8-bit sRGB made from the retouch step's scene-linear Rec.2020 by a fixed
//   encode (clipped to [0, 1]); the patch is decoded by the matching decode.
// - The crop is planned on the full-size photo, so the preview and the full source share one
//   patch. The spec feeds the model from the preview when the crop spans 512 preview pixels;
//   the crop is squeezed to 512 on both axes, so it is taken to mean the crop's shorter side.
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Recipe } from '../film/recipe';
import type { RetouchShape, RetouchSpot } from '../film/retouch';
import type { BrushNode } from '../film/masks';
import { REC2020_TO_SRGB, SRGB_TO_REC2020, srgbEotf, srgbOetf } from './color';
import type { RetouchSetup, Roi } from './retouch';
import { retouchInputs, spotMask } from './retouch';

/** The model's fixed input and output size. */
export const PATCH_SIZE = 512;
/** IOPaint's InpaintRequest defaults. */
export const CROP_TRIGGER_SIZE = 800;
export const CROP_MARGIN = 128;

const masks = new Map<string, ReturnType<typeof spotMask>>();
/** spotMask at full size, kept for the last few shapes: a Remove spot needs it on every run, not only when its input changes. */
export function fullMask(shape: RetouchShape, W: number, H: number): ReturnType<typeof spotMask> {
  const k = JSON.stringify([shape, W, H]);
  let m = masks.get(k);
  if (m) { masks.delete(k); masks.set(k, m); return m; }
  m = spotMask(shape, W, H);
  masks.set(k, m);
  if (masks.size > 16) masks.delete(masks.keys().next().value!);
  return m;
}

/** Whether a mask value (0 to 1) is in the model's binary mask: over 0 once made 8-bit (see the header). */
export const masked = (v: number) => Math.round(v * 255) > 0;

/**
 * Strokes painted to be removed together, grouped as IOPaint's boxes_from_mask splits one mask:
 * the 8-connected areas of their union within the photo (cv2.findContours), each to be one spot
 * with one box. Strokes keep their order within a group; groups are in the order of their first
 * stroke. A stroke that touches no pixel of the photo is dropped.
 */
export function removeGroups(strokes: BrushNode[][], W: number, H: number): BrushNode[][][] {
  if (!strokes.length) return [];
  const { roi, mask } = spotMask({ kind: 'brush', nodes: strokes[0], more: strokes.slice(1) }, W, H);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  // Label the union's 8-connected areas over the photo.
  const label = new Int32Array(roi.w * roi.h).fill(-1);
  let areas = 0;
  const queue: number[] = [];
  for (let start = 0; start < label.length; start++) {
    if (label[start] >= 0 || !masked(mask[start]) || !inside(roi.x + (start % roi.w), roi.y + Math.floor(start / roi.w))) continue;
    label[start] = areas;
    queue.length = 0;
    queue.push(start);
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % roi.w, y = (i - x) / roi.w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= roi.w || ny >= roi.h) continue;
        const n = ny * roi.w + nx;
        if (label[n] >= 0 || !masked(mask[n]) || !inside(roi.x + nx, roi.y + ny)) continue;
        label[n] = areas;
        queue.push(n);
      }
    }
    areas++;
  }
  // Each stroke is one path, so all of it lies in one area: find it from any pixel it covers.
  const groups = new Map<number, BrushNode[][]>();
  for (const st of strokes) {
    const own = spotMask({ kind: 'brush', nodes: st }, W, H);
    let area = -1;
    for (let i = 0; i < own.mask.length && area < 0; i++) {
      if (!masked(own.mask[i])) continue;
      const x = own.roi.x + (i % own.roi.w), y = own.roi.y + Math.floor(i / own.roi.w);
      if (inside(x, y)) area = label[(y - roi.y) * roi.w + (x - roi.x)];
    }
    if (area < 0) continue;
    const g = groups.get(area);
    if (g) g.push(st); else groups.set(area, [st]);
  }
  return [...groups.values()];
}

/**
 * The full-size crop the model sees for a Remove spot: IOPaint's boxes_from_mask then _crop_box,
 * or the whole photo when its longer side is at most CROP_TRIGGER_SIZE. Null when the spot
 * touches no pixel of the photo.
 */
export function removeCrop(shape: RetouchShape, W: number, H: number): Roi | null {
  const { roi, mask } = fullMask(shape, W, H);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < roi.h; i++) for (let j = 0; j < roi.w; j++) {
    if (!masked(mask[i * roi.w + j])) continue;
    const x = roi.x + j, y = roi.y + i;
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (x0 > x1) return null;
  if (Math.max(W, H) <= CROP_TRIGGER_SIZE) return { x: 0, y: 0, w: W, h: H };
  // cv2.boundingRect then clipped to the image: [left, top, right, bottom).
  const box = [x0, y0, x1 + 1, y1 + 1];
  // _crop_box.
  const fl = Math.floor;
  const boxH = box[3] - box[1], boxW = box[2] - box[0];
  const cx = fl((box[0] + box[2]) / 2), cy = fl((box[1] + box[3]) / 2);
  const w = boxW + CROP_MARGIN * 2, h = boxH + CROP_MARGIN * 2;
  const _l = cx - fl(w / 2), _r = cx + fl(w / 2), _t = cy - fl(h / 2), _b = cy + fl(h / 2);
  let l = Math.max(_l, 0), r = Math.min(_r, W), t = Math.max(_t, 0), b = Math.min(_b, H);
  // "try to get more context when crop around image edge"
  if (_l < 0) r += Math.abs(_l);
  if (_r > W) l -= _r - W;
  if (_t < 0) b += Math.abs(_t);
  if (_b > H) t -= _b - H;
  l = Math.max(l, 0); r = Math.min(r, W); t = Math.max(t, 0); b = Math.min(b, H);
  return { x: l, y: t, w: r - l, h: b - t };
}

/** Which source feeds the model: the preview when the crop spans PATCH_SIZE preview pixels on its shorter side. */
export function patchSource(crop: Roi, previewScale: number): 'preview' | 'full' {
  return previewScale < 1 && Math.min(crop.w, crop.h) * previewScale >= PATCH_SIZE ? 'preview' : 'full';
}

/** The fixed encode: linear sRGB (0 to 1) to 8 bits. */
export const srgbEncode8 = (v: number) => Math.round(255 * srgbOetf(Math.min(1, Math.max(0, v))));
/** The fixed decode: 8 bits to linear sRGB. */
export const srgbDecode8 = (u: number) => srgbEotf(u / 255);

/** Scene-linear Rec.2020 RGBA to the model's 8-bit sRGB RGBA (alpha 255). */
export function encodeModelInput(px: Float32Array): Uint8Array {
  const out = new Uint8Array(px.length);
  const m = REC2020_TO_SRGB;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    for (let c = 0; c < 3; c++) out[i + c] = srgbEncode8(m[c][0] * r + m[c][1] * g + m[c][2] * b);
    out[i + 3] = 255;
  }
  return out;
}

/** The model's 8-bit sRGB RGBA back to linear Rec.2020 RGBA (alpha 1). */
export function decodePatch(px: Uint8Array): Float32Array {
  const out = new Float32Array(px.length);
  const m = SRGB_TO_REC2020;
  for (let i = 0; i < px.length; i += 4) {
    const r = srgbDecode8(px[i]), g = srgbDecode8(px[i + 1]), b = srgbDecode8(px[i + 2]);
    for (let c = 0; c < 3; c++) out[i + c] = m[c][0] * r + m[c][1] * g + m[c][2] * b;
    out[i + 3] = 1;
  }
  return out;
}

/** A patch: the model's PATCH_SIZE² output, 8-bit sRGB RGBA, over `crop` (full-size pixels), made for `key`. */
export interface Patch {
  key: string;
  crop: Roi;
  pixels: Uint8Array;
}

/** What a Remove spot without its patch asks for. */
export interface PatchRequest {
  key: string;
  /** The spot's id: where the patch goes in RemoveSetup.patches, its last one shown meanwhile. */
  spot: string;
  /** Full-size pixels. */
  crop: Roi;
  /** The source whose pixels the model should see (patchSource). */
  source: 'preview' | 'full';
  /**
   * The model's input, when this run is on that source and holds the whole crop: PATCH_SIZE²
   * 8-bit sRGB RGBA of the retouch step's pixels at this spot's turn, and the mask (255 to fill).
   */
  input?: { image: Uint8Array; mask: Uint8Array };
}

/**
 * One axis of a triangle-filter resample (PIL's bilinear): for each output pixel, the source
 * indices and weights. `at(j)` is output pixel j's centre in source pixel coordinates (centres
 * at integers), `ratio` source pixels per output pixel; indices are clamped to [lo, hi].
 */
export function axisWeights(n: number, at: (j: number) => number, ratio: number, lo: number, hi: number): { idx: Int32Array[]; wt: Float32Array[] } {
  const support = Math.max(1, ratio);
  const idx: Int32Array[] = [], wt: Float32Array[] = [];
  for (let j = 0; j < n; j++) {
    const u = at(j);
    const i0 = Math.ceil(u - support), i1 = Math.floor(u + support);
    const is: number[] = [], ws: number[] = [];
    let sum = 0;
    for (let i = i0; i <= i1; i++) {
      const v = 1 - Math.abs(i - u) / support;
      if (v <= 0) continue;
      is.push(Math.min(hi, Math.max(lo, i))); ws.push(v); sum += v;
    }
    idx.push(Int32Array.from(is)); wt.push(Float32Array.from(ws, (v) => v / sum));
  }
  return { idx, wt };
}

/** A separable resample of RGBA `src` (sw wide, its index 0 at `ox`, `oy`) by per-axis weights. */
export function resample(src: Float32Array, sw: number, ox: number, oy: number, xs: ReturnType<typeof axisWeights>, ys: ReturnType<typeof axisWeights>): Float32Array {
  const ow = xs.idx.length, oh = ys.idx.length;
  // Rows first: only the source rows some output row reads.
  let r0 = Infinity, r1 = -Infinity;
  for (const is of ys.idx) for (const i of is) { r0 = Math.min(r0, i); r1 = Math.max(r1, i); }
  const tmp = new Float32Array(4 * ow * Math.max(0, r1 - r0 + 1));
  for (let r = r0; r <= r1; r++) {
    const row = 4 * (r - oy) * sw;
    for (let x = 0; x < ow; x++) {
      const is = xs.idx[x], ws = xs.wt[x];
      let a = 0, b = 0, c = 0, d = 0;
      for (let k = 0; k < is.length; k++) {
        const s = row + 4 * (is[k] - ox), v = ws[k];
        a += src[s] * v; b += src[s + 1] * v; c += src[s + 2] * v; d += src[s + 3] * v;
      }
      const t = 4 * ((r - r0) * ow + x);
      tmp[t] = a; tmp[t + 1] = b; tmp[t + 2] = c; tmp[t + 3] = d;
    }
  }
  const out = new Float32Array(4 * ow * oh);
  for (let y = 0; y < oh; y++) {
    const is = ys.idx[y], ws = ys.wt[y];
    for (let k = 0; k < is.length; k++) {
      const s = 4 * (is[k] - r0) * ow, v = ws[k];
      for (let x = 0; x < 4 * ow; x++) out[4 * y * ow + x] += tmp[s + x] * v;
    }
  }
  return out;
}

/** The model's mask over the crop: 255 in every PATCH_SIZE cell a masked full-size pixel touches. */
export function modelMask(shape: RetouchShape, crop: Roi, W: number, H: number): Uint8Array {
  const out = new Uint8Array(PATCH_SIZE * PATCH_SIZE);
  const { roi, mask } = fullMask(shape, W, H);
  const sx = PATCH_SIZE / crop.w, sy = PATCH_SIZE / crop.h;
  for (let i = 0; i < roi.h; i++) {
    const y = roi.y + i;
    if (y < crop.y || y >= crop.y + crop.h) continue;
    const c0 = Math.floor((y - crop.y) * sy), c1 = Math.min(PATCH_SIZE, Math.ceil((y + 1 - crop.y) * sy));
    for (let j = 0; j < roi.w; j++) {
      const x = roi.x + j;
      if (x < crop.x || x >= crop.x + crop.w || !masked(mask[i * roi.w + j])) continue;
      const d0 = Math.floor((x - crop.x) * sx), d1 = Math.min(PATCH_SIZE, Math.ceil((x + 1 - crop.x) * sx));
      for (let c = c0; c < c1; c++) out.fill(255, c * PATCH_SIZE + d0, c * PATCH_SIZE + d1);
    }
  }
  return out;
}

/** 53 bits of cyrb53 (public domain, bryc), as hex. */
function cyrb53(s: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** A 106-bit hex digest of a string, for patch keys (names in the native patch cache). */
export const digest = (s: string) => cyrb53(s, 0) + cyrb53(s, 0x9e3779b9);

/**
 * The part of a patch key from the edits before the retouch step: the source (its identity and
 * decode settings, which the caller names), capture sharpening, lens correction, the camera
 * profile, white balance and noise reduction. Nothing after the step (Exposure, tones, the look).
 */
export function preRetouchKey(source: string, recipe: Pick<Recipe, 'profile' | 'autoProfile' | 'lens' | 'wb' | 'noiseReduction' | 'profiledDenoise' | 'captureSharpening'>): string {
  const nr = recipe.noiseReduction?.enabled ? recipe.noiseReduction : null;
  const key: unknown[] = [source, recipe.captureSharpening, recipe.lens, recipe.profile, recipe.profile === 'auto' ? recipe.autoProfile ?? null : null, recipe.wb, nr];
  // Appended only when present, so keys (and the native patch cache) made before it stay valid.
  if (recipe.profiledDenoise != null) key.push(recipe.profiledDenoise);
  return JSON.stringify(key);
}

/**
 * A Remove spot's patch key: the edits before the step (`base`), the model's hash, the spot's
 * shape, and the earlier spots that change the pixels in its crop (with everything they read,
 * retouchInputs' closure). Not a hash of pixels, so the preview and the full size share it; ids
 * and the spot's own opacity are left out, so virtual copies share it too.
 */
export function patchKey(base: string, model: string, spots: RetouchSpot[], index: number, crop: Roi, W: number, H: number, setup: RetouchSetup): string {
  const spot = spots[index];
  const earlier = retouchInputs(spots.slice(0, index), crop, W, H, 1, W, H, setup).spots.map(({ id: _id, ...rest }) => rest);
  const scales = earlier.some((s) => s.scale > 0) ? [setup.scales, setup.mergeFrom] : null;
  return digest(JSON.stringify([base, model, W, H, spot.model ?? 'lama-fp32', spot.shape, earlier, scales]));
}

/** Retouch's display inputs retain their native encoding until the later input shader. */
export type RetouchEncoding = 'scene' | 'linear-srgb' | 'srgb';
export function encodeRetouchInput(px: Float32Array, encoding: RetouchEncoding = 'scene'): Uint8Array {
  if (encoding === 'scene') return encodeModelInput(px);
  const out = new Uint8Array(px.length);
  for (let i = 0; i < px.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = encoding === 'srgb' ? Math.round(255 * Math.min(1, Math.max(0, px[i + c]))) : srgbEncode8(px[i + c]);
    out[i + 3] = 255;
  }
  return out;
}
export function decodeRetouchPatch(px: Uint8Array, encoding: RetouchEncoding = 'scene'): Float32Array {
  if (encoding === 'scene') return decodePatch(px);
  const out = new Float32Array(px.length);
  for (let i = 0; i < px.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = encoding === 'srgb' ? px[i + c] / 255 : srgbDecode8(px[i + c]);
    out[i + 3] = 1;
  }
  return out;
}
