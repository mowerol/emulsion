// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../backend/api', () => ({ writeSidecar: vi.fn(async () => {}), isTauri: () => false, logToTerminal: () => {} }));
vi.mock('./tilerenders', () => ({ useTileRenders: () => ({ tileRef: () => () => {}, placeholder: null }) }));

import { TreatmentControls } from './TreatmentControls';
import { activePhoto, undo, useApp, type Photo } from '../library/store';
import { photoId } from '../library/copies';
import { flushSaves } from '../library/sidecars';
import { writeSidecar } from '../backend/api';
import { defaultRecipe } from '../film/recipe';
import { customLookId, registerCustomLook, withLook } from '../film/looks';
import { choiceKey, useLookBrowser } from './lookbrowser';
import { setPreview, useTools } from './tools';

const stock = customLookId('00000000-0000-4000-8000-000000000001');
registerCustomLook('00000000-0000-4000-8000-000000000001', 'Preview test look', { colorBalance: { contrast: 0.2 }, curve: null, lut: null });
let host: HTMLDivElement, root: Root;
function Controls() {
  const photo = useApp(activePhoto)!;
  return createElement(TreatmentControls, { key: photoId(photo), photo });
}
const button = (selector = '.look-row-pick') => [...host.querySelectorAll<HTMLButtonElement>(selector)].find(b => b.textContent?.includes('Preview test look'))!;
const click = async (selector: string) => act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());
const enter = async (b: HTMLButtonElement) => act(async () => b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
const leave = async (b: HTMLButtonElement) => act(async () => b.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
const saved = () => useApp.getState().photos.map(p => p.recipe);

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await flushSaves();
  vi.clearAllMocks();
  const photo: Photo = { path: '/hover.jpg', rel: 'hover.jpg', name: 'hover.jpg', size: 1, modified: 0, recipe: { ...defaultRecipe(), exposure: 1.2, contrast: 24, lookAmount: 37 },
    seed: 1, white: null, rating: 0, label: null, flag: null, raw: false, pair: null };
  useApp.setState({ photos: [photo, { ...photo, path: '/other.jpg', recipe: null }], active: 0, selected: new Set([photo.path, '/other.jpg']), lookEdit: null });
  useLookBrowser.setState({ view: 'list', hiddenGroups: [], favourites: [choiceKey('custom', stock)] });
  setPreview(null);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(Controls)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  await flushSaves();
  setPreview(null);
  vi.unstubAllGlobals();
});

it.each(['list', 'grid', 'quick'] as const)('previews in the %s picker without edits, history or saves; clicking applies to the selection', async view => {
  useLookBrowser.setState({ view: view === 'grid' ? 'grid' : 'list' });
  await click(view === 'quick' ? '[aria-label="Choose look"]' : '[aria-label="Browse all looks"]');
  const b = button(view === 'quick' ? '.look-quick-item' : '.look-row-pick');
  const before = saved(), history = useApp.getState().history;
  await enter(b);
  const preview = useTools.getState().preview!;
  expect(preview.name).toBe('Preview test look');
  expect(preview.apply(before[0])).toEqual(withLook(before[0]!, 'custom', stock));
  expect(preview.apply(before[0])).toMatchObject({ exposure: 1.2, contrast: 24 });
  expect(b.getAttribute('aria-pressed')).toBe('false');
  expect(saved()).toEqual(before);
  expect(useApp.getState().history).toBe(history);
  await flushSaves();
  expect(writeSidecar).not.toHaveBeenCalled();
  await leave(b);
  expect(useTools.getState().preview).toBeNull();
  await enter(b);
  await act(async () => b.click());
  expect(useTools.getState().preview).toBeNull();
  expect(saved()).toEqual(before.map(r => withLook(r ?? defaultRecipe(), 'custom', stock)));
  await act(async () => undo());
  expect(saved()).toEqual(before);
});

it('previews keyboard focus and restores on blur or Escape', async () => {
  await click('[aria-label="Browse all looks"]');
  await act(async () => button().focus());
  expect(useTools.getState().preview?.name).toBe('Preview test look');
  await act(async () => button().blur());
  expect(useTools.getState().preview).toBeNull();
  await act(async () => button().focus());
  await act(async () => button().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(useTools.getState().preview).toBeNull();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it('clears a filtered-out item, a closed quick menu and a preview from the previous photo', async () => {
  await click('[aria-label="Browse all looks"]');
  await enter(button());
  const search = host.querySelector<HTMLInputElement>('[aria-label="Search looks"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'no matching look');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(useTools.getState().preview).toBeNull();
  await click('.look-browser-heading button');
  await click('[aria-label="Choose look"]');
  await enter(button('.look-quick-item'));
  await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  expect(useTools.getState().preview).toBeNull();
  await click('[aria-label="Choose look"]');
  await enter(button('.look-quick-item'));
  await act(async () => useApp.setState({ active: 1 }));
  expect(useTools.getState().preview).toBeNull();
});

it('leaves the applied look at its saved amount and preserves another preview during cleanup', async () => {
  await click('[aria-label="Browse all looks"]');
  const applied = host.querySelector<HTMLButtonElement>('.look-row-pick[aria-pressed="true"]')!;
  await enter(applied);
  expect(useTools.getState().preview).toBeNull();
  expect(saved()[0]?.lookAmount).toBe(37);
  await enter(button());
  const other = { name: 'Another preview', apply: () => defaultRecipe() };
  setPreview(other);
  await click('.look-browser-heading button');
  expect(useTools.getState().preview).toBe(other);
});
