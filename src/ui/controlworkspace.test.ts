// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { defaultRecipe, SLIDERS } from '../film/recipe';
import { D65_XY } from '../engine/whitebalance';
import { CONTROL_WORKSPACE_KEY, defaultControlWorkspace, moveWorkspaceSection, normalizeControlWorkspace, saveControlWorkspace, useControlWorkspace, workspaceSection } from './controlworkspace';
import { WORKSPACE_GROUPS } from './workspacegroups';
import { controlFields, omittedWorkspaceControls, resetWorkspaceControls, WORKSPACE_CATALOG, workspaceControlChanged, workspaceSlider } from './workspacecontrols';
import { LENS_DEFAULTS, type LensMetadata } from '../engine/lenscorrection';
import { PERSPECTIVE_DEFAULTS } from '../engine/perspective';
import { CHROMA_ONLY } from '../film/noisereduction';
import { groupHasSection, normalizeWorkspace } from './workspace';

describe('personal workspace persistence', () => {
  it('retains fully hidden and unknown groups, repairs selection and prevents duplicate groups', () => {
    const layout = normalizeControlWorkspace({ active: 'gone', groups: [
      { id: 'one', name: '  Daily  ', icon: 'no-such-icon', sections: [
        { id: 'a', source: 'exposure', name: 'Basics', controls: ['exposure', 'future-tool', 'exposure', 42] },
        { id: 'empty', source: 'hdr', name: 'Empty', controls: [] },
        { id: 'a', source: 'grain', name: 'Duplicate', controls: ['grain'] },
      ] },
      { id: 'two', name: 'Finish', sections: [{ id: 'b', source: 'exposure', name: 'Duplicate exposure', controls: ['contrast'] }, { id: 'c', source: 'future-group', name: 'Future', icon: 'film', controls: ['future-slider'] }] },
      { id: 'one', name: 'Duplicate group', sections: [] },
    ] });
    expect(layout.active).toBe('one');
    expect(layout.groups.map(g => g.name)).toEqual(['Daily', 'Finish']);
    expect(layout.groups[0].icon).toBe('sliders');
    expect(layout.groups[0].sections.map(s => s.controls)).toEqual([['exposure', 'future-tool'], []]);
    expect(layout.groups[1].sections[0].source).toBe('future-group');
    expect(layout.groups[1].sections[0].controls).toEqual(['future-slider']);
    expect(normalizeControlWorkspace(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
  });
  it('saves one or many tabs with existing groups and retained visibility', () => {
    const layout = defaultControlWorkspace();
    layout.groups.push({ id: 'extra', name: 'Film', icon: 'film', sections: [] }); layout.active = 'extra';
    saveControlWorkspace(layout);
    expect(useControlWorkspace.getState()).toEqual(layout);
    expect(JSON.parse(localStorage.getItem(CONTROL_WORKSPACE_KEY)!)).toEqual(layout);
    expect(normalizeWorkspace({ group: 'custom', imageColumns: 2 })).toEqual({ layout: 'workflow', group: 'custom', imageColumns: 2 });
    expect(groupHasSection('custom', 'masks')).toBe(false);
    saveControlWorkspace(defaultControlWorkspace());
  });
  it('moves a whole group between tabs exactly once, retaining its name, icon and visibility', () => {
    const layout = defaultControlWorkspace();
    const grain = layout.groups[0].sections.find(s => s.source === 'grain')!;
    grain.name = 'My grain'; grain.icon = 'heart'; grain.controls = ['grain'];
    layout.groups[0].sections = layout.groups[0].sections.filter(s => s.source !== 'curve');
    layout.groups.push({ id: 'two', name: 'Second', icon: 'heart', sections: [workspaceSection('curve')] });
    const moved = moveWorkspaceSection(layout, grain.id, 'two', 'group-curve');
    expect(moved.groups[1].sections.map(s => s.source)).toEqual(['grain', 'curve']);
    expect(moved.groups[1].sections[0]).toEqual(grain);
    expect(moved.groups.flatMap(g => g.sections).filter(s => s.source === 'grain')).toHaveLength(1);
    expect(layout.groups[0].sections).toContain(grain);
    expect(moveWorkspaceSection(moved, grain.id, 'missing')).toBe(moved);
  });
  it('migrates old freeform slider collections into existing groups, retaining tabs and omitted controls', () => {
    const layout = normalizeControlWorkspace({ active: 'two', groups: [
      { id: 'one', name: 'Daily', sections: [{ id: 'mix', name: 'Mix', controls: ['exposure', 'temperature', 'grain'] }] },
      { id: 'two', name: 'Finish', sections: [{ id: 'more', name: 'More', controls: ['grainIso', 'glow'] }] },
    ] });
    expect(layout.version).toBe(2); expect(layout.active).toBe('two');
    expect(layout.groups[0].sections.map(s => s.source)).toEqual(['exposure', 'whitebalance', 'grain']);
    expect(layout.groups[0].sections.find(s => s.source === 'exposure')!.controls).toEqual(['exposure']);
    expect(layout.groups[0].sections.find(s => s.source === 'grain')!.controls).toEqual(['grain', 'grainIso']);
    expect(layout.groups[1].sections[0]).toMatchObject({ source: 'optics', controls: ['glow'] });
  });
  it('starts with existing groups and makes every slider available inside its original group', () => {
    expect(defaultControlWorkspace().groups[0].sections.map(s => s.source)).toEqual(WORKSPACE_GROUPS.map(g => g.id));
    for (const def of SLIDERS) expect(WORKSPACE_GROUPS.some(g => g.controls.includes(def.key))).toBe(true);
  });
});

describe('personal control recipe adapters', () => {
  const context = { white: D65_XY };
  it('offers every standard slider and gives every catalogue item a unique identity', () => {
    for (const def of SLIDERS) expect(workspaceSlider(def.key)).toBeDefined();
    expect(new Set(WORKSPACE_CATALOG.map(d => d.id)).size).toBe(WORKSPACE_CATALOG.length);
    for (const d of WORKSPACE_CATALOG) expect(d.label).not.toContain('undefined');
  });
  it('resets a mixed custom section without resetting unrelated settings', () => {
    const recipe = { ...defaultRecipe(), exposure: 2, contrast: 20, grain: 35, halation: 70, wb: { temperature: 4300, tint: 12 } };
    const next = resetWorkspaceControls(recipe, ['exposure', 'grain', 'temperature'], context);
    expect(next).toMatchObject({ exposure: 0, grain: 0, contrast: 20, halation: 70, wb: { tint: 12 } });
    expect(next.wb!.temperature).toBeCloseTo(workspaceSlider('temperature')!.fallback(recipe, context));
    expect(recipe.exposure).toBe(2);
  });
  it('writes nested colour controls and preserves other channels and linked grading settings', () => {
    const recipe = { ...defaultRecipe(), exposure: 1, saturation: 25, shadows: 40 };
    const colour = workspaceSlider('hsl:hue:0')!.set(recipe, 12, context);
    const grade = workspaceSlider('grade:highlights_C')!.set(colour, 0.08, context);
    expect(grade.color!.hue).toEqual([12, 0, 0, 0, 0, 0, 0, 0]);
    expect(grade.grading).toMatchObject({ highlights_C: 0.08 });
    expect(grade).toMatchObject({ exposure: 1, saturation: 25, shadows: 40 });
    expect(workspaceControlChanged('grade:highlights_C', grade, context)).toBe(true);
    expect(resetWorkspaceControls(grade, ['grade:highlights_C'], context)).toMatchObject({ color: colour.color, saturation: 25, shadows: 40 });
    expect(controlFields('grading')).toContain('grade:highlights_C');
  });
  it('exposes every noise, lens fine-tuning and perspective slider individually', () => {
    for (const id of ['noise:luma', 'noise:chroma', 'noise:amount', 'lens:distortionAmount', 'lens:redAmount', 'lens:blueAmount', 'lens:vignetteAmount', 'transform:vertical', 'transform:horizontal', 'transform:rotation', 'transform:focalLength']) expect(workspaceSlider(id)).toBeDefined();
    let recipe = { ...defaultRecipe(), profiledDenoise: { ...CHROMA_ONLY, strength: 1.5, luma: 15, chroma: 30 }, lens: { ...LENS_DEFAULTS, vignetteAmount: 1.2 }, transform: { ...PERSPECTIVE_DEFAULTS, horizontal: 10 } };
    const next = workspaceSlider('noise:luma')!.set(recipe, 25, { ...context, raw: true });
    expect(next.profiledDenoise).toMatchObject({ luma: 25, chroma: 30, strength: 1.5 });
    const fixed = resetWorkspaceControls(next, ['lens:vignetteAmount', 'transform:horizontal'], context);
    expect(fixed.lens).toBeNull(); expect(fixed.transform).toBeNull();
    expect(fixed.profiledDenoise).toEqual(next.profiledDenoise);
  });
  it('keeps dependencies actionable and disables unsupported lens/profile and crop states', () => {
    const recipe = { ...defaultRecipe(), lookEnabled: false, lens: { ...LENS_DEFAULTS, enabled: false } };
    const distortion = workspaceSlider('lens:distortionAmount')!;
    const metadata: LensMetadata = { camera: 'Test', lens: 'Test', unsupported: null, correction: { kind: 'olympus', distortion: [0.1, 0, 0, 1], ca: null } };
    expect(workspaceSlider('lookAmount')!.unavailable!(recipe, context)).toContain('Choose a look');
    expect(workspaceSlider('lookAmount')!.setup).toBe('stock');
    expect(distortion.unavailable!(recipe, { ...context, raw: true, lens: metadata })).toContain('turned off');
    const enabled = distortion.enable!(recipe, { ...context, raw: true, lens: metadata });
    expect(distortion.unavailable!(enabled, { ...context, raw: true, lens: metadata })).toBeUndefined();
    expect(distortion.enable!(recipe, context)).toBe(recipe);
    expect(workspaceSlider('lens:redAmount')!.unavailable!(recipe, { ...context, raw: true, lens: metadata })).toContain('not available');
    expect(workspaceSlider('transform:vertical')!.unavailable!(recipe, { ...context, cropping: true })).toContain('Finish cropping');
  });
  it('reports omitted fields once and does not report grading just because included saturation changed', () => {
    const recipe = { ...defaultRecipe(), saturation: 25, shadows: 40 };
    expect(omittedWorkspaceControls(recipe, ['saturation', 'shadows'], context)).toEqual([]);
    const grade = workspaceSlider('grade:highlights_C')!.set(recipe, 0.08, context);
    expect(omittedWorkspaceControls(grade, ['saturation', 'shadows'], context).map(d => d.id)).toEqual(['grade:highlights_C']);
    expect(omittedWorkspaceControls(grade, ['grading'], context)).toEqual([]);
    const lens = { ...defaultRecipe(), lens: { ...LENS_DEFAULTS, enabled: false, redAmount: 1.2 } };
    expect(omittedWorkspaceControls(lens, [], context).map(d => d.id)).toEqual(['lens']);
    expect(omittedWorkspaceControls(lens, ['lens:distortionAmount', 'lens:redAmount'], context)).toEqual([]);
    const raw = defaultRecipe();
    expect(omittedWorkspaceControls(raw, [], { ...context, raw: true })).toEqual([]);
  });
});
