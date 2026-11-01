// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../backend/api', () => ({ writeSidecar: vi.fn(() => Promise.resolve()) }));
import { writeSidecar } from '../backend/api';
import { flushSaves, savePhoto } from './sidecars';

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it('serializes family writes and flush waits for an already-started save', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  vi.mocked(writeSidecar).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const base = { path: '/a.jpg', recipe: null, rating: 0, label: null, heart: false };
  savePhoto(base);
  await vi.advanceTimersByTimeAsync(400);
  expect(writeSidecar).toHaveBeenCalledTimes(1);
  savePhoto({ ...base, copies: [{ id: 'one', name: 'Copy 1', recipe: null, rating: 3, label: null, heart: false }] });
  let flushed = false;
  const flushing = flushSaves().then(() => { flushed = true; });
  await Promise.resolve();
  expect(writeSidecar).toHaveBeenCalledTimes(1);
  expect(flushed).toBe(false);
  finish();
  await flushing;
  expect(writeSidecar).toHaveBeenCalledTimes(2);
  expect(writeSidecar).toHaveBeenLastCalledWith('/a.jpg', expect.objectContaining({ copies: [expect.objectContaining({ rating: 3 })] }));
});
