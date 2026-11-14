// SPDX-License-Identifier: GPL-3.0-or-later
// Where the library catalog is kept. In the app: `library.db` in the data folder, through Rust
// (src-tauri/src/catalog.rs). Outside it (tests, the probe): localStorage, as before.
//
// `loadCatalogDb` runs before the app is imported (main.tsx), so the catalog and folder stores read
// it synchronously. The first time, it moves what the webview kept (the folder index and import
// choices in localStorage, imports and collections in settings.json) into the database.
//
// Saving sends only what changed: rows are compared with what was last written, by reference first
// and then by their JSON, so an edit to one photo writes one row. Writes go out in order, one
// transaction each.
import { Channel, invoke } from '@tauri-apps/api/core';
import { isTauri } from '../backend/api';
import { getSetting, setSetting } from './appsettings';
import { saveFailed, saveRecovered } from './saveissues';

export interface StoredCatalog {
  folders: Record<string, unknown[]>;
  folderImports: Record<string, unknown>;
  kv: Record<string, unknown>;
}
interface Row { root: string; path: string; copy: string; pos: number; /** JSON text */ data: string }
interface Key { root: string; path: string; copy: string }
export interface CatalogChange {
  rootsAdded?: string[];
  rootsRemoved?: string[];
  upserts?: Row[];
  deletes?: Key[];
  folderImports?: Record<string, unknown | null>;
  kv?: Record<string, unknown | null>;
}
type PhotoLike = { path: string; copyId?: string | null; pair?: unknown };

/** The webview's old keys, moved into the database once. */
export const LEGACY = { catalog: 'emulsion.libraryCatalog', index: 'emulsion.libraryIndex', imports: 'emulsion.folderImports' } as const;
const MIGRATED = 'migratedFromWebview';

let stored: StoredCatalog | null = null;
let writing: Promise<void> | null = null;
const pending: CatalogChange[] = [];
let frozen = false;

/** True when the catalog lives in library.db (in the app). */
export const usesDatabase = () => isTauri();
/** What `loadCatalogDb` read, or null outside the app. */
export const storedCatalog = () => stored;

const parse = (text: string | null): unknown => { try { return text ? JSON.parse(text) : undefined; } catch { return undefined; } };
const local = (key: string) => { try { return parse(localStorage.getItem(key)); } catch { return undefined; } };
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

const keyOf = (root: string, p: PhotoLike): Key => ({ root, path: p.path, copy: p.copyId ?? '' });
const stripPair = (p: PhotoLike) => p.pair ? { ...p, pair: null } : p;

/** The database's contents built from what the webview kept before. */
export function legacyChange(catalog: unknown, index: unknown, imports: unknown): CatalogChange {
  const c = record(catalog);
  const folders = record(index);
  const roots = new Set([...Object.keys(folders), ...(Array.isArray(c.roots) ? c.roots.filter((r): r is string => typeof r === 'string') : [])]);
  const upserts: Row[] = [];
  for (const [root, photos] of Object.entries(folders)) {
    if (!Array.isArray(photos)) continue;
    photos.filter((p): p is PhotoLike => !!p && typeof (p as PhotoLike).path === 'string')
      .forEach((p, pos) => upserts.push({ ...keyOf(root, p), pos, data: JSON.stringify(stripPair(p)) }));
  }
  return {
    rootsAdded: [...roots],
    upserts,
    folderImports: Object.fromEntries(Object.entries(record(imports)).filter(([, v]) => v && typeof v === 'object')),
    kv: {
      imports: Array.isArray(c.imports) ? c.imports : [],
      collections: Array.isArray(c.collections) ? c.collections : [],
      targetCollectionId: typeof c.targetCollectionId === 'string' ? c.targetCollectionId : null,
      [MIGRATED]: true,
    },
  };
}

/** Read library.db, first moving the webview's catalog into it if that hasn't happened yet. */
export async function loadCatalogDb(progress?: (counts: [number, number]) => void) {
  if (!usesDatabase()) return;
  try {
    stored = await readDatabase(progress);
  } catch (e) {
    // Show an empty library rather than nothing, but never write it over the real catalog.
    frozen = true;
    throw e;
  }
}

async function readDatabase(progress?: (counts: [number, number]) => void): Promise<StoredCatalog> {
  const load = () => invoke<StoredCatalog>('catalog_load', progress ? { onProgress: new Channel(progress) } : undefined);
  let db = await load();
  if (!db.kv[MIGRATED]) {
    const change = legacyChange(getSetting(LEGACY.catalog) ?? local(LEGACY.catalog), local(LEGACY.index), local(LEGACY.imports));
    await invoke('catalog_write', { change });
    db = await load();
    // Only once the database holds them: the index was what filled localStorage's quota.
    try { for (const key of Object.values(LEGACY)) localStorage.removeItem(key); } catch { /* left behind, unused */ }
    setSetting(LEGACY.catalog, undefined);
  }
  return db;
}

