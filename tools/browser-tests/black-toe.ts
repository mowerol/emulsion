// SPDX-License-Identifier: GPL-3.0-or-later
// Real renderer: the positive Blacks range is defined on an encoded neutral ramp.
import { Engine, InputMode } from '../../src/engine/engine';
import { defaultRecipe } from '../../src/film/recipe';
import { blackToeLift, toneInverse } from '../../src/engine/tone';

const half = (v: number) => {
  if (v === 0) return 0;
  v = Math.min(v, 65504);
  const u = new Uint32Array(new Float32Array([v]).buffer)[0];
  return ((u >> 16) & 0x8000) | ((((u >> 23) & 0xff) - 112) << 10) | ((u >> 13) & 0x3ff);
};
const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
async function main() {
  const engine = new Engine(document.createElement('canvas'));
  const width = 256, height = 8, data = new Uint16Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = half(toneInverse(x / 255));
    data.set([v, v, v, half(1)], (y * width + x) * 4);
  }
  const source = engine.sourceFromHalf({ width, height, fullWidth: width, fullHeight: height, mode: InputMode.SceneLinear, white: null, data });
  try {
    const base = { ...defaultRecipe('neutral'), captureSharpening: 0, sharpen: 0 };
    const neutral = engine.readPixels(source, base, width, height, 7);
    const sample = (p: ArrayLike<number>, code: number) => p[(4 * width + code) * 4];
    const rows = [];
    for (const blacks of [25, 50, 100, 150, 200]) {
      const pixels = engine.readPixels(source, { ...base, blacks }, width, height, 7);
      for (let code = 60; code < 256; code++) assert(Math.abs(sample(pixels, code) - sample(neutral, code)) <= 1,
        `Blacks +${blacks} still moves grey ${code}: ${sample(neutral, code)} → ${sample(pixels, code)}`);
      assert(sample(pixels, 0) === sample(neutral, 0), `Grey floor: true black moved ${sample(neutral, 0)} → ${sample(pixels, 0)}`);
      if (blacks === 100) assert(sample(pixels, 5) > 10 && sample(pixels, 30) > 33, 'Lift is too subtle at +100');
      const exported = await engine.readPixels16Async(source, { ...base, blacks }, width, height, 7);
      for (let code = 0; code < 256; code++) {
        const expected = 255 * blackToeLift(code / 255, blacks);
        assert(Math.abs(sample(pixels, code) - expected) <= 2, `CPU/GPU mismatch at ${code}`);
        for (let channel = 0; channel < 3; channel++) assert(Math.abs(exported[(4 * width + code) * 3 + channel] / 257 - pixels[(4 * width + code) * 4 + channel]) <= 2, '16-bit export differs from preview');
      }
      rows.push({ blacks, values: [0, 5, 10, 20, 30, 40, 60, 80].map(code => [code, sample(pixels, code)]) });
    }
    document.body.dataset.result = `PASS: true black retained, near-black detail opened, 60+ unchanged; ${JSON.stringify(rows)}`;
  } finally { engine.release(source); engine.dispose(); }
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error?.stack ?? error)}`; });
