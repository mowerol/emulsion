// SPDX-License-Identifier: GPL-3.0-or-later
import React from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { InputMode } from '../../src/engine/engine';
import { defaultRecipe } from '../../src/film/recipe';
import { newCircleSpot } from '../../src/film/retouch';
import { useApp } from '../../src/library/store';
import { ExportDialog } from '../../src/ui/ExportDialog';
import '../../src/styles.css';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(test: () => unknown) {
  for (let i = 0; i < 200; i++) { if (test()) return; await pause(); }
  throw Error('Timed out waiting for export state');
}
let writes = 0;
mockIPC(async command => {
  if (command === 'load_image') {
    const w = 80, h = 60, buf = new ArrayBuffer(32 + w * h * 8), header = new DataView(buf);
    [w, h, InputMode.DisplayLinear, 0, 0, 0, w, h].forEach((v, i) => header.setUint32(i * 4, v, true));
    const data = new Uint16Array(buf, 32);
    for (let i = 0; i < data.length; i += 4) data.set([0x3400, 0x3400, 0x3400, 0x3c00], i);
    return buf;
  }
  if (command === 'remove_inpaint') throw Error('Remove model missing');
  if (command === 'check_export_dir') return null;
  if (command === 'write_export') { writes++; return { path: '/exports/holiday.jpg', skipped: false }; }
  if (command === 'export_exists') return false;
});
const button = (label: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === label) as HTMLButtonElement;
async function main() {
  const recipe = { ...defaultRecipe(), captureSharpening: 0, profiledDenoise: null, retouch: [newCircleSpot([.5, .5], 'remove')] };
  const photo = { path: '/photos/holiday.jpg', name: 'holiday.jpg', rel: 'holiday.jpg', size: 1, modified: 0, recipe,
    seed: 1, white: null, rating: 0, label: null, heart: false, raw: false, pair: null };
  useApp.setState({ folder: { root: '/photos', name: 'Photos', unreadable: 0 }, photos: [photo], active: 0, selected: new Set([photo.path]), exportOpen: true });
  createRoot(document.getElementById('root')!).render(<ExportDialog />);
  await until(() => button('Export 1 frame'));
  button('Export 1 frame').click();
  await until(() => document.querySelector('[role="alertdialog"]'));
  assert(document.querySelector('[role="alertdialog"]')?.textContent?.includes('holiday.jpg'), 'Warning did not name the photo');
  assert(writes === 0, 'Export wrote before asking');
  assert(document.activeElement === button('Stop export'), 'Warning did not focus the safe action');
  if (new URLSearchParams(location.search).has('visual')) { document.body.dataset.visual = 'export'; await new Promise<void>(() => {}); }
  button('Stop export').click();
  await until(() => !useApp.getState().exportOpen);
  assert(writes === 0, 'Stopping wrote the unfilled photo');
  useApp.setState({ exportOpen: true });
  await until(() => button('Export 1 frame'));
  button('Export 1 frame').click();
  await until(() => document.querySelector('[role="alertdialog"]'));
  button('Export this frame anyway').click();
  await until(() => !useApp.getState().exportOpen);
  assert(writes === 1, 'Explicit continue did not write exactly one photo');
  document.body.dataset.result = 'PASS: export names the unfilled photo, waits for consent, focuses Stop, stops without writing, and writes only after explicit continue';
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)}`; });
