// SPDX-License-Identifier: GPL-3.0-or-later
// An unedited JPEG opens as Neutral, so its first edit starts there; a RAW's starts from
// Emulsion Standard (Oli, 2026-11-14: a JPEG shouldn't get a look automatically).
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../backend/api', () => ({
  writeSidecar: vi.fn(() => Promise.resolve()),
  scanFolder: vi.fn(),
  whitePoints: vi.fn(() => Promise.resolve([])),
  thumbnail: vi.fn(),
  isTauri: () => false,
  logToTerminal: () => {},
}));

const { editRecipes, useApp } = await import('./store');
const { resetAdjustments, uneditedRecipe, withSlider } = await import('../film/recipe');

const photo = (path: string, raw: boolean) => ({ path, rel: path, name: path, size: 1, modified: 0, recipe: null, seed: 1, white: null, rating: 0, label: null, flag: null, raw, pair: null });

beforeEach(() => {
  useApp.setState({ photos: [photo('a.jpg', false), photo('b.raf', true)], active: 0, selected: new Set(['a.jpg']) });
});

it('develops an unedited JPEG as Neutral and a RAW with Emulsion Standard', () => {
  expect(uneditedRecipe({ raw: false })).toMatchObject({ stock: 'neutral', lookEnabled: false });
  expect(uneditedRecipe({ raw: true })).toMatchObject({ stock: 'emulsion-standard', lookEnabled: true });
});

it('starts a first edit from what the photo develops with now', () => {
  editRecipes(['a.jpg', 'b.raf'], (r) => withSlider(r!, 'exposure', 0.5));
  const [jpeg, raw] = useApp.getState().photos;
  expect(jpeg.recipe).toMatchObject({ exposure: 0.5, stock: 'neutral', lookEnabled: false });
  expect(raw.recipe).toMatchObject({ exposure: 0.5, stock: 'emulsion-standard', lookEnabled: true });
});

it('keeps a photo unedited when an edit leaves it as it develops', () => {
  const undoBefore = useApp.getState().history.undo;
  editRecipes(['a.jpg'], (r) => r ? resetAdjustments(r) : r);
  editRecipes(['a.jpg'], (r) => r);
  expect(useApp.getState().photos[0].recipe).toBeNull();
  expect(useApp.getState().history.undo).toBe(undoBefore);
});

it('opens an unedited Fujifilm RAW with the look of the film simulation it was shot with', () => {
  const fuji = (simulation: string | null) => ({ raw: true, capture: { camera: 'FUJIFILM X-T30 II', date: null, simulation } });
  expect(uneditedRecipe(fuji('classic-negative'))).toMatchObject({ pack: 'emulsion-looks', stock: 'emulsion-film-neg', lookEnabled: true });
  expect(uneditedRecipe(fuji('classic-negative')).lookSnapshot).toMatchObject({ id: 'emulsion-film-neg', name: 'Classic Negative' });
  expect(uneditedRecipe(fuji('classic-chrome'))).toMatchObject({ stock: 'emulsion-film-chrome' });
  // No look for black and white (yet), none for other cameras: the default look.
  expect(uneditedRecipe(fuji('acros'))).toMatchObject({ stock: 'emulsion-standard' });
  expect(uneditedRecipe(fuji(null))).toMatchObject({ stock: 'emulsion-standard' });
  // A JPEG stays Neutral, whatever its camera recorded.
  expect(uneditedRecipe({ raw: false, capture: { simulation: 'classic-negative' } })).toMatchObject({ stock: 'neutral', lookEnabled: false });
});

it('starts a Fujifilm RAW’s first edit from its film simulation’s look', () => {
  useApp.setState({ photos: [{ ...photo('c.raf', true), capture: { camera: null, date: null, simulation: 'classic-chrome' } }], active: 0, selected: new Set(['c.raf']) });
  editRecipes(['c.raf'], (r) => withSlider(r!, 'exposure', 1));
  expect(useApp.getState().photos[0].recipe).toMatchObject({ exposure: 1, stock: 'emulsion-film-chrome', lookEnabled: true });
});
