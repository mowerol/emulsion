// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../backend/api', async (original) => ({
  ...await original<typeof import('../backend/api')>(),
  isTauri: () => true,
  skyMaskStatus: vi.fn(async () => ({ supported: true, installed: true, download: 0 })),
  skyMaskInstall: vi.fn(async () => {}),
  segmentSky: vi.fn(async () => new Uint8Array([255, 255, 0, 0])),
  writeSidecar: vi.fn(async () => {}),
  logToTerminal: () => {},
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }));

import { segmentSky, skyMaskInstall, skyMaskStatus } from '../backend/api';
import { MAX_OBJECTS, newMask, type SkyShape } from '../film/masks';
import { decodeRaster, encodeRaster } from '../film/objectmask';
import { activePhoto, editActive, redo, undo, useApp } from '../library/store';
import { defaultRecipe } from '../film/recipe';
import { setMaskUi } from './maskui';
import { setObjectRenderer } from './objectselect';
import { cancelSkySelect, installSkyModel, retrySkySelect, selectSky, useSkySelect } from './skyselect';

const photo = (path: string, copyId?: string) => ({ path, copyId, rel: path, name: path, size: 1, modified: 0, recipe: null, seed: 1, white: null, rating: 0, label: null, flag: null, raw: false, pair: null });
const pixels = new Uint8Array(16);
const raster = encodeRaster(new Uint8Array([255, 255, 0, 0]), 2, 2);
const sky = (): SkyShape => ({ id: 'sky', kind: 'sky', mode: 'add', opacity: 1, invert: false, raster });
const masks = () => activePhoto()?.recipe?.masks ?? [];
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

