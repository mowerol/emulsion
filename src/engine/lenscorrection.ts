// Copyright (C) 2019-2026 darktable developers.
// SPDX-License-Identifier: GPL-3.0-or-later
// Port of lens.cc _init_coeffs_md_v2, _interpolate_linear_spline and _process_md
// at darktable 20891f6c. Centered radial profiles, MAXKNOTS=16; bilinear resampling.
import { columnMajor, invert3, mulVec } from './color';
import type { Mat3, Vec3 } from '../film/stocks';

export type EmbeddedCorrection =
  | { kind: 'fuji'; knots: number[]; distortion: number[]; red: number[]; blue: number[]; vignette: number[]; crop: number }
  | { kind: 'sony'; distortion: number[]; red: number[]; blue: number[]; vignette: number[] }
  | { kind: 'olympus'; distortion: number[] | null; ca: number[] | null }
  | { kind: 'dng'; warp: number[][] | null; vignette: number[] | null };
export interface LensMetadata { cameraToWorking?: Mat3 | null; orientation?: number; camera: string; lens: string; correction: EmbeddedCorrection | null; unsupported: string | null }
export interface LensAdjust { enabled: boolean; distortion: boolean; ca: boolean; vignette: boolean; distortionAmount: number; redAmount: number; blueAmount: number; vignetteAmount: number }
export const LENS_DEFAULTS: LensAdjust = { enabled: true, distortion: true, ca: true, vignette: true, distortionAmount: 1, redAmount: 1, blueAmount: 1, vignetteAmount: 1 };
export function normalizeLens(input: unknown): LensAdjust | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>, out = { ...LENS_DEFAULTS };
  for (const key of ['enabled', 'distortion', 'ca', 'vignette'] as const) if (typeof o[key] === 'boolean') out[key] = o[key];
  for (const key of ['distortionAmount', 'redAmount', 'blueAmount', 'vignetteAmount'] as const) if (typeof o[key] === 'number' && Number.isFinite(o[key])) out[key] = Math.max(0, Math.min(2, o[key]));
  return Object.keys(out).some(k => out[k as keyof LensAdjust] !== LENS_DEFAULTS[k as keyof LensAdjust]) ? out : null;
}
export function lensSupport(c: EmbeddedCorrection) {
  if (c.kind === 'olympus') return { distortion: !!c.distortion?.slice(0,3).some(v=>v!==0), ca: !!c.ca?.some(v=>v!==0), vignette: false };
  if (c.kind === 'dng') return { distortion: !!c.warp, ca: false, vignette: !!c.vignette };
  return { distortion: true, ca: true, vignette: true };
}
export function spline(knots: number[], values: number[], x: number): number {
  if (x < knots[0]) return values[0];
  for (let i = 1; i < knots.length; i++) if (x >= knots[i-1] && x <= knots[i]) return values[i-1] + (x-knots[i-1]) * (values[i]-values[i-1]) / (knots[i]-knots[i-1]);
  return values[values.length-1];
}
export interface LensSpline { knots: number[]; factors: Vec3[]; vigKnots: number[]; vig: number[] }
export function lensSpline(c: EmbeddedCorrection, width: number, height: number, settings: LensAdjust | null = null): LensSpline | null {
  const p = settings ?? LENS_DEFAULTS;
  if (!p.enabled) return null;
  const support = lensSupport(c);
  const dist = p.distortion && support.distortion, ca = p.ca && support.ca, vignette = p.vignette && support.vignette;
  if (!dist && !ca && !vignette) return null;
  const n = c.kind === 'sony' ? c.distortion.length : 16;
  const knots: number[] = [], factors: Vec3[] = [], vigKnots: number[] = [], vig: number[] = [];
  if (c.kind === 'fuji') {
    const ki = c.knots.map(k => k*c.crop), di = c.distortion.map(v => 1+p.distortionAmount*v/100), ri = c.red.map(v => p.redAmount*v), bi = c.blue.map(v => p.blueAmount*v);
    vigKnots.push(...ki); vig.push(...c.vignette.map(v => vignette ? 1-p.vignetteAmount*(1-v/100) : 1));
    if (ki[0] > 0) { ki.unshift(0); di.unshift(1); ri.unshift(0); bi.unshift(0); vigKnots.unshift(0); vig.unshift(1); }
    for (let i=0;i<n;i++) {
      const rin=i/(n-1), m=spline(ki,di,rin), d=dist?m:1;
      knots.push(rin/m);
      factors.push([d*(ca?1+spline(ki,ri,rin):1),d,d*(ca?1+spline(ki,bi,rin):1)]);
    }
  } else for (let i=0;i<n;i++) {
    const r=c.kind==='sony'?(i+0.5)/(n-1):i/(n-1), r2=r*r;
    knots.push(r);vigKnots.push(r);
    let f:Vec3=[1,1,1], v=1;
    if (c.kind==='sony') {
      const d=dist?1+p.distortionAmount*c.distortion[i]*2**-14:1;
      f=[d*(ca?1+p.redAmount*c.red[i]*2**-21:1),d,d*(ca?1+p.blueAmount*c.blue[i]*2**-21:1)];
      if(vignette) v=2**(0.5-2**(p.vignetteAmount*c.vignette[i]*2**-13-1));
    } else if (c.kind==='olympus') {
      const [k2,k4,k6,rs]=c.distortion??[0,0,0,1], rs2=(r*rs)**2;
      const d=dist?1+p.distortionAmount*(rs*(1+rs2*(k2+rs2*(k4+rs2*k6)))-1):1;
      f=[d,d,d];
      if(ca && c.ca && r>0) {const [a,b,c4,d0,e,f4]=c.ca, rd=d*r, rd2=rd*rd;f[0]+=p.redAmount*rd*(a+rd2*(b+rd2*c4))/r;f[2]+=p.blueAmount*rd*(d0+rd2*(e+rd2*f4))/r;}
    } else if(c.kind==='dng') {
      const poly=(a:number[])=>a[0]+r2*(a[1]+r2*(a[2]+r2*a[3]));
      // darktable's DNG warp combines geometry and per-plane colour alignment and
      // exposes one strength (not independent red/blue CA fine tuning).
      if(dist && c.warp) f=[0,1,2].map(channel=>1+p.distortionAmount*(poly(c.warp![c.warp!.length===3?channel:0])-1)) as Vec3;
      if(vignette && c.vignette) {const a=c.vignette;const dv=r2*(a[0]+r2*(a[1]+r2*(a[2]+r2*(a[3]+r2*a[4]))));v=1/(1+p.vignetteAmount*dv);}
    }
    factors.push(f);vig.push(v);
  }
  // Invalid or folded radial mappings must not enter shader uniforms.
  if (knots.some((v,i)=>!Number.isFinite(v)||(i>0&&v<=knots[i-1])) || factors.some(f=>f.some(v=>!Number.isFinite(v)||v<=0)) || vig.some(v=>!Number.isFinite(v)||v<=0)) return null;
  if (factors.every(f=>f.every(v=>v===1)) && vig.every(v=>v===1)) return null;
  const columns=[0,1,2].map(j=>factors.map(f=>f[j]));
  const srr=Math.min(width,height)/Math.hypot(width,height);
  let scale=0;
  for(let i=0;i<200;i++) for(let c=0;c<3;c++) scale=Math.max(scale,spline(knots,columns[c],srr+(1-srr)*i/199));
  return {knots:knots.map(k=>k*scale),factors:factors.map(f=>f.map(v=>v/scale) as Vec3),vigKnots,vig};
}
export function lensUniforms(l: LensSpline) {
  const pad=(v:number[],size:number)=>[...v,...Array(Math.max(0,size-v.length)).fill(v[v.length-1])];
  return {uLensCount:l.knots.length,uLensVigCount:l.vig.length,uLensKnots:pad(l.knots,16),uLensFactors:Array.from({length:16},(_,i)=>l.factors[Math.min(i,l.factors.length-1)]).flat(),uLensVigKnots:pad(l.vigKnots,16),uLensVig:pad(l.vig,16)};
}
/** The integer-pixel centre used upstream, transformed with EXIF orientation, then expressed
 * in texture coordinates. Full sensor dimensions keep the centre invariant across preview scales. */
