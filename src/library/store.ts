// SPDX-License-Identifier: GPL-3.0-or-later
// App state: the open folder (the roll), its photos and their recipes,
// selection, and which view is showing.

import { create } from 'zustand';
import type { Histogram } from '../engine/histogram';
import type { Xy } from '../engine/whitebalance';
import { scanFolder, whitePoints } from '../backend/api';
import { folderImport, importedPaths, saveFolderImport, type FolderImport } from './folders';
import { defaultRecipe, normalizeRecipe, withSettingsFrom, type Recipe } from '../film/recipe';
import { FULL, isFull, type Crop } from '../film/crop';
import { NO_FILTER, normalizeFilter, passes, rangeWithin, shownIndices, stepWithin, type Filter } from './filter';
import { seedFor } from '../engine/engine';
import { flushSaves, savePhoto } from './sidecars';
import { findPairs, foldPairs } from './pairs';
import { applyMark, describeMark, hasMark, normalizeMarks, type Label, type MarkKey, type Marks } from './marks';
import { History, describe, type Change, type Step } from './history';

export interface Photo {
  camera?: import('../film/profiles').CameraMetadata | null;
  lens?: import('../engine/lenscorrection').LensMetadata | null;
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
  /** A camera RAW. */
  raw: boolean;
  /** The JPEG folded into this RAW (same name, same folder), when JPEGs are folded. */
  pair: string | null;
}

export interface Folder {
  root: string;
  name: string;
  unreadable: number;
}

export type View = 'library' | 'develop';

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

