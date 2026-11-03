// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CameraMetadata } from '../film/profiles';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('../backend/api', () => ({ isTauri: mocks.isTauri }));
const id = 'a'.repeat(64);
const entry = { id, name: 'Camera Standard', camera: 'Test Camera', copyright: 'Synthetic GPL' };
const camera: CameraMetadata = {
  make: 'Test',
  model: 'Camera',
  cameraToWorking: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  neutral: [0.5, 1, 0.7],
  baselineGain: 1.8,
};
const fixture = readFileSync(new URL('./fixtures/synthetic.dcp', import.meta.url));
const bytes = () => fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength);
let installed: (typeof entry)[];
beforeEach(() => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.isTauri.mockReturnValue(true);
  installed = [];
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  });
  mocks.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'camera_profiles') return installed;
    if (cmd === 'read_camera_profile' || cmd === 'read_camera_profile_file') return bytes();
    if (cmd === 'install_camera_profile') {
      installed = [entry];
      return entry;
    }
    throw Error(`Unexpected command ${cmd}`);
  });
});
afterEach(() => vi.unstubAllGlobals());
describe('camera profile library', () => {
  it('uses the standard matrix until a matching standard profile is installed', async () => {
    const p = await import('./profilestore');
    await p.prepareProfile('auto', camera);
    expect(p.profileFor('auto', camera)).toBeNull();
    installed = [entry];
    await p.refreshProfiles();
    await p.prepareProfile('auto', camera);
    expect(p.profileFor('auto', camera)?.profile.name).toBe('Camera Standard');
    expect(p.profileFor('standard', camera)).toBeNull();
  });
  it('imports a validated DCP and remembers an explicit camera default', async () => {
    const p = await import('./profilestore');
    expect(await p.importProfile('/test.dcp', camera)).toEqual(entry);
    p.setDefaultProfile(camera, id);
    await p.prepareProfile('auto', camera);
    expect(p.profileFor('auto', camera)?.id).toBe(id);
    const { getSetting } = await import('../library/appsettings');
    expect((getSetting('emulsion.cameraProfiles') as Record<string, string>).testcamera).toBe(id);
    expect(
      mocks.invoke.mock.calls.find(([cmd]) => cmd === 'install_camera_profile')?.[2].headers[
        'x-emulsion-profile-camera'
      ],
    ).toBe('Test%20Camera');
  });
  it('rejects imports for a different camera before installation', async () => {
    const p = await import('./profilestore');
    await expect(p.importProfile('/test.dcp', { ...camera, model: 'Other' })).rejects.toThrow('not Test Other');
    expect(mocks.invoke.mock.calls.some(([cmd]) => cmd === 'install_camera_profile')).toBe(false);
  });
  it('rejects missing or wrong-camera explicit profiles rather than exporting a fallback', async () => {
    const p = await import('./profilestore');
    await p.refreshProfiles();
    await expect(p.prepareProfile(`dcp:${id}`, camera)).rejects.toThrow('not installed');
    installed = [entry];
    await p.refreshProfiles();
    await expect(p.prepareProfile(`dcp:${id}`, { ...camera, model: 'Other' })).rejects.toThrow('different camera');
    expect(() => p.profileFor(`dcp:${id}`, { ...camera, model: 'Other' })).toThrow('different camera');
  });
  it('can refresh after the synchronous browser-only initialization path', async () => {
    const p = await import('./profilestore');
    mocks.isTauri.mockReturnValue(false);
    await p.refreshProfiles();
    mocks.isTauri.mockReturnValue(true);
    installed = [entry];
    await p.refreshProfiles();
    expect(p.profileEntries()).toEqual([entry]);
  });
  it('reports initialization errors without an endless render/retry loop, and permits explicit retry', async () => {
    const p = await import('./profilestore');
    mocks.invoke.mockRejectedValueOnce(Error('Library unavailable'));
    await expect(p.refreshProfiles()).rejects.toThrow('Library unavailable');
    expect(p.profilePending('auto', camera)).toBe(false);
    expect(() => p.profileFor('auto', camera)).toThrow('Library unavailable');
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await p.refreshProfiles();
    expect(p.profileFor('auto', camera)).toBeNull();
  });
  it('ignores malformed persisted defaults and leaves already-rendered photos alone', async () => {
    const p = await import('./profilestore');
    installed = [entry];
    localStorage.setItem('emulsion.cameraProfiles', 'null');
    await p.prepareProfile('auto', camera);
    expect(p.profileFor('auto', camera)?.id).toBe(id);
    expect(p.profileFor(`dcp:${id}`, null)).toBeNull();
  });
  it('records what Auto chose, and uses it where the camera has no default', async () => {
    const other = { ...entry, id: 'b'.repeat(64), name: 'Camera Vivid' };
    installed = [entry, other];
    const p = await import('./profilestore');
    const { normalizeRecipe, defaultRecipe } = await import('../film/recipe');
    await p.refreshProfiles();
    const frame = (recipe: ReturnType<typeof defaultRecipe> | null) => ({ recipe, camera });
    // Here: Auto picks the camera's default (Vivid), and the sidecar records it.
    p.setDefaultProfile(camera, other.id);
    const saved = p.withAutoProfile(frame(defaultRecipe())).recipe!;
    expect(saved.autoProfile).toBe(other.id);
    // Read back on a computer without that default: Auto renders with Vivid, not the standard.
    const read = normalizeRecipe(JSON.parse(JSON.stringify(saved)))!;
    expect(read.autoProfile).toBe(other.id);
    p.setDefaultProfile(camera, 'none');
    await p.prepareProfile('auto', camera, read.autoProfile);
    expect(p.profileFor('auto', camera, read.autoProfile)?.id).toBe(other.id);
    await p.prepareProfile('auto', camera);
    expect(p.profileFor('auto', camera)?.id).toBe(id);
    // A default set here still wins, so changing it updates the photo.
    p.setDefaultProfile(camera, id);
    expect(p.profileFor('auto', camera, read.autoProfile)?.id).toBe(id);
    // Nothing installed for it here: the record is kept, not replaced. Other choices drop it.
    installed = [];
    await p.refreshProfiles();
    expect(p.withAutoProfile(frame(read)).recipe!.autoProfile).toBe(other.id);
    expect(p.withAutoProfile(frame({ ...read, profile: 'standard' })).recipe!.autoProfile).toBeUndefined();
    expect(p.withAutoProfile(frame(null)).recipe).toBeNull();
    expect(normalizeRecipe({ ...read, autoProfile: '../x' })!.autoProfile).toBeUndefined();
  });
});
