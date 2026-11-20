// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let storage: Map<string, string>;
beforeEach(() => {
  vi.resetModules(); storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

it('retains the old default and remembers a slower setting and reset across launches', async () => {
  const settings = await import('./zoomsettings');
  expect(settings.useZoomSettings.getState().sensitivity).toBe(1);
  settings.setZoomSensitivity(0.2);
  vi.resetModules();
  const again = await import('./zoomsettings');
  expect(again.useZoomSettings.getState().sensitivity).toBe(0.2);
  again.setZoomSensitivity(again.DEFAULT_ZOOM_SENSITIVITY);
  vi.resetModules();
  expect((await import('./zoomsettings')).useZoomSettings.getState().sensitivity).toBe(1);
});

it.each([['null', 1], ['"slow"', 1], ['{}', 1], ['-10', 0.1], ['99', 2], ['{broken', 1]])('handles invalid saved sensitivity %s', async (value, want) => {
  storage.set('emulsion.zoomSensitivity', value);
  const settings = await import('./zoomsettings');
  expect(settings.useZoomSettings.getState().sensitivity).toBe(want);
});

it('rejects nonfinite values and bounds writes', async () => {
  const settings = await import('./zoomsettings');
  for (const [value, want] of [[NaN, 1], [Infinity, 1], [-Infinity, 1], [0, 0.1], [10, 2]]) {
    settings.setZoomSensitivity(value);
    expect(settings.useZoomSettings.getState().sensitivity).toBe(want);
    expect(JSON.parse(storage.get('emulsion.zoomSensitivity')!)).toBe(want);
  }
});
