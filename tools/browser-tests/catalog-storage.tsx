// SPDX-License-Identifier: GPL-3.0-or-later
// Exercise persisted preferences, migration notice, export errors, and the real failed-save
// queue through the interface. Rust integration tests cover filesystem/SQLite behavior.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsDialog } from '../../src/ui/SettingsDialog';
import { StorageNotice } from '../../src/ui/StorageNotice';
import { useEditStorage } from '../../src/library/editstorage';
import { flushSaves, savePhoto } from '../../src/library/sidecars';
import '../../src/styles.css';

const wait = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const options = { writeSidecars: false, writeXmp: false, noticeSeen: false };
let failPreference = false, failSave = true;
const writes: unknown[] = [];
(window as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string, args: any) => {
  if (cmd === 'edit_storage_options') {
    if (failPreference) throw Error('Disk full');
    writes.push(args.options); return args.options;
  }
  if (cmd === 'write_sidecar') { if (failSave) throw Error('Catalog is read-only'); return; }
  if (cmd === 'catalog_default_backup_folder') return '/Users/Photographer/Pictures/Emulsion/Backups';
  return null;
} };
document.documentElement.dataset.theme = 'dark';
useEditStorage.setState({ options, status: { migrated: 100, pending: 2, issues: ['/Volumes/Archive/IMG_002.RAF: its saved edit file could not be read'], existingUser: true, options } });
createRoot(document.getElementById('root')!).render(<><SettingsDialog /><StorageNotice /></>);

(async () => {
  await wait(100);
  const look = new URLSearchParams(location.search).get('look');
  assert(document.querySelector('[aria-label="Catalog saving"]'), 'Migration notice missing');
  if (look === 'notice') { document.body.dataset.result = 'PASS: migration notice shown'; return; }
  document.querySelector<HTMLButtonElement>('.storage-notice button')!.click();
  await wait(100);
  const dialog = document.querySelector<HTMLDialogElement>('dialog.settings-dialog')!;
  assert(dialog?.open, 'Notice did not open Settings');
  const catalog = dialog.querySelector<HTMLElement>('[aria-labelledby="settings-catalog"]')!;
  catalog.scrollIntoView({ block: 'start' });
  await wait();
  assert(dialog.scrollWidth <= dialog.clientWidth + 1, 'Settings overflow sideways');
  if (look === 'settings') { document.body.dataset.result = 'PASS: catalog preferences shown'; return; }
  const sidecars = dialog.querySelector<HTMLInputElement>('[aria-label="Also write edits beside photos"]')!;
  const xmp = dialog.querySelector<HTMLInputElement>('[aria-label="Share ratings and metadata with other apps"]')!;
  assert(!sidecars.checked && !xmp.checked, 'Catalog storage should default to no automatic exports');
  sidecars.click(); await wait();
  assert(useEditStorage.getState().options.writeSidecars && writes.length === 1, 'Sidecar preference did not persist');
  failPreference = true; xmp.click(); await wait();
  assert(!xmp.checked && useEditStorage.getState().error?.includes('Disk full'), 'Failed preference appeared saved');
  failPreference = false; xmp.click(); await wait();
  assert(xmp.checked && !useEditStorage.getState().error, 'Preference retry failed');
  dialog.querySelector<HTMLButtonElement>('header button')!.click(); await wait();
  document.querySelector<HTMLButtonElement>('.storage-notice-actions button:last-child')!.click(); await wait();
  assert(!document.querySelector('[aria-label="Catalog saving"]') && useEditStorage.getState().options.noticeSeen, 'Notice acknowledgement was not saved');
  savePhoto({ path: '/Volumes/Archive/IMG_001.RAF', recipe: { exposure: 1 }, rating: 0, label: null, flag: null });
  await flushSaves().catch(() => {}); await wait();
  assert(document.querySelector('[aria-label="Unsaved changes"]')?.textContent?.includes('Catalog is read-only'), 'Save failure is not persistently visible');
  if (look === 'error') { document.body.dataset.result = 'PASS: failed-save retry shown'; return; }
  failSave = false;
  document.querySelector<HTMLButtonElement>('[aria-label="Unsaved changes"] button')!.click(); await wait(100);
  assert(!document.querySelector('[aria-label="Unsaved changes"]'), 'Successful retry did not clear failed save');
  document.body.dataset.result = 'PASS: default catalog storage, independent persistent exports, preference error/retry, migration notice, and failed-save retry';
})().catch(e => { document.body.dataset.result = `FAIL: ${String(e)} ${e?.stack ?? ''}`; });
