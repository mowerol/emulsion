// SPDX-License-Identifier: GPL-3.0-or-later
// Crop and straighten, as pure geometry.
//
// The photo is first turned by `angle` about its centre (straightened), then a
// rectangle is cut from it. The rectangle lives in straightened space, measured
// in units of the source's width and height, so that with no rotation it is the
// ordinary crop in image coordinates (0 to 1, y = 0 at the top). A rectangle of
// w × h covers w·W × h·H pixels of a W × H source.

export type AspectId = 'free' | 'original' | '1:1' | '4:5' | '3:2' | '16:9';

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Straighten, degrees; positive turns the photo clockwise. */
  angle: number;
  /** The ratio the frame is held to while it is edited. */
  aspect: AspectId;
}

export type Rect = Pick<Crop, 'x' | 'y' | 'w' | 'h'>;

export const MAX_ANGLE = 45;
/** The smallest crop, as a share of the source's width or height. */
export const MIN_SIZE = 0.02;

export const ASPECTS: { id: AspectId; label: string; ratio: number | null }[] = [
  { id: 'original', label: 'Original', ratio: null },
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 5 / 4 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

export const FULL: Crop = { x: 0, y: 0, w: 1, h: 1, angle: 0, aspect: 'original' };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Width over height of a rectangle, in pixels. */
export const pixelRatio = (r: Rect, W: number, H: number) => (r.w * W) / (r.h * H);

/**
 * The ratio an aspect holds a rectangle to (width over height, in pixels), in
 * the rectangle's current orientation; null when it is free.
 */
export function aspectRatio(aspect: AspectId, r: Rect, W: number, H: number): number | null {
  if (aspect === 'free') return null;
  const base = aspect === 'original' ? Math.max(W, H) / Math.min(W, H) : ASPECTS.find((a) => a.id === aspect)!.ratio!;
  return pixelRatio(r, W, H) >= 1 ? base : 1 / base;
}

/**
 * The affine map from frame coordinates (0 to 1 over the crop) to source
 * coordinates: source = (a·u + b·v + e, c·u + d·v + f).
 */
export function cropAffine(c: Crop, W: number, H: number): [number, number, number, number, number, number] {
  const cos = Math.cos(rad(c.angle));
  const sin = Math.sin(rad(c.angle));
  // Straightened space, in pixels from the centre: q = ((x + u·w - 0.5)·W, (y + v·h - 0.5)·H).
  // The source point under it turns back by the angle: p = (cos·qx + sin·qy, -sin·qx + cos·qy).
  const qx0 = (c.x - 0.5) * W;
  const qy0 = (c.y - 0.5) * H;
  return [
    cos * c.w,
    (sin * c.h * H) / W,
    (-sin * c.w * W) / H,
    cos * c.h,
    (cos * qx0 + sin * qy0) / W + 0.5,
    (-sin * qx0 + cos * qy0) / H + 0.5,
  ];
}

/** The source point (0 to 1) under a frame point (0 to 1 over the crop). */
export function sourcePoint(c: Crop, W: number, H: number, u: number, v: number): [number, number] {
  const [a, b, cc, d, e, f] = cropAffine(c, W, H);
  return [a * u + b * v + e, cc * u + d * v + f];
}

/** Whether every corner of the rectangle falls on the photo once it is straightened by `angle`. */
export function fits(r: Rect, angle: number, W: number, H: number, eps = 1e-9): boolean {
  if (r.w < MIN_SIZE - eps || r.h < MIN_SIZE - eps) return false;
  const c = { ...r, angle, aspect: 'free' as const };
  for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const [sx, sy] = sourcePoint(c, W, H, u, v);
    if (sx < -eps || sx > 1 + eps || sy < -eps || sy > 1 + eps) return false;
  }
  return true;
}

/** The rectangle holding the whole photo once it is straightened by `angle`. */
export function bounds(angle: number, W: number, H: number): Rect {
  const cos = Math.abs(Math.cos(rad(angle)));
  const sin = Math.abs(Math.sin(rad(angle)));
  const w = (W * cos + H * sin) / W;
  const h = (W * sin + H * cos) / H;
  return { x: 0.5 - w / 2, y: 0.5 - h / 2, w, h };
}

