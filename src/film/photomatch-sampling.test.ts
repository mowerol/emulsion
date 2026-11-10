// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { matchAnalysisImage } from './photomatch-sampling';

it('averages a high-resolution reference before sparse colour analysis', () => {
  const source = { width: 768, height: 768, data: Uint8Array.from({ length: 768 * 768 * 4 }, (_, i) => {
    const channel = i % 4, pixel = Math.floor(i / 4), red = (pixel % 768 + Math.floor(pixel / 768)) % 2 === 0;
    return channel === 3 ? 255 : channel === 0 ? red ? 255 : 0 : channel === 2 ? red ? 0 : 255 : 0;
  }) };
  const image = matchAnalysisImage(source);
  expect([image.width, image.height]).toEqual([192, 192]);
  expect(Array.from(image.data).slice(0, 4)).toEqual([128, 0, 128, 255]);
});
