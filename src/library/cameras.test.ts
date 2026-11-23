// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { camera, countCameras, photoCamera } from './cameras';

describe('camera names', () => {
  it('makes the EXIF and LibRaw names of one camera the same camera', () => {
    // Names found in a real catalog: JPEG EXIF on the left, LibRaw (RAWs) on the right.
    const pairs = [
      ['FUJIFILM X-T30 II', 'Fujifilm X-T30 II', 'Fujifilm X-T30 II'],
      ['OM Digital Solutions OM-3', 'Olympus OM-3', 'OM System OM-3'],
      ['OLYMPUS IMAGING CORP. E-300', 'Olympus E-300', 'Olympus E-300'],
      ['RICOH IMAGING COMPANY, LTD. RICOH GR IIIx', 'Ricoh GR IIIx', 'Ricoh GR IIIx'],
      ['NIKON CORPORATION NIKON Z 6', 'Nikon Z 6', 'Nikon Z 6'],
      ['Canon Canon EOS R6', 'Canon EOS R6', 'Canon EOS R6'],
      ['SONY ILCE-7RM6', 'Sony ILCE-7RM6', 'Sony ILCE-7RM6'],
    ];
    for (const [exif, libraw, name] of pairs) {
      expect(camera(exif)).toEqual(camera(libraw));
      expect(camera(exif).name).toBe(name);
    }
  });

  it('reads its own names back as the same camera', () => {
    for (const stored of ['OM Digital Solutions OM-3', 'Panasonic DMC-LX3', 'Fujifilm GFX100RF', 'Acme Cam 1']) {
      expect(camera(camera(stored).name)).toEqual(camera(stored));
    }
  });

  it('keeps a make it doesn’t know whole, ignoring case and spacing', () => {
    expect(camera('Acme  Cam 1 ')).toEqual({ key: 'acme cam 1', name: 'Acme Cam 1' });
    expect(camera('ACME CAM 1').key).toBe('acme cam 1');
  });

  it('takes a photo’s camera from its capture metadata, else from its RAW decode', () => {
    expect(photoCamera({ capture: { camera: 'SONY ZV-1' } })?.name).toBe('Sony ZV-1');
    expect(photoCamera({ camera: { make: 'Sony', model: 'ZV-1' } })?.key).toBe('zv-1');
    expect(photoCamera({ capture: { camera: null } })).toBeNull();
    expect(photoCamera({})).toBeNull();
  });

  it('counts photos per camera, sorted by name', () => {
    const shot = (c: string | null) => ({ capture: { camera: c } });
    expect(countCameras([shot('SONY ZV-1'), shot('FUJIFILM X-T30 II'), shot('Fujifilm X-T30 II'), shot(null)])).toEqual([
      { key: 'x-t30 ii', name: 'Fujifilm X-T30 II', photos: 2 },
      { key: 'zv-1', name: 'Sony ZV-1', photos: 1 },
    ]);
  });
});
