// SPDX-License-Identifier: GPL-3.0-or-later
// Scanner profiles: the last stage, applied to the display-referred print.
// Approximations tuned by eye.

import type { Vec3 } from './stocks';

export type ScannerId = 'frontier' | 'noritsu' | 'flatbed' | 'straight';

export interface Scanner {
  id: ScannerId;
  name: string;
  hint: string;
  contrast: number;
  saturation: number;
  gain: Vec3;
  shadowTint: Vec3;
  highlightTint: Vec3;
  /** Levels. A negative black point lifts blacks. */
  black: number;
  white: number;
  /** Log-domain unsharp amount. Negative softens. */
  sharpness: number;
}

export const SCANNERS: Scanner[] = [
  {
    id: 'frontier', name: 'Frontier', hint: 'Crisp and clean, with cool shadows and vivid greens.',
    contrast: 1.06, saturation: 1.06, gain: [0.99, 1.01, 1.02],
    shadowTint: [-0.01, 0.004, 0.014], highlightTint: [0.006, 0.004, -0.006],
    black: 0.012, white: 0.985, sharpness: 0.35,
  },
  {
    id: 'noritsu', name: 'Noritsu', hint: 'Warmer and denser, with rich reds and deep blacks.',
    contrast: 1.1, saturation: 1.03, gain: [1.03, 1, 0.965],
    shadowTint: [0.006, 0, -0.006], highlightTint: [0.01, 0.004, -0.008],
    black: 0.02, white: 0.985, sharpness: 0.25,
  },
  {
    id: 'flatbed', name: 'Flatbed', hint: 'Home flatbed scan. Soft, flat, lifted blacks.',
    contrast: 0.92, saturation: 0.92, gain: [1, 1, 1],
    shadowTint: [0.012, 0.011, 0.008], highlightTint: [0, 0, 0],
    black: -0.02, white: 1, sharpness: -0.4,
  },
  {
    id: 'straight', name: 'Straight', hint: 'The film rendering with no scanner character.',
    contrast: 1, saturation: 1, gain: [1, 1, 1],
    shadowTint: [0, 0, 0], highlightTint: [0, 0, 0],
    black: 0, white: 1, sharpness: 0,
  },
];

export const SCANNER: Record<ScannerId, Scanner> = Object.fromEntries(SCANNERS.map((s) => [s.id, s])) as Record<ScannerId, Scanner>;

export const isScannerId = (v: unknown): v is ScannerId => typeof v === 'string' && v in SCANNER;
