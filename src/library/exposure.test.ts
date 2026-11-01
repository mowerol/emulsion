// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from 'vitest';
import { exposureFields } from './exposure';

it('formats capture settings without RAW floating point noise', () => {
  expect(exposureFields({ iso: 400, shutter: 0.00400000019, aperture: 2.79999995, focalLength: 35 })).toEqual([
    { label: 'ISO', value: 'ISO 400' }, { label: 'Shutter speed', value: '1/250 s' },
    { label: 'Aperture', value: 'f/2.8' }, { label: 'Focal length', value: '35 mm' },
  ]);
});

it('shows long exposures in seconds and omits missing or invalid tags', () => {
  expect(exposureFields(null)).toEqual([]);
  expect(exposureFields({ iso: 0, shutter: 2.5, aperture: null, focalLength: NaN })).toEqual([{ label: 'Shutter speed', value: '2.5 s' }]);
  expect(exposureFields({ iso: null, shutter: 1, aperture: 8, focalLength: Infinity }).map(f => f.value)).toEqual(['1 s', 'f/8']);
});
