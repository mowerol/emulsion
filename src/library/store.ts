// SPDX-License-Identifier: GPL-3.0-or-later
import { captureLook } from '../film/looks';
// App state: the open folder (the roll), its photos and their recipes,
// selection, and which view is showing.

import { create } from 'zustand';
import { changedPlaces } from './photolist';
import { useRef } from 'react';
import type { Histogram } from '../engine/histogram';
import type { Xy } from '../engine/whitebalance';
import { catalogMetadata, embeddedMetadata, isTauri, metadataFromFiles, scanFolder, trashPhotos, whitePoints, type EmbeddedMetadata, type Entry, type ScanProgress, type Saved } from '../backend/api';
import { isEmptyMeta, normalizeMeta, sameMeta, type PhotoMeta } from './meta';
import { autoPreset, fillPreset } from './metapresets';
import { folderImport, importedPaths, importedRoots, rememberFolder, saveFolderImport, type FolderImport } from './folders';
import { libraryEntries, membership as folderMembership, parentFolder, withinFolder } from './membership';
import { defaultRecipe, normalizeRecipe, type Recipe } from '../film/recipe';
import { applyCopiedSettings, DEFAULT_COPY_GROUPS, normalizeCopyGroups, type CopiedSettings, type CopyGroup } from '../film/copysettings';
import { FULL, isFull, type Crop } from '../film/crop';
import { NO_FILTER, isFiltering, normalizeFilter, passes, rangeWithin, shownIndices, stepWithin, type Filter } from './filter';
import { seedFor } from '../engine/engine';
import { flushSaves, savePhoto } from './sidecars';
import { findPairs, foldPairs } from './pairs';
import { cleanCopyName, expandCopies, photoId, savedFrames } from './copies';
import { applyMark, describeMark, hasMark, normalizeMarks, sameMarks, type Flag, type Label, type MarkKey, type Marks } from './marks';
import { History, MERGE_MS, describe, type Change, type Step } from './history';
import * as trace from '../dev/trace';
import { addToCollection, cacheEdits, cacheFolder, catalogPhotos, queueEdits, recordImport, sourceMatcher, sourceMatches, targetCollection, useCatalog, useSourceDefinitions, viewImport, type SourceSelection } from './catalog';

export interface Photo {
  capture?: { camera: string | null; date: string | null };
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
  /** The cull flag: picked, rejected, or null for unflagged. Rejecting never deletes. */
  flag: Flag | null;
  /** Keywords and IPTC fields of the source file, the same on each of its copies; absent is none. */
  meta?: PhotoMeta;
  /** A camera RAW. */
  raw: boolean;
  /** The JPEG folded into this RAW (same name, same folder), when JPEGs are folded. */
  pair: string | null;
  /**
   * The background reads already made of this file at this size and modified time: its white
   * point (in `white`) and what is embedded in it (null for nothing). Kept in the catalog so
   * reopening a folder or collection doesn't read every file again.
   */
  read?: { white?: true; embedded?: EmbeddedMetadata | null };
}

export interface Folder {
  root: string;
  name: string;
  unreadable: number;
}

export type View = 'library' | 'develop';
export type LibraryView = 'grid' | 'loupe';

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

export interface State {
  source: SourceSelection | null;
  selectedOnly: boolean;
  missingPaths: Set<string> | null;
  collectionAddIds: string[];
  /** Explicitly applying a filter with no matches leaves the active edit intact, but hides its tile. */
  filterExcludedActive: string | null;
  folder: Folder | null;
  subfolders: { path: string; name: string }[];
  candidates: Photo[];
  importChoice: FolderImport | null;
  choosingImport: boolean;
  includeSubfolders: boolean;
  photos: Photo[];
  view: View;
  libraryView: LibraryView;
  /** Optional photo-only presentation of the Library loupe. */
  loupeFullscreen: boolean;
  active: number;
  selected: Set<string>;
  anchor: number;
  compare: boolean;
  clipboard: CopiedSettings | null;
  copySettingsSource: { name: string; recipe: Recipe } | null;
  loading: boolean;
  /**
   * The folder or source being opened, shown at once (its name, "Reading photos…") in place of the
   * previous one, which stays in `photos` until the new one is read (and comes back if that fails).
   */
  opening: { source: SourceSelection; name: string } | null;
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
  lookEdit: {
    id: string; name: string; path: string; original: Recipe | null; past: (Recipe | null)[]; future: (Recipe | null)[]; start: { name: string; draft: Recipe }; matching?: object;
    /** The newest undo step's key and time, so a drag is one step, merged by the photo history's rule. */
    last?: { key: string; at: number };
    /** The photo editing started on, once the draft has moved to a test photo (moveLookEdit). */
    home?: string;
    /** A test photo from outside the open photos, added to them while the draft is on it. */
    guest?: string;
  } | null;
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
  { id: 'dark', label: 'Dark grey', hex: '#161616', light: false },
  { id: 'grey', label: 'Mid grey (18%)', hex: '#777777', light: true },
  { id: 'white', label: 'White', hex: '#ffffff', light: true },
] as const;
export type StageColorId = (typeof STAGE_COLORS)[number]['id'];

const STAGE_COLOR_KEY = 'emulsion.stageColor';
/** The workspace colour last chosen on this computer. */
function savedStageColor(): StageColorId {
  try {
    const v = localStorage.getItem(STAGE_COLOR_KEY);
    return STAGE_COLORS.find((c) => c.id === v)?.id ?? 'grey';
  } catch {
    return 'grey';
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
  source: null,
  selectedOnly: false,
  missingPaths: null,
  collectionAddIds: [],
  filterExcludedActive: null,
  folder: null,
  subfolders: [],
  candidates: [],
  importChoice: null,
  choosingImport: false,
  includeSubfolders: false,
  photos: [],
  view: 'library',
  libraryView: 'grid',
  loupeFullscreen: false,
  active: -1,
  selected: new Set(),
  anchor: -1,
  compare: false,
  clipboard: null,
  copySettingsSource: null,
  loading: false,
  opening: null,
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

// Late-bound so tests can time each flush (tools/browser-tests/ui-latency.tsx wraps setState).
const set = ((...a: Parameters<typeof useApp.setState>) => (useApp.setState as (...a: unknown[]) => void)(...a)) as typeof useApp.setState;
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
  ...normalizeMarks(e.rating, e.label, e.flag), meta: normalizeMeta(e.meta), raw: e.raw, pair: null,
});

/**
 * Background reads answer 32-64 photos at a time, but each state update costs the whole library
 * (the catalog rewrite in cacheEdits, the grid and sidebar renders), so a smart collection of
 * 20,000 photos stalled the app. Results are applied together, every FLUSH_EVERY photos.
 */
const FLUSH_EVERY = 1024;

/** Apply `update` to the open photos, leaving each list (and the state) alone when nothing changed. */
function updateOpenPhotos(update: (p: Photo) => Photo) {
  const map = (list: Photo[]) => {
    let changed = false;
    const next = list.map(p => { const q = update(p); if (q !== p) changed = true; return q; });
    return changed ? next : list;
  };
  const { photos, hidden, candidates } = get();
  const next = { photos: map(photos), hidden: map(hidden), candidates: map(candidates) };
  if (next.photos !== photos || next.hidden !== hidden || next.candidates !== candidates) set(next);
}

function withCachedMetadata(photo: Photo, cached?: Photo): Photo {
  if (!cached || cached.size !== photo.size || cached.modified !== photo.modified) return photo;
  return { ...photo, camera: cached.camera, lens: cached.lens, white: cached.white, capture: cached.capture, ...(cached.read ? { read: cached.read } : {}) };
}

/** Index metadata in bounded batches so camera/date smart collections cover offscreen frames too. */
async function loadCatalogMetadata(photos: Photo[]) {
  if (!isTauri()) return;
  const pending = [...new Map(photos.filter(p => !p.capture).map(p => [p.path, p])).values()];
  let updates = new Map<string, { identity: Photo; capture: NonNullable<Photo['capture']> }>();
  const flush = () => {
    if (!updates.size) return;
    const found = updates;
    updates = new Map();
    const update = (p: Photo) => {
      const data = found.get(p.path);
      return data && p.size === data.identity.size && p.modified === data.identity.modified ? { ...p, capture: data.capture } : p;
    };
    cacheEdits(catalogPhotos().filter(p => found.has(p.path)).map(update));
    updateOpenPhotos(update);
  };
  for (let i = 0; i < pending.length; i += 32) {
    const batch = pending.slice(i, i + 32);
    try {
      const values = await catalogMetadata(batch.map(p => p.path));
      batch.forEach((p, n) => updates.set(p.path, { identity: p, capture: values[n] ?? { camera: null, date: null } }));
    } catch { break; }
    if (updates.size >= FLUSH_EVERY) flush();
  }
  flush();
}

