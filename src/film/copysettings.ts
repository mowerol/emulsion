// SPDX-License-Identifier: GPL-3.0-or-later
// Copy scopes keep coupled settings together (a Look and its snapshot, a sharpening amount
// and its radius). Unchecked fields always belong to the destination photo.
import { defaultRecipe, type Recipe } from './recipe';

export const COPY_GROUPS = {
  Look: ['lookEnabled', 'stock', 'pack', 'lookAmount', 'lookBlend', 'lookSnapshot'],
  'White balance': ['wb'],
  Exposure: ['exposure'],
  Contrast: ['contrast'],
  'Tone character': ['toneCharacter'],
  Highlights: ['highlights'],
  Shadows: ['shadows'],
  Whites: ['whites'],
  Blacks: ['blacks'],
  'Tone curve': ['curve'],
  Vibrance: ['vibrance'],
  Saturation: ['saturation'],
  'Colour mixer': ['color'],
  'Colour Grading': ['grading'],
  'Scanner finish': ['scanner', 'scannerFromLook'],
  Fade: ['fade'],
  Halation: ['halation'],
  Glow: ['glow'],
  Vignette: ['vignette'],
  Grain: ['push', 'grain', 'grainIso', 'grainMidtones'],
  Texture: ['texture'],
  Clarity: ['clarity'],
  Dehaze: ['dehaze', 'dehazeDistance'],
  'Capture sharpening': ['captureSharpening'],
  Sharpening: ['sharpen', 'sharpenRadius', 'sharpenMasking'],
  'Noise reduction': ['noiseReduction', 'profiledDenoise'],
  'Lens corrections': ['lens'],
  Crop: ['crop'],
  Transform: ['transform'],
  Masks: ['masks'],
  'Heal and Remove': ['retouch', 'retouchScales'],
} as const satisfies Record<string, readonly (keyof Recipe)[]>;

export type CopyGroup = keyof typeof COPY_GROUPS;
export const ALL_COPY_GROUPS = Object.keys(COPY_GROUPS) as CopyGroup[];
const OPT_IN: readonly CopyGroup[] = ['Crop', 'Transform', 'Masks', 'Heal and Remove'];
export const DEFAULT_COPY_GROUPS = ALL_COPY_GROUPS.filter(g => !OPT_IN.includes(g));

export const COPY_SECTIONS = [
  { title: 'Develop', groups: ['Look', 'White balance', 'Exposure', 'Contrast', 'Tone character', 'Highlights', 'Shadows', 'Whites', 'Blacks', 'Tone curve'] },
  { title: 'Colour and finish', groups: ['Vibrance', 'Saturation', 'Colour mixer', 'Colour Grading', 'Scanner finish', 'Fade', 'Halation', 'Glow', 'Vignette', 'Grain'] },
  { title: 'Detail and optics', groups: ['Texture', 'Clarity', 'Dehaze', 'Capture sharpening', 'Sharpening', 'Noise reduction', 'Lens corrections'] },
  { title: 'Geometry and local edits', groups: ['Crop', 'Transform', 'Masks', 'Heal and Remove'] },
] as const satisfies readonly { title: string; groups: readonly CopyGroup[] }[];

export interface CopiedSettings { recipe: Recipe; groups: CopyGroup[] }

/** Unknown saved selections are dropped; an explicit empty selection stays empty. */
export function normalizeCopyGroups(value: unknown): CopyGroup[] {
  return Array.isArray(value) ? ALL_COPY_GROUPS.filter(g => value.includes(g)) : [...DEFAULT_COPY_GROUPS];
}

/** Selected neutral values clear the destination's settings, just as non-neutral values replace them. */
export function applyCopiedSettings(clip: CopiedSettings, target: Recipe | null): Recipe {
  const result = { ...(target ?? defaultRecipe()) };
  for (const group of clip.groups) for (const key of COPY_GROUPS[group]) {
    Object.assign(result, { [key]: structuredClone(clip.recipe[key]) });
  }
  return result;
}
