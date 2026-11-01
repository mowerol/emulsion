// SPDX-License-Identifier: GPL-3.0-or-later
import { captureLook } from '../film/looks';
// App state: the open folder (the roll), its photos and their recipes,
// selection, and which view is showing.

import { create } from 'zustand';
import type { Histogram } from '../engine/histogram';
import type { Xy } from '../engine/whitebalance';
import { scanFolder, whitePoints, type Entry } from '../backend/api';
import { folderImport, importedPaths, rememberFolder, saveFolderImport, type FolderImport } from './folders';
import { defaultRecipe, normalizeRecipe, withSettingsFrom, type Recipe } from '../film/recipe';
import { FULL, isFull, type Crop } from '../film/crop';
import { NO_FILTER, normalizeFilter, passes, rangeWithin, shownIndices, stepWithin, type Filter } from './filter';
import { seedFor } from '../engine/engine';
import { flushSaves, savePhoto } from './sidecars';
import { findPairs, foldPairs } from './pairs';
import { cleanCopyName, expandCopies, photoId, savedFrames } from './copies';
import { applyMark, describeMark, hasMark, normalizeMarks, type Label, type MarkKey, type Marks } from './marks';
import { History, describe, type Change, type Step } from './history';

export interface Photo {
  camera?: import('../film/profiles').CameraMetadata | null;
  lens?: import('../engine/lenscorrection').LensMetadata | null;
  /** Identity of an additional edit; absent on the original frame. */
  copyId?: string;
  copyName?: string;
  /** Source file, shared by every version. Never use this for frame selection. */
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
  includeSubfolders: boolean;
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
  lookEdit: { id: string; name: string; path: string; original: Recipe | null; past: (Recipe | null)[]; future: (Recipe | null)[] } | null;
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
  const rawOf = new Map(shown.filter((p) => !p.copyId && p.pair).map((p) => [p.pair!, p.path]));
  const keep = (path: string) => rawOf.get(path) ?? path;
  const activePath = photos[active] ? keep(photoId(photos[active])) : null;
  const index = activePath ? shown.findIndex((p) => photoId(p) === activePath) : -1;
  const visible = new Set(shown.map(photoId));
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
  includeSubfolders: false,
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

const scannedPhoto = (e: Entry): Photo => ({
  path: e.path, rel: e.rel, name: e.name, size: e.size, modified: e.modified,
  recipe: normalizeRecipe(e.recipe), seed: seedFor(e.path), white: null,
  ...normalizeMarks(e.rating, e.label, e.heart), raw: e.raw, pair: null,
});

let folderRequest = 0;
export async function openFolder(path: string) {
  if (get().lookEdit) return showToast('Save or cancel the look draft first');
  const request = ++folderRequest;
  finishCrop(true);
  endLookEdit();
  set({ loading: true });
  try {
    await flushSaves();
    if (request !== folderRequest) return;
    const recursive = folderImport(path)?.includeSubfolders === true;
    let res = await scanFolder(path, recursive);
    if (request !== folderRequest) return;
    const choice = folderImport(res.root);
    if (choice?.includeSubfolders && !recursive) {
      res = await scanFolder(res.root, true);
      if (request !== folderRequest) return;
    }
    const all = res.entries.flatMap(e => expandCopies(scannedPhoto(e), e.copies));
    history.clear();
    set({
      folder: { root: res.root, name: res.name, unreadable: res.unreadable },
      subfolders: res.folders ?? [],
      candidates: all,
      importChoice: choice,
      choosingImport: !choice,
      includeSubfolders: choice?.includeSubfolders === true,
      view: 'library',
      compare: false,
      ...historyState(),
    });
    displayImported(all, choice);
    rememberFolder(res.root);
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
  set({ photos, hidden, pairCount: findPairs(imported.filter(p => !p.copyId)).size, active, anchor: active,
    selected: active >= 0 ? new Set([photoId(photos[active])]) : new Set(), histogram: null });
  const root = get().folder?.root;
  if (root && photos.length) void loadWhitePoints(root, [...new Set(photos.map(p => p.path))]);
}

export function importFolderPhotos(choice: FolderImport) {
  const { folder, candidates, photos, hidden } = get();
  if (!folder || get().loading) return;
  // Preserve in-memory edits when adding more photos or enabling sync.
  const current = new Map([...photos, ...hidden].map(p => [photoId(p), p]));
  const all = candidates.map(p => current.get(photoId(p)) ?? p);
  choice = { ...choice, includeSubfolders: get().includeSubfolders };
  if (choice.mode === 'selected') {
    const available = new Set(all.map(p => p.path));
    choice.paths = choice.paths.filter(path => available.has(path));
  }
  saveFolderImport(folder.root, choice);
  set({ importChoice: choice, choosingImport: false, candidates: all });
  displayImported(all, choice);
}

export function chooseImport(choosingImport: boolean) { set({ choosingImport }); }

/** Preview the requested scope without changing which photos have been imported. */
export async function setIncludeSubfolders(include: boolean) {
  const { folder } = get();
  if (!folder || get().loading || include === get().includeSubfolders) return;
  const request = ++folderRequest;
  set({ loading: true });
  try {
    await flushSaves();
    if (request !== folderRequest) return;
    const res = await scanFolder(folder.root, include);
    if (request !== folderRequest) return;
    const current = new Map([...get().candidates, ...get().photos, ...get().hidden].map(p => [photoId(p), p]));
    const families = new Map<string, Photo[]>();
    for (const p of current.values()) families.set(p.path, [...(families.get(p.path) ?? []), p]);
    set({ candidates: res.entries.flatMap(e => families.get(e.path) ?? expandCopies(scannedPhoto(e), e.copies)), includeSubfolders: include });
    if (res.unreadable) showToast(`${res.unreadable} items could not be read.`);
  } catch (err) {
    if (request === folderRequest) showToast(`Could not read that folder. ${String(err)}`);
  } finally {
    if (request === folderRequest) set({ loading: false });
  }
}

export function closeFolder() {
  ++folderRequest;
  finishCrop(true);
  endLookEdit();
  history.clear();
  set({ folder: null, photos: [], hidden: [], candidates: [], subfolders: [], importChoice: null,
    choosingImport: false, includeSubfolders: false, loading: false, active: -1, selected: new Set(), view: 'library', ...historyState() });
}

export const setView = (view: View) => {
  if (get().lookEdit) return showToast('Save or cancel the look draft first');
  if (view === 'develop' && !get().photos.length) return;
  if (view !== 'develop') finishCrop(true);
  set({ view });
};

export function setActive(index: number, mode: 'single' | 'toggle' | 'range' | 'keep' = 'single') {
  if (get().lookEdit && index !== get().active) return showToast('Save or cancel the look draft first');
  if (index !== get().active) finishCrop(true);
  const { photos, anchor, selected } = get();
  if (index < 0 || index >= photos.length) return;
  const path = photoId(photos[index]);
  if (mode === 'keep') {
    set({ active: index, anchor: index, selected: selected.has(path) ? selected : new Set([path]) });
  } else if (mode === 'toggle') {
    const next = new Set(selected);
    if (next.has(path) && next.size > 1) next.delete(path);
    else next.add(path);
    set({ active: index, anchor: index, selected: next });
  } else if (mode === 'range' && anchor >= 0) {
    // Only the photos the filter shows; hidden ones in between stay unselected.
    set({ active: index, selected: new Set(rangeWithin(shown(), anchor, index).map((i) => photoId(photos[i]))) });
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
  set({ selected: new Set(shown().map((i) => photoId(photos[i]))) });
}

export const activePhoto = (s: State = get()) => s.photos[s.active] ?? null;

/** Photos an edit should apply to: the selection when several are selected, otherwise the active photo. */
export function targets(s: State = get()): Photo[] {
  if (s.selected.size > 1) return s.photos.filter((p) => s.selected.has(photoId(p)));
  const a = activePhoto(s);
  return a ? [a] : [];
}

/** Change recipes and save their sidecars. */
const history = new History();

const historyState = () => ({ history: { undo: history.undoLabel, redo: history.redoLabel } });

/** Persist one complete source family, so edits to two copies cannot overwrite each other. */
function persistSources(ids: string[]) {
  const paths = new Set(ids.map(id => id.split('\0')[0]));
  for (const path of paths) {
    const editing = get().lookEdit;
    const family = [...get().photos, ...get().hidden].filter(p => p.path === path)
      .map(p => editing?.path === photoId(p) ? { ...p, recipe: editing.original } : p);
    if (!family.some(p => !p.copyId)) continue;
    savePhoto({ path, ...savedFrames(family) });
    // Import management must retain versions created or removed since the last scan.
    let inserted = false;
    const candidates = get().candidates.flatMap(p => {
      if (p.path !== path) return [p];
      if (inserted) return [];
      inserted = true;
      return family;
    });
    set({ candidates });
  }
}

const familyOf = (path: string) => [...get().photos, ...get().hidden].filter(p => p.path === path);

/** Replace complete version families while preserving source order and valid selection. */
function replaceFamilies(families: Map<string, Photo[]>, preferred?: string[]) {
  const s = get();
  const activeId = s.photos[s.active] ? photoId(s.photos[s.active]) : null;
  const activeSource = s.photos[s.active]?.path;
  const sources = new Map([...s.hidden, ...s.photos].map(p => [p.path, p]));
  const inserted = new Set<string>();
  const all = [...s.photos, ...s.hidden].flatMap(p => {
    if (!families.has(p.path)) return [p];
    if (inserted.has(p.path)) return [];
    inserted.add(p.path);
    const source = sources.get(p.path)!;
    // Decode metadata can arrive after a history snapshot was recorded.
    return families.get(p.path)!.map(v => ({ ...v, white: source.white ?? v.white,
      camera: source.camera ?? v.camera, lens: source.lens ?? v.lens }));
  }).sort((a, b) => (scanOrder.get(a.path) ?? 0) - (scanOrder.get(b.path) ?? 0));
  const { shown: photos, hidden } = arrange(all, s.foldJpegs);
  const ids = new Set(photos.map(photoId));
  let selected = new Set((preferred ?? [...s.selected]).filter(id => ids.has(id)));
  let active = photos.findIndex(p => photoId(p) === (preferred?.[0] ?? activeId));
  if (active < 0) active = photos.findIndex(p => p.path === activeSource);
  if (active < 0) active = photos.length ? Math.min(Math.max(s.active, 0), photos.length - 1) : -1;
  if (selected.size && active >= 0 && !selected.has(photoId(photos[active]))) active = photos.findIndex(p => selected.has(photoId(p)));
  if (!selected.size && active >= 0) selected = new Set([photoId(photos[active])]);
  set({ photos, hidden, selected, active, anchor: active, histogram: null });
}

export function createVirtualCopies() {
  if (get().lookEdit) return showToast('Finish editing the look first');
  finishCrop(true);
  const selected = targets();
  const families = new Map<string, Photo[]>();
  const changes: Change[] = [];
  const created: string[] = [];
  for (const p of selected) {
    const family = families.get(p.path) ?? familyOf(p.path);
    let n = 1;
    while (family.some(v => v.copyName === `Copy ${n}`)) n++;
    const copyId = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    const copy: Photo = { ...p, copyId, copyName: `Copy ${n}`, recipe: p.recipe ? structuredClone(p.recipe) : null, pair: null };
    families.set(p.path, [...family, copy]);
    created.push(photoId(copy));
  }
  if (!created.length) return;
  for (const [path, after] of families) changes.push({ path, frames: true, before: familyOf(path), after });
  history.record(created.length === 1 ? 'Create virtual copy' : `Create ${created.length} virtual copies`, changes, performance.now(), `create:${created.join('|')}`);
  replaceFamilies(families, created);
  set(historyState());
  persistSources([...families.keys()]);
  showToast(created.length === 1 ? 'Created virtual copy' : `Created ${created.length} virtual copies`);
}

/** Remove versions only; the original frame and source file are always retained. */
export function removeVirtualCopies() {
  if (get().lookEdit) return showToast('Finish editing the look first');
  finishCrop(true);
  const copies = targets().filter(p => p.copyId);
  const removing = new Set(copies.map(photoId));
  if (!copies.length) return;
  const changes: Change[] = [];
  const families = new Map<string, Photo[]>();
  for (const path of new Set(copies.map(p => p.path))) {
    const before = familyOf(path);
    const after = before.filter(p => !removing.has(photoId(p)));
    families.set(path, after);
    changes.push({ path, frames: true, before, after });
  }
  history.record(copies.length === 1 ? 'Remove virtual copy' : `Remove ${copies.length} virtual copies`, changes, performance.now(), `remove:${[...removing].join('|')}`);
  replaceFamilies(families);
  set(historyState());
  persistSources([...families.keys()]);
  showToast(copies.length === 1 ? 'Removed virtual copy' : `Removed ${copies.length} virtual copies`, { label: 'Undo', run: undo });
}

export function renameVirtualCopy(id: string, name: string) {
  if (get().lookEdit) return;
  const p = get().photos.find(p => photoId(p) === id);
  if (!p?.copyId) return;
  name = cleanCopyName(name);
  if (p.copyName === name) return;
  const before = familyOf(p.path);
  const after = before.map(v => photoId(v) === id ? { ...v, copyName: name } : v);
  history.record('Rename virtual copy', [{ path: p.path, frames: true, before, after }], performance.now(), `rename:${id}`);
  replaceFamilies(new Map([[p.path, after]]));
  set(historyState());
  persistSources([p.path]);
}

/**
 * Change the recipes of `paths`. Every change is an undoable step, named by
 * `label`, or after what changed.
 */
export function editRecipes(paths: string[], change: (r: Recipe | null, p: Photo) => Recipe | null, label?: string, grouping?: { key: string; continuous: boolean }) {
  // While a look is being edited, edits change only its draft on that photo.
  const editing = get().lookEdit;
  if (editing) {
    if (!paths.includes(editing.path)) return;
    const current = get().photos.find(p => photoId(p) === editing.path)!;
    set({ lookEdit: { ...editing, past: [...editing.past.slice(-199), current.recipe], future: [] }, photos: get().photos.map((p) => (photoId(p) === editing.path ? { ...p, recipe: change(p.recipe, p) } : p)) });
    return;
  }
  const wanted = new Set(paths);
  const changes: Change[] = [];
  const photos = get().photos.map((p) => {
    if (!wanted.has(photoId(p))) return p;
    const changed = change(p.recipe, p);
    const recipe = changed ? captureLook(changed) : null;
    if (recipe === p.recipe) return p;
    changes.push({ path: photoId(p), before: p.recipe, after: recipe });
    return { ...p, recipe };
  });
  if (changes.length) {
    const first = changes[0] as { before: Recipe | null; after: Recipe | null };
    const name = label ?? describe(first.before, first.after);
    history.record(changes.length > 1 && !label ? `${name} on ${changes.length} photos` : name, changes, performance.now(), grouping?.key, grouping?.continuous);
  }
  set({ photos, ...historyState() });
  persistSources(changes.map(c => c.path));
}

export const editActive = (change: (r: Recipe | null, p: Photo) => Recipe | null, label?: string, grouping?: { key: string; continuous: boolean }) => {
  const a = activePhoto();
  if (a) editRecipes([photoId(a)], change, label, grouping);
};

/**
 * Star, tag or heart the selected frames (or the active one), as one undoable step.
 * A tag or heart every target already has comes off; otherwise they all get it.
 */
export function markPhotos(mark: MarkKey) {
  const t = targets();
  if (!t.length) return;
  const allHave = t.every((p) => hasMark(p, mark));
  const wanted = new Set(t.map(photoId));
  const changes: Change[] = [];
  const photos = get().photos.map((p) => {
    if (!wanted.has(photoId(p))) return p;
    const before: Marks = { rating: p.rating, label: p.label, heart: p.heart };
    const after = applyMark(before, mark, allHave);
    if (after.rating === before.rating && after.label === before.label && after.heart === before.heart) return p;
    const next = { ...p, ...after };
    changes.push({ path: photoId(p), marks: true, before, after });
    return next;
  });
  if (!changes.length) return;
  const name = !('rating' in mark) && allHave ? ('heart' in mark ? 'Remove heart' : 'Remove tag') : describeMark(mark);
  history.record(changes.length > 1 ? `${name} on ${changes.length} photos` : name, changes, performance.now());
  set({ photos, ...historyState() });
  persistSources(changes.map(c => c.path));
}

/** Put recipes and marks back as a history step recorded them, without recording a new step. */
function applyStep(step: Step, side: 'before' | 'after', verb: string) {
  const families = new Map<string, Photo[]>();
  for (const c of step.changes) if (c.frames) families.set(c.path, c[side]);
  if (families.size) {
    const present = new Set(get().photos.map(photoId));
    const restored = [...families.values()].flat().filter(p => p.copyId && !present.has(photoId(p))).map(photoId);
    replaceFamilies(families, restored.length ? restored : undefined);
  }
  const byPath = new Map(step.changes.filter(c => !c.frames).map(c => [c.path, c]));
  const photos = get().photos.map((p) => {
    const c = byPath.get(photoId(p));
    if (!c || c.frames) return p;
    return c.marks ? { ...p, ...c[side] } : { ...p, recipe: c[side] };
  });
  set({ photos, ...historyState() });
  persistSources(step.changes.map(c => c.path));
  const only = step.changes.length === 1 ? photos.find((p) => photoId(p) === step.changes[0].path) : null;
  const active = activePhoto();
  const where = only && (!active || photoId(only) !== photoId(active)) ? ` on ${only.name}` : '';
  showToast(`${verb} ${step.label}${where}`);
}

export function undo() {
  if (get().lookEdit) return lookDraftHistory('past');
  finishCrop(true);
  const s = history.undo();
  if (s) applyStep(s, 'before', 'Undid');
  else showToast('Nothing to undo');
}

export function redo() {
  if (get().lookEdit) return lookDraftHistory('future');
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
  editRecipes(t.map(photoId), (r) => withSettingsFrom(clip, r), t.length === 1 ? 'Paste settings' : `Paste settings to ${t.length} photos`);
  showToast(t.length === 1 ? `Pasted onto ${t[0].name}` : `Pasted onto ${t.length} frames`);
}

export const setCompare = (compare: boolean) => {
  if (get().compare !== compare) set({ compare });
};
export const setExportOpen = (exportOpen: boolean) => set({ exportOpen });

/** Record a photo's as-shot white point (from a decode or the background read). */
export function setPhotoWhite(path: string, white: Xy | null) {
  const update = (photos: Photo[]) => photos.map(p => p.path === path && !sameWhite(p.white, white) ? { ...p, white } : p);
  set({ photos: update(get().photos), hidden: update(get().hidden), candidates: update(get().candidates) });
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
  set({ cropEdit: { path: photoId(a), draft: a.recipe?.crop ?? FULL, W: size.W, H: size.H }, picking: false });
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
  finishCrop(true);
  const p = get().photos.find((x) => photoId(x) === path);
  if (!p || get().lookEdit) return;
  set({
    lookEdit: { id, name, path, original: p.recipe, past: [], future: [] }, picking: false, compare: false,
    photos: get().photos.map((x) => (photoId(x) === path ? { ...x, recipe: draft } : x)),
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
  const draft = get().photos.find((x) => photoId(x) === e.path)?.recipe ?? null;
  set({ lookEdit: null, photos: get().photos.map((x) => (photoId(x) === e.path ? { ...x, recipe: e.original } : x)) });
  return draft;
}

function lookDraftHistory(side: 'past' | 'future') {
  const e = get().lookEdit;
  if (!e || !e[side].length) return;
  const p = get().photos.find(p => photoId(p) === e.path)!;
  const other = side === 'past' ? 'future' : 'past';
  const recipe = e[side][e[side].length - 1];
  set({ lookEdit: { ...e, [side]: e[side].slice(0, -1), [other]: [...e[other], p.recipe] }, photos: get().photos.map(p => photoId(p) === e.path ? { ...p, recipe } : p) });
}
