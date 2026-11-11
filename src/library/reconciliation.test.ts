// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../backend/api', () => ({
  scanFolder: vi.fn(), whitePoints: vi.fn(async () => []), writeSidecar: vi.fn(async () => {}), thumbnail: vi.fn(), isTauri: () => false,
}));
import { scanFolder, type ScanResult } from '../backend/api';
import { cacheFolder, catalogPhotos, useCatalog } from './catalog';
import { closeFolder, importFolderPhotos, openFolder, chooseImport, markPhotos, undo, startImport, syncFolderPhotos, showMissingPhotos, shown, useApp } from './store';
import { folderImport, saveFolderImport } from './folders';
import { diskChanges } from './disks';
import { membership } from './membership';
import { NO_FILTER } from './filter';
const scan = (root: string, names: string[], unreadable = 0): ScanResult => ({ root, name: root.slice(1), unreadable, focus: null, folders: [],
  entries: names.map(name => ({ path: `${root}/${name}`, name, rel: name, size: 1, modified: 1, recipe: null, rating: 0, label: null, flag: null, raw: false })) });
let disk: string[];
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  closeFolder(); useCatalog.setState({ folders: {}, imports: [], collections: [] });
  useApp.setState({ filter: NO_FILTER, selectedOnly: false });
  disk = ['a.jpg', 'b.jpg', 'c.jpg'];
  vi.mocked(scanFolder).mockImplementation(async root => scan(root, disk));
});
it('adds successive selections, records only additions, and never removes previously imported files', async () => {
  await openFolder('/photos'); importFolderPhotos({ mode: 'selected', paths: ['/photos/a.jpg'] });
  importFolderPhotos({ mode: 'selected', paths: ['/photos/b.jpg'] });
  expect(useApp.getState().photos.map(p => p.name)).toEqual(['a.jpg', 'b.jpg']);
  expect(useCatalog.getState().imports[0].photoIds).toEqual(['/photos/b.jpg']);
  expect(folderImport('/photos')).toMatchObject({ mode: 'selected', paths: ['/photos/a.jpg', '/photos/b.jpg'] });
  importFolderPhotos({ mode: 'selected', paths: ['/photos/a.jpg'] });
  expect(useCatalog.getState().imports).toHaveLength(2);
});
it('cancels browsing a new source back to the original source and selection, without registering the previewed folder', async () => {
  await openFolder('/photos'); importFolderPhotos({ mode: 'selected', paths: ['/photos/a.jpg'] });
  const previous = useApp.getState();
  await startImport('/unimported');
  expect(useApp.getState().choosingImport).toBe(true);
  chooseImport(false);
  expect(useApp.getState()).toMatchObject({ source: previous.source, folder: previous.folder, photos: previous.photos, active: previous.active, selected: previous.selected, choosingImport: false });
  expect(useCatalog.getState().folders['/unimported']).toBeUndefined();
});
it('migrates an automatic-sync folder to a fixed snapshot before discovering new files', async () => {
  await openFolder('/photos'); importFolderPhotos({ mode: 'sync' });
  saveFolderImport('/photos', { mode: 'sync' });
  disk.push('new.jpg');
  await openFolder('/photos');
  expect(useApp.getState().photos).toHaveLength(3);
  expect(folderImport('/photos')?.mode).toBe('selected');
});
it('retains missing files and edits until explicitly removed, including their collection and import references', async () => {
  await openFolder('/photos'); importFolderPhotos({ mode: 'sync' });
  useApp.setState(s => ({ photos: s.photos.map(p => p.name === 'a.jpg' ? { ...p, rating: 5 } : p) }));
  useCatalog.setState({ collections: [{ type: 'manual', id: 'best', name: 'Best', createdAt: 0, photoIds: ['/photos/a.jpg', '/photos/b.jpg'] }] });
  disk = ['b.jpg', 'c.jpg'];
  await openFolder('/photos');
  expect(useApp.getState().photos.find(p => p.name === 'a.jpg')?.rating).toBe(5);
  await syncFolderPhotos('/photos', { add: [], remove: ['/photos/a.jpg'], recursive: false, knownOnly: true, importer: false });
  expect(catalogPhotos().map(p => p.name)).toEqual(['b.jpg', 'c.jpg']);
  expect(folderImport('/photos')).toMatchObject({ paths: ['/photos/b.jpg', '/photos/c.jpg'] });
  expect(useCatalog.getState().imports[0].photoIds).not.toContain('/photos/a.jpg');
  expect(useCatalog.getState().collections[0]).toMatchObject({ photoIds: ['/photos/b.jpg'] });
});
it('keeps a file that reappeared after the dialog scan and refuses removal after a partial scan', async () => {
  await openFolder('/photos'); importFolderPhotos({ mode: 'sync' });
  await syncFolderPhotos('/photos', { add: [], remove: ['/photos/a.jpg'], recursive: false, knownOnly: true, importer: false });
  expect(useApp.getState().photos).toHaveLength(3);
  vi.mocked(scanFolder).mockImplementation(async root => scan(root, ['b.jpg'], 1));
  await syncFolderPhotos('/photos', { add: [], remove: ['/photos/a.jpg'], recursive: false, knownOnly: true, importer: false });
  expect(catalogPhotos()).toHaveLength(3);
});
it('scopes reconciliation to known subfolders, and treats partial listings as indeterminate for missing files', async () => {
  disk = ['a.jpg', 'known/b.jpg'];
  await openFolder('/photos'); importFolderPhotos({ mode: 'sync' });
  const listing = { entries: ['a.jpg', 'new.jpg', 'known/new.jpg', 'unknown/new.jpg'].map(p => ({ path: `/photos/${p}`, modified: 1 })), folders: [], unreadable: 0 };
  const changes = diskChanges('/photos', listing, true, true);
  expect(changes.added).toEqual(['/photos/new.jpg', '/photos/known/new.jpg']);
  expect(changes.missing).toEqual(['/photos/known/b.jpg']);
  expect(diskChanges('/photos', { ...listing, unreadable: 1 }, true, true).missing).toEqual([]);
});
it('registers empty subfolders through sync without opening the importer or adding photos', async () => {
  await openFolder('/photos'); importFolderPhotos({ mode: 'selected', paths: ['/photos/a.jpg'] });
  await syncFolderPhotos('/photos', { add: [], remove: [], recursive: true, knownOnly: false, importer: false, folders: ['/photos/empty/deep'] });
  expect(membership('/photos/empty/deep')).toMatchObject({ mode: 'selected', paths: [] });
  expect(useApp.getState().choosingImport).toBe(false);
});
it('shows missing subfolder entries with all ordinary filters cleared', async () => {
  disk = ['a.jpg', 'sub/b.jpg'];
  await openFolder('/photos'); importFolderPhotos({ mode: 'sync' });
  useApp.setState({ filter: { ...NO_FILTER, minRating: 5 }, selectedOnly: true });
  showMissingPhotos('/photos', ['/photos/sub/b.jpg']);
  expect(shown().map(i => useApp.getState().photos[i].name)).toEqual(['sub/b.jpg']);
  expect(useApp.getState().selectedOnly).toBe(false);
});
it('recognizes explicitly added empty folders as library sources', () => {
  cacheFolder('/empty', []);
  expect(membership('/empty')).toMatchObject({ mode: 'selected', paths: [] });
});

it('keeps the previous Library edit history when the importer is canceled', async () => {
  await openFolder('/photos'); importFolderPhotos({ mode: 'selected', paths: ['/photos/a.jpg'] });
  markPhotos({ rating: 5 });
  await startImport('/another-source');
  chooseImport(false);
  expect(useApp.getState().history.undo).not.toBeNull();
  undo();
  expect(useApp.getState().photos[0].rating).toBe(0);
});
it('includes a later child-folder import when reopening a recursive parent source', async () => {
  await openFolder('/photos'); importFolderPhotos({ mode: 'selected', paths: ['/photos/a.jpg'] });
  saveFolderImport('/photos', { mode: 'selected', paths: ['/photos/a.jpg'], includeSubfolders: true });
  vi.mocked(scanFolder).mockImplementation(async (root, recursive) => scan(root, root.endsWith('/sub') ? ['new.jpg'] : recursive ? ['a.jpg', 'sub/new.jpg'] : ['a.jpg']));
  await openFolder('/photos/sub');
  importFolderPhotos({ mode: 'sync' });
  await openFolder('/photos');
  expect(useApp.getState().photos.map(p => p.path)).toContain('/photos/sub/new.jpg');
});
