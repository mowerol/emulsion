// Copyright (C) 2019-2026 darktable developers.
// Ported from darktable src/iop/lut3d.c at commit f38e304ce78e4332cc4528443e242dcd815c45a2.
// Translated from C to TypeScript: the .cube, .3dl and Hald CLUT readers and the tetrahedral
// interpolation (darktable's default, itself from OpenColorIO). Not ported: trilinear and pyramid
// interpolation, compressed .gmz LUTs (G'MIC), and darktable's choice of LUT colour space; Emulsion
// applies every LUT to the sRGB display image. Mirrors stages/lut.glsl.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// 3D colour lookup tables: `level` entries per axis, red fastest, then green, then blue.

export interface Clut {
  level: number;
  /** level^3 x RGB, red fastest. */
  data: Float32Array;
}

/** darktable's maximum LUT size per axis. */
export const MAX_LEVEL = 256;

export class LutError extends Error {}

/** darktable's _parse_cube_line: up to three tokens before a comment; more fold into the third. */
function tokens(line: string): string[] {
  const useful = line.split('#')[0];
  const t = useful.split(/[ \t]+/).filter((s) => s.length > 0);
  return t;
}

/** A .cube file (Adobe/Resolve): LUT_3D_SIZE, then level^3 lines of "r g b" in [0, 1]. */
export function parseCube(text: string): Clut {
  let level = 0;
  let data: Float32Array | null = null;
  let i = 0;
  for (const line of text.split(/\r?\n|\r/)) {
    const t = tokens(line);
    if (!t.length) continue;
    if (t[0][0] === 'T') continue; // TITLE
    if (t[0] === 'DOMAIN_MIN') {
      if (t.slice(1).some((v) => Number(v) !== 0)) throw new LutError('DOMAIN_MIN other than 0 is not supported');
    } else if (t[0] === 'DOMAIN_MAX') {
      if (t.slice(1).some((v) => Number(v) !== 1)) throw new LutError('DOMAIN_MAX other than 1 is not supported');
    } else if (t[0] === 'LUT_1D_SIZE') throw new LutError('1D cube LUTs are not supported');
    else if (t[0] === 'LUT_3D_SIZE') {
      level = parseInt(t[1], 10);
      if (!(level >= 2) || level > MAX_LEVEL) throw new LutError(`LUT 3D size ${t[1]} is not supported`);
      data = new Float32Array(level * level * level * 3);
    } else if (t.length === 3) {
      if (!data) throw new LutError('the cube LUT size is not defined');
      if (i >= data.length) throw new LutError('the cube LUT has too many lines');
      for (let j = 0; j < 3; j++) {
        const v = Number(t[j]);
        if (Number.isNaN(v)) throw new LutError(`invalid number on line ${i / 3}`);
        data[i + j] = v;
      }
      i += 3;
    }
  }
  if (!data || i !== data.length) throw new LutError(`the cube LUT has ${i / 3} lines, it should have ${data ? data.length / 3 : 0}`);
  return { level, data };
}

/**
 * A .3dl file: a shaper line whose token count is the level, then level^3 lines of integer
 * "r g b", blue fastest, normalised by the smallest power of two above the largest value.
 */
export function parse3dl(text: string): Clut {
  let level = 0;
  let raw: Float32Array | null = null;
  let i = 0;
  let max = 0;
  for (const line of text.split(/\r?\n|\r/)) {
    const t = tokens(line);
    if (!t.length) continue;
    if (!level) {
      if (t.length > 3 && parseInt(t[t.length - 1], 10) > parseInt(t[0], 10)) {
        if (parseInt(t[t.length - 1], 10) < 128) throw new LutError('the maximum shaper value is too low');
        level = t.length;
        raw = new Float32Array(level * level * level * 3);
      }
    } else if (t.length === 3) {
      const l2 = level * level;
      const red = Math.floor(i / l2), rr = i - red * l2;
      const green = Math.floor(rr / level), blue = rr - green * level;
      const k = red + level * green + l2 * blue;
      for (let j = 0; j < 3; j++) {
        const v = parseInt(t[j], 10);
        raw![k * 3 + j] = v;
        if (v > max) max = v;
      }
      i++;
      if (i * 3 >= raw!.length) break;
    }
  }
  if (!raw || i * 3 !== raw.length) throw new LutError('the 3dl LUT has the wrong number of lines');
  let norm = 1;
  while (norm < max && norm < 65536) norm <<= 1;
  if (norm < 128) throw new LutError('the 3dl values match no bit depth');
  for (let k = 0; k < raw.length; k++) raw[k] = Math.min(Math.max(raw[k] / (norm - 1), 0), 1);
  return { level, data: raw };
}

