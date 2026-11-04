// SPDX-License-Identifier: GPL-3.0-or-later
// Retouch: darktable's retouch module (src/iop/retouch.c). A photo holds a list of spots, applied
// in order, each on the result of the ones before it, as darktable does ("this way the source for
// one algorithm can be the destination from a previous one").
//
// Each spot is one of darktable's drawn forms (a circle, an ellipse, or one brush stroke) with its
// algorithm and that algorithm's settings (dt_iop_retouch_form_data_t), its source point
// (form->source, used by clone and heal) and its opacity in the module's group. Coordinates are
// source coordinates (0 to 1 over the uncropped, oriented photo, y down), like masks', so crop and
// turns never move them. Sizes are in units of the photo's shorter side, as darktable's.
// See engine/retouch.ts for the processing.

import { BRUSH_DEFAULTS, newId, type BrushNode } from './masks';

/**
 * darktable's DT_IOP_RETOUCH_CLONE, _HEAL, _BLUR and _FILL; heal is the module's default. Remove
 * is Emulsion's own: an AI inpainting model's patch (engine/remove.ts), on the photo itself only.
 */
export type RetouchTool = 'clone' | 'heal' | 'blur' | 'fill' | 'remove';

/** The inpainting model a Remove spot's patch comes from: big-lama, Carve's ONNX export (lama_fp32.onnx). */
export const REMOVE_MODEL = 'lama-fp32';

/** darktable's circle (dt_masks_point_circle_t): radius and feather in units of the shorter side. */
export interface RetouchCircle {
  kind: 'circle';
  center: [number, number];
  radius: number;
  border: number;
}

/** darktable's ellipse (dt_masks_point_ellipse_t). */
export interface RetouchEllipse {
  kind: 'ellipse';
  center: [number, number];
  /** Semi-axes in units of the shorter side. */
  radius: [number, number];
  /** Degrees. */
  rotation: number;
  /** Feather beyond the edge, in units of the shorter side (or of the radius when proportional). */
  border: number;
  /** darktable's DT_MASKS_ELLIPSE_PROPORTIONAL. */
  proportional: boolean;
}

/** One of darktable's brush forms: a single stroke. */
export interface RetouchBrush {
  kind: 'brush';
  nodes: BrushNode[];
}

export type RetouchShape = RetouchCircle | RetouchEllipse | RetouchBrush;
export type ShapeKind = RetouchShape['kind'];

/** darktable's DT_IOP_RETOUCH_BLUR_GAUSSIAN and _BILATERAL. */
export type BlurType = 'gaussian' | 'bilateral';
/** darktable's DT_IOP_RETOUCH_FILL_ERASE and _COLOR. */
export type FillMode = 'erase' | 'color';

export interface RetouchSpot {
  id: string;
  tool: RetouchTool;
  shape: RetouchShape;
  /** Where the pixels come from: darktable's form->source, the point matching the shape's centre (a brush's first node). */
  source: [number, number];
  /** darktable's form opacity in the group, 0 to 1. */
  opacity: number;
  /** The wavelet scale it works on: 0 the image itself, 1 to n the detail scales, n + 1 the residual. */
  scale: number;
  /** Blur: darktable's blur_type and blur_radius (full-size pixels, 0.1 to 200). */
  blurType: BlurType;
  blurRadius: number;
  /** Fill: darktable's fill_mode, fill_color (working RGB) and fill_brightness (-1 to 1, added to the colour). */
  fillMode: FillMode;
  fillColor: [number, number, number];
  fillBrightness: number;
  /** Remove: the model its patch comes from (REMOVE_MODEL). Only the id is stored, never the patch (ADR 0001). */
  model?: string;
}

/** The settings a new spot takes from the module (darktable copies p->blur_type etc. into the form data). */
export type SpotSettings = Pick<RetouchSpot, 'tool' | 'scale' | 'blurType' | 'blurRadius' | 'fillMode' | 'fillColor' | 'fillBrightness'>;

