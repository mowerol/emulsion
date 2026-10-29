// SPDX-License-Identifier: GPL-3.0-or-later
// App state: the open folder (the roll), its photos and their recipes,
// selection, and which view is showing.

import { create } from 'zustand';
import type { Histogram } from '../engine/histogram';
import type { Xy } from '../engine/whitebalance';
import { scanFolder, whitePoints } from '../backend/api';
import { normalizeRecipe, type Recipe } from '../film/recipe';
import { seedFor } from '../engine/engine';
import { saveRecipe } from './sidecars';

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
  set({ folder: null, photos: [], active: -1, selected: new Set(), view: 'welcome' });
}

export const setView = (view: View) => {
  if (view !== 'welcome' && !get().photos.length) return;
  set({ view });
};

export function setActive(index: number, mode: 'single' | 'toggle' | 'range' | 'keep' = 'single') {
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
    const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
    set({ active: index, selected: new Set(photos.slice(a, b + 1).map((p) => p.path)) });
  } else {
    set({ active: index, anchor: index, selected: new Set([path]) });
  }
}

export function step(delta: number) {
  const { active, photos } = get();
  if (!photos.length) return;
  setActive(Math.min(photos.length - 1, Math.max(0, active + delta)));
}

export function selectAll() {
  set({ selected: new Set(get().photos.map((p) => p.path)) });
}

export const activePhoto = (s: State = get()) => s.photos[s.active] ?? null;

/** Photos an edit should apply to: the selection when several are selected, otherwise the active photo. */
export function targets(s: State = get()): Photo[] {
  if (s.selected.size > 1) return s.photos.filter((p) => s.selected.has(p.path));
  const a = activePhoto(s);
  return a ? [a] : [];
}

/** Change recipes and save their sidecars. */
export function editRecipes(paths: string[], change: (r: Recipe | null, p: Photo) => Recipe | null) {
  const wanted = new Set(paths);
  const photos = get().photos.map((p) => {
    if (!wanted.has(p.path)) return p;
    const recipe = change(p.recipe, p);
    if (recipe === p.recipe) return p;
    saveRecipe(p.path, recipe);
    return { ...p, recipe };
  });
  set({ photos });
}

export const editActive = (change: (r: Recipe | null, p: Photo) => Recipe | null) => {
  const a = activePhoto();
  if (a) editRecipes([a.path], change);
};

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
  editRecipes(t.map((p) => p.path), () => ({ ...clip }));
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
