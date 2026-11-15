// SPDX-License-Identifier: GPL-3.0-or-later
// An unedited Fujifilm RAW opens with its film simulation's look, which the library reads from the
// file in the background. Catalogs from before that (2026-11-14) hold the camera and date but no
// simulation, so on Oli's library 28,000 entries showed Emulsion Standard: the background pass
// re-reads them when their folder opens, but applied its answers only every 1,024 photos, and a
// photo opened or exported before then used the default look (an edit made then kept it).
import { expect, it, vi } from 'vitest';
vi.mock('../backend/api', () => ({
  scanFolder: vi.fn(), writeSidecar: vi.fn(async () => {}), thumbnail: vi.fn(), isTauri: () => true, logToTerminal: () => {},
  getSetting: () => null, setSetting: () => {},
  whitePoints: vi.fn(async (paths: string[]) => paths.map(() => [0.31, 0.32])),
  catalogMetadata: vi.fn(async (paths: string[]) => paths.map(() => ({ camera: 'Fujifilm X-T30 II', date: null, simulation: 'classic-chrome' }))),
  embeddedMetadata: vi.fn(async (paths: string[]) => paths.map(() => null)),
}));
import { catalogMetadata, scanFolder, type ScanResult } from '../backend/api';
import { cacheFolder, catalogPhotos, saveCollection } from './catalog';
import { saveFolderImport } from './folders';
import { selectSource, useApp, withCaptures, type Photo } from './store';
import { uneditedRecipe } from '../film/recipe';

const settle = async () => { for (let i = 0; i < 200; i++) await new Promise(r => setTimeout(r, 0)); };
const entry = (root: string, i: number) => ({ path: `${root}/${i}.RAF`, rel: `${i}.RAF`, name: `${i}.RAF`, size: 1, modified: 1, recipe: null, rating: 0, label: null, flag: null, raw: true });
/** A catalog entry from before the simulation was read: camera and date only. */
const old = (root: string, i: number): Photo => ({ ...entry(root, i), seed: 1, white: [0.31, 0.32], pair: null, capture: { camera: 'Fujifilm X-T30 II', date: null } } as Photo);

it('reads the film simulation of a RAW from an older catalog as soon as it is opened or exported', async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
  // A big folder from an older catalog, whose background pass is held after its first batch.
  const root = '/japan', count = 3000;
  const scan: ScanResult = { root, name: 'japan', unreadable: 0, focus: null, folders: [], entries: Array.from({ length: count }, (_, i) => entry(root, i)) };
  vi.mocked(scanFolder).mockImplementation(async () => scan);
  cacheFolder(root, Array.from({ length: count }, (_, i) => old(root, i)));
  saveFolderImport(root, { mode: 'sync', includeSubfolders: false });
  saveCollection({ id: 'japan', name: 'Japan', type: 'smart', rules: [{ field: 'rating', value: 0 }], createdAt: 1 });
  const answer = vi.mocked(catalogMetadata).getMockImplementation()!;
  let release!: () => void;
  const held = new Promise<void>(r => { release = r; });
  vi.mocked(catalogMetadata).mockImplementation(async (paths) => {
    if (!paths.includes(`${root}/0.RAF`) && paths.length > 1) await held;
    return answer(paths);
  });

  await selectSource({ type: 'collection', id: 'japan' });
  await settle();
  const photos = () => useApp.getState().photos;
  expect(photos()).toHaveLength(count);
  // The first batch is applied at once instead of after 1,024 photos.
  expect(photos().find(p => p.path === `${root}/0.RAF`)?.capture?.simulation).toBe('classic-chrome');
  const later = photos().find(p => p.path === `${root}/2500.RAF`)!;
  expect(later.capture?.simulation).toBeUndefined();
  expect(uneditedRecipe(later).stock).toBe('emulsion-standard');

  // Opening it in Develop (or exporting it) reads it now, ahead of the pass, and stores it.
  const [read] = await withCaptures([later]);
  expect(read.capture?.simulation).toBe('classic-chrome');
  expect(uneditedRecipe(read).stock).toBe('emulsion-fuji-classic-chrome');
  expect(photos().find(p => p.path === later.path)?.capture?.simulation).toBe('classic-chrome');
  expect(catalogPhotos().find(p => p.path === later.path)?.capture?.simulation).toBe('classic-chrome');

  // A photo already read isn't read again, and two calls at once share one read.
  vi.mocked(catalogMetadata).mockClear();
  await withCaptures([read]);
  expect(catalogMetadata).not.toHaveBeenCalled();
  const other = photos().find(p => p.path === `${root}/2600.RAF`)!;
  const [a, b] = await Promise.all([withCaptures([other]), withCaptures([other])]);
  expect(catalogMetadata).toHaveBeenCalledTimes(1);
  expect([a[0].capture?.simulation, b[0].capture?.simulation]).toEqual(['classic-chrome', 'classic-chrome']);

  release();
  await settle();
  expect(photos().every(p => p.capture?.simulation === 'classic-chrome')).toBe(true);
}, 30000);
