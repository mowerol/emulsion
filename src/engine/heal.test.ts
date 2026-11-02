// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { heal } from './heal';
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
