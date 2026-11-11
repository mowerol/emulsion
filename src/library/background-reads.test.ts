// SPDX-License-Identifier: GPL-3.0-or-later
// A large smart collection opens every library folder at once. The background reads (capture
// metadata, white points, embedded marks) answer 32-64 photos at a time; applying each answer as
// its own update rewrote the whole catalog and re-rendered the grid every time, which stalled the
// app on a 20,000-photo collection. They now apply their results in a few large updates, and the
// catalog remembers what they found, so reopening doesn't read every file again (on Oli's library,
// 10 s of LibRaw for the white points and 20 s for embedded metadata on every click).
import { expect, it, vi } from 'vitest';
vi.mock('../backend/api', () => ({
  scanFolder: vi.fn(), writeSidecar: vi.fn(async () => {}), thumbnail: vi.fn(), isTauri: () => true, logToTerminal: () => {},
  getSetting: () => null, setSetting: () => {},
  whitePoints: vi.fn(async (paths: string[]) => paths.map(() => [0.31, 0.32])),
  catalogMetadata: vi.fn(async (paths: string[]) => paths.map(() => ({ camera: 'Test Camera', date: '2026-01-01' }))),
  embeddedMetadata: vi.fn(async (paths: string[]) => paths.map(() => ({ rating: 3, label: null, reject: false, meta: { keywords: ['roll'], fields: {} } }))),
}));
import { embeddedMetadata, scanFolder, whitePoints, type ScanResult } from '../backend/api';
import { cacheFolder, saveCollection, useCatalog } from './catalog';
import { saveFolderImport } from './folders';
import { selectSource, useApp } from './store';

const ROOTS = 10, PER = 1000;
const scan = (root: string): ScanResult => ({ root, name: root.slice(1), unreadable: 0, focus: null, folders: [],
  entries: Array.from({ length: PER }, (_, i) => ({ path: `${root}/${i}.orf`, rel: `${i}.orf`, name: `${i}.orf`, size: 1, modified: 1, recipe: null, rating: 0, label: null, flag: null, raw: true })) });
const settle = async () => { for (let i = 0; i < 1000; i++) await new Promise(r => setTimeout(r, 0)); };

it('opens a smart collection of 10,000 photos with a few state updates, not one per background batch', async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
  const scans = Object.fromEntries(Array.from({ length: ROOTS }, (_, r) => [`/r${r}`, scan(`/r${r}`)]));
  vi.mocked(scanFolder).mockImplementation(async root => scans[root]);
  for (const root of Object.keys(scans)) { cacheFolder(root, []); saveFolderImport(root, { mode: 'sync', includeSubfolders: false }); }
  saveCollection({ id: 'all', name: 'All', type: 'smart', rules: [{ field: 'rating', value: 0 }], createdAt: 1 });
  let appUpdates = 0, catalogUpdates = 0;
  useApp.subscribe(() => appUpdates++);
  useCatalog.subscribe(() => catalogUpdates++);

  await selectSource({ type: 'collection', id: 'all' });
  await settle();
  const photos = useApp.getState().photos;
  expect(photos).toHaveLength(ROOTS * PER);
  expect(photos.every(p => p.capture?.camera === 'Test Camera' && p.white?.[0] === 0.31 && p.rating === 3)).toBe(true);
  // 313 capture batches, 157 white point batches and 313 embedded batches used to be ~800 updates.
  expect(appUpdates).toBeLessThan(60);
  expect(catalogUpdates).toBeLessThan(100);

  // Reopening uses what the catalog remembers: no file is read again, and the embedded marks
  // (not saved to a sidecar until the photo is edited) come back from the catalog.
  appUpdates = 0;
  vi.mocked(whitePoints).mockClear();
  vi.mocked(embeddedMetadata).mockClear();
  await selectSource({ type: 'collection', id: 'all' });
  await settle();
  expect(whitePoints).not.toHaveBeenCalled();
  expect(embeddedMetadata).not.toHaveBeenCalled();
  const again = useApp.getState().photos;
  expect(again.every(p => p.white?.[0] === 0.31 && p.rating === 3 && p.meta?.keywords[0] === 'roll')).toBe(true);
  expect(appUpdates).toBeLessThan(30);

  // A file changed since (another size) is read again.
  scans['/r0'].entries[0].size = 2;
  await selectSource({ type: 'collection', id: 'all' });
  await settle();
  expect(vi.mocked(whitePoints).mock.calls.flat(2)).toEqual(['/r0/0.orf']);
  expect(vi.mocked(embeddedMetadata).mock.calls.flat(2)).toEqual(['/r0/0.orf']);
}, 30000);
