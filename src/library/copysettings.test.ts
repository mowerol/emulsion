// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../backend/api', () => ({
  writeSidecar: vi.fn(() => Promise.resolve()), whitePoints: vi.fn(() => Promise.resolve([])),
  isTauri: () => false, logToTerminal: () => {},
}));
import { writeSidecar } from '../backend/api';
import { FULL } from '../film/crop';
import { defaultRecipe } from '../film/recipe';
import { photoId } from './copies';
import { NO_FILTER } from './filter';
import { flushSaves } from './sidecars';
import { closeCopySettings, closeFolder, copySettings, createVirtualCopies, editActive, finishCrop, openCopySettings, pasteSettings, redo, setActive, setCropDraft, startCrop, startLookEdit, undo, useApp, type Photo } from './store';

const photo = (name: string): Photo => ({ name, path: `/photos/${name}`, rel: name, recipe: null, size: 1, modified: 0, seed: 1, white: null, rating: 0, label: null, heart: false, raw: false, pair: null });

beforeEach(() => {
  vi.useFakeTimers();
  closeFolder();
  const a = { ...photo('a.jpg'), recipe: { ...defaultRecipe(), exposure: 1, contrast: 30 } };
  const b = { ...photo('b.jpg'), recipe: { ...defaultRecipe(), exposure: -1, contrast: 10, crop: { ...FULL, w: .8 } } };
  useApp.setState({ photos: [a, b], active: 0, selected: new Set([a.path]), clipboard: null, exportOpen: false, filter: NO_FILTER });
  vi.clearAllMocks();
});
afterEach(async () => { closeFolder(); await flushSaves(); vi.useRealTimers(); });

it('holds the source snapshot when the picker opens and cancellation preserves the previous clipboard', () => {
  copySettings(['Contrast']);
  const previous = useApp.getState().clipboard;
  openCopySettings();
  editActive(r => ({ ...r!, exposure: 3 }));
  copySettings(['Exposure']);
  expect(useApp.getState().clipboard?.recipe.exposure).toBe(1);
  useApp.setState({ clipboard: previous });
  openCopySettings();
  closeCopySettings();
  expect(useApp.getState().clipboard).toBe(previous);
});

it('pastes the chosen scope onto a batch as one undoable checkpoint and preserves other edits and marks', async () => {
  copySettings(['Exposure']);
  const before = structuredClone(useApp.getState().photos);
  useApp.setState({ selected: new Set(before.map(photoId)), active: 1 });
  pasteSettings();
  expect(useApp.getState().photos[1]).toEqual({ ...before[1], recipe: { ...before[1].recipe!, exposure: 1 } });
  undo();
  expect(useApp.getState().photos).toEqual(before);
  redo();
  expect(useApp.getState().photos[1].recipe?.exposure).toBe(1);
  await flushSaves();
  expect(writeSidecar).toHaveBeenCalledWith('/photos/b.jpg', expect.anything(), true);
});

it('can copy an unedited frame to reset only selected settings on a virtual copy', () => {
  useApp.setState(s => ({ photos: s.photos.map((p, i) => i === 0 ? { ...p, recipe: null } : p) }));
  openCopySettings();
  copySettings(['Exposure']);
  setActive(1);
  createVirtualCopies();
  const index = useApp.getState().active;
  pasteSettings();
  expect(useApp.getState().photos[index].recipe).toMatchObject({ exposure: 0, contrast: 10, crop: { w: .8 } });
  expect(useApp.getState().photos[1].recipe?.exposure).toBe(-1);
});

it('does not replace the clipboard with an empty scope or copy a Look Creator draft', () => {
  copySettings(['Exposure']);
  const clip = useApp.getState().clipboard;
  copySettings([]);
  expect(useApp.getState().clipboard).toBe(clip);
  startLookEdit('/photos/a.jpg', 'draft', 'Draft', { ...defaultRecipe(), exposure: 3 });
  openCopySettings();
  copySettings();
  pasteSettings();
  expect(useApp.getState().copySettingsSource).toBeNull();
  expect(useApp.getState().clipboard).toBe(clip);
});

it('copies a crop draft without committing it and keeps a pasted crop when Done is pressed', () => {
  useApp.setState({ view: 'develop', developSize: { path: '/photos/a.jpg', W: 1000, H: 800 } });
  startCrop();
  setCropDraft(c => ({ ...c, w: .65 }));
  const draft = useApp.getState().cropEdit;
  openCopySettings();
  closeCopySettings();
  expect(useApp.getState().cropEdit).toBe(draft);
  expect(useApp.getState().photos[0].recipe?.crop).toBeNull();
  expect(useApp.getState().history.undo).toBeNull();
  openCopySettings();
  copySettings(['Crop']);
  expect(useApp.getState().clipboard?.recipe.crop?.w).toBe(.65);
  setActive(1);
  useApp.setState({ developSize: { path: '/photos/b.jpg', W: 1000, H: 800 } });
  startCrop();
  setCropDraft(c => ({ ...c, w: .4 }));
  pasteSettings();
  expect(useApp.getState().cropEdit?.draft.w).toBe(.65);
  finishCrop(true);
  expect(useApp.getState().photos[1].recipe?.crop?.w).toBe(.65);
  undo();
  expect(useApp.getState().photos[1].recipe?.crop?.w).toBe(.8);
});
