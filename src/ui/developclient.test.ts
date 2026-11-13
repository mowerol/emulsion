// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, expect, it, vi } from 'vitest';
import { DevelopClient } from './developclient';

vi.mock('../engine/developloop', () => ({ DevelopLoop: class {} }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('presents a worker bitmap and its dimensions in the same task, without an independently painted placeholder', () => {
  let receive: ((e: { data: unknown }) => void) | undefined;
  const sent: unknown[] = [];
  vi.stubGlobal('Worker', class {
    set onmessage(value: typeof receive) { receive = value; }
    postMessage(m: unknown) { sent.push(m); }
  });
  const canvas = document.createElement('canvas');
  const bitmap = { width: 776, height: 580, close: vi.fn() };
  const order: string[] = [];
  const transfer = vi.fn((b: typeof bitmap) => {
    canvas.width = b.width; canvas.height = b.height;
    order.push('pixels');
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) => kind === 'bitmaprenderer'
    ? { canvas, transferFromImageBitmap: transfer }
    : { MAX_TEXTURE_SIZE: 1, getParameter: () => 8192, getExtension: () => null }) as unknown as typeof canvas.getContext);
  const client = DevelopClient.start(canvas, {
    error: vi.fn(), warn: vi.fn(), histogram: vi.fn(),
    presented: (_photo, width, height) => {
      expect([canvas.width, canvas.height]).toEqual([width, height]);
      order.push('box');
    },
  }, 'worker');
  expect(sent[0]).toEqual({ type: 'init', stats: false });
  receive!({ data: { type: 'presented', photo: 'photo', width: 776, height: 580, bitmap } });
  expect(transfer).toHaveBeenCalledWith(bitmap);
  expect(order).toEqual(['pixels', 'box']);
  client.dispose();
  // A frame already in transit when the view closes must release its native image.
  receive!({ data: { type: 'presented', photo: 'photo', width: 776, height: 580, bitmap } });
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(transfer).toHaveBeenCalledOnce();
});
