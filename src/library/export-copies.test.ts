// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, expect, it, vi } from 'vitest';
const gpu = vi.hoisted(() => ({ ready: Promise.resolve(4096), upload: vi.fn(() => ({ key: 1, w: 2, h: 1, fullW: 160, fullH: 120, mode: 0, white: null })),
  removeInput: vi.fn(async () => ({ image: new Uint8Array(512 * 512 * 4), mask: new Uint8Array(512 * 512) })),
  pixels: vi.fn(async (..._args: unknown[]) => new Uint8Array(8)), release: vi.fn(), dropBuffers: vi.fn() }));
vi.mock('./stillclient', () => ({ stillEngine: () => gpu, StillsLost: class extends Error {} }));
vi.mock('./thumbs', () => ({ ensureCapture: vi.fn() }));
vi.mock('../backend/api', () => ({
  loadImage: vi.fn(async () => ({ width: 2, height: 1 })),
  removeInpaint: vi.fn(async () => new Uint8Array(512 * 512 * 4)),
  checkExportDir: vi.fn(async () => {}),
  ExportWriteError: class extends Error { constructor(m: string, readonly stop: boolean) { super(m); } },
  writeExport: vi.fn(async (_dir: string, stem: string) => `/exports/${stem}.jpg`),
}));
import { loadImage, writeExport, removeInpaint } from '../backend/api';
import { defaultRecipe } from '../film/recipe';
import { exportPhotos } from './export';
import { newCircleSpot } from '../film/retouch';
import type { Photo } from './store';

beforeEach(() => { vi.clearAllMocks(); vi.mocked(removeInpaint).mockReset().mockResolvedValue(new Uint8Array(512 * 512 * 4)); });

it('requests the shared denoised source for RAW exports and surfaces failures', async () => {
  const recipe = { ...defaultRecipe(), noiseReduction: { enabled: true, amount: 42, model: 'rawnind-linear-v1' as const } };
  const photo: Photo = { path: '/test.ORF', rel: 'test.ORF', name: 'test.ORF', size: 1, modified: 0, recipe,
    seed: 1, white: null, rating: 0, label: null, heart: false, raw: true, pair: null };
  const options = { dir: '/exports', longEdge: null, quality: 92 };
  const result = await exportPhotos([photo], options, vi.fn(), { canceled: false });
  expect(result.failed).toEqual([]);
  expect(loadImage).toHaveBeenLastCalledWith('/test.ORF', 4096, true);
  vi.mocked(loadImage).mockRejectedValueOnce(new Error('Model missing'));
  const failed = await exportPhotos([photo], options, vi.fn(), { canceled: false });
  expect(failed.written).toEqual([]);
  expect(failed.failed[0].error).toContain('Model missing');
  vi.mocked(loadImage).mockClear(); vi.mocked(writeExport).mockClear(); gpu.pixels.mockClear();
});

it('exports each version with its own recipe, a distinct name and the real source path', async () => {
  const original: Photo = { path: '/a.jpg', rel: 'a.jpg', name: 'a.jpg', size: 1, modified: 0, recipe: null,
    seed: 1, white: null, rating: 0, label: null, heart: false, raw: false, pair: null };
  const versions = [original, ...['one', 'two'].map((copyId, i) => ({ ...original, copyId, copyName: 'Warm', recipe: { ...defaultRecipe(), exposure: i + 1 } }))];
  const result = await exportPhotos(versions, { dir: '/exports', longEdge: null, quality: 92 }, vi.fn(), { canceled: false });
  expect(result.failed).toEqual([]);
  expect(new Set(result.written).size).toBe(3);
  expect(loadImage).toHaveBeenCalledTimes(3);
  expect(vi.mocked(loadImage).mock.calls.every(([path]) => path === '/a.jpg')).toBe(true);
  // The unedited original exports as Neutral at its defaults.
  expect(gpu.pixels.mock.calls.map(c => (c as unknown[])[1])).toEqual(versions.map(p => p.recipe ?? defaultRecipe()));
  expect(writeExport).toHaveBeenCalledWith('/exports', 'a_Warm_one', expect.any(Uint8Array), 2, 1, 92);
});


