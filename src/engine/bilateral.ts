// Copyright (C) 2016-2026 darktable developers.
// Ported from darktable src/common/bilateral.c (dt_bilateral_grid_size, image_to_grid,
// image_to_relgrid, dt_bilateral_init, dt_bilateral_splat, blur_line, blur_line_z,
// dt_bilateral_blur, dt_bilateral_slice) at commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773
// (release 5.6.2). Translated from C to TypeScript. darktable splats in horizontal slices, one a
// thread, and adds them up; this splats into the one grid, which is the same sum.
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * darktable's bilateral grid on the L channel (the first of four floats a pixel, Lab with L in 0
 * to 100). The grid holds the density of pixels over space and lightness; blurring it along L
 * takes its derivative, and slicing moves each pixel's L along it: with detail -1, toward the
 * bilateral base layer.
 */
export class BilateralGrid {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly sigmaS: number;
  readonly sigmaR: number;
  private readonly sInv: number;
  private readonly rInv: number;
  readonly buf: Float32Array;

  constructor(readonly width: number, readonly height: number, sigmaS: number, sigmaR: number) {
    const f = Math.fround;
    // dt_bilateral_grid_size with L_range 100.
    const L_RANGE = 100;
    if (sigmaS < 0.5) sigmaS = 0.5;
    const clamps = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const x = clamps(Math.round(f(width / sigmaS)), 4, 3000);
    const y = clamps(Math.round(f(height / sigmaS)), 4, 3000);
    const z = clamps(Math.round(f(L_RANGE / sigmaR)), 4, 50);
    this.sigmaS = Math.max(f(height / y), f(width / x));
    this.sigmaR = f(L_RANGE / z);
    this.sInv = f(1 / this.sigmaS);
    this.rInv = f(1 / this.sigmaR);
    this.sizeX = Math.ceil(f(width * this.sInv)) + 1;
    this.sizeY = Math.ceil(f(height * this.sInv)) + 1;
    this.sizeZ = Math.ceil(f(L_RANGE * this.rInv)) + 1;
    this.buf = new Float32Array(this.sizeX * this.sizeY * this.sizeZ);
  }

  /** dt_bilateral_splat: each pixel's weight into its eight neighbouring cells. */
  splat(img: Float32Array) {
    const f = Math.fround;
    const { sizeX, sizeY, sizeZ, buf, width, height } = this;
    const ox = sizeZ, oy = sizeX * sizeZ, oz = 1;
    const sigmaS2 = f(this.sigmaS * this.sigmaS);
    const offsets = [0, ox, oy, ox + oy, oz, oz + ox, oz + oy, oz + oy + ox];
    for (let j = 0; j < height; j++) {
      const y = Math.min(sizeY - 1, Math.max(0, f(j * this.sInv)));
      const yi = Math.min(Math.trunc(y), sizeY - 2);
      const yf = f(y - yi);
      const base = yi * oy;
      for (let i = 0; i < width; i++) {
        const L = img[4 * (j * width + i)];
        const x = Math.min(sizeX - 1, Math.max(0, f(i * this.sInv)));
        const z = Math.min(sizeZ - 1, Math.max(0, f(L * this.rInv)));
        const xi = Math.min(Math.trunc(x), sizeX - 2);
        const zi = Math.min(Math.trunc(z), sizeZ - 2);
        const xf = f(x - xi), zf = f(z - zi);
        const g = base + xi * sizeZ + zi;
        const c = [f(f(f((1 - xf) * (1 - yf)) * 100) / sigmaS2), f(f(f(xf * (1 - yf)) * 100) / sigmaS2), f(f(f((1 - xf) * yf) * 100) / sigmaS2), f(f(f(xf * yf) * 100) / sigmaS2)];
        for (let k = 0; k < 4; k++) {
          buf[g + offsets[k]] += f(c[k] * (1 - zf));
          buf[g + offsets[k + 4]] += f(c[k] * zf);
        }
      }
    }
  }

  /** dt_bilateral_blur: [1 4 6 4 1] / 16 across x and y, and the derivative [-2 -4 0 4 2] / 16 along z. */
  blur() {
    const { sizeX, sizeY, sizeZ, buf } = this;
    const ox = sizeZ, oy = sizeX * sizeZ, oz = 1;
    blurLine(buf, oz, oy, ox, sizeZ, sizeY, sizeX);
    blurLine(buf, oz, ox, oy, sizeZ, sizeX, sizeY);
    blurLineZ(buf, ox, oy, oz, sizeX, sizeY, sizeZ);
  }