let folderRequest = 0;

const trimRoot = (path: string) => path.length > 1 ? path.replace(/[\\/]+$/, '') : path;
/** The source the Library shows: the one being opened, else the open one. */
export const shownSource = (s: State = get()) => s.opening?.source ?? s.source;

/**
 * Show `source` straight away while it is read: a large folder or collection takes seconds, and
 * leaving the previous one on screen meanwhile looked like a hang. Reopening the open one (a
 * refresh) keeps it on screen. The previous photos are deselected so keys can't mark them unseen.
 */
function beginOpening(source: SourceSelection, name: string) {
  const current = get().source;
  const same = current?.type === source.type && (source.type === 'folder' ? trimRoot(current.id) === trimRoot(source.id) : current.id === source.id);
  if (same) return;
  set({ opening: { source, name }, view: 'library', loupeFullscreen: false, compare: false, active: -1, anchor: -1, selected: new Set() });
}

let importReturn: State | null = null;

export async function openFolder(path: string, importing = false) {
  if (get().lookEdit) return showToast('Save or cancel the look draft first');
  flushCandidates();
  const previousState = get();
  const request = ++folderRequest;
  finishCrop(true);
  endLookEdit();
  cacheEdits([...get().photos, ...get().hidden]);
  try { await flushSaves(); }
  catch (err) { if (request === folderRequest) showToast(`Save changes before opening another folder. ${String(err)}`); return; }
  if (request !== folderRequest) return;
  set({ loading: true });
  beginOpening({ type: 'folder', id: path }, trimRoot(path).split(/[\\/]/).pop() || path);
  const root = trimRoot(path);
  const knownChoice = folderMembership(root);
  const knownPhotos = libraryEntries(root, [], knownChoice);
  let shownFirst: Map<string, Photo> | null = null;
  if (!importing && knownChoice && knownPhotos.length) {
    const same = previousState.source?.type === 'folder' && trimRoot(previousState.source.id) === root && !previousState.choosingImport && !previousState.opening;
    if (!same) {
      history.clear();
      set({ source: { type: 'folder', id: root }, folder: { root, name: root.split(/[\\/]/).pop() || root, unreadable: 0 },
        candidates: [], subfolders: [], importChoice: knownChoice, includeSubfolders: knownChoice.includeSubfolders === true,
        choosingImport: false, missingPaths: null, opening: null, ...historyState() });
      displayImported(knownPhotos, knownChoice, { readMetadata: false });
    }
    shownFirst = new Map([...get().photos, ...get().hidden].map(p => [photoId(p), p]));
  }
  const discovered: Photo[] = [];
  let progressChoice: FolderImport | null | undefined;
  let previewed = false;
  const showBatch = (batch: ScanProgress) => {
    if (request !== folderRequest || !get().loading) return;
    if (progressChoice === undefined) progressChoice = folderMembership(batch.root);
    if (!importing && progressChoice) return;
    if (!importReturn) importReturn = previousState;
    previewed = true;
    discovered.push(...batch.entries.flatMap(e => expandCopies(scannedPhoto(e), e.copies)));
    // Only complete sidecars enter the importer. Import stays disabled until the scan finishes.
    set({ source: { type: 'folder', id: batch.root }, folder: { root: batch.root, name: batch.name, unreadable: batch.unreadable },
      candidates: [...discovered], subfolders: batch.folders, importChoice: progressChoice,
      choosingImport: true, opening: null, includeSubfolders: knownChoice?.includeSubfolders === true,
      photos: [], hidden: [], active: -1, anchor: -1, selected: new Set(), pairCount: 0, missingPaths: null });
  };
  try {
    await flushSaves();
    if (request !== folderRequest) return;
    const recursive = folderImport(path)?.includeSubfolders === true;
    let res = await (!importing && knownChoice ? scanFolder(path, recursive) : scanFolder(path, recursive, showBatch));
    if (request !== folderRequest) return;
    const choice = folderMembership(res.root, res.entries.map(scannedPhoto));
    if (choice?.includeSubfolders && !recursive) {
      res = await scanFolder(res.root, true);
      if (request !== folderRequest) return;
    }
    const cached = new Map(catalogPhotos().map(p => [photoId(p), p]));
    let all = res.entries.flatMap(e => expandCopies(scannedPhoto(e), e.copies)).map(p => withCachedMetadata(p, cached.get(photoId(p))));
    if (shownFirst) {
      // A background scan must not undo edits, marks, or version changes made while it ran.
      const current = [...get().photos, ...get().hidden];
      const now = new Map(current.map(p => [photoId(p), p]));
      const changed = new Set([...current.filter(p => {
        const before = shownFirst.get(photoId(p));
        return !before || p.recipe !== before.recipe || !sameMarks(p, before) || !sameMeta(p.meta, before.meta) || p.copyName !== before.copyName;
      }).map(p => p.path),
        ...[...shownFirst.values()].filter(p => !now.has(photoId(p))).map(p => p.path)]);
      all = [...all.filter(p => !changed.has(p.path)).map(p => withCachedMetadata(p, now.get(photoId(p)))), ...current.filter(p => changed.has(p.path))];
      cacheEdits(current.filter(p => changed.has(p.path)));
    }
    if ((importing || !choice) && !importReturn) importReturn = previousState;
    if (!importing && choice && !shownFirst) history.clear();
    set({
      missingPaths: null,
      source: { type: 'folder', id: res.root },
      folder: { root: res.root, name: res.name, unreadable: res.unreadable },
      subfolders: res.folders ?? [],
      candidates: all,
      importChoice: choice,
      choosingImport: importing || !choice,
      includeSubfolders: choice?.includeSubfolders === true,
      ...(!shownFirst ? { view: 'library' as const, loupeFullscreen: false, compare: false } : {}),
      ...historyState(),
    });
    displayImported(libraryEntries(res.root, all, choice), choice, { preserve: !!shownFirst });
    if (choice) cacheFolder(res.root, [...get().photos, ...get().hidden]);
    void loadCatalogMetadata([...get().photos, ...get().hidden]);
    rememberFolder(res.root);
    if (res.unreadable) showToast(`${res.unreadable} items could not be read.`);
    return true;
  } catch (err) {
    if (request === folderRequest) {
      if (previewed) chooseImport(false);
      showToast(`Could not open that folder. ${String(err)}`);
    }
  } finally {
    if (request === folderRequest) set({ loading: false, opening: null });
  }
}

/**
 * Open what was dropped on the window or the Dock icon. A folder opens as Import Folder does.
 * Photos open their folder (the first one's) and are imported there without asking, added to
 * what that folder already imports, then selected; photos from other folders are left out.
 */
export async function openPaths(paths: string[]) {
  if (!paths.length) return;
  if (!await openFolder(paths[0])) return;
  const { candidates, importChoice } = get();
  const inFolder = new Set(candidates.map(p => p.path));
  const files = [...new Set(paths)].filter(p => inFolder.has(p));
  if (!files.length) return;
  if (importChoice?.mode !== 'sync') {
    importFolderPhotos({ mode: 'selected', paths: [...new Set([...(importChoice?.paths ?? []), ...files])] });
  }
  const wanted = new Set(files);
  const photos = get().photos;
  const active = photos.findIndex(p => wanted.has(p.path));
  if (active >= 0) set({ active, anchor: active, selected: new Set(photos.filter(p => wanted.has(p.path)).map(photoId)) });
  const left = paths.length - files.length;
  if (left > 0 && files.length) showToast(`${left} ${left === 1 ? 'item' : 'items'} from other folders left out. Drop each folder's photos separately.`);
}

