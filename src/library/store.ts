// SPDX-License-Identifier: GPL-3.0-or-later
// App state: the open folder (the roll), its photos and their recipes,
// selection, and which view is showing.

import { create } from 'zustand';
import type { Histogram } from '../engine/histogram';
import type { Xy } from '../engine/whitebalance';
import { scanFolder, whitePoints } from '../backend/api';
import { defaultRecipe, normalizeRecipe, withSettingsFrom, type Recipe } from '../film/recipe';
import { FULL, isFull, type Crop } from '../film/crop';
import { NO_FILTER, normalizeFilter, rangeWithin, shownIndices, stepWithin, type Filter } from './filter';
import { seedFor } from '../engine/engine';
import { savePhoto } from './sidecars';
import { applyMark, describeMark, hasMark, normalizeMarks, type Label, type MarkKey, type Marks } from './marks';
import { History, describe, type Change, type Step } from './history';

export interface Photo {
  path: string;
  rel: string;
  name: string;
  size: number;
  modified: number;
  recipe: Recipe | null;
  seed: number;
  /** As-shot white point of a RAW; null for D65 (other files, or not read yet). */
  white: Xy | null;
  /** Stars, 0 to 5; 0 is unrated. */
  rating: number;
  label: Label | null;
  /** A favourite. */
  heart: boolean;
}

export interface Folder {
  root: string;
  name: string;
  unreadable: number;
}

export type View = 'welcome' | 'library' | 'develop';

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

interface State {
  folder: Folder | null;
  photos: Photo[];
  view: View;
  active: number;
  selected: Set<string>;
  anchor: number;
  compare: boolean;
  clipboard: Recipe | null;
  loading: boolean;
  toast: Toast | null;
  exportOpen: boolean;
  /** Histogram of the developed frame in the develop view. */
  histogram: { path: string; data: Histogram } | null;
  /** The white balance eyedropper is waiting for a click on the photo. */
  picking: boolean;
  /** Clipped pixels are marked on the photo. */
  clipping: boolean;
  /** Names of the steps undo and redo would apply, if any. */
  history: { undo: string | null; redo: string | null };
  /** The crop being edited, for the photo at `path` of size W × H; it is saved when cropping ends. */
  cropEdit: { path: string; draft: Crop; W: number; H: number } | null;
  /** Size of the photo open in the develop view. */
  developSize: { path: string; W: number; H: number } | null;
  /** Which photos the Library grid and the filmstrip show. */
  filter: Filter;
  /** The workspace colour behind the photo in Develop. */
  stageColor: StageColorId;
  /** Develop shows Sharpening's contrast mask (while ⌥ is held on the Masking slider). */
  sharpenMask: boolean;
}

/**
 * Workspace colours, as Lightroom offers them. Mid grey is 18% reflectance (sRGB 118),
 * the photographers' neutral for judging tones; dark is the app's own stage colour.
 */
export const STAGE_COLORS = [
  { id: 'black', label: 'Black', hex: '#000000', light: false },
  { id: 'dark', label: 'Dark grey', hex: '#2a2926', light: false },
  { id: 'grey', label: 'Mid grey (18%)', hex: '#767676', light: true },
  { id: 'white', label: 'White', hex: '#ffffff', light: true },
] as const;
export type StageColorId = (typeof STAGE_COLORS)[number]['id'];

const STAGE_COLOR_KEY = 'emulsion.stageColor';
/** The workspace colour last chosen on this computer. */
function savedStageColor(): StageColorId {
  try {
    const v = localStorage.getItem(STAGE_COLOR_KEY);
    return STAGE_COLORS.find((c) => c.id === v)?.id ?? 'dark';
  } catch {
    return 'dark';
  }
}

const FILTER_KEY = 'emulsion.filter';
/** The filter last chosen on this computer (before ratings, the strip's Edited / Unedited). */
function savedFilter(): Filter {
  try {
    const v = localStorage.getItem(FILTER_KEY);
    if (v) return normalizeFilter(JSON.parse(v));
    return normalizeFilter({ edit: localStorage.getItem('emulsion.stripFilter') });
  } catch {
    return NO_FILTER;
  }
}

