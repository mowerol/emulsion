// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../backend/api', () => ({ isTauri: () => true, removeStatus: vi.fn(), removeInstall: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
import { listen } from '@tauri-apps/api/event';
import { removeInstall, removeStatus } from '../backend/api';
import { checkRemoveModel, declineRemoveDownload, installRemoveModel, useRemoveUi } from './removemodel';

beforeEach(() => {
  vi.resetAllMocks();
  useRemoveUi.setState({ phase: 'idle', download: 0, progress: null, error: null, retry: 0 });
  vi.mocked(removeStatus).mockResolvedValue({ supported: true, installed: false, download: 208_000_000, model: 'lama' });
  vi.mocked(listen).mockResolvedValue(vi.fn());
});

it('checking and declining a missing model never download anything', async () => {
  await checkRemoveModel();
  expect(useRemoveUi.getState()).toMatchObject({ phase: 'missing', download: 208_000_000 });
  declineRemoveDownload();
  await installRemoveModel();
  expect(useRemoveUi.getState().phase).toBe('declined');
  expect(removeInstall).not.toHaveBeenCalled();
});

it('installs once after consent, unsubscribes, and retries existing spots on completion', async () => {
  let finish!: () => void;
  vi.mocked(removeInstall).mockImplementation(() => new Promise<void>(r => { finish = r; }));
  const unlisten = vi.fn(); vi.mocked(listen).mockResolvedValue(unlisten);
  await checkRemoveModel();
  const install = installRemoveModel();
  await vi.waitFor(() => expect(removeInstall).toHaveBeenCalledTimes(1));
  await installRemoveModel();
  expect(useRemoveUi.getState().phase).toBe('downloading');
  expect(useRemoveUi.getState().retry).toBe(0);
  finish(); await install;
  expect(useRemoveUi.getState()).toMatchObject({ phase: 'ready', progress: null, retry: 1 });
  expect(removeInstall).toHaveBeenCalledTimes(1);
  expect(unlisten).toHaveBeenCalledOnce();
});

it('keeps an install failure recoverable without silently downloading again', async () => {
  vi.mocked(removeInstall).mockRejectedValue(Error('Download interrupted'));
  await checkRemoveModel(); await installRemoveModel();
  expect(useRemoveUi.getState()).toMatchObject({ phase: 'error', error: 'Error: Download interrupted', progress: null, retry: 0 });
  await checkRemoveModel();
  expect(useRemoveUi.getState().phase).toBe('missing');
  expect(removeInstall).toHaveBeenCalledTimes(1);
});

it('reports unsupported platforms and progress subscription failures without installing', async () => {
  vi.mocked(removeStatus).mockResolvedValueOnce({ supported: false, installed: false, download: 0, model: 'lama' });
  await checkRemoveModel(); await installRemoveModel();
  expect(useRemoveUi.getState().phase).toBe('unsupported');
  await checkRemoveModel();
  vi.mocked(listen).mockRejectedValueOnce(Error('Could not listen for progress'));
  await installRemoveModel();
  expect(useRemoveUi.getState()).toMatchObject({ phase: 'error', progress: null });
  expect(removeInstall).not.toHaveBeenCalled();
});
