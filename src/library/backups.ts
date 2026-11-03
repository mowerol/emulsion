// SPDX-License-Identifier: GPL-3.0-or-later
// The app menu's settings items: export the looks, presets, camera profiles and settings to one
// file, import such a file, restore one of the daily snapshots (src-tauri/src/app_data.rs), and
// show the snapshots in Finder. A restore or import merges into the data folder, after backing up
// what was there, and reloads the window so every store reads the result.
import { invoke } from '@tauri-apps/api/core';
import { ask, message, open, save } from '@tauri-apps/plugin-dialog';
import { flushAppSettings, freezeAppSettings } from './appsettings';
import { flushSaves } from './sidecars';

export const SETTINGS_EXTENSION = 'emulsion-settings';

interface Snapshot { name: string; path: string }
interface Restored { files: number; settings: number; before: string | null }

/** A snapshot's folder name as a person would say it. */
export function snapshotLabel(name: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(name);
  const date = (y: string, m: string, d: string) =>
    new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  if (day) return date(day[1], day[2], day[3]);
  const upgrade = /^before-(.+)-from-(.+)$/.exec(name);
  if (upgrade) return `Before updating from ${upgrade[2]} to ${upgrade[1]}`;
  const restore = /^before-restore-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\d{2}$/.exec(name);
  if (restore) return `Before the restore of ${date(restore[1], restore[2], restore[3])}, ${restore[4]}:${restore[5]}`;
  return name;
}

const what = 'looks, presets, camera profiles and settings';

function summary(r: Restored) {
  const parts = [`${r.files} ${r.files === 1 ? 'file' : 'files'}`, `${r.settings} ${r.settings === 1 ? 'setting' : 'settings'}`];
  return `Restored ${parts.join(' and ')}.${r.before ? ' What you had before is kept as its own backup.' : ''} Emulsion reloads now.`;
}

async function merge(run: () => Promise<Restored>) {
  await flushSaves();
  await freezeAppSettings();
  try {
    const r = await run();
    await message(summary(r), { title: 'Settings restored' });
  } catch (e) {
    await message(String(e), { title: 'Could not restore settings', kind: 'error' });
  }
  // Reload either way: settings changes were held back while this ran.
  location.reload();
}

export async function exportSettings() {
  await flushAppSettings();
  const path = await save({ title: `Export ${what}`, defaultPath: `Emulsion settings.${SETTINGS_EXTENSION}`, filters: [{ name: 'Emulsion settings', extensions: [SETTINGS_EXTENSION] }] });
  if (!path) return;
  try {
    const n = await invoke<number>('export_app_settings', { path });
    await message(`Exported ${n} ${n === 1 ? 'file' : 'files'}.`, { title: 'Settings exported' });
  } catch (e) {
    await message(String(e), { title: 'Could not export settings', kind: 'error' });
  }
}

export async function importSettings() {
  const path = await open({ title: `Import ${what}`, multiple: false, directory: false, filters: [{ name: 'Emulsion settings', extensions: [SETTINGS_EXTENSION] }] });
  if (typeof path !== 'string') return;
  const ok = await ask(`Add the ${what} in this file to Emulsion? Ones with the same name as yours replace them; nothing is deleted. What you have now is backed up first.`, { title: 'Import settings', okLabel: 'Import', cancelLabel: 'Cancel' });
  if (ok) await merge(() => invoke<Restored>('import_app_settings', { path }));
}

export async function restoreSettings() {
  const snapshots = await invoke<Snapshot[]>('app_backups');
  if (!snapshots.length) {
    await message('Emulsion makes its first backup when you next open it with looks, presets or settings saved.', { title: 'No backups yet' });
    return;
  }
  const folder = snapshots[0].path.replace(/[\\/][^\\/]+$/, '');
  const path = await open({ title: 'Choose a backup to restore', directory: true, multiple: false, defaultPath: folder });
  if (typeof path !== 'string') return;
  const name = path.split(/[\\/]/).pop() ?? path;
  const ok = await ask(`Restore the ${what} from the backup “${snapshotLabel(name)}”? Ones changed or deleted since come back; ones added since are kept. What you have now is backed up first.`, { title: 'Restore settings', okLabel: 'Restore', cancelLabel: 'Cancel' });
  if (ok) await merge(() => invoke<Restored>('restore_app_backup', { path }));
}

export const showBackups = () => invoke<void>('show_app_backups').catch((e) => message(String(e), { title: 'Could not show backups', kind: 'error' }));

/** Handle an app-menu item; false when it isn't one of these. */
export function settingsMenuAction(id: string): boolean {
  const run = { 'settings-export': exportSettings, 'settings-import': importSettings, 'settings-restore': restoreSettings, 'settings-show-backups': showBackups }[id];
  if (!run) return false;
  void run();
  return true;
}
