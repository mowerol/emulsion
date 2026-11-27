// Copyright (C) 2017 Alasdair Newson, Noura Faraj, Bruno Galerne, Julie Delon.
// The Boolean film grain model of "Realistic Film Grain Rendering", Image Processing On Line 7
// (2017), pp. 165-183, https://www.ipol.im/pub/art/2017/192, from its reference implementation
// (Film_grain_rendering_IPOL, licence GPL v3+; ported in boolgrain.ts). Method: Newson, Delon,
// Galerne, "A Stochastic Film Grain Model for Resolution-Independent Rendering", Computer
// Graphics Forum 2017.
// Changes from the reference, each agreed with Oli (2026-11-26; docs/research/film-grain.md,
// film-grain-methods.md, film-grain-stocks.md):
// - The Gaussian filter is evaluated on a regular grid of points per output pixel (each tested
//   once, then weighted by the filter one axis at a time) instead of with 800 Monte Carlo points
//   per pixel; measured closer to the converged model than the reference's own estimate.
// - The film is baked: in each cell the model's grains appear in order as the value rises and are
//   the same at every value, so each point has a threshold above which it lies in a grain
//   (grainThreshold), a property of the film alone, baked once into a tile of 16-bit levels in
//   units of the grain radius (the model is the same at every scale). A point reads the value at
//   itself rather than at its cells' corners; the cells are a radius wide rather than aligned to
//   input pixels; the frame is cut into blocks of 256 radii, each at its own random place on the
//   tile, so its repeats never line up (AV1's film grain does the same with its template).
// - Grains far smaller than a pixel are integrated, not tested point by point: cells of a quarter
//   pixel read the share of their film covered from the integrated film (the tile's blocks, their
//   covered shares at 32 values), which the point grid could not resolve (most stocks at 100%,
//   every view zoomed out).
// - Zoomed out (a view or an export smaller than the full size) the filter is the full size's,
//   then the app's Fit shrink (darktable's Lanczos3), so the grain is the full-size grain shrunk;
//   the reference renders each size afresh through σ output pixels, which showed about half of it.
// - Negative and print: the shown value is the print of a negative whose grains the model draws,
//   through a logistic paper curve (or, for a slide, the film itself with dark grains), so grain
//   sits in the light midtones and leaves deep shadows clean, as real prints do; the reference
//   takes the grey level as the coverage.
// - The image is the finished photo's display-encoded luma at the size it is shown, and the render
//   replaces it, keeping the photo's colour (the reference renders grey images). Grains are placed
//   in the uncropped frame's full-resolution pixels, so the film is the same at every zoom.
// - The parameters come from film stocks' published granularity (FILM_STOCKS), through one typical
//   film (TYPICAL_FILM) at a fixed spread of the radii (FILM_SPREAD; the paper's σr), not chosen
//   per photo. The change is split into its softening and its grain, the grain less its expected
//   print (so it never shifts the tone, as a printer's exposure correction); Amount 50 is the
//   model, 100 twice its grain.
// - As a lab scans it (agreed with Oli, 2026-11-26; docs/research/film-grain.md, "Measured against
//   a lab scan"): the filter is a size on the film (Softness, in µm: a scanner's blur is fixed on
//   the film, so grain per pixel is about the same in a 3,100 and a 6,800 px scan), not the
//   reference's 0.8 output pixels (its anti-aliasing choice, not a measurement); its default, 5.75
//   µm, is 0.5 px of a 3,130 px lab scan, as crisp as one; and every stock's granularity is scaled
//   by SCAN_GRANULARITY, so Amount 50 matches a lab scan of the film (fitted to 24 lab scans of
//   Gold 200 and Portra 400 and 800, Oli's and Unsplash's), where the datasheets' diffuse
//   granularity gave about a quarter of it; black and white by SCAN_GRANULARITY_BW, from Tri-X
//   scans, as the datasheets make it about twice as grainy against colour as scans show. The
//   filter is at least half a frame pixel (FILTER_MIN_PX), as a scan is at least as soft as its
//   sampling. Zoomed in past 100% it is the full size's grain enlarged (the filter grows with the
//   zoom; the reference's stays in output pixels), as the photo is.
// - One film, typical film at its own speed, for every Size and push: they scale its grain
//   (filmSizeGain), which with grains far smaller than the filter is what larger grains do
//   (agreed with Oli, 2026-11-27), so they are exact live and never redraw the grains.
// - The intensity is computed from the value directly (as boolgrain.ts), a cell holds at most 64
//   grains (MAX_CELL_GRAINS; the reference's cap is 10000 × the intensity), and points outside the
//   frame read its edge.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Film grain (Grain type Film): the photo rebuilt from silver grains, discs whose centres are a
// Poisson process with the intensity that makes them cover the share of the negative the photo
// asks for, seen through a Gaussian filter, then printed. The film is typical film (TYPICAL_FILM,
// set from the stocks' granularity as scanned); Size (a film speed, pushed) scales the grain
// radius, Softness the filter; Amount 50 is typical film at that speed as a lab scans it, 100
// twice it (agreed with Oli, 2026-11-26: no stock menu, as a stock only scales the grain). GPU twin: shaders/filmgrain-bake.frag.glsl (the film),
// filmgrain-pyramid.frag.glsl (integrated), filmgrain.frag.glsl and filmgrain-cells.frag.glsl (the
// grid), filmgrain-blur.frag.glsl (the filter, printed), driven by filmgraingpu.ts.

import { MAX_GREY, EPSILON_GREY, Prng, cellSeed, grainGeometry, type BoolGrainParams } from './boolgrain';
import { srgbEotf, srgbOetf } from './color';
import { LANCZOS_WIDTH, lanczosTap } from './resample';

/** Softness by default: the filter's deviation on the film, in µm. 5.75 µm is 0.5 px of a 3,130
 * px lab scan (a Frontier's), as crisp as its grain; about 1 px of a 26 MP frame (the reference's
 * is 0.8 output pixels at every size; see the header). */
