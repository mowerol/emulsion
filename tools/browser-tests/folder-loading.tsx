// SPDX-License-Identifier: GPL-3.0-or-later
// Real folder-opening UI with a held scan. Exercises the Tauri Channel and both opening paths.
// SHOT=.scratch/folder-loading.png node tools/browser-tests/realtime.mjs folder-loading 20
import React from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import type { Channel } from '@tauri-apps/api/core';
import type { ScanProgress, ScanResult } from '../../src/backend/api';
import { Library } from '../../src/ui/Library';
import { TopBar } from '../../src/ui/TopBar';
import { useImporter } from '../../src/library/importer';
import { closeFolder, importFolderPhotos, openFolder, useApp } from '../../src/library/store';
import '../../src/styles.css';

const wait = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok: unknown, message: string) => { if (!ok) throw Error(message); };
const root = '/Photos/Weekend';
const scan: ScanResult = { root, name: 'Weekend', folders: [], unreadable: 0, focus: null,
  entries: Array.from({ length: 96 }, (_, i) => {
    const name = `IMG_${String(i + 1).padStart(4, '0')}.JPG`;
    return { path: `${root}/${name}`, name, rel: name, size: 100, modified: 1, raw: false, recipe: null, rating: 0, label: null, flag: null };
  }) };

async function main() {
  localStorage.clear();
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#879b9f'; context.fillRect(0, 0, 320, 140);
  context.fillStyle = '#b7b09a'; context.fillRect(0, 140, 320, 100);
  const thumbnail = await (await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/jpeg'))).arrayBuffer();
  let deliver: ((entries: ScanResult['entries']) => void) | undefined;
  let release!: () => void;
  let held = true;
  const gate = new Promise<void>(resolve => { release = resolve; });
  mockWindows('main');
  mockIPC(async (command, raw) => {
    const args = raw as { onProgress?: Channel<ScanProgress>; paths: string[]; path: string };
    switch (command) {
      case 'scan_folder': {
        const channel = args.onProgress;
        let index = 0;
        const internals = (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, message: unknown) => void } }).__TAURI_INTERNALS__;
        deliver = entries => { if (channel) internals.runCallback(channel.id, { message: { ...scan, entries, total: 96 }, index: index++ }); };
        if (held) await gate;
        if (channel) internals.runCallback(channel.id, { end: true, index });
        return scan;
      }
      case 'thumbnail': return thumbnail.slice(0);
      case 'list_folder_photos': return { entries: scan.entries, folders: [], unreadable: 0 };
      case 'computer_folders': return [{ path: '/Photos', name: 'Photos' }];
      case 'browse_directory': return args.path === '/Photos' ? [{ path: root, name: 'Weekend' }] : [];
      case 'photo_exposure': return { iso: 200, shutter: 1 / 250, aperture: 5.6, focalLength: 25 };
      case 'white_points': case 'embedded_metadata': return args.paths.map(() => null);
      case 'catalog_metadata': return args.paths.map(() => ({ camera: null, date: null }));
      default: return null;
    }
  });
  function Shell() {
    const s = useApp();
    return <div className={`app app-library${s.choosingImport ? ' app-import' : ''}`}><TopBar /><div className="workspace workspace-library"><div className="main"><Library /></div></div></div>;
  }
  createRoot(document.getElementById('root')!).render(<Shell />);
  const opened = openFolder(root);
  while (!deliver) await wait(10);
  deliver(scan.entries.slice(0, 24));
  await wait(250);
  assert(useApp.getState().loading, 'The fixture must still be scanning');
  assert(!document.querySelector('.library-opening'), 'First batch left the blocking loading screen visible');
  assert(document.querySelectorAll('.import-tile').length > 0, 'First batch did not mount import tiles');
  assert(document.querySelector('.import-thumb img'), 'First batch thumbnails did not start loading');
  const selectedTile = document.querySelector<HTMLInputElement>('.import-tile input')!;
  selectedTile.click(); await wait();
  assert(useImporter.getState().picked.size === 1, 'First batch cannot be selected');
  const importSelected = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Import 1 selected');
  assert(importSelected?.disabled, 'Import must wait for the complete scan');
  deliver(scan.entries.slice(24, 48)); await wait();
  assert(useImporter.getState().picked.size === 1, 'Next batch cleared the selection');
  if (new URLSearchParams(location.search).get('screen') === 'import') {
    document.body.dataset.result = `PASS: ${JSON.stringify({ phase: 'import', loaded: 48, total: 96, blockingScreen: false, scanning: true })}`;
    return;
  }
  held = false; release(); await opened; await wait();
  assert(useApp.getState().candidates.length === 96, 'Scan completion lost entries');
  assert(useImporter.getState().picked.size === 1, 'Scan completion cleared import selection');
  importFolderPhotos({ mode: 'sync' });
  closeFolder(); await wait();
  held = true;
  // Hold the second response too, so the cached grid must appear before it returns.
  let finishCached!: () => void;
  const nativeInvoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
  const invoke = nativeInvoke.invoke;
  nativeInvoke.invoke = (command, args) => command === 'scan_folder' ? new Promise(resolve => { finishCached = () => resolve(scan); }) : invoke(command, args);
  const cached = openFolder(root);
  await wait(250);
  assert(useApp.getState().loading, 'Cached scan must still be pending');
  assert(!document.querySelector('.library-opening'), 'Cached folder showed the blocking loading screen');
  assert(document.querySelectorAll('.grid .cell').length > 0, 'Cached photos were not displayed before the scan returned');
  assert(useApp.getState().photos.length === 96, 'Cached folder lost membership');
  finishCached(); await cached; await wait(200);
  document.body.dataset.result = `PASS: ${JSON.stringify({ firstBatch: 24, photos: 96, firstBatchVisibleWhileScanning: true, cachedVisibleWhileScanning: true })}`;
}
main().catch(error => { document.body.dataset.result = `FAIL: ${error.stack ?? error}`; });
