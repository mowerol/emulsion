// SPDX-License-Identifier: GPL-3.0-or-later
// Area-average display pixels before sparse sampling. A high-resolution reference
// must represent the same pixel footprints as the worker's small fitting render.
import { MATCH_ANALYSIS_EDGE, type MatchImage } from './photomatch';

export function matchAnalysisImage(image: MatchImage): MatchImage {
  const { width, height, data: source } = image;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || source.length < width * height * 4) throw Error('The photo has no readable image pixels');
  const scale = Math.min(1, MATCH_ANALYSIS_EDGE / Math.max(width, height));
  if (scale === 1) return image;
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const data = new Uint8ClampedArray(w * h * 4);
  const sx = width / w, sy = height / h, area = sx * sy;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const left = x * sx, right = (x + 1) * sx, top = y * sy, bottom = (y + 1) * sy;
    let r = 0, g = 0, b = 0, alpha = 0;
    for (let iy = Math.floor(top); iy < Math.min(height, Math.ceil(bottom)); iy++) {
      const wy = Math.min(iy + 1, bottom) - Math.max(iy, top);
      for (let ix = Math.floor(left); ix < Math.min(width, Math.ceil(right)); ix++) {
        const weight = wy * (Math.min(ix + 1, right) - Math.max(ix, left));
        const i = (iy * width + ix) * 4;
        const a = weight * source[i + 3] / 255;
        r += a * source[i]; g += a * source[i + 1]; b += a * source[i + 2]; alpha += a;
      }
    }
    const out = (y * w + x) * 4;
    if (alpha) { data[out] = r / alpha; data[out + 1] = g / alpha; data[out + 2] = b / alpha; }
    data[out + 3] = 255 * alpha / area;
  }
  return { width: w, height: h, data };
}
