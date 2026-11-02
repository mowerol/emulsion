// SPDX-License-Identifier: GPL-3.0-or-later
// The pixels of an AI object selection, as darktable stores an object (src/develop/masks/
// pixel_mask.c): 8 bits over the whole uncropped source frame, at the size it was encoded.
// darktable writes them to a sidecar archive beside the image, named by their SHA-1; Emulsion
// keeps them in the shape itself, in the photo's sidecar, run-length encoded (a selection is
// mostly runs of 0 and 255 with a soft edge), so undo, copies and backups carry them as they
// carry the other shapes.

export interface ObjectRaster {
  w: number;
  h: number;
  /** Runs of (count 1-255, value) byte pairs, in base64. */
  data: string;
  /** A hash of the pixels, for caches. */
  id: string;
}

/** Longest side darktable stores an object at (DT_MASKS_PIXEL_MAX_STORED). */
export const OBJECT_MAX_STORED = 4096;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** FNV-1a over the pixels, as hex. */
function hash(px: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i], 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0') + px.length.toString(16);
}

export function encodeRaster(px: Uint8Array, w: number, h: number): ObjectRaster {
  if (px.length !== w * h) throw Error('Raster size does not match');
  const runs: number[] = [];
  for (let i = 0; i < px.length;) {
    const v = px[i];
    let n = 1;
    while (n < 255 && i + n < px.length && px[i + n] === v) n++;
    runs.push(n, v);
    i += n;
  }
  return { w, h, data: toBase64(Uint8Array.from(runs)), id: hash(px) };
}

function decodeRuns(data: string, w: number, h: number): Uint8Array | null {
  let runs: Uint8Array;
  try {
    runs = fromBase64(data);
  } catch {
    return null;
  }
  const out = new Uint8Array(w * h);
  let at = 0;
  for (let i = 0; i + 1 < runs.length; i += 2) {
    const n = runs[i];
    if (at + n > out.length) return null;
    out.fill(runs[i + 1], at, at + n);
    at += n;
  }
  return at === out.length ? out : null;
}

const decoded = new Map<string, Uint8Array>();

/** The pixels, w × h, top row first (cached by id). Null when the data is damaged. */
export function decodeRaster(r: ObjectRaster): Uint8Array | null {
  const hit = decoded.get(r.id);
  if (hit) return hit;
  const out = decodeRuns(r.data, r.w, r.h);
  if (!out) return null;
  if (decoded.size > 64) decoded.delete(decoded.keys().next().value!);
  decoded.set(r.id, out);
  return out;
}

/** The raster's value at source point (u, v), bilinear on pixel centres as a texture samples it. */
export function rasterValue(r: ObjectRaster, u: number, v: number): number {
  const px = decodeRaster(r);
  if (!px) return 0;
  const x = Math.min(r.w - 1, Math.max(0, u * r.w - 0.5));
  const y = Math.min(r.h - 1, Math.max(0, v * r.h - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(r.w - 1, x0 + 1), y1 = Math.min(r.h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const at = (xx: number, yy: number) => px[yy * r.w + xx] / 255;
  return at(x0, y0) * (1 - fx) * (1 - fy) + at(x1, y0) * fx * (1 - fy) + at(x0, y1) * (1 - fx) * fy + at(x1, y1) * fx * fy;
}

/** A raster read from a sidecar, or null if it does not hold together. */
export function normalizeRaster(input: unknown): ObjectRaster | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const w = o.w, h = o.h;
  if (typeof w !== 'number' || typeof h !== 'number' || !Number.isInteger(w) || !Number.isInteger(h)) return null;
  if (w < 1 || h < 1 || w > OBJECT_MAX_STORED || h > OBJECT_MAX_STORED || typeof o.data !== 'string') return null;
  // The id is the pixels' hash: made again rather than trusted.
  const px = decodeRuns(o.data, w, h);
  return px ? { w, h, data: o.data, id: hash(px) } : null;
}