const lerp = (a: Rect, b: Rect, t: number): Rect => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  w: a.w + (b.w - a.w) * t,
  h: a.h + (b.h - a.h) * t,
});

/**
 * `next`, or as far towards it from `prev` as stays on the photo. The
 * rectangles that fit form a convex set, so the search along the line is exact.
 */
export function constrain(prev: Rect, next: Rect, angle: number, W: number, H: number): Rect {
  if (fits(next, angle, W, H)) return next;
  if (!fits(prev, angle, W, H)) return prev;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(lerp(prev, next, mid), angle, W, H)) lo = mid;
    else hi = mid;
  }
  return lerp(prev, next, lo);
}

/** A rectangle of pixel ratio `ratio` centred on (cx, cy), `k` times the largest that fits the source box. */
function centred(cx: number, cy: number, ratio: number, k: number, W: number, H: number): Rect {
  // The largest of this ratio inside the unrotated frame, then scaled.
  const wPx = Math.min(W, H * ratio) * k;
  const hPx = wPx / ratio;
  const w = wPx / W;
  const h = hPx / H;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** The largest rectangle of pixel ratio `ratio` centred on (cx, cy) that fits, or null if none does. */
export function largestAt(cx: number, cy: number, ratio: number, angle: number, W: number, H: number): Rect | null {
  let lo = 0;
  let hi = 1;
  if (fits(centred(cx, cy, ratio, 1, W, H), angle, W, H)) return centred(cx, cy, ratio, 1, W, H);
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(centred(cx, cy, ratio, mid, W, H), angle, W, H)) lo = mid;
    else hi = mid;
  }
  const r = centred(cx, cy, ratio, lo, W, H);
  return fits(r, angle, W, H) ? r : null;
}

/** The largest rectangle of the given ratio centred on the photo. */
export const largest = (ratio: number, angle: number, W: number, H: number): Rect => largestAt(0.5, 0.5, ratio, angle, W, H)!;

const near = (a: Rect, b: Rect, tol = 1e-4) => Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol && Math.abs(a.w - b.w) < tol && Math.abs(a.h - b.h) < tol;

/** The rectangle `r` held to `ratio` around its centre, as large as fits there (or centred on the photo if nothing does). */
function reshape(r: Rect, ratio: number, angle: number, W: number, H: number): Rect {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  // Keep about the same area, then shrink until it fits.
  const area = r.w * W * r.h * H;
  const wPx = Math.sqrt(area * ratio);
  const want = { x: cx - wPx / W / 2, y: cy - wPx / ratio / H / 2, w: wPx / W, h: wPx / ratio / H };
  if (fits(want, angle, W, H)) return want;
  const at = largestAt(cx, cy, ratio, angle, W, H);
  return at && at.w * W >= want.w * W * 0.5 ? at : largest(ratio, angle, W, H);
}

/** Change the straighten angle, keeping the crop where it is and shrinking it only as much as needed. */
export function setAngle(c: Crop, angle: number, W: number, H: number): Crop {
  const a = clamp(angle, -MAX_ANGLE, MAX_ANGLE);
  const ratio = pixelRatio(c, W, H);
  // A crop that was as large as it could be stays as large as it can be.
  if (near(c, largest(ratio, c.angle, W, H))) return { ...c, ...largest(ratio, a, W, H), angle: a };
  if (fits(c, a, W, H)) return { ...c, angle: a };
  const at = largestAt(c.x + c.w / 2, c.y + c.h / 2, ratio, a, W, H);
  const r = at && at.w <= c.w ? at : largest(ratio, a, W, H);
  return { ...c, ...r, angle: a };
}

/** Hold the crop to an aspect. */
export function setAspect(c: Crop, aspect: AspectId, W: number, H: number): Crop {
  const ratio = aspectRatio(aspect, c, W, H);
  if (ratio === null) return { ...c, aspect };
  return { ...c, ...reshape(c, ratio, c.angle, W, H), aspect };
}

