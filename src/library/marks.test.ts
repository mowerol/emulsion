// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { NO_MARKS, applyMark, describeMark, markForKey, normalizeMarks } from './marks';

describe('ratings and colour tags', () => {
  it("reads Lightroom's keys", () => {
    expect(markForKey('0')).toEqual({ rating: 0 });
    expect(markForKey('5')).toEqual({ rating: 5 });
    expect(markForKey('6')).toEqual({ label: 'red' });
    expect(markForKey('9')).toEqual({ label: 'blue' });
    expect(markForKey('h')).toEqual({ heart: true });
    expect(markForKey('a')).toBeNull();
    expect(markForKey('F5')).toBeNull();
  });

  it('sets stars and toggles a tag', () => {
    const three = applyMark(NO_MARKS, { rating: 3 });
    expect(three).toEqual({ rating: 3, label: null, heart: false });
    const red = applyMark(three, { label: 'red' });
    expect(red).toEqual({ rating: 3, label: 'red', heart: false });
    expect(applyMark(red, { label: 'red' })).toEqual({ rating: 3, label: null, heart: false });
    expect(applyMark(red, { label: 'blue' })).toEqual({ rating: 3, label: 'blue', heart: false });
    expect(applyMark(red, { rating: 0 })).toEqual({ rating: 0, label: 'red', heart: false });
  });

  it('toggles the heart without touching stars or tag', () => {
    const loved = applyMark({ rating: 2, label: 'blue', heart: false }, { heart: true });
    expect(loved).toEqual({ rating: 2, label: 'blue', heart: true });
    expect(applyMark(loved, { heart: true })).toEqual({ rating: 2, label: 'blue', heart: false });
    // A mixed selection gets the heart.
    expect(applyMark(loved, { heart: true }, false)).toEqual({ rating: 2, label: 'blue', heart: true });
  });

  it('gives a mixed selection the tag rather than taking it away', () => {
    const red = { rating: 0, label: 'red' as const, heart: false };
    expect(applyMark(red, { label: 'red' }, false)).toEqual(red);
    expect(applyMark(red, { label: 'red' }, true)).toEqual({ ...red, label: null });
  });

  it('drops anything unexpected from a sidecar', () => {
    expect(normalizeMarks(4, 'green', true)).toEqual({ rating: 4, label: 'green', heart: true });
    expect(normalizeMarks(9, 'purple', 'yes')).toEqual({ rating: 5, label: null, heart: false });
    expect(normalizeMarks(undefined, null, undefined)).toEqual(NO_MARKS);
  });

  it('names marks for undo', () => {
    expect(describeMark({ rating: 1 })).toBe('1 star');
    expect(describeMark({ rating: 4 })).toBe('4 stars');
    expect(describeMark({ rating: 0 })).toBe('Clear rating');
    expect(describeMark({ label: 'yellow' })).toBe('Yellow tag');
    expect(describeMark({ heart: true })).toBe('Heart');
  });
});
