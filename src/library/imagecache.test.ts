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
