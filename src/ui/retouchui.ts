// SPDX-License-Identifier: GPL-3.0-or-later
// The Heal tool's interface state: whether it is held, the algorithm, shape and settings for new
// spots, where their source goes, and the selected spot. The spots themselves live in the photo's
// recipe (film/retouch.ts), and every change to them is an undoable edit.
//
// As in darktable, a spot being dragged, scrolled or slid is only redrawn as an outline: the
// change goes into `draft` and reaches the recipe (and so the heal) when the pointer is released
// (dt_dev_add_masks_history_item in button_released), or once scrolling or a slider pauses.
//
// darktable's module parameters (algorithm, blur and fill settings) show the selected spot's and
// change it (rt_shape_selection_changed); with nothing selected they set up the next spot.

import { create } from 'zustand';
import { editActive, showToast } from '../library/store';
import { defaultRecipe, type Recipe } from '../film/recipe';
import {
  CIRCLE_DEFAULTS, ELLIPSE_DEFAULTS, MAX_SPOTS, SPOT_BRUSH_DEFAULTS, SPOT_DEFAULTS, initialOffset, newSpot, spotAnchor,
  type RetouchScales, type RetouchShape, type RetouchSpot, type ShapeKind, type SpotSettings,
} from '../film/retouch';
import type { BrushNode } from '../film/masks';

type Pt = [number, number];

/**
 * darktable's source position for the next spot (dt_masks_form_gui_t source_pos_type, posx_source):
 * - `default`: the shape's own offset (RELATIVE_TEMP with nothing chosen);
 * - `pending`: ⇧-clicked at `at`; the next spot takes its source there, and later spots keep
 *   that offset (RELATIVE_TEMP with a position, then RELATIVE);
 * - `relative`: every spot's source at `offset` from it (RELATIVE);
 * - `absolute`: ⌘⇧-clicked; every spot's source at `at` (ABSOLUTE).
 */
export type SourcePlacement =
  | { kind: 'default' }
  | { kind: 'pending'; at: Pt }
  | { kind: 'relative'; offset: Pt }
  | { kind: 'absolute'; at: Pt };

interface RetouchUi {
  /** The Heal tool is held: spots show on the photo and a click adds one. */
  on: boolean;
  /** The next spot's algorithm and settings (darktable's module parameters). */
  settings: SpotSettings;
  /** The shape the next spot is drawn with. */
  shape: ShapeKind;
  /** Size and feather of the next circle, as darktable remembers the last used (spots/circle_size, circle_border). */
  circle: { radius: number; border: number };
  /** spots/ellipse_*. */
  ellipse: { radius: [number, number]; border: number; rotation: number; proportional: boolean };
  /** spots/brush_*. */
  brush: { border: number; hardness: number; density: number };
  source: SourcePlacement;
  /** Show the current wavelet scale in place of the photo (darktable's display wavelet scale). */
  showScale: boolean;
  /** The spot whose source and handles are shown. */
  selected: string | null;
  /** A spot being changed, drawn in place of its saved self until the change is committed. */
  draft: { spot: RetouchSpot; label: string } | null;
}

export const useRetouchUi = create<RetouchUi>(() => ({
  on: false,
  settings: { ...SPOT_DEFAULTS },
  shape: 'circle',
  circle: { ...CIRCLE_DEFAULTS },
  ellipse: { ...ELLIPSE_DEFAULTS, radius: [...ELLIPSE_DEFAULTS.radius] },
  brush: { ...SPOT_BRUSH_DEFAULTS },
  source: { kind: 'default' },
  showScale: false,
  selected: null,
  draft: null,
}));

export const setRetouchUi = (patch: Partial<RetouchUi>) => useRetouchUi.setState(patch);

type Grouping = { key: string; continuous: boolean };

/** Change the active photo's spots as one undoable edit. */
export function editRetouch(change: (spots: RetouchSpot[]) => RetouchSpot[], label: string, grouping?: Grouping) {
  editActive((r: Recipe | null) => {
    const base = r ?? defaultRecipe();
    const retouch = change(base.retouch);
    return retouch === base.retouch ? r : { ...base, retouch };
  }, label, grouping);
}

export const updateSpot = (id: string, change: (s: RetouchSpot) => RetouchSpot, label: string, grouping?: Grouping) =>
  editRetouch((spots) => spots.map((s) => (s.id === id ? change(s) : s)), label, grouping);