/**
 * A Hald CLUT image (RGBA pixels, row by row): a square of side L^3 holding L^2 entries per
 * axis, red fastest. `maxValue` is 255 for 8-bit images.
 */
export function parseHald(rgba: ArrayLike<number>, width: number, height: number, maxValue = 255): Clut {
  let l = 2;
  while (l * l * l < width) l++;
  if (l * l * l !== width || width !== height) throw new LutError(`a ${width} x ${height} image is not a Hald CLUT`);
  const level = l * l;
  if (level > MAX_LEVEL) throw new LutError(`LUT 3D size ${level} is not supported`);
  const n = level * level * level;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) data[i * 3 + c] = rgba[i * 4 + c] / maxValue;
  return { level, data };
}

/** Tetrahedral interpolation (darktable's _correct_pixel_tetrahedral); input clipped to [0, 1]. */
export function tetrahedral(lut: Clut, rgb: ArrayLike<number>): [number, number, number] {
  const { level, data } = lut;
  const d = [0, 1, 2].map((c) => Math.min(Math.max(rgb[c], 0), 1) * (level - 1));
  const i = d.map((v) => Math.min(Math.max(Math.trunc(v), 0), level - 2));
  const [r, g, b] = d.map((v, c) => v - i[c]);
  const i000 = (i[0] + i[1] * level + i[2] * level * level) * 3;
  const i100 = i000 + 3, i010 = i000 + 3 * level, i110 = i010 + 3;
  const i001 = i000 + 3 * level * level, i101 = i001 + 3, i011 = i000 + 3 * (level + level * level), i111 = i011 + 3;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const L = (k: number) => data[k + c];
    if (r > g) {
      if (g > b) out[c] = (1 - r) * L(i000) + (r - g) * L(i100) + (g - b) * L(i110) + b * L(i111);
      else if (r > b) out[c] = (1 - r) * L(i000) + (r - b) * L(i100) + (b - g) * L(i101) + g * L(i111);
      else out[c] = (1 - b) * L(i000) + (b - r) * L(i001) + (r - g) * L(i101) + g * L(i111);
    } else {
      if (b > g) out[c] = (1 - b) * L(i000) + (b - g) * L(i001) + (g - r) * L(i011) + r * L(i111);
      else if (b > r) out[c] = (1 - g) * L(i000) + (g - b) * L(i010) + (b - r) * L(i011) + r * L(i111);
      else out[c] = (1 - g) * L(i000) + (g - r) * L(i010) + (r - b) * L(i110) + b * L(i111);
    }
  }
  return out;
}

/** The table as RGBA floats for a level^3 3D texture (x red, y green, z blue). */
export function textureData(lut: Clut): Float32Array {
  const n = lut.level ** 3;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = lut.data[i * 3];
    out[i * 4 + 1] = lut.data[i * 3 + 1];
    out[i * 4 + 2] = lut.data[i * 3 + 2];
    out[i * 4 + 3] = 1;
  }
  return out;
}

/** Writes a .cube file, values rounded to `digits` decimals. */
export function writeCube(lut: Clut, title: string, comments: string[] = [], digits = 6): string {
  const lines = [...comments.map((c) => `# ${c}`), `TITLE "${title}"`, `LUT_3D_SIZE ${lut.level}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  const n = lut.level ** 3;
  for (let i = 0; i < n; i++) lines.push(`${lut.data[i * 3].toFixed(digits)} ${lut.data[i * 3 + 1].toFixed(digits)} ${lut.data[i * 3 + 2].toFixed(digits)}`);
  return lines.join('\n') + '\n';
}
