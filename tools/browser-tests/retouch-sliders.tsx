// SPDX-License-Identifier: GPL-3.0-or-later
// Real workspace: opening an empty retouch tool must not slow unrelated slider edits,
// including after the tool is put down. Use the real-time Metal browser runner.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Engine, InputMode } from '../../src/engine/engine';
import { defaultRecipe } from '../../src/film/recipe';
import { useApp } from '../../src/library/store';
import { Develop } from '../../src/ui/Develop';
import { Panel } from '../../src/ui/Panel';
import { setWorkspace } from '../../src/ui/workspace';
import { chooseTool } from '../../src/ui/tools';
import '../../src/styles.css';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const full = [6000, 4000];
const loads: number[] = [];
const payload = (w: number, h: number) => {
  const bytes = new ArrayBuffer(32 + w * h * 8);
  const header = new DataView(bytes);
  [w, h, InputMode.SceneLinear, 0, 0, 0, ...full].forEach((v, i) => header.setUint32(i * 4, v, true));
  const px = new Uint16Array(bytes, 32);
  for (let i = 0; i < w * h; i++) px.set([0x3000 + i % 1024, 0x3400, 0x2c00, 0x3c00], 4 * i);
  return bytes;
};
window.createImageBitmap = (async () => Object.assign(document.createElement('canvas'), { close() {} })) as typeof createImageBitmap;
(window as any).__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command: string, args: any) => {
  if (command === 'thumbnail') throw Error('No camera preview');
  if (command === 'load_image') {
    loads.push(args.maxEdge);
    return args.maxEdge === 2560 ? payload(2560, 1707) : payload(...full as [number, number]);
  }
  if (command === 'plugin:event|listen') return 1;
  if (command === 'camera_profiles') return [];
} };

type Draw = { exposure: number | undefined; source: string; output: string; ms: number };
const draws: Draw[] = [];
const render = Engine.prototype.render;
Engine.prototype.render = function (src, recipe, opts) {
  const start = performance.now();
  render.call(this, src, recipe, opts);
  if (opts.target === 'screen') {
    const gl = this.gpu.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    draws.push({ exposure: recipe?.exposure, source: `${src.w}x${src.h}`, output: `${opts.width}x${opts.height}`, ms: performance.now() - start });
  }
};

function setRange(input: HTMLInputElement, value: number) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function drag() {
  const input = document.getElementById('slider-exposure') as HTMLInputElement;
  assert(input, 'Exposure control missing');
  const times: number[] = [];
  const startDraw = draws.length;
  for (let i = 0; i < 16; i++) {
    const value = (i % 8 - 4) / 10;
    const start = performance.now();
    setRange(input, value);
    let n = 0;
    do { await frame(); assert(++n < 180, `Slider did not reach the screen: input=${input.value}, recipe=${useApp.getState().photos[0].recipe?.exposure}, last=${JSON.stringify(draws.at(-1))}`); }
    while (draws.at(-1)?.exposure !== value);
    times.push(performance.now() - start);
  }
  const recent = draws.slice(startDraw);
  return {
    medianMs: +times.sort((a, b) => a - b)[Math.floor(times.length / 2)].toFixed(1),
    renderMs: +(recent.reduce((sum, d) => sum + d.ms, 0) / recent.length).toFixed(1),
    draws: recent.length, last: recent.at(-1),
    stage: document.querySelector('.stage-box')!.getBoundingClientRect().toJSON(),
  };
}

async function main() {
  const recipe = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 0, grain: 0, color: { hue: Array(8).fill(0), sat: [30, 0, 0, 0, 0, 0, 0, 0], bright: Array(8).fill(0) } };
  const photo = { path: '/retouch-sliders.ORF', name: 'retouch-sliders.ORF', rel: 'retouch-sliders.ORF', size: 1, modified: 0, recipe, seed: 1, white: null, rating: 0, label: null, heart: false, raw: true, pair: null };
  setWorkspace({ group: 'develop' });
  useApp.setState({ photos: [photo], active: 0, view: 'develop', selected: new Set([photo.path]) });
  createRoot(document.getElementById('root')!).render(<div className="workspace workspace-workflow" style={{ height: '100%', width: '100%' }}>
    <aside className="images-pane" /><main className="main"><Develop /></main><Panel />
  </div>);
  for (let i = 0; i < 100 && !draws.length; i++) await wait(50);
  assert(draws.length, 'Photo never rendered');
  await wait(500);
  const before = await drag();
  chooseTool('heal'); await wait(500);
  assert(document.querySelector('.retouch-overlay'), 'Empty retouch tool did not open');
  const opened = await drag();
  chooseTool('select'); await wait(500);
  const closed = await drag();
  const result = { before, opened, closed, loads };
  document.body.dataset.measurements = JSON.stringify(result);
  assert(opened.medianMs <= Math.max(before.medianMs * 1.5, before.medianMs + 15), `Opening empty retouch slows sliders: ${JSON.stringify(result)}`);
  assert(closed.medianMs <= Math.max(before.medianMs * 1.5, before.medianMs + 15), `Closing retouch leaves sliders slow: ${JSON.stringify(result)}`);
  assert(loads.every(edge => edge === 2560), `Empty retouch triggered a full decode: ${JSON.stringify(result)}`);
  document.body.dataset.result = `PASS: ${JSON.stringify(result)}`;
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)}`; });