  /** dt_bilateral_slice: `out` is `img` with L moved along the grid; detail -1 gives the base layer. */
  slice(img: Float32Array, out: Float32Array, detail: number) {
    const f = Math.fround;
    const { sizeX, sizeY, sizeZ, buf, width, height } = this;
    const norm = f(f(-detail * this.sigmaR) * 0.04);
    const ox = sizeZ, oy = sizeX * sizeZ, oz = 1;
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
      const index = 4 * (j * width + i);
      const L = img[index];
      const x = Math.min(sizeX - 1, Math.max(0, f(i * this.sInv)));
      const y = Math.min(sizeY - 1, Math.max(0, f(j * this.sInv)));
      const z = Math.min(sizeZ - 1, Math.max(0, f(L * this.rInv)));
      const xi = Math.min(Math.trunc(x), sizeX - 2), yi = Math.min(Math.trunc(y), sizeY - 2), zi = Math.min(Math.trunc(z), sizeZ - 2);
      const xf = f(x - xi), yf = f(y - yi), zf = f(z - zi);
      const gi = (xi + yi * sizeX) * sizeZ + zi;
      const v = buf[gi] * (1 - xf) * (1 - yf) * (1 - zf)
        + buf[gi + ox] * xf * (1 - yf) * (1 - zf)
        + buf[gi + oy] * (1 - xf) * yf * (1 - zf)
        + buf[gi + ox + oy] * xf * yf * (1 - zf)
        + buf[gi + oz] * (1 - xf) * (1 - yf) * zf
        + buf[gi + ox + oz] * xf * (1 - yf) * zf
        + buf[gi + oy + oz] * (1 - xf) * yf * zf
        + buf[gi + ox + oy + oz] * xf * yf * zf;
      out[index] = Math.max(0, f(L + f(norm * v)));
      out[index + 1] = img[index + 1];
      out[index + 2] = img[index + 2];
      out[index + 3] = img[index + 3];
    }
  }
}

/** blur_line: the [1 4 6 4 1] / 16 kernel along offset3, zero beyond the ends. */
function blurLine(buf: Float32Array, offset1: number, offset2: number, offset3: number, size1: number, size2: number, size3: number) {
  const f = Math.fround;
  const w0 = 6 / 16, w1 = 4 / 16, w2 = 1 / 16;
  for (let k = 0; k < size1; k++) {
    let index = k * offset1;
    for (let j = 0; j < size2; j++) {
      let tmp1 = buf[index];
      buf[index] = f(buf[index] * w0 + w1 * buf[index + offset3] + w2 * buf[index + 2 * offset3]);
      index += offset3;
      let tmp2 = buf[index];
      buf[index] = f(buf[index] * w0 + w1 * (buf[index + offset3] + tmp1) + w2 * buf[index + 2 * offset3]);
      index += offset3;
      for (let i = 2; i < size3 - 2; i++) {
        const tmp3 = buf[index];
        buf[index] = f(buf[index] * w0 + w1 * (buf[index + offset3] + tmp2) + w2 * (buf[index + 2 * offset3] + tmp1));
        index += offset3;
        tmp1 = tmp2;
        tmp2 = tmp3;
      }
      const tmp3 = buf[index];
      buf[index] = f(buf[index] * w0 + w1 * (buf[index + offset3] + tmp2) + w2 * tmp1);
      index += offset3;
      buf[index] = f(buf[index] * w0 + w1 * tmp3 + w2 * tmp2);
      index += offset3;
      index += offset2 - offset3 * size3;
    }
  }
}

/** blur_line_z: the derivative kernel along offset3. */
function blurLineZ(buf: Float32Array, offset1: number, offset2: number, offset3: number, size1: number, size2: number, size3: number) {
  const f = Math.fround;
  const w1 = 4 / 16, w2 = 2 / 16;
  for (let k = 0; k < size1; k++) {
    let index = k * offset1;
    for (let j = 0; j < size2; j++) {
      let tmp1 = buf[index];
      buf[index] = f(w1 * buf[index + offset3] + w2 * buf[index + 2 * offset3]);
      index += offset3;
      let tmp2 = buf[index];
      buf[index] = f(w1 * (buf[index + offset3] - tmp1) + w2 * buf[index + 2 * offset3]);
      index += offset3;
      for (let i = 2; i < size3 - 2; i++) {
        const tmp3 = buf[index];
        buf[index] = f(w1 * (buf[index + offset3] - tmp2) + w2 * (buf[index + 2 * offset3] - tmp1));
        index += offset3;
        tmp1 = tmp2;
        tmp2 = tmp3;
      }
      const tmp3 = buf[index];
      buf[index] = f(w1 * (buf[index + offset3] - tmp2) - w2 * tmp1);
      index += offset3;
      buf[index] = f(-w1 * tmp3 - w2 * tmp2);
      index += offset3;
      index += offset2 - offset3 * size3;
    }
  }
}
