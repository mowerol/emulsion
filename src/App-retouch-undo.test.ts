// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./backend/api', async importOriginal => ({
  ...await importOriginal<typeof import('./backend/api')>(),
  isTauri: () => false, writeSidecar: vi.fn(async () => {}),
}));
import { menuAction, useShortcuts } from './App';
import { defaultRecipe } from './film/recipe';
import { activePhoto, closeFolder, editActive, redo, undo, useApp, type Photo } from './library/store';
import { addPendingStroke, applyPending, brushNode, cancelPending, holdRetouch, setRetouchUi, useRetouchUi } from './ui/retouchui';

let root: Root;
let host: HTMLDivElement;
let clock = 0;
const photo: Photo = { path: '/photos/a.jpg', name: 'a.jpg', rel: 'a.jpg', size: 1, modified: 1,
  recipe: null, seed: 1, white: null, rating: 0, label: null, heart: false, raw: false, pair: null };
function Shortcuts() { useShortcuts(); return null; }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(performance, 'now').mockReturnValue(clock += 1000);
  closeFolder();
  useApp.setState({ view: 'develop', photos: [photo], active: 0, selected: new Set([photo.path]), lookEdit: null, exportOpen: false, copySettingsSource: null });
  setRetouchUi({ pending: null });
  holdRetouch('remove');
  editActive(() => ({ ...defaultRecipe(), exposure: 1 }), 'Exposure');
  addPendingStroke(photo.path, 600, 400, [brushNode([.2, .2])]);
  addPendingStroke(photo.path, 600, 400, [brushNode([.6, .6])]);
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Shortcuts)));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it.each(['menu', 'keyboard'])('undoes the latest waiting Remove stroke through %s without undoing exposure', async route => {
  await act(async () => {
    if (route === 'menu') menuAction('undo');
    else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true }));
  });
  expect(useRetouchUi.getState().pending?.strokes).toHaveLength(1);
  expect(activePhoto()!.recipe!.exposure).toBe(1);
});

it('undoes strokes before photo edits and redoes them in the same order', () => {
  undo(); undo();
  expect(useRetouchUi.getState().pending).toBeNull();
  expect(activePhoto()!.recipe!.exposure).toBe(1);
  undo();
  expect(activePhoto()!.recipe).toBeNull();
  redo(); redo(); redo();
  expect(activePhoto()!.recipe!.exposure).toBe(1);
  expect(useRetouchUi.getState().pending?.strokes.map(st => st[0].x)).toEqual([.2, .6]);
});

it('applies only remaining strokes as one photo edit and clears draft redo', () => {
  undo(); applyPending();
  expect(useRetouchUi.getState().pending).toBeNull();
  expect(activePhoto()!.recipe!.retouch).toHaveLength(1);
  expect(activePhoto()!.recipe!.retouch[0].shape).toMatchObject({ nodes: [{ x: .2 }] });
  undo();
  expect(activePhoto()!.recipe!.retouch).toHaveLength(0);
  expect(useRetouchUi.getState().pending).toBeNull();
  redo();
  expect(activePhoto()!.recipe!.retouch).toHaveLength(1);
  expect(useApp.getState().history.redo).toBeNull();
});

it('cancels draft history, including undone strokes', () => {
  undo(); cancelPending();
  expect(useApp.getState().history).toEqual({ undo: 'Exposure', redo: null });
  undo(); redo();
  expect(useRetouchUi.getState().pending).toBeNull();
});

it('discards undone strokes when a new stroke is drawn', () => {
  undo(); addPendingStroke(photo.path, 600, 400, [brushNode([.8, .8])]);
  expect(useApp.getState().history.redo).toBeNull();
  expect(useRetouchUi.getState().pending?.strokes.map(st => st[0].x)).toEqual([.2, .8]);
});

it('can undo deleting the latest waiting stroke', () => {
  cancelPending(true); undo();
  expect(useRetouchUi.getState().pending?.strokes).toHaveLength(2);
});

it('drops pending history when switching to a virtual copy, even after all strokes were undone', () => {
  undo(); undo();
  useApp.setState({ photos: [photo, { ...photo, copyId: 'copy' }], active: 1 });
  expect(useApp.getState().history.redo).toBeNull();
  expect(useRetouchUi.getState().pending).toBeNull();
});

it('does not undo two strokes when the menu repeats a handled key press', async () => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true }));
    menuAction('undo');
  });
  expect(useRetouchUi.getState().pending?.strokes).toHaveLength(1);
});
