// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import native from './fixtures/perspective-native.json';
import { geometryFramePoint, geometryMatrix, geometrySourcePoint, normalizePerspective, PERSPECTIVE_DEFAULTS, perspectiveForward, perspectiveMap, project } from './perspective';
import { FULL, setAngle, sourcePoint } from '../film/crop';
import { defaultRecipe, normalizeRecipe, resetAdjustments, resetSection, withSettingsFrom } from '../film/recipe';
import { mulVec } from './color';

describe('RawTherapee camera-based perspective', () => {
  it('matches native upstream homographies, including simultaneous pitch, yaw and roll', () => {
    for (const {params:[rotation,vertical,horizontal,focalLength],matrix} of native) {
      const actual=perspectiveForward({...PERSPECTIVE_DEFAULTS,rotation,vertical,horizontal,focalLength},600,400).flat();
      actual.forEach((v,i)=>expect(Math.abs(v-matrix[i])/Math.max(1,Math.abs(matrix[i]))).toBeLessThan(1e-5));
    }
  });
  it('leaves legacy crop/straighten mapping exactly unchanged', () => {
    const c=setAngle(FULL,12,600,400);
    for(const [x,y] of [[0,0],[1,1],[0.3,0.7]]) expect(geometrySourcePoint(c,600,400,x,y,null)).toEqual(sourcePoint(c,600,400,x,y));
  });
  it('round-trips mask anchors and eyedropper points through crop plus perspective at any resolution', () => {
    const p={...PERSPECTIVE_DEFAULTS,vertical:22,horizontal:-12,rotation:3};
    const c={...FULL,x:0.1,y:0.15,w:0.7,h:0.6,angle:8};
    for(const [x,y] of [[0,0],[1,1],[0.3,0.7]]) {
      const source=geometrySourcePoint(c,600,400,x,y,p);
      const back=geometryFramePoint(c,600,400,...source,p);
      expect(back[0]).toBeCloseTo(x,10); expect(back[1]).toBeCloseTo(y,10);
      const full=geometrySourcePoint(c,6000,4000,x,y,p);
      expect(full[0]).toBeCloseTo(source[0],10); expect(full[1]).toBeCloseTo(source[1],10);
    }
  });
  it('constrains every pixel inside the photo, with positive projective denominators', () => {
    for(const [W,H] of [[600,400],[400,600]]) for(const vertical of [-60,-25,0,25,60]) for(const horizontal of [-40,0,40]) {
      const p={...PERSPECTIVE_DEFAULTS,vertical,horizontal,rotation:7};
      const m=perspectiveMap(p,W,H);
      for(let j=0;j<=10;j++) for(let i=0;i<=10;i++) {
        const [x,y]=project(m,i/10,j/10);
        expect(Number.isFinite(x)&&Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(-1e-9); expect(x).toBeLessThanOrEqual(1+1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9); expect(y).toBeLessThanOrEqual(1+1e-9);
      }
    }
  });
  it('makes converging source lines parallel after correction', () => {
    const p={...PERSPECTIVE_DEFAULTS,vertical:20,horizontal:10,rotation:4};
    const forward=perspectiveForward(p,600,400);
    // A corrected-space line is mapped backwards to source by our display map.
    const map=geometryMatrix(FULL,600,400,p);
    const a=project(map,0.2,0.1), b=project(map,0.2,0.9);
    const pa=mulVec(forward,[a[0]*600,a[1]*400,1]), pb=mulVec(forward,[b[0]*600,b[1]*400,1]);
    expect(pa[0]/pa[2]).toBeCloseTo(pb[0]/pb[2],8);
  });
  it('validates sidecars and keeps geometry local to each photo when copying settings', () => {
    expect(normalizePerspective({vertical:Infinity,rotation:NaN})).toBeNull();
    expect(normalizePerspective([])).toBeNull();
    const transform={...PERSPECTIVE_DEFAULTS,vertical:12};
    const r={...defaultRecipe(),transform};
    expect(normalizeRecipe(JSON.parse(JSON.stringify(r)))?.transform).toEqual(transform);
    expect(normalizeRecipe({})?.transform).toBeNull();
    expect(resetSection(r,'transform').transform).toBeNull();
    expect(resetAdjustments(r).transform).toEqual(transform);
    expect(withSettingsFrom(r,null).transform).toBeNull();
    expect(withSettingsFrom(defaultRecipe(),r).transform).toEqual(transform);
  });
});
