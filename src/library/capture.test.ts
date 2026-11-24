// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { builtInLens, countFocals, countIsos, countLenses, countBy, fileType, focalLabel, photoFocal, photoLens } from './capture';

const shot = (capture: object, path = '/a.jpg', raw = false) => ({ path, raw, capture: { camera: null, date: null, ...capture } });

describe('lenses', () => {
  it('gives a fixed-lens camera its built-in lens, on its JPEGs too once a RAW has said so', () => {
    const jpeg = shot({ camera: 'RICOH IMAGING COMPANY, LTD. RICOH GR IIIx', lens: null });
    const dng = shot({ camera: 'Ricoh GR IIIx', lens: null, fixedLens: true }, '/a.DNG', true);
    const e300 = shot({ camera: 'Olympus E-300', lens: null });
    expect(countLenses([jpeg, dng, e300])).toEqual([{ value: 'Ricoh GR IIIx built-in lens', label: 'Ricoh GR IIIx built-in lens', photos: 2, group: 'Ricoh GR IIIx', groupKey: 'gr iiix' }]);
    expect(photoLens(jpeg)).toBe(builtInLens('Ricoh GR IIIx'));
    expect(photoLens(e300)).toBeNull();
  });
  it('counts one lens however its name is spaced or cased', () => {
    const counts = countLenses([shot({ lens: 'XF27mmF2.8 R WR' }), shot({ lens: ' XF27mmF2.8  R WR' }), shot({ lens: 'OM 17mm F1.8 II' })]);
    expect(counts.map(c => [c.label, c.photos])).toEqual([['OM 17mm F1.8 II', 1], ['XF27mmF2.8 R WR', 2]]);
  });
  it('lists lenses under the camera each was used on, cameras and lenses by name, unknown cameras last', () => {
    const xt30 = (lens: string) => shot({ camera: 'FUJIFILM X-T30 II', lens });
    const counts = countLenses([xt30('XF27mmF2.8 R WR'), shot({ camera: 'Fujifilm X-T30 II', lens: 'AF 27/2.8' }), xt30('XF27mmF2.8 R WR'),
      shot({ camera: 'Olympus OM-3', lens: 'OM 17mm F1.8 II' }), shot({ lens: 'Mystery 50mm' }), shot({ camera: 'Fujifilm X-E4', lens: 'XF27mmF2.8 R WR' })]);
    expect(counts.map(c => [c.group, c.label, c.photos])).toEqual([
      ['Fujifilm X-E4', 'XF27mmF2.8 R WR', 1],
      ['Fujifilm X-T30 II', 'AF 27/2.8', 1], ['Fujifilm X-T30 II', 'XF27mmF2.8 R WR', 2],
      ['OM System OM-3', 'OM 17mm F1.8 II', 1],
      ['Unknown camera', 'Mystery 50mm', 1],
    ]);
  });
});

describe('focal lengths', () => {
  it('rounds to whole millimetres, or tenths on a compact', () => {
    expect(photoFocal(shot({ focalLength: 27.2 }))).toBe(27);
    expect(photoFocal(shot({ focalLength: 5.14 }))).toBe(5.1);
    expect(photoFocal(shot({ focalLength: 0 }))).toBeNull();
  });
  it('lists each length, with its 35 mm equivalent when the photos agree on one', () => {
    const counts = countFocals([shot({ focalLength: 27, focalLength35: 41 }), shot({ focalLength: 27, focalLength35: 41 }), shot({ focalLength: 50, focalLength35: 50 }), shot({ focalLength: 17 })]);
    expect(counts).toEqual([
      { value: '17', label: '17 mm', photos: 1 },
      { value: '27', label: '27 mm · 41 mm eq.', photos: 2 },
      { value: '50', label: '50 mm', photos: 1 },
    ]);
  });
  it('groups many lengths (zooms) into bands', () => {
    const lengths = [12, 14, 18, 20, 23, 25, 28, 33, 40, 45, 50, 70, 300];
    expect(countFocals(lengths.map(focalLength => shot({ focalLength })))).toEqual([
      { value: '0-16', label: 'Under 16 mm', photos: 2 },
      { value: '16-24', label: '16–23 mm', photos: 3 },
      { value: '24-35', label: '24–34 mm', photos: 3 },
      { value: '35-50', label: '35–49 mm', photos: 2 },
      { value: '50-85', label: '50–84 mm', photos: 2 },
      { value: '200-', label: '200 mm and over', photos: 1 },
    ]);
    expect(focalLabel('85-135')).toBe('85–134 mm');
  });
});

describe('ISO', () => {
  it('counts the photos each value matches under the comparison', () => {
    const photos = [100, 100, 400, 3200, 0].map(iso => shot({ iso }));
    expect(countIsos(photos, '=').map(c => [c.value, c.photos])).toEqual([['100', 2], ['400', 1], ['3200', 1]]);
    expect(countIsos(photos, '<=').map(c => c.photos)).toEqual([2, 3, 4]);
    expect(countIsos(photos, '>=').map(c => c.photos)).toEqual([4, 2, 1]);
  });
});

describe('file types', () => {
  it('names file types as Lightroom does', () => {
    expect(['/a.RAF', '/a.dng'].map(path => fileType({ path, raw: true }))).toEqual(['RAW', 'DNG']);
    expect(['/a.jpeg', '/a.HIF', '/a.tif', '/a.png', '/a.xyz', '/a'].map(path => fileType({ path, raw: false }))).toEqual(['JPEG', 'HEIF', 'TIFF', 'PNG', 'XYZ', 'Other']);
    expect(countBy([{ path: '/a.jpg' }, { path: '/b.JPG' }, { path: '/c.RAF', raw: true }], fileType).map(c => [c.value, c.photos])).toEqual([['JPEG', 2], ['RAW', 1]]);
  });
});
