// SPDX-License-Identifier: GPL-3.0-or-later
// One name per camera for the filter bar, whichever way its files name it. A photo's camera is
// its EXIF Make and Model joined (src-tauri/src/exposure.rs), or LibRaw's when the EXIF can't be
// read (most RAWs, src-tauri/src/raw.rs `catalog_camera`). They differ for one camera: a JPEG says
// `FUJIFILM X-T30 II`, `OM Digital Solutions OM-3`, `NIKON CORPORATION NIKON Z 6`; LibRaw says
// `Fujifilm X-T30 II`, `Olympus OM-3` (it names OM System's cameras Olympus), `Nikon Z 6`, with the
// brand taken out of the model. So a camera is known by its model with the make (and the brand
// repeated at the model's start) removed, and shown as its brand and that model.

import { overPhotos } from './photolist';
import type { Photo } from './store';

/** Makes as cameras write them (and LibRaw normalises them), with the brand each one names. */
const MAKES: [string, string][] = [
  ['fujifilm corporation', 'Fujifilm'], ['fuji photo film co., ltd.', 'Fujifilm'], ['fujifilm', 'Fujifilm'],
  ['om digital solutions', 'OM System'], ['om system', 'OM System'],
  ['olympus imaging corp.', 'Olympus'], ['olympus corporation', 'Olympus'], ['olympus optical co.,ltd', 'Olympus'], ['olympus', 'Olympus'],
  ['nikon corporation', 'Nikon'], ['nikon', 'Nikon'],
  ['canon', 'Canon'], ['sony', 'Sony'], ['panasonic', 'Panasonic'],
  ['leica camera ag', 'Leica'], ['leica', 'Leica'],
  ['ricoh imaging company, ltd.', 'Ricoh'], ['ricoh', 'Ricoh'],
  ['pentax corporation', 'Pentax'], ['pentax', 'Pentax'],
  ['eastman kodak company', 'Kodak'], ['kodak', 'Kodak'],
  ['hasselblad', 'Hasselblad'], ['phase one', 'Phase One'], ['sigma', 'Sigma'],
  ['apple', 'Apple'], ['google', 'Google'], ['samsung', 'Samsung'], ['dji', 'DJI'], ['gopro', 'GoPro'],
];
// Longest first, so `nikon corporation` is taken before `nikon`.
MAKES.sort((a, b) => b[0].length - a[0].length);

export interface Camera {
  /** The model without its make, lower case: what makes two names one camera. */
  key: string;
  /** Brand and model, as the filter bar shows it. */
  name: string;
}

const known = new Map<string, Camera>();

/** The camera a stored name (`Make Model`) means; idempotent, so `camera(camera(x).name)` is `camera(x)`. */
export function camera(stored: string): Camera {
  const hit = known.get(stored);
  if (hit) return hit;
  const tidy = stored.replace(/\s+/g, ' ').trim();
  const lower = tidy.toLowerCase();
  const make = MAKES.find(([m]) => lower.startsWith(m + ' '));
  let result: Camera;
  if (!make) {
    result = { key: lower, name: tidy };
  } else {
    let model = tidy.slice(make[0].length + 1);
    let brand = make[1];
    // `RICOH GR IIIx`, `NIKON Z 6`, `Canon EOS R6`: the brand again at the model's start.
    const repeated = MAKES.find(([m, b]) => b === brand && model.toLowerCase().startsWith(m + ' '));
    if (repeated) model = model.slice(repeated[0].length + 1);
    if (brand === 'Olympus' && /^OM-\d/i.test(model)) brand = 'OM System';
    result = { key: model.toLowerCase(), name: `${brand} ${model}` };
  }
  known.set(stored, result);
  return result;
}

type HasCamera = { capture?: { camera: string | null } | null; camera?: { make: string; model: string } | null };

/** A photo's camera, or null when it has none or it hasn't been read yet. */
export function photoCamera(p: HasCamera): Camera | null {
  const stored = p.capture?.camera ?? (p.camera ? `${p.camera.make} ${p.camera.model}`.trim() : '');
  return stored ? camera(stored) : null;
}

export interface CameraCount extends Camera {
  photos: number;
}

/** The cameras of `photos` with how many photos each took, by name. */
export function countCameras(photos: HasCamera[]): CameraCount[] {
  const by = new Map<string, CameraCount>();
  for (const p of photos) {
    const c = photoCamera(p);
    if (!c) continue;
    const had = by.get(c.key);
    if (had) {
      had.photos++;
      // The same name whichever photo is met first.
      if (c.name < had.name) had.name = c.name;
    } else {
      by.set(c.key, { ...c, photos: 1 });
    }
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

const sameCounts = (a: CameraCount[], b: CameraCount[]) =>
  a.length === b.length && a.every((c, i) => c.key === b[i].key && c.name === b[i].name && c.photos === b[i].photos);

let lastCounts: CameraCount[] = [];
/** `countCameras` over the open photos, as a stable array while the answer is the same, so a slider drag doesn't re-render the filter bar. */
export const cameraCounts = overPhotos((photos: Photo[]) => {
  const next = countCameras(photos);
  if (!sameCounts(next, lastCounts)) lastCounts = next;
  return lastCounts;
}, (a, b) => a.capture?.camera === b.capture?.camera && a.camera === b.camera);
