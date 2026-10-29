// SPDX-License-Identifier: GPL-3.0-or-later
// Histogram of the developed frame, counted from display-encoded RGBA8 pixels,
// the same values the screen shows.

export const BINS = 256;

export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  /** Rec.709 luma of the encoded values. */
  l: Uint32Array;
  pixels: number;
  /** Fraction of pixels with every channel at 0. */
  shadowClip: number;
  /** Fraction of pixels with any channel at 255. */
  highlightClip: number;
}

export function histogram(px: Uint8Array): Histogram {
  const r = new Uint32Array(BINS);
  const g = new Uint32Array(BINS);
  const b = new Uint32Array(BINS);
  const l = new Uint32Array(BINS);
  let low = 0;
  let high = 0;
  const pixels = px.length >> 2;
  for (let i = 0; i < px.length; i += 4) {
    const R = px[i];
    const G = px[i + 1];
    const B = px[i + 2];
    r[R]++;
    g[G]++;
    b[B]++;
    l[Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B)]++;
    if ((R | G | B) === 0) low++;
    if (R === 255 || G === 255 || B === 255) high++;
  }
  return { r, g, b, l, pixels, shadowClip: pixels ? low / pixels : 0, highlightClip: pixels ? high / pixels : 0 };
}

/**
 * Bin heights in [0, 1] for drawing, lightly smoothed so 8-bit quantisation
 * does not comb the graph. The scale ignores the end bins, which spike when
 * the frame clips, so one clipped area does not flatten everything else.
 */
export function heights(h: Histogram): { r: Float32Array; g: Float32Array; b: Float32Array; l: Float32Array } {
  const smooth = (c: Uint32Array) => {
    const out = new Float32Array(BINS);
    for (let i = 0; i < BINS; i++) {
      const a = c[Math.max(0, i - 1)];
      const z = c[Math.min(BINS - 1, i + 1)];
      out[i] = i === 0 || i === BINS - 1 ? c[i] : (a + 2 * c[i] + z) / 4;
    }
    return out;
  };
  const s = { r: smooth(h.r), g: smooth(h.g), b: smooth(h.b), l: smooth(h.l) };
  let peak = 0;
  for (const c of [s.r, s.g, s.b]) for (let i = 1; i < BINS - 1; i++) peak = Math.max(peak, c[i]);
  const k = peak > 0 ? 1 / peak : 0;
  for (const c of Object.values(s)) for (let i = 0; i < BINS; i++) c[i] = Math.min(1, c[i] * k);
  return s;
}
