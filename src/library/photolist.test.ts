// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it, vi } from 'vitest';
import { changedPlaces, overPhotos } from './photolist';
import type { Photo } from './store';

const photo = (i: number, rating = 0) => ({ path: `/p/${i}.jpg`, rating }) as unknown as Photo;
const list = (n: number) => Array.from({ length: n }, (_, i) => photo(i));

it('finds the few places an edit changed, and gives up past the limit or on another length', () => {
  const before = list(100), now = before.slice();
  expect(changedPlaces(before, now)).toEqual([]);
  now[7] = photo(7, 3); now[40] = photo(40, 1);
  expect(changedPlaces(before, now)).toEqual([7, 40]);
  expect(changedPlaces(before, now, 1)).toBeNull();
  expect(changedPlaces(before, list(99))).toBeNull();
});

it('keeps an answer across edits that change nothing it reads, and works it out again otherwise', () => {
  const compute = vi.fn((photos: Photo[]) => photos.filter(p => p.rating >= 3).length);
  const rated = overPhotos(compute, (a, b) => a.rating === b.rating);
  const first = list(22000);
  expect(rated(first)).toBe(0);
  // A slider drag: a new list with one new object for the edited photo, same rating.
  let now = first;
  for (let frame = 0; frame < 60; frame++) { now = now.slice(); now[5] = { ...now[5], recipe: { exposure: frame } } as unknown as Photo; expect(rated(now)).toBe(0); }
  expect(compute).toHaveBeenCalledTimes(1);
  const starred = now.slice(); starred[5] = { ...starred[5], rating: 4 };
  expect(rated(starred)).toBe(1);
  expect(rated(starred.slice(0, 10))).toBe(1);
  expect(compute).toHaveBeenCalledTimes(3);
});