interface State {
  folder: Folder | null;
  subfolders: { path: string; name: string }[];
  candidates: Photo[];
  importChoice: FolderImport | null;
  choosingImport: boolean;
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
  /**
   * A custom look open for editing on the photo at `path`: the look's settings are on that photo's
   * sliders, as a draft kept in memory only (no sidecar write, no undo step). `original` is the
   * photo's saved recipe, which comes back when editing ends.
   */
  lookEdit: { id: string; name: string; path: string; original: Recipe | null } | null;
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
  /** RAW+JPEG pairs show as one frame, the RAW. */
  foldJpegs: boolean;
  /** JPEGs folded into their RAWs, kept to unfold them again. */
  hidden: Photo[];
  /** How many RAWs in the folder have a JPEG twin, folded or not. */
  pairCount: number;
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

const FOLD_KEY = 'emulsion.foldJpegs';
/** Whether to fold JPEGs into their RAWs, as last chosen on this computer (on unless turned off). */
function savedFoldJpegs(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** Each photo's place in the folder's scan, to put folded JPEGs back where they were. */
const scanOrder = new Map<string, number>();

/** The photos to show and the JPEGs folded away, for all of a folder's photos. */
function arrange(all: Photo[], fold: boolean): { shown: Photo[]; hidden: Photo[] } {
  if (!fold) return { shown: all.map((p) => ({ ...p, pair: null })), hidden: [] };
  return foldPairs(all);
}

/**
 * Fold JPEGs into their RAWs, or show them as frames of their own. The active
 * photo and the selection stay put; a JPEG folded away hands them to its RAW.
 */
export function setFoldJpegs(fold: boolean) {
  const { photos, hidden, active, selected } = get();
  const all = [...photos, ...hidden].sort((a, b) => (scanOrder.get(a.path) ?? 0) - (scanOrder.get(b.path) ?? 0));
  const { shown, hidden: nextHidden } = arrange(all, fold);
  const rawOf = new Map(shown.filter((p) => p.pair).map((p) => [p.pair!, p.path]));
  const keep = (path: string) => rawOf.get(path) ?? path;
  const activePath = photos[active] ? keep(photos[active].path) : null;
  const index = activePath ? shown.findIndex((p) => p.path === activePath) : -1;
  const visible = new Set(shown.map((p) => p.path));
  set({
    foldJpegs: fold,
    photos: shown,
    hidden: nextHidden,
    active: index >= 0 ? index : shown.length ? 0 : -1,
    anchor: index >= 0 ? index : 0,
    selected: new Set([...selected].map(keep).filter((p) => visible.has(p))),
  });
  try {
    localStorage.setItem(FOLD_KEY, String(fold));
  } catch {
    /* remembering it is a convenience */
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
  subfolders: [],
  candidates: [],
  importChoice: null,
  choosingImport: false,
  photos: [],
  view: 'library',
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
  lookEdit: null,
  developSize: null,
  filter: savedFilter(),
  stageColor: savedStageColor(),
  sharpenMask: false,
  foldJpegs: savedFoldJpegs(),
  hidden: [],
  pairCount: 0,
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

let folderRequest = 0;
export async function openFolder(path: string) {
  const request = ++folderRequest;
  finishCrop(true);
  endLookEdit();
  set({ loading: true });
  try {
    await flushSaves();
    if (request !== folderRequest) return;
    const res = await scanFolder(path, false);
    if (request !== folderRequest) return;
    const all: Photo[] = res.entries.map((e) => ({
      path: e.path,
      rel: e.rel,
      name: e.name,
      size: e.size,
      modified: e.modified,
      recipe: normalizeRecipe(e.recipe),
      seed: seedFor(e.path),
      white: null,
      ...normalizeMarks(e.rating, e.label, e.heart),
      raw: e.raw,
      pair: null,
    }));
    history.clear();
    const choice = folderImport(res.root);
    set({
      folder: { root: res.root, name: res.name, unreadable: res.unreadable },
      subfolders: res.folders ?? [],
      candidates: all,
      importChoice: choice,
      choosingImport: !choice,
      view: 'library',
      compare: false,
      ...historyState(),
    });
    displayImported(all, choice);
    if (res.unreadable) showToast(`${res.unreadable} items could not be read.`);
  } catch (err) {
    if (request === folderRequest) showToast(`Could not open that folder. ${String(err)}`);
  } finally {
    if (request === folderRequest) set({ loading: false });
  }
}

function displayImported(all: Photo[], choice: FolderImport | null) {
  const wanted = importedPaths(all.map(p => p.path), choice);
  const imported = all.filter(p => wanted.has(p.path));
  scanOrder.clear();
  imported.forEach((p, i) => scanOrder.set(p.path, i));
  const { shown: photos, hidden } = arrange(imported, get().foldJpegs);
  const active = photos.length ? Math.max(0, photos.findIndex(p => passes(p, get().filter))) : -1;
  set({ photos, hidden, pairCount: findPairs(imported).size, active, anchor: active,
    selected: active >= 0 ? new Set([photos[active].path]) : new Set(), histogram: null });
  const root = get().folder?.root;
  if (root && photos.length) void loadWhitePoints(root, photos.map(p => p.path));
}

export function importFolderPhotos(choice: FolderImport) {
  const { folder, candidates, photos, hidden } = get();
  if (!folder || get().loading) return;
  // Preserve in-memory edits when adding more photos or enabling sync.
  const current = new Map([...photos, ...hidden].map(p => [p.path, p]));
  const all = candidates.map(p => current.get(p.path) ?? p);
  saveFolderImport(folder.root, choice);
  set({ importChoice: choice, choosingImport: false, candidates: all });
  displayImported(all, choice);
}

export function chooseImport(choosingImport: boolean) { set({ choosingImport }); }

export function closeFolder() {
  ++folderRequest;
  finishCrop(true);
  endLookEdit();
  history.clear();
  set({ folder: null, photos: [], hidden: [], candidates: [], subfolders: [], importChoice: null,
    choosingImport: false, loading: false, active: -1, selected: new Set(), view: 'library', ...historyState() });
}

export const setView = (view: View) => {
  if (view === 'develop' && !get().photos.length) return;
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

/**
 * Change the filter. If the active photo does not match the new filter, the
 * first photo that does becomes active (and the selection), so a filter never
 * opens on a frame it hides. Edits made under a filter still keep the photo in
 * view (see shownIndices) until another is chosen.
 */
export function setFilter(change: Partial<Filter>) {
  const filter = { ...get().filter, ...change };
  set({ filter });
  const { photos, active } = get();
  const current = photos[active];
  if (current && !passes(current, filter)) {
    const first = photos.findIndex((p) => passes(p, filter));
    if (first >= 0) setActive(first);
  }
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
export function editRecipes(paths: string[], change: (r: Recipe | null, p: Photo) => Recipe | null, label?: string, grouping?: { key: string; continuous: boolean }) {
  // While a look is being edited, edits change only its draft on that photo.
  const editing = get().lookEdit;
  if (editing) {
    if (!paths.includes(editing.path)) return;
    set({ photos: get().photos.map((p) => (p.path === editing.path ? { ...p, recipe: change(p.recipe, p) } : p)) });
    return;
  }
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
    history.record(changes.length > 1 && !label ? `${name} on ${changes.length} photos` : name, changes, performance.now(), grouping?.key, grouping?.continuous);
  }
  set({ photos, ...historyState() });
}

export const editActive = (change: (r: Recipe | null, p: Photo) => Recipe | null, label?: string, grouping?: { key: string; continuous: boolean }) => {
  const a = activePhoto();
  if (a) editRecipes([a.path], change, label, grouping);
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
  if (get().lookEdit) return showToast('Finish editing the look first');
  finishCrop(true);
  const s = history.undo();
  if (s) applyStep(s, 'before', 'Undid');
  else showToast('Nothing to undo');
}

export function redo() {
  if (get().lookEdit) return showToast('Finish editing the look first');
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


/** Lens metadata belongs to the file, not its recipe. */
export function setPhotoLens(path: string, lens: import('../engine/lenscorrection').LensMetadata | null) {
  set({ photos: get().photos.map(p => p.path === path ? { ...p, lens } : p) });
}

export function setPhotoCamera(path: string, camera: import('../film/profiles').CameraMetadata | null) {
  set({ photos: get().photos.map(p => p.path === path ? { ...p, camera } : p) });
}

/** Open a custom look for editing on the photo at `path`, with `draft` (the look on its sliders) shown. */
export function startLookEdit(path: string, id: string, name: string, draft: Recipe) {
  const p = get().photos.find((x) => x.path === path);
  if (!p || get().lookEdit) return;
  set({
    lookEdit: { id, name, path, original: p.recipe },
    photos: get().photos.map((x) => (x.path === path ? { ...x, recipe: draft } : x)),
  });
}

/** Rename the look being edited. */
export function renameLookEdit(name: string) {
  const e = get().lookEdit;
  if (e) set({ lookEdit: { ...e, name } });
}

/** Stop editing a look: the photo gets its saved recipe back. Returns the draft it had. */
export function endLookEdit(): Recipe | null {
  const e = get().lookEdit;
  if (!e) return null;
  const draft = get().photos.find((x) => x.path === e.path)?.recipe ?? null;
  set({ lookEdit: null, photos: get().photos.map((x) => (x.path === e.path ? { ...x, recipe: e.original } : x)) });
  return draft;
}
