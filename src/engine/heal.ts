// Copyright (C) 2017-2024 darktable developers.
// The equation and its boundary are darktable's src/common/heal.c at commit
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2), which is based on GIMP's healing tool
// by Jean-Yves Couleaud and follows T. Georgiev, "Photoshop Healing Brush: a Tool for Seamless
// Cloning" (and P. Pérez, M. Gangnet, A. Blake, "Poisson Image Editing", SIGGRAPH 2003): the
// destination becomes the source plus a membrane that equals dest − source on the unmasked pixels
// and is harmonic on the masked ones, with no flow across the rectangle's edges (but the right
// edge of an odd width, which darktable's red/black layout holds at zero difference).
//
// Deviation, agreed with Oli (2026-11-16, #31): darktable solves it with red/black SOR, at most
// max_heal_iter (2000) sweeps. The sweeps needed grow with the spot's size, so a GFX100 brush
// stroke at full size (1.7 MP of mask) took 28 s and still stopped unconverged. `heal` solves the
// same equations to convergence with conjugate gradients preconditioned by a geometric multigrid
// V-cycle (red/black Gauss–Seidel smoothing, bilinear transfers, a coarse cell solved only where
// all its children are), after W. Briggs, V. E. Henson, S. McCormick, "A Multigrid Tutorial"
// (SIAM 2000), O. Tatebe, "The multigrid preconditioned conjugate gradient method" (1993) and
// A. McAdams, E. Sifakis, J. Teran, "A parallel multigrid Poisson solver for fluids simulation on
// large grids" (SCA 2010), with coarse weights at the mask's edge after Gibou et al. (2002). Where
// darktable's SOR meets its own stop, the pixels agree with it within that stop's error (< 1e-3,
// tested); on large spots Emulsion's are the converged result darktable's falls short of.
// `darktableHeal` keeps darktable's solver, translated from C keeping its red/black layout, run
// encoding, over-relaxation factor and early stop, as the reference the tests check against.
// Both run on the CPU, as darktable's own OpenCL path does (dt_heal_cl reads the buffers back).
// The multigrid also runs as tools/heal-wasm/kernel.rs when its compiled kernel is ready; tests
// require identical pixels and steps to this TS fallback.
// SPDX-License-Identifier: GPL-3.0-or-later

import { compiledHeal } from './healkernel';

/** darktable's default for retouch's max_heal_iter. */
export const MAX_HEAL_ITER = 2000;

// The difference image split into 'red' and 'black' checkerboard cells, each row padded above and
// below by a zero row: darktable's _heal_sub.
function sub(top: Float32Array, bottom: Float32Array, red: Float32Array, black: Float32Array, width: number, height: number) {
  const stride = 4 * ((width + 1) >> 1);
  for (let row = 0; row < height; row++) {
    const start = (row + 1) * stride;
    const [b1, b2] = row & 1 ? [red, black] : [black, red];
    for (let col = 0; col < width >> 1; col++) {
      const idx = 4 * (row * width + 2 * col);
      for (let c = 0; c < 4; c++) {
        b1[start + 4 * col + c] = top[idx + c] - bottom[idx + c];
        b2[start + 4 * col + c] = top[idx + 4 + c] - bottom[idx + 4 + c];
      }
    }
    if (width & 1) {
      const r = (width - 1) >> 1;
      const idx = 4 * (row * width + width - 1);
      for (let c = 0; c < 4; c++) {
        b1[start + 4 * r + c] = top[idx + c] - bottom[idx + c];
        b2[start + 4 * r + c] = 0;
      }
    }
  }
  // The padding rows (Float32Array starts at zero; cleared as darktable does in case of reuse).
  red.fill(0, 0, stride); red.fill(0, (height + 1) * stride, (height + 2) * stride);
  black.fill(0, 0, stride); black.fill(0, (height + 1) * stride, (height + 2) * stride);
}

