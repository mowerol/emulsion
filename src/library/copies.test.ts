// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../backend/api', () => ({
  scanFolder: vi.fn(), whitePoints: vi.fn(() => Promise.resolve([])),
  writeSidecar: vi.fn(() => Promise.resolve()), thumbnail: vi.fn(),
  isTauri: () => false, logToTerminal: () => {},
}));
import { scanFolder, writeSidecar, type Saved, type ScanResult } from '../backend/api';
import { defaultRecipe } from '../film/recipe';
import { FULL } from '../film/crop';
import { NO_FILTER } from './filter';
import { exportStem, expandCopies, photoId, savedFrames } from './copies';
import { flushSaves } from './sidecars';
import {
  activePhoto, closeFolder, copySettings, createVirtualCopies, editActive, editRecipes,
  endLookEdit, finishCrop, importFolderPhotos, markPhotos, openFolder, pasteSettings,
  redo, removeVirtualCopies, renameVirtualCopy, selectAll, setActive, setCropDraft, setPhotoWhite,
  setFoldJpegs, setIncludeSubfolders, startCrop, startLookEdit, undo, useApp, type Photo,
} from './store';

const photo = (path = '/photos/a.jpg'): Photo => ({ path, rel: path.split('/').pop()!, name: path.split('/').pop()!,
  size: 1, modified: 0, recipe: null, seed: 123, white: null, rating: 0, label: null, heart: false, raw: false, pair: null });
let disk: Map<string, Saved>;
beforeEach(() => {
  vi.useFakeTimers();
  closeFolder();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
  vi.clearAllMocks();
  disk = new Map();
  vi.mocked(writeSidecar).mockImplementation(async (path, saved) => { disk.set(path, structuredClone(saved)); });
  vi.mocked(scanFolder).mockImplementation(async () => ({ root: '/photos', name: 'Photos', unreadable: 0, focus: null, folders: [],
    entries: [photo(), photo('/photos/b.jpg')].map(p => ({ ...p, ...disk.get(p.path) })) } as ScanResult));
  const a = photo(), b = photo('/photos/b.jpg');
  useApp.setState({ photos: [a, b], candidates: [a, b], hidden: [], active: 0, selected: new Set([a.path]),
    folder: { root: '/photos', name: 'Photos', unreadable: 0 }, filter: NO_FILTER, foldJpegs: true,
    view: 'library', developSize: null, cropEdit: null, lookEdit: null });
});
afterEach(async () => { await flushSaves(); vi.useRealTimers(); });

it('clones the edit, grain seed and marks, then edits and rates only the selected copy', async () => {
  editActive(() => ({ ...defaultRecipe(), exposure: 0.5, crop: { ...FULL, w: 0.8 } }));
  markPhotos({ rating: 4 });
  createVirtualCopies();
  const copy = activePhoto()!;
  expect(copy.path).toBe('/photos/a.jpg');
  expect(copy.copyName).toBe('Copy 1');
  expect(photoId(copy)).not.toBe(copy.path);
  const original = useApp.getState().photos[0];
  expect(copy.recipe).toEqual(original.recipe);
  expect(copy.recipe).not.toBe(original.recipe);
  expect(copy.seed).toBe(original.seed);
  expect(copy.rating).toBe(4);
  editActive(r => ({ ...r!, exposure: 2 }));
  markPhotos({ rating: 1 });
  expect(useApp.getState().photos[0]).toMatchObject({ recipe: { exposure: 0.5 }, rating: 4 });
  await flushSaves();
  expect(disk.get(copy.path)).toMatchObject({ recipe: { exposure: 0.5 }, rating: 4,
    copies: [{ id: copy.copyId, recipe: { exposure: 2 }, rating: 1 }] });
});

