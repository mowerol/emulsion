// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it, vi } from 'vitest';
import { CullPreviews, previewKey, type CullPreview, type PreviewSource } from './cullpreviews';

const source = (path: string): PreviewSource => ({ path, size: 100, modified: 1 });
const asset = (): CullPreview => ({ url: 'blob:preview', width: 100, height: 100, release: vi.fn() });
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function deferred() {
  let resolve!: (p: CullPreview) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<CullPreview>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

it('loads the active preview first, shares copies, and does only one native read at a time', async () => {
  const pending = deferred();
  const load = vi.fn().mockReturnValueOnce(pending.promise).mockImplementation(async () => asset());
  const cache = new CullPreviews(vi.fn(), load);
  const a = source('a'), b = source('b');
  cache.setWindow([a, a, b]);
  expect(load.mock.calls.map(c => c[0].path)).toEqual(['a']);
  pending.resolve(asset()); await settle();
  expect(load.mock.calls.map(c => c[0].path)).toEqual(['a', 'b']);
  cache.setWindow([b, a]); await settle();
  expect(load).toHaveBeenCalledTimes(2);
  cache.dispose();
});

it('drops obsolete queued work and releases a late read after rapid navigation', async () => {
  const pending = deferred(), late = asset();
  const load = vi.fn().mockReturnValueOnce(pending.promise).mockImplementation(async () => asset());
  const cache = new CullPreviews(vi.fn(), load);
  cache.setWindow([source('a'), source('b'), source('c')]);
  cache.setWindow([source('d'), source('e')]);
  pending.resolve(late); await settle();
  expect(load.mock.calls.map(c => c[0].path)).toEqual(['a', 'd', 'e']);
  expect(late.release).toHaveBeenCalledOnce();
  expect(cache.get(source('a'))).toBeUndefined();
  cache.dispose();
});

it('invalidates a changed source and releases all previews, including a pending one, on exit', async () => {
  const first = asset(), late = asset(), pending = deferred();
  const load = vi.fn().mockResolvedValueOnce(first).mockReturnValueOnce(pending.promise);
  const cache = new CullPreviews(vi.fn(), load);
  const original = source('a'), changed = { ...original, modified: 2 };
  expect(previewKey(original)).not.toBe(previewKey(changed));
  cache.setWindow([original]); await settle();
  cache.setWindow([changed]);
  expect(first.release).toHaveBeenCalledOnce();
  cache.dispose(); pending.resolve(late); await settle();
  expect(late.release).toHaveBeenCalledOnce();
  expect(load).toHaveBeenCalledTimes(2);
});

it('bounds cached pixels without dropping the active preview, then reloads an evicted neighbour when active', async () => {
  const assets: CullPreview[] = [];
  const load = vi.fn(async () => { const p = asset(); assets.push(p); return p; });
  const cache = new CullPreviews(vi.fn(), load, 40000);
  const a = source('a'), b = source('b'), c = source('c');
  cache.setWindow([a, b, c]); await settle();
  expect(cache.get(a)).toBe(assets[0]);
  expect(cache.get(b)).toBeUndefined();
  expect(cache.get(c)).toBeUndefined();
  cache.setWindow([b, c, a]); await settle();
  expect(cache.get(b)).toBeDefined();
  expect(cache.get(a)).toBeUndefined();
  cache.dispose();
  expect(assets.every(p => vi.mocked(p.release).mock.calls.length === 1)).toBe(true);
});

it('keeps errors recoverable and retries without trapping the navigation queue', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('No camera JPEG')).mockImplementation(async () => asset());
  const cache = new CullPreviews(vi.fn(), load);
  const a = source('a'), b = source('b');
  cache.setWindow([a, b]); await settle();
  expect(cache.get(a)).toBeInstanceOf(Error);
  expect(cache.get(b)).toBeDefined();
  cache.retry(a); await settle();
  expect(cache.get(a)).not.toBeInstanceOf(Error);
  expect(load).toHaveBeenCalledTimes(3);
  cache.dispose();
});