export const SOFTNESS_DEFAULT = 5.75;
/** The filter's least deviation, in frame pixels: no scan is sharper than about half its pixel
 * (its own sampling averages the grain), and the integrated cells, a quarter pixel apart, need it.
 * Frames under about 3,100 px wide meet it at the default Softness. */
export const FILTER_MIN_PX = 0.5;
/**
 * How much grainier a lab scan of a film is than its datasheet granularity says, at the default
 * Softness: fitted to Oli's Kodak Gold 200 lab scans (3,130 px, no sharpening added; midtone grain
 * at 100% 6.4 to 6.9 / 255 against 2.5 to 2.9 from the datasheet), and the median of 24 lab scans
 * of Gold 200, Portra 400 and Portra 800 from 3,000 to 6,800 px (2.43; docs/research/film-grain.md).
 * Colour negatives, cinema and slides take it: web samples (1,024 px) put colour negatives within
 * their datasheets' order. Slides are not yet checked against scans.
 */
export const SCAN_GRANULARITY = 2.44;
/**
 * Black and white's: Tri-X 400 lab scans (Unsplash, 35 mm, 3,000 px) hold about half the grain
 * its datasheet times SCAN_GRANULARITY gives (12 against 24 / 255 in the midtones of the crispest
 * scan; softer scans less), so about 1.8 × Gold 200's rather than the datasheets' 3.5 ×, as
 * thedarkroom's samples also put it (1.5 ×). Agreed with Oli, 2026-11-26.
 */
export const SCAN_GRANULARITY_BW = 1.3;
/** The scan factor for a stock (SCAN_GRANULARITY, or SCAN_GRANULARITY_BW for black and white). */
export const scanGranularity = (stock: FilmStock) => (stock.group === 'Black and white' ? SCAN_GRANULARITY_BW : SCAN_GRANULARITY);
/** The film width a frame's long edge stands for, in µm (35 mm). */
export const FRAME_UM = 36000;

/**
 * Film stocks (docs/research/film-grain-stocks.md): each stock's published diffuse RMS granularity
 * (σD × 1000 at density 1.0 through a 48 µm aperture: Kodak and Fujifilm datasheets; Kodak's colour
 * negatives from their Print Grain Index through Portra 400 ≡ RMS 4; Ilford's, which publish none,
 * as the Kodak stock of the same speed and crystals), its speed, the spread of its grain sizes
 * (0.4 conventional crystals, 0.2 tabular and modern colour: Mees 1942, Kodak and Fujifilm
 * patents), and whether it is printed (a negative) or viewed (a slide). Inferred values are the
 * research's.
 */
export interface FilmStock { id: string; name: string; group: 'Black and white' | 'Colour negative' | 'Slide' | 'Cinema'; iso: number; rms: number; spread: number; kind: FilmKind }
export const FILM_STOCKS: FilmStock[] = [
  { id: 'trix400', name: 'Kodak Tri-X 400', group: 'Black and white', iso: 400, rms: 17, spread: 0.4, kind: 'negative' },
  { id: 'trix320', name: 'Kodak Tri-X 320', group: 'Black and white', iso: 320, rms: 16, spread: 0.4, kind: 'negative' },
  { id: 'hp5', name: 'Ilford HP5 Plus', group: 'Black and white', iso: 400, rms: 17, spread: 0.4, kind: 'negative' },
  { id: 'tmax100', name: 'Kodak T-Max 100', group: 'Black and white', iso: 100, rms: 8, spread: 0.2, kind: 'negative' },
  { id: 'tmax400', name: 'Kodak T-Max 400', group: 'Black and white', iso: 400, rms: 10, spread: 0.2, kind: 'negative' },
  { id: 'tmax3200', name: 'Kodak T-Max P3200', group: 'Black and white', iso: 1000, rms: 18, spread: 0.2, kind: 'negative' },
  { id: 'delta100', name: 'Ilford Delta 100', group: 'Black and white', iso: 100, rms: 8, spread: 0.2, kind: 'negative' },
  { id: 'delta400', name: 'Ilford Delta 400', group: 'Black and white', iso: 400, rms: 10, spread: 0.2, kind: 'negative' },
  { id: 'delta3200', name: 'Ilford Delta 3200', group: 'Black and white', iso: 1000, rms: 18, spread: 0.2, kind: 'negative' },
  { id: 'ektar100', name: 'Kodak Ektar 100', group: 'Colour negative', iso: 100, rms: 2.2, spread: 0.2, kind: 'negative' },
  { id: 'portra160', name: 'Kodak Portra 160', group: 'Colour negative', iso: 160, rms: 3.1, spread: 0.2, kind: 'negative' },
  { id: 'gold200', name: 'Kodak Gold 200', group: 'Colour negative', iso: 200, rms: 4.9, spread: 0.2, kind: 'negative' },
  { id: 'portra400', name: 'Kodak Portra 400', group: 'Colour negative', iso: 400, rms: 4, spread: 0.2, kind: 'negative' },
  { id: 'ultramax400', name: 'Kodak UltraMax 400', group: 'Colour negative', iso: 400, rms: 5.2, spread: 0.2, kind: 'negative' },
  { id: 'portra800', name: 'Kodak Portra 800', group: 'Colour negative', iso: 800, rms: 5.5, spread: 0.2, kind: 'negative' },
  { id: 'superia400', name: 'Fujifilm Superia X-TRA 400', group: 'Colour negative', iso: 400, rms: 4, spread: 0.2, kind: 'negative' },
  { id: 'pro400h', name: 'Fujifilm Pro 400H', group: 'Colour negative', iso: 400, rms: 4, spread: 0.2, kind: 'negative' },
  { id: 'superia1600', name: 'Fujifilm Superia 1600', group: 'Colour negative', iso: 1600, rms: 7, spread: 0.2, kind: 'negative' },
  { id: 'vision250d', name: 'Kodak Vision3 250D', group: 'Cinema', iso: 250, rms: 5.6, spread: 0.2, kind: 'negative' },
  { id: 'vision500t', name: 'Kodak Vision3 500T', group: 'Cinema', iso: 500, rms: 6.5, spread: 0.2, kind: 'negative' },
  { id: 'cinestill800t', name: 'CineStill 800T', group: 'Cinema', iso: 800, rms: 6.5, spread: 0.2, kind: 'negative' },
  { id: 'velvia50', name: 'Fujifilm Velvia 50', group: 'Slide', iso: 50, rms: 9, spread: 0.2, kind: 'slide' },
  { id: 'provia100f', name: 'Fujifilm Provia 100F', group: 'Slide', iso: 100, rms: 8, spread: 0.2, kind: 'slide' },
  { id: 'provia400f', name: 'Fujifilm Provia 400F', group: 'Slide', iso: 400, rms: 13, spread: 0.2, kind: 'slide' },
];
export const FILM_STOCK: Record<string, FilmStock> = Object.fromEntries(FILM_STOCKS.map((f) => [f.id, f]));
/**
 * The spread of the grains' radii (Irregularity 60): between modern colour and tabular film (0.2)
 * and conventional crystals (0.4). Not a control: at a fixed granularity it is not visible (40
 * against 80 differed by about 1% in grain and not in texture at 100% and 400%; research log), and
 * one spread means one baked film for every photo.
 */
