// SPDX-License-Identifier: GPL-3.0-or-later
// Times clicking a smart collection in the real Library UI, from a catalog fixture
// (.scratch/smart/fixture.json: settings.json plus the webview's library index and folder imports).
// Native IPC is mocked; scans answer from the index. Run with tools/browser-tests/cdp-timing.mjs.
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';

type Indexed = Record<string, Record<string, unknown>[]>;
const query = new URLSearchParams(location.search);
const result = (r: unknown) => { document.body.dataset.result = JSON.stringify(r); };

async function main() {
  const fixture = await (await fetch(`/.scratch/smart/${query.get('fixture') ?? 'fixture'}.json`)).json();
  localStorage.clear();
  for (const [k, v] of Object.entries(fixture.localStorage as Record<string, string>)) localStorage.setItem(k, v);
  const index: Indexed = JSON.parse(fixture.localStorage['emulsion.libraryIndex']);
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 213;
  canvas.getContext('2d')!.fillRect(0, 0, 320, 213);
  const jpeg = await (await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/jpeg', .8))).arrayBuffer();
  const ipc: Record<string, number> = {};
  const scanDelay = Number(query.get('scanDelay') ?? 0);
  mockWindows('main');
  mockIPC(async (command, args) => {
    ipc[command] = (ipc[command] ?? 0) + 1;
    const a = args as Record<string, unknown>;
    switch (command) {
      case 'read_app_settings': return fixture.settings;
      case 'write_app_settings': return null;
      case 'scan_folder': {
        const root = a.path as string;
        if (scanDelay) await new Promise(r => setTimeout(r, scanDelay));
        const photos = index[root] ?? [];
        const entries = photos.filter(p => !p.copyId).map(p => ({ path: p.path, rel: p.rel, name: p.name, size: p.size, modified: p.modified,
          recipe: p.recipe ?? null, rating: p.rating ?? 0, label: p.label ?? null, flag: p.flag ?? null, meta: p.meta, raw: p.raw,
          copies: photos.filter(c => c.copyId && c.path === p.path).map(c => ({ id: c.copyId, name: c.copyName, recipe: c.recipe, rating: c.rating, label: c.label, flag: c.flag })) }));
        return { root, name: root.split('/').pop(), unreadable: 0, focus: null, folders: [], entries };
      }
      case 'white_points': return (a.paths as string[]).map(p => /\.(orf|raf|arw)$/i.test(p) ? [0.3127, 0.329] : null);
      case 'embedded_metadata': return (a.paths as string[]).map(() => null);
      case 'catalog_metadata': return (a.paths as string[]).map(() => null);
      case 'thumbnail': case 'cull_preview': return jpeg.slice(0);
      case 'computer_folders': case 'browse_directory': return [];
      default: return null;
    }
  });
  const { loadAppSettings } = await import('../../src/library/appsettings');
  await loadAppSettings();
  const [{ createRoot }, { StrictMode, createElement }, { Library }, { TopBar }, store, { useCatalog }] = await Promise.all([
    import('react-dom/client'), import('react'), import('../../src/ui/Library'), import('../../src/ui/TopBar'), import('../../src/library/store'), import('../../src/library/catalog')]);
  await import('../../src/styles.css');
  createRoot(document.getElementById('root')!).render(createElement(StrictMode, null,
    createElement('div', { className: 'app' }, createElement(TopBar), createElement('div', { className: 'workspace workspace-library' }, createElement('div', { className: 'main' }, createElement(Library))))));
  await new Promise(r => setTimeout(r, 500));

  // Where the main thread goes: long tasks, storage writes, store updates.
  const longTasks: number[] = [];
  new PerformanceObserver(list => { for (const e of list.getEntries()) longTasks.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false });
  let storageMs = 0, storageWrites = 0, storageBytes = 0;
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k: string, v: string) { const t = performance.now(); setItem.call(this, k, v); storageMs += performance.now() - t; storageWrites++; storageBytes += v.length; };
  let appUpdates = 0, catalogUpdates = 0;
  store.useApp.subscribe(() => appUpdates++);
  useCatalog.subscribe(() => catalogUpdates++);
  for (const k of Object.keys(ipc)) delete ipc[k];

  const name = query.get('collection') ?? 'OM-3';
  const row = [...document.querySelectorAll<HTMLButtonElement>('button.source-row')].find(b => b.textContent?.includes(name));
  if (!row) return result({ error: `no source row ${name}`, rows: [...document.querySelectorAll('button.source-row')].map(b => b.textContent) });
  const t0 = performance.now();
  if (query.has('hold')) {
    // Freeze the scans to look at the opening state (?hold, screenshot with SHOT=file.png).
    mockIPC(async command => command === 'scan_folder' ? new Promise(() => {}) : command === 'computer_folders' || command === 'browse_directory' ? [] : null);
    row.click();
    await new Promise(r => setTimeout(r, 400));
    return result({ opening: store.useApp.getState().opening, header: document.querySelector('.source-header h1')?.textContent, status: document.querySelector('.library-opening')?.textContent });
  }
  row.click();
  let shownAt = 0, cellsAt = 0;
  for (let i = 0; i < 2000; i++) {
    await new Promise(r => setTimeout(r, 10));
    if (!cellsAt && document.querySelector('.grid .cell')) cellsAt = performance.now() - t0;
    if (!shownAt && !store.useApp.getState().loading && document.querySelector('.grid .cell')) shownAt = performance.now() - t0;
    if (shownAt && performance.now() - t0 > shownAt + 3000) break;
  }
  const s = store.useApp.getState();
  result({ cellsMs: Math.round(cellsAt), shownMs: Math.round(shownAt), photos: s.photos.length, inSource: store.sourceIndices(s).length, cells: document.querySelectorAll('.grid .cell').length,
    longTasks, blockedMs: longTasks.reduce((a, b) => a + b, 0), storageMs: Math.round(storageMs), storageWrites, storageMB: +(storageBytes * 2 / 1e6).toFixed(1),
    appUpdates, catalogUpdates, ipc });
}
main().catch(e => result({ error: String(e?.stack ?? e) }));
