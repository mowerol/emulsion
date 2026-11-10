// SPDX-License-Identifier: GPL-3.0-or-later
// Still renders: everything drawn apart from the develop view (developed thumbnails, the look
// tiles, photo match's target, perspective analysis). Their engine runs in its own worker
// (stills.worker.ts) so its context creation, shader compiles and draws never block the page:
// on the main thread a thumbnail's draw took 15-57 ms and the engine's creation 88 ms (2026-11-10,
// in WKWebView). Without OffscreenCanvas WebGL2 the same renderer runs on the main thread.
// The client is library/stillclient.ts.
import { Engine, type HalfImage } from './engine';
import type { Source } from './engine';
import type { RemoveContext } from './removequeue';
import { provideLut } from './lutstore';
import type { Assets } from './assetsync';
import { adoptUserLooks } from '../film/looks';
import type { Recipe } from '../film/recipe';
import type { Xy } from './whitebalance';

export type ToStills =
  | { type: 'upload'; key: number; img: HalfImage; origin?: string }
  | { type: 'uploadBitmap'; key: number; bitmap: ImageBitmap; white: Xy | null; origin?: string }
  | { type: 'release'; key: number }
  | { type: 'capture'; key: number; radius: number; toCam: number[]; mask: Uint8Array }
  | ({ type: 'assets' } & Assets)
  /** Develop `key` at w × h; `jpeg` (a quality, 0-1) encodes it, otherwise the RGBA pixels come back. */
  | { type: 'render'; id: number; key: number; recipe: Recipe | null; w: number; h: number; seed: number; removal: RemoveContext | null; jpeg?: number };

export type FromStills =
  | { type: 'ready'; maxTextureSize: number }
  | { type: 'error'; message: string }
  | { type: 'reply'; id: number; ok: true; value: Uint8Array | Blob }
  | { type: 'reply'; id: number; ok: false; error: string };

export class StillRenderer {
  readonly engine: Engine;
  private sources = new Map<number, Source>();
  /** Renders run one at a time: a removal context is the engine's while its draw is submitted. */
  private queue: Promise<void> = Promise.resolve();

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, private post: (m: FromStills, transfer?: Transferable[]) => void) {
    this.engine = new Engine(canvas);
    post({ type: 'ready', maxTextureSize: this.engine.maxTextureSize });
  }

  handle(m: ToStills) {
    switch (m.type) {
      case 'upload': this.sources.set(m.key, { ...this.engine.sourceFromHalf(m.img), origin: m.origin }); break;
      case 'uploadBitmap':
        try { this.sources.set(m.key, { ...this.engine.sourceFromImage(m.bitmap, m.bitmap.width, m.bitmap.height, m.white), origin: m.origin }); }
        finally { m.bitmap.close(); }
        break;
      case 'release': {
        const s = this.sources.get(m.key);
        this.sources.delete(m.key);
        if (s) this.engine.release(s);
        break;
      }
      case 'capture': {
        const s = this.sources.get(m.key);
        if (s) this.engine.attachCapture(s, m.radius, m.toCam, m.mask);
        break;
      }
      case 'assets':
        for (const [file, lut] of m.luts ?? []) provideLut(file, lut);
        if (m.looks) adoptUserLooks(m.looks);
        break;
      case 'render': this.queue = this.queue.then(() => this.render(m)); break;
    }
  }

  private async render(m: Extract<ToStills, { type: 'render' }>) {
    try {
      const src = this.sources.get(m.key);
      if (!src) throw new Error('source released');
      const eng = this.engine, previous = eng.removeContext;
      // The draw is submitted before the readback first yields, so the context is only needed
      // until then (and nothing else uses this engine meanwhile).
      let reading: Promise<Uint8Array<ArrayBuffer>>;
      eng.removeContext = m.removal;
      try { reading = eng.readPixelsAsync(src, m.recipe, m.w, m.h, m.seed); }
      finally { eng.removeContext = previous; }
      const px = await reading;
      if (m.jpeg === undefined) { this.post({ type: 'reply', id: m.id, ok: true, value: px }, [px.buffer]); return; }
      this.post({ type: 'reply', id: m.id, ok: true, value: await encodeJpeg(px, m.w, m.h, m.jpeg) });
    } catch (err) {
      this.post({ type: 'reply', id: m.id, ok: false, error: String(err) });
    }
  }
}

/** RGBA pixels as a JPEG, on an OffscreenCanvas where there is one (a worker has no document). */
async function encodeJpeg(px: Uint8Array<ArrayBuffer>, w: number, h: number, quality: number): Promise<Blob> {
  const image = new ImageData(new Uint8ClampedArray(px.buffer), w, h);
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.putImageData(image, 0, 0);
      return c.convertToBlob({ type: 'image/jpeg', quality });
    }
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.putImageData(image, 0, 0);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', quality));
  if (!blob) throw new Error('Could not encode the image');
  return blob;
}