// Diffs may advance their in-memory baseline as soon as queued: keep every delta until
// its transaction succeeds, then replay failures in order before any later delta.
function drain(): Promise<void> {
  if (writing) return writing;
  const work = async () => {
    while (pending.length) {
      await invoke<void>('catalog_write', { change: pending[0] });
      pending.shift();
    }
    saveRecovered('catalog');
  };
  writing = work().then(() => { writing = null; if (pending.length) return drain(); }, e => {
    writing = null; saveFailed('catalog', `Could not save the library catalog. ${String(e)}`); throw e;
  });
  void writing.catch(() => {});
  return writing;
}
function send(change: CatalogChange) {
  if (frozen) return Promise.resolve();
  pending.push(change);
  return drain();
}

export const writeFolderImport = (root: string, value: unknown | null) => send({ folderImports: { [root]: value } });
export const catalogWrites = () => drain();
export async function freezeCatalogDb() {
  await catalogWrites();
  frozen = true;
}

/**
 * Tracks what the database holds so a save can send only the difference. `seed` with the catalog
 * as loaded; `diff` returns the change from the last seed or diff to `folders` and `kv`, and
 * remembers the new state.
 */
export class CatalogDiff {
  /** Each root's rows, and the array they were read from: a root whose array is the same object is skipped. */
  private roots = new Map<string, { photos: PhotoLike[]; rows: Map<string, { key: Key; ref: object; json: string; pos: number }> }>();
  private kv = new Map<string, unknown>();

  seed(folders: Record<string, PhotoLike[]>, kv: Record<string, unknown>) {
    this.roots.clear();
    for (const [root, photos] of Object.entries(folders)) {
      const rows = new Map<string, { key: Key; ref: object; json: string; pos: number }>();
      photos.forEach((p, pos) => {
        const key = keyOf(root, p);
        rows.set(rowId(key), { key, ref: p, json: JSON.stringify(stripPair(p)), pos });
      });
      this.roots.set(root, { photos, rows });
    }
    this.kv = new Map(Object.entries(kv));
  }

  /**
   * The catalog is the whole library and an edit changes one photo in the few roots that hold it
   * (catalog.ts keeps the other roots' arrays), so only roots with a new array are compared:
   * comparing every row took 30 ms per save with 80,000 of them.
   */
  diff(folders: Record<string, PhotoLike[]>, kv: Record<string, unknown>): CatalogChange | null {
    const change: Required<Pick<CatalogChange, 'rootsAdded' | 'rootsRemoved' | 'upserts' | 'deletes'>> & { kv: Record<string, unknown> } =
      { rootsAdded: [], rootsRemoved: [], upserts: [], deletes: [], kv: {} };
    for (const root of Object.keys(folders)) if (!this.roots.has(root)) change.rootsAdded.push(root);
    for (const root of [...this.roots.keys()]) if (!Object.prototype.hasOwnProperty.call(folders, root)) { change.rootsRemoved.push(root); this.roots.delete(root); }
    for (const [root, photos] of Object.entries(folders)) {
      const before = this.roots.get(root);
      if (before?.photos === photos) continue;
      const next = new Map<string, { key: Key; ref: object; json: string; pos: number }>();
      photos.forEach((p, pos) => {
        const key = keyOf(root, p);
        const id = rowId(key);
        const was = before?.rows.get(id);
        if (next.has(id)) return; // listed twice in one folder: the first wins, as on load
        if (was && was.ref === p && was.pos === pos) { next.set(id, was); return; }
        const json = was?.ref === p ? was.json : JSON.stringify(stripPair(p));
        next.set(id, { key, ref: p, json, pos });
        if (!was || was.json !== json || was.pos !== pos) change.upserts.push({ ...key, pos, data: json });
      });
      if (before) for (const [id, was] of before.rows) if (!next.has(id)) change.deletes.push(was.key);
      this.roots.set(root, { photos, rows: next });
    }
    for (const [k, v] of Object.entries(kv)) if (this.kv.get(k) !== v) change.kv[k] = v;
    this.kv = new Map(Object.entries(kv));
    const empty = !change.rootsAdded.length && !change.rootsRemoved.length && !change.upserts.length && !change.deletes.length && !Object.keys(change.kv).length;
    return empty ? null : change;
  }
}
const rowId = (k: Key) => `${k.root}\0${k.path}\0${k.copy}`;

/** Send a change made by `CatalogDiff`. */
export const writeCatalogChange = (change: CatalogChange) => send(change);
