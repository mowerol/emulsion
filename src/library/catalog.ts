// SPDX-License-Identifier: GPL-3.0-or-later
/** Virtual sources reference frame identities; originals and sidecars remain in their folders. */
import { create } from 'zustand';
import type { Photo } from './store';
import { photoId } from './copies';
import { lookName } from '../film/looks';
import { normalizeRecipe } from '../film/recipe';
import { normalizeMarks, type Label } from './marks';
import { getSetting, setSetting } from './appsettings';

export interface ImportSession {
  id: string;
  name: string;
  importedAt: number;
  sourceDevice: string;
  destinationPath: string;
  photoIds: string[];
  viewed: boolean;
}
export type SmartRule =
  | { field: 'rating'; value: number }
  | { field: 'edited' | 'heart'; value: boolean }
  | { field: 'label'; value: Label }
  | { field: 'camera' | 'look' | 'folder'; value: string }
  | { field: 'date'; value: string; before: boolean };
export type Collection = { id: string; name: string; createdAt: number } & (
  { type: 'manual'; photoIds: string[] } | { type: 'smart'; rules: SmartRule[] }
);
export type SourceSelection = { type: 'folder' | 'import' | 'collection'; id: string };
interface Catalog {
  imports: ImportSession[];
  collections: Collection[];
  folders: Record<string, Photo[]>;
  targetCollectionId: string | null;
}
// Imports and collections are the user's work: kept in the app's settings file. The folder index
// is a cache and stays in localStorage.
const KEY = 'emulsion.libraryCatalog' as const;
const INDEX_KEY = 'emulsion.libraryIndex';
const empty = (): Catalog => ({ imports: [], collections: [], folders: {}, targetCollectionId: null });
function read(): Catalog {
  try {
    const value = getSetting(KEY) as Record<string, any> | null | undefined;
    if (!value || !Array.isArray(value.imports) || !Array.isArray(value.collections)) return empty();
    let index = value.folders;
    if (!index) {
      try { index = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '{}'); } catch { index = {}; }
    }
    if (!index || typeof index !== 'object' || Array.isArray(index)) index = {};
    for (const root of value.roots ?? []) index[root] ??= [];
    const targetCollectionId = value.collections.some((c: Collection) => c.id === value.targetCollectionId && c.type === 'manual') ? value.targetCollectionId : null;
    return { imports: value.imports, collections: value.collections, targetCollectionId, folders: Object.fromEntries(Object.entries(index as Record<string, Photo[]>).map(([root, photos]) => [root,
      (Array.isArray(photos) ? photos : []).filter(p => p && typeof p.path === 'string').map(p => ({ ...p, recipe: normalizeRecipe(p.recipe), ...normalizeMarks(p.rating, p.label, p.heart), pair: null }))])) };
  } catch { return empty(); }
}
export const useCatalog = create<Catalog>(() => read());
let saveTimer: ReturnType<typeof setTimeout>;
function persist(state: Catalog) {
  // Keep source definitions independent of the larger, replaceable metadata cache.
  setSetting(KEY, { imports: state.imports, collections: state.collections, roots: Object.keys(state.folders), targetCollectionId: state.targetCollectionId });
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(state.folders)); } catch { /* index rebuilds from folders */ }
}
useCatalog.subscribe((state, previous) => {
  if (state.imports !== previous.imports || state.collections !== previous.collections || state.targetCollectionId !== previous.targetCollectionId || Object.keys(state.folders).length !== Object.keys(previous.folders).length) {
    setSetting(KEY, { imports: state.imports, collections: state.collections, roots: Object.keys(state.folders), targetCollectionId: state.targetCollectionId });
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persist(state);
  }, 150);
});
// Flush before the WebView closes, including immediately after an import.
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => {
  persist(useCatalog.getState());
});