export const FILM_SPREAD = 0.3;
/**
 * The film Film grain renders (agreed with Oli, 2026-11-26): typical film, Kodak UltraMax 400's
 * granularity as a lab scans it (12.7, consumer colour; T-Max 400 as scanned is 13), between pro
 * colour (Portra 400, 9.8) and conventional black and white (Tri-X 400, 22.1). A stock only scales
 * the grain, so Amount stands in for the choice (filmAmountFor).
 */
export const TYPICAL_FILM: FilmStock = { id: 'typical', name: 'Typical film', group: 'Colour negative', iso: 400, rms: 5.2, spread: FILM_SPREAD, kind: 'negative' };

/**
 * The model's granularity per µm of mean radius (σD at density 1.0 through a 48 µm aperture), by
 * the radius's spread: the Boolean model's exact density variance (Bayer 1964's random-dot model),
 * computed in the research (film-grain-stocks.md, "From granularity to the model's radius").
 */
const GRANULARITY_PER_UM: [number, number][] = [[0, 0.0378], [0.2, 0.0408], [0.3, 0.0449], [0.4, 0.0511], [0.5, 0.0600]];
export function granularityPerUm(spread: number): number {
  const t = GRANULARITY_PER_UM;
  if (spread <= 0) return t[0][1];
  for (let i = 1; i < t.length; i++) if (spread <= t[i][0]) {
    const [s0, k0] = t[i - 1], [s1, k1] = t[i];
    return k0 + ((spread - s0) / (s1 - s0)) * (k1 - k0);
  }
  return t[t.length - 1][1];
}
/** Granularity grows as speed^0.35 within a family (fitted to Kodak and Fujifilm datasheet pairs). */
export const ISO_EXPONENT = 0.35;
/** A push stop multiplies the radius by this (inferred: Kodak gives no number for still film). */
export const PUSH_FACTOR = 1.15;

/**
 * The mean radius in µm on the negative: the radius whose discs give the stock's granularity at
 * the grains' spread (so the spread changes the grains, not how grainy the film is), scaled from
 * the stock's speed to Size's and by the push.
 */
export function radiusUm(stock: FilmStock, iso: number, spread: number, push: number): number {
  return (stock.rms / 1000 / granularityPerUm(spread)) * (iso / stock.iso) ** ISO_EXPONENT * PUSH_FACTOR ** push;
}

export interface FilmGrainSettings {
  /** Amount, 0 to 100: 50 is typical film's grain, 100 twice it (filmAmounts). */
  grain: number;
  /** Size, as a film speed, and the push. */
  grainIso: number;
  push: number;
  /** Softness: the filter's deviation on the film, in µm. */
  grainSoftness: number;
  /** Reshuffles: each draws the grains afresh, the same film (0 or absent: the photo's own draw). */
  grainSeed?: number;
}
/** The Amount that gives a negative stock's own grain as a lab scans it, with Size at its speed:
 * its scanned granularity against typical film's at that speed (Ektar 100 about 34, Portra 400 38,
 * Gold 200 60, Tri-X 400 87). Not for slides, whose granularity is of the film viewed. */
export const filmAmountFor = (stock: FilmStock) =>
  (50 * stock.rms * scanGranularity(stock)) / (TYPICAL_FILM.rms * scanGranularity(TYPICAL_FILM) * (stock.iso / TYPICAL_FILM.iso) ** ISO_EXPONENT);

/** The model's parameters for a frame of fullW × fullH pixels (its long edge a 35 mm frame's
 * width), or null when Amount is 0 (the Amount itself is not the model's: filmAmount). */
export function filmGrainParams(r: FilmGrainSettings, fullW: number, fullH: number, seed: number): BoolGrainParams | null {
  if (!(r.grain > 0)) return null;
  // One film for every Size and push: typical film at its own speed. Size and push scale its grain
  // (filmSizeGain), which with grains far smaller than the filter is what a larger grain does.
  const radius = radiusUm(TYPICAL_FILM, TYPICAL_FILM.iso, FILM_SPREAD, 0) * scanGranularity(TYPICAL_FILM) / FRAME_UM * Math.max(fullW, fullH);
  return {
    radius,
    sigmaR: radius * FILM_SPREAD,
    // Softness is on the film (µm), like the grains: the same share of the frame at every size,
    // down to half a pixel.
    sigmaFilter: Math.max(FILTER_MIN_PX, r.grainSoftness / FRAME_UM * Math.max(fullW, fullH)),
    samples: 0,
    // Emulsion's seeds are 0.5 to 40.5 in hundredths (seedFor); a reshuffle moves to another draw.
    seed: (Math.round(seed * 100) + Math.max(0, Math.floor(r.grainSeed ?? 0)) * 104729) >>> 0,
  };
}
/**
 * Amount (agreed with Oli): 50 is the model, typical film's grain; 100 doubles the grain. The
 * model's change is split into its softening (the photo seen through the filter, filmChange) and
 * its grain (the render's departure from that): the softening fades in to Amount 50 and then
 * stays, the grain grows with Amount. Below 50 both fade, as a mix with the photo would.
 */
