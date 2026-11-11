// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../backend/api', () => ({
  scanFolder: vi.fn(), whitePoints: vi.fn(() => Promise.resolve([])),
  writeSidecar: vi.fn(() => Promise.resolve()), thumbnail: vi.fn(),
  isTauri: () => false, logToTerminal: () => {},
}));
import { scanFolder, whitePoints, type ScanResult } from '../backend/api';
import { closeFolder, importFolderPhotos, openFolder, openPaths, setIncludeSubfolders, useApp } from './store';
import { NO_FILTER } from './filter';
import { lastFolder } from './folders';

function scan(root = '/photos', names = ['a.jpg', 'b.jpg']): ScanResult {
  return { root, name: 'Photos', unreadable: 0, focus: null,
    folders: [{ path: `${root}/Trip`, name: 'Trip' }],
    entries: names.map(name => ({ path: `${root}/${name}`, name, rel: name, size: 1,
      modified: 0, recipe: null, rating: 0, label: null, flag: null, raw: false })) };
}

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.clearAllMocks();
  closeFolder();
  useApp.setState({ filter: NO_FILTER });
  vi.mocked(scanFolder).mockResolvedValue(scan());
});

it('browses only the folder itself without importing or reading RAW metadata', async () => {
  await openFolder('/photos');
  expect(scanFolder).toHaveBeenCalledWith('/photos', false);
  expect(useApp.getState()).toMatchObject({ choosingImport: true, photos: [], active: -1 });
  expect(useApp.getState().candidates).toHaveLength(2);
  expect(useApp.getState().subfolders).toEqual([{ path: '/photos/Trip', name: 'Trip' }]);
  expect(whitePoints).not.toHaveBeenCalled();
});

it('remembers a selective import without adding newly discovered files', async () => {
  await openFolder('/photos');
  importFolderPhotos({ mode: 'selected', paths: ['/photos/b.jpg'] });
  closeFolder();
  vi.mocked(scanFolder).mockResolvedValue(scan('/photos', ['a.jpg', 'b.jpg', 'c.jpg']));
  await openFolder('/photos');
  expect(useApp.getState().photos.map(p => p.name)).toEqual(['b.jpg']);
  expect(useApp.getState().choosingImport).toBe(false);
});

it('syncs new files on reopen, removes missing files, and keeps folder choices independent', async () => {
  await openFolder('/photos');
  importFolderPhotos({ mode: 'sync' });
  expect(useApp.getState().photos).toHaveLength(2);
  vi.mocked(scanFolder).mockResolvedValue(scan('/photos', ['b.jpg', 'c.jpg']));
  await openFolder('/photos');
  expect(useApp.getState().photos.map(p => p.name)).toEqual(['b.jpg', 'c.jpg']);
  vi.mocked(scanFolder).mockResolvedValue(scan('/elsewhere'));
  await openFolder('/elsewhere');
  expect(useApp.getState().photos).toHaveLength(0);
  expect(useApp.getState().choosingImport).toBe(true);
});

it('preserves current edits when changing import membership', async () => {
  await openFolder('/photos');
  importFolderPhotos({ mode: 'selected', paths: ['/photos/b.jpg'] });
  useApp.setState(s => ({ photos: s.photos.map(p => ({ ...p, rating: 5 })) }));
  importFolderPhotos({ mode: 'sync' });
  expect(useApp.getState().photos.find(p => p.name === 'b.jpg')?.rating).toBe(5);
});

it('does not reopen a folder after returning to the folder Library during a scan', async () => {
  let finish!: (value: ScanResult) => void;
  vi.mocked(scanFolder).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const opening = openFolder('/photos');
  await vi.waitFor(() => expect(scanFolder).toHaveBeenCalled());
  closeFolder();
  finish(scan());
  await opening;
  expect(useApp.getState().folder).toBeNull();
});

it('previews subfolders without importing them, then remembers the sync scope on reopen', async () => {
  vi.mocked(scanFolder).mockImplementation(async (root, recursive) => scan(root, recursive ? ['a.jpg', 'Trip/b.jpg'] : ['a.jpg']));
  await openFolder('/nested');
  await setIncludeSubfolders(true);
  expect(scanFolder).toHaveBeenLastCalledWith('/nested', true);
  expect(useApp.getState().candidates).toHaveLength(2);
  expect(useApp.getState().photos).toHaveLength(0);
  importFolderPhotos({ mode: 'sync' });
  closeFolder();
  await openFolder('/nested');
  expect(scanFolder).toHaveBeenLastCalledWith('/nested', true);
  expect(useApp.getState().includeSubfolders).toBe(true);
  expect(useApp.getState().photos.map(p => p.rel)).toEqual(['a.jpg', 'Trip/b.jpg']);
});

it('excludes selections from subfolders when their scope is turned off', async () => {
  vi.mocked(scanFolder).mockImplementation(async (root, recursive) => scan(root, recursive ? ['a.jpg', 'Trip/b.jpg'] : ['a.jpg']));
  await openFolder('/exclude');
  await setIncludeSubfolders(true);
  await setIncludeSubfolders(false);
  importFolderPhotos({ mode: 'selected', paths: ['/exclude/a.jpg', '/exclude/Trip/b.jpg'] });
  expect(useApp.getState().importChoice).toEqual({ mode: 'selected', paths: ['/exclude/a.jpg'], includeSubfolders: false });
  expect(useApp.getState().photos.map(p => p.rel)).toEqual(['a.jpg']);
});

it('remembers the last successfully browsed folder, including folders awaiting import', async () => {
  await openFolder('/photos');
  expect(lastFolder()).toBe('/photos');
  closeFolder();
  expect(lastFolder()).toBe('/photos');
  vi.mocked(scanFolder).mockRejectedValue(new Error('Drive disconnected'));
  await openFolder('/unavailable');
  expect(lastFolder()).toBe('/photos');
});

it('imports and selects photos dropped on the app without asking', async () => {
  vi.mocked(scanFolder).mockResolvedValue(scan('/dropped', ['a.jpg', 'b.jpg', 'c.jpg']));
  await openPaths(['/dropped/b.jpg', '/dropped/c.jpg']);
  expect(scanFolder).toHaveBeenCalledWith('/dropped/b.jpg', false);
  const s = useApp.getState();
  expect(s.choosingImport).toBe(false);
  expect(s.photos.map(p => p.name)).toEqual(['b.jpg', 'c.jpg']);
  expect([...s.selected]).toEqual(['/dropped/b.jpg', '/dropped/c.jpg']);
  expect(s.active).toBe(0);
});

it('adds dropped photos to what the folder already imports and leaves out other folders', async () => {
  vi.mocked(scanFolder).mockResolvedValue(scan('/added', ['a.jpg', 'b.jpg', 'c.jpg']));
  await openFolder('/added');
  importFolderPhotos({ mode: 'selected', paths: ['/added/a.jpg'] });
  await openPaths(['/added/c.jpg', '/elsewhere/d.jpg']);
  const s = useApp.getState();
  expect(s.photos.map(p => p.name)).toEqual(['a.jpg', 'c.jpg']);
  expect([...s.selected]).toEqual(['/added/c.jpg']);
  expect(s.toast?.message).toContain('1 item from other folders');
});

it('opens a dropped folder as Import Folder does', async () => {
  vi.mocked(scanFolder).mockResolvedValue(scan('/fresh'));
  await openPaths(['/fresh']);
  expect(useApp.getState()).toMatchObject({ choosingImport: true, photos: [] });
});
