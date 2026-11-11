// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../backend/api', () => ({
  scanFolder: vi.fn(), whitePoints: vi.fn(async () => []), writeSidecar: vi.fn(async () => {}),
  thumbnail: vi.fn(), isTauri: () => false, logToTerminal: () => {},
}));
import { scanFolder, writeSidecar, type ScanResult } from '../backend/api';
import { addToCollection, cacheFolder, catalogPhotos, localDay, matchesRules, migrateCollection, saveCollection, sourceMatches, useCatalog } from './catalog';
import { closeFolder, importFolderPhotos, markPhotos, openFolder, selectAll, selectSource, setFilter, setFoldJpegs, setSelectedOnly, shown, sourceIndices, sourcePhotos, step, undo, useApp, type Photo } from './store';
import { defaultRecipe } from '../film/recipe';
import { compareFolders } from './folders';
import { NO_FILTER } from './filter';
import { photoId } from './copies';
import { flushSaves } from './sidecars';

const scan = (root: string, names: string[]): ScanResult => ({ root, name: root.split('/').pop()!, unreadable: 0, focus: null, folders: [],
  entries: names.map(name => ({ path: `${root}/${name}`, rel: name, name, size: 1, modified: 1790000000000, recipe: null, rating: 0, label: null, flag: null, raw: /\.orf$/i.test(name) })) });
const folders: Record<string, ScanResult> = {};
const manual = (id: string, ids: string[]) => saveCollection({ id, name: id, type: 'manual', photoIds: ids, createdAt: 1 });
async function importFolder(root: string, names: string[]) {
  folders[root] = scan(root, names);
  await openFolder(root);
  importFolderPhotos({ mode: 'sync' });
}
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  closeFolder();
  useCatalog.setState({ imports: [], collections: [], folders: {} });
  useApp.setState({ filter: NO_FILTER, selectedOnly: false, filterExcludedActive: null, collectionAddIds: [] });
  for (const root of Object.keys(folders)) delete folders[root];
  vi.mocked(scanFolder).mockImplementation(async root => folders[root]);
  vi.mocked(writeSidecar).mockImplementation(async (path, saved) => {
    const entry = Object.values(folders).flatMap(f => f.entries).find(p => p.path === path);
    if (entry) Object.assign(entry, saved);
  });
});

it('sorts calendar months first, then ordinary folders naturally and without case sensitivity', () => {
  const names = ['Portugal', 'December', 'january', 'October', 'April', '2025 - Main.cocatalog', 'Trip 10', 'Trip 2'];
  expect(names.map(name => ({ name })).sort(compareFolders).map(f => f.name)).toEqual(['january', 'April', 'October', 'December', '2025 - Main.cocatalog', 'Portugal', 'Trip 2', 'Trip 10']);
});

it('records fixed import sessions and opens only that session after a later import into the same folder', async () => {
  folders['/sessions'] = scan('/sessions', ['a.jpg', 'b.jpg', 'c.jpg']);
  await openFolder('/sessions');
  importFolderPhotos({ mode: 'selected', paths: ['/sessions/a.jpg'] }, 'Roll one');
  const first = useCatalog.getState().imports[0];
  expect(first).toMatchObject({ name: 'Roll one', photoIds: ['/sessions/a.jpg'], viewed: false });
  importFolderPhotos({ mode: 'sync' }, 'Roll two');
  expect(useCatalog.getState().imports[0].photoIds).toEqual(['/sessions/b.jpg', '/sessions/c.jpg']);
  await selectSource({ type: 'import', id: first.id });
  expect(sourcePhotos().map(p => p.name)).toEqual(['a.jpg']);
  expect(shown().map(i => useApp.getState().photos[i].name)).toEqual(['a.jpg']);
  expect(useCatalog.getState().imports.find(i => i.id === first.id)?.viewed).toBe(true);
});

it('reopens collections across folders, keeps selection/navigation inside the source, and saves edits to originals', async () => {
  await importFolder('/one', ['a.jpg', 'b.jpg']);
  await importFolder('/two', ['c.jpg', 'd.jpg']);
  manual('picks', ['/one/b.jpg', '/two/d.jpg']);
  await selectSource({ type: 'collection', id: 'picks' });
  expect(sourcePhotos().map(p => p.name)).toEqual(['b.jpg', 'd.jpg']);
  selectAll();
  expect([...useApp.getState().selected]).toEqual(['/one/b.jpg', '/two/d.jpg']);
  markPhotos({ rating: 4 });
  expect(sourcePhotos().every(p => p.rating === 4)).toBe(true);
  expect(catalogPhotos().find(p => p.path === '/one/a.jpg')?.rating).toBe(0);
  undo();
  expect(sourcePhotos().every(p => p.rating === 0)).toBe(true);
  step(1);
  expect(useApp.getState().photos[useApp.getState().active].name).toBe('d.jpg');
});

