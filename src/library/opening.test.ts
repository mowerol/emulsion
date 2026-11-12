// SPDX-License-Identifier: GPL-3.0-or-later
// A large folder or collection takes seconds to read. Oli: leaving the previous folder on screen
// meanwhile "feels more like a crash than a loading". The new source is shown at once instead.
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../backend/api', () => ({
  scanFolder: vi.fn(), whitePoints: vi.fn(async () => []), writeSidecar: vi.fn(async () => {}),
  thumbnail: vi.fn(), isTauri: () => false, logToTerminal: () => {},
}));
import { scanFolder, type ScanProgress, type ScanResult } from '../backend/api';
import { catalogPhotos, saveCollection, useCatalog } from './catalog';
import { chooseImport, closeFolder, createVirtualCopies, importFolderPhotos, markPhotos, openFolder, removeVirtualCopies, selectSource, setActive, setView, shownSource, sourcePhotos, useApp } from './store';
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

it('shows an imported folder from the catalog before its disk scan finishes', async () => {
  await openFolder('/elsewhere');
  const release = slowScan(scan('/small', ['a.jpg', 'b.jpg', 'new.jpg']));
  const opened = openFolder('/small');
  await settle();
  try {
    expect(useApp.getState().opening).toBeNull();
    expect(useApp.getState().source).toEqual({ type: 'folder', id: '/small' });
    expect(sourcePhotos().map(p => p.name)).toEqual(['a.jpg', 'b.jpg']);
  } finally {
    release();
    await opened;
  }
});

it('returns immediately to the cached folder while a different folder is still opening', async () => {
  const releaseOther = slowScan(scan('/other', ['c.jpg']));
  const other = openFolder('/other');
  await settle();
  const releaseSmall = slowScan(scan('/small', ['a.jpg', 'b.jpg']));
  const small = openFolder('/small');
  await settle();
  try {
    expect(useApp.getState().opening).toBeNull();
    expect(sourcePhotos().map(p => p.name)).toEqual(['a.jpg', 'b.jpg']);
    releaseOther();
    await other;
    expect(useApp.getState().loading).toBe(true);
  } finally {
    releaseOther();
    releaseSmall();
    await Promise.all([other, small]);
  }
});

it('shows the first batch of a new folder while the rest is still being read', async () => {
  let progress: ((batch: ScanProgress) => void) | undefined;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(scanFolder).mockImplementationOnce(async (_path, _recursive, onProgress) => {
    progress = onProgress;
    await gate;
    return scan('/new', ['first.jpg', 'last.jpg']);
  });
  const opened = openFolder('/new');
  await settle();
  try {
    expect(progress).toBeTypeOf('function');
    progress!({ ...scan('/new', ['first.jpg']), total: 2 });
    expect(useApp.getState()).toMatchObject({ opening: null, loading: true, choosingImport: true });
    expect(useApp.getState().candidates.map(p => p.name)).toEqual(['first.jpg']);
    expect(useApp.getState().photos).toEqual([]);
  } finally {
    release();
    await opened;
  }
  expect(useApp.getState().candidates.map(p => p.name)).toEqual(['first.jpg', 'last.jpg']);
});

it('preserves edits, selection, Develop, and undo while an imported folder refreshes', async () => {
  await openFolder('/elsewhere');
  const release = slowScan(scan('/small', ['a.jpg', 'b.jpg']));
  const opened = openFolder('/small');
  await settle();
  try {
    const i = useApp.getState().photos.findIndex(p => p.name === 'b.jpg');
    setActive(i);
    markPhotos({ rating: 4 });
    setView('develop');
  } finally {
    release();
    await opened;
  }
  const s = useApp.getState();
  expect(s.photos[s.active]).toMatchObject({ name: 'b.jpg', rating: 4 });
  expect([...s.selected]).toEqual(['/small/b.jpg']);
  expect(s.view).toBe('develop');
  expect(s.history.undo).toBeTruthy();
  expect(catalogPhotos().find(p => p.path === '/small/b.jpg')?.rating).toBe(4);
});

