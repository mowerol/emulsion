// SPDX-License-Identifier: GPL-3.0-or-later
import { Engine, InputMode } from '../../src/engine/engine';
import { heights, histogram } from '../../src/engine/histogram';
import { defaultRecipe } from '../../src/film/recipe';
import { toneForward } from '../../src/engine/tone';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };

function check() {
  const W = 32, H = 16;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const engine = new Engine(canvas);
  const data = new Uint16Array(W * H * 4);
  // Display-linear sRGB 0.216 (half-float 0x32e9) encodes to middle gray, 128.
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 0x32e9;
    data[i + 3] = 0x3c00;
  }
  const src = engine.sourceFromHalf({ width: W, height: H, fullWidth: W, fullHeight: H,
    mode: InputMode.DisplayLinear, white: null, data });
  const base = { ...defaultRecipe(), grain: 0 };
  const errors: string[] = [];
  const test = (f: () => void) => { try { f(); } catch (e) { errors.push(String(e)); } };
  try {
    const px = engine.readPixels(src, base, W, H, 0);
    const mid = histogram(px);
    const mean = mid.l.reduce((sum, n, i) => sum + n * i, 0) / mid.pixels;
    test(() => assert(Math.abs(mean - 128) < 1, `Middle gray histogram shifted: mean ${mean}`));
    const blown = { ...base, exposure: 6, whites: 100 };
    const high = histogram(engine.readPixels(src, blown, W, H, 0));
    test(() => assert(high.highlightClip > 0.99, `Blown frame has no highlight warning: ${high.highlightClip}`));
    const s = heights(high);
    test(() => assert(s.r[255] === 1, `Clipped highlight spike invisible: height ${s.r[255]}`));
    const gl = engine.gpu.gl;
    engine.render(src, blown, { target: 'screen', width: W, height: H, seed: 0, clipping: true });
    const overlay = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, overlay);
    test(() => assert(overlay[0] === 255 && overlay[1] < 60 && overlay[2] < 40, `Highlight overlay missing: ${overlay.slice(0, 4)}`));
    test(() => assert(gl.getError() === gl.NO_ERROR, 'WebGL error'));
    // RAW exposure is tone-mapped, so high scene values can still sit below
    // display white. The histogram must track that curve without re-encoding.
    src.mode = InputMode.SceneLinear;
    for (const exposure of [0, 3, 6]) {
      const raw = histogram(engine.readPixels(src, { ...base, exposure }, W, H, 0));
      const rawMean = raw.l.reduce((sum, n, i) => sum + n * i, 0) / raw.pixels;
      const expected = toneForward(0.2159423828125 * 2 ** exposure) * 255;
      test(() => assert(Math.abs(rawMean - expected) < 1,
        `RAW histogram differs from tone-mapped output at +${exposure} EV: ${rawMean} vs ${expected}`));
    }
    if (errors.length) throw Error(errors.join('; '));
    document.body.dataset.result = `PASS: gray mean ${mean.toFixed(2)}, blown-frame clipping ${(high.highlightClip * 100).toFixed(0)}%, visible endpoint spike and highlight overlay`;
  } finally { engine.release(src); engine.dispose(); }
}

try { check(); } catch (err) { document.body.dataset.result = `FAIL: ${String(err)}`; }
