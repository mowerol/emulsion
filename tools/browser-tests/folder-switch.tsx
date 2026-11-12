// SPDX-License-Identifier: GPL-3.0-or-later
// Real Library, isolated catalog and held scan IPC. Run in wk-run.swift for WebKit timings.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import type { Photo } from '../../src/library/store';
import '../../src/styles.css';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const painted = () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
async function main() {
  localStorage.clear();
  const folders: Record<string, Photo[]> = {};
  for (let f = 0; f < 8; f++) {
    const root = `/photos/${f}`;
    folders[root] = Array.from({ length: f === 7 ? 1000 : 3000 }, (_, i) => {
      const name = `IMG_${f}_${Math.floor(i / 2)}.${i % 2 ? 'JPG' : 'ORF'}`;
      return { path: `${root}/${name}`, name, rel: name, size: 1, modified: 1, raw: i % 2 === 0, recipe: null, seed: 0,
        rating: 0, label: null, flag: null, pair: null, white: null, capture: { camera: null, date: null }, read: { white: true, embedded: null } };
    });
  }
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
  canvas.getContext('2d')!.fillRect(0, 0, 320, 240);
  const thumbnail = await (await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/jpeg'))).arrayBuffer();
  let release: (() => void) | undefined;
  function finishScan() {
    if (!release) throw Error('Scan has not started');
    release();
  }
  mockWindows('main');
  mockIPC(async (cmd, raw) => {
    const args = raw as { path: string; paths: string[] };
    if (cmd === 'scan_folder') {
      await new Promise<void>(r => { release = r; });
      return { root: args.path, name: args.path.split('/').pop(), unreadable: 0, focus: null, folders: [], entries: folders[args.path] };
    }
    if (cmd === 'thumbnail') return thumbnail.slice(0);
    if (cmd === 'computer_folders' || cmd === 'browse_directory') return [];
    if (cmd === 'white_points' || cmd === 'embedded_metadata') return args.paths.map(() => null);
    if (cmd === 'catalog_metadata') return args.paths.map(() => ({ camera: null, date: null }));
    return null;
  });
  const { useCatalog } = await import('../../src/library/catalog');
  const { saveFolderImport } = await import('../../src/library/folders');
  const { openFolder, useApp } = await import('../../src/library/store');
  const { Library } = await import('../../src/ui/Library');
  useCatalog.setState({ folders, imports: [], collections: [] });
  for (const [root, photos] of Object.entries(folders)) saveFolderImport(root, { mode: 'selected', paths: photos.map(p => p.path) });
  createRoot(document.getElementById('root')!).render(<div className="app app-library"><div className="workspace workspace-library"><div className="main"><Library /></div></div></div>);
  await wait(250);
  const samples = [];
  for (let i = 0; i < 6; i++) {
    release = undefined;
    const t0 = performance.now();
    const opening = openFolder(`/photos/${i % 2}`);
    const sync = performance.now() - t0;
    await painted();
    const grid = performance.now() - t0;
    if (!document.querySelector('.grid .cell') || useApp.getState().photos.length !== 1500) throw Error('Cached grid missing before scan');
    while (!release) await wait(1);
    const t1 = performance.now();
    finishScan(); await opening; await painted();
    const refresh = performance.now() - t1;
    samples.push({ sync: Math.round(sync), grid: Math.round(grid), refresh: Math.round(refresh), mounted: document.querySelectorAll('.cell').length });
    await wait(250);
  }
  const ok = samples.slice(1).every(s => s.grid <= 100 && s.refresh <= 100);
  document.body.dataset.result = `${ok ? 'PASS' : 'FAIL'}: ${JSON.stringify({ samples, budgetMs: 100, photos: 22000, mockedDisk: true })}`;
}
main().catch(error => { document.body.dataset.result = `FAIL: ${error.stack ?? error}`; });