// The solution added back to `second`, re-interleaved: darktable's _heal_add.
function add(red: Float32Array, black: Float32Array, second: Float32Array, out: Float32Array, width: number, height: number) {
  const stride = 4 * ((width + 1) >> 1);
  for (let row = 0; row < height; row++) {
    const start = (row + 1) * stride;
    const [b1, b2] = row & 1 ? [red, black] : [black, red];
    for (let col = 0; col < width >> 1; col++) {
      const idx = 4 * (row * width + 2 * col);
      for (let c = 0; c < 4; c++) {
        out[idx + c] = b1[start + 4 * col + c] + second[idx + c];
        out[idx + 4 + c] = b2[start + 4 * col + c] + second[idx + 4 + c];
      }
    }
    if (width & 1) {
      const r = (width - 1) >> 1;
      const idx = 4 * (row * width + width - 1);
      for (let c = 0; c < 4; c++) out[idx + c] = b1[start + 4 * r + c] + second[idx + c];
    }
  }
}

// One Gauss-Seidel sweep over the cells of one colour; returns the summed squared change of RGB.
// darktable's _heal_laplace_iteration. `width` is the half-width of a colour plane. The four
// channels are written out by hand (darktable's for_each_channel), in darktable's order, so each
// value is computed exactly as before; every intermediate is rounded to a float, as in C.
function iteration(active: Float32Array, neighbor: Float32Array, height: number, width: number, runs: Uint32Array, nruns: number, start: number, w: number): number {
  let e0 = 0, e1 = 0, e2 = 0;
  const vert = 4 * width;
  const f = Math.fround;
  for (let i = 0; i < nruns; i++) {
    const idx = runs[2 * i];
    const count = runs[2 * i + 1];
    const index = 4 * idx;
    const row = (idx / width) | 0;
    let a = 4;
    if (row === 1) a -= 1;
    if (row === height) a -= 1;
    const lr = 4 * (start ^ (row & 1));
    if (count === 1) {
      const col = idx % width;
      let aa = a;
      let l0 = 0, l1 = 0, l2 = 0, l3 = 0, r0 = 0, r1 = 0, r2 = 0, r3 = 0;
      if (col > 0 || lr) { const k = index - 4 + lr; l0 = neighbor[k]; l1 = neighbor[k + 1]; l2 = neighbor[k + 2]; l3 = neighbor[k + 3]; } else aa -= 1;
      if (col + 1 < width || lr === 0) { const k = index + lr; r0 = neighbor[k]; r1 = neighbor[k + 1]; r2 = neighbor[k + 2]; r3 = neighbor[k + 3]; } else aa -= 1;
      const u = index - vert, d = index + vert;
      const d0 = f(w * f(f(aa * active[index]) - f(f(f(neighbor[u] + neighbor[d]) + l0) + r0)));
      const d1 = f(w * f(f(aa * active[index + 1]) - f(f(f(neighbor[u + 1] + neighbor[d + 1]) + l1) + r1)));
      const d2 = f(w * f(f(aa * active[index + 2]) - f(f(f(neighbor[u + 2] + neighbor[d + 2]) + l2) + r2)));
      const d3 = f(w * f(f(aa * active[index + 3]) - f(f(f(neighbor[u + 3] + neighbor[d + 3]) + l3) + r3)));
      active[index] -= d0; active[index + 1] -= d1; active[index + 2] -= d2; active[index + 3] -= d3;
      e0 += d0 * d0; e1 += d1 * d1; e2 += d2 * d2;
      continue;
    }
    let k = index - 4 + lr;
    let l0 = neighbor[k], l1 = neighbor[k + 1], l2 = neighbor[k + 2], l3 = neighbor[k + 3];
    for (let j = 0; j < count; j++) {
      const p = index + 4 * j;
      k = p + lr;
      const r0 = neighbor[k], r1 = neighbor[k + 1], r2 = neighbor[k + 2], r3 = neighbor[k + 3];
      const u = p - vert, d = p + vert;
      const d0 = f(w * f(f(a * active[p]) - f(f(f(neighbor[u] + neighbor[d]) + l0) + r0)));
      const d1 = f(w * f(f(a * active[p + 1]) - f(f(f(neighbor[u + 1] + neighbor[d + 1]) + l1) + r1)));
      const d2 = f(w * f(f(a * active[p + 2]) - f(f(f(neighbor[u + 2] + neighbor[d + 2]) + l2) + r2)));
      const d3 = f(w * f(f(a * active[p + 3]) - f(f(f(neighbor[u + 3] + neighbor[d + 3]) + l3) + r3)));
      active[p] -= d0; active[p + 1] -= d1; active[p + 2] -= d2; active[p + 3] -= d3;
      e0 += d0 * d0; e1 += d1 * d1; e2 += d2 * d2;
      l0 = r0; l1 = r1; l2 = r2; l3 = r3;
    }
  }
  return e0 + e1 + e2;
}

