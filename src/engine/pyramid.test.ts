// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { GLOW_SIGMA, HALATION_SIGMA, blurPlan, pyramidFor } from './pyramid';

describe('highlight pyramid', () => {
  it('picks small fixed-size levels whatever the frame size', () => {
    for (const [w, h] of [[192, 128], [1200, 800], [2560, 1707], [6000, 4000], [9504, 6336]]) {
      const p = pyramidFor(w, h);
      const [hw] = p.sizes[p.halation];
      const [gw] = p.sizes[p.glow];
      expect(hw).toBeLessThanOrEqual(256);
      expect(gw).toBeLessThanOrEqual(128);
      expect(p.glow).toBeGreaterThan(p.halation);
      expect(p.sizes[0][0]).toBe(Math.round(w / 4));
    }
  });

  it('keeps taps tight enough to avoid a lattice, and reaches the target blur', () => {
    for (const lw of [24, 96, 160, 256]) {
      for (const frac of [HALATION_SIGMA, GLOW_SIGMA]) {
        const { iterations, spread } = blurPlan(lw, frac);
        expect(spread).toBeLessThanOrEqual(1.0001);
        expect(1.41 * spread * Math.sqrt(iterations)).toBeCloseTo(frac * lw, 6);
      }
    }
  });
});
