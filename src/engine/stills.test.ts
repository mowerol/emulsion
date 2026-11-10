// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it, vi } from 'vitest';
const log = vi.hoisted(() => ({ calls: [] as string[], reads: [] as ((px: Uint8Array) => void)[] }));
vi.mock('./engine', () => ({
  Engine: class {
    maxTextureSize = 4096;
    removeContext: unknown = null;
    sourceFromHalf() { return { w: 4, h: 2 }; }
    release() { log.calls.push('release'); }
    readPixelsAsync(_src: unknown, recipe: { id: string } | null) {
      log.calls.push(`draw ${recipe?.id} with ${JSON.stringify(this.removeContext)}`);
      return new Promise<Uint8Array>((resolve) => log.reads.push(resolve));
    }
  },
}));
import { StillRenderer, type FromStills } from './stills';
import type { HalfImage } from './engine';
import type { Recipe } from '../film/recipe';
import type { RemoveContext } from './removequeue';

const replies: FromStills[] = [];
const recipe = (id: string) => ({ id }) as unknown as Recipe;
const flush = () => new Promise((r) => setTimeout(r, 0));

it('renders one at a time, with the removal context only while the draw is submitted', async () => {
  const r = new StillRenderer({} as OffscreenCanvas, (m) => replies.push(m));
  expect(replies.shift()).toEqual({ type: 'ready', maxTextureSize: 4096 });
  r.handle({ type: 'upload', key: 1, img: {} as HalfImage });
  const removal = { identity: 'x' } as unknown as RemoveContext;
  r.handle({ type: 'render', id: 1, key: 1, recipe: recipe('a'), w: 4, h: 2, seed: 0, removal });
  r.handle({ type: 'render', id: 2, key: 1, recipe: recipe('b'), w: 4, h: 2, seed: 0, removal: null });
  await flush();
  // The second waits for the first's readback; the context was put back after the first draw.
  expect(log.calls).toEqual(['draw a with {"identity":"x"}']);
  log.reads.shift()!(new Uint8Array(32));
  await flush();
  expect(log.calls).toEqual(['draw a with {"identity":"x"}', 'draw b with null']);
  expect(replies.shift()).toMatchObject({ type: 'reply', id: 1, ok: true });
  log.reads.shift()!(new Uint8Array(32));
  await flush();
  expect(replies.shift()).toMatchObject({ type: 'reply', id: 2, ok: true });
});

it('fails a render whose source was released before its turn', async () => {
  const r = new StillRenderer({} as OffscreenCanvas, (m) => replies.push(m));
  replies.length = 0;
  r.handle({ type: 'upload', key: 1, img: {} as HalfImage });
  r.handle({ type: 'render', id: 3, key: 1, recipe: null, w: 4, h: 2, seed: 0, removal: null });
  r.handle({ type: 'release', key: 1 });
  await flush();
  expect(replies).toEqual([{ type: 'reply', id: 3, ok: false, error: 'Error: source released' }]);
});

it('prepares a Remove input in the queue, with the context set for each pass, and can be canceled', async () => {
  const contexts: unknown[] = [];
  const r = new StillRenderer({} as OffscreenCanvas, (m) => replies.push(m));
  replies.length = 0;
  const eng = r.engine as unknown as { removeContext: unknown; prepareRemove: () => Generator<void, unknown> };
  const image = new Uint8Array(4), mask = new Uint8Array(1);
  eng.prepareRemove = function* () { contexts.push(eng.removeContext); yield; contexts.push(eng.removeContext); return { image, mask }; };
  r.handle({ type: 'upload', key: 1, img: {} as HalfImage });
  const context = { identity: 'ctx' } as unknown as RemoveContext;
  const request = { key: 'k', spot: 's' } as never;
  r.handle({ type: 'removeInput', id: 4, key: 1, recipe: recipe('a'), request, context });
  await flush(); await flush();
  expect(contexts).toEqual([context, context]);
  expect(eng.removeContext).toBe(null);
  expect(replies.shift()).toEqual({ type: 'reply', id: 4, ok: true, value: { image, mask } });

  r.handle({ type: 'removeInput', id: 5, key: 1, recipe: recipe('a'), request, context });
  r.handle({ type: 'cancel', id: 5 });
  await flush(); await flush();
  expect(contexts).toHaveLength(3);
  expect(replies.shift()).toEqual({ type: 'reply', id: 5, ok: true, value: null });
});