/** The spots as drawn: the saved ones with the draft in its place. */
export const withDraft = (spots: RetouchSpot[], draft: RetouchUi['draft']) =>
  draft ? spots.map((s) => (s.id === draft.spot.id ? draft.spot : s)) : spots;

let commitTimer = 0;

/** Show a change to a spot without healing it yet. */
export function draftSpot(spot: RetouchSpot, label: string) {
  clearTimeout(commitTimer);
  setRetouchUi({ draft: { spot, label } });
}

/** Save the drafted change as one undoable edit, which heals it. */
export function commitDraft() {
  clearTimeout(commitTimer);
  const d = useRetouchUi.getState().draft;
  if (!d) return;
  setRetouchUi({ draft: null });
  updateSpot(d.spot.id, () => d.spot, d.label);
}

/** Save the draft once changes pause: for scrolling and sliders, which have no release. */
export function commitSoon(ms = 250) {
  clearTimeout(commitTimer);
  commitTimer = window.setTimeout(commitDraft, ms);
}

/** The shape the next spot would have with its anchor at `at` (a brush: one dab there). */
export function nextShape(at: Pt): RetouchShape {
  const ui = useRetouchUi.getState();
  if (ui.shape === 'ellipse') return { kind: 'ellipse', center: at, ...ui.ellipse, radius: [...ui.ellipse.radius] };
  if (ui.shape === 'brush') return { kind: 'brush', nodes: [brushNode(at)] };
  return { kind: 'circle', center: at, ...ui.circle };
}

export const brushNode = (p: Pt): BrushNode => {
  const b = useRetouchUi.getState().brush;
  return { x: p[0], y: p[1], border: b.border, hardness: b.hardness, density: b.density };
};

/** Where the next spot's source goes for a shape (dt_masks_calculate_source_pos_value). */
export function nextSource(shape: RetouchShape): Pt {
  const s = useRetouchUi.getState().source;
  const [x, y] = spotAnchor(shape);
  if (s.kind === 'absolute' || s.kind === 'pending') return s.at;
  const [dx, dy] = s.kind === 'relative' ? s.offset : initialOffset(shape);
  return [x + dx, y + dy];
}

/** ⇧-click: the next spot's source here (relative afterwards); ⌘⇧-click: every spot's source here. */
export function placeSource(at: Pt, absolute: boolean) {
  setRetouchUi({ source: absolute ? { kind: 'absolute', at } : { kind: 'pending', at } });
}

/** A new spot with the tool's settings, selected. The source follows dt_masks_set_source_pos_initial_value. */
export function addSpot(shape: RetouchShape, spots: RetouchSpot[]) {
  if (spots.length >= MAX_SPOTS) { showToast(`A photo holds at most ${MAX_SPOTS} spots.`); return; }
  const ui = useRetouchUi.getState();
  const source = nextSource(shape);
  const spot = newSpot(shape, ui.settings, source);
  // A ⇧-clicked source is used once as it is; later spots keep the same offset.
  if (ui.source.kind === 'pending') {
    const [x, y] = spotAnchor(shape);
    setRetouchUi({ source: { kind: 'relative', offset: [source[0] - x, source[1] - y] } });
  }
  editRetouch((list) => [...list, spot], `${TOOL_NAMES[spot.tool]} spot`);
  setRetouchUi({ selected: spot.id });
}

export const TOOL_NAMES: Record<RetouchSpot['tool'], string> = { heal: 'Heal', clone: 'Clone', blur: 'Blur', fill: 'Fill' };

export function removeSpot(id: string) {
  if (useRetouchUi.getState().draft?.spot.id === id) { clearTimeout(commitTimer); setRetouchUi({ draft: null }); }
  editRetouch((spots) => spots.filter((s) => s.id !== id), 'Remove spot');
  if (useRetouchUi.getState().selected === id) setRetouchUi({ selected: null });
}

/** The selected spot as drawn (its draft if it is being changed). */
export function selectedSpot(spots: RetouchSpot[]): RetouchSpot | null {
  const ui = useRetouchUi.getState();
  return withDraft(spots, ui.draft).find((s) => s.id === ui.selected) ?? null;
}

/**
 * Change a setting (darktable's module parameters): the next spot's, and the selected spot's if
 * there is one. `slide` drafts the change and heals once it pauses, for sliders.
 */
export function setSetting<K extends keyof SpotSettings>(key: K, value: SpotSettings[K], spots: RetouchSpot[], label: string, slide = false) {
  const ui = useRetouchUi.getState();
  setRetouchUi({ settings: { ...ui.settings, [key]: value } });
  const spot = selectedSpot(spots);
  if (!spot) return;
  const next = { ...spot, [key]: value };
  if (slide) { draftSpot(next, label); commitSoon(); return; }
  commitDraft();
  updateSpot(spot.id, () => next, label);
}

