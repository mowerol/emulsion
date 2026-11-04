// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { decodePatch, encodeModelInput, patchSource, removeCrop, srgbDecode8, srgbEncode8 } from './remove';

describe('the fixed 8-bit sRGB encode and decode', () => {
  it('decodes and re-encodes every 8-bit value to itself', () => {
    for (let u = 0; u < 256; u++) expect(srgbEncode8(srgbDecode8(u))).toBe(u);
  });

  it('takes linear Rec.2020 grey to sRGB grey and back', () => {
    // sRGB 128 is 0.2158605 in linear light; grey is grey in both primaries.
    const px = new Float32Array([0.2158605, 0.2158605, 0.2158605, 1]);
    expect(Array.from(encodeModelInput(px))).toEqual([128, 128, 128, 255]);
    const back = decodePatch(new Uint8Array([128, 128, 128, 255]));
    for (let c = 0; c < 3; c++) expect(back[c]).toBeCloseTo(0.2158605, 6);
  });

  it('clips what sRGB cannot hold', () => {
    expect(Array.from(encodeModelInput(new Float32Array([4, 4, 4, 1, -1, -1, -1, 1])))).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
  });
});

describe("IOPaint's crop around a Remove spot", () => {
  const circle = (cx: number, cy: number) => ({ kind: 'circle' as const, center: [cx, cy] as [number, number], radius: 0.01, border: 0.0005 });

  it('boxes every pixel the spot touches, with 128 pixels of margin each side', () => {
    // 6000 × 4000: radius 40 px, feather 2 px. The mask is over 0 of 255 into the feather, so the
    // box is x 2959 to 3041 (82 wide), centre 3000; the crop is 82 + 256 wide: 3000 ∓ 169.
    expect(removeCrop(circle(0.5, 0.5), 6000, 4000)).toEqual({ x: 2831, y: 1831, w: 338, h: 338 });
  });

  it('takes more context from the other side at the photo\'s edge', () => {
    // Centre x 30: the box is clipped to 0 to 72, centre 36; _l is −128, so the right edge moves out by 128.
    expect(removeCrop(circle(0.005, 0.5), 6000, 4000)).toEqual({ x: 0, y: 1831, w: 328, h: 338 });
  });

  it('uses the whole photo when its longer side is at most 800 pixels', () => {
    expect(removeCrop(circle(0.5, 0.5), 800, 600)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });

  it('fills a faint spot too: the whole area it blends', () => {
    // A brush whose density keeps it under half everywhere (IOPaint's 127 would drop it).
    const faint = { kind: 'brush' as const, nodes: [{ x: 0.5, y: 0.5, border: 0.01, hardness: 1, density: 0.4 }, { x: 0.52, y: 0.5, border: 0.01, hardness: 1, density: 0.4 }] };
    expect(removeCrop(faint, 6000, 4000)).not.toBeNull();
  });

  it('has nothing to fill when the spot is off the photo', () => {
    expect(removeCrop(circle(-0.5, 0.5), 6000, 4000)).toBeNull();
  });
});

describe('which source feeds the model', () => {
  it('is the preview when the crop spans 512 preview pixels, the full size below that', () => {
    expect(patchSource({ x: 0, y: 0, w: 1024, h: 2000 }, 0.5)).toBe('preview');
    expect(patchSource({ x: 0, y: 0, w: 2000, h: 1022 }, 0.5)).toBe('full');
    expect(patchSource({ x: 0, y: 0, w: 4000, h: 4000 }, 1)).toBe('full');
  });
});
