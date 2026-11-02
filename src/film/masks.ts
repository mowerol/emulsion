// SPDX-License-Identifier: GPL-3.0-or-later
// Masks: local adjustments, as Lightroom's masking presents them, built from darktable's drawn
// masks (src/develop/masks/). A mask is a group of shapes combined in order (darktable's group:
// the first shape is copied, each later one is added, intersected, subtracted, summed or
// excluded at its own opacity, and may be inverted), and carries its own adjustments, which run
// as darktable would run a masked instance of exposure and of colour balance rgb.
//
// Shapes are kept in source coordinates (0 to 1 over the uncropped, oriented photo, y down), as
// darktable keeps them in input image coordinates, so cropping or straightening never moves them.
// Their parameters are darktable's own: see engine/masks.ts for the maths.

import { NO_REFINE, type MaskRefine } from '../engine/maskrefine';

/** darktable's mask states DT_MASKS_STATE_UNION ... EXCLUSION, as Lightroom names them. */
export type MaskMode = 'add' | 'intersect' | 'subtract' | 'sum' | 'exclude';

export const MASK_MODES: { id: MaskMode; label: string; hint: string }[] = [
  { id: 'add', label: 'Add', hint: 'Union: the larger of the two' },
  { id: 'subtract', label: 'Subtract', hint: 'Difference: takes this shape away' },
  { id: 'intersect', label: 'Intersect', hint: 'Only where both are' },
  { id: 'exclude', label: 'Exclude', hint: 'Where one or the other is, not both' },
  { id: 'sum', label: 'Sum', hint: 'Added together, up to 1' },
];

interface ShapeBase {
  id: string;
  /** How the shape joins the ones before it. The first shape is always copied, as in darktable. */
  mode: MaskMode;
  /** darktable's DT_MASKS_STATE_INVERSE. */
  invert: boolean;
  /** 0 to 1, the shape's opacity in its group. */
  opacity: number;
}

/** darktable's gradient (dt_masks_point_gradient_t): full effect on the side the arrow points to. */
export interface GradientShape extends ShapeBase {
  kind: 'gradient';
  /** The line's middle, in source coordinates. */
  anchor: [number, number];
  /** Degrees; 0 puts the effect above the line. */
  rotation: number;
  /** Width of the transition, in units of the photo's diagonal (darktable: 0 to 1). */
  compression: number;
  /** Bend of the line, -2 to 2. */
  curvature: number;
  /** darktable's transition: sigmoidal (erf, its default for new gradients) or linear. */
  linear: boolean;
}

/** darktable's ellipse (dt_masks_point_ellipse_t), equidistant feathering. */
export interface EllipseShape extends ShapeBase {
  kind: 'ellipse';
  center: [number, number];
  /** Semi-axes in units of the photo's shorter side. */
  radius: [number, number];
  /** Degrees. */
  rotation: number;
  /** Feather beyond the edge, in units of the shorter side (or of the radius when proportional). */
  border: number;
  /** darktable's DT_MASKS_ELLIPSE_PROPORTIONAL. */
  proportional: boolean;
}

/**
 * A node of darktable's brush (dt_masks_point_brush_t): where it is (source coordinates), its
 * size (border, in units of the shorter side), hardness and density, each 0 to 1. The curve
 * between nodes is darktable's Catmull-Rom spline; see engine/brush.ts.
 */
export interface BrushNode {
  x: number;
  y: number;
  border: number;
  hardness: number;
  density: number;
}

/** Brush strokes, each one of darktable's brush forms, joined (union) into one shape. */
export interface BrushShape extends ShapeBase {
  kind: 'brush';
  strokes: BrushNode[][];
}

export type MaskShape = GradientShape | EllipseShape | BrushShape;

/** darktable's brush defaults (darktableconfig.xml.in): border 0.05, hardness 0.66, density 1. */
export const BRUSH_DEFAULTS = { border: 0.05, hardness: 0.66, density: 1 };

/** How many brush shapes a photo holds over all its masks (one RGBA mask texture). */
export const MAX_BRUSHES = 4;
/** Nodes in one shape's strokes, all together; enough for a long session of brushing. */
export const MAX_BRUSH_NODES = 20000;

/** A mask's own adjustments, Lightroom's ranges. */
export interface MaskAdjust {
  exposure: number;
  /** Warmer or cooler than the photo's white balance, in mireds (positive is warmer). */
  temperature: number;
  tint: number;
  contrast: number;
  /** A masked tone equalizer instance, with the photo's Highlights slider mapping. */
  highlights: number;
  shadows: number;
  /** Masked contrast equalizer and local laplacian instances, with the photo's slider mappings. */
  texture: number;
  clarity: number;
  /** A masked haze removal instance, with the photo's Dehaze mapping (and the photo's Distance). */
  dehaze: number;
  vibrance: number;
  saturation: number;
}

/** A parametric range on one channel: darktable's four blendif markers and its invert, in its slider units. */
export interface MaskRange {
  /** Lower edge of the feather, lower and upper end of full effect, upper edge of the feather. */
  points: [number, number, number, number];
  invert: boolean;
}

