// SPDX-License-Identifier: GPL-3.0-or-later
import { orientedSize, type Crop } from '../film/crop';
import type { View } from './engine';

/** Device pixels per full-resolution pixel in the displayed frame. */
export function displayDensity(width: number, height: number, view: View, frame: Crop, fullW: number, fullH: number): number {
  const [w, h] = orientedSize(frame, fullW, fullH);
  return Math.max(width / (view.w * frame.w * w), height / (view.h * frame.h * h));
}

/**
 * Choose a reusable source density independently of UI zoom presets. Quarter-octave steps
 * bound excess pixel work to sqrt(2); retaining a sufficient previous step prevents churn
 * around a transition (at most twice the display's pixels). Never discard detail at 1:1.
 */
export function workingScale(density: number, previous?: number): number {
  if (!Number.isFinite(density) || density >= 1 || density <= 0) return 1;
  if (previous !== undefined && previous >= density && previous <= density * Math.SQRT2) return previous;
  return 2 ** (Math.ceil(4 * Math.log2(density) - 1e-10) / 4);
}