/** Swap between landscape and portrait, keeping the aspect. */
export function rotateFrame(c: Crop, W: number, H: number): Crop {
  const ratio = 1 / pixelRatio(c, W, H);
  return { ...c, ...reshape(c, ratio, c.angle, W, H) };
}

/** Move the crop by (dx, dy) in crop units, sliding along an edge when one is reached. */
export function move(c: Crop, dx: number, dy: number, W: number, H: number): Crop {
  const sx = constrain(c, { ...c, x: c.x + dx }, c.angle, W, H);
  const sy = constrain(sx, { ...sx, y: sx.y + dy }, c.angle, W, H);
  return { ...c, x: sy.x, y: sy.y };
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * Drag a handle by (dx, dy) in crop units, from the crop as it was when the
 * drag began. The opposite edge or corner stays put; with an aspect, a side
 * handle resizes about the middle of the frame.
 */
export function resize(start: Crop, handle: Handle, dx: number, dy: number, W: number, H: number): Crop {
  const ratio = aspectRatio(start.aspect, start, W, H);
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + start.w;
  let y1 = start.y + start.h;
  if (handle.includes('w')) x0 = Math.min(x0 + dx, x1 - MIN_SIZE);
  if (handle.includes('e')) x1 = Math.max(x1 + dx, x0 + MIN_SIZE);
  if (handle.includes('n')) y0 = Math.min(y0 + dy, y1 - MIN_SIZE);
  if (handle.includes('s')) y1 = Math.max(y1 + dy, y0 + MIN_SIZE);
  let next: Rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };

  if (ratio !== null) {
    const horizontal = handle.includes('e') || handle.includes('w');
    const vertical = handle.includes('n') || handle.includes('s');
    if (horizontal && vertical) {
      // A corner follows whichever side moved further, in pixels.
      const wPx = Math.max(next.w * W, next.h * H * ratio);
      const w = wPx / W;
      const h = wPx / ratio / H;
      next = {
        x: handle.includes('w') ? start.x + start.w - w : start.x,
        y: handle.includes('n') ? start.y + start.h - h : start.y,
        w,
        h,
      };
    } else if (horizontal) {
      const h = (next.w * W) / ratio / H;
      next = { ...next, y: start.y + start.h / 2 - h / 2, h };
    } else {
      const w = (next.h * H * ratio) / W;
      next = { ...next, x: start.x + start.w / 2 - w / 2, w };
    }
  }
  return { ...start, ...constrain(start, next, start.angle, W, H) };
}

/** Whether a crop changes anything. */
export const isFull = (c: Crop | null) => !c || (c.angle === 0 && near(c, FULL, 1e-6));

/** Pixel size of the cropped frame for a W × H source. */
export function framePixels(c: Crop | null, W: number, H: number): [number, number] {
  if (!c) return [W, H];
  return [Math.max(1, Math.round(c.w * W)), Math.max(1, Math.round(c.h * H))];
}

const ASPECT_IDS = ASPECTS.map((a) => a.id);

/** A crop read from a sidecar, or null when there is none or it is not one. */
export function normalizeCrop(input: unknown): Crop | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const [x, y, w, h, angle] = [o.x, o.y, o.w, o.h, o.angle].map(num);
  if (x === null || y === null || w === null || h === null || angle === null) return null;
  const aspect = ASPECT_IDS.includes(o.aspect as AspectId) ? (o.aspect as AspectId) : 'free';
  // Without the photo's size, whether it fits can't be checked here; editing it
  // brings it back onto the photo, and the develop pass paints off-photo pixels.
  const a = clamp(angle, -MAX_ANGLE, MAX_ANGLE);
  const cw = clamp(w, MIN_SIZE, 2);
  const ch = clamp(h, MIN_SIZE, 2);
  const c: Crop = { x: clamp(x, -1, 2 - cw), y: clamp(y, -1, 2 - ch), w: cw, h: ch, angle: a, aspect };
  return isFull(c) ? null : c;
}
