import { noiseJob } from '../library/noise';
// SPDX-License-Identifier: GPL-3.0-or-later
// Typed calls into the Rust core (src-tauri/src/commands.rs).

import { invoke } from '@tauri-apps/api/core';
import type { HalfImage } from '../engine/engine';
import type { InputMode } from '../engine/params';

export interface Entry {
  copies?: SavedCopy[];
  path: string;
  rel: string;
  name: string;
  size: number;
  modified: number;
  recipe: unknown | null;
  rating: number;
  label: string | null;
  /** `pick`, `reject` or null; a heart in an older sidecar arrives as a pick. */
  flag: 'pick' | 'reject' | null;
  /** Keywords and IPTC fields (src-tauri/src/xmp.rs `Meta`). */
  meta?: unknown;
  /** A camera RAW. */
  raw: boolean;
}

export interface ScanResult {
  root: string;
  name: string;
  entries: Entry[];
  unreadable: number;
  focus: string | null;
  folders: { path: string; name: string }[];
}

export interface StartupOptions {
  openPath: string | null;
  startView: string | null;
}

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const scanFolder = (path: string, recursive = true) => invoke<ScanResult>('scan_folder', { path, recursive });
export interface Directory { path: string; name: string }
export const browseDirectory = (path: string) => invoke<Directory[]>('browse_directory', { path });
export const computerFolders = () => invoke<Directory[]>('computer_folders');
export interface Exposure {
  iso: number | null;
  /** Exposure time in seconds. */
  shutter: number | null;
  aperture: number | null;
  focalLength: number | null;
  focalLength35?: number | null;
}
export const photoExposure = (path: string) => invoke<Exposure | null>('photo_exposure', { path });
export interface CatalogMetadata { camera: string | null; date: string | null }
/** Camera and capture date, without decoding image pixels. */
export const catalogMetadata = (paths: string[]) => invoke<(CatalogMetadata | null)[]>('catalog_metadata', { paths });

export async function thumbnail(path: string, maxEdge = 512): Promise<Blob> {
  const buf = await invoke<ArrayBuffer>('thumbnail', { path, maxEdge });
  return new Blob([buf], { type: 'image/jpeg' });
}

export const HEADER_BYTES = 32;

/**
 * Parse the decoder's payload: width, height, mode and flags (u32), the as-shot
 * white point x and y (f32, when flag 1 is set), the full-resolution width and
 * height (u32), optional lens metadata (flag 2: u32 length, JSON, 4-byte alignment),
 * optional camera metadata (flag 4: the same framing, independent of lens support),
 * then RGBA half floats.
 */
export function parsePayload(buf: ArrayBuffer): HalfImage {
  if (buf.byteLength < HEADER_BYTES) throw new Error('Image payload is too short');
  const dv = new DataView(buf);
  const width = dv.getUint32(0, true);
  const height = dv.getUint32(4, true);
  const mode = dv.getUint32(8, true) as InputMode;
  let pixelOffset = HEADER_BYTES;
  let lens: import('../engine/lenscorrection').LensMetadata | null = null;
  if (dv.getUint32(12, true) & 2) {
    if (buf.byteLength < HEADER_BYTES + 4) throw new Error('Missing lens metadata length');
    const length = dv.getUint32(HEADER_BYTES, true);
    if (length > 1_048_576 || HEADER_BYTES + 4 + length > buf.byteLength) throw new Error('Invalid lens metadata length');
    lens = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, HEADER_BYTES + 4, length)));
    pixelOffset = Math.ceil((HEADER_BYTES + 4 + length) / 4) * 4;
  }
  let camera: import('../film/profiles').CameraMetadata | null = null;
  if (dv.getUint32(12, true) & 4) {
    if (buf.byteLength < pixelOffset + 4) throw new Error('Missing camera metadata length');
    const length = dv.getUint32(pixelOffset, true);
    if (length > 65536 || pixelOffset + 4 + length > buf.byteLength) throw new Error('Invalid camera metadata length');
    camera = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, pixelOffset + 4, length)));
    pixelOffset = Math.ceil((pixelOffset + 4 + length) / 4) * 4;
  }
  const paired = !!(dv.getUint32(12, true) & 8);
  const expected = pixelOffset + width * height * 8 * (paired ? 2 : 1);
  if (buf.byteLength !== expected) throw new Error(`Image payload is ${buf.byteLength} bytes, expected ${expected}`);
  const white: [number, number] | null = dv.getUint32(12, true) & 1 ? [dv.getFloat32(16, true), dv.getFloat32(20, true)] : null;
  const fullWidth = dv.getUint32(24, true) || width;
  const fullHeight = dv.getUint32(28, true) || height;
  return { width, height, mode, white, lens, camera, fullWidth, fullHeight, denoised: paired ? new Uint16Array(buf, pixelOffset + width * height * 8, width * height * 4) : undefined, data: new Uint16Array(buf, pixelOffset, width * height * 4) };
}

