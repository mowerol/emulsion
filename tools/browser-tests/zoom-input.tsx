// SPDX-License-Identifier: GPL-3.0-or-later
// Actual Develop and Loupe wheel/pinch wiring, anchoring, pan and limits; native photo IPC mocked.
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { InputMode } from '../../src/engine/params';
import { defaultRecipe } from '../../src/film/recipe';
import { NO_FILTER } from '../../src/library/filter';
import { useApp, type Photo } from '../../src/library/store';
import { Develop } from '../../src/ui/Develop';
import { DevelopClient } from '../../src/ui/developclient';
import { LibraryLoupe } from '../../src/ui/LibraryLoupe';
import { setZoomSensitivity } from '../../src/ui/zoomsettings';
import '../../src/styles.css';

const W = 2400, H = 1600;
const wait = (ms = 40) => new Promise(r => setTimeout(r, ms));
function assert(ok: unknown, why: string): asserts ok { if (!ok) throw Error(why); }
async function until(test: () => unknown, why: string) {
  for (let i = 0; i < 200; i++) { if (test()) return; await wait(); }
  throw Error(why);
}
function payload() {
  const bytes = new ArrayBuffer(32 + 300 * 200 * 8), header = new DataView(bytes);
  [300, 200, InputMode.SceneLinear, 0, 0, 0, W, H].forEach((v, i) => header.setUint32(i * 4, v, true));
  const values = new Uint16Array(bytes, 32);
  for (let i = 0; i < values.length; i += 4) values.set([0x3400, 0x3400, 0x3400, 0x3c00], i);
  return bytes;
}

async function main() {
  let frame: Parameters<DevelopClient['render']>[0] | null = null;
  const render = DevelopClient.prototype.render;
  DevelopClient.prototype.render = function (state) { frame = state; return render.call(this, state); };
  const image = document.createElement('canvas'); image.width = W; image.height = H;
  image.getContext('2d')!.fillRect(0, 0, W, H);
  const jpeg = await (await new Promise<Blob>(r => image.toBlob(b => r(b!), 'image/jpeg'))).arrayBuffer();
  mockIPC(async command => {
    if (command === 'load_image') return payload();
    if (command === 'thumbnail' || command === 'cull_preview') return jpeg.slice(0);
    if (command === 'plugin:event|listen') return 1;
    return null;
  });
  const photo: Photo = { path: '/zoom.raf', name: 'zoom.raf', rel: 'zoom.raf', size: 1, modified: 1,
    recipe: defaultRecipe('neutral', 'straight'), seed: 1, white: null, rating: 0, label: null, flag: null, raw: true, pair: null };
  useApp.setState({ photos: [photo], active: 0, selected: new Set([photo.path]), filter: NO_FILTER, source: null, view: 'develop' });
  const root = createRoot(document.getElementById('root')!);
  for (const mode of ['develop', 'loupe']) {
    root.render(<StrictMode>{mode === 'develop' ? <Develop /> : <LibraryLoupe />}</StrictMode>);
    await until(() => mode === 'develop' ? useApp.getState().developSize?.path === photo.path : document.querySelector('.cull-image-window img'), `${mode}: not ready`);
    await wait(200);
    const stage = document.querySelector<HTMLElement>(mode === 'develop' ? '.stage-box' : '.cull-image-stage')!;
    const scale = () => mode === 'develop'
      ? Number(document.querySelector('.tool-zoom-value span')!.textContent!.replace('%', '')) / 100
      : parseFloat(document.querySelector<HTMLImageElement>('.cull-image-window img')!.style.width) * devicePixelRatio / W;
    const at100 = async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '0', metaKey: true, bubbles: true, cancelable: true })); await wait();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true })); await wait();
      assert(Math.abs(scale() - 1) < 0.01, `${mode}: 100% shortcut`);
    };
    const point = () => {
      const r = stage.getBoundingClientRect();
      return { clientX: r.left + r.width * 0.6, clientY: r.top + r.height * 0.4 };
    };
    const wheel = async (init: WheelEventInit) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...point(), ...init });
      stage.dispatchEvent(event); assert(event.defaultPrevented, `${mode}: browser zoom not prevented`); await wait();
    };
    for (const [deltaMode, deltaY] of [[0, -32], [1, -2], [2, -32 / stage.clientHeight]]) {
      await at100(); setZoomSensitivity(0.2);
      await wheel({ ctrlKey: true, deltaY, deltaMode });
      assert(Math.abs(scale() - Math.exp(0.064)) < 0.011, `${mode}: normalized units ${deltaMode}, got ${scale()}`);
    }
    await at100(); setZoomSensitivity(2);
    await wheel({ metaKey: true, deltaY: -32 });
    assert(Math.abs(scale() - Math.exp(0.64)) < 0.011, `${mode}: faster Command-scroll`);
    await at100(); setZoomSensitivity(0.5);
    const gesture = async (type: string, scale = 1) => {
      const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { scale, ...point() });
      stage.dispatchEvent(event); assert(event.defaultPrevented, `${mode}: pinch default`); await wait();
    };
    await gesture('gesturestart'); await gesture('gesturechange', 1.44); await gesture('gesturechange', 2.25);
    assert(Math.abs(scale() - 1.5) < 0.011, `${mode}: cumulative pinch`);
    await gesture('gestureend');
    const sample = () => {
      if (mode === 'loupe') {
        const img = document.querySelector<HTMLImageElement>('.cull-image-window img')!;
        const r = img.getBoundingClientRect(), p = point();
        return [(p.clientX - r.left) / r.width, (p.clientY - r.top) / r.height];
      }
      assert(frame, 'Develop: missing frame');
      const r = document.querySelector('canvas.view')!.getBoundingClientRect(), p = point(), v = frame.view;
      return [v.x + (p.clientX - r.left) / r.width * v.w, v.y + (p.clientY - r.top) / r.height * v.h];
    };
    const before = sample();
    await wheel({ ctrlKey: true, deltaY: -32 });
    const after = sample();
    assert(before.every((v, i) => Math.abs(v - after[i]) < 0.001), `${mode}: pointer anchor moved`);
    await wheel({ deltaX: 16, deltaY: 16 });
    const panned = sample();
    assert(after.every((v, i) => Math.abs(v - panned[i]) > 0.001), `${mode}: plain wheel did not pan both axes`);
    await wheel({ ctrlKey: true, deltaY: -10000 }); assert(scale() === 8, `${mode}: upper limit`);
    await wheel({ ctrlKey: true, deltaY: 10000 }); assert(Math.abs(scale() - 0.05) < 0.001, `${mode}: lower limit`);
  }
  root.unmount();
  DevelopClient.prototype.render = render;
  document.body.dataset.result = 'PASS: Develop and Loupe units, sensitivity, Command/Control zoom, native pinch, anchor, pan and limits';
}
main().catch(error => { document.body.dataset.result = `FAIL: ${error.stack ?? error}`; });