// One row's cells of one colour as runs (start, count) of masked cells: darktable's
// _collect_color_runs, with its special cases for the first cell and a run ending at the edge.
function colorRuns(mask: Float32Array, rowStart: number, startIndex: number, start: number, width: number, runs: number[]): number {
  let masked = 0;
  if (start === 0 && mask[rowStart]) {
    runs.push(startIndex, 1);
    masked++;
    start += 2;
  }
  let inRun = false;
  let runStart = 0;
  let col: number;
  for (col = start; col < width; col += 2) {
    if (mask[rowStart + col]) {
      masked++;
      if (!inRun) { runStart = col; inRun = true; }
    } else if (inRun) {
      runs.push(startIndex + (runStart >> 1), (col - runStart) >> 1);
      inRun = false;
    }
  }
  if (inRun) {
    const first = startIndex + (runStart >> 1);
    const len = (col - runStart) >> 1;
    if (len > 1 && col > width) runs.push(first, len - 1, first + len - 1, 1);
    else runs.push(first, len);
  }
  return masked;
}

function collectRuns(start: number, mask: Float32Array, width: number, height: number, subwidth: number, runs: number[]): number {
  let masked = 0;
  for (let row = 0; row < height; row++) {
    const parity = start ^ (row & 1);
    masked += colorRuns(mask, row * width, (row + 1) * subwidth, parity, width, runs);
  }
  return masked;
}

/** darktable's _heal_laplace_loop: red/black SOR until the change is under 0.1/255, at most `maxIter` sweeps. Returns the sweeps run. */
function laplace(red: Float32Array, black: Float32Array, width: number, height: number, mask: Float32Array, maxIter: number): number {
  const subwidth = (width + 1) >> 1;
  const redList: number[] = [];
  const blackList: number[] = [];
  const nmask = collectRuns(1, mask, width, height, subwidth, redList) + collectRuns(0, mask, width, height, subwidth, blackList);
  const redRuns = Uint32Array.from(redList), blackRuns = Uint32Array.from(blackList);
  // darktable: "Empirically optimal over-relaxation factor."
  const w = Math.fround((2 - 1 / (0.1575 * Math.sqrt(nmask) + 0.8)) * 0.25);
  const epsilon = Math.fround(0.1 / 255);
  const exit = Math.fround(epsilon * epsilon * w * w);
  for (let iter = 0; iter < maxIter; iter++) {
    let err = iteration(black, red, height, subwidth, blackRuns, blackRuns.length >> 1, 1, w);
    err += iteration(red, black, height, subwidth, redRuns, redRuns.length >> 1, 0, w);
    if (err < exit) return iter + 1;
  }
  return maxIter;
}


/**
 * darktable's dt_heal, with its own SOR solver: `dest` (RGBA, width × height) becomes `src` plus
 * the membrane that matches dest − src on the unmasked pixels and is harmonic where `mask` is
 * non-zero. Returns the sweeps run. The reference for `heal`.
 */
export function darktableHeal(src: Float32Array, dest: Float32Array, mask: Float32Array, width: number, height: number, maxIter = MAX_HEAL_ITER): number {
  const subwidth = 4 * ((width + 1) >> 1);
  const red = new Float32Array(subwidth * (height + 2));
  const black = new Float32Array(subwidth * (height + 2));
  sub(dest, src, red, black, width, height);
  const sweeps = laplace(red, black, width, height, mask, maxIter);
  add(red, black, src, dest, width, height);
  return sweeps;
}

