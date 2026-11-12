// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

vi.mock('../backend/api', () => ({ writeSidecar: vi.fn(() => Promise.resolve()), scanFolder: vi.fn(), whitePoints: vi.fn(() => Promise.resolve([])), thumbnail: vi.fn(), isTauri: () => false, logToTerminal: () => {} }));

const { begin } = await import('./TreatmentControls');
const { activePhoto, endLookEdit, useApp } = await import('../library/store');
const { defaultRecipe } = await import('../film/recipe');
const { recipeFromSettings } = await import('../film/creative');

describe('a look draft', () => {
  it('is the photo as shot: none of its exposure, white balance, tones or colour carry over', () => {
    const edited = { ...defaultRecipe(), exposure: 1.5, wb: { mode: 'custom', temp: 3200, tint: 20 } as never, highlights: -80, shadows: 60,
      whites: 30, blacks: -40, contrast: 50, saturation: -30, curve: { rgb: [[0, 0.1], [1, 0.9]] } as never, texture: 40, clarity: 30 };
    const photo = { path: '/a.orf', rel: 'a.orf', name: 'a.orf', size: 1, modified: 0, recipe: edited, seed: 1, white: null, rating: 0, label: null, flag: null, raw: true, pair: null };
    useApp.setState({ photos: [photo], active: 0, selected: new Set([photo.path]), lookEdit: null });
    const settings = { colorBalance: { saturation_global: 0.2 }, curve: null, lut: null };
    begin(photo, 'look', 'Look', settings);
    expect(activePhoto()!.recipe).toEqual(recipeFromSettings(defaultRecipe('neutral'), settings));
    expect(activePhoto()!.recipe).toMatchObject({ exposure: 0, wb: null, highlights: 0, shadows: 0, whites: 0, blacks: 0, texture: 0, clarity: 0 });
    endLookEdit();
    expect(activePhoto()!.recipe).toBe(edited);
  });
});
