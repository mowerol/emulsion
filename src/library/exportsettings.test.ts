// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { EXPORT_DEFAULTS, exportOptions, normalizeExportSettings } from './exportsettings';
import { cleanSubfolder, exportDirFor, parentDir } from './export';

it('starts where exports always went, and repairs stored settings', () => {
  expect(normalizeExportSettings(null)).toEqual(EXPORT_DEFAULTS);
  expect(exportOptions(EXPORT_DEFAULTS, '/shoot')).toEqual({ dir: '/shoot', subfolder: 'Emulsion exports', longEdge: null,
    format: { kind: 'jpeg', quality: 92 }, existing: 'rename', metadata: expect.objectContaining({ include: 'all' }) });
  const bad = normalizeExportSettings({ format: 'gif', pngBits: 12, existing: 'ask', jpegQuality: 400, longEdge: 'big', folder: '' });
  expect([bad.format, bad.pngBits, bad.existing, bad.jpegQuality, bad.longEdge, bad.folder]).toEqual(['jpeg', 16, 'rename', 100, null, null]);
});

it('builds each format and destination', () => {
  const s = normalizeExportSettings({ format: 'tiff', tiffBits: 8, tiffCompression: 'lzw', destination: 'original', useSubfolder: false, existing: 'skip', longEdge: 2048 });
  expect(exportOptions(s, '/shoot')).toEqual({ dir: null, subfolder: '', longEdge: 2048, format: { kind: 'tiff', bits: 8, compression: 'lzw' }, existing: 'skip', metadata: expect.anything() });
  expect(exportOptions({ ...s, format: 'png', destination: 'folder', folder: '/out' }, '/shoot').format).toEqual({ kind: 'png', bits: 16 });
  expect(exportOptions({ ...s, destination: 'folder', folder: '/out' }, '/shoot').dir).toBe('/out');
});

it('keeps subfolders inside the export folder', () => {
  expect(cleanSubfolder('Web')).toEqual(['Web']);
  expect(cleanSubfolder('  Client/2026: final  ')).toEqual(['Client', '2026_ final']);
  expect(cleanSubfolder('../../etc')).toEqual(['etc']);
  expect(cleanSubfolder('a\\b//./c.')).toEqual(['a', 'b', 'c']);
  expect(cleanSubfolder(' / ')).toEqual([]);
  expect(parentDir('/shoot/a.raf')).toBe('/shoot');
  expect(parentDir('C:\\shoot\\a.raf')).toBe('C:\\shoot');
  expect(exportDirFor({ path: '/shoot/a.raf' }, { dir: null, subfolder: '' })).toBe('/shoot');
  expect(exportDirFor({ path: '/shoot/a.raf' }, { dir: '/out/', subfolder: 'x/y' })).toBe('/out/x/y');
  expect(exportDirFor({ path: 'C:\\shoot\\a.raf' }, { dir: null, subfolder: 'web' })).toBe('C:\\shoot\\web');
});

describe('export metadata settings', () => {
  it('defaults to all metadata, keeping person and location, without the hierarchy', () => {
    expect(normalizeExportSettings(null)).toMatchObject({ metadata: 'all', removePerson: false, removeLocation: false, hierarchy: false });
    expect(normalizeExportSettings({ metadata: 'copyright', removeLocation: true, hierarchy: 'yes' })).toMatchObject({ metadata: 'copyright', removeLocation: true, hierarchy: false });
    expect(normalizeExportSettings({ metadata: 'everything' }).metadata).toBe('all');
    expect(exportOptions({ ...EXPORT_DEFAULTS, removePerson: true }, '/f').metadata).toEqual({ include: 'all', removePerson: true, removeLocation: false, hierarchy: false, personKeywords: [] });
  });
});
