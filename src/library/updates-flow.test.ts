// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ check: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: native.check }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.3.2' }));
vi.mock('../backend/api', () => ({ isTauri: native.isTauri }));
vi.mock('./appsettings', () => ({ getSetting: () => undefined, setSetting: vi.fn() }));

let updates: typeof import('./updates');
let stop = () => {};
const release = (version = '0.3.3') => ({ version, body: 'Changes', date: null, close: vi.fn(async () => {}), downloadAndInstall: vi.fn(async () => {}) });
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv('DEV', false);
  native.isTauri.mockReturnValue(true);
  native.check.mockReset().mockResolvedValue(null);
  updates = await import('./updates');
});
afterEach(() => { stop(); stop = () => {}; vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('checks after launch, repeats while open, and cleans up timers and wake listeners', async () => {
  stop = updates.scheduleAutomaticCheck();
  await vi.advanceTimersByTimeAsync(7_999);
  expect(native.check).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(native.check).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(updates.AUTO_INTERVAL);
  expect(native.check).toHaveBeenCalledTimes(2);
  // A sleeping computer may not deliver its timer; returning to the app catches up.
  vi.setSystemTime(Date.now() + updates.AUTO_INTERVAL + 1);
  window.dispatchEvent(new Event('focus'));
  await updates.checkForUpdates(false); // joins the pending wake check
  expect(native.check).toHaveBeenCalledTimes(3);
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(native.check).toHaveBeenCalledTimes(3);
  stop();
  vi.setSystemTime(Date.now() + updates.AUTO_INTERVAL + 1);
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(updates.AUTO_INTERVAL);
  expect(native.check).toHaveBeenCalledTimes(3);
});

it('honors automatic checks being off, including a setting change during a request', async () => {
  updates.setUpdateSettings({ automatic: false });
  stop = updates.scheduleAutomaticCheck();
  await vi.advanceTimersByTimeAsync(8_000 + updates.AUTO_INTERVAL);
  expect(native.check).not.toHaveBeenCalled();
  // Manual checks still work when automatic checks are off.
  await updates.checkForUpdates(true);
  expect(updates.useUpdate.getState().step).toBe('none');
  updates.closeUpdate();
  updates.setUpdateSettings({ automatic: true });
  const candidate = release();
  native.check.mockImplementationOnce(async () => {
    updates.setUpdateSettings({ automatic: false });
    return candidate;
  });
  await updates.checkForUpdates(false);
  expect(updates.useUpdate.getState().step).toBe('idle');
  expect(candidate.close).toHaveBeenCalledOnce();
});

it('checks four hours after a wake check even when it falls between the original timer slots', async () => {
  stop = updates.scheduleAutomaticCheck();
  await vi.advanceTimersByTimeAsync(8_000 + updates.AUTO_INTERVAL / 2);
  expect(native.check).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + updates.AUTO_INTERVAL);
  window.dispatchEvent(new Event('focus'));
  await updates.checkForUpdates(false);
  expect(native.check).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(updates.AUTO_INTERVAL);
  expect(native.check).toHaveBeenCalledTimes(3);
});

it('uses notices for automatic discoveries, suppresses dismissed versions for the session, and still offers newer or manual updates', async () => {
  const first = release();
  native.check.mockResolvedValueOnce(first);
  await updates.checkForUpdates(false);
  expect(updates.useUpdate.getState()).toMatchObject({ step: 'notice', version: '0.3.3' });
  updates.closeUpdate();
  expect(first.close).toHaveBeenCalledOnce();
  const repeated = release();
  native.check.mockResolvedValueOnce(repeated);
  await updates.checkForUpdates(false);
  expect(updates.useUpdate.getState().step).toBe('idle');
  expect(repeated.close).toHaveBeenCalledOnce();
  native.check.mockResolvedValueOnce(release('0.3.4'));
  await updates.checkForUpdates(false);
  expect(updates.useUpdate.getState()).toMatchObject({ step: 'notice', version: '0.3.4' });
  updates.openUpdate();
  expect(updates.useUpdate.getState().step).toBe('available');
  updates.closeUpdate();
  native.check.mockResolvedValueOnce(release());
  await updates.checkForUpdates(true);
  expect(updates.useUpdate.getState()).toMatchObject({ step: 'available', version: '0.3.3' });
});

it('shares an in-flight background check with a manual check and opens its result as a dialog', async () => {
  let finish!: (value: ReturnType<typeof release>) => void;
  native.check.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const background = updates.checkForUpdates(false);
  await vi.waitFor(() => expect(native.check).toHaveBeenCalledOnce());
  const manual = updates.checkForUpdates(true);
  expect(updates.useUpdate.getState().step).toBe('checking');
  finish(release());
  await Promise.all([background, manual]);
  expect(native.check).toHaveBeenCalledOnce();
  expect(updates.useUpdate.getState().step).toBe('available');
});

it('keeps a notice on network failure and never overwrites an open installer', async () => {
  native.check.mockResolvedValueOnce(release());
  await updates.checkForUpdates(false);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  native.check.mockRejectedValueOnce(new Error('offline'));
  await updates.checkForUpdates(false);
  expect(updates.useUpdate.getState().step).toBe('notice');
  updates.openUpdate();
  await updates.checkForUpdates(false);
  expect(native.check).toHaveBeenCalledTimes(2);
  expect(updates.useUpdate.getState().step).toBe('available');
});

it('discards a refreshed result when the person opens or dismisses its notice during the check', async () => {
  native.check.mockResolvedValueOnce(release());
  await updates.checkForUpdates(false);
  const next = release();
  native.check.mockImplementationOnce(async () => { updates.openUpdate(); return next; });
  await updates.checkForUpdates(false);
  expect(updates.useUpdate.getState().step).toBe('available');
  expect(next.close).toHaveBeenCalledOnce();
  updates.closeUpdate();
  native.check.mockResolvedValueOnce(release());
  await updates.checkForUpdates(false);
  expect(updates.useUpdate.getState().step).toBe('idle');
});

it('keeps skipped versions hidden automatically and installs only after the notice opens', async () => {
  const candidate = release();
  native.check.mockResolvedValueOnce(candidate);
  await updates.checkForUpdates(false);
  await updates.installUpdate();
  expect(candidate.downloadAndInstall).not.toHaveBeenCalled();
  updates.openUpdate();
  updates.skipVersion();
  native.check.mockResolvedValueOnce(release());
  await updates.checkForUpdates(false);
  expect(updates.useUpdate.getState().step).toBe('idle');
  const manual = release();
  native.check.mockResolvedValueOnce(manual);
  await updates.checkForUpdates(true);
  await updates.installUpdate();
  expect(manual.downloadAndInstall).toHaveBeenCalledOnce();
  expect(manual.close).toHaveBeenCalledOnce();
  expect(updates.useUpdate.getState().step).toBe('installed');
  updates.closeUpdate(); // Relaunch Later must not offer the same download again.
  native.check.mockClear();
  await updates.checkForUpdates(false);
  expect(native.check).not.toHaveBeenCalled();
  expect(updates.useUpdate.getState().step).toBe('idle');
  await updates.checkForUpdates(true);
  expect(native.check).not.toHaveBeenCalled();
  expect(updates.useUpdate.getState().step).toBe('installed');
});

it('does not schedule checks in development or a browser', () => {
  vi.stubEnv('DEV', true);
  updates.scheduleAutomaticCheck()();
  expect(vi.getTimerCount()).toBe(0);
  vi.stubEnv('DEV', false);
  native.isTauri.mockReturnValue(false);
  updates.scheduleAutomaticCheck()();
  expect(vi.getTimerCount()).toBe(0);
});