// ---- Multigrid ----
//
// Every level is a grid of cells, padded by one cell of zeros on each side (stride w + 2), with
// four floats (RGBA) per cell. A cell is unknown (1) or fixed (0). The equation at an unknown
// cell p is d(p)·u(p) − Σ u(q) = b(p), the sum over its unknown neighbours inside the rectangle.
// On the photo's level d(p) counts its neighbours inside the rectangle and b(p) sums the fixed
// ones' D = dest − src; the rectangle's own edge has no neighbour, so no flow, as in darktable's
// laplace loop (except the right edge of an odd width, which its layout holds at zero: `edges`). Coarse levels hold corrections, which are 0 at fixed cells. A coarse cell is
// unknown only where all its children are, which pulls the edge of the masked area inward on
// every level; its weight toward a fixed neighbour instead follows the distance to the photo's
// fixed pixels (F. Gibou, R. Fedkiw, L.-T. Cheng, M. Kang, "A second-order-accurate symmetric
// discretization of the Poisson equation on irregular domains", 2002), and cells whose
// interpolation reads a fixed coarse cell get extra sweeps (McAdams et al.'s boundary
// smoothing). The arithmetic is in floats, as darktable's, in a fixed order the compiled kernel
// repeats exactly with four channels to a SIMD vector; only the dot products are summed in doubles.

/** The solve stops once a step changes no pixel by more than this (linear light). */
export const HEAL_TOLERANCE = 1e-5;
/** A ceiling the solve never reaches in practice (it converges in about eight). */
export const MAX_HEAL_STEPS = 200;
/** Coarsening stops at a level with this few unknowns, which is solved by sweeps alone. */
const COARSEST = 16;
const COARSEST_SWEEPS = 8;
/** Extra red/black sweep pairs over the boundary band, on each side of the coarse correction. */
const BAND_SWEEPS = 2;

export interface HealLevel {
  w: number;
  h: number;
  /** 1 at unknown cells, padded. */
  unknown: Uint8Array;
  count: number;
  /** d(p) at unknown cells, padded. */
  diag: Float32Array;
  /**
   * The unknown cells whose interpolation from the next level reads a fixed cell (none on the
   * coarsest), as padded cell indices: the red ones ((x + y) even) in row order, then the black.
   */
  band: Int32Array;
  /** How many of `band` are red. */
  bandRed: number;
}

/**
 * d(p) on the photo's level: its neighbours inside the rectangle, plus, at the right edge of an
 * odd-width rectangle, the zero padding cell darktable's red/black layout puts there (its
 * laplace loop counts it, so that edge is held at zero difference rather than letting nothing
 * flow; our padding is zero too).
 */
function edges(w: number, h: number): Float32Array {
  const d = new Float32Array((w + 2) * (h + 2));
  const right = w & 1 ? 0 : 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[(y + 1) * (w + 2) + x + 1] = 4 - (y === 0 ? 1 : 0) - (y === h - 1 ? 1 : 0) - (x === 0 ? 1 : 0) - (x === w - 1 ? right : 0);
  return d;
}

/**
 * The weights of coarse level l (spacing H = 2^l photo pixels): 1 toward an unknown neighbour
 * and, toward a fixed one, H over the distance from the cell's centre to the first fixed photo
 * pixel's centre beyond it, averaged over the block's rows (or columns); a row with none within
 * 4H adds nothing.
 */
