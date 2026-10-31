// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/lens-metadata.json';
import reference from './fixtures/lens-reference.json';
import { LENS_DEFAULTS, lensCenter, lensCorrectPixels, lensSpline, normalizeLens, type LensMetadata } from './lenscorrection';
import { defaultRecipe, normalizeRecipe, resetSection, withSettingsFrom } from '../film/recipe';
const metadata = fixtures as LensMetadata[];
describe('embedded lens correction v2', () => {
  it('matches the pinned upstream C implementation on real metadata, portrait and toggles', () => {
    for(const row of reference) {
      const settings={...LENS_DEFAULTS,distortion:!!(row.flags&1),ca:!!(row.flags&2),vignette:!!(row.flags&4)};
      const result=lensSpline(metadata[row.fixture].correction!,row.width,row.height,settings)!;
      if (!result) { expect(row.factors.every(f=>f.every(v=>v===1))).toBe(true); continue; }
      result.knots.forEach((v,i)=>expect(v).toBeCloseTo(row.knots[i],5));
      result.factors.forEach((f,i)=>f.forEach((v,c)=>expect(v).toBeCloseTo(row.factors[i][c],5)));
    }
  });
  it('bypasses the pass when every strength is zero', () => {
    for (const m of metadata) expect(lensSpline(m.correction!,1200,800,{...LENS_DEFAULTS,distortionAmount:0,redAmount:0,blueAmount:0,vignetteAmount:0})).toBeNull();
  });
  it('switches the combined DNG warp off, without silently retaining geometry through CA', () => {
    const dng=metadata[4].correction!;
    expect(lensSpline(dng,1200,800,{...LENS_DEFAULTS,distortion:false})).toBeNull();
  });
  it('normalises and persists per-photo controls, and resets to automatic correction', () => {
    expect(normalizeLens({})).toBeNull();
    const lens=normalizeLens({enabled:false,distortionAmount:9,redAmount:NaN})!;
    expect(lens).toMatchObject({enabled:false,distortionAmount:2,redAmount:1});
    const recipe={...defaultRecipe('portra400'),lens};
    expect(normalizeRecipe(JSON.parse(JSON.stringify(recipe)))).toEqual(recipe);
    expect(withSettingsFrom(recipe,null).lens).toEqual(lens);
    expect(resetSection(recipe,'lens').lens).toBeNull();
    expect(lensSpline(metadata[0].correction!,1200,800,lens)).toBeNull();
  });
  it('keeps identity geometry and constants, and adjusts vignetting in source space', () => {
    const pixels = new Float32Array(7*5*4).fill(0.2);
    const identity={knots:[0,1],factors:[[1,1,1],[1,1,1]] as import('../film/stocks').Vec3[],vigKnots:[0,1],vig:[1,1]};
    expect(lensSpline({kind:'olympus',distortion:[0,0,0,1],ca:[0,0,0,0,0,0]},7,5)).toBeNull();
    expect(lensCorrectPixels(pixels,7,5,identity).filter((_,i)=>i%4!==3)).toEqual(new Float32Array(7*5*3).fill(0.2));
    const vignette=lensSpline(metadata[3].correction!,7,5)!;
    const corrected=lensCorrectPixels(pixels,7,5,vignette);
    expect(corrected[0]).toBeGreaterThan(corrected[(2*7+3)*4]);
  });
  it('transforms the upstream pixel centre with portrait and reflected orientations', () => {
    expect(lensCenter(1,100,60)).toEqual([0.505,0.5+0.5/60]);
    expect(lensCenter(3,100,60)).toEqual([0.495,0.5-0.5/60]);
    expect(lensCenter(8,60,100)).toEqual([0.5+0.5/60,0.495]);
  });
});