const removalPhoto: Photo = { path: '/remove.jpg', rel: 'remove.jpg', name: 'remove.jpg', size: 1, modified: 0,
  recipe: { ...defaultRecipe(), retouch: [newCircleSpot([.5, .5], 'remove', .1, .02)] },
  seed: 1, white: null, rating: 0, label: null, heart: false, raw: false, pair: null };

it('waits for Remove before rendering or writing and uses the original resolution even for small exports', async () => {
  let release!: (pixels: Uint8Array) => void;
  vi.mocked(removeInpaint).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const result = exportPhotos([removalPhoto], { dir: '/exports', longEdge: 1, quality: 92 }, vi.fn(), { canceled: false });
  await vi.waitFor(() => expect(removeInpaint).toHaveBeenCalledTimes(1));
  expect(loadImage).toHaveBeenCalledWith('/remove.jpg', 4096, false);
  expect(gpu.pixels).not.toHaveBeenCalled();
  expect(writeExport).not.toHaveBeenCalled();
  release(new Uint8Array(512 * 512 * 4));
  expect((await result).written).toHaveLength(1);
  expect(gpu.pixels).toHaveBeenCalledTimes(1);
  expect(gpu.release).toHaveBeenCalledTimes(1);
});

it('names the failed photo and writes nothing when Remove cannot be filled', async () => {
  vi.mocked(removeInpaint).mockRejectedValueOnce(new Error('Remove model missing'));
  const result = await exportPhotos([removalPhoto], { dir: '/exports', longEdge: null, quality: 92 }, vi.fn(), { canceled: false });
  expect(result.failed).toEqual([{ name: 'remove.jpg', error: 'Remove model missing' }]);
  expect(writeExport).not.toHaveBeenCalled();
  expect(gpu.pixels).not.toHaveBeenCalled();
  expect(gpu.release).toHaveBeenCalledTimes(1);
});

it('cancels an export awaiting native Remove without writing its eventual result', async () => {
  const signal = { canceled: false };
  let release!: (pixels: Uint8Array) => void;
  vi.mocked(removeInpaint).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = exportPhotos([removalPhoto], { dir: '/exports', longEdge: null, quality: 92 }, vi.fn(), signal);
  await vi.waitFor(() => expect(removeInpaint).toHaveBeenCalledTimes(1));
  signal.canceled = true; release(new Uint8Array(512 * 512 * 4));
  const result = await pending;
  expect(result.canceled).toBe(true);
  expect(writeExport).not.toHaveBeenCalled();
  expect(gpu.release).toHaveBeenCalledTimes(1);
});

it('waits for consent before exporting a named photo with an unfilled Remove', async () => {
  vi.mocked(removeInpaint).mockRejectedValueOnce(new Error('Remove model missing'));
  let answer!: (proceed: boolean) => void;
  const warn = vi.fn(() => new Promise<boolean>(resolve => { answer = resolve; }));
  const result = exportPhotos([removalPhoto], { dir: '/exports', longEdge: null, quality: 92 }, vi.fn(), { canceled: false }, warn);
  await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(removalPhoto, 'Error: Remove model missing'));
  expect(gpu.pixels).not.toHaveBeenCalled();
  expect(writeExport).not.toHaveBeenCalled();
  answer(true);
  expect((await result).written).toHaveLength(1);
  expect(gpu.pixels).toHaveBeenCalledTimes(1);
});

