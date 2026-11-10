// SPDX-License-Identifier: GPL-3.0-or-later
// Settings that matter beyond this window: kept in `settings.json` in the app's data folder (with
// the looks, presets and camera profiles), so they are in the daily backups and the settings
// archive, and survive the webview's storage being cleared. Interface preferences (panel sizes,
// open sections) stay in localStorage. Outside the app (tests, the probe) everything is
// localStorage, as before.
//
// Read synchronously once `loadAppSettings` has run (main.tsx waits for it before importing the
// app). Writes are debounced and go to Rust as one object.
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../backend/api';

/** Keys kept in settings.json. Each was in localStorage before, and is moved from there once. */
export const APP_SETTING_KEYS = [
  'emulsion.presetFavourites',
  'emulsion.presetCollections',
  'emulsion.lookBrowser',
  'emulsion.libraryCatalog',
] as const;
export type AppSettingKey = (typeof APP_SETTING_KEYS)[number];

const DELAY = 300;
let values: Record<string, unknown> = {};
let timer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> = Promise.resolve();
let frozen = false;

const fromLocalStorage = (key: string): unknown => {
  try {
    const text = localStorage.getItem(key);
    return text === null ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Read settings.json, adopting any key still only in localStorage. */
export async function loadAppSettings() {
  if (!isTauri()) return;
  const saved = await invoke<Record<string, unknown>>('read_app_settings');
  values = saved && typeof saved === 'object' ? { ...saved } : {};
  let moved = false;
  for (const key of APP_SETTING_KEYS) {
    if (key in values) continue;
    const v = fromLocalStorage(key);
    if (v !== undefined) {
      values[key] = v;
      moved = true;
    }
  }
  if (moved) await write();
}

export function getSetting(key: AppSettingKey): unknown {
  return isTauri() ? values[key] : fromLocalStorage(key);
}

export function setSetting(key: AppSettingKey, value: unknown) {
  if (!isTauri()) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* session only */ }
    return;
  }
  if (frozen) return;
  values = { ...values, [key]: value };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void write(), DELAY);
}

function write(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const snapshot = values;
  writing = writing
    .then(() => invoke<void>('write_app_settings', { settings: snapshot }))
    .catch((e) => console.error('Could not save settings', e));
  return writing;
}

/** Write anything waiting now. */
export async function flushAppSettings() {
  if (timer) await write();
  await writing;
}

/** Flush, then ignore further changes: the data folder is about to be replaced and the window reloaded. */
export async function freezeAppSettings() {
  await flushAppSettings();
  frozen = true;
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (timer) void write(); });
