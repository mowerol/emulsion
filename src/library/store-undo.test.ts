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

const { editRecipes, undo, redo, useApp } = await import('./store');
const { withStock, defaultRecipe } = await import('../film/recipe');

const photo = (path: string) => ({ path, rel: path, name: path, size: 1, modified: 0, recipe: null, seed: 1, white: null });

describe('undo in the store', () => {
  beforeEach(() => {
    useApp.setState({ photos: [photo('a'), photo('b')], active: 0, selected: new Set(['a']) });
  });

  it('undoes picking a film stock on an undeveloped photo, then redoes it', () => {
    editRecipes(['a'], (r) => withStock(r, 'gold200'));
    expect(useApp.getState().photos[0].recipe?.stock).toBe('gold200');
    expect(useApp.getState().history.undo).toBe('Gold 200');
    undo();
    expect(useApp.getState().photos[0].recipe).toBeNull();
    redo();
    expect(useApp.getState().photos[0].recipe?.stock).toBe('gold200');
  });

  it('undoes switching from one stock to another', () => {
    editRecipes(['a'], () => defaultRecipe('portra400'));
    editRecipes(['a'], (r) => withStock(r, 'trix400'));
    undo();
    expect(useApp.getState().photos[0].recipe?.stock).toBe('portra400');
  });
});
