// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, test, vi } from 'vitest';

const calls: { cmd: string; args: any }[] = [];
let db: { folders: Record<string, unknown[]>; folderImports: Record<string, unknown>; kv: Record<string, unknown> };
let failLoad = false;
vi.mock('../backend/api', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: any) => {
    calls.push({ cmd, args });
    if (cmd === 'catalog_load') {
      if (failLoad) throw new Error('This catalog was made by a newer Emulsion');
      return structuredClone(db);
    }
    if (cmd === 'catalog_write') {
      const c = args.change;
      for (const r of c.rootsAdded ?? []) db.folders[r] ??= [];
      for (const r of c.upserts ?? []) (db.folders[r.root] ??= []).push(JSON.parse(r.data));
      for (const [k, v] of Object.entries(c.folderImports ?? {})) db.folderImports[k] = v;
      for (const [k, v] of Object.entries(c.kv ?? {})) db.kv[k] = v;
    }
    return undefined;
  },
}));

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
});

beforeEach(() => {
  calls.length = 0;
  storage.clear();
  db = { folders: {}, folderImports: {}, kv: {} };
  failLoad = false;
  vi.resetModules();
});

const photo = (path: string, extra: object = {}) => ({ path, name: path.split('/').pop(), rating: 0, ...extra });

describe('legacyChange', () => {
  test('moves the index, import choices, imports and collections, in folder order', async () => {
    const { legacyChange } = await import('./catalogdb');
    const change = legacyChange(
      { imports: [{ id: 'i' }], collections: [{ id: 'c' }], targetCollectionId: 'c', roots: ['/empty'] },
      { '/a': [photo('/a/2'), photo('/a/1', { copyId: 'v1', pair: { path: '/a/1.jpg' } }), { broken: true }] },
      { '/a': { mode: 'selected', paths: ['/a/2'] }, '/bad': 'nope' },
    );
    expect(change.rootsAdded?.sort()).toEqual(['/a', '/empty']);
    expect(change.upserts?.map(r => [r.path, r.copy, r.pos])).toEqual([['/a/2', '', 0], ['/a/1', 'v1', 1]]);
    expect(JSON.parse(change.upserts![1].data).pair).toBeNull();
    expect(change.folderImports).toEqual({ '/a': { mode: 'selected', paths: ['/a/2'] } });
    expect(change.kv).toMatchObject({ imports: [{ id: 'i' }], collections: [{ id: 'c' }], targetCollectionId: 'c', migratedFromWebview: true });
  });

  test('an empty webview moves as an empty catalog', async () => {
    const { legacyChange } = await import('./catalogdb');
    expect(legacyChange(undefined, undefined, undefined)).toMatchObject({ rootsAdded: [], upserts: [], folderImports: {}, kv: { imports: [], collections: [], targetCollectionId: null } });
  });
});

describe('loadCatalogDb', () => {
  test('the first launch moves localStorage into library.db, then clears it', async () => {
    storage.set('emulsion.libraryIndex', JSON.stringify({ '/a': [photo('/a/1')] }));
    storage.set('emulsion.folderImports', JSON.stringify({ '/a': { mode: 'selected', paths: ['/a/1'] } }));
    storage.set('emulsion.libraryCatalog', JSON.stringify({ imports: [], collections: [{ id: 'c', name: 'C', type: 'manual', photoIds: [] }] }));
    storage.set('emulsion.theme', 'dark');
    const { loadCatalogDb, storedCatalog } = await import('./catalogdb');
    await loadCatalogDb();
    expect(storedCatalog()?.folders['/a']).toHaveLength(1);
    expect(storedCatalog()?.kv.collections).toHaveLength(1);
    expect([...storage.keys()]).toEqual(['emulsion.theme']);
    // Already moved: a second launch only reads.
    calls.length = 0;
    vi.resetModules();
    const again = await import('./catalogdb');
    await again.loadCatalogDb();
    expect(calls.map(c => c.cmd)).toEqual(['catalog_load']);
  });

  test('a catalog that cannot be opened is never written over', async () => {
    failLoad = true;
    const { loadCatalogDb, writeFolderImport, catalogWrites, storedCatalog } = await import('./catalogdb');
    await expect(loadCatalogDb()).rejects.toThrow('newer Emulsion');
    expect(storedCatalog()).toBeNull();
    void writeFolderImport('/a', { mode: 'selected', paths: [] });
    await catalogWrites();
    expect(calls.filter(c => c.cmd === 'catalog_write')).toEqual([]);
  });
});

describe('CatalogDiff', () => {
  const setup = async () => {
    const { CatalogDiff } = await import('./catalogdb');
    const a1 = photo('/a/1'), a2 = photo('/a/2'), b1 = photo('/b/1');
    const d = new CatalogDiff();
    const folders = { '/a': [a1, a2], '/b': [b1] };
    const kv = { imports: [], collections: [], targetCollectionId: null };
    d.seed(folders, kv);
    return { d, folders, kv, a1, a2, b1 };
  };

  test('nothing changed sends nothing, even with new objects of the same content', async () => {
    const { d, folders, kv } = await setup();
    expect(d.diff(folders, kv)).toBeNull();
    expect(d.diff({ '/a': folders['/a'].map(p => ({ ...p })), '/b': folders['/b'] }, kv)).toBeNull();
  });

  test('an edit to one photo writes one row', async () => {
    const { d, folders, kv, a1 } = await setup();
    const change = d.diff({ ...folders, '/a': [{ ...a1, rating: 5 }, folders['/a'][1]] }, kv)!;
    expect(change.upserts?.map(r => [r.root, r.path, r.pos, JSON.parse(r.data).rating])).toEqual([['/a', '/a/1', 0, 5]]);
    expect(change.deletes).toEqual([]);
  });

  test('order, removals, new folders, copies and definitions', async () => {
    const { d, kv, a1, a2, b1 } = await setup();
    const copy = { ...a1, copyId: 'v1' };
    const collections = [{ id: 'x' }] as never[];
    const change = d.diff({ '/a': [a2, a1, copy], '/c': [] }, { ...kv, collections })!;
    expect(change.upserts?.map(r => [r.path, r.copy, r.pos])).toEqual([['/a/2', '', 0], ['/a/1', '', 1], ['/a/1', 'v1', 2]]);
    expect(change.rootsAdded).toEqual(['/c']);
    expect(change.rootsRemoved).toEqual(['/b']);
    // The removed folder's rows go with it; no separate deletes.
    expect(change.deletes).toEqual([]);
    expect(Object.keys(change.kv!)).toEqual(['collections']);
    expect(d.diff({ '/a': [a2, a1, copy], '/c': [] }, { ...kv, collections })).toBeNull();
    expect(d.diff({ '/a': [a2, a1], '/c': [] }, { ...kv, collections })!.deletes).toEqual([{ root: '/a', path: '/a/1', copy: 'v1' }]);
    void b1;
  });

  test('a photo removed from a folder is deleted', async () => {
    const { d, folders, kv, a1 } = await setup();
    const change = d.diff({ ...folders, '/a': [a1] }, kv)!;
    expect(change.deletes).toEqual([{ root: '/a', path: '/a/2', copy: '' }]);
    expect(change.upserts).toEqual([]);
  });
});
