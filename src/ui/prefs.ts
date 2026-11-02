// SPDX-License-Identifier: GPL-3.0-or-later
// Interface preferences remembered on this computer: the theme and what is folded.
// Like the workspace, they belong to the app, never to a photo's recipe.
import { create } from 'zustand';
import { setStageColor } from '../library/store';

export type Theme = 'mid' | 'dark';
export type CropOverlayId = 'thirds' | 'golden' | 'diagonal' | 'grid' | 'none';
export const CROP_OVERLAYS: { id: CropOverlayId; label: string }[] = [
  { id: 'thirds', label: 'Thirds' }, { id: 'golden', label: 'Golden ratio' }, { id: 'diagonal', label: 'Diagonal' }, { id: 'grid', label: 'Grid' }, { id: 'none', label: 'None' },
];
export interface InterfacePreferences {
  /** Mid grey (the default) or dark surround. */
  theme: Theme;
  /** Capture settings under Library thumbnails. */
  libraryExif: boolean;
  /** The histogram folded to a thin strip. */
  histogramSmall: boolean;
  /** The Images pane's filters shown. */
  filtersOpen: boolean;
  /** The guide shown in the crop frame while it is handled. */
  cropOverlay: CropOverlayId;
}
export const INTERFACE_DEFAULTS: InterfacePreferences = { theme: 'mid', libraryExif: true, histogramSmall: false, filtersOpen: true, cropOverlay: 'thirds' };

export function normalizePrefs(input: unknown): InterfacePreferences {
  const p = input && typeof input === 'object' ? (input as Partial<InterfacePreferences>) : {};
  return {
    theme: p.theme === 'dark' ? 'dark' : 'mid',
    libraryExif: p.libraryExif !== false,
    histogramSmall: p.histogramSmall === true,
    filtersOpen: p.filtersOpen !== false,
    cropOverlay: CROP_OVERLAYS.some(o => o.id === p.cropOverlay) ? p.cropOverlay! : 'thirds',
  };
}

const KEY = 'emulsion.interface';
function read(): InterfacePreferences {
  try { return normalizePrefs(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return { ...INTERFACE_DEFAULTS }; }
}
export const usePrefs = create<InterfacePreferences>(() => read());
export function setPrefs(patch: Partial<InterfacePreferences>) {
  const next = normalizePrefs({ ...usePrefs.getState(), ...patch });
  usePrefs.setState(next);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* still applies for this session */ }
}

export const THEMES: { id: Theme; label: string }[] = [{ id: 'mid', label: 'Mid grey' }, { id: 'dark', label: 'Dark' }];
/** Switch the interface, and the canvas round the photo with it (it can still be chosen separately). */
export function setTheme(theme: Theme) {
  setPrefs({ theme });
  setStageColor(theme === 'dark' ? 'dark' : 'grey');
}

/** The next crop overlay, as O steps through them. */
export function cycleCropOverlay() {
  const i = CROP_OVERLAYS.findIndex(o => o.id === usePrefs.getState().cropOverlay);
  setPrefs({ cropOverlay: CROP_OVERLAYS[(i + 1) % CROP_OVERLAYS.length].id });
}
