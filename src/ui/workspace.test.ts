// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { normalizeWorkspace, setWorkspace, useWorkspace, WORKSPACE_DEFAULTS } from './workspace';
import { defaultRecipe, resetSection } from '../film/recipe';

describe('workspace preferences', () => {
  it('recovers from invalid saved choices while retaining valid independent preferences', () => {
    expect(normalizeWorkspace(null)).toEqual(WORKSPACE_DEFAULTS);
    expect(normalizeWorkspace({ layout:'missing', imageColumns:3, group:'unknown' })).toEqual(WORKSPACE_DEFAULTS);
    expect(normalizeWorkspace({ layout:'classic', imageColumns:1, group:'colour' })).toEqual({layout:'classic',imageColumns:1,group:'colour'});
  });
  it('changes columns without overwriting the selected workspace or stage', () => {
    setWorkspace({layout:'classic',group:'finish',imageColumns:2});
    setWorkspace({imageColumns:1});
    expect(useWorkspace.getState()).toEqual({layout:'classic',group:'finish',imageColumns:1});
    setWorkspace(WORKSPACE_DEFAULTS);
  });
  it('resets Tone and Colour basics without resetting white balance or each other', () => {
    const recipe={...defaultRecipe(),exposure:1,contrast:20,vibrance:25,saturation:30,wb:{temperature:4300,tint:12}};
    expect(resetSection(recipe,'tone')).toMatchObject({exposure:0,contrast:0,vibrance:25,saturation:30,wb:recipe.wb});
    expect(resetSection(recipe,'colour-basics')).toMatchObject({exposure:1,contrast:20,vibrance:0,saturation:0,wb:recipe.wb});
    expect(resetSection(recipe,'whitebalance')).toMatchObject({exposure:1,vibrance:25,saturation:30,wb:null});
  });
});
