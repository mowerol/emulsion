// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../backend/api', () => ({ writeSidecar: vi.fn(() => Promise.resolve()) }));
import { writeSidecar } from '../backend/api';
import { flushSaves, freezeSaves, resumeSaves, savePhoto } from './sidecars';

afterEach(async () => { resumeSaves(); vi.mocked(writeSidecar).mockReset().mockResolvedValue(); await flushSaves(); vi.useRealTimers(); vi.clearAllMocks(); });

it('serializes family writes and flush waits for an already-started save', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  vi.mocked(writeSidecar).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const base = { path: '/a.jpg', recipe: null, rating: 0, label: null, flag: null };
  savePhoto(base);
  await vi.advanceTimersByTimeAsync(400);
  expect(writeSidecar).toHaveBeenCalledTimes(1);
  savePhoto({ ...base, copies: [{ id: 'one', name: 'Copy 1', recipe: null, rating: 3, label: null, flag: null }] });
  let flushed = false;
  const flushing = flushSaves().then(() => { flushed = true; });
  await Promise.resolve();
  expect(writeSidecar).toHaveBeenCalledTimes(1);
  expect(flushed).toBe(false);
  finish();
  await flushing;
  expect(writeSidecar).toHaveBeenCalledTimes(2);
  expect(writeSidecar).toHaveBeenLastCalledWith('/a.jpg', expect.objectContaining({ copies: [expect.objectContaining({ rating: 3 })] }), false);
});

it('retains a failed save and its checkpoint, then retries successfully on flush', async () => {
  vi.useFakeTimers();
  vi.mocked(writeSidecar).mockRejectedValueOnce(new Error('Disk full'));
  const { useSaveIssues } = await import('./saveissues');
  const base = { path: '/retry.jpg', recipe: { exposure: 1 }, rating: 0, label: null, flag: null };
  savePhoto(base, true);
  await vi.advanceTimersByTimeAsync(400);
  expect(useSaveIssues.getState().issues['/retry.jpg']).toContain('Disk full');
  await flushSaves();
  expect(writeSidecar).toHaveBeenLastCalledWith('/retry.jpg', expect.objectContaining({ recipe: { exposure: 1 } }), true);
  expect(useSaveIssues.getState().issues).toEqual({});
});

it('a newer edit supersedes a failed payload without losing its checkpoint', async () => {
  vi.useFakeTimers();
  vi.mocked(writeSidecar).mockRejectedValueOnce(new Error('Disk full'));
  const base = { path: '/newer.jpg', recipe: { exposure: 1 }, rating: 0, label: null, flag: null };
  savePhoto(base, true);
  await vi.advanceTimersByTimeAsync(400);
  savePhoto({ ...base, recipe: { exposure: 2 } });
  await flushSaves();
  expect(writeSidecar).toHaveBeenLastCalledWith('/newer.jpg', expect.objectContaining({ recipe: { exposure: 2 } }), true);
});

it('flush rejects while a save still fails, so quit and backup cannot report success', async () => {
  vi.useFakeTimers();
  vi.mocked(writeSidecar).mockRejectedValue(new Error('Drive unavailable'));
  savePhoto({ path: '/unsaved.jpg', recipe: null, rating: 5, label: null, flag: null });
  await expect(flushSaves()).rejects.toThrow('Drive unavailable');
  await expect(flushSaves()).rejects.toThrow('Drive unavailable');
});

it('catalog restore freezes old-session saves until reload or recovery', async () => {
  const base = { path: '/restore.jpg', recipe: { exposure: 1 }, rating: 0, label: null, flag: null };
  savePhoto(base);
  await freezeSaves();
  expect(writeSidecar).toHaveBeenCalledTimes(1);
  savePhoto({ ...base, recipe: { exposure: 99 } });
  await flushSaves();
  expect(writeSidecar).toHaveBeenCalledTimes(1);
  resumeSaves();
  savePhoto({ ...base, recipe: { exposure: 2 } });
  await flushSaves();
  expect(writeSidecar).toHaveBeenLastCalledWith('/restore.jpg', expect.objectContaining({ recipe: { exposure: 2 } }), false);
});
