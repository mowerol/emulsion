// SPDX-License-Identifier: GPL-3.0-or-later
// Developer tuning of Emulsion's own stock looks: changes a stock's numbers in memory so every
// render shows them at once, remembers them across reloads (development builds only), and
// writes the stock's entry for src/film/stocks.ts. Nothing here reaches a public build's looks.

import { useSyncExternalStore } from 'react';
import { STOCK, type Stock, type StockId, type Vec3 } from './stocks';
import { CB_DEFAULTS, type CbParams } from '../engine/colorbalance';
import type { SigmoidPrimaries } from '../engine/primaries';

/** The numbers that make a stock's look. */
export type TunedFields = Pick<Stock, 'contrast'> & { primaries?: SigmoidPrimaries; bwWeights?: Vec3; grade?: Partial<CbParams> };

const KEY = 'emulsion.stockTuning';
const originals = new Map<StockId, TunedFields>();
const listeners = new Set<() => void>();
let version = 0;

const copy = (s: Stock): TunedFields => ({
  contrast: s.contrast,
  ...(s.primaries ? { primaries: { inset: [...s.primaries.inset] as Vec3, rotation: [...s.primaries.rotation] as Vec3, purity: s.primaries.purity } } : {}),
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
  if (!o.primaries) delete STOCK[id].primaries;
  if (!o.bwWeights) delete STOCK[id].bwWeights;
  if (!o.grade) delete STOCK[id].grade;
  originals.delete(id);
  changed();
}

const num = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
};
const vec = (v: readonly number[]) => `[${v.map(num).join(', ')}]`;

/** Sigmoid primaries as code; null when they do nothing. */
function primariesCode(p: SigmoidPrimaries | undefined): string | null {
  if (!p || [...p.inset, ...p.rotation].every((v) => Math.abs(v) < 5e-4)) return null;
  return `{ inset: ${vec(p.inset)}, rotation: [${p.rotation.map(deg).join(', ')}], purity: ${num(p.purity)} }`;
}

/** Angles in degrees, to a tenth. */
const deg = (v: number) => num(Math.round(v * 10) / 10);

/** A grade's settings away from darktable's defaults, as code (a wheel's hue only when it has chroma); null when it does nothing. */
function gradeCode(g: Partial<CbParams> | undefined): string | null {
  const away = (k: string, v: number | undefined) => v !== undefined && Math.abs(v - CB_DEFAULTS[k as keyof CbParams]) >= 5e-4;
  const set = Object.entries(g ?? {}).filter(([k, v]) => away(k, v) && (!k.endsWith('_H') || away(k.replace(/_H$/, '_C'), g?.[k.replace(/_H$/, '_C') as keyof CbParams])));
  return set.length ? `{ ${set.map(([k, v]) => `${k}: ${k.endsWith('_H') ? deg(v as number) : num(v as number)}`).join(', ')} }` : null;
}

/** The stock's entry in src/film/stocks.ts, in that file's layout. */
export function stockCode(id: StockId): string {
  const s = STOCK[id];
  const primaries = primariesCode(s.primaries);
  const grade = gradeCode(s.grade);
  return [
    '  {',
    `    id: '${s.id}', iso: ${s.iso}, name: '${s.name}', maker: '${s.maker}', edge: '${s.edge}', bw: ${s.bw},`,
    `    contrast: ${num(s.contrast)}${s.bwWeights ? `, bwWeights: ${vec(s.bwWeights)}` : ''}, halation: ${s.halation}, halationColor: ${vec(s.halationColor)}, grain: ${s.grain},`,
    ...(primaries ? [`    primaries: ${primaries},`] : []),
    ...(grade ? [`    grade: ${grade},`] : []),
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
