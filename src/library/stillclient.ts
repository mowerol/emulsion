// SPDX-License-Identifier: GPL-3.0-or-later
// The page's handle on the still renders' engine (engine/stills.ts): developed thumbnails, look
// tiles, photo match, perspective analysis and export (with its Remove crops). It runs in a
// worker, started on first use, so none of its GPU work holds up the page.
import { loadLut } from '../engine/lutstore';
import { recipeLookFile } from '../film/looks';
import { AssetSync } from '../engine/assetsync';
import { StillRenderer, type FromStills, type RemoveInput, type ToStills } from '../engine/stills';
import { engineMode } from '../ui/developclient';
import type { SourceRef } from '../engine/developloop';
import { logToTerminal } from '../backend/api';
import { InputMode } from '../engine/params';
import type { HalfImage } from '../engine/engine';
import type { RemoveContext } from '../engine/removequeue';
import type { PatchRequest } from '../engine/remove';
import type { Recipe } from '../film/recipe';
import type { Xy } from '../engine/whitebalance';

export type StillSource = SourceRef;

export class StillClient {
  private worker: Worker | null = null;
  private local: StillRenderer | null = null;
  private keys = 0;
  private ids = 0;
  private requests = new Map<number, { resolve: (v: Uint8Array | Blob | RemoveInput | null) => void; reject: (e: Error) => void }>();
  private assets = new AssetSync();
  private started!: { resolve: (max: number) => void; reject: (e: Error) => void };
  /** The engine's largest texture edge, once it has started; rejects when it could not. */
  readonly ready = new Promise<number>((resolve, reject) => { this.started = { resolve, reject }; });

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
    if (m.type === 'ready') { this.started.resolve(m.maxTextureSize); return; }
    if (m.type === 'error') { logToTerminal('error', m.message); this.started.reject(new Error(m.message)); return; }
    if (m.type !== 'reply') return;
    const r = this.requests.get(m.id);
    this.requests.delete(m.id);
    if (!r) return;
    if (m.ok) r.resolve(m.value); else r.reject(new Error(m.error));
  }

  /** Upload decoded pixels: copied to the worker (the decode cache keeps its own), or with
   * `transfer` moved there, leaving `img`'s pixel arrays empty. */
  upload(img: HalfImage, origin?: string, transfer = false): StillSource {
    const key = ++this.keys;
    this.send({ type: 'upload', key, img, origin }, transfer ? [img.data.buffer, ...(img.denoised ? [img.denoised.buffer] : [])] : []);
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

  /** One Remove spot's model input, prepared in the worker; null when `canceled` stopped it. */
  removeInput(src: StillSource, recipe: Recipe, request: PatchRequest, context: RemoveContext, canceled: () => boolean): Promise<RemoveInput | null> {
    const id = ++this.ids;
    const watch = setInterval(() => { if (canceled()) { clearInterval(watch); this.send({ type: 'cancel', id }); } }, 50);
    return new Promise<RemoveInput | null>((resolve, reject) => {
      this.requests.set(id, { resolve: v => resolve(v as RemoveInput | null), reject });
      this.send({ type: 'removeInput', id, key: src.key, recipe, request, context });
    }).finally(() => clearInterval(watch));
  }

  /** Free the engine's intermediate buffers for one source size (after a large export). */
  dropBuffers(w: number, h: number) {
    this.send({ type: 'drop', w, h });
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
      this.requests.set(id, { resolve: v => resolve(v as Uint8Array | Blob), reject });
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
