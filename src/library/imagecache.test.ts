import { describe, expect, it, vi } from 'vitest';
import { ImageLoadCache } from './imagecache';

const image = (bytes: number) => ({ data: new Uint16Array(bytes / 2) });
type TestImage = ReturnType<typeof image>;

describe('ImageLoadCache', () => {
  it('reuses a loaded image for the same path and size', async () => {
    const cache = new ImageLoadCache<TestImage>(1000, (v) => v.data.byteLength);
    const load = vi.fn().mockResolvedValue(image(20));

    const first = await cache.get('/photos/a.raw', 2560, load);
    const second = await cache.get('/photos/a.raw', 2560, load);

    expect(second).toBe(first);
    expect(load).toHaveBeenCalledOnce();
  });

  it('shares an in-flight load', async () => {
    const cache = new ImageLoadCache<TestImage>(1000, (v) => v.data.byteLength);
    let resolve!: (value: ReturnType<typeof image>) => void;
    const load = vi.fn(() => new Promise<ReturnType<typeof image>>((r) => { resolve = r; }));

    const first = cache.get('/photos/a.raw', 2560, load);
    const second = cache.get('/photos/a.raw', 2560, load);
    resolve(image(20));

    expect(await first).toBe(await second);
    expect(load).toHaveBeenCalledOnce();
  });

  it('evicts least-recently-used images within the byte budget', async () => {
    const cache = new ImageLoadCache<TestImage>(40, (v) => v.data.byteLength);
    const load = vi.fn(async (path: string) => image(path === 'a' ? 20 : 30));

    await cache.get('a', 2560, load);
    await cache.get('b', 2560, load);
    await cache.get('a', 2560, load);

    expect(load).toHaveBeenCalledTimes(3);
    expect(load).toHaveBeenLastCalledWith('a', 2560);
  });
});

