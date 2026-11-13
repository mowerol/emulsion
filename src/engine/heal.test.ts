// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { heal } from './heal';
import { prepareHeal } from './healkernel';
import fixture from './fixtures/heal-reference.json';

// The fixture is darktable's own heal.c run on these stamps (tools/heal-reference).
describe('heal (darktable heal.c)', () => {
  for (const c of fixture.cases) {
    it(`matches darktable: ${c.name}`, () => {
      const dest = Float32Array.from(c.dest);
      heal(Float32Array.from(c.src), dest, Float32Array.from(c.mask), c.w, c.h, c.maxIter);
      let worst = 0;
      for (let i = 0; i < dest.length; i++) if (i % 4 !== 3) worst = Math.max(worst, Math.abs(dest[i] - c.out[i]));
      // Same sweeps in the same order; float vs double sums only.
      expect(worst).toBeLessThan(1e-5);
    });
  }

  it('leaves unmasked pixels alone and fills a hole smoothly from its edge', () => {
    const w = 9, h = 9;
    const src = new Float32Array(w * h * 4).fill(0.2);
    const dest = new Float32Array(w * h * 4);
    const mask = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // The destination is a ramp with a spike in the middle; the mask covers the spike.
      dest.fill(x / 8, 4 * i, 4 * i + 4);
      if (Math.abs(x - 4) <= 1 && Math.abs(y - 4) <= 1) { mask[i] = 1; dest.fill(5, 4 * i, 4 * i + 3); }
    }
    const before = dest.slice();
    heal(src, dest, mask, w, h);
    for (let i = 0; i < w * h; i++) if (!mask[i]) expect(dest[4 * i]).toBe(before[4 * i]);
    // A harmonic fill of a linear ramp is the ramp.
    expect(dest[4 * (4 * w + 4)]).toBeCloseTo(0.5, 3);
    expect(dest[4 * (4 * w + 3)]).toBeCloseTo(3 / 8, 3);
  });
});

describe('compiled heal loop', () => {
  const cases = fixture.cases.map(c => ({ ...c, src: Float32Array.from(c.src), dest: Float32Array.from(c.dest), mask: Float32Array.from(c.mask) }));
  // Include alpha differences, disconnected masks, edges and odd/even row strides.
  for (const w of [1, 2, 15, 16, 47, 48]) for (const maxIter of [0, 5, 2000]) {
    const h = 13, src = new Float32Array(w * h * 4), dest = src.slice(), mask = new Float32Array(w * h);
    for (let i = 0; i < src.length; i++) { src[i] = Math.sin(i * .71) * .3; dest[i] = Math.cos(i * .31) * .2; }
    for (let i = 0; i < mask.length; i++) mask[i] = i % 7 ? 1 : 0;
    cases.push({ name: `${w}px, ${maxIter} sweeps`, w, h, src, dest, mask, maxIter, out: [] });
  }
  const expected: { pixels: Float32Array; sweeps: number }[] = [];
  beforeAll(async () => {
    for (const c of cases) {
      const pixels = c.dest.slice();
      expected.push({ pixels, sweeps: heal(c.src, pixels, c.mask, c.w, c.h, c.maxIter) });
    }
    expect(await prepareHeal(readFileSync(new URL('./heal.wasm', import.meta.url)))).toBe(true);
  });
  for (const [i, c] of cases.entries()) it(`matches TS pixels and stopping iteration exactly: ${c.name}`, () => {
    const pixels = c.dest.slice();
    expect(heal(c.src, pixels, c.mask, c.w, c.h, c.maxIter)).toBe(expected[i].sweeps);
    expect(pixels).toEqual(expected[i].pixels);
  });
});
