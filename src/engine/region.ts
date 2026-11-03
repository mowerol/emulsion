// SPDX-License-Identifier: GPL-3.0-or-later
// Developing only the part of a full-size source on screen (docs/plans/roi.md), as darktable's
// full pipe processes only its region of interest. The region is the visible rectangle plus
// every active stage's reach, so local operations match a whole-photo render: darktable
// states each module's reach as its tiling overlap; we pad by those amounts rather than leave
// the region's edges unpadded as darktable's darkroom does.
// Whole-photo preview products (including coarse Clarity/Texture) are approximations; see NOTICE.

import type { Crop } from '../film/crop';
import { geometryMatrix, project, type Perspective } from './perspective';
import type { View } from './engine';
import { borderFor, kernelFor, TILE } from './capture';
import { windows } from './dehaze';
import { usmKernel } from './usm';
import { gaussian1d } from './capture';
import type { LensSpline } from './lenscorrection';

/** A rectangle of source-texture pixels. */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The rectangle of the source (in its texture's pixels, W × H) under the part of the frame the
 * view shows: the view's corners mapped through crop and perspective (a projective map takes
 * the view's rectangle to a quadrilateral, so its corners bound it), clamped to the source.
 */
export function visibleSource(view: View, frame: Crop, transform: Perspective | null | undefined, W: number, H: number, fullW: number, fullH: number): PixelRect {
  const m = geometryMatrix(frame, fullW, fullH, transform);
  const corners = [[view.x, view.y], [view.x + view.w, view.y], [view.x, view.y + view.h], [view.x + view.w, view.y + view.h]].map(([u, v]) => project(m, u, v));
  const xs = corners.map((c) => c[0] * W), ys = corners.map((c) => c[1] * H);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(W, Math.ceil(Math.max(...xs))), y1 = Math.min(H, Math.ceil(Math.max(...ys)));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/** What a region's stages are, for their reach (all in the source's pixels). */
export interface ReachSetup {
  /** Capture sharpening: the kernel's sigma at this scale and its iterations (0 off). */
  capture?: { sigma: number; iterations: number };
  lens?: { spline: LensSpline; W: number; H: number } | null;
  /** Haze removal's scale (source over full resolution), when on. */
  dehaze?: number | null;
  /** Sequential photo and masked instances add their support. */
  dehazeCount?: number;
  /** Colour on. */
  color?: boolean;
  /** Colour equalizer instances in a row (a look's, then the photo's). */
  colorCount?: number;
  /** Sharpening's radius at this scale, when on. */
  usmSigma?: number | null;
  /** Scanner sharpness on. */
  scannerSharpen?: boolean;
  /** Four fine local-Laplacian levels; their reduction/collapse halo. */
  clarity?: boolean;
  clarityCount?: number;
  /** Fine contrast-equalizer bands up to spacing 32; coarser bands come from the preview. */
  texture?: boolean;
  textureCount?: number;
}

/** How far a lens correction moves a pixel at most, in pixels: the largest |f − 1| r over its knots. */
export function lensReach(l: LensSpline, W: number, H: number): number {
  const half = Math.hypot(W / 2, H / 2);
  let most = 0;
  l.knots.forEach((r, k) => {
    for (const f of l.factors[k]) most = Math.max(most, Math.abs(f - 1) * r * half);
  });
  return Math.ceil(most - 1e-6) + 2;
}

/**
 * The stages' reach, summed as they chain (an error at a region's edge travels inwards by each
 * stage's reach in turn): RawTherapee's Richardson-Lucy (the kernel per iteration, its border and
 * the blend mask's 2 px blur), the lens's largest shift, darktable's haze removal (its box
 * maximum and minimum of w1, the guided filter's two means of w2 and the guide's), darktable's
 * colorequal overlap (16 + its largest radius, at most 4) and RawTherapee's unsharp mask (the
 * radius, its 2 px contrast-mask blur and the mask's 3 × 3 neighbourhood).
 */
export function regionReach(s: ReachSetup): number {
  const o = own(s);
  return Math.ceil(o.capture + o.lens + o.dehaze + o.texture + o.color + o.clarity + o.usm + o.scanner);
}

/** Each stage's own reach, unrounded (see regionReach). */
function own(s: ReachSetup) {
  const o = { capture: 0, lens: 0, dehaze: 0, texture: 0, color: 0, clarity: 0, usm: 0, scanner: 0 };
  if (s.capture && s.capture.iterations > 0) {
    const k = kernelFor(s.capture.sigma);
    o.capture = s.capture.iterations * k.half + borderFor(s.capture.sigma, s.capture.iterations) + (gaussian1d(2).length - 1) / 2;
  }
  if (s.lens) o.lens = lensReach(s.lens.spline, s.lens.W, s.lens.H);
  if (s.dehaze) {
    const { w1, w2 } = windows(s.dehaze);
    o.dehaze = (s.dehazeCount ?? 1) * (2 * w1 + 3 * w2);
  }
  if (s.color) o.color = (s.colorCount ?? 1) * (16 + 4);
  if (s.usmSigma) o.usm = (usmKernel(s.usmSigma).length - 1) / 2 + (gaussian1d(2).length - 1) / 2 + 1;
  // Scanner sharpness: a half-size copy blurred by one 9-tap pass each way, read bilinearly.
  if (s.scannerSharpen) o.scanner = 2 * 5 + 2;
  if (s.clarity) o.clarity = (s.clarityCount ?? 1) * (4 * (2 ** 4 - 1) + 4);
  if (s.texture) o.texture = (s.textureCount ?? 1) * 2 * (1 + 2 + 4 + 8 + 16 + 32);
  return o;
}

/** The per-edit maps whose clip can be narrowed, in develop order. */
export interface StageReach { dehaze: number; texture: number; color: number; clarity: number; usm: number }

/**
 * How far around the view each per-edit map must be right: its own reach plus that of every
 * stage after it in the develop pass (haze removal, Texture, the colour equalizer, Clarity,
 * Sharpening, then the scanner's sharpness), as an error at a map's edge travels inwards only
 * through the stages that come after it. Sharpening's input, for one, need only cover the view
 * and a few pixels, not Texture's 126.
 */
export function stageReach(s: ReachSetup): StageReach {
  const o = own(s);
  const usm = o.usm + o.scanner, clarity = usm + o.clarity, color = clarity + o.color, texture = color + o.texture, dehaze = texture + o.dehaze;
  return { dehaze: Math.ceil(dehaze), texture: Math.ceil(texture), color: Math.ceil(color), clarity: Math.ceil(clarity), usm: Math.ceil(usm) };
}

/**
 * The region to develop for a visible rectangle, in a W × H source. It is the visible rectangle
 * grown by `reach` (so its pixels are right) and by `margin` (so panning a little reuses it),
 * its origin on the capture tile grid (so Richardson-Lucy's early stop sees the whole photo's
 * tiles). A previous region is kept while it covers the visible rectangle grown by the reach and
 * is not much larger than this view needs (so zooming in reuses its maps without keeping a lane
 * built at a broader zoom).
 */
export function chooseRegion(visible: PixelRect, reach: number, margin: number, W: number, H: number, prev: PixelRect | null = null): PixelRect {
  const need = { x: visible.x - reach, y: visible.y - reach, w: visible.w + 2 * reach, h: visible.h + 2 * reach };
  const w = Math.min(W, Math.ceil((need.w + 2 * margin + TILE) / TILE) * TILE);
  const h = Math.min(H, Math.ceil((need.h + 2 * margin + TILE) / TILE) * TILE);
  const covers = (r: PixelRect) =>
    (r.x <= Math.max(0, need.x)) && (r.y <= Math.max(0, need.y)) && (r.x + r.w >= Math.min(W, need.x + need.w)) && (r.y + r.h >= Math.min(H, need.y + need.h));
  // Reuse any previous region that still covers what is needed, even if it is not this exact
  // size: zooming in leaves the previous region covering the new (smaller) view, and rebuilding
  // it would throw away the maps already made in it. A region not worth developing is not
  // reused, so a zoom that would now fit in a fresh region can still take the region path. Nor
  // is one much larger than this view needs: the lane still processes and holds its whole area,
  // so a region kept from a wider zoom would make every later render and edit pay for it. The
  // floor keeps a modest region through the last zoom steps, where the tight region is tiny.
  if (prev && covers(prev) && prev.w * prev.h < REGION_SHARE * W * H && prev.w * prev.h <= Math.max(3 * w * h, 6_000_000)) return prev;
  const place = (start: number, size: number, total: number) => {
    if (size >= total) return 0;
    const aligned = Math.floor(Math.max(0, start) / TILE) * TILE;
    // At the far edge the origin goes back onto the grid, which can only grow the overlap.
    return Math.min(aligned, Math.floor((total - size) / TILE) * TILE);
  };
  const x = place(visible.x + visible.w / 2 - w / 2, w, W);
  const y = place(visible.y + visible.h / 2 - h / 2, h, H);
  // Rounding the far-edge origin down onto the grid could leave the far side short: widen to the edge.
  const rw = Math.min(W - x, Math.max(w, Math.min(W, need.x + need.w) - x));
  const rh = Math.min(H - y, Math.max(h, Math.min(H, need.y + need.h) - y));
  return { x, y, w: rw, h: rh };
}

/** Whether a region is worth it: it must leave out a good part of the source. */
export const REGION_SHARE = 0.6;
export const regionWorthIt = (r: PixelRect, W: number, H: number) => r.w * r.h < REGION_SHARE * W * H;

/**
 * Like `chooseRegion`, but gives up the pan margin (then half of it) rather than return a region
 * that is no longer worth developing: a stage with a large reach at a zoom that just fits the
 * view can otherwise push the padded region past the limit and fall back to the whole photo.
 * `share` is the region's largest allowed fraction of the source.
 */
export function chooseRegionWithin(visible: PixelRect, reach: number, margin: number, W: number, H: number, prev: PixelRect | null = null, share = REGION_SHARE): PixelRect {
  const within = (r: PixelRect) => r.w * r.h < share * W * H;
  // A previous region is only worth keeping if it can be developed; otherwise start afresh.
  const keep = prev && within(prev) ? prev : null;
  const margins = [...new Set([margin, Math.round(margin / 2), 0])];
  for (const m of margins) {
    const r = chooseRegion(visible, reach, m, W, H, keep);
    if (within(r)) return r;
  }
  return chooseRegion(visible, reach, 0, W, H, null);
}

