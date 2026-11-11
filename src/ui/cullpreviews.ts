// SPDX-License-Identifier: GPL-3.0-or-later
import { cullPreview } from '../backend/api';
import type { Photo } from '../library/store';

export interface CullPreview {
  url: string;
  width: number;
  height: number;
  release: () => void;
}
export const previewKey = (p: Pick<Photo, 'path' | 'size' | 'modified'>) => JSON.stringify([p.path, p.size, p.modified]);
export type PreviewSource = Pick<Photo, 'path' | 'size' | 'modified'>;

async function loadPreview(source: PreviewSource): Promise<CullPreview> {
  const url = URL.createObjectURL(await cullPreview(source.path));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { url, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

/** One native read at a time. Navigation replaces the queue, with the active photo first.
 * At most three source previews and ~96 MiB of decoded pixels (plus one oversized active
 * preview) survive. Late reads are released on navigation or exit, never shown as a new photo.
 */
export class CullPreviews {
  private entries = new Map<string, CullPreview | Error>();
  private wanted: PreviewSource[] = [];
  private attempted = new Set<string>();
  private running: string | null = null;
  private disposed = false;

  constructor(private changed: () => void, private load = loadPreview, private budget = 96 * 1024 * 1024) {}

  get(source: PreviewSource): CullPreview | Error | undefined { return this.entries.get(previewKey(source)); }

  setWindow(sources: PreviewSource[]) {
    if (this.disposed) return;
    this.wanted = [...new Map(sources.slice(0, 3).map(p => [previewKey(p), p])).values()];
    const keys = new Set(this.wanted.map(previewKey));
    for (const [key, entry] of this.entries) if (!keys.has(key)) this.drop(key, entry);
    this.attempted = new Set(this.entries.keys());
    if (this.running) this.attempted.add(this.running);
    this.trim();
    void this.pump();
  }

  retry(source: PreviewSource) {
    const key = previewKey(source);
    const entry = this.entries.get(key);
    if (entry) this.drop(key, entry);
    this.attempted.delete(key);
    this.changed();
    void this.pump();
  }

  dispose() {
    this.disposed = true;
    for (const [key, entry] of this.entries) this.drop(key, entry);
  }

  private drop(key: string, entry: CullPreview | Error) {
    if (!(entry instanceof Error)) entry.release();
    this.entries.delete(key);
  }

  private trim() {
    let bytes = [...this.entries.values()].reduce((sum, e) => sum + (e instanceof Error ? 0 : e.width * e.height * 4), 0);
    for (const source of this.wanted.slice(1).reverse()) {
      if (bytes <= this.budget) break;
      const key = previewKey(source), entry = this.entries.get(key);
      if (entry && !(entry instanceof Error)) { bytes -= entry.width * entry.height * 4; this.drop(key, entry); }
    }
  }

  private async pump() {
    if (this.running || this.disposed) return;
    const source = this.wanted.find(p => !this.attempted.has(previewKey(p)));
    if (!source) return;
    const key = previewKey(source);
    this.running = key;
    this.attempted.add(key);
    let result: CullPreview | Error;
    try { result = await this.load(source); }
    catch (error) { result = error instanceof Error ? error : new Error(String(error)); }
    this.running = null;
    if (this.disposed || !this.wanted.some(p => previewKey(p) === key)) {
      if (!(result instanceof Error)) result.release();
    } else {
      this.entries.set(key, result);
      this.trim();
      this.changed();
    }
    void this.pump();
  }
}