export const filmAmounts = (r: Pick<FilmGrainSettings, 'grain'> & Partial<Pick<FilmGrainSettings, 'grainIso' | 'push'>>) => {
  const a = Math.min(100, Math.max(0, r.grain)) / 50;
  return { soft: Math.min(1, a), grain: a * filmSizeGain(r) };
};
/**
 * Size and push as the grain's strength (agreed with Oli, 2026-11-27): the film's radius scales as
 * speed^0.35 and 1.15 a pushed stop (radiusUm), and with grains far smaller than the filter (a
 * twentieth of it at ISO 400, a tenth at 3200, on 26 MP) the render's grain grows in proportion to
 * the radius while its texture stays the filter's, so the one film's grain is scaled instead of
 * drawing another: Size and push are exact live, and never redraw the grains.
 */
export const filmSizeGain = (r: Partial<Pick<FilmGrainSettings, 'grainIso' | 'push'>>) =>
  r.grainIso === undefined ? 1 : radiusUm(TYPICAL_FILM, r.grainIso, FILM_SPREAD, r.push ?? 0) / radiusUm(TYPICAL_FILM, TYPICAL_FILM.iso, FILM_SPREAD, 0);

/**
 * Grid points per output pixel along each axis: spaced no wider than a grain (closer spacing
 * stops the regular grid adding grain of its own, measured: 2 or 3 points per grain radius
 * coarsened it by 30-80%), at least 4.8 per filter deviation (as many points under the filter as
 * at the default softness), at most 12 (smaller grains than that are averaged by the filter, and
 * 12 is already more accurate than the reference's 800 points) or 16 for the softest filter.
 */
export function gridDensity(radiusOut: number, sigmaFilter: number): number {
  const byGrain = Math.min(12, Math.max(3, Math.ceil(1 / Math.max(radiusOut, 1e-6))));
  return Math.min(16, Math.max(byGrain, Math.ceil(4.8 / sigmaFilter)));
}

/**
 * The view's filter along one axis, in output pixels: the Gaussian of σ frame pixels, σ × scale
 * output pixels, at 100% and closer (the full size's grain, enlarged). Zoomed out it is the full size's (the Gaussian of σ frame pixels,
 * σ × scale output pixels) followed by the shrink the app gives the photo at Fit, darktable's
 * Lanczos3 (resample.ts): a zoomed-out view or a smaller export shows the full-size grain shrunk,
 * where the reference renders each size afresh through σ output pixels, which showed about half
 * the grain (agreed with Oli, 2026-11-26; docs/research/film-grain-methods.md, (b) 2).
 */
export function viewFilter(sigma: number, scale: number): { reach: number; at: (d: number) => number } {
  // Zoomed in, the full size's grain enlarged, as the photo is (agreed with Oli, 2026-11-27): the
  // filter grows with the zoom, so the grains never come closer to its size than at 100%.
  if (scale >= 1) { const s = sigma * scale; return { reach: 3 * s, at: (d) => Math.exp((-0.5 * d * d) / (s * s)) }; }
  const s = sigma * scale, W = LANCZOS_WIDTH;
  if (s < 0.05) return { reach: W, at: (d) => (Math.abs(d) < W ? lanczosTap(d) : 0) };
  // Lanczos3 convolved with the Gaussian, integrated numerically.
  const n = 240, dx = (2 * W) / n;
  const at = (d: number) => {
    let sum = 0;
    for (let i = 0; i < n; i++) { const x = -W + (i + 0.5) * dx; sum += lanczosTap(x) * Math.exp((-0.5 * (d - x) ** 2) / (s * s)); }
    return sum * dx;
  };
  return { reach: W + 3 * s, at };
}

/** How far the filter reaches beyond an output pixel, in output pixels (its reach, and one). */
export const blurMargin = (sigmaFilter: number, scale: number) => Math.ceil(viewFilter(sigmaFilter, scale).reach) + 1;

/** The developed image needed around the output, in output pixels: the filter's reach, and one. */
export const filmMargin = (p: BoolGrainParams, scale: number) => blurMargin(p.sigmaFilter, scale) + 1;

/**
 * How a view samples the film. With grains far smaller than an output pixel (most stocks at 100%,
 * every view zoomed out) testing points would need thousands per pixel: instead each of
 * INTEGRATED_K × INTEGRATED_K cells per output pixel reads the share of its film that is covered,
 * from the integrated film (filmPyramid: the baked film's blocks of 2^level texels, their covered
 * share at PYRAMID_KNOTS values), at the level whose blocks are about a cell wide. Larger grains are
 * tested point by point (gridDensity points per pixel).
 */
export const INTEGRATE_BELOW = 1 / 16;
export const INTEGRATED_K = 4;
export const PYRAMID_KNOTS = 32;
export const PYRAMID_FIRST = 3;
export const PYRAMID_LAST = 9;
/** The values the integrated film's shares are kept at: denser near 0 and 1 (Chebyshev), where the
 * print is steep. */
