// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { FULL, aspectOfFrame, cameraFrame, framePixels, normalizeCrop, previewFrame, resolveFrame, sameFrame, savedCrop } from './crop';

const panorama = { x: 8 / 11662, y: 2221 / 8746, w: 11648 / 11662, h: 4304 / 8746 };
const tele = { x: 2608 / 11662, y: 1955 / 8746, w: 6448 / 11662, h: 4836 / 8746 };

it('resolves an explicit crop before the camera composition, then full sensor', () => {
  expect(resolveFrame(null, panorama)).toEqual(cameraFrame(panorama));
  expect(resolveFrame({ crop: null }, tele)).toEqual(cameraFrame(tele));
  expect(resolveFrame({ crop: FULL }, panorama)).toBe(FULL);
  expect(resolveFrame(null, null)).toBe(FULL);
  const user = { ...FULL, x: .2, y: .1, w: .5, h: .6, angle: 3 };
  expect(resolveFrame({ crop: user }, panorama)).toBe(user);
  expect(framePixels(resolveFrame(null, panorama), 11662, 8746)).toEqual([11648, 4304]);
  expect(framePixels(resolveFrame(null, tele), 11662, 8746)).toEqual([6448, 4836]);
});

it('keeps the baseline implicit and saves Full sensor through normalization', () => {
  const baseline = cameraFrame(panorama);
  expect(savedCrop(baseline, panorama)).toBeNull();
  expect(savedCrop({ ...baseline, aspect: 'free' }, panorama)).toBeNull();
  expect(savedCrop(FULL, panorama)).toEqual(FULL);
  expect(normalizeCrop(JSON.parse(JSON.stringify(savedCrop(FULL, panorama))))).toEqual(FULL);
  expect(savedCrop(FULL, null)).toBeNull();
  expect(sameFrame({ ...baseline, angle: 1 }, baseline)).toBe(false);
  expect(sameFrame({ ...baseline, orient: { turns: 1, flipH: false, flipV: false } }, baseline)).toBe(false);
});

it('recognizes the nine official aspect locks, including the portrait frame', () => {
  for (const [w, h, id] of [[11648, 8736, '4:3'], [11648, 7768, '3:2'], [11648, 6552, '16:9'],
    [11648, 4304, 'xpan'], [11648, 4112, '17:6'], [10928, 8736, '5:4'], [10192, 8736, '6x7'],
    [8736, 8736, '1:1'], [6544, 8736, '4:3']] as const) {
    const frame = { x: 0, y: 0, w: w / 11662, h: h / 8746 };
    expect(aspectOfFrame(frame, 11662, 8746)).toBe(id);
    expect(cameraFrame(frame, 11662, 8746).aspect).toBe(id);
  }
});

it('crops native-area previews and leaves an already aspect-cropped preview intact', () => {
  const framing = { rect: [0, 2216 / 8736, 1, 4304 / 8736] as [number, number, number, number], width: 11648, height: 8736, aspect: '65:24', tele: null };
  expect(previewFrame(framing, 4000, 3000)?.h).toBeCloseTo(4304 / 8736);
  expect(previewFrame(framing, 4000, 1480)).toBeNull();
  expect(previewFrame(null, 4000, 3000)).toBeNull();
  const tele = { ...framing, rect: [.22, .22, .55, .55] as [number, number, number, number], aspect: '4:3', tele: 63 };
  expect(previewFrame(tele, 4000, 3000)?.w).toBe(.55);
});