it('undoes and redoes edits, renaming, creation and removal with stable identities', () => {
  createVirtualCopies();
  const id = photoId(activePhoto()!);
  editActive(() => ({ ...defaultRecipe(), exposure: 1 }));
  renameVirtualCopy(id, 'Black and white');
  removeVirtualCopies();
  expect(useApp.getState().photos).toHaveLength(2);
  undo();
  expect(useApp.getState().photos.find(p => photoId(p) === id)).toMatchObject({ copyName: 'Black and white', recipe: { exposure: 1 } });
  undo();
  expect(useApp.getState().photos.find(p => photoId(p) === id)?.copyName).toBe('Copy 1');
  undo();
  expect(useApp.getState().photos.find(p => photoId(p) === id)?.recipe).toBeNull();
  undo();
  expect(useApp.getState().photos).toHaveLength(2);
  redo();
  expect(useApp.getState().photos.some(p => photoId(p) === id)).toBe(true);
  redo(); redo(); redo();
  expect(useApp.getState().photos).toHaveLength(2);
  expect(useApp.getState().photos.every(p => !p.copyId)).toBe(true);
});

it('survives flush, reopening and changing import scope without losing copies', async () => {
  importFolderPhotos({ mode: 'sync' });
  createVirtualCopies();
  renameVirtualCopy(photoId(activePhoto()!), 'Warm');
  editActive(() => ({ ...defaultRecipe(), exposure: 1.5 }));
  // Scope changes flush a newly created copy before rescanning.
  await setIncludeSubfolders(true);
  importFolderPhotos({ mode: 'sync' });
  expect(useApp.getState().photos.filter(p => p.copyId)).toHaveLength(1);
  closeFolder();
  await openFolder('/photos');
  const copies = useApp.getState().photos.filter(p => p.copyId);
  expect(copies).toHaveLength(1);
  expect(copies[0]).toMatchObject({ copyName: 'Warm', recipe: { exposure: 1.5 } });
});

it('persists several selected versions of the same source together, including reset', async () => {
  createVirtualCopies();
  createVirtualCopies();
  expect(useApp.getState().photos.filter(p => p.copyId).map(p => p.copyName)).toEqual(['Copy 1', 'Copy 2']);
  selectAll();
  editRecipes([...useApp.getState().selected], () => defaultRecipe());
  markPhotos({ heart: true });
  await flushSaves();
  expect(disk.get('/photos/a.jpg')?.copies?.every(p => p.heart && p.recipe)).toBe(true);
  editRecipes([...useApp.getState().selected], () => null);
  await flushSaves();
  expect(disk.get('/photos/a.jpg')?.copies).toHaveLength(2);
  // Mixed original/copy removal only removes virtual frames.
  removeVirtualCopies();
  expect(useApp.getState().photos.map(p => p.path)).toEqual(['/photos/a.jpg', '/photos/b.jpg']);
  await flushSaves();
  expect(disk.get('/photos/a.jpg')?.copies).toBeUndefined();
});

it('keeps copies beside their originals and independent under range and toggle selection', () => {
  createVirtualCopies();
  expect(useApp.getState().photos.map(p => p.name)).toEqual(['a.jpg', 'a.jpg', 'b.jpg']);
  setActive(0);
  setActive(1, 'toggle');
  expect(useApp.getState().selected.size).toBe(2);
  markPhotos({ label: 'red' });
  expect(useApp.getState().photos.map(p => p.label)).toEqual(['red', 'red', null]);
  setActive(0);
  setActive(2, 'range');
  expect(useApp.getState().selected.size).toBe(3);
});

it('keeps late source metadata through undo and keeps the active frame in the surviving selection', () => {
  createVirtualCopies();
  setPhotoWhite('/photos/a.jpg', [0.31, 0.33]);
  undo();
  expect(useApp.getState().photos[0].white).toEqual([0.31, 0.33]);
  redo();
  const copyId = photoId(activePhoto()!);
  const other = useApp.getState().photos.findIndex(p => p.name === 'b.jpg');
  setActive(other, 'toggle');
  setActive(useApp.getState().photos.findIndex(p => photoId(p) === copyId), 'keep');
  removeVirtualCopies();
  expect(activePhoto()?.name).toBe('b.jpg');
  expect(useApp.getState().selected).toEqual(new Set(['/photos/b.jpg']));
});

