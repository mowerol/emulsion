// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseCube, tetrahedral, writeCube, type Clut } from '../engine/lut3d';
import { matchPhotoLook, srgbToUcs, ucsToSrgb, type MatchImage } from './photomatch';

function hsv(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

/** A deterministic image with every hue, saturation and lightness, plus a grey ramp. */
function imageWith(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): MatchImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b] = pixel(x, y);
      data[i] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      data[i + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
      data[i + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function baseImage(width = 96, height = 96): MatchImage {
  let seed = 0x12345678;
  const ran = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  return imageWith(width, height, (x, y) => {
    const grey = (x + y * width) % (width * 3) === 0;
    if (grey) return [x / (width - 1), x / (width - 1), x / (width - 1)];
    return hsv(ran(), 0.12 + 0.88 * ran(), 0.06 + 0.94 * ran());
  });
}

const transform = (image: MatchImage, fn: (r: number, g: number, b: number) => [number, number, number]): MatchImage => ({
  ...image,
  data: (() => {
    const data = new Uint8Array(image.data.length);
    for (let i = 0; i < image.data.length; i += 4) {
      const [r, g, b] = fn(image.data[i] / 255, image.data[i + 1] / 255, image.data[i + 2] / 255);
      data[i] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      data[i + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
      data[i + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
      data[i + 3] = image.data[i + 3];
    }
    return data;
  })(),
});

const apply = (lut: Clut, image: MatchImage): MatchImage => ({
  ...image,
  data: (() => {
    const data = new Uint8Array(image.data.length);
    for (let i = 0; i < image.data.length; i += 4) {
      const out = tetrahedral(lut, [image.data[i] / 255, image.data[i + 1] / 255, image.data[i + 2] / 255]);
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(Math.min(1, Math.max(0, out[c])) * 255);
      data[i + 3] = image.data[i + 3];
    }
    return data;
  })(),
});

const luma = (image: MatchImage) => {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    sum += 0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2];
    n++;
  }
  return sum / n / 255;
};

const rgbSpread = (image: MatchImage) => {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2];
    sum += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    n++;
  }
  return sum / n;
};

const meanRB = (image: MatchImage) => {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    sum += (image.data[i] - image.data[i + 2]) / 255;
    n++;
  }
  return sum / n;
};

function paletteImage(shift: number, reverse = false, tint = false): MatchImage {
  const palette = [350, 80, 170, 260].map(h => h * Math.PI / 180);
  return imageWith(128, 80, (x, y) => {
    const j = .15 + .55 * y / 79, band = Math.min(3, Math.max(0, Math.floor((x - 32) / 24)));
    const h = palette[reverse ? 3 - band : band] + shift, c = x < 32 ? 0 : .012;
    const a = c * Math.cos(h) + (tint ? .006 : 0), b = c * Math.sin(h) + (tint ? .004 : 0);
    return ucsToSrgb(j, Math.hypot(a, b), Math.atan2(b, a));
  });
}

