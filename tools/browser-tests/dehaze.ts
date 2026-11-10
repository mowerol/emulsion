// SPDX-License-Identifier: GPL-3.0-or-later
// Haze removal on a scene-linear source: no WebGL errors, strength changes reuse the module's
// input and ambient light, and export cleanup frees the maps. Accuracy against src/engine/dehaze.ts is the probe's out.dehaze.
import { Engine, InputMode } from '../../src/engine/engine';
import { defaultRecipe } from '../../src/film/recipe';

const assert=(ok: unknown, why: string)=>{if(!ok) throw Error(why);};
(window as any).__TAURI_INTERNALS__={invoke: async (cmd: string)=>{
  throw Error(`Unexpected IPC ${cmd}`);
}};

async function check() {
  const W=64,H=48, canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const pixels=new Uint8ClampedArray(W*H*4);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) {
    const i=(y*W+x)*4;
    pixels[i]=65+100*x/(W-1);pixels[i+1]=75+80*y/(H-1);pixels[i+2]=100+50*((x+y)%9)/8;pixels[i+3]=255;
  }
  canvas.getContext('2d')!.putImageData(new ImageData(pixels,W,H),0,0);
  const eng=new Engine(document.createElement('canvas'));
  const camera={make:'Test',model:'Camera',cameraToWorking:[[1,0,0],[0,1,0],[0,0,1]],neutral:[1,1,1],baselineGain:1};
  const a=eng.sourceFromImage(canvas,W,H);
  Object.assign(a,{mode:InputMode.SceneLinear,camera});
  let builds=0;
  const draw=eng.gpu.draw.bind(eng.gpu);
  eng.gpu.draw=(...args: Parameters<typeof draw>)=>{if(args[0]===(eng as any).dehazeP) builds++;return draw(...args);};
  const develop=(eng as any).develop.handle;
  assert(eng.gpu.gl.getUniformLocation(develop,'uDehazeTex')!==null,'Haze removal sampler missing');
  const recipe={...defaultRecipe(),dehaze:40};
  await eng.prepare(recipe);
  const plain=eng.readPixels(a,{...recipe,dehaze:0},W,H,0);
  let moved=0;
  for(const dehaze of [40,75,-30]) {
    const actual=eng.readPixels(a,{...recipe,dehaze},W,H,0);
    assert(actual.some((v,i)=>i%4<3&&v>20),'Dehaze draw produced a blank image');
    actual.forEach((v,i)=>{moved=Math.max(moved,Math.abs(v-plain[i]));});
    assert(eng.gpu.gl.getError()===eng.gpu.gl.NO_ERROR,'Dehaze draw raised a WebGL error');
  }
  assert(moved>2,`Dehaze changed the image by only ${moved} levels`);
  // The ambient light (once) and the module's input (once): strength changes reuse both.
  assert(builds===2,`Changing strength remade the input ${builds} times`);
  const map=(eng as any).L.dh.s1.tex;
  eng.dropBuffers(W,H);
  assert(!eng.gpu.gl.isTexture(map),'Export cleanup retained the full-sized haze removal maps');
  eng.release(a);eng.dispose();
  document.body.dataset.result=`PASS: dehaze without WebGL errors (moves ${moved} levels), slider cache reuse, export buffer cleanup`;
}
check().catch(err=>{document.body.dataset.result=`FAIL: ${String(err)}`;});
