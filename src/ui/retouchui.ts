// SPDX-License-Identifier: GPL-3.0-or-later
// The Heal tool's interface state: whether it is held, the tool and size for new spots, and the
// selected spot. The spots themselves live in the photo's recipe (film/retouch.ts), and every
// change to them is an undoable edit.
//
// As in darktable, a spot being dragged, scrolled or slid is only redrawn as an outline: the
// change goes into `draft` and reaches the recipe (and so the heal) when the pointer is released
// (dt_dev_add_masks_history_item in button_released), or once scrolling or a slider pauses.

import { create } from 'zustand';
import { editActive, showToast } from '../library/store';
import { defaultRecipe, type Recipe } from '../film/recipe';
import { CIRCLE_DEFAULTS, MAX_SPOTS, newCircleSpot, type RetouchSpot, type RetouchTool } from '../film/retouch';

interface RetouchUi {
  /** The Heal tool is held: spots show on the photo and a click adds one. */
  on: boolean;
  /** darktable's algorithm for the next spot. */
  tool: RetouchTool;
  /** Size and feather of the next circle, as darktable remembers the last used (spots/circle_size, circle_border). */
  radius: number;
  border: number;
  /** The spot whose source and handles are shown. */
  selected: string | null;
  /** A spot being changed, drawn in place of its saved self until the change is committed. */
  draft: { spot: RetouchSpot; label: string } | null;
}

export const useRetouchUi = create<RetouchUi>(() => ({ on: false, tool: 'heal', radius: CIRCLE_DEFAULTS.radius, border: CIRCLE_DEFAULTS.border, selected: null, draft: null }));

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

/** A new spot at `center` with the tool's settings, selected. */
export function addSpot(center: [number, number], spots: RetouchSpot[]) {
  if (spots.length >= MAX_SPOTS) { showToast(`A photo holds at most ${MAX_SPOTS} spots.`); return; }
  const { tool, radius, border } = useRetouchUi.getState();
  const spot = newCircleSpot(center, tool, radius, border);
  editRetouch((list) => [...list, spot], tool === 'heal' ? 'Heal spot' : 'Clone spot');
  setRetouchUi({ selected: spot.id });
}

export function removeSpot(id: string) {
  if (useRetouchUi.getState().draft?.spot.id === id) { clearTimeout(commitTimer); setRetouchUi({ draft: null }); }
  editRetouch((spots) => spots.filter((s) => s.id !== id), 'Remove spot');
  if (useRetouchUi.getState().selected === id) setRetouchUi({ selected: null });
}

/**
 * darktable's scroll over a spot (dt_masks_change_size): the size, or with Shift the feather,
 * up or down by 3% a step, between 0.0005 and 0.5. The selected spot if there is one (drawn at
 * once, healed when scrolling pauses), and the next spot's setting either way, as darktable
 * keeps the last size in its config.
 */
export function scrollSpotSize(up: boolean, feather: boolean, spots: RetouchSpot[]) {
  const ui = useRetouchUi.getState();
  const spot = withDraft(spots, ui.draft).find((s) => s.id === ui.selected);
  const field = feather ? 'border' : 'radius';
  const from = spot?.shape.kind === 'circle' ? spot.shape[field] : ui[field];
  const v = Math.min(0.5, Math.max(0.0005, up ? from / 0.97 : from * 0.97));
  setRetouchUi({ [field]: v });
  if (spot?.shape.kind === 'circle') {
    draftSpot({ ...spot, shape: { ...spot.shape, [field]: v } }, feather ? 'Spot feather' : 'Spot size');
    commitSoon();
  }
}
