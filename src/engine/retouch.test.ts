// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { NO_SCALES, RetouchCache, circleArea, reducedRegion, retouch, retouchInputs, retouchReduced, retouchRegion, spotDelta, spotMask, type RetouchSetup } from './retouch';
import { PATCH_SIZE, preRetouchKey, type Patch, type PatchRequest } from './remove';
import { defaultRecipe } from '../film/recipe';
import { applyPreset } from '../film/presets';
import { initialSource, newCircleSpot, normalizeRetouch, type RetouchSpot } from '../film/retouch';

/** A w × h RGBA test photo: a ramp with stripes, and a dark blemish at (bx, by). */
function photo(w: number, h: number, bx = -99, by = -99, br = 3) {
  const img = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 0.2 + 0.5 * (x / w) + 0.1 * ((x >> 2) % 2);
    const dark = Math.hypot(x - bx, y - by) <= br ? 0.15 : 1;
    img.set([v * dark, 0.8 * v * dark, 0.6 * v * dark, 1], 4 * (y * w + x));
  }
  return img;
}
const px = (img: Float32Array, w: number, x: number, y: number) => Array.from(img.subarray(4 * (y * w + x), 4 * (y * w + x) + 3));
const spot = (s: Partial<RetouchSpot> & { center: [number, number]; source: [number, number]; radius?: number; border?: number }): RetouchSpot =>
  ({ ...newCircleSpot(s.center, s.tool ?? 'heal', s.radius ?? 0.05, s.border ?? 0.02, s.source), ...(s.opacity !== undefined ? { opacity: s.opacity } : {}) });

