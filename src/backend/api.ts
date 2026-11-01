// SPDX-License-Identifier: GPL-3.0-or-later
// Typed calls into the Rust core (src-tauri/src/commands.rs).

import { invoke } from '@tauri-apps/api/core';
import type { HalfImage } from '../engine/engine';
import type { InputMode } from '../engine/params';

export interface Entry {
  path: string;
  rel: string;
  name: string;
  size: number;
  modified: number;
  recipe: unknown | null;
  rating: number;
  label: string | null;
  heart: boolean;
  /** A camera RAW. */
  raw: boolean;
}

export interface ScanResult {
  root: string;
  name: string;
  entries: Entry[];
  unreadable: number;
  focus: string | null;
}

export interface StartupOptions {
  openPath: string | null;
  startView: string | null;
}

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const scanFolder = (path: string, recursive = true) => invoke<ScanResult>('scan_folder', { path, recursive });

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
  const expected = pixelOffset + width * height * 8;
  if (buf.byteLength !== expected) throw new Error(`Image payload is ${buf.byteLength} bytes, expected ${expected}`);
  const white: [number, number] | null = dv.getUint32(12, true) & 1 ? [dv.getFloat32(16, true), dv.getFloat32(20, true)] : null;
  const fullWidth = dv.getUint32(24, true) || width;
  const fullHeight = dv.getUint32(28, true) || height;
  return { width, height, mode, white, lens, camera, fullWidth, fullHeight, data: new Uint16Array(buf, pixelOffset, width * height * 4) };
}

export async function loadImage(path: string, maxEdge?: number): Promise<HalfImage> {
  const buf = await invoke<ArrayBuffer>('load_image', { path, maxEdge: maxEdge ?? null });
  return parsePayload(buf);
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

/** As-shot white points (CIE xy) of `paths`; null for anything that is not a RAW. */
export const whitePoints = (paths: string[]) => invoke<([number, number] | null)[]>('white_points', { paths });

/** What a sidecar keeps: the look, stars, colour tag and heart. With none of them the sidecar is removed. */
export interface Saved {
  recipe: unknown | null;
  rating: number;
  label: string | null;
  heart: boolean;
}

export const writeSidecar = (path: string, saved: Saved) => invoke<void>('write_sidecar', { path, saved });

export function writeExport(dir: string, stem: string, rgba: Uint8Array, width: number, height: number, quality: number) {
  return invoke<string>('write_export', rgba, {
    headers: {
      'x-emulsion-dir': encodeURIComponent(dir),
      'x-emulsion-stem': encodeURIComponent(stem),
      'x-emulsion-width': String(width),
      'x-emulsion-height': String(height),
      'x-emulsion-quality': String(quality),
    },
  });
}

export const startupOptions = () => invoke<StartupOptions>('startup_options');

export function logToTerminal(level: 'error' | 'warn' | 'info', message: string) {
  if (isTauri()) invoke('log_message', { level, message }).catch(() => {});
}
