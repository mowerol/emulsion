// SPDX-License-Identifier: GPL-3.0-or-later
// Which mask is being edited and the tool waiting to draw a shape. Interface state only: the
// masks themselves live in the photo's recipe, and every change to them is an undoable edit.

import { create } from 'zustand';
import { activePhoto, editActive, showToast, useApp } from '../library/store';
import { defaultRecipe, type Recipe } from '../film/recipe';
import { BRUSH_DEFAULTS, MAX_BRUSHES, MAX_MASKS, MAX_SHAPES, brushCount, newBrush, newId, newMask, shapeCount, type BrushNode, type BrushShape, type Mask, type MaskMode, type MaskShape, type RangeChannel } from '../film/masks';

export interface MaskTool {
  kind: 'gradient' | 'ellipse' | 'brush' | 'object';
  /** A new mask, or a shape joining the selected one. */
  mode: 'new' | MaskMode;
}

interface MaskUi {
  /** The mask being edited (its id), if any. */
  selected: string | null;
  /** The shape whose handles are active. */
  shape: string | null;
  /** Waiting for a drag on the photo to draw this. */
  tool: MaskTool | null;
  /** Show the selected mask over the photo. */
  overlay: boolean;
  /** The brush: darktable's border (units of the shorter side), hardness and density. */
  brush: { border: number; hardness: number; density: number };
  /** The range picker is waiting for a click or a box on the photo, to set this channel of the selected mask. */
  pick: RangeChannel | null;
}

export const useMaskUi = create<MaskUi>(() => ({ selected: null, shape: null, tool: null, overlay: true, brush: { ...BRUSH_DEFAULTS }, pick: null }));

export const setMaskUi = (patch: Partial<MaskUi>) => useMaskUi.setState(patch);

/** The active photo's masks. */
export const useMasks = () => useApp((s) => activePhoto(s)?.recipe?.masks ?? NONE);
const NONE: Mask[] = [];

/** The selected mask on the active photo, if it is still there. */
export function useSelectedMask(): Mask | null {
  const masks = useMasks();
  const id = useMaskUi((s) => s.selected);
  return masks.find((m) => m.id === id) ?? null;
}

type Grouping = { key: string; continuous: boolean };

/** Change the active photo's masks as one undoable edit. */
export function editMasks(change: (masks: Mask[]) => Mask[], label: string, grouping?: Grouping) {
  editActive((r: Recipe | null) => {
    const base = r ?? defaultRecipe();
    const masks = change(base.masks);
    return masks === base.masks ? r : { ...base, masks };
  }, label, grouping);
}

export const updateMask = (id: string, change: (m: Mask) => Mask, label: string, grouping?: Grouping) =>
  editMasks((masks) => masks.map((m) => (m.id === id ? change(m) : m)), label, grouping);

export const updateShape = (maskId: string, shapeId: string, change: (s: MaskShape) => MaskShape, label: string, grouping?: Grouping) =>
  updateMask(maskId, (m) => ({ ...m, shapes: m.shapes.map((s) => (s.id === shapeId ? change(s) : s)) }), label, grouping);

const current = () => activePhoto()?.recipe?.masks ?? NONE;

/** A shape drawn with the tool: a new mask, or a shape joining the selected one. */
export function placeShape(shape: MaskShape, tool: MaskTool) {
  const masks = current();
  if (shapeCount(masks) >= MAX_SHAPES) return showToast(`A photo can hold ${MAX_SHAPES} shapes over all its masks.`);
  const selected = masks.find((m) => m.id === useMaskUi.getState().selected);
  const name = tool.kind === 'gradient' ? 'linear gradient' : 'radial gradient';
  if (tool.mode === 'new' || !selected) {
    if (masks.length >= MAX_MASKS) return showToast(`A photo can hold ${MAX_MASKS} masks.`);
    const mask = newMask(shape, masks.length);
    editMasks((list) => [...list, mask], `New ${name} mask`);
    setMaskUi({ selected: mask.id, shape: shape.id, tool: null });
    return;
  }
  const mode = tool.mode;
  updateMask(selected.id, (m) => ({ ...m, shapes: [...m.shapes, { ...shape, mode }] }), `${mode === 'subtract' ? 'Subtract' : 'Add'} ${name}`);
  setMaskUi({ shape: shape.id, tool: null });
}