describe('background image preparation', () => {
  it('delivers cached and shared foreground payloads only to the current preparation', async () => {
    vi.useFakeTimers();
    try {
      const cache = new ImageLoadCache<TestImage>(100, v => v.data.byteLength);
      const value = image(20), load = vi.fn().mockResolvedValue(value), ready = vi.fn();
      await cache.get('a', 100, load);
      cache.prepare('a', 100, load, ready);
      await vi.advanceTimersByTimeAsync(0);
      expect(ready).toHaveBeenCalledWith(value);
      expect(load).toHaveBeenCalledOnce();
      let resolve!: (v: TestImage) => void;
      const pending = vi.fn(() => new Promise<TestImage>(r => { resolve = r; }));
      const foreground = cache.get('b', 100, pending);
      const stale = vi.fn();
      cache.prepare('b', 100, pending, stale);
      await vi.advanceTimersByTimeAsync(0);
      cache.prepare('a', 100, load, ready); // navigation cancels the old callback
      resolve(image(20));
      await foreground;
      await vi.advanceTimersByTimeAsync(0);
      expect(stale).not.toHaveBeenCalled();
      expect(pending).toHaveBeenCalledOnce();
      expect(ready).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('does not upload an already-running preparation after cancellation or a cache clear', async () => {
    vi.useFakeTimers();
    try {
      for (const clear of [false, true]) {
        const cache = new ImageLoadCache<TestImage>(100, v => v.data.byteLength), ready = vi.fn();
        let resolve!: (v: TestImage) => void;
        const cancel = cache.prepare('a', 100, () => new Promise<TestImage>(r => { resolve = r; }), ready);
        await vi.advanceTimersByTimeAsync(0);
        if (clear) cache.clear(); else cancel();
        resolve(image(20));
        await vi.advanceTimersByTimeAsync(0);
        expect(ready).not.toHaveBeenCalled();
      }
    } finally { vi.useRealTimers(); }
  });

  it('cancels preparation before the next turn', async () => {
    vi.useFakeTimers();
    try {
      const cache = new ImageLoadCache<TestImage>(100, v => v.data.byteLength);
      const load = vi.fn().mockResolvedValue(image(20));
      const cancel = cache.prepare('a', 16384, load);
      cancel();
      await vi.advanceTimersByTimeAsync(0);
      expect(load).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('prepares only the latest photo after a running decode, without delaying foreground loads', async () => {
    vi.useFakeTimers();
    try {
      const cache = new ImageLoadCache<TestImage>(100, v => v.data.byteLength);
      const resolve = new Map<string, (value: TestImage) => void>();
      const load = vi.fn((path: string) => new Promise<TestImage>(r => { resolve.set(path, r); }));
      cache.prepare('a', 16384, load);
      await vi.advanceTimersByTimeAsync(0);
      cache.prepare('b', 16384, load);
      await vi.advanceTimersByTimeAsync(0);
      cache.prepare('c', 16384, load);
      await vi.advanceTimersByTimeAsync(0);
      expect(load.mock.calls.map(([path]) => path)).toEqual(['a']);
      const foreground = cache.get('d', 16384, load);
      expect(load.mock.calls.map(([path]) => path)).toEqual(['a', 'd']);
      resolve.get('a')!(image(20));
      await vi.advanceTimersByTimeAsync(0);
      expect(load.mock.calls.map(([path]) => path)).toEqual(['a', 'd', 'c']);
      resolve.get('c')!(image(20));
      resolve.get('d')!(image(20));
      await foreground;
      await vi.advanceTimersByTimeAsync(0);
      await cache.get('c', 16384, load);
      expect(load).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });

  it('releases the preparation slot after a failure and evicts prepared images by bytes', async () => {
    vi.useFakeTimers();
    try {
      const cache = new ImageLoadCache<TestImage>(30, v => v.data.byteLength);
      const load = vi.fn(async (path: string) => {
        if (path === 'broken') throw Error('bad RAW');
        return image(20);
      });
      cache.prepare('broken', 16384, load);
      await vi.advanceTimersByTimeAsync(0);
      cache.prepare('a', 16384, load);
      await vi.advanceTimersByTimeAsync(0);
      await cache.get('a', 16384, load);
      expect(load).toHaveBeenCalledTimes(2);
      cache.prepare('b', 16384, load);
      await vi.advanceTimersByTimeAsync(0);
      await cache.get('a', 16384, load);
      expect(load.mock.calls.map(([path]) => path)).toEqual(['broken', 'a', 'b', 'a']);
    } finally { vi.useRealTimers(); }
  });

  it('does not revive a cleared preparation or remove a newer foreground request', async () => {
    vi.useFakeTimers();
    try {
      const cache = new ImageLoadCache<TestImage>(100, v => v.data.byteLength);
      const resolve: ((value: TestImage) => void)[] = [];
      const load = vi.fn(() => new Promise<TestImage>(r => { resolve.push(r); }));
      cache.prepare('a', 16384, load);
      await vi.advanceTimersByTimeAsync(0);
      cache.clear();
      const foreground = cache.get('a', 16384, load);
      resolve[0](image(20));
      await vi.advanceTimersByTimeAsync(0);
      const joined = cache.get('a', 16384, load);
      resolve[1](image(30));
      expect(await joined).toBe(await foreground);
      expect((await foreground).data.byteLength).toBe(30);
      expect(load).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('shares prepared and foreground requests, and retains the result within the cache budget', async () => {
    vi.useFakeTimers();
    try {
      const cache = new ImageLoadCache<TestImage>(40, v => v.data.byteLength);
      let resolve!: (value: TestImage) => void;
      const load = vi.fn(() => new Promise<TestImage>(r => { resolve = r; }));
      cache.prepare('a', 16384, load);
      await vi.advanceTimersByTimeAsync(0);
      const foreground = cache.get('a', 16384, load);
      resolve(image(20));
      const prepared = await foreground;
      expect(await cache.get('a', 16384, load)).toBe(prepared);
      expect(load).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