function ghostDiag(F: HealLevel, C: HealLevel, l: number) {
  const H = 1 << l, fs = F.w + 2, cs = C.w + 2, cap = 4 * H, odd = F.w & 1;
  const reach = (x: number, y: number, dx: number, dy: number, from: number): number => {
    for (let k = 0; k < cap; k++, x += dx, y += dy) {
      // An odd-width rectangle's right edge is held at zero, like a fixed column at x = w.
      if (odd && x === F.w) return H / Math.abs(x + 0.5 - from);
      if (x < 0 || y < 0 || x >= F.w || y >= F.h) return 0;
      if (!F.unknown[(y + 1) * fs + x + 1]) return H / Math.abs((dx ? x : y) + 0.5 - from);
    }
    return 0;
  };
  for (let J = 0; J < C.h; J++) for (let I = 0; I < C.w; I++) {
    const P = (J + 1) * cs + I + 1;
    if (!C.unknown[P]) continue;
    const x0 = H * I, x1 = Math.min(H * (I + 1), F.w), y0 = H * J, y1 = Math.min(H * (J + 1), F.h);
    const cx = H * (I + 0.5), cy = H * (J + 0.5);
    let d = 0;
    for (const dir of [-1, 1]) {
      if (I + dir >= 0 && (I + dir < C.w || (odd && dir > 0))) {
        if (I + dir < C.w && C.unknown[P + dir]) d += 1;
        else {
          let g = 0;
          for (let y = y0; y < y1; y++) g += reach(dir > 0 ? x1 : x0 - 1, y, dir, 0, cx);
          d += g / (y1 - y0);
        }
      }
      if (J + dir >= 0 && J + dir < C.h) {
        if (C.unknown[P + dir * cs]) d += 1;
        else {
          let g = 0;
          for (let x = x0; x < x1; x++) g += reach(x, dir > 0 ? y1 : y0 - 1, 0, dir, cy);
          d += g / (x1 - x0);
        }
      }
    }
    C.diag[P] = d;
  }
}

/** The levels, finest first. */
export function healLevels(mask: Float32Array, w: number, h: number): HealLevel[] {
  const s = w + 2;
  const unknown = new Uint8Array(s * (h + 2));
  let count = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { unknown[(y + 1) * s + x + 1] = 1; count++; }
  const levels: HealLevel[] = [{ w, h, unknown, count, diag: edges(w, h), band: new Int32Array(0), bandRed: 0 }];
  for (;;) {
    const f = levels[levels.length - 1];
    if (f.count <= COARSEST || (f.w <= 2 && f.h <= 2)) break;
    const cw = (f.w + 1) >> 1, ch = (f.h + 1) >> 1, fs = f.w + 2, cs = cw + 2;
    const cu = new Uint8Array(cs * (ch + 2));
    let n = 0;
    for (let J = 0; J < ch; J++) for (let I = 0; I < cw; I++) {
      let all = 1;
      for (let y = 2 * J; y < Math.min(2 * J + 2, f.h); y++) for (let x = 2 * I; x < Math.min(2 * I + 2, f.w); x++) all &= f.unknown[(y + 1) * fs + x + 1];
      if (all) { cu[(J + 1) * cs + I + 1] = 1; n++; }
    }
    if (!n) break;
    const colours: number[][] = [[], []];
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const p = (y + 1) * fs + x + 1;
      if (!f.unknown[p]) continue;
      const J = (y >> 1) + 1, J2 = across(y, ch) + 1, I = (x >> 1) + 1, I2 = across(x, cw) + 1;
      if (!cu[J * cs + I] || !cu[J * cs + I2] || !cu[J2 * cs + I] || !cu[J2 * cs + I2]) colours[(x + y) & 1].push(p);
    }
    f.band = Int32Array.from([...colours[0], ...colours[1]]);
    f.bandRed = colours[0].length;
    const C: HealLevel = { w: cw, h: ch, unknown: cu, count: n, diag: new Float32Array(cs * (ch + 2)), band: new Int32Array(0), bandRed: 0 };
    ghostDiag(levels[0], C, levels.length);
    levels.push(C);
  }
  return levels;
}

/** The Gauss–Seidel update of cell p. */
function relax(e: Float32Array, r: Float32Array, diag: Float32Array, v: number, p: number) {
  const n = diag[p], i = 4 * p;
  e[i] = f(f(f(f(f(r[i] + e[i - v]) + e[i - 4]) + e[i + 4]) + e[i + v]) / n);
  e[i + 1] = f(f(f(f(f(r[i + 1] + e[i + 1 - v]) + e[i - 3]) + e[i + 5]) + e[i + 1 + v]) / n);
  e[i + 2] = f(f(f(f(f(r[i + 2] + e[i + 2 - v]) + e[i - 2]) + e[i + 6]) + e[i + 2 + v]) / n);
  e[i + 3] = f(f(f(f(f(r[i + 3] + e[i + 3 - v]) + e[i - 1]) + e[i + 7]) + e[i + 3 + v]) / n);
}

