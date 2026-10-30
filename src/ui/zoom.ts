// SPDX-License-Identifier: GPL-3.0-or-later
// Zoom and pan for the develop view, as pure functions.
//
// Scale is device pixels per pixel of the full-resolution image, so 1 is 100%
// (one image pixel per screen pixel) whatever resolution is loaded. The canvas
// grows with the image up to the stage, and shows a window onto it: the view,
// in image coordinates from 0 to 1 with y = 0 at the top.

import type { View } from '../engine/engine';

export interface Zoom {
  /** null fits the whole image in the stage. */
  scale: number | null;
  /** Image point at the centre of the stage. */
  cx: number;
  cy: number;
}

export interface Layout {
  /** Canvas size in CSS pixels and in device pixels. */
  cssW: number;
  cssH: number;
  pxW: number;
  pxH: number;
  view: View;
  /** The scale actually used: device pixels per full-resolution pixel. */
  scale: number;
}

export const FIT: Zoom = { scale: null, cx: 0.5, cy: 0.5 };
/** Preset zoom levels; zooming in and out steps through these. */
export const LEVELS = [0.25, 0.5, 1, 2, 4];
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;

export const fitScale = (boxW: number, boxH: number, dpr: number, fullW: number, fullH: number) =>
  Math.min((boxW * dpr) / fullW, (boxH * dpr) / fullH);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Canvas size and view for a zoom state in a stage of boxW × boxH CSS pixels. */
export function layout(z: Zoom, boxW: number, boxH: number, dpr: number, fullW: number, fullH: number): Layout {
  const fit = fitScale(boxW, boxH, dpr, fullW, fullH);
  const scale = z.scale === null ? fit : clamp(z.scale, Math.min(MIN_SCALE, fit), MAX_SCALE);
  const dispW = fullW * scale;
  const dispH = fullH * scale;
  const pxW = Math.max(1, Math.round(Math.min(dispW, boxW * dpr)));
  const pxH = Math.max(1, Math.round(Math.min(dispH, boxH * dpr)));
  // Within half a pixel of the whole image counts as the whole image.
  const w = pxW >= dispW - 0.5 ? 1 : pxW / dispW;
  const h = pxH >= dispH - 0.5 ? 1 : pxH / dispH;
  const cx = clamp(z.cx, w / 2, 1 - w / 2);
  const cy = clamp(z.cy, h / 2, 1 - h / 2);
  return { cssW: pxW / dpr, cssH: pxH / dpr, pxW, pxH, view: { x: cx - w / 2, y: cy - h / 2, w, h }, scale };
}

/** The image point under a canvas point given as a fraction of the canvas (0 to 1). */
export const imagePoint = (view: View, fx: number, fy: number): [number, number] => [view.x + fx * view.w, view.y + fy * view.h];

/**
 * Zoom to `scale`, keeping the image point under the cursor (canvas fraction
 * fx, fy of the current layout) where it is on screen.
 */
export function zoomAt(cur: Layout, scale: number, fx: number, fy: number, boxW: number, boxH: number, dpr: number, fullW: number, fullH: number): Zoom {
  const [px, py] = imagePoint(cur.view, fx, fy);
  const next = layout({ scale, cx: 0.5, cy: 0.5 }, boxW, boxH, dpr, fullW, fullH);
  // Where the cursor sits on screen relative to the stage centre, in CSS pixels.
  const offX = (fx - 0.5) * cur.cssW;
  const offY = (fy - 0.5) * cur.cssH;
  const k = dpr / (fullW * next.scale);
  const kY = dpr / (fullH * next.scale);
  return { scale: next.scale, cx: px - offX * k, cy: py - offY * kY };
}

/** Pan by a drag of dx, dy CSS pixels. */
export function pan(z: Zoom, cur: Layout, dx: number, dy: number, dpr: number, fullW: number, fullH: number): Zoom {
  const cx = cur.view.x + cur.view.w / 2 - (dx * dpr) / (fullW * cur.scale);
  const cy = cur.view.y + cur.view.h / 2 - (dy * dpr) / (fullH * cur.scale);
  return { ...z, cx, cy };
}

/** Next preset level in or out from `scale`; out of the smallest level fits. */
export function step(scale: number, fit: number, dir: 1 | -1): number | null {
  if (dir > 0) return LEVELS.find((l) => l > scale * 1.01) ?? MAX_SCALE;
  const lower = [...LEVELS].reverse().find((l) => l < scale * 0.99);
  return lower === undefined || lower <= fit ? null : lower;
}

export const label = (z: Zoom, l: Layout) => (z.scale === null ? 'Fit' : `${Math.round(l.scale * 100)}%`);
