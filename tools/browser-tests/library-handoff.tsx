// SPDX-License-Identifier: GPL-3.0-or-later
// Real Library/Import UI with deterministic disk IPC; run via cdp-timing.mjs library-handoff.
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import '@fontsource-variable/geist';
const query = new URLSearchParams(location.search);
const result = (value: unknown) => { document.body.dataset.result = JSON.stringify(value); };
const wait = (ms = 100) => new Promise(r => setTimeout(r, ms));
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

async function main() {
  localStorage.clear();
  const root = '/Volumes/Oli External/Photos/2026/Portugal';
  const child = `${root}/Lisbon`;
  const photos = Array.from({ length: 64 }, (_, i) => ({ path: `${root}/PA${String(40025 + i).padStart(6, '0')}.ORF`, name: `PA${String(40025 + i).padStart(6, '0')}.ORF`, size: 100, modified: 1, recipe: null, rating: i % 5 === 0 ? 3 : 0, label: null, flag: null, raw: true }));
  const disk = [...photos.slice(0, 37), ...photos.slice(40), { ...photos[0], path: `${child}/Lisbon.ORF`, name: 'Lisbon.ORF' }];
  const entry = (p: typeof photos[number], folder: string) => ({ ...p, rel: p.path.slice(folder.length + 1), meta: { keywords: ['Travel'], fields: {} } });
  const jpg = document.createElement('canvas'); jpg.width = 320; jpg.height = 240;
  const ctx = jpg.getContext('2d')!;
  ctx.fillStyle = '#80a1bb'; ctx.fillRect(0, 0, 320, 105); ctx.fillStyle = '#d2cbb9'; ctx.fillRect(0, 105, 320, 135);
  const bytes = await (await new Promise<Blob>(resolve => jpg.toBlob(b => resolve(b!), 'image/jpeg'))).arrayBuffer();
  mockWindows('main');
  mockIPC(async (command, raw) => {
    const args = raw as { path: string; recursive: boolean; paths: string[] };
    const scope = () => disk.filter(p => p.path.startsWith(args.path + '/') && (args.recursive || !p.path.slice(args.path.length + 1).includes('/')));
    switch (command) {
      case 'read_app_settings': return {};
      case 'scan_folder': return { root: args.path, name: args.path.split('/').pop(), entries: scope().map(p => entry(p, args.path)), unreadable: 0, focus: null, folders: [{ path: child, name: 'Lisbon' }] };
      case 'list_folder_photos': return { entries: scope().map(p => ({ path: p.path, modified: 1 })), unreadable: 0, folders: args.recursive ? [{ path: child, name: 'Lisbon' }] : [] };
      case 'computer_folders': return [{ path: '/Volumes/Oli External', name: 'Oli External' }];
      case 'browse_directory': {
        const parts = root.split('/').filter(Boolean); const at = parts.indexOf(args.path.split('/').pop()!);
        return args.path === root ? [{ path: child, name: 'Lisbon' }] : at >= 0 && at + 1 < parts.length ? [{ path: '/' + parts.slice(0, at + 2).join('/'), name: parts[at + 1] }] : [];
      }
      case 'white_points': return args.paths.map(() => null);
      case 'embedded_metadata': return args.paths.map(() => null);
      case 'catalog_metadata': return args.paths.map(() => ({ camera: 'OM-3', date: '2026-10-12' }));
      case 'photo_exposure': return { iso: 200, shutter: 1 / 1250, aperture: 4.5, focalLength: 17 };
      case 'thumbnail': case 'cull_preview': return bytes.slice(0);
      default: return null;
    }
  });
  const { loadAppSettings } = await import('../../src/library/appsettings'); await loadAppSettings();
  const [{ createRoot }, React, store, catalog, { saveFolderImport }, { TopBar, chooseFolder }, { Library }] = await Promise.all([
    import('react-dom/client'), import('react'), import('../../src/library/store'), import('../../src/library/catalog'), import('../../src/library/folders'), import('../../src/ui/TopBar'), import('../../src/ui/Library')]);
  await import('../../src/styles.css');
  const cached = photos.slice(0, 40).map(p => ({ ...entry(p, root), seed: 1, white: null, pair: null }));
  catalog.cacheFolder(root, cached);
  catalog.cacheFolder(child, []);
  saveFolderImport(root, { mode: 'selected', paths: cached.map(p => p.path), includeSubfolders: false });
  function Shell() {
    const s = store.useApp();
    return React.createElement('div', { className: `app app-library${s.choosingImport ? ' app-import' : ''}` }, React.createElement(TopBar), React.createElement('div', { className: 'workspace workspace-library' }, React.createElement('div', { className: 'main' }, React.createElement(Library))));
  }
  createRoot(document.getElementById('root')!).render(React.createElement(Shell));
  await store.openFolder(root); await wait(500);
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim().startsWith(text))!;
  const check = (text: string) => [...document.querySelectorAll<HTMLLabelElement>('label')].find(l => l.textContent?.includes(text))!.querySelector<HTMLInputElement>('input')!;
  const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
  assert(store.useApp.getState().photos.length === 40, 'Library membership changed on open');
  assert(Math.round(rect('.topbar').height) === 44, 'Header must be 44px');
  assert(Math.round(rect('.library-bar').height) === 40, 'Filters must be 40px');
  assert(Math.round(rect('.library-bottom-bar').height) === 32, 'Bottom bar must be 32px');
  assert(Math.round(rect('.folder-directory').width) === 250, 'Sidebar must be 250px');
  assert(rect('.topbar').right <= innerWidth, 'Header overflows the window');
  if (query.get('screen') === 'develop') {
    store.setView('develop'); await wait();
    const crumb = document.querySelector('.topbar .compact-source h1');
    assert(crumb?.textContent === 'Portugal', 'Develop header must name the folder');
    assert(!document.querySelector('.topbar .compact-source [aria-label="More source actions"]'), 'Develop header keeps source actions in Library');
    return result({ screen: 'develop', folder: crumb.textContent, count: document.querySelector('.topbar .source-count')?.textContent });
  }
  if (query.get('screen') === 'reopen') {
    // Opening another source remounts the grid's scroller ("Reading photos…" in between); the
    // windowed rows must follow the new one, or scrolling shows empty space past the first rows.
    const other = '/Volumes/Oli External/Photos/2026/March';
    catalog.cacheFolder(other, photos.map(p => ({ ...entry({ ...p, path: p.path.replace(root, other) }, other), seed: 1, white: null, pair: null })));
    saveFolderImport(other, { mode: 'selected', paths: photos.map(p => p.path.replace(root, other)), includeSubfolders: false });
    disk.push(...photos.map(p => ({ ...p, path: p.path.replace(root, other) })));
    await store.openFolder(other); await wait(500);
    assert(store.useApp.getState().photos.length === 64, 'Second folder did not open');
    const scroller = document.querySelector<HTMLElement>('.library-grid-scroll')!;
    assert(scroller.scrollHeight > scroller.clientHeight * 1.5, 'Fixture grid should scroll');
    const before = document.querySelectorAll('.grid .cell').length;
    scroller.scrollTop = scroller.scrollHeight; scroller.dispatchEvent(new Event('scroll')); await wait(300);
    const last = document.querySelector('.grid .cell:last-child')?.getAttribute('aria-posinset');
    assert(Number(last) === 64, `Last photo not mounted after reopening and scrolling (last ${last}, ${before} mounted before)`);
    return result({ screen: 'reopen', passed: true, mountedBefore: before, last });
  }
  if (query.get('screen') === 'library') return result({ screen: 'library', gridHeight: Math.round(rect('.library-grid-scroll').height), imported: 40 });
  button('Sync…').focus(); button('Sync…').click(); await wait();
  assert(document.querySelector('dialog[open]'), 'Sync dialog did not open');
  assert(!check('Remove').checked, 'Remove missing must default off');
  assert(check('Only subfolders').checked, 'Known subfolders must default on');
  assert(document.querySelector<HTMLInputElement>('input[name="new-photos"]:checked')?.closest('label')?.textContent?.includes('Choose which'), 'Choose importer must be the default');
  check('Include subfolders').click(); await wait();
  assert(check('Only subfolders').disabled, 'Known subfolder checkbox should disable');
  check('Include subfolders').click(); await wait();
  if (query.get('screen') === 'sync') return result({ screen: 'sync', counts: document.querySelector('.sync-counts')?.textContent });
  button('Cancel').click(); await wait();
  assert(document.activeElement?.id === 'library-sync', 'Sync did not restore focus');
  const oldSelection = [...store.useApp.getState().selected];
  await chooseFolder(); await wait(350);
  assert(!document.querySelector('.views'), 'View switcher should be hidden during import');
  assert(!button('Export'), 'Export should be hidden during import');
  assert(document.querySelectorAll('.import-tile').length > 0 && !document.querySelector('.import-tile input:disabled'), 'Importer should hide known photos');
  assert(button('Import 0 selected').disabled, 'Empty selection should disable import');
  const tile = document.querySelector<HTMLLabelElement>('.import-tile')!;
  tile.click(); await wait();
  assert(button('Import 1 selected'), 'Tile did not toggle its checkbox');
  const tiles = [...document.querySelectorAll<HTMLLabelElement>('.import-tile')];
  tiles[3].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true })); await wait();
  assert(button('Import 4 selected'), 'Shift range did not select 4 photos');
  if (query.get('screen') === 'import') return result({ screen: 'import', selected: 4, gridHeight: Math.round(rect('.import-grid-scroll').height) });
  check('Hide already imported').click(); await wait();
  assert(document.querySelectorAll('.import-tile input:disabled').length > 0, 'Known photos should be disabled');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait();
  assert(!store.useApp.getState().choosingImport, 'Escape did not cancel import');
  assert([...store.useApp.getState().selected].join() === oldSelection.join(), 'Cancel changed Library selection');
  await chooseFolder(); await wait(350);
  check('Hide already imported').click(); await wait();
  document.querySelector<HTMLLabelElement>('.import-tile')!.click(); await wait();
  button('Import 1 selected').click(); await wait(250);
  assert(store.useApp.getState().photos.length === 41, 'Incremental import replaced earlier membership');
  assert(!store.useApp.getState().choosingImport, 'Import did not return to Library');
  button('Sync…').click(); await wait();
  check('Remove').click();
  [...document.querySelectorAll<HTMLLabelElement>('label')].find(l => l.textContent?.includes('Don’t add'))!.click(); await wait();
  document.querySelector<HTMLFormElement>('dialog form')!.requestSubmit(); await wait(400);
  assert(store.useApp.getState().photos.length === 38, 'Explicit missing removal did not retain available photos');
  result({ passed: true, imported: 38, chrome: 116, sidebar: 250 });
}
main().catch(error => result({ error: String(error?.stack ?? error) }));
