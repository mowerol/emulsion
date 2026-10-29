// SPDX-License-Identifier: GPL-3.0-or-later
// Film stock models. These are approximations tuned by eye, not measured
// characterisations. Each value is a parameter of a pipeline stage:
//
//   contrast        print contrast (1 = neutral) for the tone stage
//   crossover       per-channel contrast offsets; unequal values tint shadows
//                   and highlights differently, the way real dye layers do
//   balance         scene colour balance gains (exposure stage, Rec.2020)
//   matrix          dye crosstalk (emulsion stage); rows sum to 1 so greys stay grey
//   saturation      print saturation
//   fade            black lift of the print
//   halation        default halation slider value, and its colour
//   grain           default grain amount and size sliders, plus dye-cloud colour
//
// Real characterisations (spectral data, or Hald CLUTs from GPL-compatible
// packs) can replace these numbers without changing the pipeline.

export type StockId =
  | 'portra400'
  | 'portra160'
  | 'gold200'
  | 'ektar100'
  | 'superia400'
  | 'pro400h'
  | 'cinestill800t'
  | 'trix400'
  | 'hp5';

export type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];
export type Vec3 = [number, number, number];

export interface Stock {
  id: StockId;
  name: string;
  maker: string;
  /** Text printed along the film edge in the filmstrip. */
  edge: string;
  bw: boolean;
  contrast: number;
  crossover: Vec3;
  balance: Vec3;
  matrix: Mat3;
  /** Black and white stocks: spectral sensitivity as Rec.2020 channel weights. */
  bwWeights?: Vec3;
  saturation: number;
  fade: number;
  halation: number;
  halationColor: Vec3;
  grain: number;
  grainSize: number;
  grainChroma: number;
}

const I: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

export const STOCKS: Stock[] = [
  {
    id: 'portra400', name: 'Portra 400', maker: 'Kodak', edge: 'PORTRA 400', bw: false,
    contrast: 0.9, crossover: [0, 0.01, -0.05], balance: [1.04, 1, 0.93],
    matrix: [[1, 0, 0], [0.04, 0.93, 0.03], [0, 0, 1]],
    saturation: 0.9, fade: 0.018, halation: 12, halationColor: [1, 0.36, 0.14],
    grain: 30, grainSize: 100, grainChroma: 0.3,
  },
  {
    id: 'portra160', name: 'Portra 160', maker: 'Kodak', edge: 'PORTRA 160', bw: false,
    contrast: 0.86, crossover: [0, 0, -0.03], balance: [1.02, 1, 0.97],
    matrix: [[1, 0, 0], [0.03, 0.95, 0.02], [0, 0, 1]],
    saturation: 0.86, fade: 0.022, halation: 10, halationColor: [1, 0.36, 0.14],
    grain: 18, grainSize: 85, grainChroma: 0.25,
  },
  {
    id: 'gold200', name: 'Gold 200', maker: 'Kodak', edge: 'GOLD 200', bw: false,
    contrast: 1.05, crossover: [0.02, 0, -0.07], balance: [1.07, 1, 0.85],
    matrix: [[1, 0, 0], [0.06, 0.94, 0], [0, 0.02, 0.98]],
    saturation: 1.1, fade: 0.012, halation: 12, halationColor: [1, 0.32, 0.12],
    grain: 38, grainSize: 110, grainChroma: 0.35,
  },
  {
    id: 'ektar100', name: 'Ektar 100', maker: 'Kodak', edge: 'EKTAR 100', bw: false,
    contrast: 1.14, crossover: [0.02, 0, 0], balance: [1.02, 1, 0.97],
    matrix: [[1.04, -0.02, -0.02], [-0.02, 1.03, -0.01], [-0.01, -0.03, 1.04]],
    saturation: 1.3, fade: 0, halation: 8, halationColor: [1, 0.32, 0.12],
    grain: 14, grainSize: 80, grainChroma: 0.25,
  },
  {
    id: 'superia400', name: 'Superia 400', maker: 'Fujifilm', edge: 'SUPERIA 400', bw: false,
    contrast: 1.02, crossover: [0.03, -0.07, 0], balance: [0.96, 1.03, 1],
    matrix: [[1, 0, 0], [0, 1, 0], [0, 0.05, 0.95]],
    saturation: 1.08, fade: 0.01, halation: 12, halationColor: [1, 0.34, 0.14],
    grain: 42, grainSize: 110, grainChroma: 0.4,
  },
  {
    id: 'pro400h', name: 'Pro 400H', maker: 'Fujifilm', edge: 'PRO 400H', bw: false,
    contrast: 0.86, crossover: [0, -0.03, -0.02], balance: [0.95, 1.02, 1.03],
    matrix: [[0.97, 0.03, 0], [0, 1, 0], [0, 0.07, 0.93]],
    saturation: 0.84, fade: 0.03, halation: 10, halationColor: [1, 0.36, 0.16],
    grain: 28, grainSize: 100, grainChroma: 0.3,
  },
  {
    id: 'cinestill800t', name: 'CineStill 800T', maker: 'CineStill', edge: '800T', bw: false,
    contrast: 0.98, crossover: [0, 0, 0.03], balance: [0.84, 0.96, 1.22], matrix: I,
    saturation: 1.02, fade: 0.015, halation: 80, halationColor: [1, 0.16, 0.05],
    grain: 46, grainSize: 115, grainChroma: 0.4,
  },
  {
    id: 'trix400', name: 'Tri-X 400', maker: 'Kodak', edge: 'TRI-X 400', bw: true,
    contrast: 1.18, crossover: [0, 0, 0], balance: [1, 1, 1], matrix: I, bwWeights: [0.33, 0.52, 0.15],
    saturation: 1, fade: 0, halation: 4, halationColor: [1, 1, 1],
    grain: 55, grainSize: 120, grainChroma: 0,
  },
  {
    id: 'hp5', name: 'HP5 Plus', maker: 'Ilford', edge: 'HP5 PLUS', bw: true,
    contrast: 1.0, crossover: [0, 0, 0], balance: [1, 1, 1], matrix: I, bwWeights: [0.29, 0.55, 0.16],
    saturation: 1, fade: 0.012, halation: 4, halationColor: [1, 1, 1],
    grain: 45, grainSize: 110, grainChroma: 0,
  },
];

export const STOCK: Record<StockId, Stock> = Object.fromEntries(STOCKS.map((s) => [s.id, s])) as Record<StockId, Stock>;

export const isStockId = (v: unknown): v is StockId => typeof v === 'string' && v in STOCK;
