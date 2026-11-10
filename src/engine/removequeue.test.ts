// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { defaultRecipe } from '../film/recipe';
import { newCircleSpot } from '../film/retouch';
import { RemoveQueue, planRemovals, removeContext, removalIdentity, type RemoveState } from './removequeue';
import type { PatchRequest } from './remove';

const N = 512 * 512;
const input = { image: new Uint8Array(N * 4), mask: new Uint8Array(N) };
const pixels = new Uint8Array(N * 4).fill(128);
const recipe = { ...defaultRecipe(), retouch: [newCircleSpot([.5, .5], 'remove', .1, .02)] };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe('Remove lifecycle', () => {
  it('finishes spots in order and gives later crop preparation the completed earlier patch', async () => {
    const r = { ...recipe, retouch: [...recipe.retouch, newCircleSpot([.55, .5], 'remove', .08, .02)] };
    const c = removeContext('photo', r, .25);
    const first = deferred<Uint8Array>();
    const prepare = vi.fn(async (_request, context) => {
      if (prepare.mock.calls.length === 2) expect(context.patches.has(r.retouch[0].id)).toBe(true);
      return input;
    });
    const infer = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(pixels);
    const queue = new RemoveQueue(prepare, infer, () => {});
    queue.update(c, r, 4000, 3000);
    await settle();
    expect(prepare).toHaveBeenCalledTimes(1);
    first.resolve(pixels);
    await settle();
    expect(prepare).toHaveBeenCalledTimes(2);
    expect([...c.patches.keys()]).toEqual(r.retouch.map(s => s.id));
  });

  it('keeps the last patch while regenerating and ignores exposure, tone, look and opacity edits', async () => {
    const c = removeContext('photo', recipe, .25);
    const wait = deferred<Uint8Array>();
    const infer = vi.fn().mockResolvedValueOnce(pixels).mockImplementation(() => wait.promise);
    const queue = new RemoveQueue(async () => input, infer, () => {});
    queue.update(c, recipe, 4000, 3000); await settle();
    const patch = c.patches.get(recipe.retouch[0].id)!;
    const later = { ...recipe, exposure: 2, contrast: 30, lookAmount: 25, retouch: recipe.retouch.map(s => ({ ...s, opacity: .4 })) };
    queue.update(removeContext('photo', later, .25, c.patches), later, 4000, 3000); await settle();
    expect(infer).toHaveBeenCalledTimes(1);
    const wb = { ...later, wb: { temperature: 4000, tint: 15 } };
    const next = removeContext('photo', wb, .25, c.patches);
    queue.update(next, wb, 4000, 3000); await settle();
    expect(infer).toHaveBeenCalledTimes(2);
    expect(next.patches.get(recipe.retouch[0].id)).toBe(patch);
    wait.resolve(new Uint8Array(N * 4).fill(200)); await settle();
    expect(next.patches.get(recipe.retouch[0].id)?.key).not.toBe(patch.key);
  });

  it('rejects stale results after a stroke changes, navigation, deletion or disposal', async () => {
    const wait = deferred<Uint8Array>();
    const infer = vi.fn().mockImplementationOnce(() => wait.promise).mockResolvedValue(pixels);
    const queue = new RemoveQueue(async () => input, infer, () => {});
    const old = removeContext('first', recipe, .25);
    queue.update(old, recipe, 4000, 3000); await settle();
    const moved = { ...recipe, retouch: [newCircleSpot([.7, .7], 'remove')] };
    const next = removeContext('second', moved, .25);
    queue.update(next, moved, 4000, 3000);
    wait.resolve(pixels); await settle();
    expect(old.patches.size).toBe(0);
    expect(next.patches.size).toBe(1);
    const pending = deferred<PatchRequest['input']>();
    const final = removeContext('third', recipe, .25);
    const stopped = new RemoveQueue(() => pending.promise, infer, () => {});
    stopped.update(final, recipe, 4000, 3000);
    stopped.clear(); pending.resolve(input); await settle();
    expect(final.patches.size).toBe(0);
    expect(infer).toHaveBeenCalledTimes(2);
  });

  it('reports failures once and blocks later inputs until a changed dependency retries', async () => {
    let states: RemoveState[] = [];
    const r = { ...recipe, retouch: [...recipe.retouch, newCircleSpot([.6, .6], 'remove')] };
    const c = removeContext('photo', r, .25);
    const infer = vi.fn().mockRejectedValue(new Error('Model missing'));
    const queue = new RemoveQueue(async () => input, infer, s => { states = s; });
    queue.update(c, r, 4000, 3000); await settle();
    queue.update(c, r, 4000, 3000); await settle();
    expect(infer).toHaveBeenCalledTimes(1);
    expect(states.map(s => s.status)).toEqual(['failed', 'failed']);
    expect(states[0].error).toContain('Model missing');
    const wb = { ...r, wb: { temperature: 4500, tint: 0 } };
    queue.update(removeContext('photo', wb, .25), wb, 4000, 3000); await settle();
    expect(infer).toHaveBeenCalledTimes(2);
  });

  it('does not substitute LaMa for a saved unknown model', async () => {
    const r = { ...recipe, retouch: recipe.retouch.map(s => ({ ...s, model: 'future-model' })) };
    const infer = vi.fn();
    let states: RemoveState[] = [];
    new RemoveQueue(async () => input, infer, s => { states = s; }).update(removeContext('p', r, 1), r, 4000, 3000);
    await settle();
    expect(infer).not.toHaveBeenCalled();
    expect(states[0].error).toContain('future-model');
  });

  it('chooses full detail for a small spot and keeps virtual copies on the same key', () => {
    const small = { ...recipe, retouch: [newCircleSpot([.5, .5], 'remove', .01, .005)] };
    const requests = planRemovals(removeContext('same-original', small, .25), small, 4000, 3000);
    expect(requests[0].source).toBe('full');
    const src = { origin: '/photo', fullW: 4000, fullH: 3000, mode: 2, white: null };
    const fileKey = (version: string) => planRemovals(removeContext(removalIdentity(src, '', version), small, .25), small, 4000, 3000)[0].key;
    expect(fileKey('[123,100]')).not.toBe(fileKey('[123,101]'));
    const copy = { ...small, retouch: small.retouch.map(s => ({ ...s, id: 'copy-id' })) };
    expect(planRemovals(removeContext('same-original', copy, 1), copy, 4000, 3000)[0].key).toBe(requests[0].key);
  });
});