export async function loadImage(path: string, maxEdge?: number, noiseReduction = false): Promise<HalfImage> {
  if (noiseReduction) noiseJob(path, { pending: true, done: 0, total: 0, error: undefined });
  try {
    const buf = await invoke<ArrayBuffer>('load_image', { path, maxEdge: maxEdge ?? null, noiseReduction });
    const image = parsePayload(buf);
    if (noiseReduction) noiseJob(path, { pending: false, done: 1, total: 1 });
    return image;
  } catch (error) {
    if (noiseReduction) noiseJob(path, { pending: false, error: String(error) });
    throw error;
  }
}

export interface CaptureInfo {
  radius: number;
  /** Working Rec.2020 to 16-bit camera RGB, row major. */
  toCam: number[];
  /** One byte per pixel at the requested size: 0 near clipped sensor pixels. */
  mask: Uint8Array;
}

/** Capture sharpening data read from a RAW's sensor data, with the clip mask at width × height. */
export async function captureInfo(path: string, width: number, height: number): Promise<CaptureInfo> {
  const buf = await invoke<ArrayBuffer>('capture_info', { path, width, height });
  const dv = new DataView(buf);
  const toCam = Array.from({ length: 9 }, (_, i) => dv.getFloat32(12 + 4 * i, true));
  return { radius: dv.getFloat32(0, true), toCam, mask: new Uint8Array(buf, 48, width * height) };
}

/** What is embedded in each photo, for photos with no stars, label or metadata of their own yet. */
export interface EmbeddedMetadata { rating: number; label: string | null; reject?: boolean; meta: unknown }
export const embeddedMetadata = (paths: string[]) => invoke<(EmbeddedMetadata | null)[]>('embedded_metadata', { paths });

/** As-shot white points (CIE xy) of `paths`; null for anything that is not a RAW. */
export const whitePoints = (paths: string[]) => invoke<([number, number] | null)[]>('white_points', { paths });

/** What a sidecar keeps: the look, stars, colour tag and flag. With none of them the sidecar is removed. */
export interface SavedCopy {
  id: string;
  name: string;
  recipe: unknown | null;
  rating: number;
  label: string | null;
  /** `pick`, `reject` or null; a heart in an older sidecar arrives as a pick. */
  flag: 'pick' | 'reject' | null;
}

export interface Saved {
  copies?: SavedCopy[];
  recipe: unknown | null;
  rating: number;
  label: string | null;
  /** `pick`, `reject` or null; a heart in an older sidecar arrives as a pick. */
  flag: 'pick' | 'reject' | null;
  /** The source's keywords and IPTC fields; also written to its XMP sidecar. */
  meta?: import('../library/meta').PhotoMeta;
}

/** Save a photo's sidecar; `checkpoint` keeps the edits it replaces in the sidecar's history. */
export const writeSidecar = (path: string, saved: Saved, checkpoint = false) => invoke<void>('write_sidecar', { path, saved, checkpoint });

/** An earlier state of a photo's edits (src-tauri/src/sidecar.rs `Earlier`). */
export interface EarlierEdit { updated: number; replaced: number; recipe: unknown | null; copies?: SavedCopy[] }
/** Earlier states of a photo's edits, newest first. */
export const sidecarHistory = (path: string) => isTauri() ? invoke<EarlierEdit[]>('sidecar_history', { path }) : Promise.resolve([]);

/** A failed write (src-tauri/src/export.rs `WriteError`); `stop` means the destination failed, not the frame. */
export class ExportWriteError extends Error {
  constructor(message: string, readonly stop: boolean) { super(message); }
}
const writeError = (err: unknown) => {
  const e = err as { message?: unknown; stop?: unknown } | null;
  return typeof e?.message === 'string' ? new ExportWriteError(e.message, e.stop === true) : err;
};

/** Create the export folder and check it can be written, before developing anything. */
export const checkExportDir = (dir: string) => invoke<void>('check_export_dir', { dir }).catch(err => { throw writeError(err); });

export type ExportFormat =
  | { kind: 'jpeg'; quality: number }
  | { kind: 'png'; bits: 8 | 16 }
  | { kind: 'tiff'; bits: 8 | 16; compression: 'none' | 'lzw' | 'zip' };
/** What to do when the file name is taken: add -2, -3... (`rename`), replace it, or leave it. */
export type ExistingFiles = 'rename' | 'overwrite' | 'skip';
/** Where a frame went; `skipped` means a file of that name was there and was left alone. */
export interface Written { path: string; skipped: boolean }

/** Write one developed frame: 8-bit RGBA, or 16-bit RGB for a 16-bit format. `protect` is the
 * photo's own file, which an overwrite refuses to replace. */
export function writeExport(dir: string, stem: string, pixels: Uint8Array | Uint16Array, width: number, height: number,
  format: ExportFormat, existing: ExistingFiles, protect: string) {
  const body = pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  return invoke<Written>('write_export', body, {
    headers: {
      'x-emulsion-dir': encodeURIComponent(dir),
      'x-emulsion-stem': encodeURIComponent(stem),
      'x-emulsion-width': String(width),
      'x-emulsion-height': String(height),
      'x-emulsion-format': encodeURIComponent(JSON.stringify(format)),
      'x-emulsion-existing': encodeURIComponent(JSON.stringify(existing)),
      'x-emulsion-protect': encodeURIComponent(protect),
    },
  }).catch(err => { throw writeError(err); });
}

