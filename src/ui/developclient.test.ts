// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, expect, it, vi } from 'vitest';
import { DevelopClient } from './developclient';
import type { ToLoop } from '../engine/developloop';

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

it('transfers large paired images in bounded turns while preserving shared cached pixels and cancellation', () => {
  const turns: (() => void)[] = [];
  vi.stubGlobal('MessageChannel', class {
    port1 = { onmessage: null as (() => void) | null, close() {} };
    port2 = { postMessage: () => turns.push(() => this.port1.onmessage?.()), close() {} };
  });
  const sent: (ToLoop | { type: 'init'; stats: boolean })[] = [];
  vi.stubGlobal('Worker', class {
    postMessage(message: ToLoop | { type: 'init'; stats: boolean }, transfer: Transferable[] = []) { sent.push(structuredClone(message, { transfer })); }
  });
  const canvas = document.createElement('canvas');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) => kind === 'bitmaprenderer'
    ? { canvas, transferFromImageBitmap() {} }
    : { MAX_TEXTURE_SIZE: 1, getParameter: () => 8192, getExtension: () => null }) as unknown as typeof canvas.getContext);
  const client = DevelopClient.start(canvas, { error: vi.fn(), warn: vi.fn(), histogram: vi.fn() }, 'worker');
  const data = new Uint16Array(32 * 2 ** 20), denoised = new Uint16Array(data.length);
  data[0] = 42; data[data.length - 1] = 65535;
  denoised[0] = 1234; denoised[denoised.length - 1] = 17;
  const img = { data, denoised, width: 8192, height: 1024, fullWidth: 8192, fullHeight: 1024, mode: 2, white: null };
  const source = client.upload(img, '/large.raf');
  expect(sent.filter(m => m.type === 'uploadPart')).toHaveLength(0);
  let count = 0;
  while (turns.length && count++ < 100) turns.shift()!();
  const parts = sent.filter(m => m.type === 'uploadPart');
  expect(parts).toHaveLength(16);
  expect(parts.every(part => part.data.byteLength <= 8 * 2 ** 20)).toBe(true);
  for (const plane of ['data', 'denoised'] as const) {
    const received = new Uint16Array(data.length);
    for (const part of parts.filter(m => m.plane === plane)) received.set(part.data, part.offset);
    // Compare bytes without printing tens of millions of samples on failure.
    expect(received.every((value, i) => value === img[plane][i])).toBe(true);
  }
  expect(sent[sent.length - 1]).toEqual({ type: 'uploadEnd', key: source.key });
  expect([data.byteLength, denoised.byteLength]).toEqual([64 * 2 ** 20, 64 * 2 ** 20]);
  const cancelled = client.upload(img);
  turns.shift()!();
  client.release(cancelled);
  const before = sent.length;
  while (turns.length) turns.shift()!();
  expect(sent).toHaveLength(before);
  const closed = client.upload(img);
  client.dispose();
  while (turns.length) turns.shift()!();
  expect(sent.some(m => m.type === 'uploadEnd' && m.key === closed.key)).toBe(false);
});