export const pyramidKnot = (j: number) => (1 - Math.cos((Math.PI * j) / (PYRAMID_KNOTS - 1))) / 2;
export interface FilmPlan { integrated: boolean; k: number; level: number }
export function filmPlan(p: BoolGrainParams, scale: number, tile: FilmTile = FILM_TILE): FilmPlan {
  const radiusOut = p.radius * scale;
  if (radiusOut >= INTEGRATE_BELOW) return { integrated: false, k: gridDensity(radiusOut, p.sigmaFilter * Math.max(1, scale)), level: 0 };
  // A cell's side in texels.
  const cell = 1 / INTEGRATED_K / radiusOut / tile.texel;
  return { integrated: true, k: INTEGRATED_K, level: Math.min(PYRAMID_LAST, Math.max(PYRAMID_FIRST, Math.round(Math.log2(cell)))) };
}
/** The integrated film's share covered at value c, block (bi, bj) of `level`, from its knots. */
export function blockShare(share: (level: number, bi: number, bj: number, knot: number) => number, level: number, bi: number, bj: number, c: number): number {
  const t = (Math.acos(Math.min(1, Math.max(-1, 1 - 2 * c))) * (PYRAMID_KNOTS - 1)) / Math.PI;
  const j = Math.min(PYRAMID_KNOTS - 2, Math.floor(t));
  const a = share(level, bi, bj, j), b = share(level, bi, bj, j + 1);
  const c0 = pyramidKnot(j), c1 = pyramidKnot(j + 1);
  return a + ((c - c0) / (c1 - c0)) * (b - a);
}
/** The exact share of block (bi, bj) of `level` covered at knot j, from the tile's levels (the GPU
 * builds the same, filmgrain-pyramid.frag). */
export function exactShare(level: (i: number, j: number) => number, L: number, bi: number, bj: number, j: number): number {
  const n = 2 ** L, c = pyramidKnot(j);
  let covered = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (reaches(c, level(bi * n + x, bj * n + y))) covered++;
  return covered / (n * n);
}

/** The top value the model takes (the reference's 255 / 255.1: u = 1 would need infinite grains). */
const U_TOP = MAX_GREY / (MAX_GREY + EPSILON_GREY);
export const U_TOP_VALUE = U_TOP;

/**
 * The lowest value u at which the film point (x, y) lies in a grain, or Infinity. The model's
 * grains appear in each cell in order as u rises, and they are the same grains at every u: the
 * cell's Poisson draw is the inverse of its distribution at one uniform draw, which counts more
 * grains as the intensity grows, and each grain's place (and radius) is drawn after it in turn.
 * So grain k of a cell is there exactly when the cell's count passes k, which is when the
 * intensity passes the λ where P(N ≤ k) equals that uniform; a point is covered at u when u
 * passes the lowest such threshold among the grains over it. `cells` makes the cells repeat
 * with that period (the baked film's tile), the reference's cells otherwise.
 */
export function grainThreshold(x: number, y: number, p: BoolGrainParams, cells = 0): number {
  const f = Math.fround, geo = grainGeometry(p), { ag, mu, sigma, maxRadius } = geo;
  const K = (ag * ag) / (Math.PI * (p.radius * p.radius + p.sigmaR * p.sigmaR));
  const lambdaTop = -K * Math.log(1 - U_TOP);
  const r2 = p.radius * p.radius;
  const wrap = (c: number) => (cells ? ((c % cells) + cells) % cells : c);
  let best = Infinity;
  const minX = Math.floor((x - maxRadius) / ag), maxX = Math.floor((x + maxRadius) / ag);
  const minY = Math.floor((y - maxRadius) / ag), maxY = Math.floor((y + maxRadius) / ag);
  for (let cx = minX; cx <= maxX; cx++) for (let cy = minY; cy <= maxY; cy++) {
    const cornerX = f(ag * cx), cornerY = f(ag * cy);
    const rng = new Prng(cellSeed(wrap(cx), wrap(cy), p.seed));
    const u0 = rng.uniform();
    // The most grains the cell can hold (at the top value): the same draw at the top intensity.
    let n = 0, prod = Math.exp(-lambdaTop), sum = prod;
    while (u0 > sum && n < MAX_CELL_GRAINS) { n++; prod = (prod * lambdaTop) / n; sum += prod; }
    for (let k = 0; k < n; k++) {
      const gx = f(cornerX + f(ag * rng.uniform())), gy = f(cornerY + f(ag * rng.uniform()));
      let rr = r2;
      if (p.sigmaR > 0) { const rad = Math.min(f(Math.exp(mu + sigma * rng.gaussian())), maxRadius); rr = f(rad * rad); }
      if ((gx - x) * (gx - x) + (gy - y) * (gy - y) >= rr) continue;
      // The first grain over the point is the cell's lowest: later grains need more intensity.
      best = Math.min(best, valueForLambda(lambdaAt(k, u0, lambdaTop), K));
      break;
    }
  }
  return best;
}

/**
 * The most grains a cell holds. The reference stops its Poisson draw at 10000 × the intensity,
 * which only a uniform draw of exactly 1 reaches (its distribution's sum stops short of 1 in
 * floats): about one cell in 17 million then fills with up to ~25,000 grains, and on the GPU the
 * loop over them is long enough to fault it. At the top value a cell averages 2.2 grains; more than
 * 20 has a chance of about 1e-10, so the cap changes only those cells (still filled, by 64).
 */
export const MAX_CELL_GRAINS = 64;

/** The intensity at which P(N ≤ k) = u0 for a Poisson count N (it falls as the intensity grows). */
export function lambdaAt(k: number, u0: number, top: number): number {
  const cdf = (l: number) => { let prod = Math.exp(-l), sum = prod; for (let x = 1; x <= k; x++) { prod = (prod * l) / x; sum += prod; } return sum; };
  let lo = 0, hi = top;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (cdf(mid) < u0) hi = mid; else lo = mid; }
  return hi;
}
/** The value whose cell intensity is λ (the inverse of cellLambda). */
const valueForLambda = (lambda: number, K: number) => 1 - Math.exp(-lambda / K);

/** Threshold levels: 16 bits, fine enough for the print's steep highlights (8 bits banded there). */
export const LEVELS = 65535;
/**
 * A threshold as the baked film stores it: the lowest level i (1 to 65535) with i / 65535 above
 * it, or 0 when the point is never covered (the threshold is at or above the top value).
 */
export function thresholdLevel(t: number): number {
  if (!(t < U_TOP)) return 0;
  return Math.min(LEVELS, Math.floor(t * LEVELS) + 1);
}
/** Whether coverage c reaches a stored threshold level. */
export const reaches = (c: number, level: number) => level > 0 && c >= level / LEVELS;

