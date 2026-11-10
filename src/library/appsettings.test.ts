// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('../backend/api', () => ({ isTauri: mocks.isTauri }));

let file: Record<string, unknown> | null;
let storage: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  mocks.invoke.mockReset();
  mocks.isTauri.mockReturnValue(true);
  file = {};
  storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
  mocks.invoke.mockImplementation(async (cmd: string, args?: { settings: Record<string, unknown> }) => {
    if (cmd === 'read_app_settings') return file;
    if (cmd === 'write_app_settings') { file = args!.settings; return; }
    throw Error(`Unexpected command ${cmd}`);
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('app settings file', () => {
  it('moves settings out of the webview storage once, and the file wins after that', async () => {
    storage.set('emulsion.lookBrowser', JSON.stringify({ x: 'a' }));
    storage.set('emulsion.presetFavourites', '{ broken');
    storage.set('emulsion.libraryIndex', '{}');
    const s = await import('./appsettings');
    await s.loadAppSettings();
    expect(file).toEqual({ 'emulsion.lookBrowser': { x: 'a' } });
    expect(s.getSetting('emulsion.lookBrowser')).toEqual({ x: 'a' });

    // Later launches read the file, not the old storage.
    file = { 'emulsion.lookBrowser': { x: 'b' } };
    vi.resetModules();
    const again = await import('./appsettings');
    await again.loadAppSettings();
    expect(again.getSetting('emulsion.lookBrowser')).toEqual({ x: 'b' });
  });

  it('writes changes together after a pause, and not once frozen', async () => {
    const s = await import('./appsettings');
    await s.loadAppSettings();
    s.setSetting('emulsion.presetFavourites', ['p']);
    s.setSetting('emulsion.lookBrowser', { favourites: [], view: 'grid' });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(file).toEqual({ 'emulsion.presetFavourites': ['p'], 'emulsion.lookBrowser': { favourites: [], view: 'grid' } });
    s.setSetting('emulsion.presetFavourites', ['q']);
    await s.freezeAppSettings();
    expect(file!['emulsion.presetFavourites']).toEqual(['q']);
    s.setSetting('emulsion.presetFavourites', ['r']);
    await vi.runAllTimersAsync();
    expect(file!['emulsion.presetFavourites']).toEqual(['q']);
  });

  it('uses the webview storage outside the app', async () => {
    mocks.isTauri.mockReturnValue(false);
    const s = await import('./appsettings');
    await s.loadAppSettings();
    s.setSetting('emulsion.presetCollections', ['Travel']);
    expect(JSON.parse(storage.get('emulsion.presetCollections')!)).toEqual(['Travel']);
    expect(s.getSetting('emulsion.presetCollections')).toEqual(['Travel']);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
