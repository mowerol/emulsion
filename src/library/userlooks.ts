// SPDX-License-Identifier: GPL-3.0-or-later
// Custom looks and the user's LUT files, kept in the app's data folder (src-tauri/src/user_looks.rs).
// A custom look has a permanent id (`lut:custom:<id>` in recipes), so editing it keeps every photo
// that uses it. It is made by importing a LUT, duplicating a system look, or from a photo's settings.

import { useSyncExternalStore } from 'react';
import { invoke } from '../backend/ipc';
import { isTauri } from '../backend/api';
import { lutFormat, provideLut, readLut } from '../engine/lutstore';
import { PACK, USER_LOOKS_DIR, customLookId, customLookOf, lookName, registerCustomLook, registerFileLut, unregisterCustomLook, type PackId, legacyLooks, profileSettingsFor } from '../film/looks';
import { hasSettings, normalizeSettings, type LutSource, type ProfileSettings } from '../film/creative';
import type { Recipe } from '../film/recipe';
import type { StockId } from '../film/stocks';

interface CustomLookFile {
  version: number;
  id: string;
  name: string;
  settings: unknown;
  lut?: string;
}

let version = 0;
const listeners = new Set<() => void>();
const changed = () => {
  version++;
  listeners.forEach((l) => l());
};

/** Tell the interface the looks changed (a built-in look edited in development). */
export const notifyLooksChanged = () => changed();

/** Re-renders when custom looks are added, edited or removed. */
export function useUserLooksVersion() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
}

const register = (l: CustomLookFile) => {
  const meta = l.settings as Record<string, unknown>;
  const settings = normalizeSettings(l.settings) ?? { colorBalance: null, curve: null, lut: null };
  if (meta._legacy) { legacyLooks.set(customLookId(l.id), { name: l.name, settings, kind: meta._kind === 'look' ? 'look' : meta._kind === 'lut' ? 'lut' : undefined, revision: typeof meta._revision === 'number' ? meta._revision : 1 }); return; }
  registerCustomLook(l.id, l.name, settings, meta._kind === 'look' ? 'look' : meta._kind === 'lut' ? 'lut' : undefined, typeof meta._revision === 'number' ? meta._revision : 1, folderName(meta._folder));
};

/** A folder name as saved: trimmed, at most 80 characters; empty is none. */
export const folderName = (v: unknown): string | undefined => {
  const t = typeof v === 'string' ? v.trim().slice(0, 80) : '';
  return t || undefined;
};

/** Load the custom looks into their collection. Call on start. */
export async function refreshUserLooks() {
  if (!isTauri()) return;
  for (const l of await invoke<CustomLookFile[]>('custom_looks')) register(l);
  changed();
}

/** A random UUID: crypto.randomUUID needs a secure context, which Tauri's scheme may not count as. */
export function uuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The look's name from its file name: "Kodak 2383.cube" → "Kodak 2383". */
export const lookNameFromPath = (path: string) =>
  path
    .split(/[\\/]/)
    .pop()!
    .replace(/\.(cube|3dl|png)$/i, '')
    .trim() || 'Imported look';

/** Keep a LUT file of the user's own: it must parse as a LUT first. Returns its content hash. */
export async function importLutFile(path: string): Promise<string> {
  const bytes = await invoke<ArrayBuffer>('read_lut_file', { path });
  const blob = new Blob([bytes]);
  const ext = await lutFormat(blob);
  let lut: Awaited<ReturnType<typeof readLut>>;
  try {
    lut = await readLut(`look.${ext}`, blob);
  } catch (e) {
    throw new Error(`This file is not a LUT Emulsion can read (${e instanceof Error ? e.message : String(e)})`);
  }
  const hash = await invoke<string>('store_look_lut', new Uint8Array(bytes), { headers: { 'x-emulsion-lut-ext': ext } });
  // Parsed already: keep it, so the view needn't read the file back before it can draw.
  provideLut(`${USER_LOOKS_DIR}${hash}`, lut);
  registerFileLut(hash, lookNameFromPath(path));
  changed();
  return hash;
}

/**
 * Create or update a custom look. Returns its stock id. It keeps its folder unless `folder` is
 * given (null takes it out of its folder); a new look goes in `folder`, if any.
 */
