// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { lutFormat } from '../engine/lutstore';
import { lookNameFromPath } from './userlooks';

describe('importing looks', () => {
  it('names a look after its file', () => {
    expect(lookNameFromPath('/Users/me/LUTs/Kodak 2383.cube')).toBe('Kodak 2383');
    expect(lookNameFromPath('C:\\LUTs\\Warm.PNG')).toBe('Warm');
    expect(lookNameFromPath('/x/.cube')).toBe('Imported look');
  });

  it('tells the formats apart by their contents, not their names', async () => {
    expect(await lutFormat(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])]))).toBe('png');
    expect(await lutFormat(new Blob(['TITLE "x"\nLUT_3D_SIZE 2\n0 0 0\n']))).toBe('cube');
    expect(await lutFormat(new Blob(['0 512 1023\n0 0 0\n']))).toBe('3dl');
  });
});
