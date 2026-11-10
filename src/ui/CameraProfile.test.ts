// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { CameraMetadata, ColourSource } from '../film/profiles';
import { colourWarning } from './CameraProfile';

const camera = (colour?: ColourSource): CameraMetadata => ({
  make: 'Sony',
  model: 'ILCE-7RM6',
  cameraToWorking: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  neutral: null,
  baselineGain: 1.8,
  colour,
});

describe('colourWarning', () => {
  it('stays quiet when the camera has a colour matrix', () => {
    expect(colourWarning(true, camera({ kind: 'camera' }))).toBeNull();
    expect(colourWarning(true, camera({ kind: 'darktable' }))).toBeNull();
    expect(colourWarning(true, camera())).toBeNull();
    expect(colourWarning(true, null)).toBeNull();
  });
  it('warns when a RAW camera has no colour data', () => {
    expect(colourWarning(true, camera({ kind: 'none' }))).toMatch(/approximate/);
  });
  it('stays quiet for a photo that is not a RAW', () => {
    expect(colourWarning(false, camera({ kind: 'none' }))).toBeNull();
  });
});
