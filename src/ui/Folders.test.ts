// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DiskDirectory, FolderDirectory } from './Folders';
import { TopBar } from './TopBar';
import { chooseImport, useApp, type Photo } from '../library/store';
import { useCatalog } from '../library/catalog';
import { useDisks } from '../library/disks';

const home = '/Users/test';
const photos = `${home}/Pictures/Shoot`;
const protectedFolders = ['Desktop', 'Documents', 'Downloads', 'OneDrive'].map(name => `${home}/${name}`);
let host: HTMLDivElement, root: Root;
let reads: { cmd: string; path: unknown }[];
let denied: Set<string>;
let picked: string | null;
const photo = (folder: string): Photo => ({ path: `${folder}/a.jpg`, name: 'a.jpg', rel: 'a.jpg', size: 1, modified: 1,
  raw: false, recipe: null, rating: 0, label: null, flag: null, seed: 1, white: null, pair: null });
const render = async (component: typeof DiskDirectory | typeof FolderDirectory | typeof TopBar) => {
  await act(async () => root.render(createElement(StrictMode, null, createElement(component))));
};
const click = async (selector: string) => {
  const button = host.querySelector<HTMLButtonElement>(selector);
  expect(button, selector).not.toBeNull();
  await act(async () => button!.click());
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  useApp.setState({ folder: null, opening: null, source: null, photos: [], hidden: [], candidates: [],
    active: -1, choosingImport: true, loading: false, lookEdit: null, importChoice: null, includeSubfolders: false });
  useCatalog.setState({ folders: {}, imports: [], collections: [] });
  useDisks.setState({ folders: {} });
  reads = []; denied = new Set(); picked = null;
  mockIPC((cmd, args) => {
    const path = args && 'path' in args ? args.path : undefined;
    if (cmd === 'browse_directory' || cmd === 'list_folder_photos' || cmd === 'scan_folder') {
      reads.push({ cmd, path });
      if (typeof path === 'string' && denied.has(path)) throw Error('Operation not permitted');
    }
    if (cmd === 'computer_folders') return [{ path: home, name: 'Home' }, { path: '/', name: 'Computer' }];
    if (cmd === 'browse_directory') return path === home ? protectedFolders.map(path => ({ path, name: path.split('/').pop()! })) : [];
    if (cmd === 'list_folder_photos') return { entries: [], folders: [], unreadable: 0 };
    if (cmd === 'scan_folder') return { root: path, name: 'Shoot', entries: [], folders: [], unreadable: 0, focus: null };
    if (cmd === 'plugin:dialog|open') return picked;
    return null;
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); chooseImport(false); });
  host.remove(); clearMocks();
  vi.unstubAllGlobals();
});

it('does not scan displayed folders or Home children before the user opens one', async () => {
  await render(DiskDirectory);
  expect(reads).toEqual([]);
  await click('[aria-label="Expand Home"]');
  expect(reads).toEqual([{ cmd: 'browse_directory', path: home }]);
  for (const path of protectedFolders) expect(host.querySelector(`[title="${path}"]`)).not.toBeNull();
});

it('does not browse ancestors automatically after choosing a nested folder', async () => {
  useApp.setState({ folder: { root: photos, name: 'Shoot', unreadable: 0 } });
  await render(DiskDirectory);
  expect(host.querySelector(`[aria-current="location"][title="${photos}"]`)).not.toBeNull();
  expect(reads).toEqual([]);
  await click('[aria-label="Expand Shoot"]');
  expect(reads).toEqual([{ cmd: 'browse_directory', path: photos }]);
});

it('keeps denied navigation local and can still open another folder', async () => {
  await render(DiskDirectory);
  await click('[aria-label="Expand Home"]');
  denied.add(protectedFolders[0]);
  await click('[aria-label="Expand Desktop"]');
  expect(host.textContent).toContain('Could not read this folder');
  expect(reads.filter(r => r.path === protectedFolders[0])).toEqual([{ cmd: 'browse_directory', path: protectedFolders[0] }]);
  await click(`[title="${protectedFolders[1]}"]`);
  expect(reads.filter(r => r.cmd === 'scan_folder').map(r => r.path)).toEqual([protectedFolders[1]]);
  expect(useApp.getState().folder?.root).toBe(protectedFolders[1]);
});

it('opens only the folder returned by the native picker, and does nothing on cancel', async () => {
  await render(DiskDirectory);
  await click('.source-footer');
  expect(reads).toEqual([]);
  picked = photos;
  await click('.source-footer');
  expect(reads).toEqual([{ cmd: 'scan_folder', path: photos }]);
});

it('offers the native picker for an unreadable folder and waits for a selection', async () => {
  await render(DiskDirectory);
  await click('[aria-label="Expand Home"]');
  denied.add(protectedFolders[0]);
  await click('[aria-label="Expand Desktop"]');
  const previousReads = [...reads];
  await click('.directory-message button');
  expect(reads).toEqual(previousReads);
  denied.delete(protectedFolders[0]); picked = protectedFolders[0];
  await click('.directory-message button');
  const allowedReads = reads.slice(previousReads.length);
  expect(allowedReads.filter(r => r.cmd === 'scan_folder')).toEqual([{ cmd: 'scan_folder', path: protectedFolders[0] }]);
  expect(allowedReads.every(r => r.path === protectedFolders[0])).toBe(true);
});

it('keeps the previous source usable when opening a folder is denied', async () => {
  useApp.setState({ folder: { root: photos, name: 'Shoot', unreadable: 0 }, source: { type: 'folder', id: photos },
    photos: [photo(photos)], choosingImport: false });
  await render(DiskDirectory);
  await click('[aria-label="Expand Home"]');
  denied.add(protectedFolders[0]);
  await click(`[title="${protectedFolders[0]}"]`);
  expect(useApp.getState().source).toEqual({ type: 'folder', id: photos });
  expect(useApp.getState().photos.map(p => p.path)).toEqual([`${photos}/a.jpg`]);
  expect(useApp.getState().loading).toBe(false);
  expect(useApp.getState().choosingImport).toBe(false);
});

it('renders saved library folders from the catalog without checking their disks', async () => {
  useCatalog.setState({ folders: Object.fromEntries(protectedFolders.map(path => [path, [photo(path)]])) });
  localStorage.setItem('emulsion.folderTree', JSON.stringify({ expanded: ['/Users', home], scroll: 0 }));
  await render(FolderDirectory);
  expect(host.querySelector(`[title="${protectedFolders[0]}"]`)).not.toBeNull();
  expect(reads).toEqual([]);
});

it('refreshes only the active folder on focus, leaving other catalog folders alone', async () => {
  useApp.setState({ folder: { root: photos, name: 'Shoot', unreadable: 0 }, source: { type: 'folder', id: photos }, choosingImport: false });
  useCatalog.setState({ folders: { [photos]: [photo(photos)], [protectedFolders[0]]: [photo(protectedFolders[0])] } });
  await render(TopBar);
  reads.length = 0;
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(reads).toEqual([{ cmd: 'list_folder_photos', path: photos }]);
});