/**
 * Negative and print (agreed with Oli, 2026-11-26; docs/research/film-grain-methods.md, (b) 1).
 * The reference takes the grey level as the share of film its grains cover. Real grain lives in
 * the negative, which is then printed: a shown value is the print of a negative density, the
 * Boolean film is that negative (coverage c = 1 - 10^-D, Nutting's opaque grains), and the filtered
 * coverage is printed back. The paper is a logistic curve of density against the negative's
 * density (Stephenson and Saunders 2007's form) with a grade-2-like slope of 1.8 and maximum
 * density 2.0, the middle at negative density 0.95 (the research's illustration; inferred, not a
 * measured paper), so a negative's gamma of about 0.55 prints at a system gamma near 1. Slides are
 * viewed, not printed: their grains are dark, so coverage is 1 minus the transmittance (the shown
 * value in linear light).
 */
export type FilmKind = 'negative' | 'slide';
export const PRINT = { gamma: 1.8, dmax: 2, mid: 0.95 };
const PRINT_K = (4 * PRINT.gamma) / PRINT.dmax;
const PRINT_RMIN = 10 ** -PRINT.dmax;
/** The film's coverage under a shown value (0 to 1, display-encoded). */
export function coverageFor(v: number, kind: FilmKind): number {
  const lin = srgbEotf(Math.min(1, Math.max(0, v)));
  if (kind === 'slide') return Math.min(U_TOP, 1 - lin);
  // The paper's density for this reflectance, then the negative density printing to it.
  const dp = -Math.log10(PRINT_RMIN + lin * (1 - PRINT_RMIN));
  if (dp >= PRINT.dmax) return 0;
  const dn = PRINT.mid + Math.log(PRINT.dmax / dp - 1) / PRINT_K;
  return dn <= 0 ? 0 : Math.min(U_TOP, 1 - 10 ** -dn);
}
/** The shown value a coverage prints (or, for a slide, shows) as: coverageFor's inverse. */
export function shownFor(c: number, kind: FilmKind): number {
  if (kind === 'slide') return srgbOetf(Math.min(1, Math.max(0, 1 - c)));
  const dn = -Math.log10(Math.max(1e-7, 1 - c));
  const dp = PRINT.dmax / (1 + Math.exp(-PRINT_K * (PRINT.mid - dn)));
  return srgbOetf(Math.min(1, Math.max(0, (10 ** -dp - PRINT_RMIN) / (1 - PRINT_RMIN))));
}
/** The grain's change in the shown value at a pixel: the filtered coverage printed, less what the
 * pixel's own coverage prints as (so a value too dark to hold grain is left as it is). */
export const grainChange = (filtered: number, v: number, kind: FilmKind) => shownFor(filtered, kind) - shownFor(coverageFor(v, kind), kind);
/**
 * The model's variance of the filtered coverage, per squared radius in output pixels, at coverage c
 * (the Boolean model's covariance, Chiu et al., as in Zhang et al. 2023's patent equation 13, for
 * grains small against the filter): (1 - c)^2 J(c), J = ∫ (exp(λγ(h)) - 1) dh for unit discs,
 * λ = -ln(1 - c) / π, γ the overlap of two discs h apart; times the spread's factor from
 * film-grain-stocks.md (J at c = 0.5 for spreads 0.2, 0.3, 0.4 over equal discs').
 */
export function varianceShape(c: number, spread: number): number {
  const lambda = -Math.log(1 - Math.min(c, U_TOP)) / Math.PI;
  const n = 200;
  let J = 0;
  for (let i = 0; i < n; i++) {
    const h = (i + 0.5) * (2 / n);
    const gamma = 2 * Math.acos(h / 2) - (h / 2) * Math.sqrt(4 - h * h);
    J += 2 * Math.PI * h * (Math.exp(lambda * gamma) - 1) * (2 / n);
  }
  const f = [[0, 1], [0.2, 3.10 / 2.58], [0.3, 3.86 / 2.58], [0.4, 5.20 / 2.58], [0.5, 7.2 / 2.58]];
  let k = f[f.length - 1][1];
  for (let i = 1; i < f.length; i++) if (spread <= f[i][0]) { k = f[i - 1][1] + ((spread - f[i - 1][0]) / (f[i][0] - f[i - 1][0])) * (f[i][1] - f[i - 1][1]); break; }
  return (1 - c) ** 2 * J * k;
}
/**
 * The view's filter energy (filterEnergy) at this film's grid density, kept per filter and scale:
 * with grains far smaller than the filter, the grain's RMS is the radius in output pixels times
 * its root, so it rescales the grain shown while Size or Softness is dragged (filmGrainGain).
 */
const energies = new Map<string, number>();
export function filmViewEnergy(p: BoolGrainParams, scale: number): number {
  const k = filmPlan(p, scale).k, key = `${k}|${p.sigmaFilter}|${scale}`;
  let e = energies.get(key);
  if (e === undefined) {
    if (energies.size > 64) energies.clear();
    energies.set(key, e = filterEnergy(k, filterTaps(k, p.sigmaFilter, scale)));
  }
  return e;
}
/** The gain from a grain made at one radius and filter energy to another (the grain's RMS ratio). */
export const filmGrainGain = (made: { radius: number; energy: number }, radius: number, energy: number) =>
  made.radius > 0 && made.energy > 0 ? (radius / made.radius) * Math.sqrt(energy / made.energy) : 1;

/** ∫K² of the view's filter over output pixels (2D, separable): (k Σ w²)² from its grid taps. */
export const filterEnergy = (k: number, taps: { w: Float32Array }) => (k * taps.w.reduce((a, b) => a + b * b, 0)) ** 2;
/** The print's expected value over the render's spread at the mean (three-point Gauss-Hermite). */
export function expectedPrint(mean: number, variance: number, kind: FilmKind): number {
  const d = Math.sqrt(3 * Math.max(0, variance));
  const at = (c: number) => shownFor(Math.min(U_TOP, Math.max(0, c)), kind);
  return (at(mean - d) + at(mean + d)) / 6 + (2 / 3) * at(mean);
}

