// SPDX-License-Identifier: GPL-3.0-or-later
// The Heal and Remove tools' interface state: whether one is held, the algorithm, shape and settings for new
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
import { activePhoto, discardTransientEdits, editActive, recordTransientEdit, showToast, useApp } from '../library/store';
import { photoId } from '../library/copies';
import { removeGroups } from '../engine/remove';
import { defaultRecipe, type Recipe } from '../film/recipe';
import {
  CIRCLE_DEFAULTS, ELLIPSE_DEFAULTS, MAX_SPOTS, SPOT_BRUSH_DEFAULTS, SPOT_DEFAULTS, REMOVE_MODEL, initialOffset, mapBrushNodes, newSpot, spotAnchor,
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

/** The two toolbar tools over the photo's spots: Heal (heal, clone and the hidden fill and blur) and Remove. */
export type RetouchMode = 'heal' | 'remove';
type Kept = { tool: SpotSettings['tool']; shape: ShapeKind; scale: number };

interface RetouchUi {
  /** Heal or Remove is held (which one, `settings.tool` says): its spots show on the photo and a click adds one. */
  on: boolean;
  /** Each tool's algorithm, shape and scale while the other is held, so switching back finds them as they were. */
  kept: Record<RetouchMode, Kept>;
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
  /** Remove after each stroke (Photoshop's Remove option of that name). Off, strokes wait in `pending`. Kept between sessions. */
  eachStroke: boolean;
  /** Remove strokes painted with eachStroke off on one photo (W × H full size), waiting for Apply (Enter) or Cancel (Esc). */
  pending: { photo: string; W: number; H: number; strokes: BrushNode[][] } | null;
}

const EACH_STROKE_KEY = 'emulsion.removeEachStroke';
const readEachStroke = () => { try { return localStorage.getItem(EACH_STROKE_KEY) !== 'off'; } catch { return true; } };

export const useRetouchUi = create<RetouchUi>(() => ({
  on: false,
  kept: { heal: { tool: 'heal', shape: 'circle', scale: 0 }, remove: { tool: 'remove', shape: 'brush', scale: 0 } },
  settings: { ...SPOT_DEFAULTS },
  shape: 'circle',
  circle: { ...CIRCLE_DEFAULTS },
  ellipse: { ...ELLIPSE_DEFAULTS, radius: [...ELLIPSE_DEFAULTS.radius] },
  brush: { ...SPOT_BRUSH_DEFAULTS },
  source: { kind: 'default' },
  showScale: false,
  selected: null,
  draft: null,
  eachStroke: readEachStroke(),
  pending: null,
}));

export const setRetouchUi = (patch: Partial<RetouchUi>) => useRetouchUi.setState(patch);

/** Which tool the settings belong to. */
export const retouchMode = (s: { settings: SpotSettings }): RetouchMode => (s.settings.tool === 'remove' ? 'remove' : 'heal');
/** Whether a spot belongs to the Heal tool or the Remove tool. */
export const spotMode = (s: RetouchSpot): RetouchMode => (s.tool === 'remove' ? 'remove' : 'heal');

/**
 * Pick up Heal or Remove, with its own last algorithm, shape and scale. Remove works on the photo
 * itself (scale 0). Each pick-up starts with the shapes' own source offset, as darktable's
 * dt_masks_init_form_gui does.
 */
export function holdRetouch(mode: RetouchMode) {
  const ui = useRetouchUi.getState();
  const kept = { ...ui.kept, [retouchMode(ui)]: { tool: ui.settings.tool, shape: ui.shape, scale: ui.settings.scale } };
  const next = kept[mode];
  setRetouchUi({
    on: true, selected: null, source: { kind: 'default' }, kept, shape: next.shape,
    settings: { ...ui.settings, tool: next.tool, scale: mode === 'remove' ? 0 : next.scale },
    showScale: mode === 'remove' ? false : ui.showScale,
  });
}

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
  if (spot.tool !== 'remove' && ui.source.kind === 'pending') {
    const [x, y] = spotAnchor(shape);
    setRetouchUi({ source: { kind: 'relative', offset: [source[0] - x, source[1] - y] } });
  }
  editRetouch((list) => [...list, spot], `${TOOL_NAMES[spot.tool]} spot`);
  setRetouchUi({ selected: spot.id });
}

