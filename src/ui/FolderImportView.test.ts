// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// Tiles must reserve the capture settings line: the grid measures a tile once, before the settings load.
const exposure = vi.hoisted(() => ({ unreserved: 0 }));
vi.mock('./ExposureInfo', () => ({ ExposureInfo: ({ reserve }: { reserve?: boolean }) => { if (!reserve) exposure.unreserved++; return null; } }));
vi.mock('./common', async original => ({ ...await original<typeof import('./common')>(), Thumb: () => null }));
import { FolderImportView } from './Folders';
import { useApp, type Photo } from '../library/store';
import { useCatalog } from '../library/catalog';
import { useImporter } from '../library/importer';

let host: HTMLDivElement, root: Root, style: HTMLStyleElement;
let width: number;
const resize = new Set<() => void>();
const candidates: Photo[] = Array.from({ length: 3000 }, (_, i) => ({ path: `/shoot/IMG_${i}.CR3`, rel: `IMG_${i}.CR3`, name: `IMG_${i}.CR3`,
  size: 1, modified: 1, recipe: null, seed: 1, white: null, rating: 0, label: null, flag: null, raw: true, pair: null }));
// The tile's top, as WebKit lays out a grid of 237.24 px tiles 12 px apart: offsetHeight is the
// snapped height, round(bottom) - round(top), so it alternates between 237 and 238 from row to row.
const TILE = 237.24, GAP = 12, PAD = 16, COLS = 5;
const tileHeight = (index: number) => { const top = PAD + Math.floor(index / COLS) * (TILE + GAP); return Math.round(top + TILE) - Math.round(top); };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('ResizeObserver', class {
    constructor(private read: () => void) {}
    observe() { resize.add(this.read); }
    disconnect() { resize.delete(this.read); }
  });
  width = 1192;
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function(this: HTMLElement) {
    if (!this.classList.contains('import-tile')) return 0;
    return tileHeight(Number(this.querySelector('input')!.getAttribute('aria-label')!.match(/IMG_(\d+)/)![1]));
  });
  useApp.setState({ folder: { root: '/shoot', name: 'shoot' } as never, candidates, loading: false, includeSubfolders: false, choosingImport: true });
  useCatalog.setState({ folders: {}, imports: [], collections: [] });
  useImporter.setState({ picked: new Set(), name: '', hideImported: true, group: true, size: 220 });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  style = document.createElement('style');
  style.textContent = `.import-grid { grid-template-columns: ${Array(COLS).fill('224.8px').join(' ')}; row-gap: ${GAP}px; }`;
  document.head.append(style);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); style.remove(); resize.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('settles at every scroll position once rows measure a pixel apart', async () => {
  await act(async () => root.render(createElement(FolderImportView)));
  const scroll = host.querySelector<HTMLElement>('.import-grid-scroll')!;
  // Scroll the way a trackpad does, through the first 1,000 photos. Before the fix the grid
  // re-measured after each render and stopped with Maximum update depth exceeded near photo 185.
  for (let top = 0; top < 200 * (TILE + GAP); top += 175) {
    await act(async () => { scroll.scrollTop = top; scroll.dispatchEvent(new Event('scroll')); });
    expect(host.querySelectorAll('.import-tile').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('.import-tile').length).toBeLessThan(80);
  }
  expect(exposure.unreserved).toBe(0);
});

it('remeasures after resizing the window or changing the thumbnail size', async () => {
  await act(async () => root.render(createElement(FolderImportView)));
  const scroll = host.querySelector<HTMLElement>('.import-grid-scroll')!;
  await act(async () => { scroll.scrollTop = 10000; scroll.dispatchEvent(new Event('scroll')); });
  const before = host.querySelector('.import-tile input')?.getAttribute('aria-label');
  style.textContent = `.import-grid { grid-template-columns: ${Array(3).fill('300px').join(' ')}; row-gap: ${GAP}px; }`;
  await act(async () => { width = 960; for (const read of resize) read(); });
  expect(host.querySelector('.import-tile input')?.getAttribute('aria-label')).not.toBe(before);
  await act(async () => useImporter.setState({ size: 300 }));
  expect(host.querySelectorAll('.import-tile').length).toBeGreaterThan(0);
});
