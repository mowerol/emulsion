// Copyright (C) 2013-2025 darktable developers.
// Ported from darktable src/develop/masks/brush.c at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773
// (release 5.6.2): _brush_point_line_distance2 and _brush_ramer_douglas_peucker (simplifying a
// drawn stroke into nodes, at its "medium" smoothing), _brush_catmull_to_bezier and
// _brush_init_ctrl_points (the spline through the nodes), _brush_get_XY and _brush_points_recurs
// (sampling it, with the border eased between nodes by t²(3 - 2t) and hardness and density
// linear), and _brush_falloff_roi (full density out to hardness × border, then linear to the
// border). Translated from C to TypeScript, the reference for brush.frag.glsl. darktable stamps
// falloff lines from each sampled point to its border point and arcs at the ends; here each pixel
// takes the largest falloff over the sampled segments by its distance to them, which is the
// same shape without the stamping's pixel rounding.
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BrushNode, BrushShape } from '../film/masks';

/** One straight piece of a sampled stroke, in source pixels: ends, borders, hardness, density. */
export type Segment = [number, number, number, number, number, number, number, number, number, number];

/** darktable's _brush_point_line_distance2: distance of a node from the chord, payload weighted. */
function lineDistance2(p: BrushNode, a: BrushNode, b: BrushNode): number {
  const r3 = b.x - a.x;
  const r4 = b.y - a.y;
  const l = r3 * r3 + r4 * r4;
  const t = l === 0 ? 0 : ((p.x - a.x) * r3 + (p.y - a.y) * r4) / l;
  const q = l === 0 || t < 0 ? a : t > 1 ? b : {
    x: a.x + t * r3, y: a.y + t * r4, border: a.border + t * (b.border - a.border),
    hardness: a.hardness + t * (b.hardness - a.hardness), density: a.density + t * (b.density - a.density),
  };
  return (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.border - q.border) ** 2 + 0.01 * (p.hardness - q.hardness) ** 2 + 0.01 * (p.density - q.density) ** 2;
}

/** darktable's _brush_ramer_douglas_peucker. */
export function simplify(points: BrushNode[], epsilon2: number): BrushNode[] {
  if (points.length < 3) return points.slice();
  let dmax = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = lineDistance2(points[i], points[0], points[points.length - 1]);
    if (d > dmax) { index = i; dmax = d; }
  }
  if (dmax >= epsilon2) {
    const a = simplify(points.slice(0, index + 1), epsilon2);
    const b = simplify(points.slice(index), epsilon2);
    return [...a.slice(0, -1), ...b];
  }
  return [points[0], points[points.length - 1]];
}

/** darktable's tolerance for a drawn stroke at its "medium" smoothing: 0.01 × border². */
export const strokeEpsilon = (border: number) => 0.01 * Math.max(0.0005, border) ** 2;

type Ctrl = { c1: [number, number]; c2: [number, number] };

/**
 * darktable's _brush_init_ctrl_points with _brush_catmull_to_bezier: node i's control points are
 * (p[i-1] + 6 p[i] - p[i+1]) / 6 before it and (-p[i-1] + 6 p[i] + p[i+1]) / 6 after it, a missing
 * neighbour at either end being the next node mirrored about the end.
 */
function controlPoints(nodes: BrushNode[]): Ctrl[] {
  const n = nodes.length;
  const at = (i: number): [number, number] =>
    i < 0 ? [2 * nodes[0].x - nodes[1].x, 2 * nodes[0].y - nodes[1].y]
      : i >= n ? [2 * nodes[n - 1].x - nodes[n - 2].x, 2 * nodes[n - 1].y - nodes[n - 2].y]
        : [nodes[i].x, nodes[i].y];
  return nodes.map((_, i) => {
    const [x1, y1] = at(i - 1), [x2, y2] = at(i), [x3, y3] = at(i + 1);
    return { c1: [(x1 + 6 * x2 - x3) / 6, (y1 + 6 * y2 - y3) / 6], c2: [(-x1 + 6 * x2 + x3) / 6, (-y1 + 6 * y2 + y3) / 6] };
  });
}