export function catalogPhotos(catalog = useCatalog.getState()): Photo[] {
  return [...new Map(Object.values(catalog.folders).flat().map(p => [photoId(p), p])).values()];
}
export function cacheFolder(root: string, photos: Photo[]) {
  useCatalog.setState(s => ({ folders: { ...s.folders, [root]: photos.map(p => p.pair ? { ...p, pair: null } : p) } }));
}
/** Update entire source families, including added/removed virtual copies, in every cached root. */
export function cacheEdits(photos: Photo[]) {
  const families = new Map<string, Photo[]>();
  for (const p of photos) families.set(p.path, [...(families.get(p.path) ?? []), p]);
  useCatalog.setState(s => ({ folders: Object.fromEntries(Object.entries(s.folders).map(([root, old]) => {
    const inserted = new Set<string>();
    return [root, old.flatMap(p => {
      const family = families.get(p.path);
      if (!family) return [p];
      if (inserted.has(p.path)) return [];
      inserted.add(p.path);
      return family;
    })];
  })) }));
}
export function recordImport(name: string, destinationPath: string, photoIds: string[], sourceDevice = 'Local folder') {
  const session: ImportSession = { id: crypto.randomUUID(), name, importedAt: Date.now(), sourceDevice, destinationPath, photoIds: [...new Set(photoIds)], viewed: false };
  useCatalog.setState(s => ({ imports: [session, ...s.imports] }));
  return session;
}
export function viewImport(id: string) {
  useCatalog.setState(s => ({ imports: s.imports.map(i => i.id === id ? { ...i, viewed: true } : i) }));
}
export function saveCollection(collection: Collection) {
  useCatalog.setState(s => ({ collections: s.collections.some(c => c.id === collection.id)
    ? s.collections.map(c => c.id === collection.id ? collection : c) : [...s.collections, collection] }));
}
export function addToCollection(id: string, ids: string[]) {
  const c = useCatalog.getState().collections.find(c => c.id === id);
  if (c?.type === 'manual') saveCollection({ ...c, photoIds: [...new Set([...c.photoIds, ...ids])] });
}
export function targetCollection(catalog = useCatalog.getState()) {
  const collection = catalog.collections.find(c => c.id === catalog.targetCollectionId);
  return collection?.type === 'manual' ? collection : null;
}
export function setTargetCollection(id: string | null) {
  if (id !== null && !useCatalog.getState().collections.some(c => c.id === id && c.type === 'manual')) return;
  useCatalog.setState({ targetCollectionId: id });
}
export function matchesRules(photo: Photo, rules: SmartRule[]): boolean {
  return rules.every(rule => {
    switch (rule.field) {
      case 'rating': return photo.rating >= rule.value;
      case 'edited': return !!photo.recipe === rule.value;
      case 'heart': return photo.heart === rule.value;
      case 'label': return photo.label === rule.value;
      case 'camera': return (photo.capture?.camera ?? `${photo.camera?.make ?? ''} ${photo.camera?.model ?? ''}`).toLowerCase().includes(rule.value.toLowerCase());
      case 'look': {
        const r = photo.recipe;
        const name = r?.lookEnabled ? r.lookSnapshot?.name ?? lookName(r.pack, r.stock) : 'Neutral';
        return name.toLowerCase().includes(rule.value.toLowerCase());
      }
      case 'folder': return photo.path.toLowerCase().startsWith(rule.value.replace(/[\\/]$/, '').toLowerCase() + (rule.value.includes('\\') ? '\\' : '/'));
      case 'date': {
        const day = photo.capture?.date ?? new Date(photo.modified).toLocaleDateString('en-CA');
        return rule.before ? day <= rule.value : day >= rule.value;
      }
    }
  });
}
export function sourceMatcher(source: SourceSelection | null, catalog = useCatalog.getState()): (photo: Photo) => boolean {
  if (!source || source.type === 'folder') return () => true;
  const item = source.type === 'import' ? catalog.imports.find(i => i.id === source.id) : catalog.collections.find(c => c.id === source.id);
  if (!item) return () => false;
  if ('rules' in item) return photo => matchesRules(photo, item.rules);
  const ids = new Set(item.photoIds);
  return photo => ids.has(photoId(photo)) || !!photo.pair && ids.has(photo.pair);
}
export const sourceMatches = (photo: Photo, source: SourceSelection | null, catalog = useCatalog.getState()) => sourceMatcher(source, catalog)(photo);
export function sourceCount(source: SourceSelection, photos = catalogPhotos()): number {
  return photos.filter(sourceMatcher(source)).length;
}
export function importTime(time: number) {
  const date = new Date(time), today = new Date();
  return date.toDateString() === today.toDateString()
    ? `Today, ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : date.toLocaleString([], { month: 'short', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined, hour: 'numeric', minute: '2-digit' });
}
