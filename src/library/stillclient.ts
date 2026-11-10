// SPDX-License-Identifier: GPL-3.0-or-later
// The page's handle on the still renders' engine (engine/stills.ts): developed thumbnails, look
// tiles, photo match and perspective analysis. It runs in a worker, started on first use, so
// none of its GPU work holds up the page; export still uses offscreenEngine() (library/thumbs.ts).
import { loadLut } from '../engine/lutstore';
import { recipeLookFile } from '../film/looks';
import { AssetSync } from '../engine/assetsync';
import { StillRenderer, type FromStills, type ToStills } from '../engine/stills';
import { engineMode } from '../ui/developclient';
import type { SourceRef } from '../engine/developloop';
import { logToTerminal } from '../backend/api';
import { InputMode } from '../engine/params';
import type { HalfImage } from '../engine/engine';
import type { RemoveContext } from '../engine/removequeue';
import type { Recipe } from '../film/recipe';
import type { Xy } from '../engine/whitebalance';

export type StillSource = SourceRef;

export class StillClient {
  private worker: Worker | null = null;
  private local: StillRenderer | null = null;
  private keys = 0;
  private ids = 0;
  private requests = new Map<number, { resolve: (v: Uint8Array | Blob) => void; reject: (e: Error) => void }>();
  private assets = new AssetSync();

  constructor() {
    if (engineMode() === 'worker') {
      this.worker = new Worker(new URL('../engine/stills.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<FromStills>) => this.receive(e.data);
      this.worker.onerror = (e) => logToTerminal('error', `The preview engine stopped. ${e.message}`);
    } else {
      // No OffscreenCanvas WebGL2: the same renderer on this thread, as before the worker.
      this.local = new StillRenderer(document.createElement('canvas'), (m) => this.receive(m));
    }
  }

  private send(m: ToStills, transfer: Transferable[] = []) {
    if (this.local) this.local.handle(m);
    else this.worker?.postMessage(m, transfer);
  }

  private receive(m: FromStills) {
    if (m.type === 'error') { logToTerminal('error', m.message); return; }
    if (m.type !== 'reply') return;
    const r = this.requests.get(m.id);
    this.requests.delete(m.id);
    if (!r) return;
    if (m.ok) r.resolve(m.value); else r.reject(new Error(m.error));
  }

  /** Upload decoded pixels (copied to the worker; the decode cache keeps its own). */
  upload(img: HalfImage, origin?: string): StillSource {
    const key = ++this.keys;
    this.send({ type: 'upload', key, img, origin });
    return { key, w: img.width, h: img.height, fullW: img.fullWidth, fullH: img.fullHeight, mode: img.mode, white: img.white,
      camera: img.camera, lens: img.lens, denoised: !!img.denoised, origin };
  }

  /** A camera JPEG (a file the decoder can't read is edited through its embedded preview). */
  async uploadBlob(blob: Blob, white: Xy | null, origin?: string): Promise<StillSource> {
    const bitmap = await createImageBitmap(blob);
    const key = ++this.keys;
    const ref: StillSource = { key, w: bitmap.width, h: bitmap.height, fullW: bitmap.width, fullH: bitmap.height, mode: InputMode.DisplayEncoded, white, denoised: false, origin };
    this.send({ type: 'uploadBitmap', key, bitmap, white, origin }, [bitmap]);
    return ref;
  }

  release(src: StillSource | null | undefined) {
    if (src) this.send({ type: 'release', key: src.key });
  }

  attachCapture(src: StillSource, radius: number, toCam: number[], mask: Uint8Array) {
    src.capture = true;
    this.send({ type: 'capture', key: src.key, radius, toCam, mask });
  }

  /** The photo developed at w × h, as RGBA pixels. */
  pixels(src: StillSource, recipe: Recipe | null, w: number, h: number, seed: number, removal: RemoveContext | null = null) {
    return this.render(src, recipe, w, h, seed, removal) as Promise<Uint8Array>;
  }

  /** The photo developed at w × h and encoded as a JPEG (in the worker). */
  jpeg(src: StillSource, recipe: Recipe | null, w: number, h: number, seed: number, quality: number, removal: RemoveContext | null = null) {
    return this.render(src, recipe, w, h, seed, removal, quality) as Promise<Blob>;
  }

  private async render(src: StillSource, recipe: Recipe | null, w: number, h: number, seed: number, removal: RemoveContext | null, jpeg?: number) {
    // The look's LUT loads here (the worker's store only mirrors this one), then goes across.
    const file = recipeLookFile(recipe);
    if (file) await loadLut(file);
    if (this.worker) {
      const assets = this.assets.take();
      if (assets) this.send({ type: 'assets', ...assets });
    }
    const id = ++this.ids;
    return new Promise<Uint8Array | Blob>((resolve, reject) => {
      this.requests.set(id, { resolve, reject });
      this.send({ type: 'render', id, key: src.key, recipe, w, h, seed, removal, jpeg });
    });
  }
}

let client: StillClient | null | undefined;
/** The shared still-render engine, started on first use; null without a GPU. */
export function stillEngine(): StillClient | null {
  if (client === undefined) {
    try { client = new StillClient(); } catch (err) {
      console.error(err);
      client = null;
    }
  }
  return client;
}