export const TOOL_NAMES: Record<RetouchSpot['tool'], string> = { heal: 'Heal', clone: 'Clone', blur: 'Blur', fill: 'Fill', remove: 'Remove' };

export function removeSpot(id: string) {
  if (useRetouchUi.getState().draft?.spot.id === id) { clearTimeout(commitTimer); setRetouchUi({ draft: null }); }
  editRetouch((spots) => spots.filter((s) => s.id !== id), 'Remove spot');
  if (useRetouchUi.getState().selected === id) setRetouchUi({ selected: null });
}

/** Turn Remove after each stroke on or off; turning it on applies the strokes waiting. */
export function setEachStroke(on: boolean) {
  try { localStorage.setItem(EACH_STROKE_KEY, on ? 'on' : 'off'); } catch { /* still applies for this session */ }
  if (on) applyPending();
  setRetouchUi({ eachStroke: on });
}

/** A Remove stroke to wait with the others on this photo (strokes waiting on another photo are let go). */
export function addPendingStroke(photo: string, W: number, H: number, nodes: BrushNode[]) {
  if (useRetouchUi.getState().pending?.photo !== photo) cancelPending();
  const p = useRetouchUi.getState().pending;
  const strokes = p && p.photo === photo ? p.strokes : [];
  changePending({ photo, W, H, strokes: [...strokes, nodes] }, 'Remove stroke');
}

const PENDING_HISTORY = 'remove-strokes';

function changePending(pending: RetouchUi['pending'], label: string) {
  const before = useRetouchUi.getState().pending;
  setRetouchUi({ pending, selected: null });
  recordTransientEdit(label, { scope: PENDING_HISTORY,
    before: () => setRetouchUi({ pending: before, selected: null }),
    after: () => setRetouchUi({ pending, selected: null }),
  });
}

/** Let the waiting strokes go: all of them (Cancel, Esc), or the last one (⌫). */
export function cancelPending(last = false) {
  const p = useRetouchUi.getState().pending;
  if (last && p) changePending(p.strokes.length > 1 ? { ...p, strokes: p.strokes.slice(0, -1) } : null, 'Delete Remove stroke');
  else { discardTransientEdits(PENDING_HISTORY); setRetouchUi({ pending: null }); }
}

/**
 * Apply the waiting strokes as one undoable edit: a Remove spot for each area they cover
 * together (removeGroups, as IOPaint boxes a mask), the last one selected. Only on the photo they
 * were painted on, which must be the active one.
 */
