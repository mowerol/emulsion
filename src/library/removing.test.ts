// SPDX-License-Identifier: GPL-3.0-or-later
// Remove from Library and Delete from Disk (store.ts `removeFromLibrary`, `deleteFromDisk`).
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../backend/api', () => ({
  scanFolder: vi.fn(), whitePoints: vi.fn(async () => []), writeSidecar: vi.fn(async () => {}), thumbnail: vi.fn(), isTauri: () => false,
  trashPhotos: vi.fn(),
}));
import { scanFolder, trashPhotos, type ScanResult } from '../backend/api';
import { useCatalog } from './catalog';
import { closeFolder, createVirtualCopies, deleteFromDisk, importFolderPhotos, openFolder, removalTargets, removeFromLibrary, setActive, setFoldJpegs, useApp } from './store';
import { folderImport } from './folders';
import { NO_FILTER } from './filter';
import { photoId } from './copies';

const scan = (root: string, names: string[]): ScanResult => ({ root, name: root.slice(1), unreadable: 0, focus: null, folders: [],
  entries: names.map(name => ({ path: `${root}/${name}`, name, rel: name, size: 1, modified: 1, recipe: null, rating: 0, label: null, flag: null, raw: name.endsWith('.RAF') })) });
let disk: string[];
const names = () => useApp.getState().photos.map(p => p.name);
const active = () => useApp.getState().photos[useApp.getState().active]?.name;

beforeEach(async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.clearAllMocks();
  closeFolder(); useCatalog.setState({ folders: {}, imports: [], collections: [] });
  useApp.setState({ filter: NO_FILTER, selectedOnly: false });
  setFoldJpegs(true);
  disk = ['a.jpg', 'b.jpg', 'c.jpg'];
  vi.mocked(scanFolder).mockImplementation(async root => scan(root, disk));
  await openFolder('/photos');
  importFolderPhotos({ mode: 'selected', paths: disk.map(n => `/photos/${n}`) });
});

it('removes the selection from the library, its collections and imports, and keeps it on disk to import again', async () => {
  useCatalog.setState(c => ({ collections: [{ id: 'k', name: 'Keep', createdAt: 0, type: 'manual' as const, photoIds: ['/photos/a.jpg', '/photos/b.jpg'] }, ...c.collections] }));
  setActive(1);
  removeFromLibrary();
  expect(names()).toEqual(['a.jpg', 'c.jpg']);
  expect(active()).toBe('c.jpg');
  expect(trashPhotos).not.toHaveBeenCalled();
  expect(folderImport('/photos')).toMatchObject({ paths: ['/photos/a.jpg', '/photos/c.jpg'] });
  const catalog = useCatalog.getState();
  expect(catalog.folders['/photos'].map(p => p.name)).toEqual(['a.jpg', 'c.jpg']);
  expect(catalog.imports.flatMap(i => i.photoIds)).not.toContain('/photos/b.jpg');
  expect(catalog.collections.find(c => c.id === 'k')).toMatchObject({ photoIds: ['/photos/a.jpg'] });
  // Still a file on disk: the importer offers it again.
  expect(useApp.getState().candidates.map(p => p.name)).toContain('b.jpg');
  await openFolder('/photos');
  expect(names()).toEqual(['a.jpg', 'c.jpg']);
});

it('takes the JPEG folded into a RAW, and an original takes its virtual copies', async () => {
  disk = ['x.RAF', 'x.jpg', 'y.jpg'];
  await openFolder('/photos');
  importFolderPhotos({ mode: 'selected', paths: disk.map(n => `/photos/${n}`) });
  expect(names()).toContain('x.RAF');
  setActive(useApp.getState().photos.findIndex(p => p.name === 'x.RAF'));
  createVirtualCopies();
  expect(useApp.getState().photos.filter(p => p.path === '/photos/x.RAF')).toHaveLength(2);
  setActive(useApp.getState().photos.findIndex(p => p.name === 'x.RAF' && !p.copyId));
  const plan = removalTargets();
  expect(plan).toMatchObject({ sources: ['/photos/x.RAF', '/photos/x.jpg'], frames: 1, pairs: 1, copies: [] });
  removeFromLibrary(plan);
  expect([...useApp.getState().photos, ...useApp.getState().hidden].map(p => p.path).filter(p => p.includes('/x.'))).toEqual([]);
  expect(useApp.getState().pairCount).toBe(0);
});

it('a virtual copy alone is removed only as a copy', () => {
  setActive(0);
  createVirtualCopies();
  const copy = useApp.getState().photos.findIndex(p => p.copyId);
  setActive(copy);
  const plan = removalTargets();
  expect(plan.sources).toEqual([]);
  expect(plan.copies.map(photoId)).toEqual([photoId(useApp.getState().photos[copy])]);
  removeFromLibrary(plan);
  expect(names()).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
});

it('moves photos to the Trash, and keeps in the library any that could not be moved', async () => {
  vi.mocked(trashPhotos).mockImplementation(async paths => paths.map(path => ({ path, error: path.endsWith('c.jpg') ? 'Locked' : null })));
  useApp.setState({ selected: new Set(['/photos/b.jpg', '/photos/c.jpg']), active: 1 });
  await deleteFromDisk();
  expect(trashPhotos).toHaveBeenCalledWith(['/photos/b.jpg', '/photos/c.jpg']);
  expect(names()).toEqual(['a.jpg', 'c.jpg']);
  expect(useApp.getState().candidates.map(p => p.name)).toEqual(['a.jpg', 'c.jpg']);
  expect(useApp.getState().toast?.message).toMatch(/Could not move c\.jpg to the Trash\. Locked/);
});
