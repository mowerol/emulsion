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
  // Films only the Spectral Film collection renders (darktable's spektrafilm pack, film/looks.ts).
  | 'portra800'
  | 'portra800push1'
  | 'portra800push2'
  | 'ultramax400'
  | 'c200'
  | 'vision50d'
  | 'vision200t'
  | 'vision250d'
  | 'vision500t'
  | 'verita200d'
  | 'ektachrome100'
  | 'kodachrome64'
  | 'provia100f'
  | 'velvia100'
  | 'doublex'
  | 'trix7266'
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
  {
    id: 'portra800', iso: 800, name: 'Portra 800', maker: 'Kodak', edge: 'PORTRA 800', bw: false,
    halation: 0, halationColor: [1, 0.32, 0.12], grain: 0,
  },
  {
    id: 'portra800push1', iso: 1600, name: 'Portra 800 (Push 1)', maker: 'Kodak', edge: 'PORTRA 800', bw: false,
    halation: 0, halationColor: [1, 0.32, 0.12], grain: 0,
  },
  {
    id: 'portra800push2', iso: 3200, name: 'Portra 800 (Push 2)', maker: 'Kodak', edge: 'PORTRA 800', bw: false,
    halation: 0, halationColor: [1, 0.32, 0.12], grain: 0,
  },
  {
    id: 'ultramax400', iso: 400, name: 'UltraMax 400', maker: 'Kodak', edge: 'ULTRAMAX 400', bw: false,
    halation: 0, halationColor: [1, 0.32, 0.12], grain: 0,
  },
  {
    id: 'c200', iso: 200, name: 'Fujicolor C200', maker: 'Fujifilm', edge: 'C200', bw: false,
    halation: 0, halationColor: [1, 0.34, 0.14], grain: 0,
  },
  {
    id: 'vision50d', iso: 50, name: 'Vision3 50D', maker: 'Kodak', edge: 'VISION3 50D', bw: false,
    halation: 0, halationColor: [1, 0.32, 0.12], grain: 0,
  },
  {
    id: 'vision200t', iso: 200, name: 'Vision3 200T', maker: 'Kodak', edge: 'VISION3 200T', bw: false,
    halation: 0, halationColor: [1, 0.32, 0.12], grain: 0,
  },
  {
    id: 'vision250d', iso: 250, name: 'Vision3 250D', maker: 'Kodak', edge: 'VISION3 250D', bw: false,
    halation: 0, halationColor: [1, 0.32, 0.12], grain: 0,
  },
  {
    id: 'vision500t', iso: 500, name: 'Vision3 500T', maker: 'Kodak', edge: 'VISION3 500T', bw: false,
    halation: 0, halationColor: [1, 0.32, 0.12], grain: 0,
  },
  {
    id: 'verita200d', iso: 200, name: 'Verita 200D', maker: 'Kodak', edge: 'VERITA 200D', bw: false,
    halation: 0, halationColor: [1, 0.32, 0.12], grain: 0,
  },
  {
    id: 'ektachrome100', iso: 100, name: 'Ektachrome 100', maker: 'Kodak', edge: 'EKTACHROME 100', bw: false,
    halation: 0, halationColor: [1, 0.32, 0.12], grain: 0,
  },
  {
    id: 'kodachrome64', iso: 64, name: 'Kodachrome 64', maker: 'Kodak', edge: 'KODACHROME 64', bw: false,
    halation: 0, halationColor: [1, 0.32, 0.12], grain: 0,
  },
  {
    id: 'provia100f', iso: 100, name: 'Provia 100F', maker: 'Fujifilm', edge: 'PROVIA 100F', bw: false,
    halation: 0, halationColor: [1, 0.34, 0.14], grain: 0,
  },
  {
    id: 'velvia100', iso: 100, name: 'Velvia 100', maker: 'Fujifilm', edge: 'VELVIA 100', bw: false,
    halation: 0, halationColor: [1, 0.34, 0.14], grain: 0,
  },
  {
    id: 'doublex', iso: 250, name: 'Double-X 5222', maker: 'Kodak', edge: 'DOUBLE-X 5222', bw: true,
    halation: 0, halationColor: [1, 1, 1], grain: 0,
  },
  {
    id: 'trix7266', iso: 200, name: 'Tri-X 7266', maker: 'Kodak', edge: 'TRI-X 7266', bw: true,
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
