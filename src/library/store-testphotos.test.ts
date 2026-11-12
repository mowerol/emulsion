// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../backend/api', () => ({
  writeSidecar: vi.fn(() => Promise.resolve()),
  scanFolder: vi.fn(),
  whitePoints: vi.fn(() => Promise.resolve([])),
  thumbnail: vi.fn(),
  isTauri: () => false,
  logToTerminal: () => {},
}));

const { editActive, endLookEdit, lookEditDirty, moveLookEdit, startLookEdit, undo, useApp } = await import('./store');
const { defaultRecipe } = await import('../film/recipe');
const { writeSidecar } = await import('../backend/api');

const photo = (path: string, exposure: number) => ({ path, rel: path, name: path, size: 1, modified: 0, seed: 1, white: null, rating: 0, label: null, flag: null, raw: true, pair: null,
  recipe: { ...defaultRecipe(), exposure } });

describe('moving the look draft to a test photo', () => {
  beforeEach(() => {
    useApp.setState({ photos: [photo('a', 1), photo('b', -2)], active: 0, anchor: 0, selected: new Set(['a']), lookEdit: null });
    startLookEdit('a', 'look', 'Look', defaultRecipe('neutral'));
    editActive(r => ({ ...r!, contrast: 40 }), 'Contrast');
  });

  it('carries the draft, as shot, and its undo to an open photo, and gives the first its own recipe back', () => {
    moveLookEdit(useApp.getState().photos[1]);
    const s = useApp.getState();
    expect(s.active).toBe(1);
    expect(s.photos[0].recipe?.exposure).toBe(1);
    expect(s.photos[0].recipe?.contrast).not.toBe(40);
    expect(s.photos[1].recipe).toMatchObject({ contrast: 40, exposure: 0 });
    undo();
    expect(useApp.getState().photos[1].recipe).toMatchObject({ contrast: 0, exposure: 0 });
    endLookEdit();
    expect(useApp.getState().photos[1].recipe?.exposure).toBe(-2);
    expect(useApp.getState().photos[1].recipe?.lookEnabled).toBe(true);
    expect(writeSidecar).not.toHaveBeenCalled();
  });

  it('keeps preview exposure out of what is unsaved, and starts the next photo as shot', () => {
    endLookEdit();
    startLookEdit('a', 'look', 'Look', defaultRecipe('neutral'));
    editActive(r => ({ ...r!, exposure: 1.2 }), 'Preview exposure');
    expect(lookEditDirty(useApp.getState())).toBe(false);
    editActive(r => ({ ...r!, contrast: 10 }), 'Contrast');
    expect(lookEditDirty(useApp.getState())).toBe(true);
    moveLookEdit(useApp.getState().photos[1]);
    expect(useApp.getState().photos[1].recipe).toMatchObject({ exposure: 0, contrast: 10 });
    undo(); undo();
    expect(useApp.getState().photos[1].recipe?.exposure).toBe(0);
  });

  it('adds a photo from elsewhere only while the draft is on it, and ends back home', () => {
    const away = photo('/elsewhere/c', 0.5);
    moveLookEdit(away);
    expect(useApp.getState().photos.map(p => p.path)).toEqual(['a', 'b', '/elsewhere/c']);
    expect(useApp.getState().photos[2].recipe).toMatchObject({ contrast: 40, exposure: 0 });
    moveLookEdit(useApp.getState().photos[1]);
    expect(useApp.getState().photos.map(p => p.path)).toEqual(['a', 'b']);
    moveLookEdit(away);
    endLookEdit();
    const s = useApp.getState();
    expect(s.photos.map(p => p.path)).toEqual(['a', 'b']);
    expect(s.active).toBe(0);
    expect([...s.selected]).toEqual(['a']);
    expect(s.photos[0].recipe?.exposure).toBe(1);
  });
});