/**
 * The change split (filmAmounts): `soft`, the photo's own coverage seen through the filter
 * (meanCoverage, the render's expected value) printed, less the pixel's; `grain`, the render
 * printed less its expected print. The print's curve bends, so the printed grain alone would shift
 * the tone where the grain is coarse (15/255 lighter at 100% at twice Tri-X's grain), and by
 * different amounts at different zooms; a printer's exposure keeps the tone, and taking off the
 * expected print does the same, from the model's own variance (`variance`: varianceShape × the
 * radius in output pixels squared × filterEnergy).
 */
export function filmChange(filtered: number, mean: number, v: number, kind: FilmKind, variance = 0) {
  const own = shownFor(coverageFor(v, kind), kind);
  return { soft: shownFor(mean, kind) - own, grain: shownFor(filtered, kind) - expectedPrint(mean, variance, kind) };
}

/**
 * The baked film is made in units of the grain radius: the model is the same at every scale (a
 * film of radius r is the film of radius 1 shrunk by r), so one bake serves every Amount and every
 * photo, and only the spread (the radius's deviation relative to the radius) changes it. Its
 * cells are a radius wide, where the reference's are 1 / ceil(1 / r) input pixels so each sits in
 * one input pixel; the baked film reads the shown value at each point instead, so the cells are
 * only how the grains are drawn: different grains, the same model.
 */
export interface FilmTile {
  /** Texels per cell side, and the texel's side in radii. */
  perCell: number;
  texel: number;
  /** Cells along the tile's side; the tile repeats every `cells` radii. */
  cells: number;
  side: number;
}
/** Texels half a radius wide (no wider than the grid's spacing at 100% at ISO 3200), 6144 a side (16 bits each). */
export const FILM_TILE: FilmTile = { perCell: 2, texel: 0.5, cells: 3072, side: 6144 };
/** The baked film's own seed: each photo has its own place on the one film. */
export const FILM_SEED = 2017;
/** The film's grains for `p`, in radii. */
export const bakeParams = (p: BoolGrainParams): BoolGrainParams => ({ radius: 1, sigmaR: p.sigmaR / p.radius, sigmaFilter: p.sigmaFilter, samples: 0, seed: FILM_SEED });
/**
 * Grid points fall on texel edges at some zooms (their spacing and the texel's are both simple
 * fractions of a radius), where rounding would pick the texel: lookups are shifted by this share
 * of a texel, so a point reads the texel whose centre is nearest give or take the shift.
 */
export const TEXEL_PHASE = 0.3183;
/** The tile's texel (i, j)'s threshold level, for the film's grains `bake` (the GPU bakes the same). */
export function tileLevel(tile: FilmTile, bake: BoolGrainParams, i: number, j: number): number {
  return thresholdLevel(grainThreshold((i + 0.5) * tile.texel, (j + 0.5) * tile.texel, bake, tile.cells));
}
/**
 * The frame is cut into blocks FILM_BLOCK radii wide, each placed at its own random place on the
 * tile (in whole cells), from the photo's seed: the tile's repeats never line up (AV1's film grain
 * takes its blocks from random offsets in one template likewise, spec 7.18.3.5). Grains across a
 * block's edge are cut, which no one sees while they are far smaller than the filter.
 */
export const FILM_BLOCK = 256;
const hash = (x: number) => {
  let s = x >>> 0;
  s = ((s ^ 61) ^ (s >>> 16)) >>> 0;
  s = Math.imul(s, 9) >>> 0;
  s = (s ^ (s >>> 4)) >>> 0;
  s = Math.imul(s, 668265261) >>> 0;
  return (s ^ (s >>> 15)) >>> 0;
};
/** The texel offset of block (bx, by) on the tile, for a photo's seed. */
export function blockOffset(tile: FilmTile, seed: number, bx: number, by: number): [number, number] {
  const a = hash((Math.imul(bx, 73856093) ^ Math.imul(by, 19349663) ^ Math.imul(seed, 83492791)) >>> 0);
  const b = hash((a ^ 0x9e3779b9) >>> 0);
  return [(a % tile.cells) * tile.perCell, (b % tile.cells) * tile.perCell];
}
/** The tile's texel under the frame point (x, y) in radii: its block's place, then the texel. */
export function tileTexel(tile: FilmTile, seed: number, x: number, y: number): [number, number] {
  const [ox, oy] = blockOffset(tile, seed, Math.floor(x / FILM_BLOCK), Math.floor(y / FILM_BLOCK));
  const wrap = (v: number) => ((v % tile.side) + tile.side) % tile.side;
  return [wrap(Math.floor(x / tile.texel + TEXEL_PHASE) + ox), wrap(Math.floor(y / tile.texel + TEXEL_PHASE) + oy)];
}

/** Shown values (0 to 1) at output pixels x0 .. x0 + w - 1, y0 .. y0 + h - 1. */
export interface ShownImage {
  data: Float32Array;
  w: number;
  h: number;
  x0: number;
  y0: number;
}

/**
 * The model's render of the output pixels x0 .. x0 + w - 1, y0 .. y0 + h - 1 (absolute output
 * pixels) of a view showing `scale` output pixels per frame pixel, from the shown values `img`,
 * with k × k grid points per output pixel, each reading the baked film at its frame position (in
 * radii): in a grain when the film's coverage under the shown value there (coverageFor) reaches
 * the texel's threshold. Returns the filtered coverage (grainChange turns it into the change in
 * the shown value). `level(i, j)` is the tile's texel (tileLevel for bakeParams(p); the tests pass
 * a cache). The GPU's passes compute the same in tiles.
 */
