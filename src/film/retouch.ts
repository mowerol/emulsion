// SPDX-License-Identifier: GPL-3.0-or-later
// Retouch: darktable's retouch module (src/iop/retouch.c), its clone and heal tools. A photo holds
// a list of spots, applied in order, each on the result of the ones before it, as darktable does
// ("this way the source for one algorithm can be the destination from a previous one").
//
// Each spot is one of darktable's drawn forms (a circle, or one brush stroke) with its source
// point (form->source) and its opacity in the module's group. Coordinates are source coordinates
// (0 to 1 over the uncropped, oriented photo, y down), like masks', so crop and turns never move
// them. Sizes are in units of the photo's shorter side, as darktable's.
// See engine/retouch.ts for the processing.

import { BRUSH_DEFAULTS, newId, type BrushNode } from './masks';

/** darktable's DT_IOP_RETOUCH_CLONE and DT_IOP_RETOUCH_HEAL; heal is the module's default. */
export type RetouchTool = 'clone' | 'heal';

/** darktable's circle (dt_masks_point_circle_t): radius and feather in units of the shorter side. */
export interface RetouchCircle {
  kind: 'circle';
  center: [number, number];
  radius: number;
  border: number;
}

/** One of darktable's brush forms: a single stroke. */
export interface RetouchBrush {
  kind: 'brush';
  nodes: BrushNode[];
}

export interface RetouchSpot {
  id: string;
  tool: RetouchTool;
  shape: RetouchCircle | RetouchBrush;
  /** Where the pixels come from: darktable's form->source, the point matching the shape's centre (a brush's first node). */
  source: [number, number];
  /** darktable's form opacity in the group, 0 to 1. */
  opacity: number;
}

/** darktable's defaults for a new spot circle (darktableconfig.xml.in: spots/circle_size and circle_border). */
export const CIRCLE_DEFAULTS = { radius: 0.02, border: 0.02 };

/** Enough for a whole session of dust spotting. */
export const MAX_SPOTS = 250;

/** The point a spot's source offset is measured from: a circle's centre, a brush's first node (darktable's pt->corner). */
export const spotAnchor = (s: RetouchSpot['shape']): [number, number] =>
  s.kind === 'circle' ? s.center : s.nodes.length ? [s.nodes[0].x, s.nodes[0].y] : [0, 0];

/**
 * darktable's first source for a new spot (dt_masks_set_source_pos_initial_value, relative type,
 * nothing chosen yet): a circle's is right and up by its radius (_circle_initial_source_pos,
 * radius × image width and height), a brush's right and down by 1% (_brush_initial_source_pos).
 */
export function initialSource(shape: RetouchSpot['shape']): [number, number] {
  const [x, y] = spotAnchor(shape);
  if (shape.kind === 'circle') {
    const r = Math.min(0.5, shape.radius);
    return [x + r, y - r];
  }
  return [x + 0.01, y + 0.01];
}

export function newCircleSpot(center: [number, number], tool: RetouchTool = 'heal', radius = CIRCLE_DEFAULTS.radius, border = CIRCLE_DEFAULTS.border, source?: [number, number]): RetouchSpot {
  const shape: RetouchCircle = { kind: 'circle', center, radius, border };
  return { id: newId(), tool, shape, source: source ?? initialSource(shape), opacity: 1 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback);
const pair = (v: unknown, lo: number, hi: number): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [clamp(v[0], lo, hi), clamp(v[1], lo, hi)] : null;

function normalizeShape(input: unknown): RetouchSpot['shape'] | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  if (o.kind === 'circle') {
    const center = pair(o.center, -2, 3);
    return center ? { kind: 'circle', center, radius: num(o.radius, CIRCLE_DEFAULTS.radius, 0.0005, 0.5), border: num(o.border, CIRCLE_DEFAULTS.border, 0.0005, 0.5) } : null;
  }
  if (o.kind === 'brush' && Array.isArray(o.nodes)) {
    const nodes = o.nodes.slice(0, 5000).flatMap((n): BrushNode[] => {
      if (!n || typeof n !== 'object') return [];
      const q = n as Record<string, unknown>;
      if (typeof q.x !== 'number' || typeof q.y !== 'number' || !Number.isFinite(q.x) || !Number.isFinite(q.y)) return [];
      return [{ x: clamp(q.x, -2, 3), y: clamp(q.y, -2, 3), border: num(q.border, BRUSH_DEFAULTS.border, 0.0005, 1), hardness: num(q.hardness, BRUSH_DEFAULTS.hardness, 0, 1), density: num(q.density, BRUSH_DEFAULTS.density, 0, 1) }];
    });
    return nodes.length ? { kind: 'brush', nodes } : null;
  }
  return null;
}

/** Spots read from a sidecar: invalid ones dropped, values clamped, at most MAX_SPOTS. */
export function normalizeRetouch(input: unknown): RetouchSpot[] {
  if (!Array.isArray(input)) return [];
  const out: RetouchSpot[] = [];
  for (const item of input) {
    if (out.length >= MAX_SPOTS || !item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const shape = normalizeShape(o.shape);
    const source = pair(o.source, -2, 3);
    if (!shape || !source) continue;
    out.push({ id: typeof o.id === 'string' && o.id.length > 0 && o.id.length < 80 ? o.id : newId(), tool: o.tool === 'clone' ? 'clone' : 'heal', shape, source, opacity: num(o.opacity, 1, 0, 1) });
  }
  return out;
}
