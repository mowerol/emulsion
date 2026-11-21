// SPDX-License-Identifier: GPL-3.0-or-later
// Updates, through tauri-plugin-updater: the app asks the latest GitHub release of
// mowerol/emulsion for latest.json, which names the newest version and its signed Emulsion.app.tar.gz. Downloads are
// checked against the public key in tauri.conf.json before anything is replaced.
//
// Emulsion › Check for Updates… always asks. Released builds also ask by themselves a little
// after every launch and periodically while open, unless turned off in Settings; a version they chose to
// skip isn't offered by those automatic checks again (a manual check still offers it).
import { create } from 'zustand';
import { getSetting, setSetting } from './appsettings';
import { isTauri } from '../backend/api';

export interface UpdateSettings {
  /** Check by itself after launch and while the app stays open. */
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
  | { step: 'notice'; current: string; version: string; notes: string; date: string | null }
  | { step: 'available'; current: string; version: string; notes: string; date: string | null }
  | { step: 'downloading'; version: string; received: number; total: number | null }
  | { step: 'installed'; version: string }
  | { step: 'error'; message: string };

export const useUpdate = create<UpdateState>(() => ({ step: 'idle' }));

type Found = Awaited<ReturnType<typeof import('@tauri-apps/plugin-updater').check>>;
let found: Found = null;
let pending: Promise<void> | null = null;
let manualRequested = false;
let installedVersion: string | null = null;
const dismissed = new Set<string>();

function releaseUpdate(update: Found) {
  if (update) void update.close().catch(e => console.error('[updates]', e));
}

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
  if (!isTauri() || (!manual && !useUpdateSettings.getState().automatic)) return;
  // Until relaunch, getVersion still names the old app. Do not offer to install it twice.
  if (installedVersion) {
    if (manual) useUpdate.setState({ step: 'installed', version: installedVersion });
    return;
  }
  const busy = useUpdate.getState().step;
  if (busy === 'downloading' || busy === 'installed') return;
  if (manual) {
    manualRequested = true;
    useUpdate.setState({ step: 'checking' });
  }
  if (pending) return pending;
  // Background checks must not replace a dialog the person is already using.
  if (!manual && busy !== 'idle' && busy !== 'notice') return;
  if (!manual) setUpdateSettings({ lastCheck: Date.now() });
  pending = (async () => {
    try {
      const [{ check }, { getVersion }] = await Promise.all([import('@tauri-apps/plugin-updater'), import('@tauri-apps/api/app')]);
      const current = await getVersion();
      const next = await check({ timeout: 30_000 });
      const settings = useUpdateSettings.getState();
      const step = useUpdate.getState().step;
      if (!manualRequested && (installedVersion || !settings.automatic || (step !== 'idle' && step !== 'notice'))) {
        releaseUpdate(next);
        return;
      }
      if (next && (!shouldOffer(next.version, settings, manualRequested) || (!manualRequested && dismissed.has(next.version)))) {
        releaseUpdate(next);
        return;
      }
      releaseUpdate(found);
      found = next;
      if (!next) {
        useUpdate.setState(manualRequested ? { step: 'none', current } : { step: 'idle' });
        return;
      }
      useUpdate.setState({ step: manualRequested ? 'available' : 'notice', current, version: next.version, notes: next.body ?? '', date: next.date ?? null });
    } catch (e) {
      console.error('[updates]', e);
      if (manualRequested) useUpdate.setState({ step: 'error', message: updateErrorMessage(e) });
      // A temporary connection failure leaves an existing notice intact.
    } finally {
      pending = null;
      manualRequested = false;
    }
  })();
  return pending;
}

/** Open the release notes and installer without making another network request. */
export function openUpdate() {
  const s = useUpdate.getState();
  if (s.step === 'notice') useUpdate.setState({ ...s, step: 'available' });
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
    releaseUpdate(found);
    found = null;
    installedVersion = version;
    useUpdate.setState({ step: 'installed', version });
  } catch (e) {
    console.error('[updates]', e);
    useUpdate.setState({ step: 'error', message: updateErrorMessage(e) });
  }
}

export function skipVersion() {
  const s = useUpdate.getState();
  if (s.step === 'available') setUpdateSettings({ skipped: s.version });
  closeUpdate();
}

export function closeUpdate() {
  const s = useUpdate.getState();
  if (s.step === 'downloading') return;
  if (s.step === 'notice' || s.step === 'available') dismissed.add(s.version);
  releaseUpdate(found);
  found = null;
  useUpdate.setState({ step: 'idle' });
}

/** Released builds check by themselves this long after launch, so opening a folder comes first. */
const AUTO_DELAY = 8_000;
export const AUTO_INTERVAL = 4 * 60 * 60 * 1_000;
export function scheduleAutomaticCheck() {
  if (!isTauri() || import.meta.env.DEV) return () => {};
  const started = Date.now();
  const check = (launch = false) => {
    const s = useUpdateSettings.getState();
    if (Date.now() - started < AUTO_DELAY || !autoCheckDue(s)) return;
    if (launch || s.lastCheck === null || Date.now() - s.lastCheck >= AUTO_INTERVAL) void checkForUpdates(false);
  };
  let repeat: ReturnType<typeof setInterval> | undefined;
  const launch = setTimeout(() => {
    check(true);
    // Re-evaluate elapsed time so a wake check does not postpone the next request to a later
    // four-hour timer slot. Only a due check contacts the server.
    repeat = setInterval(() => check(), 60_000);
  }, AUTO_DELAY);
  const onFocus = () => check();
  const onVisible = () => { if (document.visibilityState === 'visible') check(); };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearTimeout(launch);
    clearInterval(repeat);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
