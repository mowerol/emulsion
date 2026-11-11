// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { NO_META, addKeywords, hasKeyword, isEmptyMeta, keywordIndex, normalizeMeta, parseKeywords, removeKeyword, sharedMeta } from './meta';

describe('photo metadata', () => {
  it('reads what a sidecar holds and drops anything unexpected', () => {
    expect(normalizeMeta(null)).toBe(NO_META);
    expect(normalizeMeta({ keywords: [' Beach ', 'beach', '', 3, 'Sea'], title: '  Low tide ', city: 7, caption: ' line one\nline two ' }))
      .toEqual({ ...NO_META, keywords: ['Beach', 'Sea'], title: 'Low tide', caption: 'line one\nline two' });
    expect(isEmptyMeta(normalizeMeta({ keywords: [], title: ' ' }))).toBe(true);
  });

  it('adds typed keywords like Lightroom, separated by commas, without repeats', () => {
    expect(parseKeywords('Beach, Family ,, beach')).toEqual(['Beach', 'Family']);
    const m = addKeywords({ ...NO_META, keywords: ['Family'] }, ['family', 'Kent']);
    expect(m.keywords).toEqual(['Family', 'Kent']);
    expect(removeKeyword(m, 'KENT').keywords).toEqual(['Family']);
    expect(hasKeyword(m, ' kent ')).toBe(true);
  });

  it('shows what a selection shares and which keywords only some have', () => {
    const a = { ...NO_META, keywords: ['Sea', 'Kent'], title: 'Harbour', city: 'Margate' };
    const b = { ...NO_META, keywords: ['sea'], title: 'Harbour', city: 'Deal' };
    const s = sharedMeta([a, b, undefined]);
    expect(s.total).toBe(3);
    expect(s.fields.title).toBeNull();
    expect(sharedMeta([a, b]).fields.title).toBe('Harbour');
    expect(sharedMeta([a, b]).fields.city).toBeNull();
    expect(s.keywords).toEqual([{ keyword: 'Sea', count: 2 }, { keyword: 'Kent', count: 1 }]);
    expect(keywordIndex([a, b, { ...NO_META, keywords: ['Kent'] }])).toEqual(['Kent', 'Sea']);
  });
});
