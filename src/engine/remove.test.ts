// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { decodePatch, encodeModelInput, patchKey, patchSource, removeCrop, removeGroups, srgbDecode8, srgbEncode8 } from './remove';
import { spotMask } from './retouch';
import { moveShape, newSpot, normalizeRetouch, type RetouchBrush } from '../film/retouch';
import type { BrushNode } from '../film/masks';

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

describe('strokes removed together', () => {
  const W = 600, H = 400;
  const node = (x: number, y: number): BrushNode => ({ x, y, border: 0.02, hardness: 0.66, density: 1 });
  const stroke = (x0: number, x1: number, y = 0.5) => [node(x0, y), node(x1, y)];

  it('are one spot when they touch, as one area of the mask has one box', () => {
    const a = stroke(0.3, 0.4), b = stroke(0.41, 0.5);
    expect(removeGroups([a, b], W, H)).toEqual([[a, b]]);
  });

  it('are split into a spot per separate area, in the order they were painted', () => {
    const a = stroke(0.1, 0.2), b = stroke(0.7, 0.8), c = stroke(0.19, 0.25, 0.52);
    expect(removeGroups([a, b, c], W, H)).toEqual([[a, c], [b]]);
  });

  it('join through a stroke that bridges them', () => {
    const a = stroke(0.1, 0.2), b = stroke(0.4, 0.5), bridge = stroke(0.15, 0.45, 0.51);
    expect(removeGroups([a, b, bridge], W, H)).toEqual([[a, b, bridge]]);
  });

  it('drop a stroke off the photo', () => {
    const a = stroke(0.3, 0.4), off = stroke(-0.6, -0.5);
    expect(removeGroups([a, off], W, H)).toEqual([[a]]);
  });

  it('mask the union of their strokes', () => {
    const a = stroke(0.3, 0.4), b = stroke(0.35, 0.35, 0.45);
    const both = spotMask({ kind: 'brush', nodes: a, more: [b] }, W, H);
    const [ma, mb] = [spotMask({ kind: 'brush', nodes: a }, W, H), spotMask({ kind: 'brush', nodes: b }, W, H)];
    const at = (m: typeof both, x: number, y: number) => {
      const i = (y - m.roi.y) * m.roi.w + (x - m.roi.x);
      return x >= m.roi.x && y >= m.roi.y && x < m.roi.x + m.roi.w && y < m.roi.y + m.roi.h ? m.mask[i] : 0;
    };
    for (let y = both.roi.y; y < both.roi.y + both.roi.h; y++) for (let x = both.roi.x; x < both.roi.x + both.roi.w; x++)
      expect(at(both, x, y)).toBe(Math.max(at(ma, x, y), at(mb, x, y)));
  });

  it('keep a single stroke\'s saved form and patch key', () => {
    const one = newSpot({ kind: 'brush', nodes: stroke(0.3, 0.4) }, { tool: 'remove' });
    const [read] = normalizeRetouch(JSON.parse(JSON.stringify([one])));
    expect(read.shape).toEqual(one.shape);
    expect('more' in read.shape).toBe(false);
    const setup = { scales: 0, mergeFrom: 0, show: 0 };
    const crop = removeCrop(one.shape, W, H)!;
    const withEmpty = { ...one, shape: { ...one.shape, more: [] } as RetouchBrush };
    expect(patchKey('b', 'm', [one], 0, crop, W, H, setup)).toBe(patchKey('b', 'm', [{ ...one, shape: normalizeRetouch([withEmpty])[0].shape }], 0, crop, W, H, setup));
  });

  it('round-trip through a sidecar and move together', () => {
    const shape: RetouchBrush = { kind: 'brush', nodes: stroke(0.3, 0.4), more: [stroke(0.35, 0.35, 0.45)] };
    const spot = newSpot(shape, { tool: 'remove' });
    expect(normalizeRetouch(JSON.parse(JSON.stringify([spot])))[0].shape).toEqual(shape);
    const moved = moveShape(shape, [0.4, 0.6]) as RetouchBrush;
    expect(moved.nodes[0].x).toBeCloseTo(0.4);
    expect(moved.nodes[0].y).toBeCloseTo(0.6);
    expect(moved.more![0][0].x).toBeCloseTo(0.45);
    expect(moved.more![0][0].y).toBeCloseTo(0.55);
  });
});

describe('which source feeds the model', () => {
  it('is the preview when the crop spans 512 preview pixels, the full size below that', () => {
    expect(patchSource({ x: 0, y: 0, w: 1024, h: 2000 }, 0.5)).toBe('preview');
    expect(patchSource({ x: 0, y: 0, w: 2000, h: 1022 }, 0.5)).toBe('full');
    expect(patchSource({ x: 0, y: 0, w: 4000, h: 4000 }, 1)).toBe('full');
  });
});