function displayImported(all: Photo[], choice: FolderImport | null, { preserve = false, readMetadata = true } = {}) {
  const previous = get();
  const wanted = importedPaths(all.map(p => p.path), choice);
  const imported = all.filter(p => wanted.has(p.path));
  scanOrder.clear();
  imported.forEach((p, i) => scanOrder.set(p.path, i));
  const { shown: photos, hidden } = arrange(imported, get().foldJpegs);
  const activeId = previous.photos[previous.active] && photoId(previous.photos[previous.active]);
  const anchorId = previous.photos[previous.anchor] && photoId(previous.photos[previous.anchor]);
  const active = preserve ? photos.findIndex(p => photoId(p) === activeId) : photos.findIndex(p => passes(p, get().filter));
  const visible = new Set(photos.map(photoId));
  set({ photos, hidden, pairCount: findPairs(imported.filter(p => !p.copyId)).size, active,
    anchor: preserve ? photos.findIndex(p => photoId(p) === anchorId) : active,
    selected: preserve ? new Set([...previous.selected].filter(id => visible.has(id))) : active >= 0 ? new Set([photoId(photos[active])]) : new Set(),
    ...(!preserve ? { histogram: null } : {}) });
  const root = get().folder?.root;
  if (readMetadata && root && photos.length) {
    // Photos the library hasn't seen before (the catalog is cached after this).
    const known = new Set(catalogPhotos().map(p => p.path));
    const fresh = [...new Set(imported.filter(p => !p.copyId && !known.has(p.path)).map(p => p.path))];
    void loadWhitePoints(root, imported);
    // The preset fills what is still empty once the photos' own embedded metadata is in.
    void loadEmbedded(root, imported).then(() => fillNewPhotos(root, fresh));
  }
}

/** Apply the automatic metadata preset to photos new to the library (empty fields only, not undoable). */
function fillNewPhotos(root: string, paths: string[]) {
  const preset = autoPreset();
  if (!preset || !paths.length || get().folder?.root !== root) return;
  const after = new Map<string, PhotoMeta>();
  for (const path of paths) {
    const before = familyOf(path).find(p => !p.copyId)?.meta ?? normalizeMeta(null);
    const next = normalizeMeta(fillPreset(before, preset));
    if (!sameMeta(before, next)) after.set(path, next);
  }
  if (!after.size) return;
  setSourceMeta(after);
  persistSources([...after.keys()]);
  showToast(`Metadata preset ${preset.name} applied to ${after.size} new ${after.size === 1 ? 'photo' : 'photos'}`);
}

export function importFolderPhotos(choice: FolderImport, name?: string) {
  flushCandidates();
  const { folder, candidates, photos, hidden } = get();
  if (!folder || get().loading) return;
  // Imports are additive snapshots. "sync" is accepted for old callers, never persisted.
  const current = new Map([...catalogPhotos(), ...photos, ...hidden].map(p => [photoId(p), p]));
  const all = candidates.map(p => current.get(photoId(p)) ?? p);
  const requested = new Set(choice.mode === 'sync' ? all.map(p => p.path) : choice.paths);
  const known = new Set(catalogPhotos().map(p => p.path));
  const added = all.filter(p => requested.has(p.path) && !known.has(p.path));
  const previous = folderMembership(folder.root);
  const paths = [...new Set([...(previous?.mode === 'selected' ? previous.paths : []), ...added.map(p => p.path)])];
  const next: FolderImport = { mode: 'selected', paths, includeSubfolders: get().includeSubfolders || previous?.includeSubfolders === true };
  saveFolderImport(folder.root, next);
  history.clear();
  set({ ...historyState(), importChoice: next, choosingImport: false, candidates: all, libraryView: 'grid' });
  displayImported(libraryEntries(folder.root, all, next), next);
  cacheFolder(folder.root, [...get().photos, ...get().hidden]);
  if (added.length) recordImport(name?.trim() || folder.name, folder.root, added.map(photoId));
  importReturn = null;
  void loadCatalogMetadata([...get().photos, ...get().hidden]);
}

/** Enter Import without losing the Library source/selection that Cancel returns to. */
export async function startImport(path = get().folder?.root) {
  if (!path || get().lookEdit) return;
  flushCandidates();
  if (!importReturn) { finishCrop(true); importReturn = get(); }
  set({ choosingImport: true, view: 'library', loupeFullscreen: false });
  const opened = await openFolder(path, true);
  if (!opened) chooseImport(false);
  else if (get().includeSubfolders) await setIncludeSubfolders(false);
  return opened;
}
export function chooseImport(choosingImport: boolean) {
  flushCandidates();
  if (choosingImport) {
    if (!importReturn) importReturn = get();
    set({ choosingImport: true, view: 'library', loupeFullscreen: false });
  } else {
    ++folderRequest;
    const previous = importReturn;
    importReturn = null;
    if (previous) {
      const { source, folder, photos, hidden, candidates, subfolders, importChoice, includeSubfolders, active, anchor, selected, pairCount, libraryView } = previous;
      set({ source, folder, photos, hidden, candidates, subfolders, importChoice, includeSubfolders, active, anchor, selected, pairCount, libraryView,
        choosingImport: false, opening: null, loading: false, view: 'library', ...historyState() });
    } else set({ choosingImport: false, loading: false, opening: null });
  }
}

/** Show missing entries even when they are in a subfolder outside the current folder scope. */
export function showMissingPhotos(root: string, paths: string[]) {
  ++folderRequest;
  const imported = catalogPhotos().filter(p => withinFolder(root, p.path));
  const { shown: photos, hidden } = arrange(imported, get().foldJpegs);
  const missingPaths = new Set(paths);
  const active = photos.findIndex(p => missingPaths.has(p.path));
  set({ source: { type: 'folder', id: root }, folder: { root, name: root.split(/[\\/]/).pop() || root, unreadable: 0 },
    photos, hidden, candidates: [], subfolders: [], importChoice: folderMembership(root), missingPaths, filter: NO_FILTER, selectedOnly: false,
    choosingImport: false, libraryView: 'grid', view: 'library', loupeFullscreen: false, loading: false, opening: null,
    active, anchor: active, selected: active < 0 ? new Set() : new Set([photoId(photos[active])]) });
}

/** Explicit reconciliation never deletes originals or sidecars. */
export async function syncFolderPhotos(root: string, options: { add: string[]; remove: string[]; recursive: boolean; knownOnly: boolean; importer: boolean; folders?: string[] }) {
  const knownFolders = new Set([...Object.keys(useCatalog.getState().folders), ...catalogPhotos().map(p => parentFolder(p.path))]);
  if (!await openFolder(root)) return false;
  if (options.recursive !== get().includeSubfolders) await setIncludeSubfolders(options.recursive);
  if (get().folder?.root !== root || get().includeSubfolders !== options.recursive) return false;
  if (options.knownOnly && options.recursive) set({ candidates: get().candidates.filter(p => parentFolder(p.path) === root || knownFolders.has(parentFolder(p.path))) });
  const available = new Set(get().candidates.map(p => p.path));
  const removed = new Set(get().folder?.unreadable ? [] : options.remove.filter(path => !available.has(path)));
  if (removed.size) forgetSources(removed);
  if (options.recursive) {
    const paths = new Set(get().candidates.map(p => parentFolder(p.path)));
    if (!options.knownOnly) for (const folder of options.folders ?? get().subfolders.map(f => f.path)) paths.add(folder);
    for (const path of paths) if (withinFolder(root, path) && !useCatalog.getState().folders[path]) {
      cacheFolder(path, []);
      saveFolderImport(path, { mode: 'selected', paths: [] });
    }
  }
  flushCandidates();
  const scopeChoice = folderMembership(root);
  if (scopeChoice?.mode === 'selected') {
    const next = { ...scopeChoice, includeSubfolders: options.recursive };
    saveFolderImport(root, next);
    set({ importChoice: next });
    displayImported(libraryEntries(root, get().candidates, next), next);
  }
  // Save only membership changes; Add all is a one-time import.
  if (options.add.length) importFolderPhotos({ mode: 'selected', paths: options.add });
  if (options.importer) chooseImport(true);
  else { importReturn = null; set({ choosingImport: false }); }
  return true;
}

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
    set({ candidates: res.entries.flatMap(e => families.get(e.path) ?? expandCopies(scannedPhoto(e), e.copies)), subfolders: res.folders ?? [], folder: { ...folder, unreadable: res.unreadable }, includeSubfolders: include });
    if (res.unreadable) showToast(`${res.unreadable} items could not be read.`);
  } catch (err) {
    if (request === folderRequest) showToast(`Could not read that folder. ${String(err)}`);
  } finally {
    if (request === folderRequest) set({ loading: false });
  }
}

export function closeFolder() {
  importReturn = null;
  ++folderRequest;
  set({ missingPaths: null });
  finishCrop(true);
  endLookEdit();
  cacheEdits([...get().photos, ...get().hidden]);
  history.clear();
  set({ source: null, folder: null, photos: [], hidden: [], candidates: [], subfolders: [], importChoice: null,
    choosingImport: false, includeSubfolders: false, loading: false, opening: null, active: -1, selected: new Set(), view: 'library', libraryView: 'grid', loupeFullscreen: false, copySettingsSource: null, ...historyState() });
}

