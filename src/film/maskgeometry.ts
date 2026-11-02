// SPDX-License-Identifier: GPL-3.0-or-later
// Geometry for drawing and dragging mask shapes over the photo. Shapes live in source
// coordinates (0 to 1, y down) and are measured in source pixels of a W × H photo, as darktable
// measures them in input image pixels; see engine/masks.ts for what their parameters mean.

import { cropAffine, type Crop } from './crop';
import type { EllipseShape, GradientShape } from './masks';

/** What the ellipse helpers read: a mask's ellipse or a retouch spot's. */
export type EllipseLike = Pick<EllipseShape, 'center' | 'radius' | 'rotation' | 'border' | 'proportional'>;

export type Pt = [number, number];

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** The frame point (0 to 1 over the crop) over a source point: the inverse of `sourcePoint`. */
export function framePoint(c: Crop, W: number, H: number, su: number, sv: number): Pt {
  const [a, b, cc, d, e, f] = cropAffine(c, W, H);
  const det = a * d - b * cc;
  const x = su - e;
  const y = sv - f;
  return [(d * x - b * y) / det, (-cc * x + a * y) / det];
}

/**
 * A gradient's line, offset by `offset` (in units of the diagonal, towards the full effect), as
 * source points: darktable's line where distance = y0 - curvature·x0² equals `offset`.
 */
export function gradientLine(g: GradientShape, W: number, H: number, offset = 0, n = 41): Pt[] {
  const diag = Math.hypot(W, H);
  const v = rad(-g.rotation);
  const t: Pt = [Math.cos(v), Math.sin(v)];
  const nn: Pt = [Math.sin(v), -Math.cos(v)];
  const ax = g.anchor[0] * W;
  const ay = g.anchor[1] * H;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = -1 + (2 * i) / (n - 1);
    const y0 = offset + g.curvature * x0 * x0;
    pts.push([(ax + (x0 * t[0] + y0 * nn[0]) * diag) / W, (ay + (x0 * t[1] + y0 * nn[1]) * diag) / H]);
  }
  return pts;
}

/** The unit normal of a gradient (towards the full effect), in source pixels. */
export function gradientNormal(g: GradientShape): Pt {
  const v = rad(-g.rotation);
  return [Math.sin(v), -Math.cos(v)];
}

/** A point `d` diagonals from the anchor along the normal, in source coordinates. */
export function alongNormal(g: GradientShape, W: number, H: number, d: number): Pt {
  const [nx, ny] = gradientNormal(g);
  const diag = Math.hypot(W, H);
  return [g.anchor[0] + (nx * d * diag) / W, g.anchor[1] + (ny * d * diag) / H];
}

/** The rotation whose normal points along (nx, ny), in source pixels. */
export const rotationFor = (nx: number, ny: number) => deg(Math.atan2(-nx, -ny));

/** How far (in diagonals) a source point lies from the anchor along the normal. */
export function normalDistance(g: GradientShape, W: number, H: number, p: Pt): number {
  const [nx, ny] = gradientNormal(g);
  return (((p[0] - g.anchor[0]) * W) * nx + ((p[1] - g.anchor[1]) * H) * ny) / Math.hypot(W, H);
}

/** erf(x) reaches 0.96 at about this x: a drag spans the transition from 2% to 98%. */
const DRAG_SPAN = 1.45;

/**
 * A gradient drawn by dragging, as Lightroom draws one: full effect where the drag starts, none
 * where it ends. darktable's anchor is the middle, its compression the half length over DRAG_SPAN.
 */
export function gradientFromDrag(p0: Pt, p1: Pt, W: number, H: number): Pick<GradientShape, 'anchor' | 'rotation' | 'compression'> {
  const dx = (p0[0] - p1[0]) * W;
  const dy = (p0[1] - p1[1]) * H;
  const len = Math.hypot(dx, dy);
  return {
    anchor: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2],
    rotation: rotationFor(dx / len, dy / len),
    compression: Math.min(1, Math.max(0.001, len / 2 / DRAG_SPAN / Math.hypot(W, H))),
  };
}

/** The compression that puts the transition's edge (DRAG_SPAN compressions) at distance `d`. */
export const compressionForEdge = (d: number) => Math.min(1, Math.max(0.001, Math.abs(d) / DRAG_SPAN));
export const edgeForCompression = (c: number) => c * DRAG_SPAN;

/** The ellipse's axes in source pixels: a along (cos, sin) of the rotation, b at right angles. */
function axes(e: EllipseLike): [Pt, Pt] {
  const a = rad(e.rotation);
  return [[Math.cos(a), Math.sin(a)], [-Math.sin(a), Math.cos(a)]];
}

/** The ellipse's outline, grown by `grow` (its feather, when true), as source points. */
export function ellipseOutline(e: EllipseLike, W: number, H: number, grow = false, n = 64): Pt[] {
  const m = Math.min(W, H);
  const [ra, rb] = grow
    ? (e.proportional ? [e.radius[0] * (1 + e.border), e.radius[1] * (1 + e.border)] : [e.radius[0] + e.border, e.radius[1] + e.border])
    : e.radius;
  const [ua, ub] = axes(e);
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    const x = Math.cos(t) * ra * m;
    const y = Math.sin(t) * rb * m;
    return [e.center[0] + (x * ua[0] + y * ub[0]) / W, e.center[1] + (x * ua[1] + y * ub[1]) / H] as Pt;
  });
}

/** Handles: the end of axis a, of axis b, and of the feather along a. */
export function ellipseHandles(e: EllipseLike, W: number, H: number): { a: Pt; b: Pt; feather: Pt } {
  const m = Math.min(W, H);
  const [ua, ub] = axes(e);
  const at = (u: Pt, r: number): Pt => [e.center[0] + (u[0] * r * m) / W, e.center[1] + (u[1] * r * m) / H];
  const fa = e.proportional ? e.radius[0] * (1 + e.border) : e.radius[0] + e.border;
  return { a: at(ua, e.radius[0]), b: at(ub, e.radius[1]), feather: at(ua, fa) };
}

/** A source point relative to the centre, in units of the shorter side, along both axes. */
export function ellipseLocal(e: EllipseLike, W: number, H: number, p: Pt): { a: number; b: number; angle: number; length: number } {
  const m = Math.min(W, H);
  const x = (p[0] - e.center[0]) * W;
  const y = (p[1] - e.center[1]) * H;
  const [ua, ub] = axes(e);
  return { a: (x * ua[0] + y * ua[1]) / m, b: (x * ub[0] + y * ub[1]) / m, angle: deg(Math.atan2(y, x)), length: Math.hypot(x, y) / m };
}

/** An ellipse drawn by dragging from its centre: the drag's ends set the semi-axes. */
export function ellipseFromDrag(p0: Pt, p1: Pt, W: number, H: number): Pick<EllipseShape, 'center' | 'radius'> {
  const m = Math.min(W, H);
  return { center: p0, radius: [Math.max(0.01, (Math.abs(p1[0] - p0[0]) * W) / m), Math.max(0.01, (Math.abs(p1[1] - p0[1]) * H) / m)] };
}

/** The feather that puts the feather's edge along axis a at `length` (shorter sides from the centre). */
export function featherFor(e: EllipseLike, length: number): number {
  const b = e.proportional ? length / e.radius[0] - 1 : length - e.radius[0];
  return Math.min(1, Math.max(0.001, b));
}
