// SPDX-License-Identifier: GPL-3.0-or-later
// The size the interactive preview is decoded at. Every slider frame develops the preview's
// pixels, and filters such as Texture (darktable's contrast equalizer, 7 passes) run over all of
// them, so a preview larger than the screen shows costs time and gains nothing. As darktable's
// darkroom processes at the scale it displays, the preview's long edge follows the size the photo
// is shown at: rounded up to a step so small layout changes don't decode again, never below what
// the object encoder reads, and never above PREVIEW_MAX. Past that the full resolution loads.

/** The largest preview. Zooming past it loads the full resolution. */
export const PREVIEW_MAX = 2560;
/** The smallest: the object selector encodes from the preview at this long edge (ENCODE_EDGE). */
export const PREVIEW_MIN = 1536;
const STEP = 128;

/** The preview long edge for a photo whose whole long edge is shown at `shownPx` device pixels. */
export function previewEdge(shownPx: number, maxTexture = Infinity): number {
  const stepped = Math.ceil(Math.max(1, shownPx) / STEP) * STEP;
  return Math.min(maxTexture, PREVIEW_MAX, Math.max(PREVIEW_MIN, stepped));
}

/**
 * Before the photo's size is known: the most its whole long edge can be shown at when it fits
 * a box of boxW × boxH CSS pixels, cropped to a fraction cropW × cropH of the frame.
 */
export function fitEdgeBound(boxW: number, boxH: number, dpr: number, cropW = 1, cropH = 1): number {
  return dpr * Math.max(boxW / Math.max(cropW, 1e-3), boxH / Math.max(cropH, 1e-3));
}

/**
 * Whether a preview decoded at `loaded` should be decoded again at `wanted`: when it holds too
 * little for the view (soft), or far more than the view needs (slow). The slack keeps a small
 * resize or zoom from decoding again.
 */
export const previewStale = (loaded: number, wanted: number) => wanted > loaded * 1.05 || wanted < loaded * 0.75;
