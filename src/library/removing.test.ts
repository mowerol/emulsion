// SPDX-License-Identifier: GPL-3.0-or-later
// Remove from Library and Delete from Disk (store.ts `removeFromLibrary`, `deleteFromDisk`), and
// removing a whole import or folder (`removeLocation`).
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../backend/api', () => ({
  scanFolder: vi.fn(), whitePoints: vi.fn(async () => []), writeSidecar: vi.fn(async () => {}), thumbnail: vi.fn(), isTauri: () => false,
  trashPhotos: vi.fn(),
}));
import { scanFolder, trashPhotos, type ScanResult } from '../backend/api';
import { cacheFolder, useCatalog } from './catalog';
import { closeFolder, createVirtualCopies, deleteCollection, deleteFromDisk, importFolderPhotos, locationRemoval, openFolder, removalTargets, removeFromLibrary, removeLocation, selectSource, setActive, setFoldJpegs, shownSource, useApp } from './store';
import { folderImport, importedRoots, saveFolderImport } from './folders';
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

const imports = () => useCatalog.getState().imports;

it('an import emptied by removing its photos leaves the list, and closes if shown', async () => {
  await selectSource({ type: 'import', id: imports()[0].id });
  useApp.setState({ selected: new Set(useApp.getState().photos.map(photoId)) });
  removeFromLibrary();
  expect(imports()).toEqual([]);
  expect(shownSource()).toBeNull();
});

it('removes an import: its photos leave the library, other imports keep theirs, and the files stay', async () => {
  disk = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'];
  await openFolder('/photos');
  importFolderPhotos({ mode: 'selected', paths: disk.map(n => `/photos/${n}`) });
  const [later, first] = imports();
  expect(later.photoIds).toEqual(['/photos/d.jpg']);
  expect(locationRemoval({ type: 'import', id: first.id })).toMatchObject({ name: first.name, frames: 3 });
  removeLocation({ type: 'import', id: first.id });
  expect(imports().map(i => i.id)).toEqual([later.id]);
  expect(names()).toEqual(['d.jpg']);
  expect(folderImport('/photos')).toMatchObject({ paths: ['/photos/d.jpg'] });
  expect(trashPhotos).not.toHaveBeenCalled();
  expect(useApp.getState().candidates.map(p => p.name)).toContain('a.jpg');
});

it('removes a folder with its subfolders, their import choices and imports, and closes it if shown', async () => {
  await openFolder('/other');
  importFolderPhotos({ mode: 'selected', paths: disk.map(n => `/other/${n}`) });
  cacheFolder('/photos/sub', [{ ...useApp.getState().photos[0], path: '/photos/sub/s.jpg', name: 's.jpg' }]);
  saveFolderImport('/photos/sub', { mode: 'selected', paths: ['/photos/sub/s.jpg'] });
  await openFolder('/photos');
  expect(locationRemoval({ type: 'folder', id: '/photos/' })).toMatchObject({ name: 'photos', frames: 4 });
  removeLocation({ type: 'folder', id: '/photos/' });
  expect(shownSource()).toBeNull();
  expect(Object.keys(useCatalog.getState().folders)).toEqual(['/other']);
  expect(importedRoots()).toEqual(['/other']);
  expect(folderImport('/photos')).toBeNull();
  expect(imports().map(i => i.destinationPath)).toEqual(['/other']);
});

it('removing a subfolder leaves its parent folder and the shown photos outside it', async () => {
  cacheFolder('/photos/sub', [{ ...useApp.getState().photos[0], path: '/photos/sub/s.jpg', name: 's.jpg' }]);
  saveFolderImport('/photos/sub', { mode: 'selected', paths: ['/photos/sub/s.jpg'] });
  removeLocation({ type: 'folder', id: '/photos/sub' });
  expect(shownSource()).toMatchObject({ type: 'folder', id: '/photos' });
  expect(names()).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  expect(Object.keys(useCatalog.getState().folders)).toEqual(['/photos']);
  expect(folderImport('/photos/sub')).toBeNull();
});

it('deletes a collection, its target and its view, and keeps its photos in the library', async () => {
  useCatalog.setState({ collections: [{ id: 'k', name: 'Keep', createdAt: 0, type: 'manual' as const, photoIds: ['/photos/a.jpg'] }], targetCollectionId: 'k' });
  await selectSource({ type: 'collection', id: 'k' });
  expect(shownSource()).toMatchObject({ type: 'collection', id: 'k' });
  deleteCollection('k');
  expect(useCatalog.getState()).toMatchObject({ collections: [], targetCollectionId: null });
  expect(shownSource()).toBeNull();
  expect(useCatalog.getState().folders['/photos'].map(p => p.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  expect(imports()).toHaveLength(1);
});
