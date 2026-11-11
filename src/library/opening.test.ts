// SPDX-License-Identifier: GPL-3.0-or-later
// A large folder or collection takes seconds to read. Oli: leaving the previous folder on screen
// meanwhile "feels more like a crash than a loading". The new source is shown at once instead.
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../backend/api', () => ({
  scanFolder: vi.fn(), whitePoints: vi.fn(async () => []), writeSidecar: vi.fn(async () => {}),
  thumbnail: vi.fn(), isTauri: () => false, logToTerminal: () => {},
}));
import { scanFolder, type ScanResult } from '../backend/api';
import { catalogPhotos, saveCollection, useCatalog } from './catalog';
import { closeFolder, importFolderPhotos, markPhotos, openFolder, selectSource, setActive, setView, shownSource, sourcePhotos, useApp } from './store';
import { NO_FILTER } from './filter';

const scan = (root: string, names: string[]): ScanResult => ({ root, name: root.split('/').pop()!, unreadable: 0, focus: null, folders: [],
  entries: names.map(name => ({ path: `${root}/${name}`, rel: name, name, size: 1, modified: 1, recipe: null, rating: 0, label: null, flag: null, raw: false })) });
/** A scan that answers when `release` is called. */
function slowScan(result: ScanResult | Error) {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  vi.mocked(scanFolder).mockImplementationOnce(async () => { await gate; if (result instanceof Error) throw result; return result; });
  return () => release();
}
const settle = () => new Promise(r => setTimeout(r, 0));

beforeEach(async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
  closeFolder();
  useCatalog.setState({ imports: [], collections: [], folders: {} });
  useApp.setState({ filter: NO_FILTER });
  vi.mocked(scanFolder).mockImplementation(async root => scan(root, ['a.jpg', 'b.jpg']));
  await openFolder('/small');
  importFolderPhotos({ mode: 'sync' });
});

it('shows a folder being opened at once, deselects the previous photos, and keeps them out of Develop', async () => {
  expect(useApp.getState().selected.size).toBe(1);
  const release = slowScan(scan('/big', ['c.jpg']));
  const opened = openFolder('/big/');
  await settle();
  expect(useApp.getState().opening).toEqual({ source: { type: 'folder', id: '/big/' }, name: 'big' });
  expect(shownSource()).toEqual({ type: 'folder', id: '/big/' });
  expect(useApp.getState().selected.size).toBe(0);
  setView('develop');
  expect(useApp.getState().view).toBe('library');
  release();
  await opened;
  expect(useApp.getState().opening).toBeNull();
  expect(useApp.getState().folder?.root).toBe('/big');
});

it('shows a collection being opened at once when the catalog has none of its photos yet', async () => {
  saveCollection({ id: 'c', name: 'Big collection', type: 'smart', rules: [{ field: 'rating', value: 0 }], createdAt: 1 });
  useCatalog.setState({ folders: {} });
  const release = slowScan(scan('/small', ['a.jpg', 'b.jpg']));
  const opened = selectSource({ type: 'collection', id: 'c' });
  await settle();
  expect(useApp.getState().opening?.name).toBe('Big collection');
  release();
  await opened;
  expect(useApp.getState().opening).toBeNull();
  expect(useApp.getState().source).toEqual({ type: 'collection', id: 'c' });
});

it('keeps the open folder on screen while it is refreshed', async () => {
  const release = slowScan(scan('/small', ['a.jpg', 'b.jpg']));
  const opened = openFolder('/small');
  await settle();
  expect(useApp.getState().opening).toBeNull();
  expect(useApp.getState().selected.size).toBe(1);
  release();
  await opened;
});

it('returns to the previous folder when the new one cannot be read', async () => {
  const release = slowScan(new Error('drive gone'));
  const opened = openFolder('/missing');
  await settle();
  expect(useApp.getState().opening?.name).toBe('missing');
  release();
  await opened;
  expect(useApp.getState().opening).toBeNull();
  expect(useApp.getState().folder?.root).toBe('/small');
  expect(useApp.getState().photos.map(p => p.name)).toEqual(['a.jpg', 'b.jpg']);
});

it('shows a collection seen before from the catalog at once, refreshing it from disk behind the grid', async () => {
  saveCollection({ id: 'c', name: 'Big collection', type: 'smart', rules: [{ field: 'rating', value: 0 }], createdAt: 1 });
  await selectSource({ type: 'collection', id: 'c' });
  await openFolder('/elsewhere');
  // The second visit: the folder now has a new photo, and its scan is slow.
  const release = slowScan(scan('/small', ['a.jpg', 'b.jpg', 'new.jpg']));
  const opened = selectSource({ type: 'collection', id: 'c' });
  await settle();
  const s = useApp.getState();
  expect(s.opening).toBeNull();
  expect(s.source).toEqual({ type: 'collection', id: 'c' });
  expect(sourcePhotos().map(p => p.name)).toEqual(['a.jpg', 'b.jpg']);
  // Marked while the folder is read: kept when the refresh arrives.
  setActive(s.photos.findIndex(p => p.name === 'b.jpg'));
  markPhotos({ rating: 4 });
  release();
  await opened;
  expect(sourcePhotos().map(p => [p.name, p.rating])).toEqual([['a.jpg', 0], ['b.jpg', 4]]);
  expect(useApp.getState().photos[useApp.getState().active].name).toBe('b.jpg');
  expect(catalogPhotos().find(p => p.name === 'b.jpg')?.rating).toBe(4);
});
