// SPDX-License-Identifier: GPL-3.0-or-later
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import { importTime, saveCollection, useCatalog } from '../../src/library/catalog';
import { importFolderPhotos, openFolder, selectSource, setFilter, setSelectedOnly, useApp } from '../../src/library/store';
import { NO_FILTER } from '../../src/library/filter';
import '../../src/styles.css';

const pause = () => new Promise(r => setTimeout(r, 80));
const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const waitFor = async (test: () => boolean) => { for (let i = 0; i < 60; i++) { if (test()) return; await pause(); } throw Error('Library did not update'); };
const click = (label: string) => {
  const button = document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`) ?? [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label);
  if (!button) throw Error(`Missing ${label}`);
  button.click();
};
const input = (label: string, value: string) => {
  const el = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const dirs: Record<string, string[]> = { '/Photos': ['2026', '2025 - Main.cocatalog'], '/Photos/2026': ['Portugal', 'October', 'December', 'January'] };
const files: Record<string, string[]> = { '/Photos/2026/October': ['PA181690.ORF', 'PA181690.JPG', 'PA181697.JPG', 'PA181704.JPG', 'PA181711.JPG', 'PA181718.JPG', 'PA181725.JPG'], '/Photos/2026/Portugal': ['PT001.JPG', 'PT002.JPG'] };
const thumbnails = new Map<string, ArrayBuffer>();
for (const [i, name] of Object.values(files).flat().entries()) {
  const canvas = document.createElement('canvas');
  canvas.width = i % 2 ? 240 : 360; canvas.height = i % 2 ? 360 : 240;
  const ctx = canvas.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, ['#9ba9b0', '#b4b5ac', '#a5aba8'][i % 3]); sky.addColorStop(1, '#d7c5ab');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#657467'; ctx.beginPath(); ctx.moveTo(0, canvas.height * .7); ctx.lineTo(canvas.width * .3, canvas.height * .4); ctx.lineTo(canvas.width * .65, canvas.height * .65); ctx.lineTo(canvas.width, canvas.height * .5); ctx.lineTo(canvas.width, canvas.height); ctx.lineTo(0, canvas.height); ctx.fill();
  ctx.fillStyle = '#847e64'; ctx.fillRect(0, canvas.height * .82, canvas.width, canvas.height * .18);
  const bytes = Uint8Array.from(atob(canvas.toDataURL('image/jpeg').split(',')[1]), c => c.charCodeAt(0));
  thumbnails.set(name, bytes.buffer);
}
(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
(window as any).__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1,
  invoke: async (cmd: string, args: any) => {
    if (cmd === 'startup_options') return { openPath: null, startView: null };
    if (cmd === 'computer_folders') return [{ path: '/Photos', name: 'Photos' }];
    if (cmd === 'browse_directory') return (dirs[args.path] ?? []).map(name => ({ path: `${args.path}/${name}`, name }));
    if (cmd === 'scan_folder') return { root: args.path, name: args.path.split('/').pop(), unreadable: 0, focus: null,
      folders: (dirs[args.path] ?? []).map(name => ({ path: `${args.path}/${name}`, name })),
      entries: (files[args.path] ?? []).map(name => ({ path: `${args.path}/${name}`, name, rel: name, size: 1, modified: 1793400000000, raw: name.endsWith('ORF'), recipe: null, rating: 0, label: null, heart: false })) };
    if (cmd === 'white_points') return args.paths.map(() => null);
    if (cmd === 'catalog_metadata') return args.paths.map(() => ({ camera: 'OM SYSTEM OM-3', date: '2026-10-31' }));
    if (cmd === 'photo_exposure') return { iso: 200, shutter: 1 / 250, aperture: 5.6, focalLength: 25 };
    if (cmd === 'thumbnail') return thumbnails.get(args.path.split('/').pop());
    if (cmd === 'write_sidecar') return;
    if (cmd === 'load_image') throw Error('Fixture: no full image decode');
    if (cmd === 'plugin:dialog|open') return '/Photos';
    if (cmd.startsWith('plugin:event|')) return 1;
    return [];
  },
};
localStorage.setItem('emulsion.browserRoot', JSON.stringify({ path: '/Photos', name: 'Photos' }));
await openFolder('/Photos/2026/October'); importFolderPhotos({ mode: 'sync' }, 'October');
const session = useCatalog.getState().imports[0];
saveCollection({ id: 'portfolio', name: 'Portfolio', type: 'manual', photoIds: [], createdAt: 1 });
saveCollection({ id: 'five', name: '5 stars', type: 'smart', rules: [{ field: 'rating', value: 5 }], createdAt: 1 });
createRoot(document.getElementById('root')!).render(<App />);
await waitFor(() => !!document.querySelector('.cell'));
await pause();
if (!new URLSearchParams(location.search).has('preview')) {
try {
  assert(!document.querySelector('.topbar .folder-info'), 'Folder context duplicated in app header');
  assert(document.querySelector('.source-title')?.textContent?.includes('6 photos'), 'Source count ignores folding');
  const sidebar = document.querySelector<HTMLElement>('.folder-directory')!;
  const bar = document.querySelector<HTMLElement>('.library-bar')!;
  assert(sidebar.getBoundingClientRect().width === 280, 'Sidebar width');
  assert(bar.getBoundingClientRect().height === 44, 'Toolbar must stay 44px');
  assert(document.querySelector('.library-status')?.getBoundingClientRect().height === 32, 'Status bar height');
  await waitFor(() => !!document.querySelector('[title="/Photos/2026/January"]'));
  const children = [...document.querySelectorAll<HTMLButtonElement>('.directory-name')].map(b => b.querySelector('span')?.textContent);
  assert(children.indexOf('January') < children.indexOf('October') && children.indexOf('December') < children.indexOf('Portugal'), 'Months not sorted by calendar');
  assert(!document.querySelector('[title="/Photos/2025 - Main.cocatalog"]')?.previousElementSibling?.matches('button'), 'Catalog has an expansion chevron');
  click('Recent imports'); await pause();
  assert(!document.querySelector('#library-imports') && localStorage.getItem('emulsion.section.imports') === 'false', 'Collapse state not persisted');
  click('Recent imports'); await pause();
  const cells = () => [...document.querySelectorAll<HTMLElement>('.cell')];
  cells()[1].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })); await pause();
  assert(useApp.getState().selected.size === 2, 'Cmd-click selection broken');
  cells()[3].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); await pause();
  assert(useApp.getState().selected.size === 3, 'Shift-range selection broken');
  click('Selected photos only'); await pause(); assert(cells().length === 3, 'Selected-only filter broken');
  click('Selected photos only'); await pause();
  // Photo drags are pointer gestures (useCollectionDrag), not HTML drag and drop.
  const from = cells()[1].getBoundingClientRect();
  const collection = [...document.querySelectorAll<HTMLButtonElement>('.source-row')].find(b => b.title === 'Portfolio')!;
  const to = collection.getBoundingClientRect();
  const pointer = (type: string, x: number, y: number, target: EventTarget) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y }));
  pointer('pointerdown', from.x + 20, from.y + 20, cells()[1]);
  pointer('pointermove', from.x + 40, from.y + 40, window);
  pointer('pointermove', to.x + 10, to.y + to.height / 2, window); await pause();
  assert(document.querySelector('[title="Portfolio"]')?.classList.contains('drag-over'), 'Collection drop target did not highlight');
  pointer('pointerup', to.x + 10, to.y + to.height / 2, window); await pause();
  // A real click starts with a pointer press, which ends the drag's click suppression.
  pointer('pointerdown', 0, 0, document.body); pointer('pointerup', 0, 0, window);
  assert(useCatalog.getState().collections.find(c => c.id === 'portfolio')?.type === 'manual' && (useCatalog.getState().collections[0] as any).photoIds.length === 3, 'Dropped selection not added');
  document.querySelector<HTMLButtonElement>('.source-row[title="5 stars"]')!.click(); await pause();
  assert(document.querySelector('.source-title h1')?.textContent === '5 stars', 'Smart source header missing');
  click('Edit rules…'); await pause();
  const ruleValue = document.querySelector<HTMLSelectElement>('select[aria-label="Minimum rating"]')!;
  ruleValue.value = '0'; ruleValue.dispatchEvent(new Event('change', { bubbles: true })); await pause();
  click('Save'); await pause(); assert(cells().length === 6, 'Edited rules did not update membership live');
  document.querySelector<HTMLButtonElement>('.source-row[title="Portfolio"]')!.click(); await pause();
  assert(cells().length === 3 && document.querySelector('.source-detail')?.textContent === 'Collection · photos stay in their folders', 'Manual source shows wrong photos/header');
  click('Rename…'); await pause(); input('Collection name', 'Print queue'); await pause(); click('Save'); await pause();
  assert(document.querySelector('.source-title h1')?.textContent === 'Print queue', 'Rename did not update header');
  click('Export'); await pause();
  const all = document.querySelector('input[name="scope"][value="all"]')?.closest('label');
  assert(all?.textContent?.includes('3'), 'Export includes photos outside the collection');
  document.querySelector('.modal')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause();
  await selectSource({ type: 'import', id: session.id }); await pause();
  assert(!document.querySelector('.source-row.active .source-new'), 'New marker not cleared');
  assert(document.querySelector('.source-breadcrumb')?.textContent?.includes(importTime(session.importedAt)), 'Import breadcrumb missing');
  click('Show in folder'); await pause();
  click('New collection'); await pause(); click('New collection from selection'); await pause(); input('Collection name', 'Selected picks'); await pause(); click('Create collection'); await pause();
  assert(document.querySelector('.source-title h1')?.textContent === 'Selected picks' && cells().length === 1, 'Collection-from-selection failed');
  await openFolder('/Photos/2026/October'); await pause();
  setFilter({ minRating: 5 }); await pause();
  assert(cells().length === 0 && document.querySelector('.library-empty h2')?.textContent === 'No photos match these filters', 'Filter miss is not a real empty state');
  click('Clear filters'); await pause(); assert(cells().length === 6, 'Clear filters failed');
  click('Fold JPEGs'); await pause(); assert(cells().length === 7, 'Unfolding failed');
  click('Fold JPEGs'); await pause();
  input('Thumbnail size', '300'); await pause();
  assert(localStorage.getItem('emulsion.cellSize') === '300', 'Thumbnail size not persisted');
  click('Library view settings'); await pause(); document.querySelector<HTMLInputElement>('.library-setting input')!.click(); await pause();
  assert(!document.querySelector('.cell .exposure-info'), 'EXIF setting does not hide metadata');
  assert(JSON.parse(localStorage.getItem('emulsion.interface')!).libraryExif === false, 'EXIF setting not saved');
  click('All imports…'); await pause(); assert(document.querySelector('[role="dialog"] h2')?.textContent === 'All imports', 'Full history missing');
  click('Close'); await pause();
  click('Folder options'); await pause(); assert([...document.querySelectorAll('.library-menu-items button')].some(b => b.textContent === 'Choose root folder…'), 'Root action missing');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause();
  cells()[0].focus(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true })); await pause();
  assert(useApp.getState().view === 'develop', 'D no longer develops');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true })); await pause();
  cells()[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await pause();
  assert(useApp.getState().view === 'develop', 'Double-click no longer develops');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true })); await pause();
  setFilter(NO_FILTER); setSelectedOnly(false);
  document.body.dataset.result = 'PASS: source headers/counts, calendar folders/catalog icons, collapse persistence, multi-selection, drag/drop, smart rules, rename, scoped export, import history/new markers, collection from selection, empty/Clear, folding, size/EXIF preferences, D and double-click';
} catch (error) { document.body.dataset.result = `FAIL: ${String(error)}`; }
}
