// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { HEADER_BYTES, parsePayload } from './api';

describe('image payload', () => {
  it('parses the header and pixel view', () => {
    const w = 3, h = 2;
    const buf = new ArrayBuffer(HEADER_BYTES + w * h * 8);
    const dv = new DataView(buf);
    dv.setUint32(0, w, true);
    dv.setUint32(4, h, true);
    dv.setUint32(8, 0, true);
    new Uint16Array(buf, HEADER_BYTES)[0] = 0x3c00;
    const img = parsePayload(buf);
    expect([img.width, img.height, img.mode]).toEqual([3, 2, 0]);
    expect(img.data.length).toBe(w * h * 4);
    expect(img.data[0]).toBe(0x3c00);
  });

  it('rejects truncated payloads', () => {
    const buf = new ArrayBuffer(HEADER_BYTES + 8);
    const dv = new DataView(buf);
    dv.setUint32(0, 4, true);
    dv.setUint32(4, 4, true);
    expect(() => parsePayload(buf)).toThrow(/expected/);
    expect(() => parsePayload(new ArrayBuffer(4))).toThrow(/short/);
  });
});

it('reads aligned lens metadata without shifting the half-float pixels, and rejects truncation', () => {
  const meta = { camera: 'Camera', lens: 'Lens', correction: null, unsupported: null };
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const offset = Math.ceil((HEADER_BYTES+4+json.length)/4)*4;
  const buf = new ArrayBuffer(offset+8), view = new DataView(buf);
  view.setUint32(0,1,true);view.setUint32(4,1,true);view.setUint32(8,2,true);view.setUint32(12,2,true);
  view.setUint32(HEADER_BYTES,json.length,true);new Uint8Array(buf,HEADER_BYTES+4,json.length).set(json);
  new Uint16Array(buf,offset)[0]=0x3c00;
  expect(parsePayload(buf).lens).toEqual(meta);
  expect(parsePayload(buf).data[0]).toBe(0x3c00);
  view.setUint32(HEADER_BYTES,1_048_577,true);
  expect(()=>parsePayload(buf)).toThrow(/metadata length/);
});

it('reads camera metadata independently of lens support, including combined payloads', () => {
  const camera={make:'Test',model:'Camera',cameraToWorking:[[1,0,0],[0,1,0],[0,0,1]],neutral:[.5,1,.7],baselineGain:1.8};
  for(const lens of [null,{camera:'Test Camera',lens:'Lens',correction:null,unsupported:null}]){
    const blocks=[...(lens?[JSON.stringify(lens)]:[]),JSON.stringify(camera)].map(s=>new TextEncoder().encode(s));
    const total=blocks.reduce((n,b)=>Math.ceil((n+4+b.length)/4)*4,HEADER_BYTES);
    const bytes=new ArrayBuffer(total+8),d=new DataView(bytes);d.setUint32(0,1,true);d.setUint32(4,1,true);d.setUint32(8,2,true);d.setUint32(12,lens?6:4,true);
    let offset=HEADER_BYTES;for(const b of blocks){d.setUint32(offset,b.length,true);new Uint8Array(bytes,offset+4,b.length).set(b);offset=Math.ceil((offset+4+b.length)/4)*4;}
    new Uint16Array(bytes,total)[0]=0x3c00;
    expect(parsePayload(bytes).camera).toEqual(camera);expect(parsePayload(bytes).lens).toEqual(lens);expect(parsePayload(bytes).data[0]).toBe(0x3c00);
  }
});
