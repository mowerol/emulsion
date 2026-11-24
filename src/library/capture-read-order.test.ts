// SPDX-License-Identifier: GPL-3.0-or-later
// A new capture field (lens, ISO, focal length; 2026-11-23) means reading every catalog photo
// again: 88,000 on Oli's catalog, about 20 minutes in a debug build. The pass read them in catalog
// order, so the collection on screen could wait for most of it before its filters had anything.
import { expect, it, vi } from 'vitest';
vi.mock('../backend/api', () => ({
  scanFolder: vi.fn(), writeSidecar: vi.fn(async () => {}), thumbnail: vi.fn(), isTauri: () => true, logToTerminal: () => {},
  getSetting: () => null, setSetting: () => {},
  whitePoints: vi.fn(async (paths: string[]) => paths.map(() => [0.31, 0.32])),
  catalogMetadata: vi.fn(async (paths: string[]) => paths.map(() => ({ camera: 'Fujifilm X-T30 II', date: null, simulation: null, lens: 'XF27mmF2.8 R WR', iso: 640 }))),
  embeddedMetadata: vi.fn(async (paths: string[]) => paths.map(() => null)),
}));
import { catalogMetadata, scanFolder } from '../backend/api';
import { cacheFolder, saveCollection } from './catalog';
import { saveFolderImport } from './folders';
import { selectSource, sourcePhotos, type Photo } from './store';

const settle = async () => { for (let i = 0; i < 200; i++) await new Promise(r => setTimeout(r, 0)); };
/** A catalog entry read before lenses were: camera and date only. */
const old = (root: string, i: number): Photo => ({ path: `${root}/${i}.RAF`, rel: `${i}.RAF`, name: `${i}.RAF`, size: 1, modified: 1, recipe: null, rating: 0, label: null, flag: null,
  raw: true, seed: 1, white: [0.31, 0.32], pair: null, capture: { camera: 'Fujifilm X-T30 II', date: null, simulation: null } } as Photo);

it("reads the shown collection's photos before the rest of the catalog", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
  const sizes: Record<string, number> = { '/a': 3000, '/z': 40 };
  vi.mocked(scanFolder).mockImplementation(async root => ({ root, name: root.slice(1), unreadable: 0, focus: null, folders: [],
    entries: Array.from({ length: sizes[root] }, (_, i) => { const { path, rel, name, size, modified, recipe, rating, label, flag, raw } = old(root, i); return { path, rel, name, size, modified, recipe, rating, label, flag, raw }; }) }));
  // The collection's folder comes last in the catalog, behind a big one.
  for (const [root, count] of Object.entries(sizes)) {
    cacheFolder(root, Array.from({ length: count }, (_, i) => old(root, i)));
    saveFolderImport(root, { mode: 'sync', includeSubfolders: false });
  }
  saveCollection({ id: 'z', name: 'Z', type: 'smart', rules: [{ field: 'folder', value: '/z' }], createdAt: 1 });
  // Hold every read of the other folder.
  const answer = vi.mocked(catalogMetadata).getMockImplementation()!;
  let release!: () => void;
  const held = new Promise<void>(r => { release = r; });
  vi.mocked(catalogMetadata).mockImplementation(async paths => {
    if (paths.some(p => p.startsWith('/a/'))) await held;
    return answer(paths);
  });

  await selectSource({ type: 'collection', id: 'z' });
  await settle();
  const shown = sourcePhotos();
  expect(shown).toHaveLength(40);
  expect(shown.every(p => p.capture?.lens === 'XF27mmF2.8 R WR' && p.capture.iso === 640)).toBe(true);
  release();
  await settle();
});
