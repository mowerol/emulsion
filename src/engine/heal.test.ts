// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { darktableHeal, heal, healLevels } from './heal';
import { prepareHeal } from './healkernel';
import fixture from './fixtures/heal-reference.json';

// The fixture is darktable's own heal.c run on these stamps (tools/heal-reference).
describe('darktableHeal (darktable heal.c)', () => {
  for (const c of fixture.cases) {
    it(`matches darktable: ${c.name}`, () => {
      const dest = Float32Array.from(c.dest);
      darktableHeal(Float32Array.from(c.src), dest, Float32Array.from(c.mask), c.w, c.h, c.maxIter);
      let worst = 0;
      for (let i = 0; i < dest.length; i++) if (i % 4 !== 3) worst = Math.max(worst, Math.abs(dest[i] - c.out[i]));
      // Same sweeps in the same order; float vs double sums only.
      expect(worst).toBeLessThan(1e-5);
    });
  }
});

/** A textured source, a destination with another gradient and a blemish, and a mask. */
function stamp(w: number, h: number, inside: (x: number, y: number) => number) {
  const src = new Float32Array(4 * w * h), dest = new Float32Array(4 * w * h), mask = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, t = 0.3 + 0.2 * Math.sin(x * 0.7) * Math.cos(y * 0.5);
    const blemish = Math.hypot(x - w / 2, y - h / 2) < Math.min(w, h) / 5 ? 0.4 : 0;
    const g = 0.5 + 0.3 * (x / w) - 0.2 * (y / h);
    src.set([t, t * 0.8, t * 0.6, 1], 4 * i);
    dest.set([g + blemish, g * 0.9, g * 0.7 - blemish / 2, 1 - 0.1 * (x / w)], 4 * i);
    mask[i] = inside(x, y);
  }
  return { w, h, src, dest, mask };
}

/**
 * The worst residual of darktable's equation at a masked pixel, written out independently:
 * n·u − Σ u over the neighbours inside the rectangle, u = out − src, plus a zero neighbour past
 * the right edge of an odd width (darktable's red/black padding).
 */
function residual(c: { w: number; h: number; src: Float32Array; mask: Float32Array }, out: Float32Array): number {
  const { w, h, src, mask } = c;
  let worst = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) {
    if (!mask[y * w + x]) continue;
    const u = (X: number, Y: number) => out[4 * (Y * w + X) + k] - src[4 * (Y * w + X) + k];
    let n = 0, sum = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const X = x + dx, Y = y + dy;
      if (X === w && w & 1) { n++; continue; }
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      n++; sum += u(X, Y);
    }
    worst = Math.max(worst, Math.abs(n * u(x, y) - sum));
  }
  return worst;
}

// The shapes coarsening finds hardest: thin, curved, concave, touching the rectangle's edge.
const disc = (w: number, h: number, r: number) => (x: number, y: number) => { const d = Math.hypot(x - w / 2, y - h / 2) / r; return d < 1 ? (1 - d * d) ** 2 : 0; };
const shapes = [
  { name: 'odd disc', ...stamp(23, 19, disc(23, 19, 8)) },
  { name: 'large disc', ...stamp(120, 96, disc(120, 96, 44)) },
  { name: 'one pixel wide curve', ...stamp(90, 60, (x, y) => (Math.round(30 + 20 * Math.sin(x / 9)) === y && x > 2 && x < 87 ? 1 : 0)) },
  { name: 'thin curved stroke', ...stamp(140, 80, (x, y) => (Math.abs(y - 40 - 25 * Math.sin(x / 20)) < 2.5 && x > 4 && x < 135 ? 1 : 0)) },
  { name: 'concave ring', ...stamp(80, 80, (x, y) => { const d = Math.hypot(x - 40, y - 40); return d > 18 && d < 34 && !(x > 40 && Math.abs(y - 40) < 5) ? 1 : 0; }) },
  { name: 'touching the edges', ...stamp(47, 33, (x, y) => (x < 30 || y > 20 ? 1 : 0)) },
  { name: 'scattered pixels', ...stamp(31, 29, (x, y) => ((x * 7 + y * 13) % 5 === 0 ? 1 : 0)) },
];

