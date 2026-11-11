// SPDX-License-Identifier: GPL-3.0-or-later
// Named export settings, backed up with the rest of settings.json. Frame scope
// stays in the dialog: applying a preset never changes which photos are exported.
import { create } from 'zustand';
import { getSetting, setSetting } from './appsettings';
import { normalizeExportSettings, type ExportSettings } from './exportsettings';

export interface ExportPreset {
  id: string;
  name: string;
  settings: ExportSettings;
}

const KEY = 'emulsion.exportPresets' as const;

export function normalizeExportPresets(value: unknown): ExportPreset[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap(v => {
    if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !v.id || ids.has(v.id) || typeof v.name !== 'string' || !v.name.trim() || !v.settings || typeof v.settings !== 'object') return [];
    ids.add(v.id);
    return [{ id: v.id, name: v.name.trim().slice(0, 120), settings: normalizeExportSettings(v.settings) }];
  });
}

export const useExportPresets = create<{ presets: ExportPreset[] }>(() => ({ presets: normalizeExportPresets(getSetting(KEY)) }));
useExportPresets.subscribe(s => setSetting(KEY, s.presets));

export function exportPresetNameError(name: string, except?: string): string | null {
  const clean = name.trim();
  if (!clean) return 'Enter a preset name.';
  if (useExportPresets.getState().presets.some(p => p.id !== except && p.name.toLowerCase() === clean.toLowerCase())) return 'A preset with this name already exists.';
  return null;
}

export function saveExportPreset(name: string, settings: ExportSettings, id: string = crypto.randomUUID()): ExportPreset {
  const clean = name.trim().slice(0, 120);
  const error = exportPresetNameError(clean, id);
  if (error) throw new Error(error);
  const preset = { id, name: clean, settings: normalizeExportSettings(settings) };
  useExportPresets.setState(s => ({ presets: s.presets.some(p => p.id === id) ? s.presets.map(p => p.id === id ? preset : p) : [...s.presets, preset] }));
  return preset;
}

export function deleteExportPreset(id: string) {
  useExportPresets.setState(s => ({ presets: s.presets.filter(p => p.id !== id) }));
}

export const sameExportSettings = (a: ExportSettings, b: ExportSettings) =>
  JSON.stringify(normalizeExportSettings(a)) === JSON.stringify(normalizeExportSettings(b));