it('updates smart membership immediately as ratings change, including undo', async () => {
  await importFolder('/smart', ['a.jpg', 'b.jpg']);
  markPhotos({ rating: 5 });
  saveCollection({ id: 'five', name: 'Five stars', type: 'smart', rules: [{ field: 'rating', value: 5 }], createdAt: 1 });
  await selectSource({ type: 'collection', id: 'five' });
  expect(sourcePhotos().map(p => p.name)).toEqual(['a.jpg']);
  markPhotos({ rating: 1 });
  expect(sourcePhotos()).toEqual([]);
  expect(shown()).toEqual([]);
  undo();
  expect(sourcePhotos().map(p => p.name)).toEqual(['a.jpg']);
});

it('reads a source\'s members once per state, not once per caller', async () => {
  await importFolder('/once', ['a.jpg', 'b.jpg']);
  saveCollection({ id: 'any', name: 'Any', type: 'smart', rules: [{ field: 'rating', value: 0 }], createdAt: 1 });
  await selectSource({ type: 'collection', id: 'any' });
  const first = sourcePhotos();
  expect(sourcePhotos()).toBe(first);
  expect(sourceIndices()).toBe(sourceIndices());
  // A changed rule is a new definition, and is read again.
  saveCollection({ id: 'any', name: 'Any', type: 'smart', rules: [{ field: 'rating', value: 1 }], createdAt: 1 });
  expect(sourcePhotos()).toEqual([]);
});

it('combines toolbar filters with the source, gives a real empty state, and retains the active edit', async () => {
  await importFolder('/filters', ['a.jpg', 'b.jpg']);
  const active = useApp.getState().active;
  setFilter({ minRating: 5 });
  expect(shown()).toEqual([]);
  expect(useApp.getState().active).toBe(active);
  setFilter(NO_FILTER);
  expect(shown()).toEqual([0, 1]);
  setSelectedOnly(true);
  expect(shown()).toEqual([active]);
  setSelectedOnly(false);
});

it('deduplicates manual membership and folds RAW+JPEG membership without losing the JPEG reference', async () => {
  await importFolder('/pairs', ['a.ORF', 'a.jpg', 'b.jpg']);
  manual('jpeg', ['/pairs/a.jpg']);
  addToCollection('jpeg', ['/pairs/a.jpg']);
  expect(useCatalog.getState().collections[0]).toMatchObject({ photoIds: ['/pairs/a.jpg'] });
  await selectSource({ type: 'collection', id: 'jpeg' });
  expect(sourcePhotos().map(p => p.name)).toEqual(['a.ORF']);
  setFoldJpegs(false);
  expect(sourcePhotos().map(p => p.name)).toEqual(['a.jpg']);
  setFoldJpegs(true);
});

it('evaluates edited, flag, label, camera, look, capture date, and folder rules together', () => {
  const p: Photo = { path: '/Photos/2026/a.jpg', rel: 'a.jpg', name: 'a.jpg', size: 1, modified: 0, recipe: defaultRecipe(), seed: 0, white: null,
    raw: false, pair: null, rating: 5, flag: 'pick', label: 'red', capture: { camera: 'OM SYSTEM OM-3', date: '2026-10-12' } };
  expect(matchesRules(p, [{ field: 'edited', value: true }, { field: 'rating', value: 4 }, { field: 'flag', value: 'pick' }, { field: 'label', value: 'red' },
    { field: 'camera', value: 'om-3' }, { field: 'folder', value: '/Photos/2026/' }, { field: 'date', value: '2026-10-01', before: false }, { field: 'date', value: '2026-11-01', before: true }])).toBe(true);
  expect(matchesRules(p, [{ field: 'folder', value: '/Photos/202' }])).toBe(false);
  expect(matchesRules({ ...p, recipe: null }, [{ field: 'look', value: 'Neutral' }])).toBe(true);
  expect(matchesRules(p, [{ field: 'camera', value: 'Canon' }])).toBe(false);
  expect(matchesRules({ ...p, capture: undefined, modified: new Date(2026, 9, 12).getTime() }, [{ field: 'date', value: '2026-10-12', before: true }])).toBe(true);
  // The local day, as toLocaleDateString('en-CA') gives it, at both ends of a day.
  for (const t of [new Date(2026, 0, 5, 0, 0, 1).getTime(), new Date(2026, 11, 31, 23, 59).getTime(), 1790000000000]) {
    expect(localDay(t)).toBe(new Date(t).toLocaleDateString('en-CA'));
  }
});

