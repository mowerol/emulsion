import type { Mat3, Vec3 } from './stocks';
// SPDX-License-Identifier: GPL-3.0-or-later
// A camera profile forms the base; a film look is an independent optional layer.

export type CameraProfileId = 'auto' | 'standard' | `dcp:${string}`;

export function normalizeProfile(input: unknown): CameraProfileId {
  if (input === 'auto' || input === 'standard') return input;
  return typeof input === 'string' && /^dcp:[a-f0-9]{64}$/.test(input) ? input as CameraProfileId : 'auto';
}

export interface CameraMetadata {
  make: string;
  model: string;
  cameraToWorking: Mat3;
  neutral: Vec3 | null;
  baselineGain: number;
}
export const cameraKey = (camera: Pick<CameraMetadata, 'make' | 'model'>): string => `${camera.make} ${camera.model}`.trim();
