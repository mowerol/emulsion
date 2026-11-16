// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { autoContrast } from './capture';
import { compiledAutoContrast, prepareContrast } from './capturekernel';

describe('compiled capture contrast', () => {
  it('matches the reference through both searches, fine refinement and padded readbacks', async () => {
    expect(await prepareContrast(readFileSync(new URL('./capture.wasm', import.meta.url)))).toBe(true);
    const thresholds = new Set<number>();
    for (const [w, h] of [[39, 31], [40, 40], [79, 81], [160, 160], [243, 171]]) {
      for (const amplitude of [0, 220, 268, 650, 1800]) {
        for (const mean of [500, 2000, 8000, 20000, 30000]) {
          let seed = 7;
          const data = Float64Array.from({ length: w * h }, () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return Math.fround(mean + (seed / 2 ** 32 - .5) * amplitude);
          });
          const expected = autoContrast({ w, h, data });
          thresholds.add(expected);
          const stride = Math.ceil(w / 4) * 4;
          const actual = compiledAutoContrast(w, h, stride, pixels => {
            pixels.fill(NaN); // Padding must not enter either tile search.
            for (let y = 0; y < h; y++) pixels.set(data.subarray(y * w, (y + 1) * w), y * stride);
          });
          expect(actual, `${w}x${h}, mean ${mean}, amplitude ${amplitude}`).toBe(expected);
        }
      }
    }
    expect(thresholds.size).toBeGreaterThan(5);
  });

  it('preserves near ties, repeated tiles and eligibility boundaries', async () => {
    await prepareContrast(readFileSync(new URL('./capture.wasm', import.meta.url)));
    const w = 241, h = 169, stride = 244;
    for (const mean of [1999.9999, 2000, 2000.0001, 19999.999, 20000, 20000.001, 8000]) {
      for (const variance of [.49999999, .5, .50000001, .99999999, 1, 1.00000001, 7.99999999, 8, 8.00000001]) {
        const amplitude = Math.sqrt(variance * mean);
        const data = Float64Array.from({ length: w * h }, (_, i) => Math.fround(mean + ((i % w + Math.floor(i / w)) % 2 ? amplitude : -amplitude)));
        const actual = compiledAutoContrast(w, h, stride, pixels => {
          pixels.fill(1e30);
          for (let y = 0; y < h; y++) pixels.set(data.subarray(y * w, (y + 1) * w), y * stride);
        });
        expect(actual, `mean ${mean}, variance ${variance}`).toBe(autoContrast({ w, h, data }));
      }
    }
  });

  it('does not retain previous image pixels and rejects invalid dimensions before reading', async () => {
    await prepareContrast(readFileSync(new URL('./capture.wasm', import.meta.url)));
    const read = () => { throw Error('must not read'); };
    expect(compiledAutoContrast(0, 10, 4, read)).toBeNull();
    expect(compiledAutoContrast(10, 10, 8, read)).toBeNull();
    expect(compiledAutoContrast(10, Infinity, 12, read)).toBeNull();
    expect(compiledAutoContrast(100000, 100000, 100000, read)).toBeNull();
    expect(compiledAutoContrast(80, 80, 80, p => p.fill(500))).toBe(0);
    expect(compiledAutoContrast(80, 80, 80, p => p.fill(30000))).toBe(0);
  });
});
