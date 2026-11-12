// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../backend/api', () => ({ isTauri: () => true, noiseModelStatus: vi.fn(), noiseModelInstall: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
import { listen } from '@tauri-apps/api/event';
import { noiseModelInstall, noiseModelStatus } from '../backend/api';
import { checkNoiseModel, installNoiseModel, useNoiseModel } from './noisemodel';

beforeEach(() => {
  vi.resetAllMocks();
  useNoiseModel.setState({ phase: 'idle', download: 0, progress: null, error: null, installs: 0 });
  vi.mocked(noiseModelStatus).mockResolvedValue({ supported: true, installed: false, download: 67_700_000 });
  vi.mocked(listen).mockResolvedValue(vi.fn());
});

it('checking a missing model never downloads it', async () => {
  await checkNoiseModel();
  expect(useNoiseModel.getState()).toMatchObject({ phase: 'missing', download: 67_700_000 });
  expect(noiseModelInstall).not.toHaveBeenCalled();
});

it('installs once after consent, counts the install and unsubscribes', async () => {
  let finish!: () => void;
  vi.mocked(noiseModelInstall).mockImplementation(() => new Promise<void>(r => { finish = r; }));
  const unlisten = vi.fn(); vi.mocked(listen).mockResolvedValue(unlisten);
  await checkNoiseModel();
  const install = installNoiseModel();
  await vi.waitFor(() => expect(noiseModelInstall).toHaveBeenCalledTimes(1));
  expect(await installNoiseModel()).toBe(false);
  expect(useNoiseModel.getState().phase).toBe('downloading');
  finish();
  expect(await install).toBe(true);
  expect(useNoiseModel.getState()).toMatchObject({ phase: 'ready', progress: null, installs: 1 });
  expect(noiseModelInstall).toHaveBeenCalledTimes(1);
  expect(unlisten).toHaveBeenCalledOnce();
});

it('keeps a failed download recoverable without retrying on its own', async () => {
  vi.mocked(noiseModelInstall).mockRejectedValue(Error('Download interrupted'));
  await checkNoiseModel();
  expect(await installNoiseModel()).toBe(false);
  expect(useNoiseModel.getState()).toMatchObject({ phase: 'error', error: 'Error: Download interrupted', progress: null, installs: 0 });
  await checkNoiseModel();
  expect(useNoiseModel.getState().phase).toBe('missing');
  expect(noiseModelInstall).toHaveBeenCalledTimes(1);
});

it('an installed model is ready even where downloads are unsupported (a setup-script install)', async () => {
  vi.mocked(noiseModelStatus).mockResolvedValueOnce({ supported: false, installed: true, download: 0 });
  await checkNoiseModel();
  expect(useNoiseModel.getState()).toMatchObject({ phase: 'ready', error: null });
});

it('reports unsupported Macs without offering a download', async () => {
  vi.mocked(noiseModelStatus).mockResolvedValueOnce({ supported: false, installed: false, download: 0 });
  await checkNoiseModel();
  expect(await installNoiseModel()).toBe(false);
  expect(useNoiseModel.getState().phase).toBe('unsupported');
  expect(noiseModelInstall).not.toHaveBeenCalled();
});