/** Load virtual sources from saved folder memberships, re-reading sidecars before showing them. */
export async function selectSource(source: SourceSelection) {
  if (source.type === 'folder') return openFolder(source.id);
  if (get().lookEdit) return showToast('Save or cancel the look draft first');
  trace.begin(`selectSource ${source.type} ${source.id}`);
  const request = ++folderRequest;
  finishCrop(true);
  cacheEdits([...get().photos, ...get().hidden]);
  trace.mark('cacheEdits(previous)');
  try { await flushSaves(); }
  catch (err) { if (request === folderRequest) showToast(`Save changes before opening another source. ${String(err)}`); return; }
  if (request !== folderRequest) return;
  const collectionAddIds = [...get().selected];
  const catalog = useCatalog.getState();
  const session = source.type === 'import' ? catalog.imports.find(i => i.id === source.id) : null;
  const collection = source.type === 'collection' ? catalog.collections.find(c => c.id === source.id) : null;
  if (!session && !collection) return;
  const ids = new Set(session?.photoIds ?? (collection?.type === 'manual' ? collection.photoIds : []));
  const knownRoots = [...new Set([...Object.keys(catalog.folders), ...importedRoots()])];
  const roots = knownRoots.filter(root => collection?.type === 'smart' || session?.destinationPath === root || [...ids].some(id => id.startsWith(root.replace(/[\\/]$/, '') + (root.includes('\\') ? '\\' : '/'))));
  const root = session?.destinationPath ?? roots[0] ?? get().folder?.root;

  /** Show `all`; `refresh` keeps the active photo, the selection, the view and undo. */
  const display = (all: Photo[], refresh: boolean) => {
    scanOrder.clear();
    all.forEach((p, i) => scanOrder.set(p.path, i));
    const { shown: photos, hidden } = arrange(all, get().foldJpegs);
    trace.mark('  arrange');
    const pairCount = findPairs(all.filter(p => !p.copyId)).size;
    trace.mark('  findPairs');
    if (refresh) {
      const s = get();
      const activeId = s.photos[s.active] ? photoId(s.photos[s.active]) : null;
      const active = activeId ? photos.findIndex(p => photoId(p) === activeId) : -1;
      const visible = new Set(photos.map(photoId));
      set({ photos, hidden, pairCount, active, anchor: active, selected: new Set([...s.selected].filter(id => visible.has(id))) });
      return;
    }
    const first = photos.findIndex(p => sourceMatches(p, source) && passes(p, get().filter));
    trace.mark('  first');
    history.clear();
    set({ source, missingPaths: null, collectionAddIds, folder: root ? { root, name: root.split(/[\\/]/).pop() || root, unreadable: 0 } : null,
      photos, hidden, candidates: [], subfolders: [], importChoice: null, choosingImport: false,
      pairCount, active: first, anchor: first,
      selected: first >= 0 ? new Set([photoId(photos[first])]) : new Set(),
      view: 'library', loupeFullscreen: false, compare: false, histogram: null, ...historyState() });
    trace.mark('  set');
    if (session) viewImport(session.id);
  };

  set({ loading: true });
  // The catalog already holds these photos: show them at once and refresh them from disk behind
  // the grid (rescanning every folder of a large collection takes a second or more).
  const fromCatalog = catalogPhotos();
  trace.mark(`catalogPhotos(${fromCatalog.length})`);
  let shownFirst: Map<string, Photo> | null = null;
  if (fromCatalog.length) {
    display(fromCatalog, false);
    trace.mark('display(catalog)');
    trace.markPainted('painted(catalog)');
    shownFirst = new Map([...get().photos, ...get().hidden].map(p => [photoId(p), p]));
  } else beginOpening(source, (session ?? collection)!.name);
  try {
    trace.mark('before flushSaves');
    await flushSaves();
    trace.mark('flushSaves');
    if (request !== folderRequest) return;
    const cached = new Map(catalogPhotos().map(p => [photoId(p), p]));
    const scans = await Promise.allSettled(roots.map(async root => {
      let choice = folderMembership(root);
      const res = await scanFolder(root, choice?.includeSubfolders === true);
      choice = folderMembership(root, res.entries.map(scannedPhoto));
      const all = res.entries.flatMap(e => expandCopies(scannedPhoto(e), e.copies)).map(p => withCachedMetadata(p, cached.get(photoId(p))));
      trace.mark(`scan ${root.split('/').pop()} (${res.entries.length})`);
      return { root, photos: libraryEntries(root, all, choice) };
    }));
    trace.mark(`scans(${roots.length})`);
    if (request !== folderRequest) return;
    // Photos marked or edited while the folders were read keep what was done to them.
    const now = new Map([...get().photos, ...get().hidden].map(p => [photoId(p), p]));
    const changed = shownFirst ? [...now.values()].filter(p => p !== shownFirst!.get(photoId(p))) : [];
    for (const result of scans) if (result.status === 'fulfilled') cacheFolder(result.value.root, result.value.photos);
    if (changed.length) cacheEdits(changed);
    trace.mark('cacheScannedFolder');
    if (scans.some(r => r.status === 'rejected')) showToast('Some folders are unavailable. Showing their saved library entries.');
    const all = catalogPhotos();
    display(all, !!shownFirst);
    trace.mark('display(refresh)');
    trace.markPainted('painted(refresh)');
    if (root) {
      void loadWhitePoints(root, all).then(() => trace.mark('whitePoints'));
      void loadEmbedded(root, all).then(() => trace.mark('embedded'));
    }
    void loadCatalogMetadata(all).then(() => trace.mark('catalogMetadata'));
  } catch (err) {
    if (request === folderRequest) showToast(`Could not open that source. ${String(err)}`);
  } finally {
    if (request === folderRequest) set({ loading: false, opening: null });
  }
}

export function setSelectedOnly(selectedOnly: boolean) { set({ selectedOnly }); }

/**
 * Source membership is evaluated live, before the toolbar filters. The last answer is kept while
 * the photos, the source and the source definitions are the same objects: the top bar, filter bar,
 * header, grid and menu each read it on every store update, and a smart collection's rules over a
 * large library took most of a second per click when each of them ran them again (2026-11-11).
 * Callers must not change the arrays returned.
 */
interface Membership {
  photos: Photo[]; source: SourceSelection | null; imports: unknown; collections: unknown;
  matches: (photo: Photo) => boolean;
  /** A folder shows all it holds: the members are the photos themselves. */
  all: boolean;
  indices: number[];
  /** Listed when first asked for (sourcePhotos). */
  members: Photo[] | null;
}
let membership: Membership | null = null;
function sourceMembership(s: State): Membership {
  const { imports, collections } = useCatalog.getState();
  const m = membership;
  if (m && m.source === s.source && m.imports === imports && m.collections === collections) {
    if (m.photos === s.photos) return m;
    const changed = m.all ? (m.photos.length === s.photos.length ? [] : null) : changedPlaces(m.photos, s.photos);
    // The same members in the same places: only the photo objects are new.
    if (changed && changed.every(i => m.matches(s.photos[i]) === m.matches(m.photos[i]))) return membership = { ...m, photos: s.photos, members: null };
  }
  const all = !s.source || s.source.type === 'folder';
  const matches = sourceMatcher(s.source);
  const indices = s.photos.flatMap((p, i) => matches(p) ? [i] : []);
  return membership = { photos: s.photos, source: s.source, imports, collections, matches, all, indices, members: null };
}
export const sourceIndices = (s: State = get()) => sourceMembership(s).indices;
export const sourcePhotos = (s: State = get()) => {
  const m = sourceMembership(s);
  return m.members ??= m.all ? m.photos : m.indices.map(i => m.photos[i]);
};

// Keep the catalog current as edits, marks, versions and decoded camera metadata arrive.
// Only the sources whose photos changed (a drag changes one), queued until edits settle (catalog.ts).
useApp.subscribe((s, old) => {
  if ((s.photos === old.photos && s.hidden === old.hidden) || s.loading || s.lookEdit) return;
  if (s.photos.length !== old.photos.length || s.hidden.length !== old.hidden.length) return queueEdits([...s.photos, ...s.hidden]);
  const paths = new Set<string>();
  for (const [now, before] of [[s.photos, old.photos], [s.hidden, old.hidden]]) {
    if (now !== before) for (let i = 0; i < now.length; i++) if (now[i] !== before[i]) { paths.add(now[i].path); paths.add(before[i].path); }
  }
  if (paths.size) queueEdits([...s.photos.filter(p => paths.has(p.path)), ...s.hidden.filter(p => paths.has(p.path))]);
});

