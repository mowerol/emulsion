// SPDX-License-Identifier: GPL-3.0-or-later
// Updates, through tauri-plugin-updater: the app asks the latest GitHub release of
// mowerol/emulsion for latest.json, which names the newest version and its signed Emulsion.app.tar.gz. Downloads are
// checked against the public key in tauri.conf.json before anything is replaced.
//
// Emulsion › Check for Updates… always asks. Released builds also ask by themselves a little
// after every launch, unless the person turned that off in Settings; a version they chose to
// skip isn't offered by those automatic checks again (a manual check still offers it).
import { create } from 'zustand';
import { getSetting, setSetting } from './appsettings';
import { isTauri } from '../backend/api';

export interface UpdateSettings {
  /** Check by itself after launch. */
  automatic: boolean;
  /** The version the person chose to skip, or null. */
  skipped: string | null;
  /** When the last automatic check ran (ms), or null. */
  lastCheck: number | null;
}
const KEY = 'emulsion.updates' as const;
export const UPDATE_DEFAULTS: UpdateSettings = { automatic: true, skipped: null, lastCheck: null };

export function normalizeUpdates(v: unknown): UpdateSettings {
  const o = v && typeof v === 'object' ? v as Partial<UpdateSettings> : {};
  return {
    automatic: typeof o.automatic === 'boolean' ? o.automatic : UPDATE_DEFAULTS.automatic,
    skipped: typeof o.skipped === 'string' && o.skipped ? o.skipped : null,
    lastCheck: typeof o.lastCheck === 'number' && Number.isFinite(o.lastCheck) ? o.lastCheck : null,
  };
}

/**
 * Whether an automatic check should run at this launch: whenever it is on. It ran at most once
 * a day until 0.1.2, so someone who had opened the app that day was not told of a fix released
 * since (Oli, 2026-11-12: an update should be apparent on opening). One small request a launch.
 */
export function autoCheckDue(s: UpdateSettings): boolean {
  return s.automatic;
}

/** Whether a found version is offered: always when asked, otherwise unless it was skipped. */
export function shouldOffer(version: string, s: UpdateSettings, manual: boolean): boolean {
  return manual || version !== s.skipped;
}

export const useUpdateSettings = create<UpdateSettings>(() => normalizeUpdates(getSetting(KEY)));
export function setUpdateSettings(patch: Partial<UpdateSettings>) {
  useUpdateSettings.setState(patch);
  setSetting(KEY, useUpdateSettings.getState());
}

/** What the update dialog shows. */
export type UpdateState =
  | { step: 'idle' }
  | { step: 'checking' }
  | { step: 'none'; current: string }
  | { step: 'available'; current: string; version: string; notes: string; date: string | null }
  | { step: 'downloading'; version: string; received: number; total: number | null }
  | { step: 'installed'; version: string }
  | { step: 'error'; message: string };

export const useUpdate = create<UpdateState>(() => ({ step: 'idle' }));

type Found = Awaited<ReturnType<typeof import('@tauri-apps/plugin-updater').check>>;
let found: Found = null;

/** The updater's error, said for a person. A translocated or read-only app can't replace itself. */
export function updateErrorMessage(e: unknown): string {
  const text = String(e instanceof Error ? e.message : e);
  if (/read-only|AppTranslocation|permission denied|operation not permitted/i.test(text)) {
    return 'Emulsion could not replace itself where it is. Move Emulsion to the Applications folder, open it from there, and check again.';
  }
  if (/signature/i.test(text)) return `The download didn't match Emulsion's signature, so nothing was installed. ${text}`;
  if (/404|could not fetch|error sending request|network|dns|timed out/i.test(text)) {
    return `Couldn't reach the update server. Check the internet connection and try again. (${text})`;
  }
  return text;
}

/**
 * Ask for a newer version. A manual check always opens the dialog (to say "up to date" or what
 * went wrong); an automatic one stays silent unless there is something to offer.
 */
export async function checkForUpdates(manual: boolean): Promise<void> {
  if (!isTauri()) return;
  const busy = useUpdate.getState().step;
  if (busy === 'checking' || busy === 'downloading' || busy === 'installed') return;
  if (manual) useUpdate.setState({ step: 'checking' });
  else setUpdateSettings({ lastCheck: Date.now() });
  try {
    const [{ check }, { getVersion }] = await Promise.all([import('@tauri-apps/plugin-updater'), import('@tauri-apps/api/app')]);
    const current = await getVersion();
    found = await check({ timeout: 30_000 });
    if (!found) {
      if (manual) useUpdate.setState({ step: 'none', current });
      return;
    }
    if (!shouldOffer(found.version, useUpdateSettings.getState(), manual)) return;
    useUpdate.setState({ step: 'available', current, version: found.version, notes: found.body ?? '', date: found.date ?? null });
  } catch (e) {
    console.error('[updates]', e);
    if (manual) useUpdate.setState({ step: 'error', message: updateErrorMessage(e) });
    else useUpdate.setState({ step: 'idle' });
  }
}

/** Download, verify and install the offered version. The app relaunches after saving. */
export async function installUpdate(): Promise<void> {
  const s = useUpdate.getState();
  if (s.step !== 'available' || !found) return;
  const version = s.version;
  let received = 0;
  let total: number | null = null;
  useUpdate.setState({ step: 'downloading', version, received, total });
  try {
    await found.downloadAndInstall(event => {
      if (event.event === 'Started') total = event.data.contentLength ?? null;
      else if (event.event === 'Progress') received += event.data.chunkLength;
      useUpdate.setState({ step: 'downloading', version, received, total });
    });
    useUpdate.setState({ step: 'installed', version });
  } catch (e) {
    console.error('[updates]', e);
    useUpdate.setState({ step: 'error', message: updateErrorMessage(e) });
  }
}

export function skipVersion() {
  const s = useUpdate.getState();
  if (s.step === 'available') setUpdateSettings({ skipped: s.version });
  useUpdate.setState({ step: 'idle' });
}

export function closeUpdate() {
  if (useUpdate.getState().step === 'downloading') return;
  useUpdate.setState({ step: 'idle' });
}

/** Released builds check by themselves this long after launch, so opening a folder comes first. */
const AUTO_DELAY = 8_000;
export function scheduleAutomaticCheck() {
  if (!isTauri() || import.meta.env.DEV) return;
  setTimeout(() => { if (autoCheckDue(useUpdateSettings.getState())) void checkForUpdates(false); }, AUTO_DELAY);
}
