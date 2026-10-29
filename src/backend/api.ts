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
}

export interface ScanResult {
  root: string;
  name: string;
  entries: Entry[];
  rawSkipped: number;
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

export const HEADER_BYTES = 16;

/** Parse the decoder's payload: width, height, mode, reserved, then RGBA half floats. */
export function parsePayload(buf: ArrayBuffer): HalfImage {
  if (buf.byteLength < HEADER_BYTES) throw new Error('Image payload is too short');
  const dv = new DataView(buf);
  const width = dv.getUint32(0, true);
  const height = dv.getUint32(4, true);
  const mode = dv.getUint32(8, true) as InputMode;
  const expected = HEADER_BYTES + width * height * 8;
  if (buf.byteLength !== expected) throw new Error(`Image payload is ${buf.byteLength} bytes, expected ${expected}`);
  return { width, height, mode, data: new Uint16Array(buf, HEADER_BYTES, width * height * 4) };
}

export async function loadImage(path: string, maxEdge?: number): Promise<HalfImage> {
  const buf = await invoke<ArrayBuffer>('load_image', { path, maxEdge: maxEdge ?? null });
  return parsePayload(buf);
}

export const writeSidecar = (path: string, recipe: unknown | null) => invoke<void>('write_sidecar', { path, recipe });

export function writeExport(dir: string, stem: string, rgba: Uint8Array, width: number, height: number, quality: number) {
  return invoke<string>('write_export', rgba, {
    headers: {
      'x-minilab-dir': encodeURIComponent(dir),
      'x-minilab-stem': encodeURIComponent(stem),
      'x-minilab-width': String(width),
      'x-minilab-height': String(height),
      'x-minilab-quality': String(quality),
    },
  });
}

export const startupOptions = () => invoke<StartupOptions>('startup_options');

export function logToTerminal(level: 'error' | 'warn' | 'info', message: string) {
  if (isTauri()) invoke('log_message', { level, message }).catch(() => {});
}
