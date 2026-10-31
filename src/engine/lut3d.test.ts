// SPDX-License-Identifier: GPL-3.0-or-later
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LutError, parse3dl, parseCube, parseHald, tetrahedral, writeCube, type Clut } from './lut3d';

/** An identity LUT bent by f at the grid points. */
function grid(level: number, f: (r: number, g: number, b: number) => number[]): Clut {
  const data = new Float32Array(level ** 3 * 3);
  for (let b = 0; b < level; b++)
    for (let g = 0; g < level; g++)
      for (let r = 0; r < level; r++) data.set(f(r / (level - 1), g / (level - 1), b / (level - 1)), ((b * level + g) * level + r) * 3);
  return { level, data };
}

describe("darktable's lut3d", () => {
  it('reproduces any colour through an identity LUT, and linear maps exactly (tetrahedral)', () => {
    const id = grid(5, (r, g, b) => [r, g, b]);
    const lin = grid(9, (r, g, b) => [0.2 + 0.5 * r + 0.1 * b, g * g, 1 - b]);
    for (const c of [[0, 0, 0], [1, 1, 1], [0.3, 0.7, 0.1], [0.91, 0.12, 0.55], [0.5, 0.5, 0.5]]) {
      tetrahedral(id, c).forEach((v, k) => expect(v).toBeCloseTo(c[k], 6));
      const out = tetrahedral(lin, c);
      expect(out[0]).toBeCloseTo(0.2 + 0.5 * c[0] + 0.1 * c[2], 6);
      expect(out[2]).toBeCloseTo(1 - c[2], 6);
    }
    // inputs are clipped to [0, 1]
    expect(tetrahedral(id, [-1, 2, 0.5])).toEqual([0, 1, expect.closeTo(0.5, 6)]);
  });

  it('reads a .cube with comments, title and domain, red fastest', () => {
    const lut = grid(2, (r, g, b) => [r, g * 0.5, b * 0.25]);
    const text = writeCube(lut, 'test', ['made for a test']);
    const back = parseCube(text);
    expect(back.level).toBe(2);
    expect(Array.from(back.data)).toEqual(Array.from(lut.data));
    expect(parseCube('LUT_3D_SIZE 2\n' + '0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1   # last\n').data[3]).toBe(1);
  });

  it('refuses what darktable refuses', () => {
    expect(() => parseCube('LUT_1D_SIZE 4\n')).toThrow(LutError);
    expect(() => parseCube('DOMAIN_MAX 2 2 2\nLUT_3D_SIZE 2\n')).toThrow(LutError);
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n')).toThrow(/1 lines, it should have 8/);
    expect(() => parseCube('0 0 0\n')).toThrow(/size is not defined/);
  });

  it('reads a .3dl: blue fastest, normalised by its bit depth', () => {
    // the shaper line's token count is the level
    const lines = ['0 341 682 1023'];
    for (let r = 0; r < 4; r++) for (let g = 0; g < 4; g++) for (let b = 0; b < 4; b++) lines.push(`${r * 341} ${g * 341} ${b * 341}`);
    const lut = parse3dl(lines.join('\n'));
    expect(lut.level).toBe(4);
    // entry (r=3, g=0, b=1) sits at index r + 4g + 16b
    const k = (3 + 0 * 4 + 1 * 16) * 3;
    expect(lut.data[k]).toBeCloseTo(1023 / 1023, 6);
    expect(lut.data[k + 2]).toBeCloseTo(341 / 1023, 6);
  });

  it('reads a Hald image: side L^3 holds L^2 levels', () => {
    const size = 8; // L = 2, level 4
    const px = new Uint8Array(size * size * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 3) % 256));
    const lut = parseHald(px, size, size);
    expect(lut.level).toBe(4);
    expect(lut.data[3]).toBeCloseTo(px[4] / 255, 6);
    expect(() => parseHald(px, 9, 9)).toThrow(LutError);
  });

  it('the shipped t3mujinpack Hald is level 144 (12^3 = 1728 pixels a side)', () => {
    const f = readFileSync(new URL('../../public/looks/t3mujinpack/t3mujinpack - Color Negative - Kodak Portra 400.png', import.meta.url));
    expect(f.readUInt32BE(16)).toBe(1728);
    expect(f.readUInt32BE(20)).toBe(1728);
  });
});