it('explicit retry fills failed spots in order without changing the recipe or key', async () => {
  const r = { ...recipe, retouch: [...recipe.retouch, newCircleSpot([.6, .6], 'remove')] };
  const c = removeContext('photo', r, 1);
  const infer = vi.fn().mockRejectedValueOnce(new Error('Model missing')).mockResolvedValue(pixels);
  let states: RemoveState[] = [];
  const queue = new RemoveQueue(async () => input, infer, s => { states = s; });
  queue.update(c, r, 4000, 3000); await settle();
  const keys = states.map(s => s.key);
  expect(states.every(s => s.status === 'failed')).toBe(true);
  queue.retry(); await settle();
  expect(states.map(s => s.key)).toEqual(keys);
  expect(states.every(s => s.status === 'ready')).toBe(true);
  expect(infer).toHaveBeenCalledTimes(3);
});

it('reuses a finished patch when toolbar resizing changes only the preview scale', async () => {
  const context = removeContext('photo', recipe, .25);
  const infer = vi.fn().mockResolvedValue(pixels);
  let states: RemoveState[] = [];
  const queue = new RemoveQueue(async () => input, infer, value => { states = value; });
  queue.update(context, recipe, 4000, 3000); await settle();
  const key = states[0].key;
  queue.update(removeContext('photo', recipe, .5, context.patches), recipe, 4000, 3000);
  await settle();
  expect(states[0]).toMatchObject({ key, status: 'ready' });
  expect(infer).toHaveBeenCalledTimes(1);
});

