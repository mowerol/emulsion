// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../backend/api', () => ({
  scanFolder: vi.fn(), whitePoints: vi.fn(() => Promise.resolve([])),
  writeSidecar: vi.fn(() => Promise.resolve()), thumbnail: vi.fn(),
  isTauri: () => false, logToTerminal: () => {},
}));
import { scanFolder, whitePoints, type ScanResult } from '../backend/api';
import { closeFolder, importFolderPhotos, openFolder, useApp } from './store';
import { NO_FILTER } from './filter';

function scan(root = '/photos', names = ['a.jpg', 'b.jpg']): ScanResult {
  return { root, name: 'Photos', unreadable: 0, focus: null,
    folders: [{ path: `${root}/Trip`, name: 'Trip' }],
    entries: names.map(name => ({ path: `${root}/${name}`, name, rel: name, size: 1,
      modified: 0, recipe: null, rating: 0, label: null, heart: false, raw: false })) };
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
