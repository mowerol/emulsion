// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./PhotoMenu', () => ({ usePhotoContextMenu: () => ({ open: () => {}, menu: null }) }));
vi.mock('./FilterBar', () => ({ FilterBar: () => null }));
vi.mock('./common', async original => ({ ...await original<typeof import('./common')>(), Thumb: () => null }));
import { Images } from './Images';
import { setFilter, shown, useApp, type Photo } from '../library/store';
import { NO_FILTER } from '../library/filter';
import { useWorkspace } from './workspace';
import { usePrefs } from './prefs';
import { defaultRecipe } from '../film/recipe';
import { useCatalog } from '../library/catalog';
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
    filter: NO_FILTER, imageSearch: '', view: 'develop', selectedOnly: false, missingPaths: null, selected: new Set([photos[0].path]), loading: true, lookEdit: null });
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

it('shows the star comparison in collapsed filters, including unrated', async () => {
  const wasOpen = usePrefs.getState().filtersOpen;
  try {
    usePrefs.setState({ filtersOpen: false });
    useApp.setState({ filter: { ...NO_FILTER, rating: 3, ratingComparison: '<=' } });
    await act(async () => root.render(createElement(Images)));
    expect(host.querySelector('.filter-chip')?.textContent).toBe('≤ 3★');
    await act(async () => useApp.setState({ filter: { ...NO_FILTER, rating: 0, ratingComparison: '=' } }));
    expect(host.querySelector('.filter-chip')?.textContent).toBe('= 0★');
  } finally {
    await act(async () => usePrefs.setState({ filtersOpen: wasOpen }));
  }
});

const searchButton = () => host.querySelector<HTMLButtonElement>('button[aria-label="Search filenames"]')!;
const searchInput = () => host.querySelector<HTMLInputElement>('input[aria-label="Filename"]')!;
async function typeSearch(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(searchInput(), value);
    searchInput().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('opens filename search from its icon and finds a distant photo without changing the edit', async () => {
  await act(async () => root.render(createElement(Images)));
  expect(searchButton()).not.toBeNull();
  expect(searchInput()).toBeNull();
  await act(async () => searchButton().click());
  expect(document.activeElement).toBe(searchInput());
  await typeSearch(' 1199.OrF ');
  expect(shown()).toEqual([1199]);
  expect(useApp.getState().active).toBe(0);
  expect([...useApp.getState().selected]).toEqual(['/photos/0.orf']);
  expect(host.querySelector('.images-count')?.textContent).toBe('1 of 1200');
  expect(host.querySelector('[data-index="1199"]')).not.toBeNull();
  await act(async () => searchInput().form!.requestSubmit());
  expect(useApp.getState().active).toBe(1199);
  expect(searchInput()).toBeNull();
  expect(searchButton().getAttribute('aria-pressed')).toBe('true');
});

it('clears no-match searches with Escape and restores focus without changing other filters', async () => {
  useApp.setState({ filter: { ...NO_FILTER, rating: 4, ratingComparison: '>=' } });
  await act(async () => root.render(createElement(Images)));
  await act(async () => searchButton().click());
  await typeSearch('nothing-matches');
  expect(shown()).toEqual([]);
  expect(host.textContent).toContain('No filenames match');
  expect(useApp.getState().active).toBe(0);
  await act(async () => searchInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(searchInput()).toBeNull();
  expect(document.activeElement).toBe(searchButton());
  expect(useApp.getState().imageSearch).toBe('');
  expect(useApp.getState().filter.rating).toBe(4);
  expect(shown().length).toBeGreaterThan(0);
});

it('retains the query when dismissed, clears it with its own button, and keeps it in Library', async () => {
  await act(async () => root.render(createElement(Images)));
  await act(async () => searchButton().click());
  await typeSearch('1199');
  await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  expect(searchInput()).toBeNull();
  expect(shown()).toEqual([1199]);
  await act(async () => useApp.setState({ view: 'library' }));
  expect(shown()).toEqual([1199]); // One search for the Library grid and Develop, like the filters.
  await act(async () => useApp.setState({ view: 'develop' }));
  expect(shown()).toEqual([1199]);
  await act(async () => searchButton().click());
  expect(searchInput().value).toBe('1199');
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Clear filename search"]')!.click());
  expect(shown()).toHaveLength(1200);
  expect(document.activeElement).toBe(searchInput());
});

it('searches filenames within the selected collection and combines with existing filters', async () => {
  const photos = useApp.getState().photos;
  useCatalog.setState({ collections: [{ id: 'search-scope', name: 'Two photos', createdAt: 1, type: 'manual', photoIds: [photos[1].path, photos[3].path] }] });
  useApp.setState({ source: { type: 'collection', id: 'search-scope' }, active: 1 });
  setFilter({ rating: 3, ratingComparison: '>=' });
  await act(async () => root.render(createElement(Images)));
  await act(async () => searchButton().click());
  await typeSearch('.ORF');
  expect(shown()).toEqual([3]);
  await typeSearch('1199');
  expect(shown()).toEqual([]); // A matching file outside the collection stays outside it.
  await typeSearch('photos');
  expect(shown()).toEqual([]); // Folder names are not filename matches.
});

it('keeps filter-driven navigation inside the filename results', async () => {
  await act(async () => root.render(createElement(Images)));
  await act(async () => searchButton().click());
  await typeSearch('1199');
  await act(async () => setFilter({ rating: 4, ratingComparison: '>=' }));
  expect(useApp.getState().active).toBe(1199);
  expect(shown()).toEqual([1199]);
});

it('clears with a mouse press when the browser does not focus buttons', async () => {
  await act(async () => root.render(createElement(Images)));
  await act(async () => searchButton().click());
  await typeSearch('1199');
  const clear = host.querySelector<HTMLButtonElement>('[aria-label="Clear filename search"]')!;
  await act(async () => {
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    clear.dispatchEvent(down);
    // Safari blurs the input without focusing the clicked button.
    if (!down.defaultPrevented) searchInput().blur();
  });
  await act(async () => clear.click());
  expect(useApp.getState().imageSearch).toBe('');
  expect(shown()).toHaveLength(1200);
  expect(document.activeElement).toBe(searchInput());
});