it('restores a completed removal on return before waiting for crop preparation', async () => {
  const disk = new Map<string, Uint8Array>();
  const blocked = deferred<PatchRequest['input']>();
  const prepare = vi.fn().mockResolvedValueOnce(input).mockImplementation(() => blocked.promise);
  const infer = vi.fn(async (r: PatchRequest) => { disk.set(r.key, pixels); return pixels; });
  const cached = vi.fn(async (r: PatchRequest) => disk.get(r.key) ?? null);
  let states: RemoveState[] = [];
  const queue = new RemoveQueue(prepare, infer, s => { states = s; }, cached);
  const first = removeContext('photo', recipe, .25);
  queue.update(first, recipe, 4000, 3000); await settle();
  expect(states[0].status).toBe('ready');
  queue.clear();
  const returned = removeContext('photo', recipe, .25);
  queue.update(returned, recipe, 4000, 3000); await settle();
  expect(states[0].status).toBe('ready');
  expect(returned.patches.get(recipe.retouch[0].id)?.pixels).toBe(pixels);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(infer).toHaveBeenCalledTimes(1);
});

it('restores a cached photo while obsolete inference for another photo is still pending', async () => {
  const cachedPhoto = removeContext('cached-photo', recipe, .25);
  const key = planRemovals(cachedPhoto, recipe, 4000, 3000)[0].key;
  const waiting = deferred<Uint8Array>();
  const infer = vi.fn(() => waiting.promise);
  const prepare = vi.fn(async () => input);
  let states: RemoveState[] = [];
  const queue = new RemoveQueue(prepare, infer, s => { states = s; }, async r => r.key === key ? pixels : null);
  queue.update(removeContext('other-photo', recipe, .25), recipe, 4000, 3000); await settle();
  expect(infer).toHaveBeenCalledTimes(1);
  queue.update(cachedPhoto, recipe, 4000, 3000); await settle();
  expect(states[0]).toMatchObject({ key, status: 'ready' });
  expect(cachedPhoto.patches.get(recipe.retouch[0].id)?.pixels).toBe(pixels);
  expect(prepare).toHaveBeenCalledTimes(1);
  waiting.resolve(pixels); await settle();
  expect(states[0]).toMatchObject({ key, status: 'ready' });
});

it('discards a cache read that finishes after navigation or clearing the queue', async () => {
  const pending = deferred<Uint8Array | null>();
  const prepare = vi.fn(async () => input), infer = vi.fn(async () => pixels);
  const first = removeContext('first', recipe, 1), next = removeContext('next', recipe, 1);
  const cached = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue(pixels);
  const queue = new RemoveQueue(prepare, infer, () => {}, cached);
  queue.update(first, recipe, 4000, 3000);
  queue.clear(); queue.update(next, recipe, 4000, 3000); await settle();
  pending.resolve(pixels); await settle();
  expect(first.patches.size).toBe(0);
  expect(next.patches.size).toBe(1);
  expect(prepare).not.toHaveBeenCalled();
  expect(infer).not.toHaveBeenCalled();
});

it.each(['missing', 'unreadable', 'truncated'])('regenerates when the cached patch is %s', async (kind) => {
  const cached = vi.fn(async () => {
    if (kind === 'unreadable') throw Error('Cache unavailable');
    return kind === 'truncated' ? new Uint8Array(4) : null;
  });
  const prepare = vi.fn(async () => input), infer = vi.fn(async () => pixels);
  const context = removeContext('photo', recipe, 1);
  const queue = new RemoveQueue(prepare, infer, () => {}, cached);
  queue.update(context, recipe, 4000, 3000); await settle();
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(infer).toHaveBeenCalledTimes(1);
  expect(context.patches.get(recipe.retouch[0].id)?.pixels).toBe(pixels);
});