export function renderFilmGrain(img: ShownImage, x0: number, y0: number, w: number, h: number, scale: number, p: BoolGrainParams, tile: FilmTile, kind: FilmKind, level: (i: number, j: number) => number,
  share: (level: number, bi: number, bj: number, knot: number) => number = (L, bi, bj, j) => exactShare(level, L, bi, bj, j), plan = filmPlan(p, scale, tile)): Float32Array {
  const f = Math.fround, k = plan.k;
  const valueAt = (ox: number, oy: number) => {
    const ix = Math.min(Math.max(Math.floor(ox) - img.x0, 0), img.w - 1);
    const iy = Math.min(Math.max(Math.floor(oy) - img.y0, 0), img.h - 1);
    return img.data[iy * img.w + ix];
  };
  const filter = viewFilter(p.sigmaFilter, scale);
  const M = blurMargin(p.sigmaFilter, scale);
  const gw = (w + 2 * M) * k, gh = (h + 2 * M) * k;
  const gx0 = (x0 - M) * k, gy0 = (y0 - M) * k;
  const n = tile.side / 2 ** plan.level, wrapB = (v: number) => ((v % n) + n) % n;
  // The grid: point (i, j) at output position ((gx0 + i + 0.5) / k, (gy0 + j + 0.5) / k): covered
  // (1) or not, or for integrated cells the share of the cell's film covered.
  const grid = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const ox = f((gx0 + i + 0.5) / k), oy = f((gy0 + j + 0.5) / k);
    const qx = f(ox / scale) / p.radius, qy = f(oy / scale) / p.radius;
    const c = coverageFor(valueAt(ox, oy), kind);
    if (!plan.integrated) {
      const [ti, tj] = tileTexel(tile, p.seed, qx, qy);
      grid[j * gw + i] = reaches(c, level(ti, tj)) ? 1 : 0;
      continue;
    }
    // The cell's place on the tile (in texels, continuous), then its blocks, bilinearly.
    const [ox0, oy0] = blockOffset(tile, p.seed, Math.floor(qx / FILM_BLOCK), Math.floor(qy / FILM_BLOCK));
    const bu = (qx / tile.texel + ox0) / 2 ** plan.level - 0.5, bv = (qy / tile.texel + oy0) / 2 ** plan.level - 0.5;
    const bi = Math.floor(bu), bj = Math.floor(bv), fx = bu - bi, fy = bv - bj;
    const at = (di: number, dj: number) => blockShare(share, plan.level, wrapB(bi + di), wrapB(bj + dj), c);
    grid[j * gw + i] = (1 - fy) * ((1 - fx) * at(0, 0) + fx * at(1, 0)) + fy * ((1 - fx) * at(0, 1) + fx * at(1, 1));
  }
  // The filter along x, then y, normalized over the points within its reach.
  const along = (centre: number, start: number, count: number) => {
    const j0 = Math.max(0, Math.floor((centre - filter.reach - start) * k)), j1 = Math.min(count - 1, Math.ceil((centre + filter.reach - start) * k));
    const w8: number[] = [];
    for (let q = j0; q <= j1; q++) w8.push(filter.at(start + (q + 0.5) / k - centre));
    return { j0, w8, sum: w8.reduce((a, b) => a + b, 0) };
  };
  const mid = new Float32Array(w * gh);
  for (let x = 0; x < w; x++) {
    const { j0, w8, sum } = along(x0 + x + 0.5, x0 - M, gw);
    for (let j = 0; j < gh; j++) { let t = 0; for (let q = 0; q < w8.length; q++) t += w8[q] * grid[j * gw + j0 + q]; mid[j * w + x] = t / sum; }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const { j0, w8, sum } = along(y0 + y + 0.5, y0 - M, gh);
    for (let x = 0; x < w; x++) { let t = 0; for (let q = 0; q < w8.length; q++) t += w8[q] * mid[(j0 + q) * w + x]; out[y * w + x] = t / sum; }
  }
  return out;
}

/**
 * The filter's taps over the grid, normalized: tap q (lo to lo + w.length - 1) is grid point
 * (x + M) k + q for output pixel x, M its margin; the points renderFilmGrain's filter takes.
 */
export function filterTaps(k: number, sigma: number, scale: number): { lo: number; w: Float32Array } {
  const filter = viewFilter(sigma, scale);
  const lo = Math.floor((0.5 - filter.reach) * k), hi = Math.ceil((0.5 + filter.reach) * k);
  const w = Float32Array.from({ length: hi - lo + 1 }, (_, i) => filter.at((lo + i + 0.5) / k - 0.5));
  const sum = w.reduce((a, b) => a + b, 0);
  return { lo, w: w.map((x) => x / sum) };
}

/**
 * The filter's taps over whole output pixels: tap d (lo to lo + w.length - 1) sums the grid taps of
 * the points in pixel x + d. Over the photo's own coverage, which is one value a pixel, they give
 * exactly what the grid's taps give.
 */
export function pixelTaps(k: number, sigma: number, scale: number): { lo: number; w: Float32Array } {
  const t = filterTaps(k, sigma, scale);
  const lo = Math.floor(t.lo / k), hi = Math.floor((t.lo + t.w.length - 1) / k);
  const w = new Float32Array(hi - lo + 1);
  t.w.forEach((x, i) => { w[Math.floor((t.lo + i) / k) - lo] += x; });
  return { lo, w };
}
/** The render's expected value: the photo's own coverage at each output pixel, filtered (pixelTaps). */
export function meanCoverage(img: ShownImage, x0: number, y0: number, w: number, h: number, scale: number, p: BoolGrainParams, kind: FilmKind, plan = filmPlan(p, scale)): Float32Array {
  const t = pixelTaps(plan.k, p.sigmaFilter, scale);
  const at = (x: number, y: number) => coverageFor(img.data[Math.min(Math.max(y - img.y0, 0), img.h - 1) * img.w + Math.min(Math.max(x - img.x0, 0), img.w - 1)], kind);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let b = 0; b < t.w.length; b++) for (let a = 0; a < t.w.length; a++) sum += t.w[b] * t.w[a] * at(x0 + x + t.lo + a, y0 + y + t.lo + b);
    out[y * w + x] = sum;
  }
  return out;
}

/** The display luma the model reads, and whose change the grain is (Rec.709 weights, as sRGB's). */
export const shownLuma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
