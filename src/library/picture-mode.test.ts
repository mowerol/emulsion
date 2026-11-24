// SPDX-License-Identifier: GPL-3.0-or-later
// A RAW shot in a camera's black and white or sepia picture mode (Panasonic Film Mode, OM System
// Monochrome Profile, Sony Creative Style, Canon Picture Style...; src-tauri/src/picture_mode.rs)
// opens in black and white, as a Fujifilm RAW opens with its film simulation. Catalogs read before
// picture modes were (2026-11-23) have those RAWs with no look, so they are read again once.
import { expect, it, vi } from 'vitest';
vi.mock('../backend/api', () => ({
  scanFolder: vi.fn(), writeSidecar: vi.fn(async () => {}), thumbnail: vi.fn(), isTauri: () => true, logToTerminal: () => {},
  getSetting: () => null, setSetting: () => {},
  catalogMetadata: vi.fn(async (paths: string[]) => paths.map(() => ({ camera: 'Panasonic DMC-LX3', date: null, simulation: 'bw-dynamic' }))),
  embeddedMetadata: vi.fn(async (paths: string[]) => paths.map(() => null)),
}));
import { catalogMetadata } from '../backend/api';
import { uneditedRecipe } from '../film/recipe';
import { cacheFolder } from './catalog';
import { captureUnread, withCaptures, type Photo } from './store';

const raw = (path: string, capture: Photo['capture']) =>
  ({ path, rel: path, name: path, size: 1, modified: 1, recipe: null, rating: 0, label: null, flag: null, raw: !/\.jpe?g$/i.test(path), capture } as Photo);

it('opens a RAW shot in black and white or sepia with the matching look', () => {
  const look = (simulation: string) => uneditedRecipe({ raw: true, capture: { simulation } }).stock;
  expect(look('bw')).toBe('emulsion-bw-classic');
  expect(look('bw-dynamic')).toBe('emulsion-bw-dynamic');
  expect(look('sepia')).toBe('emulsion-fuji-sepia');
  // A JPEG is already developed by its camera, black and white or not.
  expect(uneditedRecipe({ raw: false, capture: { simulation: 'bw' } }).stock).toBe('neutral');
});

it('reads again once the RAWs an older catalog read without a look', async () => {
  const old = raw('/lx3/P1080050.RW2', { camera: 'Panasonic DMC-LX3', date: null, simulation: null });
  expect(captureUnread(old)).toBe(true);
  // Read since picture modes were, a RAW without a look; or one with a film simulation: not again.
  expect(captureUnread(raw('/lx3/P1080505.RW2', { camera: 'Panasonic DMC-LX3', date: null, lens: null, simulation: null, read: 2 }))).toBe(false);
  expect(captureUnread({ ...raw('/x/DSCF1.RAF', { camera: 'Fujifilm X-T30 II', date: null, lens: null, simulation: 'provia' }), cameraFrame: null })).toBe(false);
  expect(captureUnread(raw('/lx3/P1080050.JPG', { camera: 'Panasonic DMC-LX3', date: null, lens: null }))).toBe(false);

  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  cacheFolder('/lx3', [old]);
  const [read] = await withCaptures([old]);
  expect(catalogMetadata).toHaveBeenCalledWith([old.path]);
  expect(read.capture).toEqual(expect.objectContaining({ simulation: 'bw-dynamic', read: 2 }));
  expect(captureUnread(read)).toBe(false);
  expect(uneditedRecipe(read).stock).toBe('emulsion-bw-dynamic');
});
