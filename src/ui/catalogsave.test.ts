// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(async () => undefined), flush: vi.fn(async () => {}), toast: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('../library/sidecars', () => ({ flushSaves: mocks.flush }));
vi.mock('../library/catalog', () => ({ flushCatalog: async () => {} }));
vi.mock('../library/appsettings', () => ({ flushAppSettings: async () => {} }));
vi.mock('../library/store', () => ({ useApp: { getState: () => ({ lookEdit: null }) }, showToast: mocks.toast }));
vi.mock('../library/catalogbackup', () => ({
  BACKUP_FREQUENCIES: [], backupDue: () => false,
  useCatalogBackup: { getState: () => ({}) },
}));
beforeEach(() => { vi.resetModules(); mocks.invoke.mockClear(); mocks.toast.mockClear(); mocks.flush.mockReset().mockResolvedValue(); });

it('keeps the app open when a save fails and allows another quit after recovery', async () => {
  const { requestQuit } = await import('./CatalogBackupDialog');
  mocks.flush.mockRejectedValueOnce(new Error('Disk full'));
  await requestQuit();
  expect(mocks.invoke).toHaveBeenCalledWith('quit_ack');
  expect(mocks.invoke).not.toHaveBeenCalledWith('quit_now');
  expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('staying open'));
  await requestQuit();
  expect(mocks.invoke).toHaveBeenCalledWith('quit_now');
});

it('does not restart for an update until its outstanding saves succeed', async () => {
  const { saveAndRelaunch } = await import('./CatalogBackupDialog');
  mocks.flush.mockRejectedValueOnce(new Error('Disk full'));
  await saveAndRelaunch();
  expect(mocks.invoke).not.toHaveBeenCalledWith('relaunch_now');
  await saveAndRelaunch();
  expect(mocks.invoke).toHaveBeenCalledWith('relaunch_now');
});
