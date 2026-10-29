// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../film/stocks';
import { CENTERS_PARAMS, bandFactors, bandGains, correction, eigf, luminance, toneEqualize } from './toneequalizer';

const ev = (k: number) => Math.log2(k);
const grey = (v: number): Vec3 => [v, v, v];
/** Correction for a flat area of scene grey level `v` (the map is uniform, so its variance is zero). */
const flat = (v: number, factors: number[]) => toneEqualize(grey(v), luminance(grey(v)), luminance(grey(v)) ** 2, factors)[0] / v;

describe('tone equalizer', () => {
  it('fits the band gains with its eight Gaussians', () => {
    const gains = bandGains(60, -40);
    const factors = bandFactors(gains);
    CENTERS_PARAMS.forEach((c, i) => expect(ev(correction(2 ** c, factors))).toBeCloseTo(gains[i], 1));
  });

  it('stays within 2% (0.025 EV) of no change with both sliders at zero', () => {
    // Eight Gaussians only approximate a flat line (darktable ripples the same way),
    // so the engine skips the stage at zero.
    const factors = bandFactors(bandGains(0, 0));
    for (let e = -10; e <= 2; e += 0.5) expect(Math.abs(correction(2 ** e, factors) - 1)).toBeLessThan(0.02);
  });

  it('lifts shadows and lowers highlights while middle grey barely moves', () => {
    const f = bandFactors(bandGains(100, -100));
    expect(ev(flat(0.01, f))).toBeGreaterThan(0.8);
    expect(ev(flat(1.5, f))).toBeLessThan(-0.8);
    expect(Math.abs(ev(flat(0.18, f)))).toBeLessThan(0.25);
  });

  it('keeps each slider to its own end of the range', () => {
    expect(Math.abs(ev(flat(1.5, bandFactors(bandGains(100, 0)))))).toBeLessThan(0.15);
    expect(Math.abs(ev(flat(0.01, bandFactors(bandGains(0, -100)))))).toBeLessThan(0.15);
  });

  it('clamps the correction to ±2 EV', () => {
    const f = bandFactors([3, 3, 3, 3, 3, 3, 3, 3, 3]);
    expect(correction(0.1, f)).toBeLessThanOrEqual(4);
  });

  it('smooths flat areas towards the local mean and keeps edges', () => {
    // Flat: no variance, so the map takes the local mean.
    expect(eigf(0.2, 0.1, 0)).toBeCloseTo(0.1, 9);
    // Strong edge: large variance, so the pixel keeps most of its own value.
    expect(eigf(0.2, 0.1, 1)).toBeGreaterThan(0.19);
  });

  it('measures brightness with the euclidean norm and the preset exposure boost', () => {
    expect(ev(luminance(grey(0.18)))).toBeCloseTo(Math.log2(0.18 * Math.sqrt(3)) - 1.57, 6);
    expect(luminance([0, 0, 0])).toBeGreaterThan(0);
  });

  it('scales all three channels by the same amount, so colours keep their hue', () => {
    const f = bandFactors(bandGains(80, 0));
    const px: Vec3 = [0.02, 0.01, 0.005];
    const out = toneEqualize(px, luminance(px), luminance(px) ** 2, f);
    expect(out[0] / out[1]).toBeCloseTo(2, 9);
    expect(out[1] / out[2]).toBeCloseTo(2, 9);
  });
});
