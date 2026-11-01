// Copyright (c) 2019 Alberto Griggio <alberto.griggio@gmail.com>
// Copyright (c) 2019 Lawrence Lee <billee@ucdavis.edu>
// copyright (c) 2016 Ulrich Pegelow.
// Ported from RawTherapee rtengine/ashift_dt.c homography() and
// homogeneouscoordinates.cc at b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c.
// Camera rotations/projection translated to TypeScript. Output is centered on
// the image center; optional auto-fill retains the original frame aspect.
// SPDX-License-Identifier: GPL-3.0-or-later
import { cropAffine, type Crop } from '../film/crop';
import type { Mat3 } from '../film/stocks';
import { invert3, mulMat, mulVec } from './color';

export interface Perspective {
  rotation: number;
  vertical: number;
  horizontal: number;
  /** 35mm-equivalent focal length, including crop factor. */
  focalLength: number;
  autoCrop: boolean;
}
export const PERSPECTIVE_DEFAULTS: Perspective = { rotation: 0, vertical: 0, horizontal: 0, focalLength: 28, autoCrop: true };
export const hasPerspective = (p: Perspective | null | undefined) => !!p && !!(p.rotation || p.vertical || p.horizontal);
export function normalizePerspective(input: unknown): Perspective | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>, out = { ...PERSPECTIVE_DEFAULTS };
  for (const [key, min, max] of [['rotation', -20, 20], ['vertical', -80, 80], ['horizontal', -80, 80], ['focalLength', 1, 2000]] as const) {
    if (typeof o[key] === 'number' && Number.isFinite(o[key])) out[key] = Math.max(min, Math.min(max, o[key]));
  }
  if (typeof o.autoCrop === 'boolean') out.autoCrop = o.autoCrop;
  return Object.keys(out).some(k => out[k as keyof Perspective] !== PERSPECTIVE_DEFAULTS[k as keyof Perspective]) ? out : null;
}

const IDENTITY: Mat3 = [[1,0,0],[0,1,0],[0,0,1]];
const radians = (d: number) => d * Math.PI / 180;
export function project(m: Mat3, x: number, y: number): [number, number] {
  const [u,v,w] = mulVec(m, [x,y,1]);
  return [u/w,v/w];
}

/** Exact upstream homography in source pixels; its output origin is arbitrary. */
export function perspectiveForward(p: Perspective, W: number, H: number): Mat3 {
  const [a,b,c] = [-p.rotation,p.vertical,p.horizontal].map(radians);
  const ca=Math.cos(a), sa=Math.sin(a), cb=Math.cos(b), sb=Math.sin(b), cc=Math.cos(c), sc=Math.sin(c);
  const rx: Mat3 = [[1,0,0],[0,cb,-sb],[0,sb,cb]];
  const ry: Mat3 = [[cc,0,sc],[0,1,0],[-sc,0,cc]];
  const rz: Mat3 = [[ca,-sa,0],[sa,ca,0],[0,0,1]];
  const r = mulMat(ry,mulMat(rx,rz));
  const f=p.focalLength*Math.hypot(W,H)/Math.hypot(36,24);
  const location=f*cb*cc;
  const t: Mat3 = [[1,0,-W/2],[0,1,-H/2],[0,0,f]];
  return mulMat([[location,0,0],[0,location,0],[0,0,1]],mulMat(r,t));
}

/** Corrected image UV → lens-corrected source UV, before the user's crop. */
export function perspectiveMap(p: Perspective | null | undefined, W: number, H: number): Mat3 {
  if (!hasPerspective(p)) return IDENTITY;
  const f = perspectiveForward(p!,W,H);
  const [cx,cy] = project(f,W/2,H/2);
  const uncenter: Mat3 = [[W,0,cx-W/2],[0,H,cy-H/2],[0,0,1]];
  const toUV: Mat3 = [[1/W,0,0],[0,1/H,0],[0,0,1]];
  const inverse = mulMat(toUV,mulMat(invert3(f),uncenter));
  if (!p!.autoCrop) return inverse;
  // Projective maps preserve straight edges. With a positive denominator at all
  // four corners, checking those corners guarantees the entire frame fits.
  const fits = (s: number) => [[0,0],[1,0],[0,1],[1,1]].every(([x,y]) => {
    const u=0.5+(x-0.5)*s, v=0.5+(y-0.5)*s;
    const [sx,sy,den]=mulVec(inverse,[u,v,1]);
    const centerDen=mulVec(inverse,[0.5,0.5,1])[2];
    return den*centerDen>0 && sx/den>=0 && sx/den<=1 && sy/den>=0 && sy/den<=1;
  });
  let lo=0, hi=1;
  for(let i=0;i<40;i++) { const mid=(lo+hi)/2; if(fits(mid)) lo=mid; else hi=mid; }
  return mulMat(inverse,[[lo,0,(1-lo)/2],[0,lo,(1-lo)/2],[0,0,1]]);
}

/** Full projective frame → source map, shared by GPU, masks and eyedropper. */
export function geometryMatrix(c: Crop, W: number, H: number, p?: Perspective | null): Mat3 {
  const [a,b,cc,d,e,f]=cropAffine(c,W,H);
  return mulMat(perspectiveMap(p,W,H),[[a,b,e],[cc,d,f],[0,0,1]]);
}
export const geometrySourcePoint = (c: Crop, W: number, H: number, u: number, v: number, p?: Perspective | null) => project(geometryMatrix(c,W,H,p),u,v);
export const geometryFramePoint = (c: Crop, W: number, H: number, u: number, v: number, p?: Perspective | null) => project(invert3(geometryMatrix(c,W,H,p)),u,v);
