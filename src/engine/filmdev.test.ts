// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filmPrint, parseFilm } from './film';
import { couplerSpread, filmEdgesGain } from './filmdev';
import { srgbOetf } from './color';
import type { Vec3 } from '../film/stocks';

const f32 = (name: string) => { const b = readFileSync(`src/engine/fixtures/${name}`); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const load = (name: string) => { const b = readFileSync(`public/looks/film/${name}.film`); return parseFilm(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const W = 64, H = 40;

describe('Film edges (darktable spektrafilm couplers, spatial part)', () => {
  const gold = load('kodak_gold_200');
  const input = f32('film-edges.in.f32');
  const enc = (v: number) => 255 * srgbOetf(Math.max(0, v));

  it('spreads the inhibitor as darktable: 20 µm, plus a 3 % tail of 200 µm', () => {
    const bank = couplerSpread(gold, 6);
    expect(bank[0].sigma).toBeCloseTo(20 / 6, 5);
    expect(bank.reduce((a, b) => a + b.weight, 0)).toBeCloseTo(0.97 + 0.03 * 0.9999, 5);
  });

  // Measured: the effect is up to 7.8 steps at the edges (Gold 200); this approach leaves 1.3 at
  // most, 0.16 on average. Provia 100F is a reversal film, with darktable's receiver term.
  for (const [name, limit] of [['kodak_gold_200', 1.6], ['fujifilm_provia_100f', 1.6]] as const) {
    it(`on ${name}, lands on darktable’s spatial render through the stock’s own per-pixel couplers`, () => {
      const film = load(name), perPixel = f32(`film-edges.${name}.perpixel.f32`), spread = f32(`film-edges.${name}.spread.f32`);
      const gain = filmEdgesGain(input, W, H, 50, film, 1, true);
      let effect = 0, error = 0, sum = 0;
      for (let i = 0; i < W * H; i++) {
        const x = [0, 1, 2].map(k => input[3 * i + k] * gain[3 * i + k]) as Vec3;
        const got = filmPrint(film, x);
        for (let k = 0; k < 3; k++) {
          const want = enc(spread[3 * i + k]);
          effect = Math.max(effect, Math.abs(want - enc(perPixel[3 * i + k])));
          const e = Math.abs(255 * got[k] - want);
          error = Math.max(error, e); sum += e;
        }
      }
      expect(effect).toBeGreaterThan(3);
      expect(error).toBeLessThan(limit);
      expect(sum / (W * H * 3)).toBeLessThan(0.3);
    });
  }

  it('does nothing at amount 0 or on a flat field', () => {
    expect([...filmEdgesGain(input, W, H, 50, gold, 0, false)].every(v => v === 1)).toBe(true);
    const flat = new Float32Array(16 * 16 * 3).fill(0.18);
    for (const v of filmEdgesGain(flat, 16, 16, 50, gold, 1, false)) expect(v).toBeCloseTo(1, 3);
  });
});

import { SLIDER } from '../film/recipe';
describe('Film edges and Film softness sliders', () => {
  it('run to 200 with the film’s own amount, 100, marked', () => {
    for (const key of ['filmEdges', 'filmSoftness'] as const) expect([SLIDER[key].max, SLIDER[key].mark]).toEqual([200, 100]);
  });
});
