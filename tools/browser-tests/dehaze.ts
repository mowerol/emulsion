// SPDX-License-Identifier: GPL-3.0-or-later
// Compare cached dehaze with the previous on-demand shader, including an active
// DCP profile, and check that strength changes reuse the source's dark channel.
import { Engine, InputMode } from '../../src/engine/engine';
import { SHADERS } from '../../src/engine/shaders';
import { defaultRecipe } from '../../src/film/recipe';
import syntheticDcp from '../../src/engine/fixtures/synthetic.dcp?url';

const assert=(ok: unknown, why: string)=>{if(!ok) throw Error(why);};
const id='a'.repeat(64);
(window as any).__TAURI_INTERNALS__={invoke: async (cmd: string)=>{
  if(cmd==='camera_profiles') return [{id,name:'Camera Standard',camera:'Test Camera',copyright:'Test'}];
  if(cmd==='read_camera_profile') return (await fetch(syntheticDcp)).arrayBuffer();
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
  const cached=new Engine(document.createElement('canvas')), legacy=new Engine(document.createElement('canvas'));
  const originalDark=`float dehazeDark(vec2 p) {
    vec2 texel = 1.0 / vec2(textureSize(uSrc, 0));
    float dark = 1.0;
    for (int y = -4; y <= 4; y++) for (int x = -4; x <= 4; x++) {
      vec3 c = max(stageInput(texture(uSrc, clamp(p + vec2(x, y) * texel, 0.0, 1.0))), vec3(0.0));
      dark = min(dark, min(c.r, min(c.g, c.b)));
    }
    return dark;
  }`;
  const oldShader=SHADERS.develop.replace('float dehazeDark(vec2 p) { return texture(uDehazeTex, p).r; }',originalDark);
  assert(oldShader!==SHADERS.develop,'Legacy reference replacement failed');
  (legacy as any).develop=legacy.gpu.program(SHADERS.vertex,oldShader);
  const camera={make:'Test',model:'Camera',cameraToWorking:[[1,0,0],[0,1,0],[0,0,1]],neutral:[1,1,1],baselineGain:1};
  const a=cached.sourceFromImage(canvas,W,H),b=legacy.sourceFromImage(canvas,W,H);
  Object.assign(a,{mode:InputMode.SceneLinear,camera});Object.assign(b,{mode:InputMode.SceneLinear,camera});
  let builds=0;
  const draw=cached.gpu.draw.bind(cached.gpu);
  cached.gpu.draw=(...args: Parameters<typeof draw>)=>{if(args[0]===(cached as any).dehazeP) builds++;return draw(...args);};
  const develop=(cached as any).develop.handle;
  assert(cached.gpu.gl.getUniformLocation(develop,'uDcpCal')===null,'Calibration sampler unexpectedly active in develop');
  assert(cached.gpu.gl.getUniformLocation(develop,'uDehazeTex')!==null,'Dark-channel sampler missing');
  const recipe={...defaultRecipe(),profile:`dcp:${id}` as const,dehaze:40};
  await cached.prepare(recipe,a.camera);await legacy.prepare(recipe,b.camera);
  let worst=0;
  for(const dehaze of [40,75,-30]) {
    const r={...recipe,dehaze};
    const actual=cached.readPixels(a,r,W,H,0),expected=legacy.readPixels(b,r,W,H,0);
    assert(actual.some((v,i)=>i%4<3&&v>20),'DCP/dehaze draw produced a blank image');
    actual.forEach((v,i)=>{worst=Math.max(worst,Math.abs(v-expected[i]));});
    assert(cached.gpu.gl.getError()===cached.gpu.gl.NO_ERROR,'DCP and dehaze conflict on the GPU');
    assert(legacy.gpu.gl.getError()===legacy.gpu.gl.NO_ERROR,'Legacy reference failed');
  }
  assert(worst<=2,`Cached dehaze differs from on-demand shader by ${worst} levels`);
  assert(builds===1,`Changing strength rebuilt the dark channel ${builds} times`);
  const map=(cached as any).dehazeMade.out.tex;
  cached.dropBuffers(W,H);
  assert(!cached.gpu.gl.isTexture(map),'Export cleanup retained the full-sized dark-channel map');
  cached.release(a);cached.dispose();legacy.release(b);legacy.dispose();
  document.body.dataset.result=`PASS: cached/on-demand error ${worst} levels, DCP+dehaze without WebGL errors, slider cache reuse, export buffer cleanup`;
}
check().catch(err=>{document.body.dataset.result=`FAIL: ${String(err)}`;});
