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