it('stops without writing when the user declines export with an unfilled Remove', async () => {
  vi.mocked(removeInpaint).mockRejectedValueOnce(new Error('Remove model missing'));
  const signal = { canceled: false };
  const warn = vi.fn(async () => { signal.canceled = true; return false; });
  const result = await exportPhotos([removalPhoto], { dir: '/exports', longEdge: null, quality: 92 }, vi.fn(), signal, warn);
  expect(result.canceled).toBe(true);
  expect(writeExport).not.toHaveBeenCalled();
  expect(gpu.release).toHaveBeenCalledTimes(1);
});

it('retains completed earlier patches when export continues past a later failed Remove', async () => {
  vi.mocked(removeInpaint).mockResolvedValueOnce(new Uint8Array(512 * 512 * 4)).mockRejectedValueOnce(Error('inference failed'));
  const p = { ...removalPhoto, recipe: { ...removalPhoto.recipe!, retouch: [...removalPhoto.recipe!.retouch, newCircleSpot([.6, .6], 'remove')] } };
  let filled: number | undefined;
  gpu.pixels.mockImplementationOnce(async (...args: unknown[]) => { filled = (args[5] as { patches: Map<string, unknown> } | null)?.patches.size; return new Uint8Array(8); });
  const result = await exportPhotos([p], { dir: '/exports', longEdge: null, quality: 92 }, vi.fn(), { canceled: false }, async () => true);
  expect(result.failed).toEqual([]);
  expect(filled).toBe(1);
});

const plain: Photo = { path: '/p.jpg', rel: 'p.jpg', name: 'p.jpg', size: 1, modified: 0, recipe: null,
  seed: 1, white: null, rating: 0, label: null, heart: false, raw: false, pair: null };
const opts = { dir: '/exports', longEdge: null, quality: 92 };

it('checks the destination before developing anything', async () => {
  const { checkExportDir } = await import('../backend/api');
  vi.mocked(checkExportDir).mockRejectedValueOnce(new Error('Could not create /exports: the disk is read-only'));
  await expect(exportPhotos([plain], opts, vi.fn(), { canceled: false })).rejects.toThrow('read-only');
  expect(loadImage).not.toHaveBeenCalled();
});

it('retries a photo once on a fresh engine when the engine stops under it', async () => {
  const { StillsLost } = await import('./stillclient');
  gpu.pixels.mockRejectedValueOnce(new StillsLost('context lost'));
  const result = await exportPhotos([plain, plain], opts, vi.fn(), { canceled: false });
  expect(result.failed).toEqual([]);
  expect(result.written).toHaveLength(2);
  expect(gpu.pixels).toHaveBeenCalledTimes(3);
  // Lost twice in a row: that photo fails, the next one still exports.
  gpu.pixels.mockClear();
  gpu.pixels.mockRejectedValueOnce(new StillsLost('context lost')).mockRejectedValueOnce(new StillsLost('context lost again'));
  const twice = await exportPhotos([plain, plain], opts, vi.fn(), { canceled: false });
  expect(twice.failed).toEqual([{ name: 'p.jpg', error: 'context lost again' }]);
  expect(twice.written).toHaveLength(1);
});

it('stops the whole export when the destination fails, but not when one frame does', async () => {
  const { ExportWriteError } = await import('../backend/api');
  vi.mocked(writeExport).mockRejectedValueOnce(new ExportWriteError('Could not encode JPEG: bad', false));
  const one = await exportPhotos([plain, plain], opts, vi.fn(), { canceled: false });
  expect(one.failed).toEqual([{ name: 'p.jpg', error: 'Could not encode JPEG: bad' }]);
  expect(one.written).toHaveLength(1);
  expect(one.stopped).toBeUndefined();
  vi.mocked(writeExport).mockRejectedValueOnce(new ExportWriteError('Could not write /exports/p.jpg: the disk is full', true));
  const full = await exportPhotos([plain, plain, plain], opts, vi.fn(), { canceled: false });
  expect(full.stopped).toBe('Could not write /exports/p.jpg: the disk is full');
  expect(full.written).toHaveLength(0);
  expect(loadImage).toHaveBeenCalledTimes(3);
});
