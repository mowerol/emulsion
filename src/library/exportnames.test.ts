// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { exportName, planExportNames, templateError } from './exportnames';
import type { Photo } from './store';

const photo = (name = 'DSCF0101.RAF', path = `/photos/${name}`): Photo => ({ name, path, rel: name, size: 1,
  modified: new Date(2026, 10, 11, 12).getTime(), recipe: null, seed: 1, white: null, rating: 0, label: null, flag: null, raw: true, pair: null });

describe('export naming', () => {
  it('keeps original and copy-specific names by default', () => {
    expect(exportName(photo(), undefined, 0)).toBe('DSCF0101');
    const copy = { ...photo(), copyId: 'copy-123', copyName: 'Warm' };
    expect(exportName(copy, undefined, 0)).toBe('DSCF0101_Warm_copy-123');
    expect(exportName(copy, { template: '{filename}-{sequence}', start: 7 }, 1)).toBe('DSCF0101_Warm_copy-123-008');
  });

  it('uses the recorded capture date without a timezone shift, falling back to modification date', () => {
    expect(exportName({ ...photo(), capture: { camera: null, date: '2025-01-02' } }, { template: 'Lisbon-{date}-{sequence}', start: 998 }, 3)).toBe('Lisbon-20250102-1001');
    expect(exportName(photo(), { template: '{date}', start: 1 }, 0)).toBe('20261111');
  });

  it('rejects broken templates before writing', () => {
    for (const bad of ['', '   ', '../', '{unknown}', '{filename', '{{date}}']) expect(templateError(bad)).toBeTruthy();
    expect(templateError('Client-{date}-{sequence}')).toBeNull();
    expect(() => planExportNames([photo()], { template: '{oops}', start: 1 }, () => '/out')).toThrow('Unknown token');
    expect(() => planExportNames([photo()], { template: 'Photo', start: NaN }, () => '/out')).toThrow('Start number');
  });

  it('keeps custom names in the destination with room for collision suffixes and the extension', () => {
    expect(exportName(photo(), { template: '../../Client: Summer/{filename}', start: 1 }, 0)).toBe('_.._Client_ Summer_DSCF0101');
    expect(exportName(photo(), { template: 'CON', start: 1 }, 0)).toBe('_CON');
    const name = exportName(photo(), { template: '旅'.repeat(150), start: 1 }, 0);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(220);
    expect(name).not.toContain('\ufffd');
  });

  it('gives same-name frames distinct paths even with Replace or Skip, including case and Unicode collisions', () => {
    const photos = [photo('a.RAF'), photo('A.jpg', '/other/A.jpg'), photo('a-2.RAF'), photo('a.RAF', '/third/a.RAF')];
    expect(planExportNames(photos, undefined, () => '/out')).toEqual(['a', 'A-2', 'a-2-2', 'a-3']);
    expect(planExportNames(photos, { template: 'Client', start: 1 }, p => p.path.startsWith('/photos/') ? '/out' : '/else')).toEqual(['Client', 'Client', 'Client-2', 'Client-2']);
    expect(planExportNames([photo('é.RAF'), photo('e\u0301.RAF')], undefined, () => '/out')).toEqual(['é', 'e\u0301-2']);
  });
});
