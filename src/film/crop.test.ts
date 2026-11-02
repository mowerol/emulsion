// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  FULL, bounds, constrain, cropAffine, fits, framePixels, isFull, largest, move, normalizeCrop, pixelRatio, resize, rotateFrame, setAngle, setAspect, sourcePoint, type Crop,
  flip, heldRatio, orientedSize, ratioLabel, turn,
} from './crop';

const W = 6000;
const H = 4000;
const crop = (c: Partial<Crop>): Crop => ({ ...FULL, ...c });

describe('crop geometry', () => {
  it('maps the frame onto the source unchanged with no crop', () => {
    expect(cropAffine(FULL, W, H).map((v) => +v.toFixed(12))).toEqual([1, 0, 0, 1, 0, 0]);
    expect(sourcePoint(crop({ x: 0.25, y: 0.1, w: 0.5, h: 0.5 }), W, H, 1, 1)).toEqual([0.75, 0.6]);
  });

  it('turns the photo clockwise for a positive angle', () => {
    // Straightened clockwise, the frame's top centre shows a point left of the source's top centre.
    const c = crop({ ...largest(1.5, 10, W, H), angle: 10 });
    const [sx] = sourcePoint(c, W, H, 0.5, 0);
    expect(sx).toBeLessThan(0.5);
    // The centre stays the centre.
    const [cx, cy] = sourcePoint({ ...c, ...{ x: 0, y: 0, w: 1, h: 1 } }, W, H, 0.5, 0.5);
    expect(cx).toBeCloseTo(0.5, 12);
    expect(cy).toBeCloseTo(0.5, 12);
  });

  it('keeps pixels square under rotation', () => {
    const c = crop({ x: 0, y: 0, w: 1, h: 1, angle: 30 });
    const [a, b, cc, d] = cropAffine(c, W, H);
    // One frame step right and one step down cover the same number of source pixels (W·w and H·h).
    const right = Math.hypot(a * W, cc * H);
    const down = Math.hypot(b * W, d * H);
    expect(right).toBeCloseTo(W, 6);
    expect(down).toBeCloseTo(H, 6);
  });

  it('finds the largest crop for an angle, which fits and touches the edge', () => {
    for (const angle of [0, 3, -7.5, 20, 45]) {
      const r = largest(1.5, angle, W, H);
      expect(fits(r, angle, W, H)).toBe(true);
      expect(fits({ ...r, x: r.x - 0.01, w: r.w + 0.02 }, angle, W, H)).toBe(false);
      expect(pixelRatio(r, W, H)).toBeCloseTo(1.5, 9);
    }
    expect(largest(1.5, 0, W, H)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('holds the whole straightened photo in its bounds', () => {
    const b = bounds(30, W, H);
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const [sx, sy] = sourcePoint({ ...b, angle: 30, aspect: 'free' }, W, H, u, v);
      // The bounding box's corners are off the photo; its edge midpoints touch a corner.
      expect(sx < 0 || sx > 1 || sy < 0 || sy > 1).toBe(true);
    }
    expect(bounds(0, W, H)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('stops at the edge of the photo', () => {
    const start = crop({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    const out = constrain(start, { ...start, x: -0.3 }, 0, W, H);
    expect(out.x).toBeCloseTo(0, 6);
    const slid = move(start, -0.5, 0.2, W, H);
    expect(slid.x).toBeCloseTo(0, 6);
    expect(slid.y).toBeCloseTo(0.3, 9);
  });
});

describe('editing a crop', () => {
  it('keeps the largest crop largest while straightening', () => {
    const c = setAngle(FULL, 5, W, H);
    expect(c.angle).toBe(5);
    expect(c).toMatchObject(largest(1.5, 5, W, H));
    const back = setAngle(c, 0, W, H);
    expect(back).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('shrinks a smaller crop only as needed when straightening', () => {
    const small = crop({ x: 0.4, y: 0.4, w: 0.2, h: 0.2, aspect: 'free' });
    expect(setAngle(small, 10, W, H)).toMatchObject({ x: 0.4, w: 0.2 });
    const edge = crop({ x: 0, y: 0, w: 0.3, h: 0.3, aspect: 'free' });
    const turned = setAngle(edge, 10, W, H);
    expect(fits(turned, 10, W, H)).toBe(true);
    expect(turned.w).toBeLessThan(0.3);
  });

  it('holds an aspect, in pixels, in the frame\'s orientation', () => {
    const sq = setAspect(FULL, '1:1', W, H);
    expect(pixelRatio(sq, W, H)).toBeCloseTo(1, 9);
    expect(fits(sq, 0, W, H)).toBe(true);
    const portrait = rotateFrame(setAspect(FULL, '4:5', W, H), W, H);
    expect(pixelRatio(portrait, W, H)).toBeCloseTo(4 / 5, 9);
    expect(fits(portrait, 0, W, H)).toBe(true);
    const original = setAspect(crop({ x: 0.1, y: 0.1, w: 0.5, h: 0.3, aspect: 'free' }), 'original', W, H);
    expect(pixelRatio(original, W, H)).toBeCloseTo(1.5, 9);
  });

  it('resizes from a corner keeping the opposite corner and the aspect', () => {
    const start = crop({ ...largest(1.5, 0, W, H), aspect: '3:2' });
    const out = resize(start, 'se', -0.3, -0.1, W, H);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(pixelRatio(out, W, H)).toBeCloseTo(1.5, 9);
    expect(out.w).toBeCloseTo(0.9, 9);
  });

  it('resizes from a side about the middle when the aspect is held', () => {
    const start = crop({ x: 0.2, y: 0.2, w: 0.6, h: 0.6, aspect: '3:2' });
    const held = setAspect(start, '3:2', W, H);
    const out = resize(held, 'e', -0.1, 0, W, H);
    expect(out.x).toBeCloseTo(held.x, 12);
    expect(out.y + out.h / 2).toBeCloseTo(held.y + held.h / 2, 12);
    expect(pixelRatio(out, W, H)).toBeCloseTo(1.5, 9);
  });

  it('resizes freely without an aspect and never below the minimum or off the photo', () => {
    const start = crop({ x: 0.2, y: 0.2, w: 0.6, h: 0.6, aspect: 'free' });
    const taller = resize(start, 'n', 0, -0.1, W, H);
    expect(taller.y).toBeCloseTo(0.1, 12);
    expect(taller.h).toBeCloseTo(0.7, 12);
    expect(taller.w).toBeCloseTo(0.6, 12);
    const tiny = resize(start, 'w', 5, 0, W, H);
    expect(tiny.w).toBeGreaterThanOrEqual(0.02 - 1e-12);
    const out = resize(start, 'se', 1, 1, W, H);
    expect(fits(out, 0, W, H)).toBe(true);
  });
});

describe('crop in a recipe', () => {
  it('sizes the cropped frame in pixels', () => {
    expect(framePixels(null, W, H)).toEqual([W, H]);
    expect(framePixels(crop({ w: 0.5, h: 0.25 }), W, H)).toEqual([3000, 1000]);
  });

  it('reads crops from sidecars and treats a full frame as none', () => {
    expect(normalizeCrop(null)).toBeNull();
    expect(normalizeCrop({ x: 0, y: 0, w: 1, h: 1, angle: 0, aspect: 'original' })).toBeNull();
    expect(normalizeCrop({ x: 'a' })).toBeNull();
    const c = normalizeCrop({ x: 0.1, y: 0.2, w: 0.5, h: 0.5, angle: 90, aspect: 'nonsense' })!;
    expect(c.angle).toBe(45);
    expect(c.aspect).toBe('free');
    expect(isFull(c)).toBe(false);
  });
});

describe('turning and flipping', () => {
  const at = (c: Crop, u: number, v: number) => sourcePoint(c, W, H, u, v).map((x) => +x.toFixed(9));

  it('turns a quarter clockwise: the frame top left shows the source bottom left', () => {
    const c = turn(FULL, 1);
    expect(c.orient).toEqual({ turns: 1, flipH: false, flipV: false });
    expect(orientedSize(c, W, H)).toEqual([H, W]);
    expect(framePixels(c, W, H)).toEqual([H, W]);
    expect(at(c, 0, 0)).toEqual([0, 1]);
    expect(at(c, 1, 0)).toEqual([0, 0]);
    expect(at(c, 1, 1)).toEqual([1, 0]);
  });

  it('comes back after four turns, or a turn each way, with the crop where it was', () => {
    const c = crop({ x: 0.1, y: 0.2, w: 0.3, h: 0.4, angle: 5 });
    let t = c;
    for (let i = 0; i < 4; i++) t = turn(t, 1);
    expect(t.orient).toBeUndefined();
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(t[k]).toBeCloseTo(c[k], 12);
    const back = turn(turn(c, 1), -1);
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(back[k]).toBeCloseTo(c[k], 12);
    expect(isFull(turn(turn(FULL, 1), -1))).toBe(true);
  });

  it('keeps showing the same part of the photo when turned', () => {
    const c = crop({ x: 0.1, y: 0.2, w: 0.3, h: 0.4, angle: 7 });
    const t = turn(c, 1);
    // A clockwise turn puts the old bottom left corner of the frame at the top left.
    expect(at(t, 0, 0)).toEqual(at(c, 0, 1));
    expect(at(t, 1, 1)).toEqual(at(c, 1, 0));
    const a = turn(c, -1);
    expect(at(a, 0, 0)).toEqual(at(c, 1, 0));
  });

  it('mirrors the frame and the straightening', () => {
    const c = crop({ x: 0.1, y: 0.2, w: 0.3, h: 0.4, angle: 7 });
    const h = flip(c, 'h');
    expect(h.angle).toBe(-7);
    expect(at(h, 0, 0)).toEqual(at(c, 1, 0));
    expect(at(h, 0.25, 0.6)).toEqual(at(c, 0.75, 0.6));
    const v = flip(c, 'v');
    expect(at(v, 0.2, 0)).toEqual(at(c, 0.2, 1));
    expect(flip(h, 'h').orient).toBeUndefined();
  });

  it('turning a flipped photo keeps it flipped the same way on screen', () => {
    const c = turn(flip(FULL, 'h'), 1);
    expect(c.orient).toEqual({ turns: 1, flipH: false, flipV: true });
    // Same as turning first and flipping top to bottom.
    const d = flip(turn(FULL, 1), 'v');
    expect(at(c, 0.2, 0.3)).toEqual(at(d, 0.2, 0.3));
  });

  it('reads and writes orientation through sidecars', () => {
    const c = normalizeCrop(JSON.parse(JSON.stringify(turn(FULL, -1))))!;
    expect(c.orient).toEqual({ turns: 3, flipH: false, flipV: false });
    expect(normalizeCrop({ ...FULL, orient: { turns: 0, flipH: false, flipV: false } })).toBeNull();
    expect(normalizeCrop({ ...FULL, orient: { turns: 6, flipH: true } })!.orient).toEqual({ turns: 2, flipH: true, flipV: false });
  });
});

describe('film and custom ratios', () => {
  it('holds XPan and 6×7 frames', () => {
    const x = setAspect(FULL, 'xpan', W, H);
    expect(pixelRatio(x, W, H)).toBeCloseTo(65 / 24, 6);
    const p = rotateFrame(setAspect(FULL, '6x7', W, H), W, H);
    expect(pixelRatio(p, W, H)).toBeCloseTo(6 / 7, 6);
  });

  it('keeps a custom ratio, landscape or portrait', () => {
    const c = setAspect(FULL, 'custom', W, H, 2);
    expect(c.ratio).toBe(2);
    expect(pixelRatio(c, W, H)).toBeCloseTo(2, 6);
    expect(heldRatio(rotateFrame(c, W, H), W, H)).toBeCloseTo(0.5, 6);
    expect(normalizeCrop(JSON.parse(JSON.stringify(c)))!.ratio).toBe(2);
    expect(normalizeCrop({ ...c, ratio: undefined })!.aspect).toBe('free');
  });

  it('resizes freely when the ratio is unlocked', () => {
    const c = setAspect(FULL, '1:1', W, H);
    const r = resize(c, 'e', -0.1, 0, W, H, false);
    expect(r.h).toBeCloseTo(c.h, 12);
    expect(r.w).toBeCloseTo(c.w - 0.1, 12);
  });
});

describe('ratio labels', () => {
  it('names ratios simply', () => {
    expect(ratioLabel(6000 / 4000)).toBe('3:2');
    expect(ratioLabel(3 / 4)).toBe('4:3');
    expect(ratioLabel(65 / 24)).toBe('65:24');
    expect(ratioLabel(1)).toBe('1:1');
    expect(ratioLabel(1.2345)).toBe('1.23:1');
    expect(ratioLabel(6024 / 4024)).toBe('3:2');
  });
});
