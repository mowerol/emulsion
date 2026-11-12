// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { defaultRecipe } from '../film/recipe';
import { newEllipse, newMask } from '../film/masks';
import { warmRecipe, warmStageOf } from './warm';

describe('warmRecipe', () => {
  // Neutral: every warmable stage off (Emulsion Standard's look turns on the colour equalizer).
  const base = defaultRecipe('neutral');

  it('turns the stage on and leaves everything else as it was', () => {
    expect(warmRecipe(base, 'dehaze')).toEqual({ ...base, dehaze: 50 });
    expect(warmRecipe(base, 'texture')).toEqual({ ...base, texture: 50 });
    expect(warmRecipe(base, 'clarity')).toEqual({ ...base, clarity: 100 });
    const color = warmRecipe(base, 'color')!.color!;
    expect(color.hue).toEqual(new Array(8).fill(0));
    expect(color.bright).toEqual(new Array(8).fill(0));
    expect(color.sat.some((v) => v !== 0)).toBe(true);
  });

  it('warms Clarity on the positive side, where its map is made at +100', () => {
    expect(Math.sign(warmRecipe(base, 'clarity')!.clarity)).toBe(1);
    expect(Math.sign(warmRecipe(base, 'dehaze')!.dehaze)).toBe(1);
  });

  it('has nothing to warm when the stage is already on', () => {
    expect(warmRecipe({ ...base, dehaze: -20 }, 'dehaze')).toBeNull();
    expect(warmRecipe({ ...base, texture: 10 }, 'texture')).toBeNull();
    expect(warmRecipe({ ...base, clarity: 5 }, 'clarity')).toBeNull();
    expect(warmRecipe({ ...base, color: { hue: new Array(8).fill(0), sat: [0, 10, 0, 0, 0, 0, 0, 0], bright: new Array(8).fill(0) } }, 'color')).toBeNull();
    expect(warmRecipe(null, 'texture')).toBeNull();
  });

  it('has nothing to warm when an active mask has its own instance', () => {
    for (const k of ['dehaze', 'texture', 'clarity'] as const) {
      const mask = { ...newMask(newEllipse(), 0), [k]: 30 };
      expect(warmRecipe({ ...base, masks: [mask] }, k)).toBeNull();
      // A mask that is off doesn't count.
      expect(warmRecipe({ ...base, masks: [{ ...mask, on: false }] }, k)).not.toBeNull();
    }
  });
});

describe('warmStageOf', () => {
  it('maps the sliders that warm a stage', () => {
    expect(warmStageOf('slider-dehaze')).toBe('dehaze');
    expect(warmStageOf('slider-texture')).toBe('texture');
    expect(warmStageOf('slider-clarity')).toBe('clarity');
    expect(warmStageOf('color-sat-2')).toBe('color');
    expect(warmStageOf('color-hue-0')).toBe('color');
    expect(warmStageOf('slider-exposure')).toBeNull();
    expect(warmStageOf('shape-opacity-3')).toBeNull();
  });
});
