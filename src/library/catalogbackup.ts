// SPDX-License-Identifier: GPL-3.0-or-later
// Catalog backups, as in Lightroom Classic: when Emulsion quits and a backup is due, it offers to
// back up library.db into a folder of the person's choosing (by default Pictures/Emulsion/Backups),
// optionally testing the catalog's integrity first and optimising it after. How often (Lightroom's
// choices, weekly by default) and where are settings; the quit dialog can change both. Restore
// replaces the catalog with a backup after keeping the current one. The zips themselves are made
// and checked in Rust (src-tauri/src/catalog.rs).
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { ask, message, open } from '@tauri-apps/plugin-dialog';
import { isTauri } from '../backend/api';
import { getSetting, setSetting } from './appsettings';
import { flushCatalog, localDay } from './catalog';
import { freezeCatalogDb } from './catalogdb';
import { flushSaves, freezeSaves, resumeSaves } from './sidecars';

export type BackupFrequency = 'always' | 'daily' | 'weekly' | 'monthly' | 'never';
export const BACKUP_FREQUENCIES: { id: BackupFrequency; label: string }[] = [
  { id: 'always', label: 'Every time Emulsion quits' },
  { id: 'daily', label: 'Once a day, when quitting' },
  { id: 'weekly', label: 'Once a week, when quitting' },
  { id: 'monthly', label: 'Once a month, when quitting' },
  { id: 'never', label: 'Never' },
];
export interface BackupSettings {
  frequency: BackupFrequency;
  /** null: the default, Pictures/Emulsion/Backups. */
  folder: string | null;
  testIntegrity: boolean;
  optimize: boolean;
  /** When the last backup was made (ms), or null. */
  last: number | null;
}
const KEY = 'emulsion.catalogBackup' as const;
/** Lightroom Classic's defaults: weekly, both checks on. */
export const BACKUP_DEFAULTS: BackupSettings = { frequency: 'weekly', folder: null, testIntegrity: true, optimize: true, last: null };

export function normalizeBackup(v: unknown): BackupSettings {
  const o = v && typeof v === 'object' ? v as Partial<BackupSettings> : {};
  return {
    frequency: BACKUP_FREQUENCIES.some(f => f.id === o.frequency) ? o.frequency! : BACKUP_DEFAULTS.frequency,
    folder: typeof o.folder === 'string' && o.folder.trim() ? o.folder : null,
    testIntegrity: typeof o.testIntegrity === 'boolean' ? o.testIntegrity : BACKUP_DEFAULTS.testIntegrity,
    optimize: typeof o.optimize === 'boolean' ? o.optimize : BACKUP_DEFAULTS.optimize,
    last: typeof o.last === 'number' && Number.isFinite(o.last) ? o.last : null,
  };
}

const DAY = 86_400_000;
/** Whether quitting now should offer a backup. A day is a calendar day; a week 7 days; a month 30. */
export function backupDue(s: BackupSettings, now = Date.now()): boolean {
  if (s.frequency === 'never') return false;
  if (s.frequency === 'always' || s.last === null) return true;
  if (s.frequency === 'daily') return localDay(s.last) !== localDay(now);
  return now - s.last >= (s.frequency === 'weekly' ? 7 : 30) * DAY;
}

export const useCatalogBackup = create<BackupSettings>(() => normalizeBackup(getSetting(KEY)));
export function setBackupSettings(patch: Partial<BackupSettings>) {
  useCatalogBackup.setState(patch);
  setSetting(KEY, useCatalogBackup.getState());
}

let defaultFolder: string | null = null;
/** Where backups go: the chosen folder, or Pictures/Emulsion/Backups. */
export async function backupFolder(s = useCatalogBackup.getState()): Promise<string> {
  if (s.folder) return s.folder;
  defaultFolder ??= isTauri() ? await invoke<string>('catalog_default_backup_folder') : '~/Pictures/Emulsion/Backups';
  return defaultFolder;
}

export async function chooseBackupFolder(): Promise<string | null> {
  const path = await open({ title: 'Choose a folder for catalog backups', directory: true, multiple: false, defaultPath: await backupFolder() });
  if (typeof path !== 'string') return null;
  setBackupSettings({ folder: path });
  return path;
}

/** Save everything waiting, then back the catalog up with the current settings. */
export async function backUpCatalog(): Promise<{ path: string; bytes: number }> {
  await flushSaves();
  await flushCatalog();
  const s = useCatalogBackup.getState();
  const result = await invoke<{ path: string; bytes: number }>('catalog_backup', { folder: await backupFolder(s), testIntegrity: s.testIntegrity, optimize: s.optimize });
  setBackupSettings({ last: Date.now() });
  return result;
}

export async function showCatalogBackups() {
  await invoke('catalog_show_folder', { folder: await backupFolder() });
}

/** Replace the catalog with a backup the person picks; the current one is kept first. */
export async function restoreCatalog() {
  const folder = await backupFolder();
  const latest = await invoke<string | null>('catalog_latest_backup', { folder }).catch(() => null);
  const path = await open({ title: 'Choose a catalog backup to restore', multiple: false, directory: false, defaultPath: latest ?? folder, filters: [{ name: 'Emulsion catalog backup', extensions: ['zip'] }] });
  if (typeof path !== 'string') return;
  const name = path.split(/[\\/]/).pop() ?? path;
  const ok = await ask(`Replace the library catalog with “${name}”? Folders, imports, collections and catalog edits go back to how they were then. The catalog you have now is kept as its own backup first. Existing sidecar files are left untouched. Emulsion reloads after.`, { title: 'Restore catalog', okLabel: 'Restore', cancelLabel: 'Cancel', kind: 'warning' });
  if (!ok) return;
  const root = document.getElementById('root');
  if (root) root.inert = true;
  try {
    await freezeSaves();
    await flushCatalog();
    await freezeCatalogDb();
  } catch (e) {
    resumeSaves();
    if (root) root.inert = false;
    await message(`The catalog was not replaced because changes could not be saved. ${String(e)}`, { title: 'Could not restore catalog', kind: 'error' });
    return;
  }
  try {
    const r = await invoke<{ before: string }>('catalog_restore', { path });
    await message(`Restored the catalog from “${name}”. The one you had is kept as “${r.before.split(/[\\/]/).pop()}” in Emulsion's backups folder. Emulsion reloads now.`, { title: 'Catalog restored' });
  } catch (e) {
    await message(`Nothing was changed. ${String(e)}`, { title: 'Could not restore the catalog', kind: 'error' });
  }
  // Reload either way: catalog writes were held back while this ran.
  location.reload();
}

/** A byte count as a person would say it. */
export function sizeLabel(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
