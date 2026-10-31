// SPDX-License-Identifier: GPL-3.0-or-later
// Developer tuning of Emulsion's own stock looks: changes a stock's numbers in memory so every
// render shows them at once, remembers them across reloads (development builds only), and
// writes the stock's entry for src/film/stocks.ts. Nothing here reaches a public build's looks.

import { useSyncExternalStore } from 'react';
import { STOCK, type Mat3, type Stock, type StockId, type Vec3 } from './stocks';
import { CB_DEFAULTS, type CbParams } from '../engine/colorbalance';

/** The numbers that make a stock's look. */
export type TunedFields = Pick<Stock, 'contrast' | 'crossover' | 'balance' | 'matrix' | 'saturation' | 'fade'> & { bwWeights?: Vec3; grade?: Partial<CbParams> };

const KEY = 'emulsion.stockTuning';
const originals = new Map<StockId, TunedFields>();
const listeners = new Set<() => void>();
let version = 0;

const copy = (s: Stock): TunedFields => ({
  contrast: s.contrast,
  crossover: [...s.crossover] as Vec3,
  balance: [...s.balance] as Vec3,
  matrix: s.matrix.map((r) => [...r]) as Mat3,
  saturation: s.saturation,
  fade: s.fade,
  ...(s.bwWeights ? { bwWeights: [...s.bwWeights] as Vec3 } : {}),
  ...(s.grade ? { grade: { ...s.grade } } : {}),
});

/** The stock's numbers as written in stocks.ts. */
export const fileValues = (id: StockId): TunedFields => originals.get(id) ?? copy(STOCK[id]);

/** Whether a stock's numbers differ from stocks.ts. */
export const isTuned = (id: StockId) => originals.has(id) && JSON.stringify(originals.get(id)) !== JSON.stringify(copy(STOCK[id]));

function save() {
  try {
    const tuned = Object.fromEntries([...originals.keys()].filter(isTuned).map((id) => [id, copy(STOCK[id])]));
    localStorage.setItem(KEY, JSON.stringify(tuned));
  } catch {
    /* storage unavailable: tuning lasts until reload */
  }
}

function changed() {
  version++;
  save();
  listeners.forEach((l) => l());
}

/** Change some of a stock's numbers; every render uses them from now on. */
export function tuneStock(id: StockId, patch: Partial<TunedFields>) {
  if (!originals.has(id)) originals.set(id, copy(STOCK[id]));
  Object.assign(STOCK[id], patch);
  changed();
}

/** Back to the numbers in stocks.ts. */
export function resetStock(id: StockId) {
  const o = originals.get(id);
  if (!o) return;
  Object.assign(STOCK[id], copy({ ...STOCK[id], ...o }));
  if (!o.bwWeights) delete STOCK[id].bwWeights;
  if (!o.grade) delete STOCK[id].grade;
  originals.delete(id);
  changed();
}

/** A matrix row with its diagonal set so the row sums to 1 (greys stay grey). */
export function balancedRow(row: Vec3, diagonal: number): Vec3 {
  const out = [...row] as Vec3;
  out[diagonal] = 1 - row.reduce((a, v, i) => (i === diagonal ? a : a + v), 0);
  return out;
}

const num = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
};
const vec = (v: readonly number[]) => `[${v.map(num).join(', ')}]`;
const isIdentity = (m: Mat3) => m.every((r, i) => r.every((v, j) => Math.abs(v - (i === j ? 1 : 0)) < 5e-4));

/** A grade's settings away from darktable's defaults, as code; null when it does nothing. */
function gradeCode(g: Partial<CbParams> | undefined): string | null {
  const set = Object.entries(g ?? {}).filter(([k, v]) => v !== undefined && Math.abs((v as number) - CB_DEFAULTS[k as keyof CbParams]) >= 5e-4);
  return set.length ? `{ ${set.map(([k, v]) => `${k}: ${num(v as number)}`).join(', ')} }` : null;
}

/** The stock's entry in src/film/stocks.ts, in that file's layout. */
export function stockCode(id: StockId): string {
  const s = STOCK[id];
  const matrix = isIdentity(s.matrix) ? 'I' : `[${s.matrix.map(vec).join(', ')}]`;
  const look = `    contrast: ${num(s.contrast)}, crossover: ${vec(s.crossover)}, balance: ${vec(s.balance)}`;
  return [
    '  {',
    `    id: '${s.id}', iso: ${s.iso}, name: '${s.name}', maker: '${s.maker}', edge: '${s.edge}', bw: ${s.bw},`,
    s.bw || matrix === 'I' ? `${look}, matrix: ${matrix}${s.bwWeights ? `, bwWeights: ${vec(s.bwWeights)}` : ''},` : `${look},\n    matrix: ${matrix},`,
    `    saturation: ${num(s.saturation)}, fade: ${num(s.fade)}, halation: ${s.halation}, halationColor: ${vec(s.halationColor)},`,
    `    grain: ${s.grain},`,
    ...(gradeCode(s.grade) ? [`    grade: ${gradeCode(s.grade)},`] : []),
    '  },',
  ].join('\n');
}

/** Changes whenever a stock is tuned: a dependency for views that render stocks. */
export function useStockTuningVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
}

// Tuning made in an earlier session of the development build comes back.
if (import.meta.env.DEV) {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Partial<TunedFields>>;
    for (const [id, fields] of Object.entries(saved)) if (id in STOCK) tuneStock(id as StockId, fields);
  } catch {
    /* nothing saved */
  }
}
