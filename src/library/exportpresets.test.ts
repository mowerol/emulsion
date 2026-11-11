// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getSetting } from './appsettings';
import { EXPORT_DEFAULTS, exportOptions } from './exportsettings';
import { deleteExportPreset, normalizeExportPresets, sameExportSettings, saveExportPreset, useExportPresets } from './exportpresets';

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
  useExportPresets.setState({ presets: [] });
});
afterEach(() => vi.unstubAllGlobals());

it('persists independent settings snapshots, updates explicitly and deletes without changing current settings', () => {
  const settings = { ...EXPORT_DEFAULTS, longEdge: 2048, rename: true, filenameTemplate: 'Web-{sequence}', removeLocation: true };
  const p = saveExportPreset(' Web ', settings);
  settings.longEdge = 4096;
  expect(p.settings.longEdge).toBe(2048);
  expect(sameExportSettings(p.settings, settings)).toBe(false);
  expect(getSetting('emulsion.exportPresets')).toEqual([p]);
  expect(exportOptions(p.settings, '/photos')).toMatchObject({ longEdge: 2048, naming: { template: 'Web-{sequence}', start: 1 }, metadata: { removeLocation: true } });
  const updated = saveExportPreset('Web', settings, p.id);
  expect(useExportPresets.getState().presets).toEqual([updated]);
  expect(sameExportSettings(updated.settings, settings)).toBe(true);
  deleteExportPreset(p.id);
  expect(getSetting('emulsion.exportPresets')).toEqual([]);
  expect(settings.longEdge).toBe(4096);
});

it('rejects ambiguous names and repairs old or malformed preset settings', () => {
  saveExportPreset('Web', EXPORT_DEFAULTS);
  expect(() => saveExportPreset(' web ', EXPORT_DEFAULTS)).toThrow('already exists');
  expect(() => saveExportPreset('  ', EXPORT_DEFAULTS)).toThrow('Enter a preset name');
  expect(normalizeExportPresets([null, {}, { id: 'a', name: ' Web ', settings: { format: 'gif' } }, { id: 'a', name: 'Duplicate', settings: {} }])).toEqual([
    { id: 'a', name: 'Web', settings: EXPORT_DEFAULTS },
  ]);
});
