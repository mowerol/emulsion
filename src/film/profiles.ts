import type { Mat3, Vec3 } from './stocks';
// SPDX-License-Identifier: GPL-3.0-or-later
// The camera's standard matrix forms the base, as darktable's input color profile does by
// default; a film look is an independent optional layer.

export interface CameraMetadata {
  make: string;
  model: string;
  cameraToWorking: Mat3;
  neutral: Vec3 | null;
  baselineGain: number;
  /** darktable's noise profile at the shot's ISO (src-tauri/src/noiseprofiles.rs); absent from older payloads. */
  noise?: import('../engine/denoiseprofile').NoiseProfile | null;
  /** Where `cameraToWorking` comes from (src-tauri/src/raw.rs `ColourSource`); absent from older payloads. */
  colour?: ColourSource | null;
}
export type ColourSource = { kind: 'camera' } | { kind: 'darktable' } | { kind: 'none' };
export const cameraKey = (camera: Pick<CameraMetadata, 'make' | 'model'>): string => `${camera.make} ${camera.model}`.trim();
