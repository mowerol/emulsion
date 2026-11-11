// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { downsampleTaps, lanczosTap, resample, resampledSize, RESAMPLE_MAX_TAPS, RESAMPLE_MIN_SCALE } from './resample';

// Reference taps printed by darktable's own plan code (interpolation.c at 20891f6c, compiled
// with sinf for dt_vector_sin, its four-tap stepping kept): input index:normalised weight per tap.
const DT: [number, number, number, string][] = [
  [1664, 1552, 0, '0:0.0045566 0:-0.0313806 0:0.0573389 0:0.9435267 1:0.0573389 2:-0.0313806'],
  [1664, 1552, 776, '829:0.0045557 830:-0.0313756 831:0.0573216 832:0.9435275 833:0.0573563 834:-0.0313856'],
  [1664, 1552, 1551, '1660:0.0079819 1661:-0.0498673 1662:0.1232921 1663:0.9330035 1663:0.0000512 1663:-0.0144614'],
  [2560, 1950, 1, '0:0.0174746 0:-0.0492154 0:0.0000000 1:0.6901069 2:0.4421978 3:-0.1074258 4:0.0068620'],
  [1536, 1000, 999, '1530:0.0006692 1531:0.0197367 1532:-0.0726604 1533:0.0269649 1534:0.5504408 1535:0.5185222 1535:-0.0000001 1535:-0.0640103 1535:0.0203372'],
  [10, 7, 3, '0:0.0000000 1:0.0221007 2:-0.0797945 3:0.0666572 4:0.6598270 5:0.4319391 6:-0.0838407 7:-0.0168888'],
];

describe('darktable Lanczos3 downscaling', () => {
  it.each(DT)('matches darktable’s taps for %i → %i at x = %i', (inN, outN, x, expected) => {
    const taps = downsampleTaps(inN, outN / inN, x);
    const want = expected.split(' ').map((s) => s.split(':').map(Number));
    expect(taps.index).toEqual(want.map(([i]) => i));
    taps.weight.forEach((k, i) => expect(k).toBeCloseTo(want[i][1], 5));
  });

  it('is the Lanczos window: 1 at 0, 0 at the integers, sinc · sinc between', () => {
    expect(lanczosTap(0)).toBeCloseTo(1, 6);
    for (const n of [1, 2, -1, -2]) expect(lanczosTap(n)).toBeCloseTo(0, 6);
    const sinc = (x: number) => Math.sin(Math.PI * x) / (Math.PI * x);
    for (const t of [0.3, -0.7, 1.4, -2.6]) expect(lanczosTap(t)).toBeCloseTo(sinc(t) * sinc(t / 3), 6);
  });

  it('keeps a flat image flat and weights sum to 1', () => {
    const w = 37, h = 23, src = new Float32Array(w * h * 4).fill(0.4);
    const out = resample(src, w, h, 0.61);
    expect([out.w, out.h]).toEqual(resampledSize(w, h, 0.61));
    for (const v of out.data) expect(v).toBeCloseTo(0.4, 5);
    for (let x = 0; x < 22; x++) expect(downsampleTaps(w, 0.61, x).weight.reduce((a, b) => a + b)).toBeCloseTo(1, 6);
  });

  it('keeps detail a bilinear shrink averages away', () => {
    // One-pixel stripes at 0.9×: Lanczos keeps far more of their contrast than averaging pairs.
    const w = 200, h = 4, src = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) src.fill(x % 4 < 2 ? 1 : 0, (y * w + x) * 4, (y * w + x) * 4 + 4);
    const out = resample(src, w, h, 0.9);
    let lo = 1, hi = 0;
    for (let x = 20; x < 160; x++) { const v = out.data[(out.w + x) * 4]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    expect(hi - lo).toBeGreaterThan(0.9);
  });

  it('fits the GPU loop bound down to the smallest scale it accepts', () => {
    for (let x = 0; x < 50; x++) expect(downsampleTaps(1000, RESAMPLE_MIN_SCALE, x).index.length).toBeLessThanOrEqual(RESAMPLE_MAX_TAPS);
  });
});