it('matches each flag state, and reads a Favourite rule from before flags as Picked', () => {
  const p: Photo = { path: '/a.jpg', rel: 'a.jpg', name: 'a.jpg', size: 1, modified: 0, recipe: null, seed: 0, white: null, raw: false, pair: null, rating: 0, flag: null, label: null };
  expect(matchesRules(p, [{ field: 'flag', value: 'none' }])).toBe(true);
  expect(matchesRules({ ...p, flag: 'reject' }, [{ field: 'flag', value: 'reject' }])).toBe(true);
  expect(matchesRules({ ...p, flag: 'reject' }, [{ field: 'flag', value: 'pick' }])).toBe(false);
  const old = { id: 'c', name: 'Best', createdAt: 0, type: 'smart', rules: [{ field: 'heart', value: true }, { field: 'rating', value: 3 }] } as never;
  expect(migrateCollection(old)).toMatchObject({ rules: [{ field: 'flag', value: 'pick' }, { field: 'rating', value: 3 }] });
});

it('preserves complete virtual-copy families even if the collection contains only a copy', () => {
  const p = { path: '/copies/a.jpg', rel: 'a.jpg', name: 'a.jpg', size: 1, modified: 0, recipe: null, seed: 0, white: null, raw: false, pair: null, rating: 0, label: null, flag: null } satisfies Photo;
  const copy = { ...p, copyId: 'copy-1', copyName: 'Print' };
  cacheFolder('/copies', [p, copy]);
  manual('copies', [photoId(copy)]);
  expect(sourceMatches(p, { type: 'collection', id: 'copies' })).toBe(false);
  expect(sourceMatches(copy, { type: 'collection', id: 'copies' })).toBe(true);
  expect(catalogPhotos()).toHaveLength(2);
});

it('ignores an outdated source scan after the user switches back to a folder', async () => {
  await importFolder('/race', ['a.jpg']);
  manual('race-picks', ['/race/a.jpg']);
  let resolve!: (scan: ScanResult) => void;
  vi.mocked(scanFolder).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const opening = selectSource({ type: 'collection', id: 'race-picks' });
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  await openFolder('/race');
  resolve(scan('/race', ['a.jpg']));
  await opening;
  expect(useApp.getState().source).toEqual({ type: 'folder', id: '/race' });
});

it('records explicitly added files as a separate import without expanding the older session', async () => {
  await importFolder('/sync-history', ['a.jpg']);
  const first = useCatalog.getState().imports[0];
  folders['/sync-history'] = scan('/sync-history', ['a.jpg', 'b.jpg']);
  await openFolder('/sync-history');
  expect(useCatalog.getState().imports).toHaveLength(1);
  expect(sourcePhotos().map(p => p.name)).toEqual(['a.jpg']);
  importFolderPhotos({ mode: 'selected', paths: ['/sync-history/b.jpg'] });
  expect(useCatalog.getState().imports[0].photoIds).toEqual(['/sync-history/b.jpg']);
  await selectSource({ type: 'import', id: first.id });
  expect(sourcePhotos().map(p => p.name)).toEqual(['a.jpg']);
});

it('persists source definitions independently of metadata and keeps more than four import sessions', async () => {
  for (let i = 0; i < 5; i++) await importFolder(`/history-${i}`, ['a.jpg']);
  manual('saved', ['/history-0/a.jpg']);
  const saved = JSON.parse(localStorage.getItem('emulsion.libraryCatalog')!);
  expect(saved.imports).toHaveLength(5);
  expect(saved.collections[0].name).toBe('saved');
  expect(saved.folders).toBeUndefined();
  expect(saved.roots).toContain('/history-0');
});

it('writes only the selected virtual copy while retaining its original and sibling sidecar data', async () => {
  await importFolder('/copy-save', ['a.jpg']);
  folders['/copy-save'].entries[0].copies = [{ id: 'print', name: 'Print', recipe: null, rating: 0, label: null, flag: null }];
  await openFolder('/copy-save');
  manual('copy-save', ['/copy-save/a.jpg\0print']);
  await selectSource({ type: 'collection', id: 'copy-save' });
  markPhotos({ rating: 4 });
  await flushSaves();
  const saved = folders['/copy-save'].entries[0];
  expect(saved.rating).toBe(0);
  expect(saved.copies?.[0].rating).toBe(4);
});