/** A JPEG written under a new name (dev tools). */
export const writeJpeg = (dir: string, stem: string, rgba: Uint8Array, width: number, height: number, quality: number) =>
  writeExport(dir, stem, rgba, width, height, { kind: 'jpeg', quality }, 'rename', '').then(w => w.path);

/** Whether `stem`'s file name is already taken in `dir` (Rust cleans the name as it would when writing). */
export const exportExists = (dir: string, stem: string, ext: string) => invoke<boolean>('export_exists', { dir, stem, ext });

export const startupOptions = () => invoke<StartupOptions>('startup_options');
/** Paths macOS asked the app to open (dropped on the Dock icon, Open With), drained on read. */
export const takeOpenPaths = () => invoke<string[]>('take_open_paths');

export function logToTerminal(level: 'error' | 'warn' | 'info', message: string) {
  if (isTauri()) invoke('log_message', { level, message }).catch(() => {});
}

/** Fit perspective from a neutral, oriented and lens-corrected RGBA preview. */
export function autoPerspective(pixels: Uint8Array, width: number, height: number, axis: 'vertical' | 'horizontal' | 'both' | 'rotation', current: import('../engine/perspective').Perspective) {
  return invoke<Pick<import('../engine/perspective').Perspective, 'rotation' | 'vertical' | 'horizontal' | 'focalLength'>>('auto_perspective', pixels, {
    headers: { 'x-emulsion-width': String(width), 'x-emulsion-height': String(height), 'x-emulsion-axis': axis, 'x-emulsion-perspective': JSON.stringify(current) },
  });
}

/** AI object masks (src-tauri/src/ai_masks.rs): whether the model is installed, and fetching it. */
export interface AiMaskStatus { supported: boolean; installed: boolean; download: number }
export const aiMaskStatus = () => invoke<AiMaskStatus>('ai_mask_status');
export const aiMaskInstall = () => invoke<void>('ai_mask_install');

/** Automatic sky masks use a separate, optional model and share ONNX Runtime with SAM. */
export const skyMaskStatus = () => invoke<AiMaskStatus>('sky_mask_status');
export const skyMaskInstall = () => invoke<void>('sky_mask_install');
export async function segmentSky(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const mask = new Uint8Array(await invoke<ArrayBuffer>('segment_sky', rgba, {
    headers: { 'x-emulsion-width': String(width), 'x-emulsion-height': String(height) },
  }));
  if (mask.length !== width * height) throw new Error('Invalid sky mask size.');
  return mask;
}

/** Local Remove model (src-tauri/src/inpaint_commands.rs); download needs explicit UI consent. */
export interface RemoveStatus { supported: boolean; installed: boolean; download: number; model: string }
export const removeStatus = () => invoke<RemoveStatus>('remove_status');
export const removeInstall = () => invoke<void>('remove_install');

/** Restore a completed patch without decoding/preparing its crop or loading a model. */
export async function removeCachedPatch(key: string): Promise<Uint8Array | null> {
  if (!/^[0-9a-f]{28}$/.test(key)) throw new Error('Invalid Remove patch key.');
  const pixels = new Uint8Array(await invoke<ArrayBuffer>('remove_cached_patch', { key }));
  if (!pixels.length) return null;
  if (pixels.length !== 512 * 512 * 4) throw new Error('Invalid Remove patch size.');
  return pixels;
}

/** Fill a 512² sRGB crop. Positive mask bytes select the area to remove. */
export async function removeInpaint(key: string, image: Uint8Array, mask: Uint8Array): Promise<Uint8Array> {
  const pixels = 512 * 512;
  if (!/^[0-9a-f]{28}$/.test(key) || image.length !== pixels * 4 || mask.length !== pixels) throw new Error('Invalid Remove crop, mask or patch key.');
  const body = new Uint8Array(pixels * 5);
  body.set(image);
  body.set(mask, image.length);
  const result = new Uint8Array(await invoke<ArrayBuffer>('remove_inpaint', body, { headers: { 'x-emulsion-key': key } }));
  if (result.length !== pixels * 4) throw new Error('Invalid Remove patch size.');
  return result;
}

/** Encode a photo for object selection: RGBA8, top row first, of the whole uncropped source. */
export function segmentEncode(key: string, rgba: Uint8Array, width: number, height: number) {
  return invoke<void>('segment_encode', rgba, {
    headers: { 'x-emulsion-key': encodeURIComponent(key), 'x-emulsion-width': String(width), 'x-emulsion-height': String(height) },
  });
}

/** A SAM prompt in the encoded render's pixels. */
export interface SegmentPoint { x: number; y: number; label: number }

/** The selection for the prompts, 8-bit at the encoded size, before edge refinement. */
export const segmentDecode = async (key: string, points: SegmentPoint[], fresh: boolean) =>
  new Uint8Array(await invoke<ArrayBuffer>('segment_decode', { key, points, fresh }));

/** The last selection with darktable's DenseCRF edge refinement. */
export const segmentRefine = async (key: string) => new Uint8Array(await invoke<ArrayBuffer>('segment_refine', { key }));