/** Change the photo's wavelet setup (darktable's num_scales and merge_from_scale) as one undoable edit. */
export function setScales(patch: Partial<RetouchScales>, label: string) {
  editActive((r: Recipe | null) => {
    const base = r ?? defaultRecipe();
    const next = { ...base.retouchScales, ...patch };
    // rt_num_scales_update: merging can't start above the last scale.
    if (next.scales < next.mergeFrom) next.mergeFrom = next.scales;
    return next.scales === base.retouchScales.scales && next.mergeFrom === base.retouchScales.mergeFrom ? r : { ...base, retouchScales: next };
  }, label);
  const ui = useRetouchUi.getState();
  // The current scale stays within the photo's (the residual follows the last scale).
  if (patch.scales !== undefined && ui.settings.scale > patch.scales + 1) setCurrentScale(patch.scales + 1);
}

/** The scale new spots go on and whose spots show (darktable's curr_scale). */
export function setCurrentScale(scale: number) {
  commitDraft();
  const ui = useRetouchUi.getState();
  setRetouchUi({ settings: { ...ui.settings, scale }, selected: null, showScale: scale === 0 ? false : ui.showScale });
}

const change = (up: boolean, v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, up ? v / 0.97 : v * 0.97));

/**
 * darktable's scroll over a spot (each shape's mouse_scrolled, dt_masks_change_size and
 * dt_masks_change_rotation): `size` scales the circle's radius, the ellipse's radii (keeping their
 * ratio) or the brush's size by 3% a step; `feather` its feather (a brush's hardness); `rotation`
 * turns an ellipse by 9°. The selected spot if there is one (drawn at once, healed when scrolling
 * pauses), and the next spot's setting either way, as darktable keeps the last size in its config.
 */
export function scrollSpot(up: boolean, what: 'size' | 'feather' | 'rotation', spots: RetouchSpot[]) {
  const ui = useRetouchUi.getState();
  const spot = selectedSpot(spots);
  const kind = spot?.shape.kind ?? ui.shape;
  let shape: RetouchShape | null = spot?.shape ?? null;
  if (kind === 'circle') {
    const c = shape?.kind === 'circle' ? shape : { kind: 'circle' as const, center: [0, 0] as Pt, ...ui.circle };
    if (what === 'rotation') return;
    const field = what === 'size' ? 'radius' : 'border';
    const v = change(up, c[field], 0.0005, 0.5);
    setRetouchUi({ circle: { ...ui.circle, [field]: v } });
    shape = { ...c, [field]: v };
  } else if (kind === 'ellipse') {
    const e = shape?.kind === 'ellipse' ? shape : { kind: 'ellipse' as const, center: [0, 0] as Pt, ...ui.ellipse };
    let next = e;
    if (what === 'size') {
      const a = change(up, e.radius[0], 0.001, 0.5);
      next = { ...e, radius: [a, e.radius[1] * (a / e.radius[0])] };
    } else if (what === 'feather') {
      const ref = e.proportional ? 1 / Math.min(e.radius[0], e.radius[1]) : 1;
      next = { ...e, border: change(up, e.border, 0.001 * ref, 0.5 * ref) };
    } else {
      next = { ...e, rotation: (((e.rotation + (up ? 9 : -9)) % 360) + 360) % 360 };
    }
    setRetouchUi({ ellipse: { radius: next.radius, border: next.border, rotation: next.rotation, proportional: next.proportional } });
    shape = next;
  } else {
    if (what === 'rotation') return;
    const field = what === 'size' ? 'border' : 'hardness';
    const [lo, hi] = what === 'size' ? [0.00005, 0.5] : [0.0005, 1];
    const from = shape?.kind === 'brush' ? shape.nodes[0][field] : ui.brush[field];
    const v = change(up, from, lo, hi);
    setRetouchUi({ brush: { ...ui.brush, [field]: v } });
    if (shape?.kind === 'brush') shape = { ...shape, nodes: shape.nodes.map((n) => ({ ...n, [field]: change(up, n[field], lo, hi) })) };
  }
  if (spot && shape) {
    draftSpot({ ...spot, shape }, what === 'size' ? 'Spot size' : what === 'feather' ? 'Spot feather' : 'Spot rotation');
    commitSoon();
  }
}