/** A stroke sampled along darktable's spline into straight pieces, in source pixels of W × H. */
export function strokeSegments(nodes: BrushNode[], W: number, H: number): Segment[] {
  const m = Math.min(W, H);
  if (!nodes.length) return [];
  if (nodes.length === 1) {
    const p = nodes[0];
    return [[p.x * W, p.y * H, p.x * W, p.y * H, p.border * m, p.border * m, p.hardness, p.hardness, p.density, p.density]];
  }
  const ctrl = controlPoints(nodes);
  const out: Segment[] = [];
  for (let k = 0; k + 1 < nodes.length; k++) {
    const a = nodes[k];
    const b = nodes[k + 1];
    const P = [[a.x * W, a.y * H], [ctrl[k].c2[0] * W, ctrl[k].c2[1] * H], [ctrl[k + 1].c1[0] * W, ctrl[k + 1].c1[1] * H], [b.x * W, b.y * H]];
    const chord = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]) + Math.hypot(P[2][0] - P[1][0], P[2][1] - P[1][1]) + Math.hypot(P[3][0] - P[2][0], P[3][1] - P[2][1]);
    const steps = Math.max(1, Math.min(256, Math.ceil(chord / 3)));
    const point = (t: number) => {
      const ti = 1 - t;
      const w = [ti * ti * ti, 3 * t * ti * ti, 3 * t * t * ti, t * t * t];
      return [
        P[0][0] * w[0] + P[1][0] * w[1] + P[2][0] * w[2] + P[3][0] * w[3],
        P[0][1] * w[0] + P[1][1] * w[1] + P[2][1] * w[2] + P[3][1] * w[3],
        (a.border + (b.border - a.border) * t * t * (3 - 2 * t)) * m,
        a.hardness + t * (b.hardness - a.hardness),
        a.density + t * (b.density - a.density),
      ];
    };
    let prev = point(0);
    for (let i = 1; i <= steps; i++) {
      const cur = point(i / steps);
      out.push([prev[0], prev[1], cur[0], cur[1], prev[2], cur[2], prev[3], cur[3], prev[4], cur[4]]);
      prev = cur;
    }
  }
  return out;
}

/** darktable's _brush_falloff_roi in closed form: density to hardness × border, then linear to 0. */
export function falloff(d: number, r: number, hardness: number, density: number): number {
  if (d >= r) return 0;
  const solid = hardness * r;
  if (d <= solid) return density;
  return density * (r - d) / (r - solid);
}

/** A segment's value at pixel (x, y): the falloff at the distance to its nearest point. */
export function segmentValue(s: Segment, x: number, y: number): number {
  const dx = s[2] - s[0];
  const dy = s[3] - s[1];
  const l = dx * dx + dy * dy;
  const t = l > 0 ? Math.min(1, Math.max(0, ((x - s[0]) * dx + (y - s[1]) * dy) / l)) : 0;
  const d = Math.hypot(x - (s[0] + t * dx), y - (s[1] + t * dy));
  return falloff(d, s[4] + t * (s[5] - s[4]), s[6] + t * (s[7] - s[6]), s[8] + t * (s[9] - s[8]));
}

/** All of a brush shape's segments. */
export const brushSegments = (b: BrushShape, W: number, H: number) => b.strokes.flatMap((st) => strokeSegments(st, W, H));

/** The brush shape at source point (u, v): the largest value over its strokes (darktable's union). */
export function brushValue(b: BrushShape, u: number, v: number, W: number, H: number): number {
  const x = u * W;
  const y = v * H;
  let best = 0;
  for (const s of brushSegments(b, W, H)) best = Math.max(best, segmentValue(s, x, y));
  return best;
}
