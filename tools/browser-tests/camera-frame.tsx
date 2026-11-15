// SPDX-License-Identifier: GPL-3.0-or-later
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Engine, InputMode } from '../../src/engine/engine';
import { histogram } from '../../src/engine/histogram';
import { FULL } from '../../src/film/crop';
import { defaultRecipe, normalizeRecipe } from '../../src/film/recipe';
import { finishCrop, startCrop, useApp, type Photo } from '../../src/library/store';
import { PhotoTools } from '../../src/ui/PhotoTools';
import '../../src/styles.css';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const wait = () => new Promise(r => setTimeout(r, 50));

async function check() {
  const W = 64, H = 48;
  const engine = new Engine(document.createElement('canvas'));
  const data = new Uint16Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const at = (y * W + x) * 4, middle = y >= 12 && y < 36;
    data.set(middle ? [0x32e9, 0x32e9, 0x32e9, 0x3c00] : [0x3c00, 0, 0, 0x3c00], at);
  }
  const frame = { x: 0, y: .25, w: 1, h: .5 };
  const src = engine.sourceFromHalf({ width: W, height: H, fullWidth: W, fullHeight: H, mode: InputMode.DisplayLinear, white: null, data, frame });
  try {
    const pixels = engine.readPixels(src, null, W, H / 2, 0);
    for (let i = 0; i < pixels.length; i += 4) assert(Math.abs(pixels[i] - 128) < 2 && pixels[i] === pixels[i + 1], 'Camera frame includes outside pixels');
    assert(histogram(pixels).highlightClip === 0, 'Histogram includes clipped pixels outside the camera frame');
    const analysis = engine.readPixels(src, null, W, H, 0, false, undefined, undefined, undefined, FULL);
    assert(analysis[0] > 250 && analysis[1] < 2, 'Full-photo object/sky analysis was cropped');
    const explicit = { ...defaultRecipe('neutral'), crop: FULL };
    const full = engine.readPixels(src, explicit, W, H, 0);
    assert(full[0] > 200 && full[0] > full[1] + 100, `Explicit Full sensor did not reveal the margin: ${full.slice(0, 4)}`);
    const top = { ...explicit, crop: { ...FULL, h: .125 } };
    const topPixels = engine.readPixels(src, top, W, 6, 0);
    assert(topPixels[0] > 200 && topPixels[0] > topPixels[1] + 100, `Explicit crop lost precedence to the camera frame: ${topPixels.slice(0, 4)}`);
    const target = engine.gpu.target(W, H / 2, false);
    try {
      engine.render(src, top, { target, width: W, height: H / 2, seed: 0, frame: { ...FULL, ...frame } });
      const overridden = new Uint8Array(W * H / 2 * 4), gl = engine.gpu.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); gl.readPixels(0, 0, W, H / 2, gl.RGBA, gl.UNSIGNED_BYTE, overridden);
      assert(Math.abs(overridden[0] - overridden[1]) < 2, 'Caller frame did not override recipe crop');
    } finally { engine.gpu.free(target); }
    const asyncPixels = await engine.readPixelsAsync(src, null, W, H / 2, 0);
    assert(asyncPixels.every((v, i) => Math.abs(v - pixels[i]) <= 1), 'Async export uses a different frame');
    const deep = await engine.readPixels16Async(src, null, W, H / 2, 0);
    assert(Math.abs(deep[0] / 257 - 128) < 2 && Math.abs(deep[0] - deep[1]) < 260, '16-bit export uses a different frame');
  } finally { engine.release(src); engine.dispose(); }

  const decodedFrame = { x: 8 / 11662, y: 2221 / 8746, w: 11648 / 11662, h: 4304 / 8746 };
  const photo: Photo = { path: '/camera-frame.raf', rel: 'camera-frame.raf', name: 'camera-frame.raf', size: 1, modified: 1,
    recipe: null, seed: 1, white: null, raw: true, pair: null, rating: 0, label: null, flag: null,
    cameraFrame: { rect: [0, 2216 / 8736, 1, 4304 / 8736], width: 11648, height: 8736, aspect: '65:24', tele: null } };
  useApp.setState({ photos: [photo], active: 0, selected: new Set([photo.path]), view: 'develop',
    developSize: { path: photo.path, W: 11662, H: 8746, frame: decodedFrame } });
  startCrop();
  createRoot(document.getElementById('root')!).render(<div style={{ padding: 24, display: 'grid', gap: 24 }}>
    {[480, 800, 1100].map(width => <div key={width} className="photo-tools-host" style={{ width }}>
      <PhotoTools scale={null} zoomLabel="Fit" onZoom={() => {}} onStep={() => {}} before="off" onBefore={() => {}} ready />
    </div>)}
  </div>);
  await wait();
  assert(useApp.getState().cropEdit?.draft.aspect === 'xpan', 'Camera aspect lock was not detected');
  document.querySelector<HTMLButtonElement>('.crop-ratio-button')!.click(); await wait();
  assert(document.querySelector('.crop-ratio-menu')!.textContent?.includes('As shot: 65:24'), 'Camera aspect hint missing');
  [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(b => b.textContent?.includes('Full sensor'))!.click();
  finishCrop(true); await wait();
  const saved = useApp.getState().photos[0].recipe;
  assert(JSON.stringify(normalizeRecipe(JSON.parse(JSON.stringify(saved)))?.crop) === JSON.stringify(FULL), 'Full sensor does not survive reload');
  startCrop(); await wait();
  document.querySelector<HTMLButtonElement>('[aria-label="Reset crop"]')!.click(); await wait();
  assert(Math.abs(useApp.getState().cropEdit!.draft.h - decodedFrame.h) < 1e-6, 'Reset did not return to camera frame');
  finishCrop(true);
  assert(useApp.getState().photos[0].recipe?.crop === null, 'As shot was saved as a user crop');
  startCrop(); await wait();
  for (const row of document.querySelectorAll<HTMLElement>('.crop-bar')) assert(row.scrollWidth <= row.clientWidth + 1, 'Camera crop bar overflows');
  document.querySelectorAll<HTMLElement>('.photo-tools-host').forEach((host, i) => { if (i < 2) host.style.display = 'none'; });
  document.querySelectorAll<HTMLButtonElement>('.crop-ratio-button')[2].click(); await wait();
  document.body.dataset.result = 'PASS: camera frame precedence, cropped histogram, 8/16-bit export, As shot reset and Full sensor persistence';
}
check().catch(e => { document.body.dataset.result = `FAIL: ${e}`; });
