// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ render: vi.fn(), cached: vi.fn() }));
vi.mock('../backend/api', () => ({
  thumbnail: vi.fn(async () => new Blob(['original'])),
  loadImage: vi.fn(async () => ({ width: 600, height: 400, data: new Uint16Array(0) })), captureInfo: vi.fn(), logToTerminal: vi.fn(),
  removeCachedPatch: mocks.cached,
}));
vi.mock('../engine/engine', () => ({ InputMode: { SceneLinear: 2 }, Engine: class {} }));
// Thumbnails develop in the still-render worker; the removal context goes with each render.
vi.mock('./stillclient', () => ({ stillEngine: () => ({
  upload: () => ({ w: 600, h: 400, fullW: 6000, fullH: 4000, mode: 2, white: null }),
  async jpeg(...a: unknown[]) { mocks.render(a[6]); return new Blob(['developed']); },
  release() {},
}) }));
import { defaultRecipe } from '../film/recipe';
import { newCircleSpot } from '../film/retouch';
import { thumbs } from './thumbs';
const recipe = { ...defaultRecipe(), retouch: [newCircleSpot([.5, .5], 'remove', .03, .01)] };
let release!: (pixels: Uint8Array | null) => void;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cached.mockImplementation(() => new Promise(resolve => { release = resolve; }));
});
afterEach(() => { thumbs.clear(); });

it('does not show an original thumbnail while the saved removal is restoring', async () => {
  await thumbs.original('/saved.raf');
  expect(thumbs.url('/saved.raf', recipe)).toBeUndefined();
});

it('composites the saved removal before publishing the developed thumbnail', async () => {
  thumbs.want('/saved.raf', recipe, 1, null, true);
  await vi.waitFor(() => expect(mocks.cached).toHaveBeenCalled());
  expect(mocks.render).not.toHaveBeenCalled();
  release(new Uint8Array(512 * 512 * 4));
  await vi.waitFor(() => expect(mocks.render).toHaveBeenCalled());
  const context = mocks.render.mock.calls[0][0];
  expect(context.patches.has(recipe.retouch[0].id)).toBe(true);
});

it('updates an existing thumbnail when a new Remove completes', async () => {
  const pixels = new Uint8Array(512 * 512 * 4);
  mocks.cached.mockResolvedValue(pixels);
  thumbs.want('/saved.raf', recipe, 1, null, true);
  await vi.waitFor(() => expect(thumbs.url('/saved.raf', recipe)).toBeDefined());
  const oldUrl = thumbs.url('/saved.raf', recipe);
  const changed = { ...recipe, retouch: [newCircleSpot([.7, .5], 'remove', .03, .01)] };
  mocks.cached.mockResolvedValue(null);
  thumbs.want('/saved.raf', changed, 1, null, true);
  expect(thumbs.url('/saved.raf', changed)).toBeUndefined();
  await vi.waitFor(() => expect(mocks.cached).toHaveBeenCalledTimes(2));
  // The failed cache lookup must first have reached the waiting-for-patch path.
  await new Promise(r => setTimeout(r, 10));
  mocks.cached.mockResolvedValue(pixels);
  thumbs.removalsReady('/saved.raf');
  await vi.waitFor(() => expect(thumbs.url('/saved.raf', changed)).toBeDefined());
  expect(thumbs.url('/saved.raf', changed)).not.toBe(oldUrl);
  expect(mocks.render.mock.calls[mocks.render.mock.calls.length - 1][0].patches.has(changed.retouch[0].id)).toBe(true);
});

it('does not miss completion while a thumbnail cache miss is still in flight', async () => {
  thumbs.want('/saved.raf', recipe, 1, null, true);
  await vi.waitFor(() => expect(mocks.cached).toHaveBeenCalledOnce());
  mocks.cached.mockResolvedValue(new Uint8Array(512 * 512 * 4));
  thumbs.removalsReady('/saved.raf');
  release(null);
  await vi.waitFor(() => expect(thumbs.url('/saved.raf', recipe)).toBeDefined());
  expect(mocks.cached).toHaveBeenCalledTimes(2);
  expect(mocks.render).toHaveBeenCalledOnce();
});
