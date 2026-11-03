// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { LOG_EPS, LOG_SLOPE, LOG_Y50, logLightness, logShift } from './detaillog';
import { amountScales, equalizeParts } from './equalizer';

const lstar = (Y: number) => (Y > 216 / 24389 ? 116 * Math.cbrt(Y) - 16 : (24389 / 27) * Y);

describe('log lightness', () => {
  it('is L* at mid grey, with L* slope per stop there', () => {
    expect(logLightness(LOG_Y50 - LOG_EPS)).toBeCloseTo(50, 10);
    const h = 1e-4;
    const dLdStop = (lstar(LOG_Y50 * 2 ** h) - lstar(LOG_Y50 * 2 ** -h)) / (2 * h);
    expect(LOG_SLOPE).toBeCloseTo(dLdStop, 4);
  });
  it('moves by the same amount everywhere when the exposure changes', () => {
    for (const Y of [0.01, 0.18, 0.9, 4]) for (const ev of [-2, 1, 3]) {
      const k = 2 ** ev;
      // Exact for Y + ε; ε is scaled with the light here to show the shift is the stops alone.
      expect(Math.log2((k * (Y + LOG_EPS)) / LOG_Y50) * LOG_SLOPE + 50 - logLightness(Y)).toBeCloseTo(LOG_SLOPE * ev, 9);
    }
  });
  it('applies a change as a ratio, undone by the opposite change', () => {
    for (const Y of [0, 0.002, 0.18, 0.7, 3]) {
      const dL = logShift(Y, 4);
      const back = logShift(Math.max(0, ((Y + LOG_EPS) * 2 ** (4 / LOG_SLOPE)) - LOG_EPS), -4);
      expect(dL + back).toBeCloseTo(0, 9);
      // Small changes: du times the pixel's own L* per stop, relative to the slope at mid grey.
      const small = logShift(Y, 0.01) / 0.01;
      const stop = (lstar((Y + LOG_EPS) * 2 ** 1e-4 - LOG_EPS) - lstar((Y + LOG_EPS) * 2 ** -1e-4 - LOG_EPS)) / 2e-4;
      expect(small).toBeCloseTo(stop / LOG_SLOPE, 3);
    }
    expect(logShift(0.18, 0)).toBe(0);
  });
  it('gives the contrast equalizer the same detail at every exposure, and about L*-detail in L*', () => {
    const w = 96, h = 64;
    // A soft gradient with fine texture of a few per cent, as skin or fabric.
    const Y = Float64Array.from({ length: w * h }, (_, k) => { const i = k % w, j = Math.floor(k / w); return (0.05 + 0.4 * i / w) * (1 + 0.03 * Math.sin(i * 1.3) * Math.cos(j * 0.9)); });
    const sc = amountScales(w, h, w, h);
    const detail = (k: number) => {
      const u = Float64Array.from(Y, (y) => logLightness(k * y));
      return equalizeParts(u, w, h, sc).A;
    };
    // The same exposure-free detail at -1, 0 and +2 EV (ε aside: the floor is far below these).
    const d0 = detail(1);
    for (const k of [0.5, 4]) {
      const dk = detail(k);
      let worst = 0;
      for (let p = 0; p < d0.length; p++) worst = Math.max(worst, Math.abs(dk[p] - d0[p]));
      expect(worst).toBeLessThan(0.02);
    }
    // Applied as a ratio after a +1 EV exposure, it lands close to darktable's detail on L* there.
    const k = 2;
    const Lk = Float64Array.from(Y, (y) => lstar(k * y));
    const dt = equalizeParts(Lk, w, h, sc).A;
    let worst = 0, size = 0;
    for (let p = 0; p < d0.length; p++) {
      const ours = logShift(k * Y[p], d0[p]);
      worst = Math.max(worst, Math.abs(ours - dt[p]));
      size = Math.max(size, Math.abs(dt[p]));
    }
    expect(size).toBeGreaterThan(0.5);
    expect(worst).toBeLessThan(0.15 * size);
  });
});
