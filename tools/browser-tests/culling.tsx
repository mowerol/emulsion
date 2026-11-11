// SPDX-License-Identifier: GPL-3.0-or-later
// Library Grid/Loupe, vertical carousel and global shortcuts in StrictMode; native IPC is mocked.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { menuAction, useShortcuts } from '../../src/App';
import { activePhoto, closeFolder, isLibraryLoupe, setFilter, setLibraryView, setLoupeFullscreen, useApp, type Photo } from '../../src/library/store';
import { NO_FILTER } from '../../src/library/filter';
import { photoId } from '../../src/library/copies';
import { defaultRecipe } from '../../src/film/recipe';
import { Library } from '../../src/ui/Library';
import { TopBar } from '../../src/ui/TopBar';
import { setPrefs } from '../../src/ui/prefs';
import { viewMenuAction } from '../../src/ui/appmenu';
import '../../src/styles.css';

const query = new URLSearchParams(location.search);
const assert: (ok: unknown, why: string) => asserts ok = (ok, why) => { if (!ok) throw Error(why); };
const pause = () => new Promise(r => setTimeout(r, 30));
async function until(test: () => unknown, why: string) {
  for (let i = 0; i < 200; i++) { if (test()) return; await pause(); }
  throw Error(why);
}
function key(key: string, init: KeyboardEventInit = {}) {
  (document.activeElement ?? window).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}
function button(text: string) {
  const el = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text);
  assert(el, `No button: ${text}`); return el;
}
async function enterButton(text: string) {
  const el = button(text); el.focus(); key('Enter');
  assert(isLibraryLoupe(), `Enter on ${text} opened Develop`);
  // Synthetic KeyboardEvent has no trusted default button activation.
  el.click(); await pause();
}
function Harness() {
  useShortcuts();
  const view = useApp(s => s.view);
  const full = useApp(s => isLibraryLoupe(s) && s.loupeFullscreen);
  return <div className={`app${full ? ' app-loupe-fullscreen' : ''}`}><TopBar />
    <div className="workspace workspace-library"><div className="main">{view === 'library' ? <Library /> : <div>Develop fixture</div>}</div></div>
  </div>;
}

