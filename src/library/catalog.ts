// SPDX-License-Identifier: GPL-3.0-or-later
/** Virtual sources reference frame identities; originals and sidecars remain in their folders. */
import { create } from 'zustand';
import type { Photo } from './store';
import { photoId } from './copies';
import { lookName } from '../film/looks';
import { normalizeRecipe } from '../film/recipe';
import { normalizeMarks, type Label } from './marks';
import type { FlagFilter } from './filter';
import { hasKeyword, normalizeMeta } from './meta';
import { getSetting, setSetting } from './appsettings';
import { CatalogDiff, catalogWrites, storedCatalog, usesDatabase, writeCatalogChange } from './catalogdb';

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
  | { field: 'edited'; value: boolean }
  | { field: 'flag'; value: FlagFilter }
  | { field: 'label'; value: Label }
  | { field: 'camera' | 'look' | 'folder' | 'keyword'; value: string }
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
// In the app the catalog is library.db (catalogdb.ts). Outside it, imports and collections are in
// the settings store and the folder index in localStorage, as before.
const KEY = 'emulsion.libraryCatalog' as const;
const INDEX_KEY = 'emulsion.libraryIndex';
const empty = (): Catalog => ({ imports: [], collections: [], folders: {}, targetCollectionId: null });
/** A rule saved before flags replaced hearts: Favourite is Picked, Not a favourite is Unflagged. */
const migrateRule = (r: SmartRule | { field: 'heart'; value: boolean }): SmartRule =>
  r.field === 'heart' ? { field: 'flag', value: r.value ? 'pick' : 'none' } : r;
export const migrateCollection = (c: Collection): Collection => (c.type === 'smart' && Array.isArray(c.rules) ? { ...c, rules: c.rules.map(migrateRule) } : c);
/** The catalog from what was saved: imports, collections and target, plus the folder index. */
function fromSaved(value: Record<string, any> | null | undefined, index: unknown): Catalog {
  if (!value || !Array.isArray(value.imports) || !Array.isArray(value.collections)) value = { imports: [], collections: [] };
  if (!index || typeof index !== 'object' || Array.isArray(index)) index = {};
  const folders = index as Record<string, Photo[]>;
  for (const root of value.roots ?? []) folders[root] ??= [];
  const targetCollectionId = value.collections.some((c: Collection) => c.id === value.targetCollectionId && c.type === 'manual') ? value.targetCollectionId : null;
  return { imports: value.imports, collections: value.collections.map(migrateCollection), targetCollectionId, folders: Object.fromEntries(Object.entries(folders).map(([root, photos]) => [root,
    (Array.isArray(photos) ? photos : []).filter(p => p && typeof p.path === 'string').map(({ heart, ...p }: Photo & { heart?: unknown }) =>
      ({ ...p, recipe: normalizeRecipe(p.recipe), ...normalizeMarks(p.rating, p.label, p.flag, heart), meta: normalizeMeta(p.meta), pair: null }))])) };
}
function read(): Catalog {
  try {
    const db = storedCatalog();
    if (db) return fromSaved(db.kv, db.folders);
    const value = getSetting(KEY) as Record<string, any> | null | undefined;
    if (!value || !Array.isArray(value.imports) || !Array.isArray(value.collections)) return empty();
    let index = value.folders;
    if (!index) {
      try { index = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '{}'); } catch { index = {}; }
    }
    return fromSaved(value, index);
  } catch { return empty(); }
}
export const useCatalog = create<Catalog>(() => read());
/**
 * Re-renders when what decides a source's photos changes (imports, collections: all
 * sourceMatcher reads), not when the folder cache does, which every edit rewrites.
 */
export function useSourceDefinitions() {
  useCatalog(s => s.imports);
  return useCatalog(s => s.collections);
}
const definitions = (s: Catalog) => ({ imports: s.imports, collections: s.collections, targetCollectionId: s.targetCollectionId });
const database = usesDatabase() ? new CatalogDiff() : null;
if (database) { const s = useCatalog.getState(); database.seed(s.folders, definitions(s)); }
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist(state: Catalog) {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (database) {
    const change = database.diff(state.folders, definitions(state));
    return change ? writeCatalogChange(change) : catalogWrites();
  }
  // Keep source definitions independent of the larger, replaceable metadata cache.
  setSetting(KEY, { ...definitions(state), roots: Object.keys(state.folders) });
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(state.folders)); } catch { /* index rebuilds from folders */ }
  return Promise.resolve();
}
useCatalog.subscribe((state, previous) => {
  if (!database && (state.imports !== previous.imports || state.collections !== previous.collections || state.targetCollectionId !== previous.targetCollectionId || Object.keys(state.folders).length !== Object.keys(previous.folders).length)) {
    setSetting(KEY, { ...definitions(state), roots: Object.keys(state.folders) });
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void persist(useCatalog.getState()), 150);
});
/** Save anything waiting now and wait for it (before quitting or backing up). */
export function flushCatalog(): Promise<void> {
  return persist(useCatalog.getState());
}
// Flush before the WebView closes, including immediately after an import.
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => {
  void persist(useCatalog.getState());
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
/**
 * The local calendar day of `time` as YYYY-MM-DD (what toLocaleDateString('en-CA') gives). Built by
 * hand: toLocaleDateString makes an Intl formatter per call, 35 ms per 2,000 photos, and a date
 * rule runs it for every photo without a capture date each time a collection's members are read.
 */
export function localDay(time: number) {
  const d = new Date(time), pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function matchesRules(photo: Photo, rules: SmartRule[]): boolean {
  return rules.every(rule => {
    switch (rule.field) {
      case 'rating': return photo.rating >= rule.value;
      case 'edited': return !!photo.recipe === rule.value;
      case 'flag': return (photo.flag ?? 'none') === rule.value;
      case 'label': return photo.label === rule.value;
      case 'keyword': return hasKeyword(photo.meta, rule.value);
      case 'camera': return (photo.capture?.camera ?? `${photo.camera?.make ?? ''} ${photo.camera?.model ?? ''}`).toLowerCase().includes(rule.value.toLowerCase());
      case 'look': {
        const r = photo.recipe;
        const name = r?.lookEnabled ? r.lookSnapshot?.name ?? lookName(r.pack, r.stock) : 'Neutral';
        return name.toLowerCase().includes(rule.value.toLowerCase());
      }
      case 'folder': return photo.path.toLowerCase().startsWith(rule.value.replace(/[\\/]$/, '').toLowerCase() + (rule.value.includes('\\') ? '\\' : '/'));
      case 'date': {
        const day = photo.capture?.date ?? localDay(photo.modified);
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
