// SPDX-License-Identifier: GPL-3.0-or-later
// Real import/library UI; IPC records reads without accessing personal folders or macOS grants.
// node tools/browser-tests/treatment-filters.mjs folder-access
// node tools/browser-tests/webkit.mjs folder-access
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import '@fontsource-variable/geist/wght.css';
import '../../src/styles.css';

const home = '/Users/test';
const shoot = `${home}/Pictures/Shoot`;
const desktop = `${home}/Desktop`;
const documents = `${home}/Documents`;
const oneDrive = `${home}/OneDrive`;
const reads: { cmd: string; path: unknown }[] = [];
let picked: string | null = null;
let denied = true;
const pause = () => new Promise(resolve => setTimeout(resolve, 60));
const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
async function waitFor(test: () => boolean) {
  for (let i = 0; i < 50; i++) { if (test()) return; await pause(); }
  throw Error('UI did not update');
}
async function click(selector: string) {
  const button = document.querySelector<HTMLButtonElement>(selector);
  assert(button, `Missing ${selector}`); button!.click(); await pause();
}

async function main() {
  localStorage.clear();
  const params = new URLSearchParams(location.search);
  document.documentElement.dataset.theme = params.get('theme') ?? 'dark';
  mockWindows('main');
  mockIPC((cmd, args) => {
    const path = args && 'path' in args ? args.path : undefined;
    if (['browse_directory', 'list_folder_photos', 'scan_folder'].includes(cmd)) {
      reads.push({ cmd, path });
      if (denied && path === desktop) throw Error('Operation not permitted');
    }
    if (cmd === 'computer_folders') return [{ path: home, name: 'Home' }, { path: '/', name: 'Computer' }];
    if (cmd === 'browse_directory') return path === home ? [desktop, documents, oneDrive].map(path => ({ path, name: path.split('/').pop()! })) : [];
    if (cmd === 'list_folder_photos') return { entries: [], folders: [], unreadable: 0 };
    if (cmd === 'scan_folder') return { root: path, name: typeof path === 'string' ? path.split('/').pop() : '', entries: [], folders: [], unreadable: 0, focus: null };
    if (cmd === 'plugin:dialog|open') return picked;
    if (cmd === 'read_user_looks') return [];
    return null;
  });
  const { useApp, chooseImport } = await import('../../src/library/store');
  const { useCatalog } = await import('../../src/library/catalog');
  const { saveFolderImport, saveFolderTree } = await import('../../src/library/folders');
  const { Library } = await import('../../src/ui/Library');
  const { TopBar } = await import('../../src/ui/TopBar');
  useApp.setState({ choosingImport: true, source: { type: 'folder', id: shoot }, folder: { root: shoot, name: 'Shoot', unreadable: 0 }, active: -1 });
  useCatalog.setState({ folders: { [shoot]: [], [desktop]: [] }, imports: [], collections: [] });
  saveFolderImport(shoot, { mode: 'selected', paths: [] });
  saveFolderImport(desktop, { mode: 'selected', paths: [] });
  saveFolderTree({ expanded: ['/Users', home], scroll: 0 });
  createRoot(document.getElementById('root')!).render(<StrictMode><div className="app app-library"><TopBar /><div className="workspace workspace-library"><div className="main"><Library /></div></div></div></StrictMode>);
  await waitFor(() => !!document.querySelector('[aria-label="Expand Home"]'));
  await pause();
  assert(!reads.length, `Import initialization read folders: ${JSON.stringify(reads)}`);
  assert(document.querySelector(`[aria-current="location"][title="${shoot}"]`), 'Chosen folder is hidden');
  await click('[aria-label="Expand Home"]');
  assert(reads.length === 1 && reads[0].cmd === 'browse_directory' && reads[0].path === home, 'Displaying Home children scanned their contents');
  await click('[aria-label="Expand Desktop"]');
  assert(document.querySelector('.directory-message')?.textContent?.includes('Could not read this folder'), 'Denied folder lacks recovery');
  const beforePicker = reads.length;
  await click('.directory-message button');
  assert(reads.length === beforePicker, 'Cancelling the native picker read a folder');
  picked = desktop; denied = false;
  await click('.directory-message button');
  await waitFor(() => useApp.getState().folder?.root === desktop && !useApp.getState().loading);
  assert(reads.slice(beforePicker).every(r => r.path === desktop), 'Granting one folder read another location');
  chooseImport(false); await pause();
  const activeFolder = useApp.getState().folder?.root;
  const beforeFocus = reads.length;
  window.dispatchEvent(new Event('focus')); await pause();
  assert(reads.slice(beforeFocus).some(r => r.cmd === 'list_folder_photos' && r.path === activeFolder), 'Focus did not refresh the active folder');
  assert(reads.slice(beforeFocus).every(r => r.path === activeFolder), 'Focus checked an unrelated catalog folder');
  assert(!reads.some(r => r.path === oneDrive || r.path === documents), 'An unrelated protected folder was read');

  // Leave the denied state visible for dark/light and narrow-sidebar visual checks.
  chooseImport(true); await pause();
  await click('[aria-label="Expand Home"]');
  denied = true;
  await click('[aria-label="Expand Desktop"]');
  assert(!document.querySelector('.disk-directory') || document.querySelector('.disk-directory')!.scrollWidth <= document.querySelector('.disk-directory')!.clientWidth, 'Sidebar content overflows');
  document.body.dataset.result = 'PASS: no automatic folder reads, explicit navigation, native picker cancel/grant, local denial recovery, active-folder focus refresh';
}
main().catch(error => { document.body.dataset.result = `FAIL: ${error.stack ?? error}`; });
