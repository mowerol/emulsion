// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseTestSource, photoFolders, pickTestPhotos, testSourceKey } from './testphotos';
import type { Photo } from './store';

const photo = (name: string, camera: string | null, day: number, extra: Partial<Photo> = {}): Photo => ({
  path: `/Photos/${extra.path ?? 'Trip'}/${name}`, rel: name, name, size: 1, modified: 0, recipe: null, seed: 0, white: null,
  rating: 0, label: null, flag: null, raw: true, pair: null,
  capture: { camera, date: `2026:10:${String(day).padStart(2, '0')} 12:00:00` }, ...extra,
  ...(extra.path ? { path: extra.path } : {}),
});
const names = (ps: Photo[]) => ps.map(p => p.name);

describe('test photo picks', () => {
  const fuji = Array.from({ length: 9 }, (_, i) => photo(`F${i}`, 'X-T5', i + 1));
  const om = [photo('O1', 'OM-3', 3), photo('O2', 'OM-3', 4), photo('O3', 'OM-3', 5)];
  const phone = [photo('P1', 'iPhone', 6)];

  it('puts other cameras first, the middle of each camera’s shots', () => {
    const picks = pickTestPhotos([...fuji, ...om, ...phone], fuji[0], []);
    expect(names(picks).slice(0, 2)).toEqual(['O2', 'P1']);
    expect(picks).toHaveLength(5);
    expect(names(picks)).not.toContain('F0');
  });

  it('spreads the rest over the shoot', () => {
    const picks = pickTestPhotos(fuji, fuji[0], [], 4);
    // Eight Fuji frames left (F1..F8): one from each quarter.
    expect(names(picks)).toEqual(['F2', 'F4', 'F6', 'F8']);
  });

  it('keeps pins first and never repeats a photo or picks a virtual copy', () => {
    const copy = { ...fuji[3], copyId: 'c1' };
    const picks = pickTestPhotos([...fuji, copy, ...om], fuji[0], [om[2], fuji[5]]);
    expect(names(picks).slice(0, 2)).toEqual(['O3', 'F5']);
    expect(new Set(picks.map(p => p.path + (p.copyId ?? ''))).size).toBe(picks.length);
    expect(picks.some(p => p.copyId)).toBe(false);
  });

  it('copes with a folder of one photo and with unread metadata', () => {
    expect(pickTestPhotos([fuji[0]], fuji[0], [])).toEqual([]);
    const unread = [photo('U1', null, 1, { capture: undefined, modified: 2 }), photo('U2', null, 1, { capture: undefined, modified: 1 })];
    expect(names(pickTestPhotos(unread, null, [], 2))).toEqual(['U2', 'U1']);
  });
});

describe('test photo sources', () => {
  it('round-trips its menu keys', () => {
    for (const s of [{ type: 'open' }, { type: 'folder', path: '/a/b:c' }, { type: 'collection', id: 'x' }] as const)
      expect(parseTestSource(testSourceKey(s))).toEqual(s);
  });

  it('lists folders that hold photos, counting originals', () => {
    const ps = [photo('a', null, 1, { path: '/P/2026/a.orf' }), photo('b', null, 1, { path: '/P/2026/b.orf' }),
      photo('b', null, 1, { path: '/P/2026/b.orf', copyId: 'c' }), photo('c', null, 1, { path: '/P/2025/Japan/c.orf' })];
    expect(photoFolders(ps)).toEqual([{ path: '/P/2025/Japan', name: 'Japan', count: 1 }, { path: '/P/2026', name: '2026', count: 2 }]);
  });
});