/** Shared by Library, Develop's Images pane and the classic filmstrip. */
/**
 * The shown photos' indices: the same array while they are the same (see `shown`), so an edit (or
 * a histogram update) that leaves the list as it was doesn't re-render the grid; catalogue changes
 * re-render through useCatalog. Not zustand's useShallow: once its own copy was another array of
 * the same indices it compared all of them on every store update, 3 ms a time with 22,000.
 */
export function useShown() {
  useSourceDefinitions();
  return useApp(shown);
}

const sameExceptRecipe = (a: Photo, b: Photo) => {
  const ka = Object.keys(a) as (keyof Photo)[];
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(k => k === 'recipe' || a[k] === b[k]);
};

/**
 * The active photo, kept the same object while only its recipe changes: for components that
 * show its name, marks or metadata but not its edits, so a slider drag doesn't re-render them.
 * Its `recipe` can be out of date; read it from activePhoto() (or subscribe to it) instead.
 */
export function useActivePhotoFacts(): Photo | null {
  const last = useRef<Photo | null>(null);
  return useApp(s => {
    const p = activePhoto(s), q = last.current;
    if (p && q && p !== q && sameExceptRecipe(p, q)) return q;
    return (last.current = p);
  });
}

export const setView = (view: View) => {
  if (get().lookEdit) return showToast('Save or cancel the look draft first');
  if (get().opening || get().choosingImport) return;
  if (view !== 'library' && !shown().length) return;
  if (view !== 'library' && !shown().includes(get().active)) setActive(shown()[0]);
  if (view !== 'develop') finishCrop(true);
  set({ view, loupeFullscreen: false });
};

export const isLibraryLoupe = (s: State = get()) => s.view === 'library' && s.libraryView === 'loupe' && !s.choosingImport;

export function setLibraryView(libraryView: LibraryView) {
  if (get().lookEdit || get().choosingImport || get().opening) return;
  const list = shown();
  if (libraryView === 'loupe' && !list.length) return;
  if (libraryView === 'loupe' && !list.includes(get().active)) setActive(list[0], 'preserve');
  finishCrop(true);
  set({ view: 'library', libraryView, loupeFullscreen: false });
}

export function setLoupeFullscreen(fullscreen: boolean) {
  if (!fullscreen) { set({ loupeFullscreen: false }); return; }
  if (get().lookEdit || get().choosingImport || !!get().opening || !shown().length) return;
  if (!isLibraryLoupe()) setLibraryView('loupe');
  set({ loupeFullscreen: true });
}