export function lensCenter(orientation: number, fullW: number, fullH: number): [number, number] {
  const offsets = [[0.5,0.5],[0.5,0.5],[-0.5,0.5],[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,0.5],[-0.5,-0.5],[0.5,-0.5]];
  const [x,y]=offsets[orientation]??offsets[1];
  return [0.5+x/fullW,0.5+y/fullH];
}
/** Output UV to source UV for one channel. */
export function lensSample(uv:[number,number],width:number,height:number,l:LensSpline,channel:number,center:[number,number]=lensCenter(1,width,height)) {
  const q=[(uv[0]-center[0])*width,(uv[1]-center[1])*height], r=Math.hypot(...q)/Math.hypot(width/2,height/2);
  const f=spline(l.knots,l.factors.map(v=>v[channel]),r);
  const source:[number,number]=[center[0]+q[0]*f/width,center[1]+q[1]*f/height];
  return source;
}

/** CPU reference for the correction pass: RGBA scene-linear pixels, bilinear sampling with
 * source-space vignetting on each tap, matching _process_md's operation order. */
export function lensCorrectPixels(pixels: Float32Array, width: number, height: number, l: LensSpline, center: [number, number] = lensCenter(1, width, height), cameraToWorking: Mat3 = [[1,0,0],[0,1,0],[0,0,1]]): Float32Array {
  const toCamera = invert3(cameraToWorking);
  const out = new Float32Array(pixels.length);
  const pixel = (x: number, y: number, c: number) => {
    x = Math.max(0, Math.min(width-1, x)); y = Math.max(0, Math.min(height-1, y));
    const radius = Math.hypot(x+0.5-center[0]*width,y+0.5-center[1]*height)/Math.hypot(width/2,height/2);
    const i=(y*width+x)*4;
    return mulVec(toCamera,[pixels[i],pixels[i+1],pixels[i+2]])[c]/Math.max(1e-4,spline(l.vigKnots,l.vig,radius));
  };
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    for(let c=0;c<3;c++) {
      const [u,v]=lensSample([(x+0.5)/width,(y+0.5)/height],width,height,l,c,center);
      const sx=u*width-0.5,sy=v*height-0.5,a=Math.floor(sx),b=Math.floor(sy),fx=sx-a,fy=sy-b;
      const top=pixel(a,b,c)*(1-fx)+pixel(a+1,b,c)*fx, bottom=pixel(a,b+1,c)*(1-fx)+pixel(a+1,b+1,c)*fx;
      out[(y*width+x)*4+c]=top*(1-fy)+bottom*fy;
    }
    const i=(y*width+x)*4;
    const working=mulVec(cameraToWorking,[out[i],out[i+1],out[i+2]]);
    working.forEach((v,c)=>out[i+c]=Math.max(0,v));
    out[i+3]=1;
  }
  return out;
}


/** Chromatic aberration acts on camera channels, before input colour conversion upstream. */
export function lensColourUniforms(metadata: LensMetadata) {
  const m=metadata.cameraToWorking??[[1,0,0],[0,1,0],[0,0,1]];
  return {uLensToCamera:columnMajor(invert3(m)),uLensFromCamera:columnMajor(m)};
}
