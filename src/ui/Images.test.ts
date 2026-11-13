// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./PhotoMenu', () => ({ usePhotoContextMenu: () => ({ open: () => {}, menu: null }) }));
vi.mock('./FilterBar', () => ({ FilterBar: () => null }));
vi.mock('./common', async original => ({ ...await original<typeof import('./common')>(), Thumb: () => null }));
import { Images } from './Images';
import { useApp, type Photo } from '../library/store';
import { NO_FILTER } from '../library/filter';
import { useWorkspace } from './workspace';
import { defaultRecipe } from '../film/recipe';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    return { x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 96, width: 300, height: 96, toJSON() {} };
  });
  const photos: Photo[] = Array.from({ length: 1200 }, (_, i) => ({ path: `/photos/${i}.orf`, rel: `${i}.orf`, name: `${i}.orf`,
    size: 42, modified: 1, recipe: null, seed: 1, white: null, rating: i % 5, label: null, flag: null, raw: true, pair: null }));
  useApp.setState({ photos, hidden: [], candidates: [], active: 0, anchor: 0, source: null,
    filter: NO_FILTER, selectedOnly: false, missingPaths: null, selected: new Set([photos[0].path]), loading: true, lookEdit: null });
  useWorkspace.setState({ imageColumns: 3 });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('does not synchronously measure unchanged image rows on each slider edit', async () => {
  await act(async () => root.render(createElement(Images)));
  const measure = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
  measure.mockClear();
  await act(async () => useApp.setState(s => ({ photos: s.photos.map((p, i) => i ? p : { ...p, recipe: { ...defaultRecipe(), exposure: 1 } }) })));
  expect(measure).not.toHaveBeenCalled();
});
it.each([1, 2, 3] as const)('mounts only nearby frames and reveals distant navigation at %i columns', async columns => {
  useWorkspace.setState({ imageColumns: columns });
  await act(async () => root.render(createElement(Images)));
  expect(host.querySelectorAll('.image-frame').length).toBeLessThan(80);
  expect(host.querySelector('[data-index="0"]')).not.toBeNull();
  await act(async () => useApp.setState({ active: 1199 }));
  const scroll = host.querySelector<HTMLElement>('.images-grid')!;
  await act(async () => scroll.dispatchEvent(new Event('scroll')));
  expect(scroll.scrollTop).toBeGreaterThan(0);
  expect(host.querySelector('[data-index="1199"]')).not.toBeNull();
  expect(host.querySelectorAll('.image-frame').length).toBeLessThan(80);
  // A manual scroll must stay where the user put it, without changing the active photo.
  await act(async () => { scroll.scrollTop = 0; scroll.dispatchEvent(new Event('scroll')); });
  expect(host.querySelector('[data-index="0"]')).not.toBeNull();
  expect(useApp.getState().active).toBe(1199);
});