export function setActive(index: number, mode: 'single' | 'toggle' | 'range' | 'keep' | 'preserve' = 'single') {
  if (get().lookEdit && index !== get().active) return showToast('Save or cancel the look draft first');
  if (index !== get().active) finishCrop(true);
  const { photos, anchor, selected } = get();
  if (index < 0 || index >= photos.length) return;
  set({ filterExcludedActive: null });
  const path = photoId(photos[index]);
  if (mode === 'preserve') {
    // Culling moves focus independently of the Library's batch selection.
    set({ active: index, anchor: index });
  } else if (mode === 'keep') {
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

/**
 * Indices of the photos the grid and the strip show. The last answer is kept: the Images pane, the
 * filmstrip, the menu and every arrow key ask on each store update. It stands while its inputs are
 * the same objects, and through an edit that leaves the edited photos shown or hidden as they were
 * (changedPlaces). Callers must not change the array returned.
 */
let shownList: { photos: Photo[]; filter: Filter; active: number; selectedOnly: boolean; selected: Set<string>; missingPaths: State['missingPaths']; scope: number[]; list: number[] } | null = null;
export const shown = (s: State = get()) => {
  const membership = sourceMembership(s);
  const scope = membership.indices;
  // The active photo is kept whatever the filter says, so it only matters while one is on.
  const active = !isFiltering(s.filter) || (s.photos[s.active] && photoId(s.photos[s.active]) === s.filterExcludedActive) ? -1 : s.active;
  const kept = (p: Photo, i: number) => (passes(p, s.filter) || i === active) && (!s.selectedOnly || s.selected.has(photoId(p))) && (!s.missingPaths || s.missingPaths.has(p.path));
  const c = shownList;
  if (c && c.filter === s.filter && c.active === active && c.selectedOnly === s.selectedOnly && c.selected === s.selected && c.missingPaths === s.missingPaths && c.scope === scope) {
    if (c.photos === s.photos) return c.list;
    const changed = changedPlaces(c.photos, s.photos);
    if (changed && changed.every(i => kept(s.photos[i], i) === kept(c.photos[i], i))) { c.photos = s.photos; return c.list; }
  }
  const inScope = membership.all ? null : new Set(scope);
  let list = shownIndices(s.photos, s.filter, active).filter(i => (!inScope || inScope.has(i)) && (!s.selectedOnly || s.selected.has(photoId(s.photos[i]))) && (!s.missingPaths || s.missingPaths.has(s.photos[i].path)));
  // The same photos as before (a click changes the selection, not what is shown): the same array,
  // so useShown's readers are not drawn again.
  if (c && c.list.length === list.length && c.list.every((v, i) => v === list[i])) list = c.list;
  shownList = { photos: s.photos, filter: s.filter, active, selectedOnly: s.selectedOnly, selected: s.selected, missingPaths: s.missingPaths, scope, list };
  return list;
};

/** Move through the shown photos; a grid row down is `delta` = columns. */
export function step(delta: number) {
  if (!get().photos.length) return;
  setActive(stepWithin(shown(), get().active, delta), isLibraryLoupe() ? 'preserve' : 'single');
}

/** The first or last shown photo. */
export function stepToEnd(end: 'first' | 'last') {
  const list = shown();
  if (list.length) setActive(end === 'first' ? list[0] : list[list.length - 1], isLibraryLoupe() ? 'preserve' : 'single');
}

/**
 * Change the filter. If the active photo does not match the new filter, the
 * first photo that does becomes active (and the selection), so a filter never
 * opens on a frame it hides. Edits made under a filter still keep the photo in
 * view (see shownIndices) until another is chosen.
 */
export function setFilter(change: Partial<Filter>) {
  const filter = { ...get().filter, ...change };
  set({ filter, filterExcludedActive: null });
  const { photos, active } = get();
  const current = photos[active];
  if (!current || !passes(current, filter)) {
    const first = sourceIndices().find(i => passes(photos[i], filter));
    if (first !== undefined) setActive(first);
    else set({ filterExcludedActive: current ? photoId(current) : null });
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

/** File the library selection, or the current Develop frame, without changing the source. */
export function addToTargetCollection() {
  const s = get();
  if (s.lookEdit) return;
  const collection = targetCollection();
  if (!collection) return showToast('Open a collection and choose Set as target collection first');
  const photo = activePhoto(s);
  const photos = s.view === 'library' && !isLibraryLoupe(s) ? sourcePhotos(s).filter(p => s.selected.has(photoId(p))) : photo ? [photo] : [];
  if (!photos.length) return;
  addToCollection(collection.id, photos.map(photoId));
  showToast(`Added ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'} to ${collection.name}`);
}

/** Photos an edit should apply to: the selection when several are selected, otherwise the active photo. */
export function targets(s: State = get()): Photo[] {
  if (isLibraryLoupe(s)) { const a = shown(s).includes(s.active) ? activePhoto(s) : null; return a ? [a] : []; }
  if (s.selected.size > 1) return s.photos.filter((p) => s.selected.has(photoId(p)));
  const a = activePhoto(s);
  return a ? [a] : [];
}

/** Change recipes and save their sidecars. */
const history = new History();

const historyState = () => ({ history: { undo: history.undoLabel, redo: history.redoLabel } });

/** Tool drafts share Undo/Redo with photo edits without writing a sidecar. */
export function recordTransientEdit(label: string, transient: NonNullable<Step['transient']>) {
  history.recordTransient(label, transient);
  set(historyState());
}

export function discardTransientEdits(scope: string) {
  if (history.discardTransient(scope)) set(historyState());
}

/**
 * Persist one complete source family, so edits to two copies cannot overwrite each other.
 * `checkpoint` keeps the edits being replaced in catalog history (edit_store.rs).
 */
function persistSources(ids: string[], checkpoint = false) {
  const paths = new Set(ids.map(id => id.split('\0')[0]));
  for (const path of paths) {
    const editing = get().lookEdit;
    const family = [...get().photos, ...get().hidden].filter(p => p.path === path)
      .map(p => editing?.path === photoId(p) ? { ...p, recipe: editing.original } : p);
    if (!family.some(p => !p.copyId)) continue;
    savePhoto({ path, ...savedFrames(family) }, checkpoint);
    // Import management must retain versions created or removed since the last scan.
    const listed = get().candidates.filter(p => p.path === path);
    if (!listed.length) continue;
    // The same frames with new settings (every frame of a slider drag) wait for the edits to
    // settle: a second store update per frame re-ran everything that reads the import list.
    if (listed.length === family.length && listed.every((p, i) => photoId(p) === photoId(family[i]))) {
      staleCandidates.add(path);
      clearTimeout(candidatesTimer);
      candidatesTimer = setTimeout(flushCandidates, CANDIDATES_SETTLE_MS);
      continue;
    }
    staleCandidates.delete(path);
    set({ candidates: withFamilies(get().candidates, new Map([[path, family]])) });
  }
}

/** Sources whose frames in the import list have older settings than the open photos. */
const staleCandidates = new Set<string>();
let candidatesTimer: ReturnType<typeof setTimeout> | undefined;
const CANDIDATES_SETTLE_MS = 250;
/** Each listed source's frames replaced by its family, in the source's place. */
function withFamilies(candidates: Photo[], families: Map<string, Photo[]>) {
  const inserted = new Set<string>();
  return candidates.flatMap(p => {
    const family = families.get(p.path);
    if (!family) return [p];
    if (inserted.has(p.path)) return [];
    inserted.add(p.path);
    return family;
  });
}
/** Bring the import list up to date with edits that were waiting (before anything reads its photos). */
export function flushCandidates() {
  clearTimeout(candidatesTimer);
  candidatesTimer = undefined;
  if (!staleCandidates.size) return;
  const paths = new Set(staleCandidates);
  staleCandidates.clear();
  const editing = get().lookEdit;
  const families = new Map<string, Photo[]>();
  for (const p of [...get().photos, ...get().hidden]) {
    if (!paths.has(p.path)) continue;
    families.set(p.path, [...(families.get(p.path) ?? []), editing?.path === photoId(p) ? { ...p, recipe: editing.original } : p]);
  }
  // A folder opened since then lists its own photos; a family without its source isn't saved either.
  for (const [path, family] of families) if (!family.some(p => !p.copyId)) families.delete(path);
  const candidates = get().candidates;
  if (candidates.some(p => families.has(p.path))) set({ candidates: withFamilies(candidates, families) });
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

/** Restore a complete pre-migration alternative, retaining normal undo and checkpoint history. */
export function restoreRecoveredFamily(path: string, saved: Saved) {
  if (get().lookEdit) return showToast('Finish editing the look first');
  finishCrop(true);
  const before = familyOf(path);
  const source = before.find(p => !p.copyId);
  if (!source) return;
  const original: Photo = { ...source, recipe: normalizeRecipe(saved.recipe),
    ...normalizeMarks(saved.rating, saved.label, saved.flag), meta: normalizeMeta(saved.meta) };
  const after = expandCopies(original, saved.copies);
  history.record('Restore recovered edits and versions', [{ path, frames: true, before, after }], performance.now());
  replaceFamilies(new Map([[path, after]]));
  set(historyState());
  persistSources([path], true);
  showToast('Restored recovered edits and versions', { label: 'Undo', run: undo });
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
export function removeVirtualCopies(frames = targets()) {
  if (get().lookEdit) return showToast('Finish editing the look first');
  finishCrop(true);
  const copies = frames.filter(p => p.copyId);
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
  persistSources([...families.keys()], true);
  showToast(copies.length === 1 ? 'Removed virtual copy' : `Removed ${copies.length} virtual copies`, { label: 'Undo', run: undo });
}

/**
 * What Remove from Library and Delete from Disk act on: the source files of the targeted
 * originals (with the JPEG folded into a RAW, as the frame shows them as one), and the targeted
 * virtual copies of originals that aren't targeted, which are only removed as copies.
 */
export function removalTargets(s: State = get()): { sources: string[]; frames: number; pairs: number; copies: Photo[] } {
  const frames = targets(s);
  const originals = frames.filter(p => !p.copyId);
  const owned = new Set(originals.map(p => p.path));
  const pairs = originals.flatMap(p => p.pair && !owned.has(p.pair) ? [p.pair] : []);
  return { sources: [...owned, ...new Set(pairs)], frames: originals.length, pairs: new Set(pairs).size, copies: frames.filter(p => p.copyId && !owned.has(p.path)) };
}

/**
 * Take source files out of the library: folder memberships, the catalog's folders, import
 * sessions and manual collections, and the photos shown. Sidecars and files are left alone.
 * The photo after the active one becomes active, as in Lightroom.
 */
function forgetSources(removed: Set<string>, gone = false) {
  for (const importedRoot of importedRoots()) {
    const choice = folderMembership(importedRoot);
    if (choice?.mode === 'selected') saveFolderImport(importedRoot, { ...choice, paths: choice.paths.filter(path => !removed.has(path)) });
  }
  useCatalog.setState(c => ({ folders: Object.fromEntries(Object.entries(c.folders).map(([path, entries]) => [path, entries.filter(p => !removed.has(p.path))])),
    imports: c.imports.map(i => ({ ...i, photoIds: i.photoIds.filter(id => !removed.has(id.split('\0')[0])) })),
    collections: c.collections.map(c => c.type === 'manual' ? { ...c, photoIds: c.photoIds.filter(id => !removed.has(id.split('\0')[0])) } : c) }));
  const s = get();
  const kept = (p: Photo) => !removed.has(p.path);
  const photos = s.photos.filter(kept);
  const ids = new Set(photos.map(photoId));
  const current = s.photos[s.active];
  let active = current && kept(current) ? photos.indexOf(current) : Math.min(s.photos.slice(0, Math.max(s.active, 0)).filter(kept).length, photos.length - 1);
  let selected = new Set([...s.selected].filter(id => ids.has(id)));
  if (selected.size && active >= 0 && !selected.has(photoId(photos[active]))) active = photos.findIndex(p => selected.has(photoId(p)));
  if (!selected.size && active >= 0) selected = new Set([photoId(photos[active])]);
  set({ photos, hidden: s.hidden.filter(kept), selected, active, anchor: active, histogram: null,
    // Files in the Trash are no longer on disk to import again; removed ones still are.
    candidates: gone ? s.candidates.filter(kept) : s.candidates,
    missingPaths: s.missingPaths && new Set([...s.missingPaths].filter(path => !removed.has(path))),
    importChoice: s.folder ? folderMembership(s.folder.root) : s.importChoice,
    pairCount: findPairs(photos.concat(s.hidden.filter(kept)).filter(p => !p.copyId)).size,
    view: photos.length ? s.view : 'library' });
}

const photoCount = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'photo' : 'photos'}`;

/** Remove from Library: saved catalog edits remain, so importing these sources again brings their edits back. */
export function removeFromLibrary(plan = removalTargets()) {
  if (get().lookEdit) return showToast('Finish editing the look first');
  finishCrop(true);
  if (plan.copies.length) removeVirtualCopies(plan.copies);
  if (!plan.sources.length) return;
  forgetSources(new Set(plan.sources));
  showToast(`Removed ${photoCount(plan.frames)} from the library. Their edits stay beside the files.`);
}

/** Delete from Disk: move the files and their sidecars to the Trash (src-tauri/src/trash.rs), then out of the library. */
export async function deleteFromDisk(plan = removalTargets()) {
  if (get().lookEdit) { showToast('Finish editing the look first'); return; }
  finishCrop(true);
  // A pending edit written after the move would leave a new sidecar beside nothing.
  await flushSaves();
  if (plan.copies.length) removeVirtualCopies(plan.copies);
  if (!plan.sources.length) return;
  const results = await trashPhotos(plan.sources);
  const moved = new Set(results.filter(r => !r.error).map(r => r.path));
  const failed = results.filter(r => r.error);
  if (moved.size) forgetSources(moved, true);
  const frames = plan.sources.length - plan.pairs;
  if (!failed.length) showToast(`Moved ${photoCount(frames)} to the Trash`, undefined, 4200);
  else showToast(`Could not move ${failed.length === 1 ? failed[0].path.split(/[\\/]/).pop() : photoCount(failed.length)} to the Trash. ${failed[0].error}`, undefined, 6000);
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
export function editRecipes(paths: string[], change: (r: Recipe | null, p: Photo) => Recipe | null, label?: string, grouping?: { key: string; continuous: boolean }, options: { checkpoint?: boolean } = {}) {
  // While a look is being edited, edits change only its draft on that photo.
  const editing = get().lookEdit;
  if (editing) {
    if (!paths.includes(editing.path)) return;
    const current = get().photos.find(p => photoId(p) === editing.path)!;
    const after = change(current.recipe, current);
    if (after === current.recipe) return;
    // Merged as History.record merges: same key, and continuous or within MERGE_MS of the last.
    const now = performance.now();
    const key = grouping?.key ?? `${label ?? describe(current.recipe, after)}|${editing.path}`;
    const merge = !!editing.last && editing.last.key === key && (!!grouping?.continuous || now - editing.last.at < MERGE_MS);
    const past = merge ? editing.past : [...editing.past.slice(-199), current.recipe];
    set({ lookEdit: { ...editing, past, future: [], last: { key, at: now } }, photos: get().photos.map((p) => (photoId(p) === editing.path ? { ...p, recipe: after } : p)) });
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
  // Resets and edits of several photos at once are kept in the sidecars' history.
  persistSources(changes.map(c => c.path), options.checkpoint || changes.length > 1 || changes.some(c => c.after === null));
}

export const editActive = (change: (r: Recipe | null, p: Photo) => Recipe | null, label?: string, grouping?: { key: string; continuous: boolean }) => {
  const a = activePhoto();
  if (a) editRecipes([photoId(a)], change, label, grouping);
};

/**
 * Star, tag or flag the selected frames (or the active one), as one undoable step.
 * A tag every target already has comes off; otherwise they all get it. With `advance`
 * and a single photo marked, the next shown photo becomes active (Lightroom's Auto Advance).
 */
export function markPhotos(mark: MarkKey, advance = false) {
  const t = targets();
  if (!t.length) return;
  const allHave = t.every((p) => hasMark(p, mark));
  const wanted = new Set(t.map(photoId));
  const changes: Change[] = [];
  const photos = get().photos.map((p) => {
    if (!wanted.has(photoId(p))) return p;
    const before: Marks = { rating: p.rating, label: p.label, flag: p.flag };
    const after = applyMark(before, mark, allHave);
    if (sameMarks(after, before)) return p;
    const next = { ...p, ...after };
    changes.push({ path: photoId(p), marks: true, before, after });
    return next;
  });
  if (changes.length) {
    const name = 'label' in mark && allHave ? 'Remove tag' : describeMark(mark);
    history.record(changes.length > 1 ? `${name} on ${changes.length} photos` : name, changes, performance.now());
    set({ photos, ...historyState() });
    persistSources(changes.map(c => c.path));
  }
  if (advance && t.length === 1) step(1);
}

/**
 * Change the keywords and IPTC fields of the selected frames' sources (or the active one's), as one
 * undoable step. `key` merges quick successive edits of one field (typing) into one step. `only`
 * names other sources to change instead (the Keyword List renaming a keyword in all of them).
 */
export function editMeta(change: (m: PhotoMeta) => PhotoMeta, label: string, key?: string, only?: string[]) {
  const sources = only ?? [...new Set(targets().map(p => p.path))];
  if (!sources.length) return;
  const changes: Change[] = [];
  const after = new Map<string, PhotoMeta>();
  for (const path of sources) {
    const before = familyOf(path).find(p => !p.copyId)?.meta ?? normalizeMeta(null);
    const next = normalizeMeta(change(before));
    if (sameMeta(before, next)) continue;
    after.set(path, next);
    changes.push({ path, meta: true, before, after: next });
  }
  if (!changes.length) return;
  const name = changes.length > 1 ? `${label} on ${changes.length} photos` : label;
  history.record(name, changes, performance.now(), key ? `${key}|${sources.join('|')}` : undefined);
  setSourceMeta(after);
  set(historyState());
  persistSources([...after.keys()]);
}

/** A photo's marks with what its XMP says over them, as a scan takes a newer XMP (library.rs). */
export function marksFromFile(p: Marks, found: EmbeddedMetadata): Marks {
  // A reject (Rating -1) carries no stars, so the photo's stay; a pick has no XMP field and
  // stays unless the file rejects the photo.
  if (found.reject) return normalizeMarks(p.rating, found.label, 'reject');
  return normalizeMarks(found.rating, found.label, p.flag === 'reject' ? null : p.flag);
}

/**
 * Library › Read Metadata from Files, as Lightroom's: the stars, colour label, reject, keywords
 * and IPTC fields of the selected photos' files (or the active one's) replace Emulsion's, as one
 * undoable step. A scan only takes an XMP that changed after Emulsion's last save; this takes it
 * whoever saved last. Virtual copies keep their own marks and share the source's metadata.
 */
export async function readMetadataFromFiles() {
  if (!isTauri()) return;
  const sources = [...new Set(targets().map(p => p.path))];
  if (!sources.length) return;
  let found: (EmbeddedMetadata | null)[];
  try {
    found = await metadataFromFiles(sources);
  } catch (e) {
    showToast(`Could not read metadata from files: ${e}`);
    return;
  }
  const byPath = new Map(sources.flatMap((path, i) => found[i] ? [[path, found[i]!] as const] : []));
  const files = (n: number) => `${n} ${n === 1 ? 'photo' : 'photos'}`;
  if (!byPath.size) {
    showToast(sources.length === 1 ? 'This photo’s files have no metadata to read' : 'These photos’ files have no metadata to read');
    return;
  }
  const changes: Change[] = [];
  const metas = new Map<string, PhotoMeta>();
  for (const [path, v] of byPath) {
    const before = familyOf(path).find(p => !p.copyId)?.meta ?? normalizeMeta(null);
    const after = normalizeMeta(v.meta);
    if (sameMeta(before, after)) continue;
    metas.set(path, after);
    changes.push({ path, meta: true, before, after });
  }
  const photos = get().photos.map(p => {
    const v = byPath.get(p.path);
    if (!v || p.copyId) return p;
    const before: Marks = { rating: p.rating, label: p.label, flag: p.flag };
    const after = marksFromFile(before, v);
    if (sameMarks(after, before)) return p;
    changes.push({ path: photoId(p), marks: true, before, after });
    return { ...p, ...after };
  });
  const changed = new Set(changes.map(c => c.path.split('\0')[0]));
  if (!changed.size) {
    showToast(`Already up to date with the files of ${files(byPath.size)}`);
    return;
  }
  history.record(`Read metadata from files on ${files(changed.size)}`, changes, performance.now());
  set({ photos });
  if (metas.size) setSourceMeta(metas);
  set(historyState());
  persistSources([...changed]);
  showToast(`Read metadata from files: ${files(changed.size)} updated`);
}

/** Give every frame of each source its metadata. */
function setSourceMeta(bySource: Map<string, PhotoMeta>) {
  const update = (photos: Photo[]) => photos.map(p => bySource.has(p.path) ? { ...p, meta: bySource.get(p.path)! } : p);
  set({ photos: update(get().photos), hidden: update(get().hidden), candidates: update(get().candidates) });
}

/** Put recipes and marks back as a history step recorded them, without recording a new step. */
function applyStep(step: Step, side: 'before' | 'after', verb: string) {
  if (step.transient) {
    step.transient[side]();
    set(historyState());
    showToast(`${verb} ${step.label}`);
    return;
  }
  const families = new Map<string, Photo[]>();
  for (const c of step.changes) if (c.frames) families.set(c.path, c[side]);
  if (families.size) {
    const present = new Set(get().photos.map(photoId));
    const restored = [...families.values()].flat().filter(p => p.copyId && !present.has(photoId(p))).map(photoId);
    replaceFamilies(families, restored.length ? restored : undefined);
  }
  const metas = new Map(step.changes.flatMap(c => c.meta ? [[c.path, c[side]] as const] : []));
  if (metas.size) setSourceMeta(metas);
  const byPath = new Map(step.changes.filter(c => !c.frames && !c.meta).map(c => [c.path, c]));
  const photos = get().photos.map((p) => {
    const c = byPath.get(photoId(p));
    if (!c || c.frames || c.meta) return p;
    return c.marks ? { ...p, ...c[side] } : { ...p, recipe: c[side] };
  });
  set({ photos, ...historyState() });
  persistSources(step.changes.map(c => c.path), step.changes.length > 1);
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

export function openCopySettings() {
  if (get().lookEdit || get().exportOpen || get().copySettingsSource || get().choosingImport) return;
  const photo = activePhoto();
  if (!photo) return;
  const crop = get().cropEdit;
  const recipe = crop?.path === photoId(photo)
    ? { ...(photo.recipe ?? defaultRecipe()), crop: isFull(crop.draft) ? null : crop.draft }
    : photo.recipe ?? defaultRecipe();
  set({ copySettingsSource: { name: photo.copyName ? `${photo.name} · ${photo.copyName}` : photo.name, recipe: structuredClone(captureLook(recipe)) } });
}

export const closeCopySettings = () => set({ copySettingsSource: null });

export function copySettings(groups: readonly CopyGroup[] = DEFAULT_COPY_GROUPS) {
  if (get().lookEdit || get().exportOpen) return;
  const source = get().copySettingsSource ?? activePhoto();
  if (!source) return;
  const chosen = normalizeCopyGroups(groups);
  if (!chosen.length) return;
  set({ clipboard: { recipe: structuredClone(captureLook(source.recipe ?? defaultRecipe())), groups: chosen }, copySettingsSource: null });
  showToast(`Copied ${source.name}'s settings`);
}

export function pasteSettings() {
  if (get().lookEdit || get().exportOpen || get().copySettingsSource) return;
  const clip = get().clipboard;
  if (!clip) {
    showToast('Copy a frame\'s settings first');
    return;
  }
  const t = targets();
  if (!t.length) return;
  editRecipes(t.map(photoId), (r) => applyCopiedSettings(clip, r), t.length === 1 ? 'Paste settings' : `Paste settings to ${t.length} photos`, undefined, { checkpoint: true });
  const crop = get().cropEdit;
  if (crop && clip.groups.includes('Crop') && t.some(p => photoId(p) === crop.path)) {
    set({ cropEdit: { ...crop, draft: structuredClone(clip.recipe.crop ?? FULL) } });
  }
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

/**
 * Read RAW white points in the background, in batches, so thumbnails match the develop view.
 * Only RAWs not read before: LibRaw opens each file, ~10 s for 1,800 RAWs on an external drive.
 */
async function loadWhitePoints(root: string, frames: Photo[]) {
  const BATCH = 64;
  const paths = [...new Set(frames.filter(p => p.raw && !p.read?.white).map(p => p.path))];
  let found = new Map<string, Xy | null>();
  const flush = () => {
    const byPath = found;
    found = new Map();
    if (!byPath.size || get().folder?.root !== root) return;
    updateOpenPhotos(p => {
      if (!byPath.has(p.path) || p.read?.white) return p;
      const w = byPath.get(p.path)!;
      return { ...p, white: w && !sameWhite(p.white, w) ? w : p.white, read: { ...p.read, white: true } };
    });
  };
  for (let i = 0; i < paths.length; i += BATCH) {
    const chunk = paths.slice(i, i + BATCH);
    let whites: (Xy | null)[];
    try {
      whites = await whitePoints(chunk);
    } catch {
      break;
    }
    if (get().folder?.root !== root) return;
    chunk.forEach((p, k) => found.set(p, whites[k] ?? null));
    if (found.size >= FLUSH_EVERY) flush();
  }
  flush();
}

/**
 * Take the stars, label, keywords and IPTC fields embedded in photos that have none of their own
 * (in-camera ratings, files from other apps), in the background. Nothing is saved until the photo
 * is next edited or marked, which also writes them to its XMP sidecar.
 */
async function loadEmbedded(root: string, frames: Photo[]) {
  if (!isTauri()) return;
  const BATCH = 32;
  const bare = (p: Photo) => !p.copyId && p.rating === 0 && p.label === null && isEmptyMeta(p.meta);
  // Files read before (same size and modified time) reuse what was found, without reading them again.
  const known = new Map<string, EmbeddedMetadata | null>();
  for (const p of frames) if (bare(p) && p.read && p.read.embedded !== undefined) known.set(p.path, p.read.embedded);
  const paths = [...new Set(frames.filter(p => bare(p) && !known.has(p.path)).map(p => p.path))];
  let pending = known;
  const flush = () => {
    const byPath = pending;
    pending = new Map();
    if (!byPath.size || get().folder?.root !== root) return;
    updateOpenPhotos(p => {
      if (!byPath.has(p.path)) return p;
      const e = byPath.get(p.path)!;
      const read = p.read?.embedded === e ? p.read : { ...p.read, embedded: e };
      // A frame marked while this was read keeps its own.
      if (!e || (!p.copyId && !bare(p)) || (p.copyId && !isEmptyMeta(p.meta))) return read === p.read ? p : { ...p, read };
      const meta = normalizeMeta(e.meta);
      return p.copyId ? { ...p, meta, read } : { ...p, ...normalizeMarks(e.rating, e.label, e.reject ? 'reject' : p.flag), meta, read };
    });
  };
  if (pending.size >= FLUSH_EVERY) flush();
  for (let i = 0; i < paths.length; i += BATCH) {
    const chunk = paths.slice(i, i + BATCH);
    let found: Awaited<ReturnType<typeof embeddedMetadata>>;
    try {
      found = await embeddedMetadata(chunk);
    } catch {
      break;
    }
    if (get().folder?.root !== root) return;
    chunk.forEach((p, k) => pending.set(p, found[k] ?? null));
    if (pending.size >= FLUSH_EVERY) flush();
  }
  flush();
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
    lookEdit: { id, name, path, original: p.recipe, past: [], future: [], start: { name, draft } }, picking: false, compare: false,
    photos: get().photos.map((x) => (photoId(x) === path ? { ...x, recipe: draft } : x)),
  });
}

/** Rename the look being edited. */
export function renameLookEdit(name: string) {
  const e = get().lookEdit;
  if (e) set({ lookEdit: { ...e, name } });
}

/** Whether the look draft differs from where its editing started (its name or its settings). */
export function lookEditDirty(s: Pick<State, 'lookEdit' | 'photos'>): boolean {
  const e = s.lookEdit;
  if (!e) return false;
  const draft = s.photos.find((x) => photoId(x) === e.path)?.recipe ?? null;
  // Preview exposure is not saved with the look, so it alone leaves nothing unsaved.
  const look = (r: Recipe | null) => JSON.stringify(r && { ...r, exposure: 0 });
  return e.name !== e.start.name || look(draft) !== look(e.start.draft);
}

/** Stop editing a look: the photo gets its saved recipe back. Returns the draft it had. */
export function endLookEdit(): Recipe | null {
  const e = get().lookEdit;
  if (!e) return null;
  const draft = get().photos.find((x) => photoId(x) === e.path)?.recipe ?? null;
  const photos = get().photos.map((x) => (photoId(x) === e.path ? { ...x, recipe: e.original } : x)).filter(x => photoId(x) !== e.guest);
  // On a test photo from elsewhere, go back to the photo editing started on.
  const back = e.guest === e.path ? photos.findIndex(x => photoId(x) === e.home) : -1;
  set({ lookEdit: null, photos, ...(e.guest ? reselect(photos, back >= 0 ? back : Math.min(get().active, photos.length - 1)) : {}) });
  return draft;
}

const reselect = (photos: Photo[], index: number) => ({ active: index, anchor: index, selected: index >= 0 ? new Set([photoId(photos[index])]) : new Set<string>() });

/**
 * Show the look draft on `target` instead (a test photo clicked in the Look Creator): that photo
 * gets the draft and the one it leaves gets its saved recipe back. The draft is as shot, so it and
 * its undo history move unchanged. A photo outside the open ones joins them until the draft
 * leaves it or editing ends.
 */
export function moveLookEdit(target: Photo) {
  const s = get();
  const e = s.lookEdit;
  const id = photoId(target);
  if (!e || e.matching || id === e.path) return;
  const draft = s.photos.find(p => photoId(p) === e.path)?.recipe ?? null;
  let photos = s.photos.map(p => photoId(p) === e.path ? { ...p, recipe: e.original } : p);
  if (e.guest) photos = photos.filter(p => photoId(p) !== e.guest);
  let index = photos.findIndex(p => photoId(p) === id);
  const guest = index < 0 ? id : undefined;
  if (index < 0) { photos = [...photos, target]; index = photos.length - 1; }
  const on = photos[index];
  const original = on.recipe;
  // Preview exposure belongs to the photo it was set on: the next photo starts as shot.
  const shot = <R extends Recipe | null>(r: R): R => (r && r.exposure ? { ...r, exposure: 0 } : r);
  photos[index] = { ...on, recipe: shot(draft) };
  set({ lookEdit: { ...e, path: id, original, home: e.home ?? e.path, guest, last: undefined, past: e.past.map(shot), future: e.future.map(shot) }, photos, ...reselect(photos, index) });
}

function lookDraftHistory(side: 'past' | 'future') {
  const e = get().lookEdit;
  if (!e || !e[side].length) return;
  const p = get().photos.find(p => photoId(p) === e.path)!;
  const other = side === 'past' ? 'future' : 'past';
  const recipe = e[side][e[side].length - 1];
  set({ lookEdit: { ...e, [side]: e[side].slice(0, -1), [other]: [...e[other], p.recipe], last: undefined }, photos: get().photos.map(p => photoId(p) === e.path ? { ...p, recipe } : p) });
}
