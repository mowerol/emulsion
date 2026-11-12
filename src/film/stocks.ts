// SPDX-License-Identifier: GPL-3.0-or-later
// Film stocks: what the look packs render, and what Emulsion knows about each film besides its
// look. A stock's colour and tone come entirely from its pack's LUT (see looks.ts).
//
//   iso             film speed, which sets the grain's size
//   halation        default halation slider value (0: off until turned up), and its colour
//   grain           default grain amount (0: off until turned up); Size defaults to the ISO
//   bw              black and white film (labels only; the LUT does the conversion)


export type StockId =
  | 'neutral'
  | 'emulsion-standard'
  | 'portra400'
  | 'portra160'
  | 'gold200'
  | 'ektar100'
  | 'superia400'
  | 'pro400h'
  | 'cinestill800t'
  | 'trix400'
  | 'hp5'
  | `lut:${string}`;

import catalogue from './lut-catalogue.json';
import { LOCAL_LOOKS } from './local-looks';

export type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];
export type Vec3 = [number, number, number];

export interface Stock {
  id: StockId;
  name: string;
  maker: string;
  /** Text printed along the film edge in the filmstrip. */
  edge: string;
  bw: boolean;
  halation: number;
  halationColor: Vec3;
  /** Film speed, which sets the grain. */
  iso: number;
  grain: number;
  /** Grain Size default: the stock's film speed, in darktable's ISO units. */
  grainIso: number;
}

const RAW_STOCKS: Omit<Stock, 'grainIso'>[] = [
  {
    // No film: the camera profile's rendering and nothing else. Retained for older edits.
    id: 'neutral', iso: 200, name: 'Neutral', maker: 'No film look', edge: 'EMULSION', bw: false,
    halation: 0, halationColor: [1, 0.36, 0.14], grain: 0,
  },
  {
    id: 'portra400', iso: 400, name: 'Portra 400', maker: 'Kodak', edge: 'PORTRA 400', bw: false,
    halation: 0, halationColor: [1, 0.36, 0.14], grain: 0,
  },
  {
    id: 'portra160', iso: 160, name: 'Portra 160', maker: 'Kodak', edge: 'PORTRA 160', bw: false,
    halation: 0, halationColor: [1, 0.36, 0.14], grain: 0,
  },
  {
    id: 'gold200', iso: 200, name: 'Gold 200', maker: 'Kodak', edge: 'GOLD 200', bw: false,
    halation: 0, halationColor: [1, 0.32, 0.12], grain: 0,
  },
  {
    id: 'ektar100', iso: 100, name: 'Ektar 100', maker: 'Kodak', edge: 'EKTAR 100', bw: false,
    halation: 0, halationColor: [1, 0.32, 0.12], grain: 0,
  },
  {
    id: 'superia400', iso: 400, name: 'Superia 400', maker: 'Fujifilm', edge: 'SUPERIA 400', bw: false,
    halation: 0, halationColor: [1, 0.34, 0.14], grain: 0,
  },
  {
    id: 'pro400h', iso: 400, name: 'Pro 400H', maker: 'Fujifilm', edge: 'PRO 400H', bw: false,
    halation: 0, halationColor: [1, 0.36, 0.16], grain: 0,
  },
  {
    id: 'cinestill800t', iso: 800, name: 'CineStill 800T', maker: 'CineStill', edge: '800T', bw: false,
    halation: 0, halationColor: [1, 0.16, 0.05], grain: 0,
  },
  {
    id: 'trix400', iso: 400, name: 'Tri-X 400', maker: 'Kodak', edge: 'TRI-X 400', bw: true,
    halation: 0, halationColor: [1, 1, 1], grain: 0,
  },
  {
    id: 'hp5', iso: 400, name: 'HP5 Plus', maker: 'Ilford', edge: 'HP5 PLUS', bw: true,
    halation: 0, halationColor: [1, 1, 1], grain: 0,
  },
];

/** Films with their own ids, shared across the packs that supply them (t3mujinpack's, for one). */
const FILM_STOCKS: Stock[] = RAW_STOCKS.map((s) => ({ ...s, grainIso: s.iso }));
const LUT_STOCKS: Stock[] = [...catalogue, ...LOCAL_LOOKS].filter(s => s.id.startsWith('lut:')).map(s => ({
  id: s.id as StockId, name: s.name, maker: s.category, edge: s.name.toUpperCase(),
  // The LUT itself performs any monochrome conversion.
  bw: false, halation: 0, halationColor: [1, 0.36, 0.14],
  iso: s.iso, grainIso: s.iso, grain: 0,
}));
export const STOCKS: Stock[] = [...FILM_STOCKS, ...LUT_STOCKS];

export const STOCK: Record<StockId, Stock> = Object.fromEntries(STOCKS.map((s) => [s.id, s])) as Record<StockId, Stock>;

export const isStockId = (v: unknown): v is StockId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(STOCK, v);

/** Add a stock while the app runs (an imported look), replacing one with the same id. */
export function registerStock(stock: Stock) {
  const i = STOCKS.findIndex((s) => s.id === stock.id);
  if (i >= 0) STOCKS[i] = stock;
  else STOCKS.push(stock);
  STOCK[stock.id] = stock;
}
