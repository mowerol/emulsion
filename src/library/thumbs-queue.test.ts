// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ thumbnail: vi.fn() }));
vi.mock('../backend/api', async importOriginal => ({ ...await importOriginal<typeof import('../backend/api')>(), ...api }));
globalThis.URL.createObjectURL ??= () => 'blob:x';
import { ThumbStore } from './thumbs';

const flush = () => new Promise(r => setTimeout(r, 0));

describe('thumbnail fetch queue', () => {
  it('serves frames on screen first and drops frames that scrolled away', async () => {
    const pending = new Map<string, (b: Blob) => void>();
    const order: string[] = [];
    api.thumbnail.mockImplementation((path: string) => { order.push(path); return new Promise(r => pending.set(path, r)); });
    const t = new ThumbStore();
    const show = (p: string) => { t.watch(p); t.want(p, null, 1, null); };
    // A slow folder fills the four slots, then more of it queues.
    for (const p of ['s1', 's2', 's3', 's4', 'q1', 'q2', 'q3']) show(p);
    await flush();
    expect(order).toEqual(['s1', 's2', 's3', 's4']);
    // Scrolled away from the queued ones; an older folder's frames come on screen.
    for (const p of ['q1', 'q2', 'q3']) t.unwant(p);
    show('old1'); show('old2');
    await flush();
    expect(t.hasFailed('q1')).toBe(false);
    pending.get('s1')!(new Blob()); await flush();
    pending.get('s2')!(new Blob()); await flush();
    expect(order.slice(4)).toEqual(['old2', 'old1']);
    // Back on screen, a dropped frame is fetched again.
    show('q1'); pending.get('s3')!(new Blob()); await flush();
    expect(order.slice(6)).toEqual(['q1']);
  });

  it('keeps a fetch Develop also waits for when its frame leaves the screen', async () => {
    const pending = new Map<string, (b: Blob) => void>();
    api.thumbnail.mockImplementation((path: string) => new Promise(r => pending.set(path, r)));
    const t = new ThumbStore();
    for (const p of ['s1', 's2', 's3', 's4', 'a']) { t.watch(p); t.want(p, null, 1, null); }
    await flush();
    const develop = t.original('a');
    t.unwant('a');
    pending.get('s1')!(new Blob()); await flush();
    pending.get('a')!(new Blob());
    await expect(develop).resolves.toHaveProperty('url');
  });
});
