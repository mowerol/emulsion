// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it, vi } from 'vitest';
const gpu = vi.hoisted(() => ({ maxTextureSize: 4096, sourceFromHalf: vi.fn(() => ({})), prepare: vi.fn(),
  readPixels: vi.fn(() => new Uint8Array(8)), release: vi.fn(), dropBuffers: vi.fn() }));
vi.mock('./thumbs', () => ({ offscreenEngine: () => gpu, ensureCapture: vi.fn() }));
vi.mock('../backend/api', () => ({
  loadImage: vi.fn(async () => ({ width: 2, height: 1 })),
  writeExport: vi.fn(async (_dir: string, stem: string) => `/exports/${stem}.jpg`),
}));
import { loadImage, writeExport } from '../backend/api';
import { defaultRecipe } from '../film/recipe';
import { exportPhotos } from './export';
import type { Photo } from './store';

it('exports each version with its own recipe, a distinct name and the real source path', async () => {
  const original: Photo = { path: '/a.jpg', rel: 'a.jpg', name: 'a.jpg', size: 1, modified: 0, recipe: null,
    seed: 1, white: null, rating: 0, label: null, heart: false, raw: false, pair: null };
  const versions = [original, ...['one', 'two'].map((copyId, i) => ({ ...original, copyId, copyName: 'Warm', recipe: { ...defaultRecipe(), exposure: i + 1 } }))];
  const result = await exportPhotos(versions, { dir: '/exports', longEdge: null, quality: 92 }, vi.fn(), { canceled: false });
  expect(result.failed).toEqual([]);
  expect(new Set(result.written).size).toBe(3);
  expect(loadImage).toHaveBeenCalledTimes(3);
  expect(vi.mocked(loadImage).mock.calls.every(([path]) => path === '/a.jpg')).toBe(true);
  expect(gpu.readPixels.mock.calls.map(c => (c as unknown[])[1])).toEqual(versions.map(p => p.recipe));
  expect(writeExport).toHaveBeenCalledWith('/exports', 'a_Warm_one', expect.any(Uint8Array), 2, 1, 92);
});