/** darktable's RGB (scene) blendif channels of JzCzhz: lightness and chroma 0 to 100, hue 0 to 360. */
export type RangeChannel = 'luminance' | 'chroma' | 'hue';
export type MaskRanges = Record<RangeChannel, MaskRange | null>;

export const RANGE_CHANNELS: { id: RangeChannel; label: string; max: number; unit: string; hint: string }[] = [
  { id: 'luminance', label: 'Luminance', max: 100, unit: '', hint: "darktable's Jz: how light, perceptually" },
  { id: 'chroma', label: 'Chroma', max: 100, unit: '', hint: "darktable's Cz: how colourful" },
  { id: 'hue', label: 'Hue', max: 360, unit: '°', hint: "darktable's hz" },
];

/** A channel's range when it is first turned on: everything passes, as in darktable. */
export const fullRange = (c: RangeChannel): MaskRange => {
  const max = RANGE_CHANNELS.find((r) => r.id === c)!.max;
  return { points: [0, 0, max, max], invert: false };
};

export const NO_RANGES: MaskRanges = { luminance: null, chroma: null, hue: null };

export interface Mask extends MaskAdjust {
  id: string;
  name: string;
  /** Off leaves the photo as if the mask were not there. */
  on: boolean;
  /** darktable's blend opacity, 0 to 100. */
  opacity: number;
  shapes: MaskShape[];
  /** Parametric ranges, multiplied into the shapes (darktable's blendif, exclusive). */
  ranges: MaskRanges;
  /** darktable's mask refinement: feathering, blur, and the mask's brightness and contrast. */
  refine: MaskRefine;
}

export type MaskAdjustKey = keyof MaskAdjust;

export interface MaskSliderDef {
  key: MaskAdjustKey;
  label: string;
  min: number;
  max: number;
  step: number;
}

export const MASK_SLIDERS: MaskSliderDef[] = [
  { key: 'exposure', label: 'Exposure', min: -4, max: 4, step: 0.05 },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1 },
  { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1 },
  { key: 'contrast', label: 'Contrast', min: -50, max: 50, step: 1 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1 },
  { key: 'texture', label: 'Texture', min: -100, max: 100, step: 1 },
  { key: 'clarity', label: 'Clarity', min: -100, max: 100, step: 1 },
  { key: 'dehaze', label: 'Dehaze', min: -100, max: 100, step: 1 },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, step: 1 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1 },
];

/** How many masks, and shapes over all masks, the develop shader holds. */
export const MAX_MASKS = 8;
export const MAX_SHAPES = 32;

export const NO_ADJUST: MaskAdjust = { exposure: 0, temperature: 0, tint: 0, contrast: 0, highlights: 0, shadows: 0, texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0 };

let counter = 0;
export const newId = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

/** A gradient with darktable's defaults for a new one: sigmoidal, compression 0.5, no curvature. */
export function newGradient(anchor: [number, number] = [0.5, 0.5], rotation = 0, compression = 0.5): GradientShape {
  return { id: newId(), kind: 'gradient', mode: 'add', invert: false, opacity: 1, anchor, rotation, compression, curvature: 0, linear: false };
}

/** An ellipse with darktable's default feather (0.05, equidistant). */
export function newEllipse(center: [number, number] = [0.5, 0.5], radius: [number, number] = [0.25, 0.18], rotation = 0, border = 0.05): EllipseShape {
  return { id: newId(), kind: 'ellipse', mode: 'add', invert: false, opacity: 1, center, radius, rotation, border, proportional: false };
}

export function newBrush(mode: MaskMode = 'add'): BrushShape {
  return { id: newId(), kind: 'brush', mode, invert: false, opacity: 1, strokes: [] };
}

export function newMask(shape: MaskShape, index: number): Mask {
  return { id: newId(), name: `Mask ${index + 1}`, on: true, opacity: 100, shapes: [shape], ranges: NO_RANGES, refine: NO_REFINE, ...NO_ADJUST };
}

/** Whether a mask changes anything. */
export const maskActive = (m: Mask) => m.on && m.opacity > 0 && m.shapes.length > 0 && MASK_SLIDERS.some((d) => m[d.key] !== 0);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How many brush shapes a list of masks holds. */
export const brushCount = (masks: Mask[]) => masks.reduce((n, m) => n + m.shapes.filter((s) => s.kind === 'brush').length, 0);
const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback);
const pair = (v: unknown, fallback: [number, number], lo: number, hi: number): [number, number] =>
  Array.isArray(v) && v.length === 2 ? [num(v[0], fallback[0], lo, hi), num(v[1], fallback[1], lo, hi)] : fallback;
const isMode = (v: unknown): v is MaskMode => MASK_MODES.some((m) => m.id === v);
const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.length > 0 && v.length < 80 ? v : fallback);