export function deleteMask(id: string) {
  editMasks((masks) => masks.filter((m) => m.id !== id), 'Delete mask');
  if (useMaskUi.getState().selected === id) setMaskUi({ selected: null, shape: null });
}

export function deleteShape(maskId: string, shapeId: string) {
  const mask = current().find((m) => m.id === maskId);
  if (mask && mask.shapes.length <= 1) return deleteMask(maskId);
  updateMask(maskId, (m) => ({ ...m, shapes: m.shapes.filter((s) => s.id !== shapeId) }), 'Delete shape');
  if (useMaskUi.getState().shape === shapeId) setMaskUi({ shape: null });
}

/** A copy of a mask, after it in the list. */
export function duplicateMask(id: string) {
  const masks = current();
  const m = masks.find((x) => x.id === id);
  if (!m) return;
  if (masks.length >= MAX_MASKS) return showToast(`A photo can hold ${MAX_MASKS} masks.`);
  if (shapeCount(masks) + m.shapes.length > MAX_SHAPES) return showToast(`A photo can hold ${MAX_SHAPES} shapes over all its masks.`);
  const copy: Mask = { ...m, id: newId(), name: `${m.name} copy`, shapes: m.shapes.map((s) => ({ ...s, id: newId() })) };
  editMasks((list) => { const i = list.findIndex((x) => x.id === id); return [...list.slice(0, i + 1), copy, ...list.slice(i + 1)]; }, 'Duplicate mask');
  setMaskUi({ selected: copy.id, shape: null });
}

/**
 * Start a brush stroke at `node`: on a new mask, or on the selected mask's brush shape of the
 * mode (one to add, one to subtract, made when first needed). Returns where the stroke went.
 */
export function startStroke(node: BrushNode, mode: MaskTool['mode']): { mask: string; shape: string; stroke: number } | null {
  const masks = current();
  const selected = masks.find((m) => m.id === useMaskUi.getState().selected);
  const key = `stroke-${newId()}`;
  if (mode === 'new' || !selected) {
    if (masks.length >= MAX_MASKS) { showToast(`A photo can hold ${MAX_MASKS} masks.`); return null; }
    if (brushCount(masks) >= MAX_BRUSHES || shapeCount(masks) >= MAX_SHAPES) { showToast(`A photo can hold ${MAX_BRUSHES} brushes over all its masks.`); return null; }
    const shape: BrushShape = { ...newBrush(), strokes: [[node]] };
    const mask = newMask(shape, masks.length);
    editMasks((list) => [...list, mask], 'New brush mask', { key, continuous: true });
    setMaskUi({ selected: mask.id, shape: shape.id, tool: { kind: 'brush', mode: 'add' } });
    strokeKey = key;
    return { mask: mask.id, shape: shape.id, stroke: 0 };
  }
  const want = mode === 'subtract' ? 'subtract' : 'add';
  const existing = selected.shapes.find((s): s is BrushShape => s.kind === 'brush' && (selected.shapes[0] === s ? 'add' : s.mode) === want);
  if (!existing && (brushCount(masks) >= MAX_BRUSHES || shapeCount(masks) >= MAX_SHAPES)) { showToast(`A photo can hold ${MAX_BRUSHES} brushes over all its masks.`); return null; }
  const shape: BrushShape = existing ? { ...existing, strokes: [...existing.strokes, [node]] } : { ...newBrush(want), strokes: [[node]] };
  updateMask(selected.id, (m) => ({ ...m, shapes: existing ? m.shapes.map((s) => (s.id === shape.id ? shape : s)) : [...m.shapes, shape] }), want === 'subtract' ? 'Erase' : 'Brush', { key, continuous: true });
  strokeKey = key;
  return { mask: selected.id, shape: shape.id, stroke: shape.strokes.length - 1 };
}

let strokeKey = '';

/** Change the stroke being drawn (all of it is one undo step). */
export function updateStroke(at: { mask: string; shape: string; stroke: number }, nodes: BrushNode[]) {
  updateShape(at.mask, at.shape, (s) => (s.kind === 'brush' ? { ...s, strokes: s.strokes.map((st, i) => (i === at.stroke ? nodes : st)) } : s), 'Brush', { key: strokeKey, continuous: true });
}
