// SPDX-License-Identifier: GPL-3.0-or-later
// The look packs' LUT files, loaded on first use and kept, so switching back is instant.

import { useSyncExternalStore } from 'react';
import { type Clut, parse3dl, parseCube, parseHald } from './lut3d';

/** A loaded LUT; `id` keys the GPU texture and the maps downstream, `eightBit` picks its format. */
export interface LoadedLut extends Clut {
  id: number;
  eightBit: boolean;
}

/** Where the bundled packs live, relative to the page (public/looks in the repo). */
let base = 'looks/';
let ids = 0;
let version = 0;
const luts = new Map<string, LoadedLut | 'loading' | 'failed'>();
const listeners = new Set<() => void>();

/** Load packs from somewhere else (the probe, from file://); call before rendering. */
export function setLooksBase(url: string) {
  base = url;
}

/** XMLHttpRequest rather than fetch: it also reads file:// pages (the probe). */
function get(url: string, type: 'text' | 'blob'): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('GET', url);
    x.responseType = type;
    x.onload = () => ((x.status === 0 || (x.status >= 200 && x.status < 300)) && x.response ? resolve(x.response) : reject(new Error(`${url}: ${x.status}`)));
    x.onerror = () => reject(new Error(`${url}: unreadable`));
    x.send();
  });
}

/** Read a LUT file's contents: .cube, .3dl or a Hald CLUT image. */
export async function readLut(name: string, data: Blob): Promise<LoadedLut> {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'cube') return { ...parseCube(await data.text()), id: ++ids, eightBit: false };
  if (ext === '3dl') return { ...parse3dl(await data.text()), id: ++ids, eightBit: false };
  // The image's values as stored: no colour management, no premultiplication.
  const bmp = await createImageBitmap(data, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { colorSpace: 'srgb' })!;
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  bmp.close();
  return { ...parseHald(px, c.width, c.height), id: ++ids, eightBit: true };
}

/** Load a bundled LUT (path under public/looks); resolves when it is in. */
export async function loadLut(file: string): Promise<LoadedLut | null> {
  const have = luts.get(file);
  if (have && have !== 'loading' && have !== 'failed') return have;
  if (!have) {
    luts.set(file, 'loading');
    try {
      const blob = (await get(base + encodeURI(file), 'blob')) as Blob;
      luts.set(file, await readLut(file, blob));
    } catch (e) {
      luts.set(file, 'failed');
      console.error('look LUT', file, e);
    }
    version++;
    listeners.forEach((l) => l());
  }
  const now = luts.get(file);
  return now && now !== 'loading' && now !== 'failed' ? now : null;
}

/** The LUT if it has loaded, else null (and it starts loading; views redraw when it arrives). */
export function lutFor(file: string): LoadedLut | null {
  const have = luts.get(file);
  if (have === undefined) void loadLut(file);
  return have && have !== 'loading' && have !== 'failed' ? have : null;
}

/** Whether a LUT is still on its way (a view should wait rather than draw without it). */
export const lutPending = (file: string) => {
  const have = luts.get(file);
  return have === undefined || have === 'loading';
};

/** Changes whenever a LUT arrives: a dependency for views that must redraw with it. */
export function useLutVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
}