/** One Gauss–Seidel sweep over the unknown cells of one colour ((x + y) % 2 === colour). */
function smooth(L: HealLevel, e: Float32Array, r: Float32Array, colour: number) {
  const { w, h, unknown, diag } = L, s = w + 2, v = 4 * s;
  for (let y = 0; y < h; y++) for (let x = (y + colour) & 1; x < w; x += 2) {
    const p = (y + 1) * s + x + 1;
    if (unknown[p]) relax(e, r, diag, v, p);
  }
}

/** One sweep over the band's cells of one colour. */
function smoothBand(L: HealLevel, e: Float32Array, r: Float32Array, colour: number) {
  const { band, bandRed, diag } = L, v = 4 * (L.w + 2);
  const end = colour ? band.length : bandRed;
  for (let j = colour ? bandRed : 0; j < end; j++) relax(e, r, diag, v, band[j]);
}

/** out = A e at the unknown cells, or r − A e with `r`. Returns Σ e·(A e) per channel into `dots` when given. */
function apply(L: HealLevel, e: Float32Array, out: Float32Array, r: Float32Array | null, dots: Float64Array | null) {
  const { w, h, unknown, diag } = L, s = w + 2, v = 4 * s;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y + 1) * s + x + 1;
    if (!unknown[p]) continue;
    const n = diag[p], i = 4 * p;
    const a0 = f(f(n * e[i]) - f(f(f(e[i - v] + e[i - 4]) + e[i + 4]) + e[i + v]));
    const a1 = f(f(n * e[i + 1]) - f(f(f(e[i + 1 - v] + e[i - 3]) + e[i + 5]) + e[i + 1 + v]));
    const a2 = f(f(n * e[i + 2]) - f(f(f(e[i + 2 - v] + e[i - 2]) + e[i + 6]) + e[i + 2 + v]));
    const a3 = f(f(n * e[i + 3]) - f(f(f(e[i + 3 - v] + e[i - 1]) + e[i + 7]) + e[i + 3 + v]));
    if (r) { out[i] = r[i] - a0; out[i + 1] = r[i + 1] - a1; out[i + 2] = r[i + 2] - a2; out[i + 3] = r[i + 3] - a3; }
    else {
      out[i] = a0; out[i + 1] = a1; out[i + 2] = a2; out[i + 3] = a3;
      s0 += e[i] * out[i]; s1 += e[i + 1] * out[i + 1]; s2 += e[i + 2] * out[i + 2]; s3 += e[i + 3] * out[i + 3];
    }
  }
  if (dots) { dots[0] = s0; dots[1] = s1; dots[2] = s2; dots[3] = s3; }
}

// Bilinear between cell centres: fine cell x lies between coarse cells x >> 1 (weight 3/4) and
// the next one on its side (1/4), or wholly in x >> 1 at the edge. Restriction is the exact
// transpose of prolongation, which keeps the V-cycle symmetric, as conjugate gradients needs.
const NEAR = 0.5625, SIDE = 0.1875, FAR = 0.0625;
const f = Math.fround;
function across(i: number, n: number): number {
  const I = i >> 1, J = i & 1 ? I + 1 : I - 1;
  return J < 0 || J >= n ? I : J;
}

/** C's right-hand side: the transpose of `prolong` applied to F's residual. */
function restrict(F: HealLevel, t: Float32Array, C: HealLevel, rc: Float32Array) {
  rc.fill(0);
  const fs = F.w + 2, cs = C.w + 2;
  for (let y = 0; y < F.h; y++) {
    const J = (y >> 1) + 1, J2 = across(y, C.h) + 1;
    for (let x = 0; x < F.w; x++) {
      const p = (y + 1) * fs + x + 1;
      if (!F.unknown[p]) continue;
      const I = (x >> 1) + 1, I2 = across(x, C.w) + 1;
      const a = 4 * (J * cs + I), b = 4 * (J * cs + I2), c = 4 * (J2 * cs + I), d = 4 * (J2 * cs + I2), i = 4 * p;
      for (let k = 0; k < 4; k++) {
        const val = t[i + k];
        rc[a + k] += f(NEAR * val); rc[b + k] += f(SIDE * val); rc[c + k] += f(SIDE * val); rc[d + k] += f(FAR * val);
      }
    }
  }
}

