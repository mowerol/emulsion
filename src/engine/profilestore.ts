// SPDX-License-Identifier: GPL-3.0-or-later
// User DCP library; recipes keep content identities, never filesystem paths.
import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../backend/api';
import { cameraKey, type CameraMetadata, type CameraProfileId } from '../film/profiles';
import { parseDcp, type DcpProfile } from './dcp';

export interface ProfileEntry {
  id: string;
  name: string;
  camera: string;
  copyright: string;
}
let entries: ProfileEntry[] = [];
let initialized = false,
  initializing: Promise<void> | null = null,
  version = 0;
let initializationError: string | null = null;
const profiles = new Map<string, DcpProfile>(),
  pending = new Map<string, Promise<DcpProfile>>(),
  errors = new Map<string, string>();
const listeners = new Set<() => void>();
const changed = () => {
  version++;
  listeners.forEach((l) => l());
};
export function useProfileVersion() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
}
export const profileEntries = () => entries;
export const profileVersion = () => version;
const normalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export const sameCamera = (a: string, b: string) => normalized(a) === normalized(b);
const DEFAULTS = 'emulsion.cameraProfiles';
function defaults(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DEFAULTS) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([, id]) => typeof id === 'string'))
      : {};
  } catch {
    return {};
  }
}
export function setDefaultProfile(camera: CameraMetadata, id: string) {
  const d = defaults();
  d[normalized(cameraKey(camera))] = id;
  try {
    localStorage.setItem(DEFAULTS, JSON.stringify(d));
  } catch {
    /* session still usable */
  }
  changed();
}
export async function refreshProfiles() {
  if (initializing) return initializing;
  // Defer even the browser-only path so finally cannot run before assignment.
  initializing = Promise.resolve().then(async () => {
    try {
      entries = isTauri() ? await invoke<ProfileEntry[]>('camera_profiles') : [];
      initialized = true;
      initializationError = null;
    } catch (e) {
      initializationError = String(e);
      throw e;
    } finally {
      initializing = null;
      changed();
    }
  });
  return initializing;
}
function selectedId(choice: CameraProfileId, camera?: CameraMetadata | null): string | null {
  if (!camera || choice === 'standard') return null;
  if (choice.startsWith('dcp:')) return choice.slice(4);
  const available = entries.filter((p) => sameCamera(p.camera, cameraKey(camera))),
    preferred = defaults()[normalized(cameraKey(camera))];
  return (
    available.find((p) => p.id === preferred)?.id ??
    available.find((p) => /standard|neutral|linear/i.test(p.name))?.id ??
    null
  );
}
async function load(id: string): Promise<DcpProfile> {
  if (profiles.has(id)) return profiles.get(id)!;
  if (pending.has(id)) return pending.get(id)!;
  if (errors.has(id)) throw Error(errors.get(id));
  const entry = entries.find((p) => p.id === id);
  const job = (async () => {
    try {
      const bytes = await invoke<ArrayBuffer>('read_camera_profile', { id });
      const p = parseDcp(bytes, entry?.name);
      profiles.set(id, p);
      return p;
    } catch (e) {
      errors.set(id, String(e));
      throw e;
    } finally {
      pending.delete(id);
      changed();
    }
  })();
  pending.set(id, job);
  return job;
}
export async function prepareProfile(choice: CameraProfileId, camera?: CameraMetadata | null) {
  if (!camera || choice === 'standard') return;
  if (!initialized) await refreshProfiles();
  const id = selectedId(choice, camera);
  if (!id) return;
  const entry = entries.find((p) => p.id === id);
  if (!entry) throw Error('The selected camera profile is not installed');
  if (!sameCamera(entry.camera, cameraKey(camera))) throw Error('The selected profile belongs to a different camera');
  await load(id);
}
export function profileFor(
  choice: CameraProfileId,
  camera?: CameraMetadata | null,
): { id: string; profile: DcpProfile } | null {
  if (!camera || choice === 'standard') return null;
  if (!initialized) {
    if (initializationError) throw Error(initializationError);
    void refreshProfiles().catch(() => {});
    return null;
  }
  const id = selectedId(choice, camera);
  if (!id) return null;
  const entry = entries.find((p) => p.id === id);
  if (!entry) throw Error('The selected camera profile is not installed');
  if (!sameCamera(entry.camera, cameraKey(camera))) throw Error('The selected profile belongs to a different camera');
  if (errors.has(id)) throw Error(errors.get(id));
  const profile = profiles.get(id);
  if (!profile) {
    void load(id).catch(() => {});
    return null;
  }
  return { id, profile };
}
export function profilePending(choice: CameraProfileId, camera?: CameraMetadata | null) {
  if (!camera || choice === 'standard') return false;
  if (!initialized) {
    if (initializationError) return false;
    void refreshProfiles().catch(() => {});
    return true;
  }
  const id = selectedId(choice, camera);
  if (!id || errors.has(id)) return false;
  if (!entries.some((e) => e.id === id)) return false;
  if (!profiles.has(id)) {
    void load(id).catch(() => {});
    return true;
  }
  return false;
}
export function profileLabel(choice: CameraProfileId) {
  return choice === 'auto'
    ? 'Auto'
    : choice === 'standard'
      ? 'Standard'
      : (entries.find((p) => `dcp:${p.id}` === choice)?.name ?? 'Missing profile');
}
export async function importProfile(path: string, camera: CameraMetadata): Promise<ProfileEntry> {
  const bytes = await invoke<ArrayBuffer>('read_camera_profile_file', { path });
  const profile = parseDcp(
    bytes,
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.dcp$/i, ''),
  );
  // Profiles with a declared unique camera must not be rebound to another camera.
  if (profile.camera && !sameCamera(profile.camera, cameraKey(camera)) && !sameCamera(profile.camera, camera.model))
    throw Error(`This DCP is for ${profile.camera}, not ${cameraKey(camera)}`);
  const entry = await invoke<ProfileEntry>('install_camera_profile', new Uint8Array(bytes), {
    headers: {
      'x-emulsion-profile-name': encodeURIComponent(profile.name),
      'x-emulsion-profile-camera': encodeURIComponent(cameraKey(camera)),
      'x-emulsion-profile-copyright': encodeURIComponent(profile.copyright),
    },
  });
  profiles.set(entry.id, profile);
  errors.delete(entry.id);
  await refreshProfiles();
  return entry;
}
