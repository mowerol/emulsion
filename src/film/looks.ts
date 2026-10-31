// SPDX-License-Identifier: GPL-3.0-or-later
// Look packs: sets of LUTs that render the stocks. New looks use t3mujinpack.
// Emulsion remains readable for legacy edits; its stocks use the style in stocks.ts.
// A missing LUT retains that style for backwards compatibility.

import type { Push } from './recipe';
import type { StockId } from './stocks';

export type PackId = 'emulsion' | 't3mujinpack';

/** A stock's LUT in a pack: a file under public/looks/<pack>/, one per push step if it has them. */
export interface PackLook {
  file: string;
  push?: Partial<Record<Push, string>>;
}

export interface LookPack {
  id: PackId;
  name: string;
  hint: string;
  looks: Partial<Record<StockId, PackLook>>;
}

const T3M: Partial<Record<StockId, string>> = {
  portra400: 'Color Negative - Kodak Portra 400',
  portra160: 'Color Negative - Kodak Portra 160',
  gold200: 'Color Negative - Kodak Gold 200',
  ektar100: 'Color Negative - Kodak Ektar 100',
  superia400: 'Color Negative - Fuji Superia 400',
  pro400h: 'Color Negative - Fuji Pro 400H',
  trix400: 'Black and White - Kodak Tri-X 400',
  hp5: 'Black and White - Ilford HP5 Plus 400',
};

export const PACKS: LookPack[] = [
  { id: 'emulsion', name: 'Emulsion (legacy)', hint: "Emulsion's own film looks.", looks: {} },
  {
    id: 't3mujinpack',
    name: 't3mujinpack',
    hint: 'Film looks made by eye in darktable by João Almeida, applied as LUTs.',
    looks: Object.fromEntries(Object.entries(T3M).map(([s, name]) => [s, { file: `t3mujinpack - ${name}.png` }])),
  },
];

export const PACK: Record<PackId, LookPack> = Object.fromEntries(PACKS.map((p) => [p.id, p])) as Record<PackId, LookPack>;
export const DEFAULT_PACK: PackId = 't3mujinpack';
export const isPackId = (v: unknown): v is PackId => typeof v === 'string' && v in PACK;

/** The LUT file (relative to public/looks/) a stock uses in a pack, or null for Emulsion's own rendering. */
export function lookFile(pack: PackId, stock: StockId, push: Push): string | null {
  const l = PACK[pack].looks[stock];
  if (!l) return null;
  return `${pack}/${l.push?.[push] ?? l.file}`;
}