async function main() {
  const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1600;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#a5c5ce'; ctx.fillRect(0, 0, 2400, 1600);
  ctx.fillStyle = '#385c3c'; ctx.fillRect(0, 900, 2400, 700);
  for (let x = 100; x < 2300; x += 60) { ctx.fillStyle = '#c2b492'; ctx.fillRect(x, 500, 30, 800); }
  ctx.fillStyle = '#fafafa'; ctx.font = '64px sans-serif'; ctx.fillText('Synthetic focus study', 100, 140);
  let bytes = await (await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/jpeg', .95))).arrayBuffer();
  if (query.has('photo')) bytes = await (await fetch('/.scratch/sky/sample.jpg')).arrayBuffer();
  let failures = 1, fullscreen = false;
  const rawDecodes: string[] = [];
  const reads: string[] = [];
  mockWindows('main');
  mockIPC(async (command, args) => {
    if (command === 'cull_preview') {
      const path = (args as { path: string }).path; reads.push(path);
      if (path.endsWith('b.raf') && failures-- > 0) throw Error('Camera preview unavailable');
      return bytes.slice(0);
    }
    if (command === 'thumbnail') return bytes.slice(0);
    if (command === 'load_image') { rawDecodes.push((args as { path: string }).path); throw Error('Loupe developed a RAW'); }
    if (command === 'computer_folders') return [{ path: '/photos', name: 'Photos' }];
    if (command === 'browse_directory') return [];
    if (command === 'plugin:window|is_fullscreen') return fullscreen;
    if (command === 'plugin:window|set_fullscreen') { fullscreen = (args as { value: boolean }).value; return; }
    if (command === 'photo_exposure') return { iso: 800, aperture: 2.8, shutter: 1 / 250, focalLength: 35 };
    return null;
  });
  closeFolder(); setPrefs({ autoAdvance: false, theme: query.has('light') ? 'light' : 'mid' });
  document.documentElement.dataset.theme = query.has('light') ? 'light' : 'mid';
  const photos: Photo[] = ['a', 'b', 'c'].map(name => ({ path: `/photos/${name}.raf`, name: `${name}.raf`, rel: `${name}.raf`,
    size: 100, modified: 1, recipe: null, seed: 1, white: null, raw: true, pair: null, rating: 0, label: null, flag: null }));
  photos.push({ ...photos[0], copyId: 'copy-1', copyName: 'A warm version with a long descriptive name' });
  useApp.setState({ photos, active: 0, selected: new Set(photos.map(photoId)), filter: NO_FILTER,
    source: null, folder: { root: '/photos', name: 'Photos', unreadable: 0 } });
  createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
  await until(() => document.querySelector('.grid .cell'), 'Grid missing');
  if (query.has('grid')) { await until(() => document.querySelector('.cell img'), 'No grid thumbnails'); document.body.dataset.result = 'PASS: Library grid capture'; return; }
  document.querySelector('.grid .cell')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await until(() => document.querySelector('.cull-image-window img'), 'No loupe preview in StrictMode');
  assert(isLibraryLoupe() && !fullscreen && !useApp.getState().loupeFullscreen, 'Opening a photo forced fullscreen');
  assert(document.querySelector('.folder-directory')!.getBoundingClientRect().width > 0, 'Lost folders');
  assert(document.querySelector('.source-header')!.getBoundingClientRect().height > 0, 'Lost source header');
  assert(document.querySelector('.library-bar')!.getBoundingClientRect().height > 0, 'Lost filters/view controls');
  await until(() => document.querySelector('.library-image-rail .image-frame'), 'Vertical carousel missing');
  assert(document.querySelector('.cull-photo-info')?.textContent?.includes('1 of 4'), 'Wrong position');
  const rail = document.querySelector('.library-image-rail')!.getBoundingClientRect();
  const imageArea = document.querySelector('.cull-image-stage')!.getBoundingClientRect();
  const tiles = [...document.querySelectorAll('.library-image-rail .image-frame')].map(el => el.getBoundingClientRect());
  assert(rail.right <= imageArea.left && rail.height > rail.width, 'Carousel is not beside the artboard');
  assert(tiles[1].top > tiles[0].bottom && Math.abs(tiles[1].left - tiles[0].left) < 1, 'Carousel is not vertical');
  assert(imageArea.height > innerHeight * .55, 'Artboard lost its vertical space');
  assert(rawDecodes.length === 0, 'Developed a RAW');
  await enterButton('100% preview');
  const img = document.querySelector<HTMLImageElement>('.cull-image-window img')!;
  assert(Math.abs(img.getBoundingClientRect().width * devicePixelRatio - img.naturalWidth) < 2, '100% is not preview pixel for device pixel');
  if (query.has('zoom')) { document.body.dataset.result = 'PASS: Library loupe 100% preview'; return; }
  key('z'); await pause();
  assert(button('Fit').getAttribute('aria-pressed') === 'true', 'Z did not return to Fit');
  const beforeFull = document.querySelector('.cull-image-window img');
  key('f'); await until(() => fullscreen && useApp.getState().loupeFullscreen, 'F did not enter optional fullscreen');
  assert(document.querySelector('.cull-image-window img') === beforeFull, 'Fullscreen remounted the preview');
  assert(document.querySelector('.library-image-rail')!.getBoundingClientRect().width === 0, 'Fullscreen did not hide carousel');
  assert(document.querySelector('.folder-directory')!.getBoundingClientRect().width === 0, 'Fullscreen did not hide sidebar');
  if (query.has('fullscreen')) { document.body.dataset.result = 'PASS: optional fullscreen preview'; return; }
  key('Escape'); await until(() => !fullscreen && !useApp.getState().loupeFullscreen, 'Escape did not leave fullscreen');
  assert(isLibraryLoupe() && document.querySelector('.library-image-rail')!.getBoundingClientRect().height > 0, 'Escape did not restore Library loupe');
  key('#', { code: 'Digit3', shiftKey: true }); await pause();
  assert(activePhoto()?.name === 'b.raf', 'Shift+rating did not advance');
  assert(useApp.getState().photos.map(p => p.rating).join(',') === '3,0,0,0', 'Rated the batch instead of active');
  await until(() => document.body.textContent?.includes('Could not read this preview.'), 'No preview error recovery');
  if (query.has('error')) { document.body.dataset.result = 'PASS: Library loupe recoverable preview error'; return; }
  await enterButton('Try again');
  await until(() => document.querySelector('.cull-image-window img'), 'Retry failed');
  const auto = document.querySelector<HTMLInputElement>('.cull-auto input')!;
  auto.click(); await pause(); key('x'); await pause();
  assert(activePhoto()?.name === 'c.raf', 'Auto Advance failed after toggling checkbox');
  assert(useApp.getState().photos[1].flag === 'reject' && !useApp.getState().photos[0].flag, 'Reject affected selection');
  menuAction('undo'); await pause(); assert(!useApp.getState().photos[1].flag, 'Undo route failed');
  // Edited neighbours in Loupe's carousel must still use original thumbnails, without RAW develop.
  useApp.setState(s => ({ photos: s.photos.map((p, i) => i === 2 ? { ...p, recipe: defaultRecipe() } : p) }));
  await pause(); await pause();
  key('End'); await pause(); key('p'); await pause();
  assert(activePhoto()?.copyId === 'copy-1', 'End skipped copy');
  assert(useApp.getState().photos[3].flag === 'pick' && !useApp.getState().photos[0].flag, 'Copy marks leaked');
  useApp.setState({ selected: new Set([photoId(photos[0]), photoId(photos[1])]) });
  const frame = document.querySelector<HTMLButtonElement>('.library-image-rail [data-index="2"]')!;
  frame.click(); await pause();
  assert(activePhoto()?.name === 'c.raf' && useApp.getState().selected.size === 2, 'Carousel collapsed partial selection');
  await new Promise(r => setTimeout(r, 450)); // Beyond the thumbnail development debounce.
  assert(rawDecodes.length === 0, 'Loupe developed an edited neighbour');
  // Grid intentionally shows developed thumbnails; keep that separate from the no-decode check.
  useApp.setState(s => ({ photos: s.photos.map(p => ({ ...p, recipe: null })) }));
  await pause();
  key('g'); await pause(); assert(useApp.getState().libraryView === 'grid', 'G failed');
  key('e'); await until(() => document.querySelector('.cull-image-window img'), 'E did not return to Loupe');
  key('Escape'); await pause(); assert(useApp.getState().libraryView === 'grid', 'Escape from embedded Loupe did not return to Grid');
  key('Enter'); await until(() => document.querySelector('.cull-image-window img'), 'Enter did not open Grid photo in Loupe');
  key('d'); await pause(); assert(useApp.getState().view === 'develop', 'D did not develop');
  viewMenuAction('library-loupe'); await until(() => document.querySelector('.cull-image-window img'), 'Menu did not reopen Library loupe');
  assert(!fullscreen, 'Menu Loupe forced fullscreen');
  const railScroll = document.querySelector<HTMLElement>('.library-image-scroll')!;
  key('End'); await pause();
  const lastTile = document.querySelector<HTMLElement>('.library-image-rail [aria-current="true"]')!.getBoundingClientRect();
  const railBox = railScroll.getBoundingClientRect();
  assert(lastTile.top >= railBox.top - 1 && lastTile.bottom <= railBox.bottom + 1, 'Navigation did not reveal the active carousel image');
  setFilter({ ...NO_FILTER, minRating: 5 }); await pause();
  assert(!document.querySelector('.cull-image-window img'), 'No-match filter displayed a hidden photo');
  assert(!document.querySelector('.cull-footer .mark-controls'), 'Hidden photo could still be marked');
  button('Clear filters').click();
  await until(() => document.querySelector('.cull-image-window img'), 'Clear filters did not restore preview');
  if (query.has('scale')) {
    const many = Array.from({ length: 2000 }, (_, i) => ({ ...photos[0], path: `/photos/frame-${i}.raf`, name: `frame-${i}.raf`, rel: `frame-${i}.raf` }));
    useApp.setState({ photos: many, active: 0, selected: new Set() });
    await pause();
    key('End');
    await until(() => document.querySelector('.library-image-rail [data-index="1999"]'), 'Carousel did not mount the final image');
    await pause();
    const scroll = document.querySelector<HTMLElement>('.library-image-scroll')!;
    const last = scroll.querySelector<HTMLElement>('[data-index="1999"]')!.getBoundingClientRect();
    const bounds = scroll.getBoundingClientRect();
    assert(last.top >= bounds.top - 1 && last.bottom <= bounds.bottom + 1, 'Final image is clipped in large carousel');
    assert(bounds.bottom <= innerHeight && bounds.height < innerHeight, 'Virtual carousel spacers exceeded its viewport');
    assert(scroll.querySelectorAll('.image-frame').length < 30, 'Carousel mounted the whole library');
    scroll.scrollTop = 0;
    await until(() => scroll.querySelector('[data-index="0"]'), 'Manual carousel scrolling failed');
    assert(useApp.getState().active === 1999 && scroll.scrollTop === 0, 'Manual carousel scroll changed or snapped to the active image');
    key('Home'); await pause(); key('ArrowDown'); await pause();
    assert(useApp.getState().active === 1, 'Vertical arrow navigation failed');
    key('f'); await until(() => fullscreen, 'Scale fullscreen did not enter');
    key('End'); await pause(); key('Escape');
    await until(() => !fullscreen && scroll.querySelector('[data-index="1999"]'), 'Carousel did not reveal fullscreen selection on return');
    await pause();
    const restored = scroll.querySelector<HTMLElement>('[data-index="1999"]')!.getBoundingClientRect();
    assert(restored.top >= bounds.top - 1 && restored.bottom <= bounds.bottom + 1, 'Restored carousel did not show the fullscreen selection');
  }
  // Finish the capture in Library Loupe, and verify visible controls fit the viewport.
  const loupe = document.querySelector('.cull-loupe')!.getBoundingClientRect();
  assert(loupe.right <= innerWidth + 1 && loupe.bottom <= innerHeight + 1, 'Loupe exceeds viewport');
  for (const el of document.querySelectorAll<HTMLElement>('.cull-header button, .cull-footer button, .cull-auto')) {
    const r = el.getBoundingClientRect();
    assert(r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, `Clipped control: ${el.textContent || el.getAttribute('aria-label')}`);
  }
  assert(rawDecodes.length === 0, `Library Loupe or its carousel developed a RAW: ${rawDecodes.join(', ')}`);
  document.body.dataset.result = `PASS: Library Grid/Loupe, vertical carousel/scroll, folders/filters, optional fullscreen, physical preview pixels, marks/undo/copies, selection, retry, no-match filter (${reads.length} reads; no RAW decode)`;
}
main().catch(error => { document.body.dataset.result = `FAIL: ${error.stack ?? error}`; });
