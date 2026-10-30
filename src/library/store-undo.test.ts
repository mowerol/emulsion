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

const { editRecipes, markPhotos, setFilter, undo, redo, useApp } = await import('./store');
const { NO_FILTER } = await import('./filter');
const { writeSidecar } = await import('../backend/api');
const { withStock, defaultRecipe } = await import('../film/recipe');

const photo = (path: string) => ({ path, rel: path, name: path, size: 1, modified: 0, recipe: null, seed: 1, white: null, rating: 0, label: null, heart: false });

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

  it('stars and tags the selected frames as one step, saving them with the look', async () => {
    vi.useFakeTimers();
    useApp.setState({ selected: new Set(['a', 'b']) });
    editRecipes(['a'], () => defaultRecipe('portra400'));
    markPhotos({ rating: 4 });
    expect(useApp.getState().photos.map((p) => p.rating)).toEqual([4, 4]);
    expect(useApp.getState().history.undo).toBe('4 stars on 2 photos');
    await vi.runAllTimersAsync();
    expect(writeSidecar).toHaveBeenLastCalledWith('b', { recipe: null, rating: 4, label: null, heart: false });
    expect(writeSidecar).toHaveBeenCalledWith('a', expect.objectContaining({ rating: 4, recipe: expect.objectContaining({ stock: 'portra400' }) }));
    undo();
    expect(useApp.getState().photos.map((p) => p.rating)).toEqual([0, 0]);
    // The look made before the rating stays.
    expect(useApp.getState().photos[0].recipe?.stock).toBe('portra400');
    vi.useRealTimers();
  });

  it('gives a mixed selection the tag, then takes it off all of them', () => {
    useApp.setState({ selected: new Set(['a', 'b']) });
    useApp.setState((s) => ({ photos: s.photos.map((p, i) => (i === 0 ? { ...p, label: 'red' as const } : p)) }));
    markPhotos({ label: 'red' });
    expect(useApp.getState().photos.map((p) => p.label)).toEqual(['red', 'red']);
    markPhotos({ label: 'red' });
    expect(useApp.getState().photos.map((p) => p.label)).toEqual([null, null]);
    expect(useApp.getState().history.undo).toBe('Remove tag on 2 photos');
    undo();
    expect(useApp.getState().photos.map((p) => p.label)).toEqual(['red', 'red']);
  });

  it('moves to the first matching photo when a filter hides the active one', () => {
    useApp.setState((st) => ({ photos: st.photos.map((p, i) => (i === 1 ? { ...p, heart: true } : p)), active: 0, selected: new Set(['a']), filter: NO_FILTER }));
    setFilter({ heart: true });
    expect(useApp.getState().active).toBe(1);
    expect([...useApp.getState().selected]).toEqual(['b']);
    // With nothing matching, the active photo stays.
    setFilter({ heart: false, minRating: 5 });
    expect(useApp.getState().active).toBe(1);
    setFilter(NO_FILTER);
  });
});