export function applyPending() {
  const p = useRetouchUi.getState().pending;
  discardTransientEdits(PENDING_HISTORY);
  if (!p) return;
  setRetouchUi({ pending: null });
  const photo = activePhoto(useApp.getState());
  if (!photo || photoId(photo) !== p.photo) return;
  const ui = useRetouchUi.getState();
  const made = removeGroups(p.strokes, p.W, p.H).map(([nodes, ...more]) =>
    newSpot(more.length ? { kind: 'brush', nodes, more } : { kind: 'brush', nodes }, { ...ui.settings, tool: 'remove' }));
  if (!made.length) return;
  const room = MAX_SPOTS - (photo.recipe?.retouch.length ?? 0);
  if (room < made.length) showToast(`A photo holds at most ${MAX_SPOTS} spots.`);
  const spots = made.slice(0, Math.max(0, room));
  if (!spots.length) return;
  editRetouch((list) => [...list, ...spots], spots.length === 1 ? 'Remove spot' : `${spots.length} Remove spots`);
  setRetouchUi({ selected: spots[spots.length - 1].id });
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
  const next = { ...spot, [key]: value, ...(key === 'tool' && value === 'remove' ? { scale: 0, model: REMOVE_MODEL } : {}) };
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

const change = (up: boolean, v: number, lo: number, hi: number, steps = 1) => Math.min(hi, Math.max(lo, v * Math.pow(0.97, up ? -steps : steps)));

/** Scroll steps in one press of [ or ]: 0.97⁵ ≈ 1/1.16, the mask brush's step (1.15). */
export const KEY_STEPS = 5;

/**
 * darktable's scroll over a spot (each shape's mouse_scrolled, dt_masks_change_size and
 * dt_masks_change_rotation): `size` scales the circle's radius, the ellipse's radii (keeping their
 * ratio) or the brush's size by 3% a step; `feather` its feather (a brush's hardness); `rotation`
 * turns an ellipse by 9°. The selected spot if there is one (drawn at once, healed when scrolling
 * pauses), and the next spot's setting either way, as darktable keeps the last size in its config.
 * `steps` scroll steps at once (the [ and ] keys).
 */
export function scrollSpot(up: boolean, what: 'size' | 'feather' | 'rotation', spots: RetouchSpot[], steps = 1) {
  const ui = useRetouchUi.getState();
  const spot = selectedSpot(spots);
  const kind = spot?.shape.kind ?? ui.shape;
  let shape: RetouchShape | null = spot?.shape ?? null;
  if (kind === 'circle') {
    const c = shape?.kind === 'circle' ? shape : { kind: 'circle' as const, center: [0, 0] as Pt, ...ui.circle };
    if (what === 'rotation') return;
    const field = what === 'size' ? 'radius' : 'border';
    const v = change(up, c[field], 0.0005, 0.5, steps);
    setRetouchUi({ circle: { ...ui.circle, [field]: v } });
    shape = { ...c, [field]: v };
  } else if (kind === 'ellipse') {
    const e = shape?.kind === 'ellipse' ? shape : { kind: 'ellipse' as const, center: [0, 0] as Pt, ...ui.ellipse };
    let next = e;
    if (what === 'size') {
      const a = change(up, e.radius[0], 0.001, 0.5, steps);
      next = { ...e, radius: [a, e.radius[1] * (a / e.radius[0])] };
    } else if (what === 'feather') {
      const ref = e.proportional ? 1 / Math.min(e.radius[0], e.radius[1]) : 1;
      next = { ...e, border: change(up, e.border, 0.001 * ref, 0.5 * ref, steps) };
    } else {
      next = { ...e, rotation: (((e.rotation + (up ? 9 : -9) * steps) % 360) + 360) % 360 };
    }
    setRetouchUi({ ellipse: { radius: next.radius, border: next.border, rotation: next.rotation, proportional: next.proportional } });
    shape = next;
  } else {
    if (what === 'rotation') return;
    const field = what === 'size' ? 'border' : 'hardness';
    const [lo, hi] = what === 'size' ? [0.00005, 0.5] : [0.0005, 1];
    const from = shape?.kind === 'brush' ? shape.nodes[0][field] : ui.brush[field];
    const v = change(up, from, lo, hi, steps);
    setRetouchUi({ brush: { ...ui.brush, [field]: v } });
    if (shape?.kind === 'brush') shape = mapBrushNodes(shape, (n) => ({ ...n, [field]: change(up, n[field], lo, hi, steps) }));
  }
  if (spot && shape) {
    draftSpot({ ...spot, shape }, what === 'size' ? 'Spot size' : what === 'feather' ? 'Spot feather' : 'Spot rotation');
    commitSoon();
  }
}

/**
 * The Heal tool's algorithm for the next spot, as a click on darktable retouch's algorithm buttons
 * sets it: the selected spot is let go rather than changed. `toSelected` (darktable's ctrl+click)
 * changes the selected spot's algorithm instead. Remove is its own tool (holdRetouch), not one of these.
 */
export function setRetouchTool(tool: Exclude<SpotSettings['tool'], 'remove'>, spots: RetouchSpot[], toSelected = false) {
  if (!toSelected && useRetouchUi.getState().selected !== null) { commitDraft(); setRetouchUi({ selected: null }); }
  setSetting('tool', tool, spots, `${TOOL_NAMES[tool]} spot`);
}

// A draft (and its redo steps) belongs to one frame, including virtual copies.
useApp.subscribe((state, previous) => {
  const current = activePhoto(state), before = activePhoto(previous);
  if ((current ? photoId(current) : null) !== (before ? photoId(before) : null)) cancelPending();
});