export async function saveLook(id: string, name: string, settings: ProfileSettings, folder?: string | null): Promise<StockId> {
  const existing = PACK.custom.looks[customLookId(id)];
  return write(id, name, settings, (existing?.revision ?? 0) + 1, folder === undefined ? existing?.folder : folderName(folder));
}

async function write(id: string, name: string, settings: ProfileSettings, revision: number, folder: string | undefined): Promise<StockId> {
  const saved = await invoke<CustomLookFile>('save_custom_look', {
    look: { version: 2, id, name, settings: { ...settings, _kind: 'look', _revision: revision, ...(folder ? { _folder: folder } : {}) }, lut: settings.lut?.kind === 'file' ? settings.lut.hash : undefined },
  });
  register(saved);
  changed();
  return customLookId(saved.id);
}

/** Move a custom look into a folder (null: My looks). Its settings and revision stay, so photos using it are unchanged. */
export async function moveLook(stock: StockId, folder: string | null): Promise<void> {
  const id = customLookOf(stock), entry = PACK.custom.looks[stock];
  if (!id || !entry?.settings || entry.missing) return;
  await write(id, entry.name ?? 'Look', entry.settings, entry.revision ?? 1, folderName(folder));
}

/** Delete a look folder: its looks go back to My looks (unchanged otherwise). Returns how many moved. */
export async function deleteLookFolder(folder: string): Promise<number> {
  const inside = Object.entries(PACK.custom.looks).filter(([, l]) => l && !l.missing && l.folder === folder && l.settings);
  for (const [stock] of inside) await moveLook(stock as StockId, null);
  return inside.length;
}

/** The folders custom looks are in, A to Z. */
export const lookFolders = (): string[] =>
  [...new Set(Object.values(PACK.custom.looks).map((l) => (l && !l.missing ? l.folder : undefined)).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b));

/** Import a LUT file as a new custom look. */
export async function importLook(path: string): Promise<StockId> {
  const hash = await importLutFile(path);
  return saveLook(uuid(), lookNameFromPath(path), { colorBalance: null, curve: null, lut: { kind: 'file', hash, amount: 1 } });
}

/** Copy a look into Custom looks: a system look by reference, a custom look with its settings. */
export async function duplicateLook(pack: PackId, stock: StockId): Promise<StockId> {
  const own = PACK[pack].looks[stock]?.settings;
  const settings: ProfileSettings = own ?? { colorBalance: null, curve: null, lut: { kind: 'pack', pack, stock, amount: 1 } };
  return saveLook(uuid(), `${lookName(pack, stock)} copy`, settings);
}

/** Remove a library entry; applied photo snapshots and stored LUT files remain intact. */
export async function deleteLook(stock: StockId) {
  const id = customLookOf(stock);
  if (!id) return;
  await invoke('delete_custom_look', { id });
  unregisterCustomLook(id);
  changed();
}

/** Whether the photo's look is a custom look with hidden settings. */
export const onLookWithSettings = (r: Recipe | null) => !!r?.lookEnabled && hasSettings(profileSettingsFor(r));

/**
 * The photo's LUT as a custom look's LUT: a system look by reference, a LUT file by hash, a custom
 * look's own LUT. Null without a look, or for a custom look with hidden settings (those can't be
 * combined with the photo's own exactly).
 */
export function lutSourceOf(r: Recipe): LutSource | null {
  if (!r.lookEnabled) return null;
  const amount = r.lookAmount / 100;
  const look = r.lookSnapshot ? { settings: r.lookSnapshot.settings, file: '', missing: false } : PACK[r.pack]?.looks[r.stock];
  if (!look || look.missing) return null;
  const blend = r.lookBlend === 'color' ? { blend: 'color' as const } : {};
  if (r.pack === 'files') return { kind: 'file', hash: look.file, amount, ...blend,
    ...('photoMatch' in look && typeof look.photoMatch === 'string' ? { photoMatch: look.photoMatch } : {}) };
  if (r.pack === 'custom' || look.settings) {
    if (hasSettings(look.settings) || !look.settings?.lut) return null;
    return { ...look.settings.lut, amount: look.settings.lut.amount * amount };
  }
  return { kind: 'pack', pack: r.pack, stock: r.stock, amount, ...blend };
}

/** How many looks a collection offers. */
export const userLookCount = (pack: PackId) => Object.values(PACK[pack].looks).filter((l) => !l?.missing).length;
