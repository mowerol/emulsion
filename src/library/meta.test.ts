// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { NO_META, addKeywords, hasKeyword, isEmptyMeta, keywordIndex, keywordTree, normalizeMeta, parseKeywords, removeKeyword, retagMeta, sharedMeta } from './meta';

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

describe('IPTC set', () => {
  it('keeps known fields, drops unknown ones and an unknown copyright status', () => {
    const m = normalizeMeta({ headline: ' Storm ', email: 'a@b.c', copyrightStatus: 'copyrighted', nonsense: 'x' });
    expect(m).toEqual({ ...NO_META, headline: 'Storm', email: 'a@b.c', copyrightStatus: 'copyrighted' });
    expect(normalizeMeta({ copyrightStatus: 'maybe' })).toBe(NO_META);
    expect(normalizeMeta({ instructions: 'a'.repeat(9000) }).instructions).toHaveLength(8000);
  });
});

describe('keyword hierarchy', () => {
  it('reads typed paths both ways and finds a unique name', () => {
    expect(parseKeywords('Places > UK > Kent, Kent < UK < Places, Dog')).toEqual(['Places|UK|Kent', 'Dog']);
    expect(parseKeywords('kent, Paris', ['Places|UK|Kent', 'Places|France|Paris', 'Texas|Paris'])).toEqual(['Places|UK|Kent', 'Paris']);
  });
  it('matches a path and what is under it, or a name at any level', () => {
    const m = { ...NO_META, keywords: ['Places|UK|Kent', 'Dog'] };
    expect(hasKeyword(m, 'Places|UK')).toBe(true);
    expect(hasKeyword(m, 'Places|U')).toBe(false);
    expect(hasKeyword(m, 'uk')).toBe(true);
    expect(hasKeyword(m, 'Animals|Dog')).toBe(false);
  });
  it('builds the tree with counts, including keywords no photo has', () => {
    const a = { ...NO_META, keywords: ['Places|UK|Kent', 'Places|UK'] };
    const b = { ...NO_META, keywords: ['Places|France', 'Dog'] };
    const tree = keywordTree([a, b], ['Animals']);
    expect(tree.map(n => [n.name, n.count])).toEqual([['Animals', 0], ['Dog', 1], ['Places', 2]]);
    const places = tree[2];
    expect(places.children.map(n => [n.path, n.count])).toEqual([['Places|France', 1], ['Places|UK', 1]]);
    expect(places.children[1].children[0]).toMatchObject({ path: 'Places|UK|Kent', count: 1 });
  });
  it('moves and deletes a keyword with its children', () => {
    const m = { ...NO_META, keywords: ['Places|UK|Kent', 'Places|UKraine', 'Dog'] };
    expect(retagMeta(m, 'places|uk', 'Europe|UK').keywords).toEqual(['Europe|UK|Kent', 'Places|UKraine', 'Dog']);
    expect(retagMeta(m, 'Places', null).keywords).toEqual(['Dog']);
    expect(retagMeta({ ...NO_META, keywords: ['Kent', 'UK|Kent'] }, 'Kent', 'UK|Kent').keywords).toEqual(['UK|Kent']);
  });
});