describe('automatic sky selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(skyMaskStatus).mockResolvedValue({ supported: true, installed: true, download: 0 });
    vi.mocked(skyMaskInstall).mockResolvedValue();
    vi.mocked(segmentSky).mockResolvedValue(new Uint8Array([255, 255, 0, 0]));
    useApp.setState({ photos: [photo('a'), photo('b'), photo('a', 'copy')], active: 0, selected: new Set(['a']) });
    setMaskUi({ selected: null, shape: null, tool: null });
    cancelSkySelect();
    setObjectRenderer(() => ({ key: activePhoto()?.path ?? '', w: 2, h: 2, pixels: () => pixels }));
  });
  afterEach(() => { cancelSkySelect(); setObjectRenderer(null); });

  it('creates a saved raster with no object prompts in one undo step', async () => {
    await selectSky();
    expect(segmentSky).toHaveBeenCalledWith(pixels, 2, 2);
    const mask = masks()[0];
    expect(mask).toMatchObject({ name: 'Sky', shapes: [{ kind: 'sky', raster }] });
    expect(decodeRaster((mask.shapes[0] as SkyShape).raster)).toEqual(new Uint8Array([255, 255, 0, 0]));
    undo();
    expect(masks()).toEqual([]);
    redo();
    expect(masks()).toEqual([mask]);
  });

  it('waits for explicit download consent, then selects automatically', async () => {
    vi.mocked(skyMaskStatus).mockResolvedValue({ supported: true, installed: false, download: 88084505 });
    await selectSky();
    expect(useSkySelect.getState()).toMatchObject({ phase: 'missing', download: 88084505 });
    expect(skyMaskInstall).not.toHaveBeenCalled();
    expect(segmentSky).not.toHaveBeenCalled();
    expect(masks()).toEqual([]);
    await installSkyModel();
    expect(skyMaskInstall).toHaveBeenCalledOnce();
    expect(masks()[0].name).toBe('Sky');
  });

  it('lets a new frame join a consented download without running the old selection', async () => {
    const work = deferred<void>();
    vi.mocked(skyMaskStatus).mockResolvedValue({ supported: true, installed: false, download: 88084505 });
    vi.mocked(skyMaskInstall).mockReturnValue(work.promise);
    await selectSky();
    const downloading = installSkyModel();
    await vi.waitFor(() => expect(skyMaskInstall).toHaveBeenCalledOnce());
    useApp.setState({ active: 1 });
    const selecting = selectSky();
    await vi.waitFor(() => expect(useSkySelect.getState().phase).toBe('downloading'));
    work.resolve();
    await Promise.all([downloading, selecting]);
    expect(segmentSky).toHaveBeenCalledOnce();
    expect(useApp.getState().photos[0].recipe).toBeNull();
    expect(useApp.getState().photos[1].recipe?.masks[0].name).toBe('Sky');
    expect(skyMaskInstall).toHaveBeenCalledOnce();
  });

  it('recovers from a failed download without creating an empty mask', async () => {
    vi.mocked(skyMaskStatus).mockResolvedValue({ supported: true, installed: false, download: 88084505 });
    vi.mocked(skyMaskInstall).mockRejectedValueOnce(new Error('Download failed'));
    await selectSky();
    await installSkyModel();
    expect(useSkySelect.getState()).toMatchObject({ phase: 'error', error: 'Download failed' });
    expect(masks()).toEqual([]);
    await retrySkySelect();
    await installSkyModel();
    expect(masks()).toHaveLength(1);
  });

  it('adds and subtracts within the requested mask, preserving its edits', async () => {
    const base = { ...newMask(sky(), 0), exposure: -1 };
    editActive(() => ({ ...defaultRecipe(), masks: [base] }));
    setMaskUi({ selected: base.id });
    await selectSky('subtract');
    expect(masks()).toHaveLength(1);
    expect(masks()[0]).toMatchObject({ exposure: -1, shapes: [{ id: 'sky' }, { kind: 'sky', mode: 'subtract' }] });
    await selectSky('add');
    expect(masks()[0].shapes[2]).toMatchObject({ kind: 'sky', mode: 'add' });
  });

  it.each([1, 2])('discards a result after switching to another frame (%s), even on the same source', async (active) => {
    const work = deferred<Uint8Array>();
    vi.mocked(segmentSky).mockReturnValue(work.promise);
    const selecting = selectSky();
    await vi.waitFor(() => expect(segmentSky).toHaveBeenCalledOnce());
    useApp.setState({ active });
    // Returning before inference finishes must not revive the old request.
    useApp.setState({ active: 0 });
    work.resolve(new Uint8Array([255, 255, 0, 0]));
    await selecting;
    expect(useApp.getState().photos.every((p) => !p.recipe)).toBe(true);
    expect(useSkySelect.getState().phase).toBe('idle');
  });

  it('discards a result after Cancel and ignores duplicate requests', async () => {
    const work = deferred<Uint8Array>();
    vi.mocked(segmentSky).mockReturnValue(work.promise);
    const selecting = selectSky();
    await vi.waitFor(() => expect(segmentSky).toHaveBeenCalledOnce());
    await selectSky();
    expect(segmentSky).toHaveBeenCalledOnce();
    cancelSkySelect();
    work.resolve(new Uint8Array([255, 255, 0, 0]));
    await selecting;
    expect(masks()).toEqual([]);
  });

  it('rejects a result when lens geometry changed during inference', async () => {
    const work = deferred<Uint8Array>();
    vi.mocked(segmentSky).mockReturnValue(work.promise);
    const selecting = selectSky();
    await vi.waitFor(() => expect(segmentSky).toHaveBeenCalledOnce());
    setObjectRenderer(() => ({ key: 'new lens geometry', w: 2, h: 2, pixels: () => pixels }));
    work.resolve(new Uint8Array([255, 255, 0, 0]));
    await selecting;
    expect(masks()).toEqual([]);
    expect(useSkySelect.getState()).toMatchObject({ phase: 'error', error: expect.stringContaining('geometry changed') });
  });

  it('does not recreate a destination mask removed during inference', async () => {
    const base = newMask(sky(), 0);
    editActive(() => ({ ...defaultRecipe(), masks: [base] }));
    setMaskUi({ selected: base.id });
    const work = deferred<Uint8Array>();
    vi.mocked(segmentSky).mockReturnValue(work.promise);
    const selecting = selectSky('add');
    await vi.waitFor(() => expect(segmentSky).toHaveBeenCalledOnce());
    editActive((r) => ({ ...r!, masks: [] }));
    work.resolve(new Uint8Array([255, 255, 0, 0]));
    await selecting;
    expect(masks()).toEqual([]);
    expect(useSkySelect.getState()).toMatchObject({ phase: 'error', error: expect.stringContaining('removed') });
  });

  it('does not run beyond the shared object/sky texture budget', async () => {
    editActive(() => ({ ...defaultRecipe(), masks: [{ ...newMask(sky(), 0), shapes: Array.from({ length: MAX_OBJECTS }, sky) }] }));
    await selectSky();
    expect(segmentSky).not.toHaveBeenCalled();
  });

  it('reports an inference failure without changing the recipe, and retries', async () => {
    vi.mocked(segmentSky).mockRejectedValueOnce(new Error('Inference failed'));
    await selectSky();
    expect(masks()).toEqual([]);
    expect(useSkySelect.getState()).toMatchObject({ phase: 'error', error: 'Inference failed' });
    await retrySkySelect();
    expect(masks()).toHaveLength(1);
  });

  it('does not install or infer on an unsupported machine', async () => {
    vi.mocked(skyMaskStatus).mockResolvedValue({ supported: false, installed: false, download: 0 });
    await selectSky();
    expect(useSkySelect.getState().phase).toBe('unsupported');
    expect(skyMaskInstall).not.toHaveBeenCalled();
    expect(segmentSky).not.toHaveBeenCalled();
  });
});