describe('heal (darktable heal.c, solved to convergence)', () => {
  for (const c of fixture.cases.filter(c => c.maxIter === 2000)) {
    it(`matches darktable's own result where its SOR converges: ${c.name}`, () => {
      const dest = Float32Array.from(c.dest);
      heal(Float32Array.from(c.src), dest, Float32Array.from(c.mask), c.w, c.h);
      let worst = 0;
      for (let i = 0; i < dest.length; i++) if (i % 4 !== 3) worst = Math.max(worst, Math.abs(dest[i] - c.out[i]));
      // darktable stops once a sweep's changes have a sum of squares under (0.1/255)², which
      // leaves its result about that far from converged.
      expect(worst).toBeLessThan(1e-3);
    });
  }

  for (const c of shapes) it(`solves darktable's equation: ${c.name}`, () => {
    const ours = c.dest.slice(), theirs = c.dest.slice();
    const steps = heal(c.src, ours, c.mask, c.w, c.h, 1e-7);
    expect(steps).toBeLessThan(20);
    expect(residual(c, ours)).toBeLessThan(2e-6);
    // darktable's SOR with no cap, so it runs to its own stop, which can leave it ~1e-3 short.
    darktableHeal(c.src, theirs, c.mask, c.w, c.h, 1e6);
    let worst = 0;
    for (let i = 0; i < ours.length; i++) worst = Math.max(worst, Math.abs(ours[i] - theirs[i]));
    expect(worst).toBeLessThan(1e-3);
    expect(residual(c, ours)).toBeLessThanOrEqual(residual(c, theirs));
    for (let i = 0; i < c.w * c.h; i++) if (!c.mask[i]) expect(ours.subarray(4 * i, 4 * i + 4)).toEqual(c.dest.subarray(4 * i, 4 * i + 4));
  });

  it('takes about as many steps for a large spot as for a small one', () => {
    const small = stamp(64, 64, disc(64, 64, 28)), large = stamp(512, 512, disc(512, 512, 240));
    const a = heal(small.src, small.dest.slice(), small.mask, 64, 64);
    const b = heal(large.src, large.dest.slice(), large.mask, 512, 512);
    expect(b).toBeLessThanOrEqual(a + 2);
    expect(b).toBeLessThan(12);
  });

  it('fills a hole smoothly from its edge', () => {
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
    heal(src, dest, mask, w, h);
    // A harmonic fill of a linear ramp is the ramp.
    expect(dest[4 * (4 * w + 4)]).toBeCloseTo(0.5, 5);
    expect(dest[4 * (4 * w + 3)]).toBeCloseTo(3 / 8, 5);
  });

  it('leaves the photo alone with nothing masked, and settles to the mean difference with everything masked', () => {
    const c = stamp(12, 10, () => 0);
    const out = c.dest.slice();
    expect(heal(c.src, out, c.mask, 12, 10)).toBe(0);
    expect(out).toEqual(c.dest);
    const all = stamp(12, 10, () => 1);
    const full = all.dest.slice();
    heal(all.src, full, all.mask, 12, 10);
    let mean = 0;
    for (let i = 0; i < 120; i++) mean += all.dest[4 * i] - all.src[4 * i];
    mean /= 120;
    for (let i = 0; i < 120; i++) expect(full[4 * i] - all.src[4 * i]).toBeCloseTo(mean, 5);
  });

  it('keeps every coarse level inside the mask, and stops coarsening when a level would be empty', () => {
    const c = shapes.find(s => s.name === 'one pixel wide curve')!;
    expect(healLevels(c.mask, c.w, c.h)).toHaveLength(1);
    const d = shapes.find(s => s.name === 'large disc')!;
    const levels = healLevels(d.mask, d.w, d.h);
    expect(levels.length).toBeGreaterThan(3);
    for (let l = 1; l < levels.length; l++) {
      const C = levels[l], F = levels[l - 1], cs = C.w + 2, fs = F.w + 2;
      for (let J = 0; J < C.h; J++) for (let I = 0; I < C.w; I++) if (C.unknown[(J + 1) * cs + I + 1])
        for (let y = 2 * J; y < Math.min(F.h, 2 * J + 2); y++) for (let x = 2 * I; x < Math.min(F.w, 2 * I + 2); x++) expect(F.unknown[(y + 1) * fs + x + 1]).toBe(1);
    }
  });
});

describe('compiled heal solver', () => {
  const cases = [...shapes.map(s => ({ ...s, tolerance: 1e-5 }))];
  // Odd and even widths, one-cell-wide rectangles, a loose and a tight stop.
  for (const w of [1, 2, 15, 16, 47, 48]) for (const tolerance of [1e-3, 1e-6]) {
    const h = 13, src = new Float32Array(w * h * 4), dest = src.slice(), mask = new Float32Array(w * h);
    for (let i = 0; i < src.length; i++) { src[i] = Math.sin(i * .71) * .3; dest[i] = Math.cos(i * .31) * .2; }
    for (let i = 0; i < mask.length; i++) mask[i] = i % 7 ? 1 : 0;
    cases.push({ name: `${w}px, stop ${tolerance}`, w, h, src, dest, mask, tolerance });
  }
  const expected: { pixels: Float32Array; steps: number }[] = [];
  beforeAll(async () => {
    for (const c of cases) {
      const pixels = c.dest.slice();
      expected.push({ pixels, steps: heal(c.src, pixels, c.mask, c.w, c.h, c.tolerance) });
    }
    expect(await prepareHeal(readFileSync(new URL('./heal.wasm', import.meta.url)))).toBe(true);
  });
  for (const [i, c] of cases.entries()) it(`matches TS pixels and steps exactly: ${c.name}`, () => {
    const pixels = c.dest.slice();
    expect(heal(c.src, pixels, c.mask, c.w, c.h, c.tolerance)).toBe(expected[i].steps);
    expect(pixels).toEqual(expected[i].pixels);
  });
});