export const useApp = create<State>(() => ({
  folder: null,
  photos: [],
  view: 'welcome',
  active: -1,
  selected: new Set(),
  anchor: -1,
  compare: false,
  clipboard: null,
  loading: false,
  toast: null,
  exportOpen: false,
  histogram: null,
  picking: false,
  clipping: false,
  history: { undo: null, redo: null },
  cropEdit: null,
  developSize: null,
  filter: savedFilter(),
  stageColor: savedStageColor(),
  sharpenMask: false,
}));

const set = useApp.setState;
const get = useApp.getState;

let toastId = 0;
export function showToast(message: string, action?: Toast['action'], ms = 3200) {
  const id = ++toastId;
  set({ toast: { id, message, action } });
  setTimeout(() => {
    if (get().toast?.id === id) set({ toast: null });
  }, action ? ms * 2 : ms);
}

/* Recent folders, kept in local storage */
const RECENT_KEY = 'emulsion.recent';
export interface Recent { root: string; name: string }
export function recentFolders(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((r) => r && typeof r.root === 'string') : [];
  } catch {
    return [];
  }
}
function rememberFolder(r: Recent) {
  try {
    const list = [r, ...recentFolders().filter((x) => x.root !== r.root)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

export async function openFolder(path: string, view: View = 'library') {
  set({ loading: true });
  // Steps refer to photos by path, so they belong to the folder they were made in.
  history.clear();
  set(historyState());
  try {
    const res = await scanFolder(path, true);
    const photos: Photo[] = res.entries.map((e) => ({
      path: e.path,
      rel: e.rel,
      name: e.name,
      size: e.size,
      modified: e.modified,
      recipe: normalizeRecipe(e.recipe),
      seed: seedFor(e.path),
      white: null,
      ...normalizeMarks(e.rating, e.label, e.heart),
    }));
    const focus = res.focus ? photos.findIndex((p) => p.path === res.focus) : -1;
    const active = photos.length ? Math.max(0, focus) : -1;
    set({
      folder: { root: res.root, name: res.name, unreadable: res.unreadable },
      photos,
      active,
      anchor: active,
      selected: active >= 0 ? new Set([photos[active].path]) : new Set(),
      view: photos.length ? (focus >= 0 ? 'develop' : view) : 'library',
      compare: false,
    });
    rememberFolder({ root: res.root, name: res.name });
    loadWhitePoints(res.root, photos.map((p) => p.path));
    const notes: string[] = [];
    if (res.unreadable) notes.push(`${res.unreadable} ${res.unreadable === 1 ? 'item' : 'items'} could not be read`);
    if (!photos.length) showToast(`No photos Emulsion can open in ${res.name}.${notes.length ? ' ' + notes.join('. ') + '.' : ''}`);
    else if (notes.length) showToast(notes.join('. ') + '.');
  } catch (err) {
    showToast(`Could not open that folder. ${String(err)}`);
  } finally {
    set({ loading: false });
  }
}

export function closeFolder() {
  finishCrop(true);
  set({ folder: null, photos: [], active: -1, selected: new Set(), view: 'welcome' });
}

export const setView = (view: View) => {
  if (view !== 'welcome' && !get().photos.length) return;
  if (view !== 'develop') finishCrop(true);
  set({ view });
};

export function setActive(index: number, mode: 'single' | 'toggle' | 'range' | 'keep' = 'single') {
  if (index !== get().active) finishCrop(true);
  const { photos, anchor, selected } = get();
  if (index < 0 || index >= photos.length) return;
  const path = photos[index].path;
  if (mode === 'keep') {
    set({ active: index, anchor: index, selected: selected.has(path) ? selected : new Set([path]) });
  } else if (mode === 'toggle') {
    const next = new Set(selected);
    if (next.has(path) && next.size > 1) next.delete(path);
    else next.add(path);
    set({ active: index, anchor: index, selected: next });
  } else if (mode === 'range' && anchor >= 0) {
    // Only the photos the filter shows; hidden ones in between stay unselected.
    set({ active: index, selected: new Set(rangeWithin(shown(), anchor, index).map((i) => photos[i].path)) });
  } else {
    set({ active: index, anchor: index, selected: new Set([path]) });
  }
}

/** Indices of the photos the grid and the strip show. */
export const shown = (s: State = get()) => shownIndices(s.photos, s.filter, s.active);

/** Move through the shown photos; a grid row down is `delta` = columns. */
export function step(delta: number) {
  if (!get().photos.length) return;
  setActive(stepWithin(shown(), get().active, delta));
}

/** The first or last shown photo. */
export function stepToEnd(end: 'first' | 'last') {
  const list = shown();
  if (list.length) setActive(end === 'first' ? list[0] : list[list.length - 1]);
}

export function setFilter(change: Partial<Filter>) {
  const filter = { ...get().filter, ...change };
  set({ filter });
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
  } catch {
    /* remembering it is a convenience */
  }
}

export function setStageColor(stageColor: StageColorId) {
  set({ stageColor });
  try {
    localStorage.setItem(STAGE_COLOR_KEY, stageColor);
  } catch {
    /* remembering it is a convenience */
  }
}

/** Select every photo the filter shows. */
export function selectAll() {
  const { photos } = get();
  set({ selected: new Set(shown().map((i) => photos[i].path)) });
}

export const activePhoto = (s: State = get()) => s.photos[s.active] ?? null;

/** Photos an edit should apply to: the selection when several are selected, otherwise the active photo. */
export function targets(s: State = get()): Photo[] {
  if (s.selected.size > 1) return s.photos.filter((p) => s.selected.has(p.path));
  const a = activePhoto(s);
  return a ? [a] : [];
}

/** Change recipes and save their sidecars. */
const history = new History();

const historyState = () => ({ history: { undo: history.undoLabel, redo: history.redoLabel } });

/**
 * Change the recipes of `paths`. Every change is an undoable step, named by
 * `label`, or after what changed.
 */
export function editRecipes(paths: string[], change: (r: Recipe | null, p: Photo) => Recipe | null, label?: string) {
  const wanted = new Set(paths);
  const changes: Change[] = [];
  const photos = get().photos.map((p) => {
    if (!wanted.has(p.path)) return p;
    const recipe = change(p.recipe, p);
    if (recipe === p.recipe) return p;
    savePhoto({ ...p, recipe });
    changes.push({ path: p.path, before: p.recipe, after: recipe });
    return { ...p, recipe };
  });
  if (changes.length) {
    const first = changes[0] as { before: Recipe | null; after: Recipe | null };
    const name = label ?? describe(first.before, first.after);
    history.record(changes.length > 1 && !label ? `${name} on ${changes.length} photos` : name, changes, performance.now());
  }
  set({ photos, ...historyState() });
}

export const editActive = (change: (r: Recipe | null, p: Photo) => Recipe | null, label?: string) => {
  const a = activePhoto();
  if (a) editRecipes([a.path], change, label);
};

/**
 * Star, tag or heart the selected frames (or the active one), as one undoable step.
 * A tag or heart every target already has comes off; otherwise they all get it.
 */
export function markPhotos(mark: MarkKey) {
  const t = targets();
  if (!t.length) return;
  const allHave = t.every((p) => hasMark(p, mark));
  const wanted = new Set(t.map((p) => p.path));
  const changes: Change[] = [];
  const photos = get().photos.map((p) => {
    if (!wanted.has(p.path)) return p;
    const before: Marks = { rating: p.rating, label: p.label, heart: p.heart };
    const after = applyMark(before, mark, allHave);
    if (after.rating === before.rating && after.label === before.label && after.heart === before.heart) return p;
    const next = { ...p, ...after };
    savePhoto(next);
    changes.push({ path: p.path, marks: true, before, after });
    return next;
  });
  if (!changes.length) return;
  const name = !('rating' in mark) && allHave ? ('heart' in mark ? 'Remove heart' : 'Remove tag') : describeMark(mark);
  history.record(changes.length > 1 ? `${name} on ${changes.length} photos` : name, changes, performance.now());
  set({ photos, ...historyState() });
}

/** Put recipes and marks back as a history step recorded them, without recording a new step. */
function applyStep(step: Step, side: 'before' | 'after', verb: string) {
  const byPath = new Map(step.changes.map((c) => [c.path, c]));
  const photos = get().photos.map((p) => {
    const c = byPath.get(p.path);
    if (!c) return p;
    const next = c.marks ? { ...p, ...c[side] } : { ...p, recipe: c[side] };
    savePhoto(next);
    return next;
  });
  set({ photos, ...historyState() });
  const only = step.changes.length === 1 ? photos.find((p) => p.path === step.changes[0].path) : null;
  const where = only && only.path !== activePhoto()?.path ? ` on ${only.name}` : '';
  showToast(`${verb} ${step.label}${where}`);
}

export function undo() {
  finishCrop(true);
  const s = history.undo();
  if (s) applyStep(s, 'before', 'Undid');
  else showToast('Nothing to undo');
}

export function redo() {
  finishCrop(true);
  const s = history.redo();
  if (s) applyStep(s, 'after', 'Redid');
  else showToast('Nothing to redo');
}

export function copySettings() {
  const a = activePhoto();
  if (!a?.recipe) {
    showToast('This frame has no look to copy yet');
    return;
  }
  set({ clipboard: { ...a.recipe } });
  showToast(`Copied ${a.name}'s settings`);
}

export function pasteSettings() {
  const clip = get().clipboard;
  if (!clip) {
    showToast('Copy a frame\'s settings first');
    return;
  }
  const t = targets();
  editRecipes(t.map((p) => p.path), (r) => withSettingsFrom(clip, r), t.length === 1 ? 'Paste settings' : `Paste settings to ${t.length} photos`);
  showToast(t.length === 1 ? `Pasted onto ${t[0].name}` : `Pasted onto ${t.length} frames`);
}

export const setCompare = (compare: boolean) => {
  if (get().compare !== compare) set({ compare });
};
export const setExportOpen = (exportOpen: boolean) => set({ exportOpen });

/** Record a photo's as-shot white point (from a decode or the background read). */
export function setPhotoWhite(path: string, white: Xy | null) {
  const photos = get().photos;
  const i = photos.findIndex((p) => p.path === path);
  if (i < 0 || sameWhite(photos[i].white, white)) return;
  const next = photos.slice();
  next[i] = { ...photos[i], white };
  set({ photos: next });
}

const sameWhite = (a: Xy | null, b: Xy | null) => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1]);