describe('matching a look from a photo', () => {
  it('transfers a shifted hue palette, including colours that cross the red seam', () => {
    const rotation = 20 * Math.PI / 180;
    const target = paletteImage(0), reference = paletteImage(rotation, true);
    const baseline = matchPhotoLook(target, reference, { matchHue: false }).lut;
    const match = matchPhotoLook(target, reference);
    const hueError = (lut: Clut) => {
      let error = 0, count = 0;
      for (let y = 10; y < 70; y += 5) for (let x = 40; x < 128; x += 8) {
        const i = (y * target.width + x) * 4;
        const rgb = [target.data[i] / 255, target.data[i + 1] / 255, target.data[i + 2] / 255];
        const h = srgbToUcs(rgb[0], rgb[1], rgb[2])[2];
        const mapped = tetrahedral(lut, rgb), out = srgbToUcs(mapped[0], mapped[1], mapped[2]);
        error += Math.abs(Math.atan2(Math.sin(out[2] - h - rotation), Math.cos(out[2] - h - rotation))); count++;
      }
      return error / count;
    };
    expect(hueError(baseline)).toBeGreaterThan(.2);
    expect(hueError(match.lut)).toBeLessThan(hueError(baseline) * .5);
    expect(match.report.hueShifts.some(h => Math.abs(h) > .1)).toBe(true);
  });

  it('retains the fitted neutral tint while shifting the coloured palette', () => {
    const target = paletteImage(0), reference = paletteImage(20 * Math.PI / 180, true, true);
    const baseline = matchPhotoLook(target, reference, { matchHue: false });
    const shifted = matchPhotoLook(target, reference);
    expect(shifted.report.hueShifts.some(h => Math.abs(h) > .03)).toBe(true);
    for (const v of [.1, .3, .5, .7, .9]) {
      const before = tetrahedral(baseline.lut, [v, v, v]), after = tetrahedral(shifted.lut, [v, v, v]);
      after.forEach((value, i) => expect(value).toBeCloseTo(before[i], 6));
    }
  });
  it('is the identity when the reference is the target', () => {
    const target = baseImage();
    const { lut } = matchPhotoLook(target, target);
    let worst = 0;
    for (let i = 0; i < target.data.length; i += 4) {
      const inp = [target.data[i] / 255, target.data[i + 1] / 255, target.data[i + 2] / 255];
      const out = tetrahedral(lut, inp);
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(out[c] - inp[c]));
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('copies the reference tone distribution, and can anchor it to the target exposure', () => {
    const target = baseImage();
    const reference = transform(target, (r, g, b) => [Math.pow(r, 0.75), Math.pow(g, 0.75), Math.pow(b, 0.75)]);
    const copy = apply(matchPhotoLook(target, reference).lut, target);
    const keep = apply(matchPhotoLook(target, reference, { keepExposure: true }).lut, target);
    expect(Math.abs(luma(copy) - luma(reference))).toBeLessThan(0.035);
    expect(Math.abs(luma(keep) - luma(target))).toBeLessThan(0.06);
    expect(luma(copy)).toBeGreaterThan(luma(keep));
  });

  it('copies a saturation change and a warm cast', () => {
    const target = baseImage();
    const reference = transform(target, (r, g, b) => {
      const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const boost = (v: number) => grey + (v - grey) * 1.35;
      return [boost(r) + 0.07, boost(g) + 0.02, boost(b) - 0.05];
    });
    const out = apply(matchPhotoLook(target, reference).lut, target);
    expect(rgbSpread(out)).toBeGreaterThan(rgbSpread(target) * 1.1);
    expect(meanRB(out)).toBeGreaterThan(meanRB(target));
    expect(Math.abs(meanRB(out) - meanRB(reference))).toBeLessThan(Math.abs(meanRB(target) - meanRB(reference)));
  });

  it('writes a valid .cube file the real parser reads back', () => {
    const target = baseImage(48, 48);
    const reference = transform(target, (r, g, b) => [r * 0.9, g * 0.95, b]);
    const { lut } = matchPhotoLook(target, reference, { level: 17 });
    const round = parseCube(writeCube(lut, 'Photo match'));
    expect(round.level).toBe(17);
    expect(round.data).toEqual(lut.data.map((v) => Number(v.toFixed(6))));
    expect(round.data.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('can match an achromatic reference without leaving a colour floor', () => {
    const target = baseImage();
    const reference = transform(target, (r, g, b) => {
      const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return [grey, grey, grey];
    });
    const out = apply(matchPhotoLook(target, reference).lut, target);
    expect(rgbSpread(out)).toBeLessThan(0.015);
    expect(Math.abs(luma(out) - luma(reference))).toBeLessThan(0.035);
  });

  it('ignores transparent pixels and rejects missing image data', () => {
    const target = baseImage(16, 16);
    const transparent = { ...target, data: new Uint8Array(target.data.length) };
    expect(() => matchPhotoLook(target, transparent)).toThrow('pixels');
    expect(() => matchPhotoLook(target, { ...target, data: [] })).toThrow('pixels');
    const data = Uint8Array.from(target.data);
    data[3] = 0;
    expect(matchPhotoLook(target, { ...target, data }, { level: 3 }).report.samples).toEqual([256, 255]);
  });

  it('keeps flat black, grey and white matches finite and neutral', () => {
    for (const v of [0, 0.5, 1]) {
      const flat = imageWith(16, 16, () => [v, v, v]);
      const { lut } = matchPhotoLook(flat, flat, { level: 9 });
      expect(lut.data.every(v => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
      for (const c of tetrahedral(lut, [v, v, v])) expect(c).toBeCloseTo(v, 2);
    }
  });

  it('keeps a heavily clipped two-tone reference finite without duplicate curve anchors', () => {
    const target = imageWith(64, 64, x => x < 32 ? [0, 0, 0] : [1, 1, 1]);
    const { lut } = matchPhotoLook(target, target, { level: 9 });
    expect(lut.data.every(Number.isFinite)).toBe(true);
    for (const v of [0, 0.2, 0.5, 0.8, 1]) for (const c of tetrahedral(lut, [v, v, v])) expect(c).toBeCloseTo(v, 2);
  });
});