function normalizeShape(input: unknown): MaskShape | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const base = { id: str(o.id, newId()), mode: isMode(o.mode) ? o.mode : 'add', invert: o.invert === true, opacity: num(o.opacity, 1, 0, 1) } as const;
  if (o.kind === 'gradient') {
    const d = newGradient();
    return { ...d, ...base, anchor: pair(o.anchor, d.anchor, -2, 3), rotation: num(o.rotation, 0, -360, 360), compression: num(o.compression, d.compression, 0, 1), curvature: num(o.curvature, 0, -2, 2), linear: o.linear === true };
  }
  if (o.kind === 'brush') {
    let nodes = 0;
    const strokes = (Array.isArray(o.strokes) ? o.strokes : []).map((st) => (Array.isArray(st) ? st : []).map((n): BrushNode | null => {
      if (!n || typeof n !== 'object') return null;
      const q = n as Record<string, unknown>;
      if (typeof q.x !== 'number' || typeof q.y !== 'number' || !Number.isFinite(q.x) || !Number.isFinite(q.y)) return null;
      return { x: num(q.x, 0, -2, 3), y: num(q.y, 0, -2, 3), border: num(q.border, BRUSH_DEFAULTS.border, 0.0005, 1), hardness: num(q.hardness, BRUSH_DEFAULTS.hardness, 0, 1), density: num(q.density, BRUSH_DEFAULTS.density, 0, 1) };
    }).filter((n): n is BrushNode => !!n)).filter((st) => st.length > 0 && (nodes += st.length) <= MAX_BRUSH_NODES);
    return { ...newBrush(), ...base, strokes };
  }
  if (o.kind === 'ellipse') {
    const d = newEllipse();
    return { ...d, ...base, center: pair(o.center, d.center, -2, 3), radius: pair(o.radius, d.radius, 0.001, 2), rotation: num(o.rotation, 0, -360, 360), border: num(o.border, d.border, 0.001, 1), proportional: o.proportional === true };
  }
  return null;
}

function normalizeRange(input: unknown, max: number): MaskRange | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  if (!Array.isArray(o.points) || o.points.length !== 4) return null;
  const p = o.points.map((v) => num(v, 0, 0, max));
  // Markers stay in order, as darktable's slider keeps them.
  for (let i = 1; i < 4; i++) p[i] = Math.max(p[i], p[i - 1]);
  return { points: p as MaskRange['points'], invert: o.invert === true };
}

function normalizeRanges(input: unknown): MaskRanges {
  if (!input || typeof input !== 'object') return NO_RANGES;
  const o = input as Record<string, unknown>;
  return Object.fromEntries(RANGE_CHANNELS.map((c) => [c.id, normalizeRange(o[c.id], c.max)])) as MaskRanges;
}

/** darktable's slider ranges: feathering radius 0-250 px, blurring radius 0-100 px, mask opacity and contrast -1 to 1. */
export const REFINE_SLIDERS: { key: keyof MaskRefine; label: string; min: number; max: number; step: number; hint: string }[] = [
  { key: 'feather', label: 'Feather', min: 0, max: 250, step: 1, hint: "darktable's feathering radius: the mask follows edges in the photo (guided filter), in full-size pixels" },
  { key: 'blur', label: 'Blur', min: 0, max: 100, step: 0.5, hint: "darktable's blurring radius, in full-size pixels" },
  { key: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.01, hint: "darktable's mask opacity: lifts or lowers the mask's partial values" },
  { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.01, hint: "darktable's mask contrast: steepens or softens the mask round its middle" },
];

function normalizeRefine(input: unknown): MaskRefine {
  if (!input || typeof input !== 'object') return NO_REFINE;
  const o = input as Record<string, unknown>;
  return Object.fromEntries(REFINE_SLIDERS.map((d) => [d.key, num(o[d.key], 0, d.min, d.max)])) as unknown as MaskRefine;
}

/** Masks read from a sidecar: invalid shapes dropped, values clamped, at most MAX_MASKS and MAX_SHAPES. */
export function normalizeMasks(input: unknown): Mask[] {
  if (!Array.isArray(input)) return [];
  const out: Mask[] = [];
  let shapes = 0;
  for (const item of input) {
    if (out.length >= MAX_MASKS || !item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const list = (Array.isArray(o.shapes) ? o.shapes : []).map(normalizeShape).filter((s): s is MaskShape => !!s).slice(0, MAX_SHAPES - shapes);
    if (!list.length) continue;
    shapes += list.length;
    const m: Mask = { id: str(o.id, newId()), name: str(o.name, `Mask ${out.length + 1}`), on: o.on !== false, opacity: num(o.opacity, 100, 0, 100), shapes: list, ranges: normalizeRanges(o.ranges), refine: normalizeRefine(o.refine), ...NO_ADJUST };
    for (const d of MASK_SLIDERS) m[d.key] = num(o[d.key], 0, d.min, d.max);
    out.push(m);
  }
  return out;
}

/** How many shapes a list of masks holds. */
export const shapeCount = (masks: Mask[]) => masks.reduce((n, m) => n + m.shapes.length, 0);
