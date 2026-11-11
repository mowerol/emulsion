// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { NO_META } from './meta';
import { applyPreset, fillPreset, makePreset, normalizePreset } from './metapresets';

describe('metadata presets', () => {
  const p = makePreset(' Studio ', { creator: 'Oli', copyright: '© 2026', copyrightStatus: 'copyrighted' }, ['Work', 'Places > UK'.split(' > ').join('|')]);
  it('sets its fields and adds its keywords', () => {
    const m = applyPreset({ ...NO_META, creator: 'Sam', keywords: ['Dog'] }, p);
    expect(m).toMatchObject({ creator: 'Oli', copyright: '© 2026', copyrightStatus: 'copyrighted', keywords: ['Dog', 'Work', 'Places|UK'] });
    expect(p.name).toBe('Studio');
  });
  it('fills only empty fields on new photos', () => {
    const m = fillPreset({ ...NO_META, creator: 'Camera owner' }, p);
    expect(m).toMatchObject({ creator: 'Camera owner', copyright: '© 2026' });
  });
  it('reads a saved preset, dropping what it cannot use', () => {
    expect(normalizePreset({ id: 'a', name: 'x', fields: { title: ' T ', bogus: 'y', copyrightStatus: 'maybe' }, keywords: ['a', 'A'] }))
      .toEqual({ id: 'a', name: 'x', fields: { title: 'T', copyrightStatus: '' }, keywords: ['a'] });
    expect(normalizePreset({ id: 'a', name: ' ' })).toBeNull();
  });
});
