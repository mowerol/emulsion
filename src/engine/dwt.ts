// Copyright (C) 2017-2026 darktable developers.
// Ported from darktable src/common/dwt.c (_get_max_scale, dwt_decompose_vert, dwt_decompose_horiz,
// dwt_wavelet_decompose, dwt_decompose) at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773
// (release 5.6.2), itself based on GIMP's Wavelet Decompose plugin by Marco Rossini. Translated
// from C to TypeScript.
//
// darktable's two paths differ at a reduced preview, and this follows the OpenCL one: the hat's
// step at level `lev` is (1 << lev) × preview scale, as in dwt_wavelet_decompose_cl. The CPU path
// uses 1 << lev whatever the preview scale. They agree at full size (scale 1, exports and 1:1),
// and the scaled step keeps a reduced preview's scales covering the same detail as the export's.
// SPDX-License-Identifier: GPL-3.0-or-later

/** Called on each layer: 0 the image, 1 to n the detail scales, n + 1 the residual, n + 2 the sum. */
export type LayerFunc = (layer: Float32Array, scale: number) => void;

export interface DwtParams {
  /** RGBA floats, width × height, decomposed and rebuilt in place. */
  image: Float32Array;
  width: number;
  height: number;
  /** The number of detail scales. */
  scales: number;
  /** 0 to rebuild the image; a scale to leave that layer in `image` instead (darktable's preview of one scale). */
  returnLayer: number;
  /** Scales from this one up are added together before their forms run; 0 for none. */
  mergeFromScale: number;
  /** The image's scale over the full size. */
  previewScale: number;
  /**
   * The full image's size in full-size pixels, for the most scales that fit. darktable measures
   * the region it is given (its whole image when exporting); Emulsion decomposes only around the
   * spots, so it passes the photo's size to get the export's count.
   */
  fullWidth?: number;
  fullHeight?: number;
}

/** _get_max_scale: how many scales fit an image of width × height full-size pixels at `previewScale`. */
export function maxScale(width: number, height: number, previewScale: number): number {
  const f = Math.fround;
  let maxscale = 0;
  let size = Math.min(width, height) >>> 0;
  size >>>= 1;
  let sizeTmp = f(size * previewScale);
  while (sizeTmp > 0) {
    size >>>= 1;
    sizeTmp = f(size * previewScale);
    maxscale++;
  }
  size = Math.min(width, height);
  while (maxscale > 0 && f((1 << maxscale) * previewScale) >= size) maxscale--;
  return maxscale;
}

/** The hat's step at level `lev`, capped as darktable caps it. */
export function hatStep(lev: number, previewScale: number, size: number): number {
  return Math.min(Math.trunc(Math.fround((1 << lev) * previewScale)), size - 1);
}

/** How far (in pixels) a layer up to `scales` reaches: the steps of the levels below it added up. */
export function dwtReach(scales: number, previewScale: number): number {
  let r = 0;
  for (let lev = 0; lev < scales; lev++) r += Math.trunc(Math.fround((1 << lev) * previewScale));
  return r;
}

/** dwt_decompose_vert: out = 2·centre + above + below, the rows `vscale` away (reflected at the edges). */
function decomposeVert(out: Float32Array, input: Float32Array, height: number, width: number, vscale: number) {
  const f = Math.fround;
  for (let row = 0; row < height; row++) {
    const above = row > vscale ? row - vscale : vscale - row;
    const below = row + vscale < height ? row + vscale : 2 * (height - 1) - (row + vscale);
    const c = 4 * row * width, a = 4 * above * width, b = 4 * below * width;
    for (let i = 0; i < 4 * width; i++) out[c + i] = f(f(f(2 * input[c + i]) + input[a + i]) + input[b + i]);
  }
}

/** dwt_decompose_horiz: the same across, over 16; `out` becomes the coarse layer, `input` keeps the detail. */
function decomposeHoriz(out: Float32Array, input: Float32Array, temp: Float32Array, height: number, width: number, hscale: number) {
  const f = Math.fround;
  for (let row = 0; row < height; row++) {
    const ri = 4 * row * width;
    for (let col = 0; col < width; col++) {
      const leftpos = 4 * Math.abs(col - hscale);
      const rightpos = 4 * (col < width - hscale ? col + hscale : 2 * width - 2 - (col + hscale));
      for (let c = 0; c < 4; c++) {
        const hat = f(f(f(f(2 * out[ri + 4 * col + c]) + out[ri + leftpos + c]) + out[ri + rightpos + c]) / 16);
        temp[4 * col + c] = hat;
        input[ri + 4 * col + c] = f(input[ri + 4 * col + c] - hat);
      }
    }
    out.set(temp.subarray(0, 4 * width), ri);
  }
}

const addInto = (dest: Float32Array, src: Float32Array) => { for (let i = 0; i < dest.length; i++) dest[i] = Math.fround(dest[i] + src[i]); };

/** dwt_decompose and dwt_wavelet_decompose: the forms of each layer run through `layerFunc`, then the image is rebuilt. */
export function dwtDecompose(p: DwtParams, layerFunc?: LayerFunc) {
  if (p.previewScale <= 0) p.previewScale = 1;
  if (p.returnLayer > p.scales + 1) p.returnLayer = p.scales + 1;
  const max = maxScale(p.fullWidth ?? p.width / p.previewScale, p.fullHeight ?? p.height / p.previewScale, p.previewScale);
  if (p.scales > max) {
    if (p.returnLayer > p.scales) p.returnLayer = max + 1;
    else if (p.returnLayer > max) p.returnLayer = max;
    p.scales = max;
  }
  const { image: img, width, height } = p;
  layerFunc?.(img, 0);
  if (p.scales <= 0) return;
  const n = 4 * width * height;
  const buffer = [img, new Float32Array(n)];
  const layers = new Float32Array(n);
  const temp = new Float32Array(4 * width);
  const merged = p.mergeFromScale > 0 ? new Float32Array(n) : null;
  let hpass = 0;
  let going = true;
  for (let lev = 0; lev < p.scales && going; lev++) {
    const lpass = 1 - (lev & 1);
    decomposeVert(buffer[lpass], buffer[hpass], height, width, hatStep(lev, p.previewScale, height));
    decomposeHoriz(buffer[lpass], buffer[hpass], temp, height, width, hatStep(lev, p.previewScale, width));
    if (p.mergeFromScale === 0 || p.mergeFromScale > lev + 1) {
      layerFunc?.(buffer[hpass], lev + 1);
      if (p.returnLayer === lev + 1) { if (buffer[hpass] !== img) img.set(buffer[hpass]); going = false; }
      else if (p.returnLayer === 0) addInto(layers, buffer[hpass]);
    } else {
      addInto(merged!, buffer[hpass]);
      layerFunc?.(merged!, lev + 1);
      if (p.returnLayer === lev + 1) { img.set(merged!); going = false; }
    }
    hpass = lpass;
  }
  if (going) {
    layerFunc?.(buffer[hpass], p.scales + 1);
    if (p.returnLayer === p.scales + 1) { if (buffer[hpass] !== img) img.set(buffer[hpass]); }
    else if (p.returnLayer === 0) {
      if (merged) addInto(layers, merged);
      addInto(layers, buffer[hpass]);
      layerFunc?.(layers, p.scales + 2);
      img.set(layers);
    }
  }
}
