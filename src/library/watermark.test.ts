// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { blendWatermark, normalizeWatermark, WATERMARK_DEFAULTS, WATERMARK_POSITIONS, watermarkBounds, watermarkError } from './watermark';

it('keeps watermarking off for old settings and repairs invalid saved values', () => {
  expect(normalizeWatermark(null)).toEqual(WATERMARK_DEFAULTS);
  expect(normalizeWatermark({ enabled: 'yes', kind: 'other', size: Infinity, opacity: 500, inset: -1, position: 'outside', image: 'https://example.com/logo.png' }))
    .toEqual({ ...WATERMARK_DEFAULTS, opacity: 100, inset: 0 });
  expect(normalizeWatermark({ text: 'Name\nCopyright', size: 0, color: 'pink' })).toMatchObject({ text: 'Name Copyright', size: 5, color: 'white' });
  expect(normalizeWatermark({ image: 'data:image/png;base64,YQ==', imageName: 'logo.png' }).image).toBe('data:image/png;base64,YQ==');
});

it('requires content only when watermarking is enabled, using the chosen mode', () => {
  expect(watermarkError(WATERMARK_DEFAULTS)).toBeNull();
  expect(watermarkError({ ...WATERMARK_DEFAULTS, enabled: true, text: '  ' })).toContain('text');
  expect(watermarkError({ ...WATERMARK_DEFAULTS, enabled: true, text: '© Photographer' })).toBeNull();
  expect(watermarkError({ ...WATERMARK_DEFAULTS, enabled: true, kind: 'image', text: 'Name' })).toContain('image');
});

it('anchors to the final frame and scales with its shorter edge, including portrait and tall logos', () => {
  const s = { ...WATERMARK_DEFAULTS, size: 30, inset: 3 };
  expect(watermarkBounds(3000, 2000, 4, s)).toEqual({ width: 600, height: 150, x: 2340, y: 1790 });
  expect(watermarkBounds(2000, 3000, 4, s)).toEqual({ width: 600, height: 150, x: 1340, y: 2790 });
  expect(watermarkBounds(300, 200, 4, s)).toEqual({ width: 60, height: 15, x: 234, y: 179 });
  expect(watermarkBounds(3000, 2000, 0.1, s)).toEqual({ width: 188, height: 1880, x: 2752, y: 60 });
  for (const [position] of WATERMARK_POSITIONS) {
    const b = watermarkBounds(300, 200, 4, { ...s, position });
    expect(b.x).toBe(position.endsWith('left') ? 6 : position.endsWith('right') ? 234 : 120);
    expect(b.y).toBe(position.startsWith('top') ? 6 : position.startsWith('bottom') ? 179 : 93);
    const tiny = watermarkBounds(1, 1, 0.01, { ...s, position });
    expect(tiny).toEqual({ width: 1, height: 1, x: 0, y: 0 });
  }
});

it('blends partial and transparent coverage into RGBA8 without altering uncovered pixels or alpha', () => {
  const pixels = new Uint8Array([11, 22, 33, 255, 20, 40, 60, 255, 71, 82, 93, 255]);
  blendWatermark(pixels, 3, 1, { x: 1, y: 0, width: 2, height: 1, pixels: new Uint8ClampedArray([220, 140, 60, 128, 255, 255, 255, 0]) });
  expect([...pixels]).toEqual([11, 22, 33, 255, 120, 90, 60, 255, 71, 82, 93, 255]);
});

it('preserves 16-bit precision and RGB stride, with clipping at the frame boundary', () => {
  const pixels = new Uint16Array([12345, 23456, 34567, 11111, 22222, 33333]);
  blendWatermark(pixels, 2, 1, { x: 1, y: 0, width: 2, height: 1, pixels: new Uint8ClampedArray([255, 0, 128, 128, 255, 255, 255, 255]) });
  expect([...pixels]).toEqual([12345, 23456, 34567, 38430, 11067, 33114]);
});
