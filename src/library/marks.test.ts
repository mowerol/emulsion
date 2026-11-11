// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { NO_MARKS, applyMark, describeMark, markForKey, normalizeMarks } from './marks';

describe('ratings, colour tags and flags', () => {
  it("reads Lightroom's keys", () => {
    expect(markForKey('0')).toEqual({ rating: 0 });
    expect(markForKey('5')).toEqual({ rating: 5 });
    expect(markForKey('6')).toEqual({ label: 'red' });
    expect(markForKey('9')).toEqual({ label: 'blue' });
    expect(markForKey('p')).toEqual({ flag: 'pick' });
    expect(markForKey('P')).toEqual({ flag: 'pick' });
    expect(markForKey('x')).toEqual({ flag: 'reject' });
    expect(markForKey('u')).toEqual({ flag: null });
    expect(markForKey('h')).toBeNull();
    expect(markForKey('a')).toBeNull();
    expect(markForKey('F5')).toBeNull();
  });

  it('sets stars and toggles a tag', () => {
    const three = applyMark(NO_MARKS, { rating: 3 });
    expect(three).toEqual({ rating: 3, label: null, flag: null });
    const red = applyMark(three, { label: 'red' });
    expect(red).toEqual({ rating: 3, label: 'red', flag: null });
    expect(applyMark(red, { label: 'red' })).toEqual({ rating: 3, label: null, flag: null });
    expect(applyMark(red, { label: 'blue' })).toEqual({ rating: 3, label: 'blue', flag: null });
    expect(applyMark(red, { rating: 0 })).toEqual({ rating: 0, label: 'red', flag: null });
  });

  it('sets a flag without touching stars or tag, and never toggles it', () => {
    const picked = applyMark({ rating: 2, label: 'blue', flag: null }, { flag: 'pick' });
    expect(picked).toEqual({ rating: 2, label: 'blue', flag: 'pick' });
    expect(applyMark(picked, { flag: 'pick' })).toEqual(picked);
    const rejected = applyMark(picked, { flag: 'reject' });
    expect(rejected).toEqual({ rating: 2, label: 'blue', flag: 'reject' });
    expect(applyMark(rejected, { flag: null })).toEqual({ rating: 2, label: 'blue', flag: null });
  });

  it('gives a mixed selection the tag rather than taking it away', () => {
    const red = { rating: 0, label: 'red' as const, flag: null };
    expect(applyMark(red, { label: 'red' }, false)).toEqual(red);
    expect(applyMark(red, { label: 'red' }, true)).toEqual({ ...red, label: null });
  });

  it('drops anything unexpected from a sidecar, and reads an old heart as a pick', () => {
    expect(normalizeMarks(4, 'green', 'reject')).toEqual({ rating: 4, label: 'green', flag: 'reject' });
    expect(normalizeMarks(9, 'purple', 'yes')).toEqual({ rating: 5, label: null, flag: null });
    expect(normalizeMarks(undefined, null, undefined)).toEqual(NO_MARKS);
    expect(normalizeMarks(3, null, undefined, true)).toEqual({ rating: 3, label: null, flag: 'pick' });
    expect(normalizeMarks(3, null, 'reject', true)).toEqual({ rating: 3, label: null, flag: 'reject' });
  });

  it('names marks for undo', () => {
    expect(describeMark({ rating: 1 })).toBe('1 star');
    expect(describeMark({ rating: 4 })).toBe('4 stars');
    expect(describeMark({ rating: 0 })).toBe('Clear rating');
    expect(describeMark({ label: 'yellow' })).toBe('Yellow tag');
    expect(describeMark({ flag: 'pick' })).toBe('Pick');
    expect(describeMark({ flag: 'reject' })).toBe('Reject');
    expect(describeMark({ flag: null })).toBe('Clear flag');
  });
});
