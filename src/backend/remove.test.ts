// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { removeCachedPatch, removeInpaint } from './api';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const native = vi.mocked(invoke);
const N = 512 * 512;
const KEY = '0123456789abcdef0123456789ab';
beforeEach(() => native.mockReset());

it('sends an RGBA crop followed by mask bytes and reads the native patch', async () => {
  const image = new Uint8Array(N * 4), mask = new Uint8Array(N);
  image[0] = 12; image[image.length - 1] = 255;
  mask[0] = 1; mask[N - 1] = 255;
  const patch = new Uint8Array(N * 4).fill(73);
  native.mockResolvedValue(patch.buffer);
  const result = await removeInpaint(KEY, image, mask);
  expect(result.length).toBe(patch.length);
  expect(result.every((value, i) => value === patch[i])).toBe(true);
  const [command, body, options] = native.mock.calls[0];
  expect(command).toBe('remove_inpaint');
  expect(options).toEqual({ headers: { 'x-emulsion-key': KEY } });
  expect(body).toBeInstanceOf(Uint8Array);
  const bytes = body as Uint8Array;
  expect(bytes.length).toBe(N * 5);
  expect([...bytes.subarray(N * 4 - 1, N * 4 + 1)]).toEqual([255, 1]);
  expect(bytes[0]).toBe(12);
  expect(bytes[bytes.length - 1]).toBe(255);
});

it('rejects invalid requests before invoking native code', async () => {
  const image = new Uint8Array(N * 4), mask = new Uint8Array(N);
  await expect(removeInpaint('../invalid', image, mask)).rejects.toThrow('Invalid Remove');
  await expect(removeInpaint(KEY, image.subarray(4), mask)).rejects.toThrow('Invalid Remove');
  await expect(removeInpaint(KEY, image, mask.subarray(1))).rejects.toThrow('Invalid Remove');
  expect(native).not.toHaveBeenCalled();
});

it('rejects a truncated patch instead of letting it enter the retouch step', async () => {
  native.mockResolvedValue(new ArrayBuffer(4));
  await expect(removeInpaint(KEY, new Uint8Array(N * 4), new Uint8Array(N))).rejects.toThrow('Invalid Remove patch size');
});

it('restores a cached patch using only its key and reports a miss without inference', async () => {
  const patch = new Uint8Array(N * 4).fill(91);
  native.mockResolvedValueOnce(patch.buffer).mockResolvedValueOnce(new ArrayBuffer(0));
  const restored = await removeCachedPatch(KEY);
  expect(restored?.length).toBe(patch.length);
  expect(restored?.every((value, i) => value === patch[i])).toBe(true);
  expect(await removeCachedPatch(KEY)).toBeNull();
  expect(native.mock.calls).toEqual([
    ['remove_cached_patch', { key: KEY }], ['remove_cached_patch', { key: KEY }],
  ]);
});

it('validates cache keys and rejects truncated cached pixels', async () => {
  await expect(removeCachedPatch('../invalid')).rejects.toThrow('Invalid Remove patch key');
  expect(native).not.toHaveBeenCalled();
  native.mockResolvedValue(new ArrayBuffer(4));
  await expect(removeCachedPatch(KEY)).rejects.toThrow('Invalid Remove patch size');
});
