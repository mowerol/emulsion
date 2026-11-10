// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('../backend/api', () => ({
  thumbnail: vi.fn(async () => new Blob(['original'])),
  captureInfo: vi.fn(), loadImage: vi.fn(), logToTerminal: vi.fn(),
}));
vi.mock('../engine/engine', () => ({
  InputMode: { SceneLinear: 2 },
  Engine: class {
    sourceFromImage() { return {}; }
    async prepare() {}
    async renderToCanvasAsync(_src: unknown, recipe: unknown, canvas: { recipe?: unknown }) { canvas.recipe = recipe; calls.render(recipe); }
    release() {}
  },
}));
import { defaultRecipe } from '../film/recipe';
import { thumbnail } from '../backend/api';
import { thumbs } from './thumbs';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('createImageBitmap', async () => ({ width: 20, height: 10, close() {} }));
  vi.stubGlobal('document', { createElement: () => ({ recipe: null,
    toBlob(cb: (b: Blob) => void) { cb(new Blob([JSON.stringify(this.recipe)])); } }) });
});
afterEach(() => { thumbs.clear(); vi.unstubAllGlobals(); });

it('shows two developed thumbnails for one source and redevelops only the edited version', async () => {
  const first = { ...defaultRecipe(), exposure: 1 };
  const second = { ...defaultRecipe(), exposure: -1 };
  thumbs.want('/a.jpg', first, 1, null, false, '/a.jpg');
  thumbs.want('/a.jpg', second, 1, null, false, '/a.jpg\0copy');
  await vi.waitFor(() => expect(calls.render).toHaveBeenCalledTimes(2));
  const originalUrl = thumbs.url('/a.jpg', first)!;
  const copyUrl = thumbs.url('/a.jpg', second, '/a.jpg\0copy')!;
  expect(originalUrl).not.toBe(copyUrl);
  expect(await (await fetch(originalUrl)).json()).toMatchObject({ exposure: 1 });
  expect(await (await fetch(copyUrl)).json()).toMatchObject({ exposure: -1 });
  expect(thumbnail).toHaveBeenCalledTimes(1);
  thumbs.want('/a.jpg', { ...first, exposure: 2 }, 1, null, false, '/a.jpg');
  await vi.waitFor(() => expect(calls.render).toHaveBeenCalledTimes(3));
  expect(thumbs.url('/a.jpg', second, '/a.jpg\0copy')).toBe(copyUrl);
});

it("waits for a photo's first edits to pause before developing its thumbnail", async () => {
  // Shown unedited, then dragged: developing at the first step would compete with the drag.
  thumbs.want('/b.jpg', null, 1, null, false, '/b.jpg');
  thumbs.want('/b.jpg', { ...defaultRecipe(), exposure: .1 }, 1, null, false, '/b.jpg');
  thumbs.want('/b.jpg', { ...defaultRecipe(), exposure: .2 }, 1, null, false, '/b.jpg');
  await new Promise(r => setTimeout(r, 150));
  expect(calls.render).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(calls.render).toHaveBeenCalledTimes(1));
  expect(calls.render).toHaveBeenCalledWith(expect.objectContaining({ exposure: .2 }));
});
