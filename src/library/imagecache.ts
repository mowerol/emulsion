// SPDX-License-Identifier: GPL-3.0-or-later

type Loader<T> = (path: string, maxEdge: number) => Promise<T>;

interface Entry<T> {
  value: T;
  bytes: number;
}

/** Session cache for decoded image payloads, with duplicate-load suppression. */
export class ImageLoadCache<T> {
  private entries = new Map<string, Entry<T>>();
  private inflight = new Map<string, Promise<T>>();
  private bytes = 0;
  private generation = 0;
  private preparing: Promise<T> | null = null;
  private nextPreparation: (() => void) | null = null;
  private cancelPreparation: (() => void) | null = null;

  constructor(private readonly maxBytes: number, private readonly sizeOf: (value: T) => number) {}

  get(path: string, maxEdge: number, load: Loader<T>): Promise<T> {
    const key = `${path}\0${maxEdge}`;
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return Promise.resolve(hit.value);
    }

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const generation = this.generation;
    const promise = load(path, maxEdge).then((value) => {
      if (generation !== this.generation) return value;
      this.inflight.delete(key);
      const bytes = this.sizeOf(value);
      if (bytes <= this.maxBytes) {
        const previous = this.entries.get(key);
        if (previous) this.bytes -= previous.bytes;
        this.entries.set(key, { value, bytes });
        this.bytes += bytes;
        this.trim();
      }
      return value;
    }, (error) => {
      if (generation === this.generation) this.inflight.delete(key);
      throw error;
    });
    this.inflight.set(key, promise);
    return promise;
  }

  /** Prepare the current photo after a pause. Only one background decode runs at
   * a time; navigating replaces the pending photo rather than building a queue.
   * A foreground get shares the decode and never waits for another photo's preparation.
   * Cancellation stops pending work; an already-running native decode must finish. */
  prepare(path: string, maxEdge: number, load: Loader<T>): () => void {
    this.cancelPreparation?.();
    const key = `${path}\0${maxEdge}`;
    if (this.entries.has(key) || this.inflight.has(key)) return () => {};
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      if (this.preparing) { this.nextPreparation = run; return; }
      const pending = Promise.resolve().then(() => this.get(path, maxEdge, load));
      this.preparing = pending;
      void pending.catch(() => {}).finally(() => {
        this.preparing = null;
        const next = this.nextPreparation;
        this.nextPreparation = null;
        next?.();
      });
    };
    const timer = setTimeout(run, 750);
    const cancel = () => {
      cancelled = true;
      clearTimeout(timer);
      if (this.nextPreparation === run) this.nextPreparation = null;
    };
    this.cancelPreparation = cancel;
    return cancel;
  }

  clear() {
    this.cancelPreparation?.();
    this.generation++;
    this.entries.clear();
    this.inflight.clear();
    this.bytes = 0;
  }

  private trim() {
    while (this.bytes > this.maxBytes) {
      const [key, entry] = this.entries.entries().next().value as [string, Entry<T>];
      this.entries.delete(key);
      this.bytes -= entry.bytes;
    }
  }
}
