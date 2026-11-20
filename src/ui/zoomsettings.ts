// SPDX-License-Identifier: GPL-3.0-or-later
import { create } from 'zustand';
import { getSetting, setSetting } from '../library/appsettings';

export const DEFAULT_ZOOM_SENSITIVITY = 1;
export const MIN_ZOOM_SENSITIVITY = 0.1;
export const MAX_ZOOM_SENSITIVITY = 2;
const KEY = 'emulsion.zoomSensitivity';

function normalize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(MIN_ZOOM_SENSITIVITY, Math.min(MAX_ZOOM_SENSITIVITY, value))
    : DEFAULT_ZOOM_SENSITIVITY;
}

export const useZoomSettings = create(() => ({ sensitivity: normalize(getSetting(KEY)) }));

export function setZoomSensitivity(value: number) {
  const sensitivity = normalize(value);
  useZoomSettings.setState({ sensitivity });
  setSetting(KEY, sensitivity);
}
