// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, expect, it, vi } from 'vitest';
import { rectFromTuple, type CameraFrame } from '../film/crop';
const api = vi.hoisted(() => ({ thumbnail: vi.fn(async () => new Blob(['preview'])), loadImage: vi.fn(), render: vi.fn(), uploadBlob: vi.fn() }));
vi.mock('../backend/api', async original => ({ ...await original<typeof import('../backend/api')>(), thumbnail: api.thumbnail, loadImage: api.loadImage }));
vi.mock('./stillclient', () => ({ stillEngine: () => ({
  async uploadBlob(_blob: Blob, _white: unknown, _origin: unknown, framing: CameraFrame) {
    api.uploadBlob(framing);
    return { w: 400, h: 300, frame: rectFromTuple(framing.rect) };
  },
  async jpeg(_src: unknown, _recipe: unknown, w: number, h: number) { api.render(w, h); return new Blob(['cropped']); },
  release() {},
}) }));
import { thumbKey, thumbs } from './thumbs';
const full: CameraFrame = { rect: [0, 0, 1, 1], width: 11648, height: 8736, aspect: '4:3', tele: null };
const pano: CameraFrame = { ...full, rect: [0, 2216 / 8736, 1, 4304 / 8736], aspect: '65:24' };
afterEach(() => { thumbs.clear(); vi.clearAllMocks(); });

it('renders an unedited panorama from its preview and keeps ordinary 4:3 on the fast path', async () => {
  thumbs.want('/normal.raf', null, 1, null, true, '/normal.raf', 'v1', full);
  await vi.waitFor(() => expect(thumbs.url('/normal.raf', null, '/normal.raf', null, 'v1', full)).toBeTruthy());
  expect(api.render).not.toHaveBeenCalled();
  thumbs.want('/panorama.raf', null, 1, null, true, '/panorama.raf', 'v1', pano);
  await vi.waitFor(() => expect(api.render).toHaveBeenCalled());
  expect(api.render).toHaveBeenCalledWith(384, 142);
  expect(api.loadImage).not.toHaveBeenCalled();
  expect(api.uploadBlob).toHaveBeenCalledWith(pano);
  expect(thumbKey(null, null, 'v1', full)).not.toBe(thumbKey(null, null, 'v1', pano));
});