/** Read RAW white points in the background, in batches, so thumbnails match the develop view. */
async function loadWhitePoints(root: string, paths: string[]) {
  const BATCH = 64;
  for (let i = 0; i < paths.length; i += BATCH) {
    const chunk = paths.slice(i, i + BATCH);
    let whites: (Xy | null)[];
    try {
      whites = await whitePoints(chunk);
    } catch {
      return;
    }
    if (get().folder?.root !== root) return;
    const byPath = new Map(chunk.map((p, k) => [p, whites[k]]));
    if (![...byPath.values()].some(Boolean)) continue;
    set({ photos: get().photos.map((p) => (byPath.get(p.path) && !sameWhite(p.white, byPath.get(p.path)!) ? { ...p, white: byPath.get(p.path)! } : p)) });
  }
}

// ---------- Cropping ----------

/** Start cropping the active photo from its current crop. */
export function startCrop() {
  const a = activePhoto();
  const size = get().developSize;
  if (!a || get().cropEdit || get().view !== 'develop' || size?.path !== a.path) return;
  set({ cropEdit: { path: a.path, draft: a.recipe?.crop ?? FULL, W: size.W, H: size.H }, picking: false });
}

export function setCropDraft(change: (c: Crop) => Crop) {
  const e = get().cropEdit;
  if (e) set({ cropEdit: { ...e, draft: change(e.draft) } });
}

/** Stop cropping, saving the crop as one undoable step, or throwing it away. */
export function finishCrop(keep: boolean) {
  const e = get().cropEdit;
  if (!e) return;
  set({ cropEdit: null });
  if (!keep) return;
  const crop = isFull(e.draft) ? null : e.draft;
  editRecipes(
    [e.path],
    (r) => (JSON.stringify(r?.crop ?? null) === JSON.stringify(crop) ? r : { ...(r ?? defaultRecipe()), crop }),
    'Crop',
  );
}
