// SPDX-License-Identifier: GPL-3.0-or-later
import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../backend/api';
import { normalizePreset, type Preset } from '../film/presets';
let entries: Preset[] = [];
const listeners = new Set<() => void>();
function changed() { listeners.forEach(l => l()); }
export function usePresets() { return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => entries); }
export async function refreshPresets() {
  if (!isTauri()) return;
  entries = (await invoke<unknown[]>('list_presets')).map(normalizePreset).filter((p): p is Preset => !!p);
  changed();
}
export async function savePreset(preset: Preset) {
  await invoke('save_preset', { preset });
  entries = [...entries.filter(p => p.id !== preset.id), preset].sort((a,b) => a.name.localeCompare(b.name));
  changed();
}
export async function deletePreset(id: string) {
  await invoke('delete_preset', { id });
  entries = entries.filter(p => p.id !== id);
  changed();
}

// Favourites and empty collections are remembered on this computer, like Look favourites.
const FAV_KEY = 'emulsion.presetFavourites';
const COLL_KEY = 'emulsion.presetCollections';
const readList = (key: string): string[] => {
  try { const v = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
};
const writeList = (key: string, list: string[]) => { try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* still works for this session */ } };
let favourites = readList(FAV_KEY);
let collections = readList(COLL_KEY);
const prefListeners = new Set<() => void>();
let prefSnapshot = { favourites, collections };
const prefsChanged = () => { prefSnapshot = { favourites, collections }; prefListeners.forEach(l => l()); };
export function usePresetPrefs() { return useSyncExternalStore(cb => { prefListeners.add(cb); return () => { prefListeners.delete(cb); }; }, () => prefSnapshot); }
export function togglePresetFavourite(id: string) {
  favourites = favourites.includes(id) ? favourites.filter(x => x !== id) : [...favourites, id];
  writeList(FAV_KEY, favourites);
  prefsChanged();
}
/** A collection with nothing in it yet: kept so it can be chosen when saving a preset. */
export function addPresetCollection(name: string) {
  const n = name.trim().slice(0, 100);
  if (!n || collections.includes(n)) return;
  collections = [...collections, n].sort((a, b) => a.localeCompare(b));
  writeList(COLL_KEY, collections);
  prefsChanged();
}

/** Save presets read from files as new presets (fresh ids, so nothing is overwritten). Returns how many. */
export async function importPresetFiles(paths: string[], newId: () => string): Promise<number> {
  const values = await invoke<unknown[]>('read_preset_files', { paths });
  const ok = values.map(v => normalizePreset(v && typeof v === 'object' ? { ...(v as object), id: newId() } : v)).filter((p): p is Preset => !!p);
  if (!ok.length) throw new Error('No presets found in the chosen files');
  for (const p of ok) await savePreset(p);
  return ok.length;
}