it('keeps the range anchor and decoded metadata while accepting refreshed sidecar marks', async () => {
  await openFolder('/elsewhere');
  const result = scan('/small', ['a.jpg', 'b.jpg']);
  result.entries[1].rating = 3;
  const release = slowScan(result);
  const opened = openFolder('/small');
  await settle();
  setActive(0);
  setActive(1, 'range');
  useApp.setState(s => ({ photos: s.photos.map(p => p.name === 'a.jpg' ? { ...p, white: [0.3, 0.3] } : p) }));
  release();
  await opened;
  const s = useApp.getState();
  expect(s.photos[s.anchor].name).toBe('a.jpg');
  expect(s.photos[s.active].name).toBe('b.jpg');
  expect(s.selected.size).toBe(2);
  expect(s.photos.find(p => p.name === 'a.jpg')?.white).toEqual([0.3, 0.3]);
  expect(s.photos.find(p => p.name === 'b.jpg')?.rating).toBe(3);
});

it('does not restore a virtual copy removed during a background scan', async () => {
  createVirtualCopies();
  const copy = useApp.getState().photos.find(p => p.copyId)!;
  await openFolder('/elsewhere');
  const result = scan('/small', ['a.jpg', 'b.jpg']);
  result.entries[0].copies = [{ id: copy.copyId!, name: copy.copyName!, recipe: copy.recipe, rating: copy.rating, label: copy.label, flag: copy.flag }];
  const release = slowScan(result);
  const opened = openFolder('/small');
  await settle();
  setActive(useApp.getState().photos.findIndex(p => p.copyId === copy.copyId));
  removeVirtualCopies();
  release();
  await opened;
  expect(useApp.getState().photos.some(p => p.copyId)).toBe(false);
  expect(catalogPhotos().some(p => p.copyId)).toBe(false);
});

it.each(['cancel', 'switch', 'failure'] as const)('ignores partial results after an import %s', async action => {
  const previous = useApp.getState();
  let progress: ((batch: ScanProgress) => void) | undefined;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(scanFolder).mockImplementationOnce(async (_path, _recursive, onProgress) => {
    progress = onProgress;
    await gate;
    if (action === 'failure') throw Error('Drive disconnected');
    return scan('/new', ['first.jpg', 'last.jpg']);
  });
  const opened = openFolder('/new');
  await settle();
  progress!({ ...scan('/new', ['first.jpg']), total: 2 });
  if (action === 'cancel') chooseImport(false);
  if (action === 'switch') await openFolder('/other');
  release();
  await opened;
  // Channel deliveries can arrive after either cancellation or the command's final response.
  progress!({ ...scan('/new', ['last.jpg']), total: 2 });
  const s = useApp.getState();
  expect(s.loading).toBe(false);
  if (action === 'switch') {
    expect(s.folder?.root).toBe('/other');
    expect(s.candidates.every(p => p.path.startsWith('/other/'))).toBe(true);
  } else {
    expect(s.choosingImport).toBe(false);
    expect(s.folder?.root).toBe('/small');
    expect(s.photos).toEqual(previous.photos);
    expect(s.selected).toEqual(previous.selected);
  }
});

it('keeps cached entries available if an imported folder is disconnected', async () => {
  await openFolder('/elsewhere');
  const release = slowScan(new Error('Drive disconnected'));
  const opened = openFolder('/small');
  await settle();
  release();
  await opened;
  expect(useApp.getState().loading).toBe(false);
  expect(useApp.getState().folder?.root).toBe('/small');
  expect(sourcePhotos().map(p => p.name)).toEqual(['a.jpg', 'b.jpg']);
});

it.each(['switch', 'close'] as const)('retains edits when leaving a cached folder before its scan finishes: %s', async action => {
  await openFolder('/elsewhere');
  const release = slowScan(scan('/small', ['a.jpg', 'b.jpg']));
  const opened = openFolder('/small');
  await settle();
  markPhotos({ rating: 4 });
  if (action === 'switch') await openFolder('/other');
  else closeFolder();
  release();
  await opened;
  expect(catalogPhotos().find(p => p.path === '/small/a.jpg')?.rating).toBe(4);
  expect(useApp.getState().folder?.root ?? null).toBe(action === 'switch' ? '/other' : null);
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