describe('retouch spots (darktable retouch.c)', () => {
  it("measures a circle's area as darktable does, from points on its outer edge", () => {
    const a = circleArea([0.5, 0.5], 0.1, 200, 100);
    // Radius 10 px about (100, 50), 62 points: none lands exactly on the bottom, so the height truncates to 19.
    expect(a).toEqual({ x: 90, y: 40, w: 20, h: 19 });
  });

  it("fills a circle's mask with darktable's quadratic feather", () => {
    const { roi, mask } = spotMask({ kind: 'circle', center: [0.5, 0.5], radius: 0.05, border: 0.05 }, 200, 200);
    const at = (x: number, y: number) => mask[(y - roi.y) * roi.w + x - roi.x];
    expect(at(100, 100)).toBe(1);
    expect(at(109, 100)).toBe(1);
    // Half way across the feather (r² 100 to 400): ((400 − 225) / 300)².
    expect(at(115, 100)).toBeCloseTo(((400 - 225) / 300) ** 2, 6);
    expect(at(100, 80)).toBe(0);
  });

  it('measures the source offset at the working scale', () => {
    const s = spot({ center: [0.5, 0.5], source: [0.25, 0.75] });
    expect(spotDelta(s, 400, 200, 0.5)).toEqual([50, -25]);
  });

  it('starts a circle\'s source right of it and up by its radius, as darktable does', () => {
    expect(initialSource({ kind: 'circle', center: [0.5, 0.5], radius: 0.02, border: 0.02 })).toEqual([0.52, 0.48]);
  });

  it('clones the source pixels inside the circle exactly, leaves the rest', () => {
    const w = 80, h = 60;
    const img = photo(w, h, 40, 30);
    const before = img.slice();
    retouch(img, { x: 0, y: 0, w, h }, w, h, 1, [spot({ tool: 'clone', center: [0.5, 0.5], source: [0.25, 0.5], radius: 0.08, border: 0.02 })]);
    // The centre now holds what was 20 px to the left.
    expect(px(img, w, 40, 30)).toEqual(px(before, w, 20, 30));
    expect(px(img, w, 5, 5)).toEqual(px(before, w, 5, 5));
  });

  it('heals a blemish: the patch takes its surroundings\' level', () => {
    const w = 80, h = 60;
    const img = photo(w, h, 40, 30);
    const clean = photo(w, h);
    retouch(img, { x: 0, y: 0, w, h }, w, h, 1, [spot({ center: [0.5, 0.5], source: [0.3, 0.5], radius: 0.08, border: 0.02 })]);
    for (const [x, y] of [[40, 30], [38, 31], [42, 29]]) {
      const got = px(img, w, x, y), want = px(clean, w, x, y);
      for (let c = 0; c < 3; c++) expect(Math.abs(got[c] - want[c])).toBeLessThan(0.06);
    }
  });

  it('runs spots in order, each on the result of the ones before', () => {
    const w = 80, h = 60;
    const a = spot({ tool: 'clone', center: [0.5, 0.5], source: [0.2, 0.5], radius: 0.06 });
    // The second clones from where the first wrote.
    const b = spot({ tool: 'clone', center: [0.8, 0.5], source: [0.5, 0.5], radius: 0.03, border: 0.01 });
    const img = photo(w, h);
    const before = img.slice();
    retouch(img, { x: 0, y: 0, w, h }, w, h, 1, [a, b]);
    expect(px(img, w, 64, 30)).toEqual(px(before, w, 16, 30));
  });

  it('gives the same pixels on the region the spots touch as on the whole photo', () => {
    const W = 400, H = 300, scale = 0.5, w = 200, h = 150;
    const spots = [
      spot({ center: [0.4, 0.5], source: [0.6, 0.45], radius: 0.04 }),
      spot({ tool: 'clone', center: [0.2, 0.2], source: [0.25, 0.3], radius: 0.03, opacity: 0.7 }),
      spot({ center: [0.98, 0.02], source: [0.9, 0.1], radius: 0.05 }),
    ];
    const whole = photo(w, h, 80, 75);
    const part = whole.slice();
    retouch(whole, { x: 0, y: 0, w, h }, W, H, scale, spots);
    const r = retouchRegion(spots, W, H, scale, w, h)!;
    const sub = new Float32Array(4 * r.w * r.h);
    for (let y = 0; y < r.h; y++) sub.set(part.subarray(4 * ((r.y + y) * w + r.x), 4 * ((r.y + y) * w + r.x + r.w)), 4 * y * r.w);
    retouch(sub, r, W, H, scale, spots);
    for (let y = 0; y < r.h; y++) sub.subarray(4 * y * r.w, 4 * (y + 1) * r.w).forEach((v, i) => part[4 * ((r.y + y) * w + r.x) + i] = v);
    expect(Array.from(part)).toEqual(Array.from(whole));
    expect(r.w * r.h).toBeLessThan(w * h);
  });

  it('gives the same pixels from its cache while one spot moves and the others stay', () => {
    const w = 120, h = 90;
    const others = [
      spot({ center: [0.2, 0.3], source: [0.3, 0.3], radius: 0.05 }),
      spot({ tool: 'clone', center: [0.8, 0.7], source: [0.7, 0.6], radius: 0.04 }),
      // Reads where the moving spot lands on some frames.
      spot({ center: [0.55, 0.5], source: [0.45, 0.5], radius: 0.05 }),
    ];
    const cache = new RetouchCache();
    for (let i = 0; i < 6; i++) {
      const moving = spot({ center: [0.35 + i * 0.03, 0.5], source: [0.35 + i * 0.03, 0.2], radius: 0.05 });
      const spots = [moving, ...others];
      const plain = photo(w, h, 60, 45);
      const cached = plain.slice();
      retouch(plain, { x: 0, y: 0, w, h }, w, h, 1, spots);
      retouch(cached, { x: 0, y: 0, w, h }, w, h, 1, spots, undefined, cache);
      expect(Array.from(cached)).toEqual(Array.from(plain));
    }
  });

  it('skips a spot whose source is itself', () => {
    const w = 40, h = 40;
    const img = photo(w, h, 20, 20);
    const before = img.slice();
    retouch(img, { x: 0, y: 0, w, h }, w, h, 1, [spot({ center: [0.5, 0.5], source: [0.5, 0.5] })]);
    expect(img).toEqual(before);
    expect(retouchRegion([spot({ center: [0.5, 0.5], source: [0.5, 0.5] })], w, h, 1, w, h)).toBeNull();
  });

  it('reads spots back from a sidecar, dropping broken ones', () => {
    const good = spot({ center: [0.5, 0.5], source: [0.4, 0.4] });
    const out = normalizeRetouch([good, { tool: 'heal', shape: { kind: 'circle' }, source: [0, 0] }, { shape: good.shape }, 'x', { ...good, tool: 'paint', opacity: 4 }]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(good);
    expect(out[1].tool).toBe('heal');
    expect(out[1].opacity).toBe(1);
    expect(normalizeRetouch(undefined)).toEqual([]);
  });
});

describe('retouch at a zoomed-out view (retouchReduced)', () => {
  it('is retouch itself at k = 1', () => {
    const w = 80, h = 60;
    const spots = [spot({ center: [0.5, 0.5], source: [0.3, 0.5], radius: 0.08 })];
    const a = photo(w, h, 40, 30), b = a.slice();
    retouch(a, { x: 0, y: 0, w, h }, w, h, 1, spots);
    retouchReduced(b, { x: 0, y: 0, w, h }, w, h, 1, spots, 1);
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it('leaves every pixel outside the spots exactly alone, and heals inside them as the full size does, seen at 1/4', () => {
    const W = 400, H = 300;
    const spots = [spot({ center: [0.5, 0.5], source: [0.3, 0.5], radius: 0.06, border: 0.02 })];
    const full = photo(W, H, 200, 150, 10);
    const before = full.slice();
    const reduced = full.slice();
    retouch(full, { x: 0, y: 0, w: W, h: H }, W, H, 1, spots);
    const k = 4;
    const r = reducedRegion(spots, W, H, 1, W, H, k)!;
    expect(r.x % k).toBe(0);
    const sub = new Float32Array(4 * r.w * r.h);
    for (let y = 0; y < r.h; y++) sub.set(reduced.subarray(4 * ((r.y + y) * W + r.x), 4 * ((r.y + y) * W + r.x + r.w)), 4 * y * r.w);
    retouchReduced(sub, r, W, H, 1, spots, k);
    for (let y = 0; y < r.h; y++) reduced.set(sub.subarray(4 * y * r.w, 4 * (y + 1) * r.w), 4 * ((r.y + y) * W + r.x));
    // Outside the spot's outer edge (radius + feather, 0.08 × 300 = 24 px) nothing moved.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (Math.hypot(x - 200, y - 150) < 24 + k * 2) continue;
      const i = 4 * (y * W + x);
      expect(reduced[i]).toBe(before[i]);
    }
    // Seen as the view sees it (4 × 4 averages), the healed spot matches the full-size heal.
    const avg = (img: Float32Array, X: number, Y: number) => {
      let s = 0;
      for (let y = Y * k; y < Y * k + k; y++) for (let x = X * k; x < X * k + k; x++) s += img[4 * (y * W + x)];
      return s / (k * k);
    };
    let worst = 0;
    for (let Y = 33; Y < 42; Y++) for (let X = 45; X < 55; X++) worst = Math.max(worst, Math.abs(avg(reduced, X, Y) - avg(full, X, Y)));
    expect(worst).toBeLessThan(0.03);
    // And the blemish is gone in both.
    expect(avg(reduced, 50, 37)).toBeGreaterThan(0.4);
  });
});

describe('Remove spots in the recipe', () => {
  it('reads a Remove spot back from a sidecar, and leaves older spots as they were', () => {
    const old = spot({ center: [0.5, 0.5], source: [0.4, 0.4] });
    const remove = { ...spot({ tool: 'remove', center: [0.3, 0.3], source: [0.3, 0.3] }), scale: 4 };
    const [a, b] = normalizeRetouch([old, remove]);
    expect(a).toEqual(old);
    expect(b.tool).toBe('remove');
    // Remove works on the photo itself, never a wavelet scale.
    expect(b.scale).toBe(0);
  });
});

/** The patches a test puts in (by spot id, as RemoveSetup holds them), and what the step asks for. */
class FakePatches {
  patches = new Map<string, Patch>();
  requests: PatchRequest[] = [];
  /** Answers every request so far with a flat 8-bit sRGB grey. */
  fill(grey: number) {
    for (const r of this.requests) this.patches.set(r.spot, { key: r.key, crop: r.crop, pixels: flat(grey) });
    this.requests.length = 0;
  }
}
const flat = (g: number) => {
  const p = new Uint8Array(4 * PATCH_SIZE * PATCH_SIZE).fill(g);
  for (let i = 3; i < p.length; i += 4) p[i] = 255;
  return p;
};
/** sRGB 128 in linear light. */
const GREY128 = 0.2158605;
const removeSetup = (fake: FakePatches, extra: Partial<NonNullable<RetouchSetup['remove']>> = {}): RetouchSetup =>
  ({ ...NO_SCALES, remove: { patches: fake.patches, requests: fake.requests, base: 'photo', model: 'lama-hash', previewScale: 1, ...extra } });
const removeSpot = (center: [number, number], radius = 0.05, border = 0.05, opacity = 1): RetouchSpot =>
  ({ ...newCircleSpot(center, 'remove', radius, border, center), opacity });

describe('Remove spots in the retouch step', () => {
  it('composites its patch inside its shape with its feather and opacity', () => {
    const w = 200, h = 200;
    const patches = new FakePatches();
    const spots = [removeSpot([0.5, 0.5], 0.05, 0.05, 0.5)];
    const setup = removeSetup(patches);
    retouch(photo(w, h), { x: 0, y: 0, w, h }, w, h, 1, spots, undefined, undefined, undefined, setup);
    patches.fill(128);
    const img = photo(w, h);
    const before = img.slice();
    retouch(img, { x: 0, y: 0, w, h }, w, h, 1, spots, undefined, undefined, undefined, setup);
    const mix = (x: number, y: number, k: number) => px(before, w, x, y).map((v) => v * (1 - k) + GREY128 * k);
    const near = (a: number[], b: number[]) => a.forEach((v, c) => expect(v).toBeCloseTo(b[c], 5));
    // Inside the radius the mask is 1, so half the patch at opacity 0.5.
    near(px(img, w, 100, 100), mix(100, 100, 0.5));
    // Half way across the feather: darktable's quadratic falloff, ((400 − 225) / 300)².
    near(px(img, w, 115, 100), mix(115, 100, 0.5 * ((400 - 225) / 300) ** 2));
    // Outside the feather, untouched.
    expect(px(img, w, 100, 75)).toEqual(px(before, w, 100, 75));
    expect(patches.requests).toEqual([]);
  });

  it('leaves its input unchanged and asks for the crop it needs while the patch is not ready', () => {
    const w = 200, h = 200;
    const patches = new FakePatches();
    const img = new Float32Array(4 * w * h).fill(GREY128);
    const before = img.slice();
    retouch(img, { x: 0, y: 0, w, h }, w, h, 1, [removeSpot([0.5, 0.5])], undefined, undefined, undefined, removeSetup(patches));
    expect(img).toEqual(before);
    expect(patches.requests).toHaveLength(1);
    const [r] = patches.requests;
    // A photo at most 800 pixels on its longer side is inpainted whole (IOPaint).
    expect(r.crop).toEqual({ x: 0, y: 0, w, h });
    expect(r.source).toBe('full');
    // Running on the full size, the step hands over the model's input: 512 × 512 sRGB and its mask.
    expect(r.input!.image).toHaveLength(4 * PATCH_SIZE * PATCH_SIZE);
    expect(Array.from(r.input!.image.subarray(0, 4))).toEqual([128, 128, 128, 255]);
    const m = (x: number, y: number) => r.input!.mask[y * PATCH_SIZE + x];
    expect(m(256, 256)).toBe(255);
    expect(m(5, 5)).toBe(0);
  });

  it('asks the model to fill the whole feather it blends, not only the mask over half', () => {
    const w = 200, h = 200;
    const patches = new FakePatches();
    // Radius 10 px, feather 10 px: pixel 118, 18 px from the centre, is ((400 − 324) / 300)², about
    // 0.064 (16 of 255: under IOPaint's 127).
    retouch(photo(w, h), { x: 0, y: 0, w, h }, w, h, 1, [removeSpot([0.5, 0.5], 0.05, 0.05)], undefined, undefined, undefined, removeSetup(patches));
    const { input } = patches.requests[0];
    // The 200-pixel photo is 512 cells: pixel 118 is cells 302 to 304.
    expect(input!.mask[256 * PATCH_SIZE + 303]).toBe(255);
    expect(input!.mask[256 * PATCH_SIZE + 330]).toBe(0);
  });

  it('asks without the input when the run is not on the source that feeds the model', () => {
    const W = 4000, H = 4000;
    const patches = new FakePatches();
    // A small spot: its crop is under 512 preview pixels, so the full size must feed the model.
    const spots = [removeSpot([0.5, 0.5], 0.01, 0.001)];
    const setup = removeSetup(patches, { previewScale: 0.25 });
    const w = 1000, h = 1000;
    retouch(photo(w, h), { x: 0, y: 0, w, h }, W, H, 0.25, spots, undefined, undefined, undefined, setup);
    expect(patches.requests).toHaveLength(1);
    expect(patches.requests[0].source).toBe('full');
    expect(patches.requests[0].input).toBeUndefined();
  });

  it('shows its last patch, made for another key, while still asking for the new patch', () => {
    const w = 200, h = 200;
    const patches = new FakePatches();
    const s = removeSpot([0.5, 0.5]);
    patches.patches.set(s.id, { key: 'older', crop: { x: 0, y: 0, w, h }, pixels: flat(128) });
    const img = photo(w, h);
    retouch(img, { x: 0, y: 0, w, h }, w, h, 1, [s], undefined, undefined, undefined, removeSetup(patches));
    expect(px(img, w, 100, 100)[0]).toBeCloseTo(GREY128, 5);
    expect(patches.requests).toHaveLength(1);
  });

  it('leaves the photo alone without a Remove setup', () => {
    const w = 80, h = 60;
    const img = photo(w, h);
    const before = img.slice();
    retouch(img, { x: 0, y: 0, w, h }, w, h, 1, [removeSpot([0.5, 0.5])]);
    expect(img).toEqual(before);
  });
});

describe('Remove spots in order with the other spots', () => {
  const w = 200, h = 200, all = { x: 0, y: 0, w, h };
  /** Runs `spots` twice on `make()`: once to collect the requests, once with every patch a flat sRGB 128. */
  const developed = (make: () => Float32Array, spots: RetouchSpot[]) => {
    const patches = new FakePatches();
    const setup = removeSetup(patches);
    retouch(make(), all, w, h, 1, spots, undefined, undefined, undefined, setup);
    patches.fill(128);
    const img = make();
    retouch(img, all, w, h, 1, spots, undefined, undefined, undefined, setup);
    return img;
  };

  it('lets a Clone after a Remove copy the patch', () => {
    const remove = removeSpot([0.5, 0.5], 0.08, 0.02);
    const clone = spot({ tool: 'clone', center: [0.2, 0.2], source: [0.5, 0.5], radius: 0.03, border: 0.01 });
    const img = developed(() => photo(w, h), [remove, clone]);
    px(img, w, 40, 40).forEach((v) => expect(v).toBeCloseTo(GREY128, 5));
  });

  it('lets a Heal after a Remove read the patched pixels', () => {
    const remove = removeSpot([0.5, 0.5], 0.08, 0.02);
    const heal = spot({ center: [0.25, 0.5], source: [0.5, 0.5], radius: 0.05, border: 0.02 });
    const both = developed(() => photo(w, h), [remove, heal]);
    // The same as healing the photo once the Remove spot has been applied.
    const first = developed(() => photo(w, h), [remove]);
    retouch(first, all, w, h, 1, [heal]);
    expect(Array.from(both)).toEqual(Array.from(first));
    const healOnly = photo(w, h);
    retouch(healOnly, all, w, h, 1, [heal]);
    expect(px(both, w, 50, 100)).not.toEqual(px(healOnly, w, 50, 100));
  });

  it('gives the model what a Clone before it left there', () => {
    const grey = () => {
      const img = new Float32Array(4 * w * h).fill(GREY128);
      // A black square where the clone reads.
      for (let y = 30; y < 70; y++) for (let x = 20; x < 60; x++) img.set([0, 0, 0, 1], 4 * (y * w + x));
      return img;
    };
    const clone = spot({ tool: 'clone', center: [0.5, 0.5], source: [0.2, 0.25], radius: 0.05, border: 0.01 });
    const remove = removeSpot([0.5, 0.5], 0.08, 0.02);
    const asked = (spots: RetouchSpot[]) => {
      const patches = new FakePatches();
      retouch(grey(), all, w, h, 1, spots, undefined, undefined, undefined, removeSetup(patches));
      return patches.requests[0];
    };
    const centre = (r: PatchRequest) => Array.from(r.input!.image.subarray(4 * (256 * PATCH_SIZE + 256), 4 * (256 * PATCH_SIZE + 256) + 3));
    expect(centre(asked([clone, remove]))).toEqual([0, 0, 0]);
    expect(centre(asked([remove]))).toEqual([128, 128, 128]);
    expect(asked([clone, remove]).key).not.toBe(asked([remove]).key);
  });
});

describe("a Remove spot's patch key", () => {
  const W = 4000, H = 4000, scale = 0.125, w = 500, h = 500;
  const keyOf = (spots: RetouchSpot[], extra: Partial<NonNullable<RetouchSetup['remove']>> = {}) => {
    const patches = new FakePatches();
    retouch(photo(w, h), { x: 0, y: 0, w, h }, W, H, scale, spots, undefined, undefined, undefined, removeSetup(patches, extra));
    return patches.requests[patches.requests.length - 1].key;
  };
  const remove = removeSpot([0.5, 0.5], 0.02, 0.002);
  const under = spot({ tool: 'clone', center: [0.5, 0.5], source: [0.3, 0.3], radius: 0.01, border: 0.002 });
  const far = spot({ center: [0.1, 0.1], source: [0.15, 0.1], radius: 0.01, border: 0.002 });

  it('changes with the spot\'s shape, the edits before the step and the model', () => {
    const k = keyOf([remove]);
    expect(keyOf([{ ...remove, shape: { ...remove.shape, center: [0.51, 0.5] } as RetouchSpot['shape'] }])).not.toBe(k);
    expect(keyOf([remove], { base: 'other photo' })).not.toBe(k);
    expect(keyOf([remove], { model: 'another model' })).not.toBe(k);
  });

  it('changes with an earlier spot under it, not one elsewhere or a later one', () => {
    const k = keyOf([remove]);
    expect(keyOf([under, remove])).not.toBe(k);
    expect(keyOf([{ ...under, opacity: 0.5 }, remove])).not.toBe(keyOf([under, remove]));
    expect(keyOf([far, remove])).toBe(k);
    expect(keyOf([remove, under])).toBe(k);
  });

  it('is the same for a copy of the spot, at any opacity, on the preview or the full size, and in a region', () => {
    const k = keyOf([under, remove]);
    expect(keyOf([{ ...under, id: 'x' }, { ...remove, id: 'y', opacity: 0.4 }])).toBe(k);
    const patches = new FakePatches();
    const fw = 600, fh = 600, ox = 1700, oy = 1700;
    retouch(photo(fw, fh), { x: ox, y: oy, w: fw, h: fh }, W, H, 1, [remove], undefined, undefined, undefined, removeSetup(patches, { spots: [far, under, remove] }));
    expect(patches.requests[0].key).toBe(k);
  });

  it('follows lens correction, camera profile, white balance, noise reduction and capture sharpening, not Exposure or the look', () => {
    const r = defaultRecipe();
    const k = preRetouchKey('photo.raf', r);
    for (const changed of [
      { ...r, lens: { enabled: false, distortion: true, ca: true, vignette: true, distortionAmount: 1, redAmount: 1, blueAmount: 1, vignetteAmount: 1 } },
      { ...r, profile: 'standard' as const },
      { ...r, wb: { temperature: 4000, tint: 10 } },
      { ...r, noiseReduction: { enabled: true, amount: 50, model: 'rawnind-linear-v1' as const } },
      { ...r, captureSharpening: 20 },
    ]) expect(preRetouchKey('photo.raf', changed)).not.toBe(k);
    for (const same of [
      { ...r, exposure: 1.5 }, { ...r, contrast: 30 }, { ...r, lookAmount: 40 }, { ...r, stock: 'portra400' as typeof r.stock }, { ...r, dehaze: 50 },
      // Noise reduction switched off is the same as none.
      { ...r, noiseReduction: { enabled: false, amount: 80, model: 'rawnind-linear-v1' as const } },
    ]) expect(preRetouchKey('photo.raf', same)).toBe(k);
    expect(preRetouchKey('other.raf', r)).not.toBe(k);
  });
});

describe('Remove spots in a region and in presets', () => {
  it('gives the same pixels on the region the spots touch as on the whole photo', () => {
    const W = 2000, H = 1500, scale = 0.5, w = 1000, h = 750;
    const spots = [
      spot({ tool: 'clone', center: [0.4, 0.5], source: [0.45, 0.3], radius: 0.03, border: 0.01 }),
      removeSpot([0.42, 0.5], 0.04, 0.02, 0.8),
      spot({ center: [0.8, 0.2], source: [0.7, 0.25], radius: 0.03 }),
    ];
    const patches = new FakePatches();
    const setup = removeSetup(patches);
    retouch(photo(w, h), { x: 0, y: 0, w, h }, W, H, scale, spots, undefined, undefined, undefined, setup);
    // A patch with detail in it, so a misplaced resample would show.
    for (const req of patches.requests) {
      const p = flat(0);
      for (let i = 0; i < PATCH_SIZE * PATCH_SIZE; i++) p.set([i % 251, (i >> 9) % 256, (i * 7) % 256, 255], 4 * i);
      patches.patches.set(req.spot, { key: req.key, crop: req.crop, pixels: p });
    }
    const whole = photo(w, h);
    const part = whole.slice();
    retouch(whole, { x: 0, y: 0, w, h }, W, H, scale, spots, undefined, undefined, undefined, setup);
    const r = retouchRegion(spots, W, H, scale, w, h)!;
    const sub = new Float32Array(4 * r.w * r.h);
    for (let y = 0; y < r.h; y++) sub.set(part.subarray(4 * ((r.y + y) * w + r.x), 4 * ((r.y + y) * w + r.x + r.w)), 4 * y * r.w);
    retouch(sub, r, W, H, scale, spots, undefined, undefined, undefined, setup);
    for (let y = 0; y < r.h; y++) part.set(sub.subarray(4 * y * r.w, 4 * (y + 1) * r.w), 4 * ((r.y + y) * w + r.x));
    expect(Array.from(part)).toEqual(Array.from(whole));
    expect(whole).not.toEqual(photo(w, h));
  });

  it('gives the same pixels and key in a partial view, given the photo\'s whole spot list', () => {
    const W = 2000, H = 1500, scale = 0.5, w = 1000, h = 750;
    const remove = removeSpot([0.5, 0.5], 0.02, 0.01);
    // In the Remove spot's crop (so in its key) but outside the view, so retouchInputs leaves it out.
    const clone = spot({ tool: 'clone', center: [0.54, 0.5], source: [0.6, 0.6], radius: 0.01, border: 0.002 });
    const spots = [clone, remove];
    const patches = new FakePatches();
    const setup = removeSetup(patches, { spots });
    retouch(photo(w, h), { x: 0, y: 0, w, h }, W, H, scale, spots, undefined, undefined, undefined, setup);
    patches.fill(90);
    const whole = photo(w, h);
    retouch(whole, { x: 0, y: 0, w, h }, W, H, scale, spots, undefined, undefined, undefined, setup);
    const view = { x: 480, y: 360, w: 30, h: 30 };
    const { region: r, spots: cut } = retouchInputs(spots, view, W, H, scale, w, h);
    expect(cut).toEqual([remove]);
    const part = photo(w, h);
    const sub = new Float32Array(4 * r.w * r.h);
    for (let y = 0; y < r.h; y++) sub.set(part.subarray(4 * ((r.y + y) * w + r.x), 4 * ((r.y + y) * w + r.x + r.w)), 4 * y * r.w);
    retouch(sub, r, W, H, scale, cut, undefined, undefined, undefined, setup);
    // The key is made from the whole list, so the patch is the spot's own and nothing is asked for.
    expect(patches.requests).toEqual([]);
    for (let y = view.y; y < view.y + view.h; y++) for (let x = view.x; x < view.x + view.w; x++)
      expect(px(sub, r.w, x - r.x, y - r.y)).toEqual(px(whole, w, x, y));
    // Without the whole list, the cut-down one gives another key.
    const alone = new FakePatches();
    alone.patches = patches.patches;
    retouch(sub.slice(), r, W, H, scale, cut, undefined, undefined, undefined, removeSetup(alone));
    expect(alone.requests).toHaveLength(1);
  });

  it('blends its patch back through a zoomed-out view (retouchReduced, k > 1), the same on its region', () => {
    const W = 4000, H = 3000, scale = 0.25, w = 1000, h = 750, k = 2;
    const spots = [removeSpot([0.5, 0.5], 0.03, 0.01)];
    const patches = new FakePatches();
    const setup = removeSetup(patches, { previewScale: 0.25 });
    retouchReduced(photo(w, h), { x: 0, y: 0, w, h }, W, H, scale, spots, k, undefined, setup);
    patches.fill(128);
    const whole = photo(w, h);
    const before = whole.slice();
    retouchReduced(whole, { x: 0, y: 0, w, h }, W, H, scale, spots, k, undefined, setup);
    expect(patches.requests).toEqual([]);
    // Far outside, untouched; inside the radius, the patch. (Opacity under 1 is left out: the
    // upscale blends by coverage, mask × opacity, over a result that already holds it, as for
    // every tool.)
    expect(px(whole, w, 100, 100)).toEqual(px(before, w, 100, 100));
    const flatPhoto = new Float32Array(4 * w * h).fill(0.5);
    retouchReduced(flatPhoto, { x: 0, y: 0, w, h }, W, H, scale, spots, k, undefined, setup);
    px(flatPhoto, w, 500, 375).forEach((v) => expect(v).toBeCloseTo(GREY128, 5));
    const r = reducedRegion(spots, W, H, scale, w, h, k)!;
    const part = photo(w, h);
    const sub = new Float32Array(4 * r.w * r.h);
    for (let y = 0; y < r.h; y++) sub.set(part.subarray(4 * ((r.y + y) * w + r.x), 4 * ((r.y + y) * w + r.x + r.w)), 4 * y * r.w);
    retouchReduced(sub, r, W, H, scale, spots, k, undefined, setup);
    for (let y = 0; y < r.h; y++) part.set(sub.subarray(4 * y * r.w, 4 * (y + 1) * r.w), 4 * ((r.y + y) * w + r.x));
    expect(Array.from(part)).toEqual(Array.from(whole));
  });

  it('is never pasted by a preset', () => {
    const source = { ...defaultRecipe(), exposure: 1, retouch: [removeSpot([0.5, 0.5])] };
    const target = { ...defaultRecipe(), retouch: [] };
    const out = applyPreset({ version: 1, id: '00000000-0000-0000-0000-000000000000', name: 'p', groups: ['Exposure', 'Detail', 'Treatment'], recipe: source }, target);
    expect(out.exposure).toBe(1);
    expect(out.retouch).toEqual([]);
  });
});
