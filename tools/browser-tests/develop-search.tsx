// SPDX-License-Identifier: GPL-3.0-or-later
// Actual Develop Images pane, deterministic synthetic thumbnails, no photo or catalog writes.
// Run with cdp-timing.mjs develop-search; query state=closed|open|empty, width=220, theme=light.
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import '@fontsource-variable/geist/wght.css';
import '../../src/styles.css';

const params = new URLSearchParams(location.search);
const wait = (ms = 100) => new Promise(r => setTimeout(r, ms));
const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
async function waitFor(check: () => boolean, why: string) {
  for (let n = 0; n < 50; n++) { if (check()) return; await wait(); }
  throw Error(why);
}

async function main() {
  localStorage.clear();
  document.documentElement.dataset.theme = params.get('theme') ?? 'mid';
  const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 240;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#9eaeb2'; context.fillRect(0, 0, 360, 140);
  context.fillStyle = '#656d54'; context.fillRect(0, 140, 360, 100);
  context.fillStyle = '#d8c9b2'; context.fillRect(50, 100, 110, 100);
  context.fillStyle = '#51584f'; context.fillRect(88, 145, 30, 55);
  const jpeg = await (await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/jpeg'))).arrayBuffer();
  mockWindows('main');
  mockIPC(command => command === 'thumbnail' ? jpeg.slice(0) : null);
  const [{ createRoot }, React, store, { Images }, { useWorkspace }, { setPrefs }] = await Promise.all([
    import('react-dom/client'), import('react'), import('../../src/library/store'), import('../../src/ui/Images'), import('../../src/ui/workspace'), import('../../src/ui/prefs')]);
  const photos = Array.from({ length: 1200 }, (_, i) => {
    const name = `DSCF${String(i + 8).padStart(4, '0')}.JPG`;
    return { name, path: `/Photos/field-trip/${name}`, rel: name, size: 42, modified: 1, recipe: null, seed: 1, white: null, rating: 0, label: null, flag: null, raw: false, pair: null };
  });
  store.useApp.setState({ photos, source: null, view: 'develop', active: 0, selected: new Set([photos[0].path]), imageSearch: '', loading: true });
  useWorkspace.setState({ imageColumns: 2 }); setPrefs({ filtersOpen: false });
  const width = Number(params.get('width') ?? 264);
  function Shell() {
    const active = store.useApp(s => s.photos[s.active]?.name);
    return React.createElement('div', { style: { display: 'grid', gridTemplateColumns: `${width}px minmax(0, 1fr)`, height: '100vh' } },
      React.createElement(Images), React.createElement('main', { style: { display: 'grid', alignContent: 'center', justifyItems: 'center', gap: 16, background: 'var(--canvas)', color: 'var(--text)' } },
        React.createElement('img', { src: canvas.toDataURL(), alt: 'Synthetic thumbnail fixture', style: { width: 600, maxWidth: '80%' } }),
        React.createElement('span', { id: 'preview-name' }, active)));
  }
  createRoot(document.getElementById('root')!).render(React.createElement(Shell));
  await wait(300);
  const button = () => document.querySelector<HTMLButtonElement>('button[aria-label="Search filenames"]')!;
  const field = () => document.querySelector<HTMLInputElement>('input[aria-label="Filename"]')!;
  const type = async (value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(), value);
    field().dispatchEvent(new Event('input', { bubbles: true })); await wait();
  };
  assert(!field(), 'Search should begin collapsed');
  const grid = document.querySelector<HTMLElement>('.images-grid')!;
  grid.scrollTop = grid.scrollHeight; grid.dispatchEvent(new Event('scroll')); await wait();
  button().click(); await wait();
  assert(document.activeElement === field(), 'Opening search must focus its input');
  await type(' dscf0009.jpg ');
  assert(store.shown().length === 1 && store.shown()[0] === 1, 'Partial/case-insensitive search did not find the filename');
  await waitFor(() => grid.scrollTop === 0 && !!document.querySelector('[data-index="1"]'), 'Search after scrolling must reveal the matching row');
  assert(store.useApp.getState().active === 0, 'Typing changed the current edit');
  field().form!.requestSubmit(); await wait();
  assert(store.useApp.getState().active === 1 && !field(), 'Submitting must open the first match and collapse search');
  assert(button().getAttribute('aria-pressed') === 'true', 'Collapsed active search must remain visible');
  button().click(); await wait();
  await type('nothing-matches');
  assert(store.shown().length === 0 && document.querySelector('.hint')?.textContent?.includes('No filenames'), 'No-match state missing');
  field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait();
  assert(store.shown().length === 1200 && document.activeElement === button(), 'Escape must restore results and focus');
  button().click(); await wait(); await type('000');
  document.querySelector<HTMLButtonElement>('[aria-label="Clear filename search"]')!.click(); await wait();
  assert(field().value === '' && store.shown().length === 1200, 'Clear must restore photos');
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await wait();
  assert(!field(), 'Clicking outside must dismiss search');
  if (params.get('state') !== 'closed') {
    button().click(); await wait();
    await type(params.get('state') === 'empty' ? 'a-very-long-filename-that-does-not-exist-in-this-folder.RAF' : 'DSCF0009');
  }
  const header = document.querySelector('.images-head')!.getBoundingClientRect();
  const buttons = [...document.querySelectorAll('.images-head > button, .images-search-toggle, .image-view-toggle')];
  for (const control of buttons) assert(control.getBoundingClientRect().right <= header.right, 'Header controls overflow the sidebar');
  const popup = document.querySelector('.images-search-field')?.getBoundingClientRect();
  if (popup) assert(popup.left >= header.left && popup.right <= header.right, 'Search popup overflows the sidebar');
  if (popup && params.get('state') === 'empty') {
    const hint = document.querySelector<HTMLElement>('.images-empty')!;
    const textTop = hint.getBoundingClientRect().top + parseFloat(getComputedStyle(hint).paddingTop);
    assert(textTop >= popup.bottom, 'Search popup hides the empty-state guidance');
  }
  await document.fonts.ready;
  document.body.dataset.result = `PASS: filename search, scoped navigation, scroll reset, focus, submit, Escape, clear, outside dismissal; ${width}px sidebar ${params.get('theme') ?? 'mid'}`;
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error?.stack ?? error)}`; });