/** darktable's retouch defaults (dt_iop_retouch_params_t $DEFAULT). */
export const SPOT_DEFAULTS: SpotSettings = { tool: 'heal', scale: 0, blurType: 'gaussian', blurRadius: 10, fillMode: 'erase', fillColor: [0, 0, 0], fillBrightness: 0 };

/** darktable's defaults for a new spot circle (darktableconfig.xml.in: spots/circle_size and circle_border). */
export const CIRCLE_DEFAULTS = { radius: 0.02, border: 0.02 };
/** spots/ellipse_radius_a, _radius_b, _border, _rotation and _flags. */
export const ELLIPSE_DEFAULTS = { radius: [0.02, 0.01414] as [number, number], border: 0.02, rotation: 90, proportional: false };
/** spots/brush_border, brush_hardness and brush_density. */
export const SPOT_BRUSH_DEFAULTS = { border: 0.05, hardness: 0.66, density: 1 };

/** darktable's RETOUCH_MAX_SCALES. */
export const MAX_SCALES = 15;

/** darktable's num_scales and merge_from_scale: 0 scales works on the photo itself. */
export interface RetouchScales {
  scales: number;
  mergeFrom: number;
}

export function normalizeRetouchScales(input: unknown): RetouchScales {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const scales = Math.round(num(o.scales, 0, 0, MAX_SCALES));
  return { scales, mergeFrom: Math.round(num(o.mergeFrom, 0, 0, MAX_SCALES)) };
}

/** Enough for a whole session of dust spotting (darktable's RETOUCH_NO_FORMS is 300). */
export const MAX_SPOTS = 250;

/** The point a spot's source offset is measured from: a circle's or ellipse's centre, a brush's first node (darktable's pt->corner). */
export const spotAnchor = (s: RetouchShape): [number, number] =>
  s.kind === 'brush' ? (s.nodes.length ? [s.nodes[0].x, s.nodes[0].y] : [0, 0]) : s.center;

/** The shape moved so its anchor is at `to`. */
export function moveShape(s: RetouchShape, to: [number, number]): RetouchShape {
  if (s.kind !== 'brush') return { ...s, center: to };
  const [x0, y0] = spotAnchor(s);
  return { ...s, nodes: s.nodes.map((n) => ({ ...n, x: n.x + to[0] - x0, y: n.y + to[1] - y0 })) };
}

/** Whether the algorithm reads a source (clone and heal); blur, fill and remove work in place. */
export const usesSource = (tool: RetouchTool) => tool === 'clone' || tool === 'heal';

/**
 * darktable's default source offset for a new spot (each form's initial_source_pos): a circle's
 * is right and up by its radius (radius × image width and height), an ellipse's right by radius a
 * and up by radius b, a brush's right and down by 1% of the image.
 */
export function initialOffset(shape: RetouchShape): [number, number] {
  if (shape.kind === 'circle') {
    const r = Math.min(0.5, shape.radius);
    return [r, -r];
  }
  if (shape.kind === 'ellipse') return [shape.radius[0], -shape.radius[1]];
  return [0.01, 0.01];
}

/** darktable's first source for a new spot when none has been chosen (dt_masks_set_source_pos_initial_value). */
export function initialSource(shape: RetouchShape): [number, number] {
  const [x, y] = spotAnchor(shape);
  const [dx, dy] = initialOffset(shape);
  return [x + dx, y + dy];
}

export function newSpot(shape: RetouchShape, settings: Partial<SpotSettings> = {}, source?: [number, number]): RetouchSpot {
  const spot: RetouchSpot = { id: newId(), ...SPOT_DEFAULTS, ...settings, fillColor: [...(settings.fillColor ?? SPOT_DEFAULTS.fillColor)] as [number, number, number], shape, source: source ?? initialSource(shape), opacity: 1 };
  return spot.tool === 'remove' ? { ...spot, scale: 0, model: REMOVE_MODEL } : spot;
}

export function newCircleSpot(center: [number, number], tool: RetouchTool = 'heal', radius = CIRCLE_DEFAULTS.radius, border = CIRCLE_DEFAULTS.border, source?: [number, number]): RetouchSpot {
  return newSpot({ kind: 'circle', center, radius, border }, { tool }, source);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback);
