// SPDX-License-Identifier: GPL-3.0-or-later
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Engine } from '../../src/engine/engine';
import { geometrySourcePoint, PERSPECTIVE_DEFAULTS } from '../../src/engine/perspective';
import { FULL } from '../../src/film/crop';
import { defaultRecipe } from '../../src/film/recipe';
import { activePhoto, editActive, redo, undo, useApp } from '../../src/library/store';
import { Panel } from '../../src/ui/Panel';
import { setWorkspace } from '../../src/ui/workspace';
import '../../src/styles.css';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const pause = () => new Promise(r=>setTimeout(r,100));
const waitFor = async (test: ()=>boolean) => { for(let i=0;i<30;i++) { if(test()) return; await pause(); } throw Error('Timed out'); };
let complete: ((p: unknown)=>void) | null=null;
let lastHeaders: Record<string,string>={};
const saved: any[]=[];
(window as any).__TAURI_INTERNALS__={invoke:async(cmd: string,args:any,opts:any)=>{
  if(cmd==='thumbnail') throw Error('No embedded thumbnail');
  if(cmd==='camera_profiles'||cmd==='list_presets'||cmd==='custom_looks') return [];
  if(cmd==='photo_exposure') return {focalLength:23,focalLength35:35};
  if(cmd==='write_sidecar') {saved.push(args.saved);return;}
  if(cmd==='load_image') {
    const buffer=new ArrayBuffer(32+64*48*8), view=new DataView(buffer);
    [64,48,1,0,0,0,64,48].forEach((v,i)=>view.setUint32(i*4,v,true));
    new Uint16Array(buffer,32).fill(0x3800);
    return buffer;
  }
  if(cmd==='auto_perspective') {
    lastHeaders=opts.headers;
    assert(args instanceof Uint8Array && args.length===64*48*4,'IPC must send binary pixels');
    return new Promise(resolve=>{complete=resolve;});
  }
}};

async function gpuCheck() {
  const W=160,H=100, canvas=document.createElement('canvas'); canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d')!, pixels=new Uint8ClampedArray(W*H*4);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) {const i=(y*W+x)*4;pixels[i]=32+192*x/(W-1);pixels[i+1]=32+192*y/(H-1);pixels[i+2]=128;pixels[i+3]=255;}
  ctx.putImageData(new ImageData(pixels,W,H),0,0);
  const engine=new Engine(document.createElement('canvas')), src=engine.sourceFromImage(canvas,W,H);
  const crop={...FULL,x:.1,y:.1,w:.8,h:.8,angle:3};
  const transform={...PERSPECTIVE_DEFAULTS,vertical:18,horizontal:-12,rotation:3};
  const recipe={...defaultRecipe(),crop,transform};
  const out=engine.readPixels(src,recipe,128,80,0);
  let worst=0;
  for(let y=3;y<77;y+=7) for(let x=3;x<125;x+=7) {
    const [u,v]=geometrySourcePoint(crop,W,H,(x+.5)/128,(y+.5)/80,transform);
    const i=(y*128+x)*4;
    worst=Math.max(worst,Math.abs(out[i]-(32+192*(u*W-.5)/(W-1))),Math.abs(out[i+1]-(32+192*(v*H-.5)/(H-1))));
  }
  assert(worst<2,`GPU projective sampling differs from CPU by ${worst}`);
  // Force source-space analysis taps, then change only geometry. Cached maps
  // must stay in source coordinates and render identically to a fresh engine.
  const detail={...recipe,texture:15,clarity:12,sharpen:20};
  engine.readPixels(src,detail,128,80,0);
  const next={...detail,transform:{...transform,vertical:-15}};
  const cached=engine.readPixels(src,next,128,80,0);
  const fresh=new Engine(document.createElement('canvas')), freshSrc=fresh.sourceFromImage(canvas,W,H);
  const expected=fresh.readPixels(freshSrc,next,128,80,0);
  assert(cached.every((v,i)=>Math.abs(v-expected[i])<=1),'Geometry corrupted source-space analysis or cached maps');
  assert(engine.gpu.gl.getError()===engine.gpu.gl.NO_ERROR,'WebGL error');
  engine.release(src);engine.dispose();fresh.release(freshSrc);fresh.dispose();
  return worst;
}

const photo={path:'/perspective.jpg',name:'Perspective.jpg',rel:'Perspective.jpg',size:1,modified:1,recipe:defaultRecipe(),seed:1,white:null,rating:0,label:null,heart:false,raw:false,pair:null};
useApp.setState({photos:[photo,{...photo,path:'/other.jpg'}],active:0,selected:new Set([photo.path]),view:'develop',folder:{root:'/',name:'Test',unreadable:0}});
setWorkspace({layout:'workflow',group:'refine'});
createRoot(document.getElementById('root')!).render(<Panel/>);
const button=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('#section-transform button')].find(b=>b.textContent===text)!;

setTimeout(async()=>{try {
  const worst=await gpuCheck(); await pause();
  assert(!!button('Vertical'),'Transform missing from Refine');
  button('Vertical').click(); await waitFor(()=>!!complete);
  assert(button('Both').disabled,'Automatic correction must disable controls while fitting');
  assert(lastHeaders['x-emulsion-axis']==='vertical','Wrong fit direction');
  assert(JSON.parse(lastHeaders['x-emulsion-perspective']).focalLength===35,'35mm equivalent metadata ignored');
  const result={rotation:2,vertical:15,horizontal:0,focalLength:35};
  complete!(result);complete=null;await pause();
  assert(activePhoto()!.recipe!.transform?.vertical===15,'Automatic correction not applied');
  await waitFor(()=>saved.some(s=>s.recipe?.transform?.vertical===15));
  undo();await pause();assert(!activePhoto()!.recipe!.transform,'Auto correction undo failed');
  redo();await pause();assert(activePhoto()!.recipe!.transform?.vertical===15,'Auto correction redo failed');
  button('Horizontal').click();await waitFor(()=>!!complete);
  editActive(r=>({...r!,transform:null}),'Reset transform');
  complete!(result);complete=null;await pause();
  assert(!activePhoto()!.recipe!.transform,'Stale result overwrote a reset');
  button('Both').click();await waitFor(()=>!!complete);
  useApp.setState({active:1});await pause();complete!(result);complete=null;await pause();
  assert(!activePhoto()!.recipe!.transform,'Result leaked to the next photo');
  await pause();
  assert(saved.some(s=>s.recipe?.transform?.vertical===15),'Transform missing from sidecar save');
  document.body.dataset.result=`PASS: GPU/CPU error ${worst.toFixed(3)} levels, analysis-map cache, auto directions, metadata, undo/redo, sidecar save, stale-result protection`;
}catch(err){document.body.dataset.result=`FAIL: ${String(err)}`;}},300);
