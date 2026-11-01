// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { normalizeWorkspace, setWorkspace, useWorkspace, WORKSPACE_DEFAULTS } from './workspace';
import { defaultRecipe, resetSection } from '../film/recipe';

describe('workspace preferences', () => {
  it('recovers from invalid saved choices while retaining valid independent preferences', () => {
    expect(normalizeWorkspace(null)).toEqual(WORKSPACE_DEFAULTS);
    expect(normalizeWorkspace({ layout:'missing', imageColumns:3, group:'unknown' })).toEqual(WORKSPACE_DEFAULTS);
    expect(normalizeWorkspace({ layout:'classic', imageColumns:1, group:'colour' })).toEqual({layout:'workflow',imageColumns:1,group:'colour'});
  });
  it('migrates saved stage selections to the new three-tab layout', () => {
    for (const group of ['prepare','look','tone']) expect(normalizeWorkspace({layout:'classic',imageColumns:1,group})).toEqual({layout:'workflow',imageColumns:1,group:'develop'});
    expect(normalizeWorkspace({group:'finish'}).group).toBe('refine');
    expect(normalizeWorkspace({group:'colour'}).group).toBe('colour');
  });
  it('changes columns without overwriting the selected stage', () => {
    setWorkspace({group:'refine',imageColumns:2});
    setWorkspace({imageColumns:1});
    expect(useWorkspace.getState()).toEqual({layout:'workflow',group:'refine',imageColumns:1});
    setWorkspace(WORKSPACE_DEFAULTS);
  });
  it('resets Tone and Colour basics without resetting white balance or each other', () => {
    const recipe={...defaultRecipe(),exposure:1,contrast:20,vibrance:25,saturation:30,wb:{temperature:4300,tint:12}};
    expect(resetSection(recipe,'tone')).toMatchObject({exposure:0,contrast:0,vibrance:25,saturation:30,wb:recipe.wb});
    expect(resetSection(recipe,'colour-basics')).toMatchObject({exposure:1,contrast:20,vibrance:0,saturation:0,wb:recipe.wb});
    expect(resetSection(recipe,'whitebalance')).toMatchObject({exposure:1,vibrance:25,saturation:30,wb:null});
  });
});

it('resets Exposure and HDR independently, without changing lens, colour wheels or the curve', () => {
  const recipe={...defaultRecipe(),exposure:1,contrast:20,saturation:25,vibrance:10,highlights:-30,shadows:40,whites:10,blacks:-15,fade:12,grading:{highlights_H:40,highlights_C:0.05},wb:{temperature:4300,tint:10}};
  expect(resetSection(recipe,'exposure')).toEqual({...recipe,exposure:0,contrast:0,saturation:0,vibrance:0});
  expect(resetSection(recipe,'hdr')).toEqual({...recipe,highlights:0,shadows:0,whites:0,blacks:0});
  expect(resetSection(recipe,'refine-optics')).toEqual({...recipe,fade:0});
});
