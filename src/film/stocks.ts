// SPDX-License-Identifier: GPL-3.0-or-later
// Film stock models. Each stock is a style: settings of darktable modules, fitted to looks
// rather than measured characterisations.
//
//   contrast        sigmoid contrast relative to Emulsion's neutral curve (tone stage)
//   primaries       sigmoid's primaries: attenuation (inset), rotation in degrees and recover
//                   purity (tone stage); absent for none
//   grade           colour balance rgb settings, run on the scene before the tone stage
//   bwWeights       black and white stocks: spectral sensitivity (emulsion stage)
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
import type { SigmoidPrimaries } from '../engine/primaries';

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
  /** darktable sigmoid's primaries (part of its style). */
  primaries?: SigmoidPrimaries;
  /** Black and white stocks: spectral sensitivity as Rec.2020 channel weights. */
  bwWeights?: Vec3;
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

const RAW_STOCKS: Omit<Stock, 'grainIso'>[] = [
  {
    // No film: the pipeline's neutral tone curve and nothing else, like a raw
    // converter's default profile. The default for every photo.
    id: 'neutral', iso: 400, name: 'Neutral', maker: 'No film look', edge: 'EMULSION', bw: false,
    contrast: 1, halation: 0, halationColor: [1, 0.36, 0.14], grain: 0,
  },
  {
    id: 'portra400', iso: 400, name: 'Portra 400', maker: 'Kodak', edge: 'PORTRA 400', bw: false,
    contrast: 0.9, halation: 0, halationColor: [1, 0.36, 0.14], grain: 0,
  },
  {
    id: 'portra160', iso: 160, name: 'Portra 160', maker: 'Kodak', edge: 'PORTRA 160', bw: false,
    contrast: 0.86, halation: 0, halationColor: [1, 0.36, 0.14], grain: 0,
  },
  {
    id: 'gold200', iso: 200, name: 'Gold 200', maker: 'Kodak', edge: 'GOLD 200', bw: false,
    contrast: 1.05, halation: 0, halationColor: [1, 0.32, 0.12], grain: 0,
  },
  {
    id: 'ektar100', iso: 100, name: 'Ektar 100', maker: 'Kodak', edge: 'EKTAR 100', bw: false,
    contrast: 1.14, halation: 0, halationColor: [1, 0.32, 0.12], grain: 0,
  },
  {
    id: 'superia400', iso: 400, name: 'Superia 400', maker: 'Fujifilm', edge: 'SUPERIA 400', bw: false,
    contrast: 1.02, halation: 0, halationColor: [1, 0.34, 0.14], grain: 0,
  },
  // Fitted 2026-10-31 to the direction of Oli's reference edits of four photos (tools/probe ?fit
  // with ?grade): warm highlights, cool lifted shadows, gentle crosstalk, low saturation.
  {
    id: 'pro400h', iso: 400, name: 'Pro 400H', maker: 'Fujifilm', edge: 'PRO 400H', bw: false,
    contrast: 1.043, halation: 0, halationColor: [1, 0.36, 0.16], grain: 0,
    grade: { shadows_C: 0.026, shadows_H: 264, midtones_C: 0.006, midtones_H: 78, highlights_C: 0.055, highlights_H: 57, shadows_Y: 0.041, midtones_Y: -0.011, highlights_Y: -0.016, saturation_shadows: 0.06, chroma_shadows: 0.068 },
  },
  {
    id: 'cinestill800t', iso: 800, name: 'CineStill 800T', maker: 'CineStill', edge: '800T', bw: false,
    contrast: 0.98, halation: 0, halationColor: [1, 0.16, 0.05], grain: 0,
  },
  {
    id: 'trix400', iso: 400, name: 'Tri-X 400', maker: 'Kodak', edge: 'TRI-X 400', bw: true,
    contrast: 1.18, bwWeights: [0.33, 0.52, 0.15], halation: 0, halationColor: [1, 1, 1], grain: 0,
  },
  {
    id: 'hp5', iso: 400, name: 'HP5 Plus', maker: 'Ilford', edge: 'HP5 PLUS', bw: true,
    contrast: 1, bwWeights: [0.29, 0.55, 0.16], halation: 0, halationColor: [1, 1, 1], grain: 0,
  },
];

export const STOCKS: Stock[] = RAW_STOCKS.map((s) => ({ ...s, grainIso: s.iso }));

export const STOCK: Record<StockId, Stock> = Object.fromEntries(STOCKS.map((s) => [s.id, s])) as Record<StockId, Stock>;

export const isStockId = (v: unknown): v is StockId => typeof v === 'string' && v in STOCK;
