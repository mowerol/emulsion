// Copyright (C) 2017-2024 darktable developers.
// Ported from darktable src/common/heal.c at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773
// (release 5.6.2), which is based on GIMP's healing tool by Jean-Yves Couleaud and follows
// T. Georgiev, "Photoshop Healing Brush: a Tool for Seamless Cloning". Translated from C to
// TypeScript, keeping darktable's red/black layout, run encoding, over-relaxation factor and
// early stop, so the iterations happen in the same order. It runs on the CPU, as darktable's own
// OpenCL path does (dt_heal_cl reads the buffers back and calls dt_heal). Sums are in doubles
// where darktable's are in floats, so the stop can fall one iteration apart.
// SPDX-License-Identifier: GPL-3.0-or-later

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
 * darktable's dt_heal: `dest` (RGBA, width × height) becomes `src` plus the membrane that matches
 * dest − src on the unmasked pixels and is harmonic where `mask` is non-zero. Returns the sweeps run.
 */
export function heal(src: Float32Array, dest: Float32Array, mask: Float32Array, width: number, height: number, maxIter = MAX_HEAL_ITER): number {
  const subwidth = 4 * ((width + 1) >> 1);
  const red = new Float32Array(subwidth * (height + 2));
  const black = new Float32Array(subwidth * (height + 2));
  sub(dest, src, red, black, width, height);
  const sweeps = laplace(red, black, width, height, mask, maxIter);
  add(red, black, src, dest, width, height);
  return sweeps;
}