const pair = (v: unknown, lo: number, hi: number): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [clamp(v[0], lo, hi), clamp(v[1], lo, hi)] : null;

function normalizeShape(input: unknown): RetouchShape | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  if (o.kind === 'circle') {
    const center = pair(o.center, -2, 3);
    return center ? { kind: 'circle', center, radius: num(o.radius, CIRCLE_DEFAULTS.radius, 0.0005, 0.5), border: num(o.border, CIRCLE_DEFAULTS.border, 0.0005, 0.5) } : null;
  }
  if (o.kind === 'ellipse') {
    const center = pair(o.center, -2, 3);
    const radius = pair(o.radius, 0.0005, 0.5);
    if (!center || !radius) return null;
    const proportional = o.proportional === true;
    return { kind: 'ellipse', center, radius, rotation: num(o.rotation, ELLIPSE_DEFAULTS.rotation, -360, 360), border: num(o.border, ELLIPSE_DEFAULTS.border, 0.0005, proportional ? 1000 : 0.5), proportional };
  }
  if (o.kind === 'brush' && Array.isArray(o.nodes)) {
    const nodes = o.nodes.slice(0, 5000).flatMap((n): BrushNode[] => {
      if (!n || typeof n !== 'object') return [];
      const q = n as Record<string, unknown>;
      if (typeof q.x !== 'number' || typeof q.y !== 'number' || !Number.isFinite(q.x) || !Number.isFinite(q.y)) return [];
      return [{ x: clamp(q.x, -2, 3), y: clamp(q.y, -2, 3), border: num(q.border, BRUSH_DEFAULTS.border, 0.00005, 1), hardness: num(q.hardness, BRUSH_DEFAULTS.hardness, 0, 1), density: num(q.density, BRUSH_DEFAULTS.density, 0, 1) }];
    });
    return nodes.length ? { kind: 'brush', nodes } : null;
  }
  return null;
}

const TOOLS: RetouchTool[] = ['clone', 'heal', 'blur', 'fill', 'remove'];

/** Spots read from a sidecar: invalid ones dropped, values clamped, at most MAX_SPOTS. Older spots take darktable's defaults for the newer settings. */
export function normalizeRetouch(input: unknown): RetouchSpot[] {
  if (!Array.isArray(input)) return [];
  const out: RetouchSpot[] = [];
  for (const item of input) {
    if (out.length >= MAX_SPOTS || !item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const shape = normalizeShape(o.shape);
    const source = pair(o.source, -2, 3);
    if (!shape || !source) continue;
    const color = Array.isArray(o.fillColor) && o.fillColor.length === 3 && o.fillColor.every((c) => typeof c === 'number' && Number.isFinite(c))
      ? (o.fillColor.map((c: number) => clamp(c, -10, 1000)) as [number, number, number]) : [...SPOT_DEFAULTS.fillColor] as [number, number, number];
    const tool = TOOLS.includes(o.tool as RetouchTool) ? (o.tool as RetouchTool) : 'heal';
    out.push({
      id: typeof o.id === 'string' && o.id.length > 0 && o.id.length < 80 ? o.id : newId(),
      tool,
      shape, source, opacity: num(o.opacity, 1, 0, 1),
      scale: tool === 'remove' ? 0 : Math.round(num(o.scale, 0, 0, MAX_SCALES + 1)),
      blurType: o.blurType === 'bilateral' ? 'bilateral' : 'gaussian',
      blurRadius: num(o.blurRadius, SPOT_DEFAULTS.blurRadius, 0.1, 200),
      fillMode: o.fillMode === 'color' ? 'color' : 'erase',
      fillColor: color,
      fillBrightness: num(o.fillBrightness, 0, -1, 1),
      ...(tool === 'remove' ? { model: typeof o.model === 'string' && o.model.length > 0 && o.model.length < 80 ? o.model : REMOVE_MODEL } : {}),
    });
  }
  return out;
}