/** e += the coarse correction, at F's unknown cells (C's fixed cells hold 0). */
function prolong(C: HealLevel, ec: Float32Array, F: HealLevel, e: Float32Array) {
  const fs = F.w + 2, cs = C.w + 2;
  for (let y = 0; y < F.h; y++) {
    const J = (y >> 1) + 1, J2 = across(y, C.h) + 1;
    for (let x = 0; x < F.w; x++) {
      const p = (y + 1) * fs + x + 1;
      if (!F.unknown[p]) continue;
      const I = (x >> 1) + 1, I2 = across(x, C.w) + 1;
      const a = 4 * (J * cs + I), b = 4 * (J * cs + I2), c = 4 * (J2 * cs + I), d = 4 * (J2 * cs + I2), i = 4 * p;
      for (let k = 0; k < 4; k++) e[i + k] += f(f(f(f(NEAR * ec[a + k]) + f(SIDE * ec[b + k])) + f(SIDE * ec[c + k])) + f(FAR * ec[d + k]));
    }
  }
}

interface Work { e: Float32Array; r: Float32Array; t: Float32Array }

/**
 * e ≈ A⁻¹ r on level l: one V-cycle from zero. Going down: red then black, then the band; coming
 * up the same in reverse, so the cycle is a symmetric operator.
 */
function vcycle(levels: HealLevel[], work: Work[], l: number) {
  const L = levels[l], { e, r, t } = work[l];
  e.fill(0);
  if (l === levels.length - 1) {
    smooth(L, e, r, 0);
    for (let k = 0; k < COARSEST_SWEEPS; k++) { smooth(L, e, r, 1); smooth(L, e, r, 0); }
    return;
  }
  smooth(L, e, r, 0); smooth(L, e, r, 1);
  for (let k = 0; k < BAND_SWEEPS; k++) { smoothBand(L, e, r, 0); smoothBand(L, e, r, 1); }
  apply(L, e, t, r, null);
  const C = levels[l + 1];
  restrict(L, t, C, work[l + 1].r);
  vcycle(levels, work, l + 1);
  prolong(C, work[l + 1].e, L, e);
  for (let k = 0; k < BAND_SWEEPS; k++) { smoothBand(L, e, r, 1); smoothBand(L, e, r, 0); }
  smooth(L, e, r, 1); smooth(L, e, r, 0);
}

/** Per-channel sums of a·b over the unknown cells. */
function dot(L: HealLevel, a: Float32Array, b: Float32Array, out: Float64Array) {
  const { w, h, unknown } = L, s = w + 2;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y + 1) * s + x + 1;
    if (!unknown[p]) continue;
    const i = 4 * p;
    s0 += a[i] * b[i]; s1 += a[i + 1] * b[i + 1]; s2 += a[i + 2] * b[i + 2]; s3 += a[i + 3] * b[i + 3];
  }
  out[0] = s0; out[1] = s1; out[2] = s2; out[3] = s3;
}

/** Padded float vectors for every level: level 0's correction, right-hand side and scratch, then each coarse level's. */
function healWork(levels: HealLevel[]): Work[] {
  return levels.map(({ w, h }) => {
    const n = 4 * (w + 2) * (h + 2);
    return { e: new Float32Array(n), r: new Float32Array(n), t: new Float32Array(n) };
  });
}

/**
 * Conjugate gradients on level 0 for A x = b (b in work[0].r, overwritten by the residual),
 * preconditioned by the V-cycle; `p` is a padded scratch vector. Returns the steps taken. The
 * TS solver, which the compiled kernel repeats exactly.
 */
