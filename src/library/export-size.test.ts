// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it, vi } from 'vitest';
vi.mock('./stillclient', () => ({ stillEngine: () => null, StillsLost: class extends Error {} }));
vi.mock('./thumbs', () => ({ ensureCapture: vi.fn() }));
// A 6000 × 4000 photo, decoded fitted to the edge asked for (as the Rust decoder does).
vi.mock('../backend/api', () => ({
  loadImage: vi.fn(async (_path: string, edge: number) => {
    const s = Math.min(1, edge / 6000);
    return { width: Math.round(6000 * s), height: Math.round(4000 * s), fullWidth: 6000, fullHeight: 4000 };
  }),
  checkExportDir: vi.fn(async () => {}),
  ExportWriteError: class extends Error { constructor(m: string, readonly stop: boolean) { super(m); } },
  writeExport: vi.fn(),
}));
import { loadImage } from '../backend/api';
import { defaultRecipe } from '../film/recipe';
import { FULL } from '../film/crop';
import { decodeFor } from './export';
import type { Photo } from './store';

const photo = (crop: typeof FULL | null): Photo => ({ path: '/a.ORF', rel: 'a.ORF', name: 'a.ORF', size: 1, modified: 0,
  recipe: { ...defaultRecipe(), crop }, seed: 1, white: null, rating: 0, label: null, heart: false, raw: true, pair: null });
const size = async (crop: typeof FULL | null, edge: number | null, max = 16384) => (await decodeFor(photo(crop), edge, max)).slice(0, 2);

it('gives the uncropped photo the long edge asked for', async () => {
  expect(await size(null, 2048)).toEqual([2048, 1365]);
  expect(await size(null, null)).toEqual([6000, 4000]);
});

it('applies the long edge to the cropped frame, not the whole photo', async () => {
  // Half the width and height: 3000 × 2000 at full size.
  const half = { ...FULL, x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  expect(await size(half, 2048)).toEqual([2048, 1365]);
  expect(vi.mocked(loadImage).mock.lastCall?.[1]).toBe(4096);
  // A tall, narrow crop: 1200 × 3200 at full size, so its long edge is the height.
  const tall = { ...FULL, x: 0.4, y: 0.1, w: 0.2, h: 0.8 };
  expect(await size(tall, 2560)).toEqual([960, 2560]);
  // At full size the crop is the crop of the full photo.
  expect(await size(half, null)).toEqual([3000, 2000]);
});

it('never upscales past the photo or the GPU limit', async () => {
  const small = { ...FULL, w: 0.25, h: 0.25 };
  expect(await size(small, 4096)).toEqual([1500, 1000]);
  expect(await size(null, 8192, 4096)).toEqual([4096, 2731]);
});