it('keeps RAW copies through pair folding and never hides a JPEG with versions', () => {
  const raw = { ...photo('/photos/a.RAF'), raw: true };
  const jpg = photo();
  useApp.setState({ photos: [raw, jpg], candidates: [raw, jpg], active: 0, selected: new Set([raw.path]), foldJpegs: false });
  createVirtualCopies();
  const rawCopyId = photoId(activePhoto()!);
  setFoldJpegs(true);
  expect(useApp.getState().photos).toHaveLength(2);
  expect(photoId(activePhoto()!)).toBe(rawCopyId);
  expect(activePhoto()!.pair).toBeNull();
  expect(useApp.getState().hidden).toHaveLength(1);
  setFoldJpegs(false);
  setActive(useApp.getState().photos.findIndex(p => p.path === jpg.path));
  createVirtualCopies();
  setFoldJpegs(true);
  expect(useApp.getState().photos).toHaveLength(4);
  expect(useApp.getState().hidden).toHaveLength(0);
});

it('saves a crop to its copy when switching to the original and pastes settings independently', () => {
  createVirtualCopies();
  const id = photoId(activePhoto()!);
  useApp.setState({ view: 'develop', developSize: { path: '/photos/a.jpg', W: 1000, H: 800 } });
  startCrop();
  expect(useApp.getState().cropEdit?.path).toBe(id);
  setCropDraft(c => ({ ...c, w: 0.7 }));
  setActive(0);
  expect(useApp.getState().photos[0].recipe).toBeNull();
  const copyIndex = useApp.getState().photos.findIndex(p => photoId(p) === id);
  expect(useApp.getState().photos[copyIndex].recipe?.crop?.w).toBe(0.7);
  editActive(() => ({ ...defaultRecipe(), exposure: 1 }));
  copySettings();
  setActive(copyIndex);
  pasteSettings();
  expect(activePhoto()?.recipe).toMatchObject({ exposure: 1, crop: { w: 0.7 } });
  finishCrop(false);
});

it('keeps a custom look draft confined to its frame and blocks copying a draft', () => {
  createVirtualCopies();
  const id = photoId(activePhoto()!);
  startLookEdit(id, 'look', 'Look', defaultRecipe());
  editActive(r => ({ ...r!, exposure: 3 }));
  createVirtualCopies();
  expect(useApp.getState().photos).toHaveLength(3);
  expect(useApp.getState().photos[0].recipe).toBeNull();
  expect(endLookEdit()?.exposure).toBe(3);
  expect(activePhoto()?.recipe).toBeNull();
});

it('validates saved versions and gives same-name copies distinct safe export stems', () => {
  const base = photo();
  const frames = expandCopies(base, [null, { id: '../bad' }, { id: 'one', name: '  Warm / Print  ', rating: 99 }, { id: 'one' }, { id: 'two', name: 'Warm / Print' }]);
  expect(frames).toHaveLength(3);
  expect(frames[1]).toMatchObject({ copyName: 'Warm / Print', rating: 5, recipe: null });
  expect(exportStem(frames[0])).toBe('a');
  expect(exportStem(frames[1])).not.toBe(exportStem(frames[2]));
  expect(exportStem(frames[1])).not.toContain('/');
  expect(new TextEncoder().encode(`${exportStem({ ...frames[1], name: '旅'.repeat(80) + '.jpg', copyName: '暖'.repeat(120), copyId: 'a'.repeat(80) })}.jpg`).length).toBeLessThanOrEqual(255);
  expect(savedFrames(frames).copies).toHaveLength(2);
});

it('undoes and redoes a look draft locally without persisting or consuming photo history', async () => {
  editActive(() => ({ ...defaultRecipe(), exposure: 1 }));
  await flushSaves();
  const before = useApp.getState().history;
  startLookEdit(photoId(activePhoto()!), 'draft', 'Draft', defaultRecipe());
  editActive(r => ({ ...r!, contrast: 30 }));
  undo();
  expect(activePhoto()?.recipe?.contrast).toBe(0);
  redo();
  expect(activePhoto()?.recipe?.contrast).toBe(30);
  await flushSaves();
  expect(disk.get('/photos/a.jpg')?.recipe).toMatchObject({ exposure: 1, contrast: 0 });
  endLookEdit();
  expect(activePhoto()?.recipe?.exposure).toBe(1);
  expect(useApp.getState().history).toEqual(before);
});
