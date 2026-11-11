// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { decodeRaster, encodeRaster, normalizeRaster, rasterValue } from './objectmask';
import { MAX_OBJECTS, newBrush, newMask, normalizeMasks, objectCount, type ObjectShape, type SkyShape } from './masks';
import { maskValue, packShapes } from '../engine/masks';
import { objectShapes } from '../engine/objectgpu';

/** A w × h selection: 255 inside the box, a soft edge of one pixel round it, 0 elsewhere. */
function boxPixels(w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inside = x >= x0 && x < x1 && y >= y0 && y < y1;
    const edge = x >= x0 - 1 && x < x1 + 1 && y >= y0 - 1 && y < y1 + 1;
    px[y * w + x] = inside ? 255 : edge ? 128 : 0;
  }
  return px;
}

const object = (px: Uint8Array, w: number, h: number): ObjectShape =>
  ({ id: 'o', kind: 'object', mode: 'add', invert: false, opacity: 1, prompts: [{ x: 0.5, y: 0.5, label: 1 }], raster: encodeRaster(px, w, h) });

describe('object rasters', () => {
  it('stores sky separately from SAM and shares the raster stack and brush combinations', () => {
    const sky: SkyShape = { id: 'sky', kind: 'sky', mode: 'add', opacity: 1, invert: false, raster: encodeRaster(new Uint8Array([255, 255, 0, 0]), 2, 2) };
    const obj = object(boxPixels(2, 2, 1, 1, 2, 2), 2, 2);
    const brush = { ...newBrush('subtract'), strokes: [[{ x: 0.25, y: 0.25, border: 0.15, hardness: 1, density: 1 }]] };
    const m = { ...newMask(sky, 0), exposure: 1, shapes: [sky, brush, obj] };
    const back = normalizeMasks(JSON.parse(JSON.stringify([m])));
    expect(back).toEqual([m]);
    expect(objectCount(back)).toBe(2);
    const packed = packShapes(back);
    expect(objectShapes(back, packed.index)).toEqual([sky, obj]);
    expect(packed.shapes[0]).toBe(4);
    expect(packed.shapes[2 * 12 + 4]).toBe(1);
    expect(maskValue({ ...m, shapes: [sky] }, 0.5, 0.25, 3000, 2000)).toBe(1);
    expect(maskValue({ ...m, shapes: [sky] }, 0.5, 0.75, 3000, 2000)).toBe(0);
    expect(maskValue({ ...m, shapes: [sky, brush] }, 0.25, 0.25, 3000, 2000)).toBe(0);
  });
  it('round-trips the pixels, runs longer than 255 included', () => {
    const px = boxPixels(600, 40, 100, 10, 500, 30);
    const r = encodeRaster(px, 600, 40);
    expect(decodeRaster(r)).toEqual(px);
    // Mostly long runs: far smaller than the pixels.
    expect(r.data.length).toBeLessThan(px.length / 4);
  });

  it('names equal pixels alike and different pixels apart', () => {
    const a = encodeRaster(boxPixels(20, 20, 5, 5, 15, 15), 20, 20);
    expect(encodeRaster(boxPixels(20, 20, 5, 5, 15, 15), 20, 20).id).toBe(a.id);
    expect(encodeRaster(boxPixels(20, 20, 5, 5, 14, 15), 20, 20).id).not.toBe(a.id);
  });

  it('samples bilinearly on pixel centres', () => {
    const px = new Uint8Array([0, 255, 0, 255]); // 2 × 2: right column on
    const r = encodeRaster(px, 2, 2);
    expect(rasterValue(r, 0.25, 0.5)).toBeCloseTo(0);
    expect(rasterValue(r, 0.75, 0.5)).toBeCloseTo(1);
    expect(rasterValue(r, 0.5, 0.5)).toBeCloseTo(0.5);
    expect(rasterValue(r, 0, 0)).toBeCloseTo(0); // clamped at the edge
  });

  it('rejects damaged or oversized data from a sidecar', () => {
    const r = encodeRaster(boxPixels(10, 10, 2, 2, 8, 8), 10, 10);
    expect(normalizeRaster({ ...r, w: 11 })).toBeNull();
    expect(normalizeRaster({ ...r, data: '!!!' })).toBeNull();
    expect(normalizeRaster({ ...r, w: 5000, h: 1 })).toBeNull();
    // The id is made again from the pixels, not trusted.
    expect(normalizeRaster({ ...r, id: 'forged' })?.id).toBe(r.id);
  });

  it('survives a sidecar round trip as a mask shape', () => {
    const shape = object(boxPixels(30, 20, 10, 5, 20, 15), 30, 20);
    const masks = [{ ...newMask(shape, 0), exposure: 1 }];
    const back = normalizeMasks(JSON.parse(JSON.stringify(masks)));
    expect(back[0].shapes[0]).toEqual(shape);
    // A prompt outside the photo or with a strange label is mended.
    const odd = normalizeMasks([{ ...masks[0], shapes: [{ ...shape, prompts: [{ x: 2, y: -1, label: 7 }, { x: 'a' }] }] }]);
    expect((odd[0].shapes[0] as ObjectShape).prompts).toEqual([{ x: 1, y: 0, label: 1 }]);
  });

  it('is a mask shape like the others: its value is its pixels', () => {
    const shape = object(boxPixels(30, 20, 10, 5, 20, 15), 30, 20);
    const m = { ...newMask(shape, 0), exposure: 1 };
    expect(maskValue(m, 0.5, 0.5, 3000, 2000)).toBeCloseTo(1);
    expect(maskValue(m, 0.05, 0.05, 3000, 2000)).toBeCloseTo(0);
    expect(maskValue({ ...m, shapes: [{ ...shape, invert: true }] }, 0.05, 0.05, 3000, 2000)).toBeCloseTo(1);
  });

  it('packs each object with its place in the stack, and past the room as empty', () => {
    const shapes = Array.from({ length: MAX_OBJECTS + 1 }, (_, i) => ({ ...object(boxPixels(4, 4, 1, 1, 3, 3), 4, 4), id: `o${i}` }));
    const m = { ...newMask(shapes[0], 0), exposure: 1, shapes };
    const { shapes: packed, index } = packShapes([m]);
    for (let i = 0; i < shapes.length; i++) {
      expect(packed[i * 12]).toBe(4);
      expect(packed[i * 12 + 2]).toBe(i < MAX_OBJECTS ? 1 : 0);
      expect(packed[i * 12 + 4]).toBe(i);
    }
    expect(objectShapes([m], index)).toHaveLength(MAX_OBJECTS);
  });
});
