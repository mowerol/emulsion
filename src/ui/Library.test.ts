// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./PhotoMenu', () => ({ usePhotoContextMenu: () => ({ open: () => {}, menu: null }) }));
vi.mock('./FilterBar', () => ({ FilterBar: () => null }));
vi.mock('./LibrarySources', () => ({ LibrarySidebar: () => null, LibrarySourceDialog: () => null }));
vi.mock('./ExposureInfo', () => ({ ExposureInfo: () => null }));
vi.mock('./common', async original => ({ ...await original<typeof import('./common')>(), Thumb: () => null }));
import { Library } from './Library';
import { shown, useApp, type Photo } from '../library/store';
import { NO_FILTER } from '../library/filter';

let host: HTMLDivElement, root: Root, style: HTMLStyleElement;
let width: number;
const resize = new Set<() => void>();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('ResizeObserver', class {
    constructor(private read: () => void) {}
    observe() { resize.add(this.read); }
    disconnect() { resize.delete(this.read); }
  });
  width = 1161;
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(649);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  const photos: Photo[] = Array.from({ length: 1526 }, (_, i) => ({ path: `/photos/${i}.orf`, rel: `${i}.orf`, name: `${i}.orf`,
    size: 1, modified: 1, recipe: null, seed: 1, white: null, rating: 0, label: null, flag: null, raw: true, pair: null }));
  useApp.setState({ photos, hidden: [], candidates: [], active: -1, anchor: -1, source: null, opening: null,
    choosingImport: false, libraryView: 'grid', view: 'library', filter: NO_FILTER, imageSearch: '', selectedOnly: false, missingPaths: null,
    selected: new Set(), loading: false, lookEdit: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  style = document.createElement('style');
  style.textContent = '.grid { grid-template-columns: 271.25px 271.25px 271.25px 271.25px; row-gap: 12px; }';
  document.head.append(style);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); style.remove(); resize.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('settles after a scrollbar jump when adjacent windows measure one pixel apart', async () => {
  // Replay the actual WebKit crash: at scrollTop 74413, pitch 327 mounts index 900
  // (height 316.25); pitch 328 mounts index 896 (315.25), then it repeats forever.
  const height = (el: HTMLElement) => el.classList.contains('cell') ? (el.dataset.index === '900' ? 316.25 : 315.25) : 0;
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function(this: HTMLElement) { return Math.round(height(this)); });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const h = height(this); return { x: 0, y: 0, top: 0, left: 0, right: 271.25, bottom: h, width: 271.25, height: h, toJSON() {} };
  });
  await act(async () => root.render(createElement(Library)));
  const scroll = host.querySelector<HTMLElement>('.library-grid-scroll')!;
  await act(async () => { scroll.scrollTop = 74413; scroll.dispatchEvent(new Event('scroll')); });
  expect(scroll.scrollTop).toBe(74413);
  expect(host.querySelectorAll('.cell').length).toBeGreaterThan(0);
  expect(host.querySelectorAll('.cell').length).toBeLessThan(40);
});

it('remeasures after resizing the viewport or remounting the grid', async () => {
  let height = 315;
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => height);
  await act(async () => root.render(createElement(Library)));
  const scroll = host.querySelector<HTMLElement>('.library-grid-scroll')!;
  await act(async () => { scroll.scrollTop = 10000; scroll.dispatchEvent(new Event('scroll')); });
  expect(host.querySelector('.cell')?.getAttribute('data-index')).toBe('112');
  await act(async () => { height = 215; width = 761; for (const read of resize) read(); });
  expect(host.querySelector('.cell')?.getAttribute('data-index')).toBe('160');
  // An Opening… branch detaches the grid without changing the viewport width.
  await act(async () => useApp.setState({ opening: { source: { type: 'folder', id: '/other' }, name: 'Other' } }));
  expect(host.querySelector('.cell')).toBeNull();
  height = 415;
  await act(async () => useApp.setState({ opening: null }));
  const reopened = host.querySelector<HTMLElement>('.library-grid-scroll')!;
  await act(async () => { reopened.scrollTop = 10000; reopened.dispatchEvent(new Event('scroll')); });
  expect(host.querySelector('.cell')?.getAttribute('data-index')).toBe('84');
});

it('searches filenames from the Library bar and clears the search with the filters', async () => {
  await act(async () => root.render(createElement(Library)));
  const button = host.querySelector<HTMLButtonElement>('.library-bar button[aria-label="Search filenames"]')!;
  expect(button).not.toBeNull();
  await act(async () => button.click());
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Filename"]')!;
  expect(document.activeElement).toBe(input);
  // The field hangs below the bar, which clips what overflows it, so it is placed outside its flow.
  expect(input.form!.style.position).toBe('fixed');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '1525.ORF');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(shown()).toEqual([1525]);
  expect(useApp.getState().active).toBe(-1);
  expect(host.querySelector('.library-bottom-bar')?.textContent).toContain('1 of 1,526');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'nothing-matches');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  expect(button.getAttribute('aria-pressed')).toBe('true');
  const clear = [...host.querySelectorAll<HTMLButtonElement>('.library-empty button')].find(b => b.textContent === 'Clear filters')!;
  await act(async () => clear.click());
  expect(useApp.getState().imageSearch).toBe('');
  expect(shown()).toHaveLength(1526);
});
