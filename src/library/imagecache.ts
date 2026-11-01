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

    const promise = load(path, maxEdge).then((value) => {
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
      this.inflight.delete(key);
      throw error;
    });
    this.inflight.set(key, promise);
    return promise;
  }

  clear() {
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
