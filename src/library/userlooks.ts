// SPDX-License-Identifier: GPL-3.0-or-later
// Looks the user imports: LUT files kept in the app's data folder (src-tauri/src/user_looks.rs),
// shown as the My looks pack. Recipes name them by content hash (`lut:mine:<hash>`).

import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../backend/api';
import { lutFormat, readLut } from '../engine/lutstore';
import { PACK, registerUserLook, userLookHash, userLookId } from '../film/looks';
import { hasSettings, normalizeSettings, settingsFromRecipe } from '../film/creative';
import type { Recipe } from '../film/recipe';
import type { StockId } from '../film/stocks';

export interface UserLookEntry {
  id: string;
  name: string;
  /** An imported LUT's format; absent for a saved profile. */
  ext?: string;
  /** A saved profile's hidden settings. */
  settings?: unknown;
}

function register(e: UserLookEntry) {
  const settings = e.settings === undefined ? undefined : normalizeSettings(e.settings) ?? undefined;
  registerUserLook(e.id, e.name, false, settings);
}

let version = 0;
const listeners = new Set<() => void>();
const changed = () => {
  version++;
  listeners.forEach((l) => l());
};

/** Re-renders when imported looks are added, renamed or removed. */
export function useUserLooksVersion() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
}

/** Load the list of imported looks into My looks. Call on start. */
export async function refreshUserLooks() {
  if (!isTauri()) return;
  const entries = await invoke<UserLookEntry[]>('user_looks');
  for (const e of entries) register(e);
  changed();
}

/** The look's name from its file name: "Kodak 2383.cube" → "Kodak 2383". */
export const lookNameFromPath = (path: string) =>
  path
    .split(/[\\/]/)
    .pop()!
    .replace(/\.(cube|3dl|png)$/i, '')
    .trim() || 'Imported look';

/**
 * Import a LUT file: it must parse as a LUT before it is kept. Returns the look's stock id.
 * Importing the same file again keeps its identity (and takes the new name).
 */
export async function importUserLook(path: string): Promise<StockId> {
  const bytes = await invoke<ArrayBuffer>('read_user_look_file', { path });
  const blob = new Blob([bytes]);
  const ext = await lutFormat(blob);
  try {
    await readLut(`look.${ext}`, blob);
  } catch (e) {
    throw new Error(`This file is not a LUT Emulsion can read (${e instanceof Error ? e.message : String(e)})`);
  }
  const entry = await invoke<UserLookEntry>('install_user_look', new Uint8Array(bytes), {
    headers: {
      'x-emulsion-look-name': encodeURIComponent(lookNameFromPath(path)),
      'x-emulsion-look-ext': ext,
    },
  });
  register(entry);
  changed();
  return userLookId(entry.id);
}

/** Whether the photo's look is a saved profile (a new profile can't be saved on top of one yet). */
export const onSavedProfile = (r: Recipe | null) => !!r?.lookEnabled && hasSettings(PACK[r.pack]?.looks[r.stock]?.settings);

/**
 * Save the photo's colour and tone settings (Colour Grading, Contrast, Vibrance, Saturation, Shadows
 * and the Curve), with its look LUT at its Amount, as a creative profile in My looks.
 */
export async function saveProfile(name: string, r: Recipe): Promise<StockId> {
  if (onSavedProfile(r)) throw new Error('Choose a look that isn’t a saved profile first: a profile can’t be saved on top of another yet.');
  const look = r.lookEnabled && PACK[r.pack]?.looks[r.stock] ? { pack: r.pack, stock: r.stock, amount: r.lookAmount / 100 } : null;
  const entry = await invoke<UserLookEntry>('save_user_profile', { name, settings: settingsFromRecipe(r, look) });
  register(entry);
  changed();
  return userLookId(entry.id);
}

/**
 * Remove an imported look. Photos that use it keep its id and render without it, as Missing look;
 * importing the same file again brings it back.
 */
export async function removeUserLook(stock: StockId) {
  const hash = userLookHash(stock);
  if (!hash) return;
  await invoke('delete_user_look', { id: hash });
  registerUserLook(hash, 'Missing look', true);
  changed();
}

/** How many imported looks are installed. */
export const userLookCount = () => Object.values(PACK.mine.looks).filter((l) => !l?.missing).length;
