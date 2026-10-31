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
//   iso             film speed, which sets the grain's size and strength
//   halation        default halation slider value (0: off until turned up), and its colour
//   grain           default grain amount (0: off until turned up), plus dye-cloud colour; Size and
//                   Roughness default to the ISO preset
//
// Real characterisations (spectral data, or Hald CLUTs from GPL-compatible
// packs) can replace these numbers without changing the pipeline.


export type StockId =
  | 'neutral'
  | 'portra400'
  | 'portra160'
  | 'gold200'
  | 'ektar100'
  | 'superia400'
  | 'pro400h'
  | 'cinestill800t'
  | 'trix400'
  | 'hp5';

import type { CbParams } from '../engine/colorbalance';

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
  /** Film speed, which sets the grain. */
  iso: number;
  grain: number;
  /** Grain Size default: the stock's film speed, in darktable's ISO units. */
  grainIso: number;
  /**
   * The stock's own colour grade (part of its style): darktable colour balance rgb settings,
   * run on the scene before Emulsion, separate from the recipe's Colour balance sliders.
   */
  grade?: Partial<CbParams>;
}

const I: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const RAW_STOCKS: Omit<Stock, 'grainIso'>[] = [
  {
    // No film: the pipeline's neutral tone curve and nothing else, like a raw
    // converter's default profile. The default for every photo.
    id: 'neutral', iso: 400, name: 'Neutral', maker: 'No film look', edge: 'EMULSION', bw: false,
    contrast: 1, crossover: [0, 0, 0], balance: [1, 1, 1],
    matrix: I,
    saturation: 1, fade: 0, halation: 0, halationColor: [1, 0.36, 0.14],
    grain: 0,
  },
  {
    id: 'portra400', iso: 400, name: 'Portra 400', maker: 'Kodak', edge: 'PORTRA 400', bw: false,
    contrast: 0.9, crossover: [0, 0.01, -0.05], balance: [1.04, 1, 0.93],
    matrix: [[1, 0, 0], [0.04, 0.93, 0.03], [0, 0, 1]],
    saturation: 0.9, fade: 0.018, halation: 0, halationColor: [1, 0.36, 0.14],
    grain: 0,
  },
  {
    id: 'portra160', iso: 160, name: 'Portra 160', maker: 'Kodak', edge: 'PORTRA 160', bw: false,
    contrast: 0.86, crossover: [0, 0, -0.03], balance: [1.02, 1, 0.97],
    matrix: [[1, 0, 0], [0.03, 0.95, 0.02], [0, 0, 1]],
    saturation: 0.86, fade: 0.022, halation: 0, halationColor: [1, 0.36, 0.14],
    grain: 0,
  },
  {
    id: 'gold200', iso: 200, name: 'Gold 200', maker: 'Kodak', edge: 'GOLD 200', bw: false,
    contrast: 1.05, crossover: [0.02, 0, -0.07], balance: [1.07, 1, 0.85],
    matrix: [[1, 0, 0], [0.06, 0.94, 0], [0, 0.02, 0.98]],
    saturation: 1.1, fade: 0.012, halation: 0, halationColor: [1, 0.32, 0.12],
    grain: 0,
  },
  {
    id: 'ektar100', iso: 100, name: 'Ektar 100', maker: 'Kodak', edge: 'EKTAR 100', bw: false,
    contrast: 1.14, crossover: [0.02, 0, 0], balance: [1.02, 1, 0.97],
    matrix: [[1.04, -0.02, -0.02], [-0.02, 1.03, -0.01], [-0.01, -0.03, 1.04]],
    saturation: 1.3, fade: 0, halation: 0, halationColor: [1, 0.32, 0.12],
    grain: 0,
  },
  {
    id: 'superia400', iso: 400, name: 'Superia 400', maker: 'Fujifilm', edge: 'SUPERIA 400', bw: false,
    contrast: 1.02, crossover: [0.03, -0.07, 0], balance: [0.96, 1.03, 1],
    matrix: [[1, 0, 0], [0, 1, 0], [0, 0.05, 0.95]],
    saturation: 1.08, fade: 0.01, halation: 0, halationColor: [1, 0.34, 0.14],
    grain: 0,
  },
  // Fitted 2026-10-31 to the direction of Oli's reference edits of four photos (tools/probe ?fit
  // with ?grade): warm highlights, cool lifted shadows, gentle crosstalk, low saturation.
  {
    id: 'pro400h', iso: 400, name: 'Pro 400H', maker: 'Fujifilm', edge: 'PRO 400H', bw: false,
    contrast: 1.043, crossover: [-0.045, -0.036, 0.049], balance: [0.946, 1, 1.038],
    matrix: [[1.036, -0.006, -0.03], [0.063, 0.864, 0.073], [-0.067, 0.01, 1.057]],
    saturation: 0.62, fade: 0, halation: 0, halationColor: [1, 0.36, 0.16],
    grain: 0,
    grade: { shadows_C: 0.026, shadows_H: 264, midtones_C: 0.006, midtones_H: 78, highlights_C: 0.055, highlights_H: 57, shadows_Y: 0.041, midtones_Y: -0.011, highlights_Y: -0.016, saturation_shadows: 0.06, chroma_shadows: 0.068 },
  },
  {
    id: 'cinestill800t', iso: 800, name: 'CineStill 800T', maker: 'CineStill', edge: '800T', bw: false,
    contrast: 0.98, crossover: [0, 0, 0.03], balance: [0.84, 0.96, 1.22], matrix: I,
    saturation: 1.02, fade: 0.015, halation: 0, halationColor: [1, 0.16, 0.05],
    grain: 0,
  },
  {
    id: 'trix400', iso: 400, name: 'Tri-X 400', maker: 'Kodak', edge: 'TRI-X 400', bw: true,
    contrast: 1.18, crossover: [0, 0, 0], balance: [1, 1, 1], matrix: I, bwWeights: [0.33, 0.52, 0.15],
    saturation: 1, fade: 0, halation: 0, halationColor: [1, 1, 1],
    grain: 0,
  },
  {
    id: 'hp5', iso: 400, name: 'HP5 Plus', maker: 'Ilford', edge: 'HP5 PLUS', bw: true,
    contrast: 1, crossover: [0, 0, 0], balance: [1, 1, 1], matrix: I, bwWeights: [0.29, 0.55, 0.16],
    saturation: 1, fade: 0.012, halation: 0, halationColor: [1, 1, 1],
    grain: 0,
  },
];

export const STOCKS: Stock[] = RAW_STOCKS.map((s) => ({ ...s, grainIso: s.iso }));

export const STOCK: Record<StockId, Stock> = Object.fromEntries(STOCKS.map((s) => [s.id, s])) as Record<StockId, Stock>;

export const isStockId = (v: unknown): v is StockId => typeof v === 'string' && v in STOCK;
