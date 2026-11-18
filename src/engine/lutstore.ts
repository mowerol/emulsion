// SPDX-License-Identifier: GPL-3.0-or-later
// The look packs' LUT files, loaded on first use and kept, so switching back is instant.

import { useSyncExternalStore } from 'react';
import { invoke } from '../backend/ipc';
import { type Clut, parse3dl, parseCube, parseHald } from './lut3d';
import { FUJI_LUT_PREFIX, USER_LOOKS_DIR, type FujiLutKey } from '../film/looks';
import { FUJI_CONTROLS_DIR, FUJI_CONTROL_FILES, FUJI_SIM_CONTROL_FILES, bakeFujiLut, withSimControls, type FujiControls } from '../film/fujirecipe';

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
/** Loads in flight, so a second caller waits for the same file rather than getting nothing. */
const inFlight = new Map<string, Promise<void>>();
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

/** A file name with the right extension for a LUT's bytes: PNG by its signature, .cube by its size line, else .3dl. */
export async function lutFormat(data: Blob): Promise<'png' | 'cube' | '3dl'> {
  const head = new Uint8Array(await data.slice(0, 8).arrayBuffer());
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
  return /^\s*LUT_3D_SIZE\b/m.test(await data.text()) ? 'cube' : '3dl';
}

/** A LUT file of the user's own, read through the app (it lives in the app's data folder). */
async function userLook(file: string): Promise<{ name: string; blob: Blob }> {
  const hash = file.slice(USER_LOOKS_DIR.length);
  const blob = new Blob([await invoke<ArrayBuffer>('read_look_lut', { hash })]);
  return { name: `${hash}.${await lutFormat(blob)}`, blob };
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

/**
 * In the engine's worker the main thread loads LUTs and sends each one here (`provideLut`); the
 * worker's copy never loads a file itself (`mirrorLuts`).
 */
let mirror = false;
export const mirrorLuts = () => { mirror = true; };
export function provideLut(file: string, lut: LoadedLut) {
  luts.set(file, lut);
  version++;
  listeners.forEach((l) => l());
}
/** Each LUT loaded so far, to send to the worker's copy. */
export function loadedLuts(): [string, LoadedLut][] {
  return [...luts].filter((e): e is [string, LoadedLut] => typeof e[1] === 'object');
}

/** Load a bundled LUT (path under public/looks); resolves when it is in. */
export async function loadLut(file: string): Promise<LoadedLut | null> {
  const have = luts.get(file);
  if (have && have !== 'loading' && have !== 'failed') return have;
  if (mirror) return null;
  if (!have) {
    luts.set(file, 'loading');
    inFlight.set(file, (async () => {
      try {
        if (file.startsWith(FUJI_LUT_PREFIX)) {
          luts.set(file, await bakeFuji(JSON.parse(file.slice(FUJI_LUT_PREFIX.length)) as FujiLutKey));
        } else if (file.startsWith(USER_LOOKS_DIR)) {
          const { name, blob } = await userLook(file);
          luts.set(file, await readLut(name, blob));
        } else {
          const url = file.startsWith('/local-looks/') ? encodeURI(file) : base + encodeURI(file);
          const blob = (await get(url, 'blob')) as Blob;
          luts.set(file, await readLut(file, blob));
        }
      } catch (e) {
        luts.set(file, 'failed');
        console.error('look LUT', file, e);
      }
      inFlight.delete(file);
      version++;
      listeners.forEach((l) => l());
    })());
  }
  await inFlight.get(file);
  const now = luts.get(file);
  return now && now !== 'loading' && now !== 'failed' ? now : null;
}

/**
 * The Fuji recipe controls' measured maps, loaded once per simulation: the shared maps with the
 * simulation's own in place (FUJI_SIM_CONTROL_FILES). A map not bundled yet (a setting not
 * measured yet) is left out: the nearest measured step continues across it.
 */
const fujiControls = new Map<string, Promise<FujiControls>>();
const controlFile = async (name: string) => parseCube((await get(base + FUJI_CONTROLS_DIR + name, 'text')) as string);
const steppedFiles = async (files: Record<number, string>, dir = ''): Promise<Record<number, Clut>> => Object.fromEntries((await Promise.all(Object.entries(files)
  .map(async ([k, f]) => [Number(k), await controlFile(dir + f).catch(() => null)] as const))).filter((e): e is readonly [number, Clut] => e[1] !== null));
function loadFujiControls(sim: string | null | undefined): Promise<FujiControls> {
  const own = sim ? FUJI_SIM_CONTROL_FILES[sim] : undefined;
  const key = own ? sim! : '';
  const have = fujiControls.get(key);
  if (have) return have;
  const loading = (async (): Promise<FujiControls> => {
    const shared: FujiControls = {
      highlight: await steppedFiles(FUJI_CONTROL_FILES.highlight),
      shadow: await steppedFiles(FUJI_CONTROL_FILES.shadow),
      color: await steppedFiles(FUJI_CONTROL_FILES.color),
      chromeStrong: await controlFile(FUJI_CONTROL_FILES.chromeStrong),
      chromeStrongAtColor4: await controlFile(FUJI_CONTROL_FILES.chromeStrongAtColor4),
      blueWeak: await controlFile(FUJI_CONTROL_FILES.blueWeak),
      blueStrong: await controlFile(FUJI_CONTROL_FILES.blueStrong),
      blueStrongAtColor4: await controlFile(FUJI_CONTROL_FILES.blueStrongAtColor4),
    };
    if (!own) return shared;
    return withSimControls(shared, {
      highlight: own.highlight && await steppedFiles(own.highlight, own.dir),
      shadow: own.shadow && await steppedFiles(own.shadow, own.dir),
      color: own.color && await steppedFiles(own.color, own.dir),
      chromeStrong: own.chromeStrong ? await controlFile(own.dir + own.chromeStrong) : undefined,
    });
  })();
  fujiControls.set(key, loading);
  // A failed load is tried again next time.
  loading.catch(() => fujiControls.delete(key));
  return loading;
}
async function bakeFuji(key: FujiLutKey): Promise<LoadedLut> {
  const [controls, sim] = await Promise.all([loadFujiControls(key.fujiSim), key.sim ? loadLut(key.sim) : null]);
  if (key.sim && !sim) throw new Error(`simulation LUT ${key.sim} did not load`);
  return { ...bakeFujiLut(sim, key.curve, controls, key.recipe), id: ++ids, eightBit: false };
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
  // Asking starts the load (on the main thread; the worker's copy waits for provideLut).
  if (have === undefined) void loadLut(file);
  return luts.get(file) === undefined || luts.get(file) === 'loading';
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
export const lutVersion = () => version;