function healSolve(levels: HealLevel[], work: Work[], x: Float32Array, p: Float32Array, tolerance: number): number {
  const L = levels[0], { w, h, unknown } = L, s = w + 2;
  const { e: z, r, t: q } = work[0];
  vcycle(levels, work, 0);
  p.set(z);
  const rz = new Float64Array(4), pq = new Float64Array(4), alpha = new Float64Array(4), beta = new Float64Array(4);
  dot(L, r, z, rz);
  let steps = 0;
  while (steps < MAX_HEAL_STEPS) {
    steps++;
    apply(L, p, q, null, pq);
    for (let k = 0; k < 4; k++) alpha[k] = f(pq[k] > 0 ? rz[k] / pq[k] : 0);
    let big = 0;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const c = (yy + 1) * s + xx + 1;
      if (!unknown[c]) continue;
      const i = 4 * c;
      for (let k = 0; k < 4; k++) {
        const d = f(alpha[k] * p[i + k]);
        x[i + k] += d;
        r[i + k] -= f(alpha[k] * q[i + k]);
        big = Math.max(big, Math.abs(d));
      }
    }
    if (big <= tolerance) break;
    vcycle(levels, work, 0);
    dot(L, r, z, pq);
    for (let k = 0; k < 4; k++) { beta[k] = f(rz[k] > 0 ? pq[k] / rz[k] : 0); rz[k] = pq[k]; }
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const c = (yy + 1) * s + xx + 1;
      if (!unknown[c]) continue;
      const i = 4 * c;
      for (let k = 0; k < 4; k++) p[i + k] = z[i + k] + f(beta[k] * p[i + k]);
    }
  }
  return steps;
}

/**
 * darktable's dt_heal solved to convergence: `dest` (RGBA, width × height) becomes `src` plus the
 * membrane that matches dest − src on the unmasked pixels and is harmonic where `mask` is
 * non-zero. Returns the conjugate gradient steps taken.
 */
export function heal(src: Float32Array, dest: Float32Array, mask: Float32Array, width: number, height: number, tolerance = HEAL_TOLERANCE): number {
  const levels = healLevels(mask, width, height);
  const L = levels[0], { unknown } = L, s = width + 2, v = 4 * s;
  if (!L.count) return 0;
  if (L.count === width * height) {
    // Nothing holds the membrane: with no flow across the edges it settles to a constant.
    const mean = [0, 0, 0, 0];
    for (let c = 0; c < 4 * width * height; c++) mean[c & 3] += Math.fround(dest[c] - src[c]);
    for (let c = 0; c < 4 * width * height; c++) dest[c] = src[c] + mean[c & 3] / (width * height);
    return 0;
  }
  // The right-hand side: the fixed neighbours' D (held in x for a moment).
  const n4 = 4 * s * (height + 2);
  const x = new Float32Array(n4), b = new Float32Array(n4);
  for (let y = 0; y < height; y++) for (let xx = 0; xx < width; xx++) {
    const c = (y + 1) * s + xx + 1;
    if (unknown[c]) continue;
    const i = 4 * (y * width + xx);
    for (let k = 0; k < 4; k++) x[4 * c + k] = dest[i + k] - src[i + k];
  }
  for (let y = 0; y < height; y++) for (let xx = 0; xx < width; xx++) {
    const c = (y + 1) * s + xx + 1;
    if (!unknown[c]) continue;
    const i = 4 * c;
    for (let k = 0; k < 4; k++) b[i + k] = ((x[i + k - v] + x[i + k - 4]) + x[i + k + 4]) + x[i + k + v];
  }
  x.fill(0);
  let steps = compiledHeal(levels, b, x, tolerance, { maxSteps: MAX_HEAL_STEPS, coarsestSweeps: COARSEST_SWEEPS, bandSweeps: BAND_SWEEPS });
  if (steps === null) {
    const work = healWork(levels);
    work[0].r = b;
    steps = healSolve(levels, work, x, new Float32Array(n4), tolerance);
  }
  for (let y = 0; y < height; y++) for (let xx = 0; xx < width; xx++) {
    const c = (y + 1) * s + xx + 1;
    if (!unknown[c]) continue;
    const i = 4 * (y * width + xx);
    for (let k = 0; k < 4; k++) dest[i + k] = src[i + k] + x[4 * c + k];
  }
  return steps;
}
