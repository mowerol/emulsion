// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { brushValue, falloff, simplify, strokeEpsilon, strokeSegments } from './brush';
import { packShapes } from './masks';
import { brushSize, brushShapes } from './brushgpu';
import { MAX_BRUSHES, newBrush, newEllipse, newMask, normalizeMasks, type BrushNode } from '../film/masks';

const W = 3000;
const H = 2000;
const n = (x: number, y: number, border = 0.05, hardness = 0.5, density = 1): BrushNode => ({ x, y, border, hardness, density });

describe('darktable brush', () => {
  it('falls off as _brush_falloff_roi: full density to hardness × border, then linear', () => {
    expect(falloff(0, 10, 0.5, 0.8)).toBe(0.8);
    expect(falloff(5, 10, 0.5, 0.8)).toBe(0.8);
    expect(falloff(7.5, 10, 0.5, 0.8)).toBeCloseTo(0.4, 12);
    expect(falloff(10, 10, 0.5, 0.8)).toBe(0);
    expect(falloff(3, 10, 1, 1)).toBe(1);
  });

  it('simplifies a drawn stroke to the nodes that matter (Ramer-Douglas-Peucker)', () => {
    const line = Array.from({ length: 50 }, (_, i) => n(0.1 + i * 0.01, 0.5));
    expect(simplify(line, strokeEpsilon(0.05))).toEqual([line[0], line[49]]);
    const corner = [...Array.from({ length: 20 }, (_, i) => n(0.1 + i * 0.02, 0.2)), ...Array.from({ length: 20 }, (_, i) => n(0.48, 0.22 + i * 0.02))];
    const kept = simplify(corner, strokeEpsilon(0.05));
    expect(kept.length).toBeGreaterThanOrEqual(3);
    expect(kept[0]).toBe(corner[0]);
    expect(kept[kept.length - 1]).toBe(corner[39]);
  });

  it('runs a straight stroke straight, with the border eased between nodes', () => {
    const segs = strokeSegments([n(0.2, 0.5, 0.02), n(0.6, 0.5, 0.06)], W, H);
    for (const s of segs) { expect(s[1]).toBeCloseTo(1000, 6); expect(s[3]).toBeCloseTo(1000, 6); }
    expect(segs[0][0]).toBeCloseTo(600, 6);
    expect(segs[segs.length - 1][2]).toBeCloseTo(1800, 6);
    // Halfway the eased border is halfway too; a quarter along it is t²(3 - 2t) = 0.15625 of the way.
    const mid = segs[Math.floor(segs.length / 2)];
    expect(mid[4]).toBeCloseTo((0.02 + 0.04 * 0.5) * 2000, 0);
    const quarter = segs[Math.floor(segs.length / 4)];
    expect(quarter[4]).toBeCloseTo((0.02 + 0.04 * 0.15625) * 2000, -1);
  });

  it('paints the union of its strokes, round at the ends', () => {
    const b = { ...newBrush(), strokes: [[n(0.2, 0.5), n(0.6, 0.5)], [n(0.5, 0.2, 0.03, 1, 0.5)]] };
    expect(brushValue(b, 0.4, 0.5, W, H)).toBe(1);
    // 0.05 of 2000 px = 100 px border, hardness 0.5: at 75 px off the line, half.
    expect(brushValue(b, 0.4, 0.5 + 75 / H, W, H)).toBeCloseTo(0.5, 6);
    expect(brushValue(b, 0.4, 0.5 + 101 / H, W, H)).toBe(0);
    // Past the end, the cap is round.
    expect(brushValue(b, 0.6 + 75 / W, 0.5, W, H)).toBeCloseTo(0.5, 6);
    expect(brushValue(b, 0.5, 0.2, W, H)).toBe(0.5);
    expect(brushValue(b, 0.9, 0.9, W, H)).toBe(0);
  });

  it('keeps strokes through a sidecar and gives each brush its channel', () => {
    const [m] = normalizeMasks([{ shapes: [{ kind: 'brush', strokes: [[{ x: 0.1, y: 0.2, border: 9 }, { x: 'no' }], []] }] }]);
    expect(m.shapes[0]).toMatchObject({ kind: 'brush', strokes: [[{ x: 0.1, y: 0.2, border: 1, hardness: 0.66, density: 1 }]] });
    const brushMask = { ...newMask({ ...newBrush(), strokes: [[n(0.5, 0.5)]] }, 0), exposure: 1 };
    brushMask.shapes.push({ ...newBrush('subtract'), strokes: [[n(0.5, 0.5, 0.01)]] });
    const other = { ...newMask(newEllipse(), 1), exposure: 1 };
    other.shapes.push({ ...newBrush(), strokes: [[n(0.1, 0.1)]] });
    const packed = packShapes([brushMask, other]);
    // [kind, mode, opacity, mask] then [channel, ...]: brushes 0, 1, then the second mask's 2.
    expect([packed.shapes[0], packed.shapes[4]]).toEqual([3, 0]);
    expect([packed.shapes[12], packed.shapes[13], packed.shapes[16]]).toEqual([3, 3, 1]);
    expect(packed.shapes[36 + 4]).toBe(2);
    expect(brushShapes([brushMask, other], packed.index)).toHaveLength(3);
    const many = Array.from({ length: MAX_BRUSHES + 1 }, () => ({ ...newBrush(), strokes: [[n(0.5, 0.5)]] }));
    const full = packShapes([{ ...newMask(many[0], 0), shapes: many, exposure: 1 }]);
    expect(full.shapes[MAX_BRUSHES * 12 + 2]).toBe(0);
  });

  it('sizes the brush masks to the source, at most BRUSH_EDGE long', () => {
    expect(brushSize(2560, 1707)).toEqual([2560, 1707]);
    expect(brushSize(6000, 4000)).toEqual([3072, 2048]);
  });
});
