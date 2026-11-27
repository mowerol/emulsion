// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filmCorrection, filmExposure, filmPrint, filmTextureData, parseFilm, FilmError } from './film';
import type { Vec3 } from '../film/stocks';
import fixture from './fixtures/film-gold200.json';

const load = (name: string) => { const b = readFileSync(`public/looks/film/${name}.film`); return parseFilm(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

describe('Film stage (darktable spektrafilm, baked)', () => {
  const gold = load('kodak_gold_200');

  it('reads a baked stock', () => {
    expect(gold.meta.film).toBe('kodak_gold_200');
    expect(gold.meta.print).toBe('kodak_portra_endura');
    expect(gold.meta.n).toBe(65);
    expect(gold.a.length).toBe(65 ** 3 * 3);
    expect(() => parseFilm(new ArrayBuffer(16))).toThrow(FilmError);
  });

  it('matches darktable’s engine per pixel within one 8-bit step', () => {
    let worst = 0;
    for (const [x, want] of fixture.cases as [Vec3, Vec3][]) {
      const got = filmPrint(gold, x);
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(got[k] - want[k]) * 255);
    }
    expect(worst).toBeLessThan(1);
  });

  it('renders a grey ramp as a rising, near-neutral print with a paper black', () => {
    const ramp = Array.from({ length: 13 }, (_, i) => filmPrint(gold, [2 ** (i - 10), 2 ** (i - 10), 2 ** (i - 10)] as Vec3));
    for (let i = 1; i < ramp.length; i++) expect(ramp[i][1]).toBeGreaterThan(ramp[i - 1][1]);
    expect(ramp[0][1]).toBeGreaterThan(0.02);
    const grey = filmPrint(gold, [0.18, 0.18, 0.18]);
    expect(Math.max(...grey) - Math.min(...grey)).toBeLessThan(0.06);
  });

  it('inhibits more where a layer is denser', () => {
    const low = filmCorrection(gold, filmExposure(gold, [0.01, 0.01, 0.01]));
    const high = filmCorrection(gold, filmExposure(gold, [0.5, 0.5, 0.5]));
    for (let k = 0; k < 3; k++) expect(high[k]).toBeGreaterThan(low[k]);
  });

  it('packs both lattices and the curves into one texture', () => {
    const t = filmTextureData(gold);
    expect(t.depth).toBe(131);
    expect(t.data.length).toBe(65 * 65 * 131 * 4);
    const n = 65, curves = 65 * 65 * 130;
    expect(t.data[(curves + 255) * 4 + 1]).toBeCloseTo(gold.meta.couplers.curvesBefore[255 * 3 + 1], 5);
    expect(t.data[(curves + 256) * 4]).toBeCloseTo(gold.meta.couplers.curvesNorm[0], 5);
    expect(t.data[(n * n * n) * 4]).toBe(gold.b[0]);
  });
});

import { withLook } from '../film/looks';
import { defaultRecipe } from '../film/recipe';
describe('picking a film stock', () => {
  it('turns on its couplers’ spread and its scatter, as darktable’s defaults', () => {
    const r = withLook(defaultRecipe('neutral'), 'film', 'gold200');
    expect([r.filmEdges, r.filmSoftness]).toEqual([100, 100]);
    expect(withLook(defaultRecipe('neutral'), 't3mujinpack', 'gold200').filmEdges).toBe(0);
  });
});
