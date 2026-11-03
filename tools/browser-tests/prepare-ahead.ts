// SPDX-License-Identifier: GPL-3.0-or-later
// Engine.prepareSteps makes, ahead of time, every working target a first Texture or Dehaze drag
// would make in its first frame (made then, they froze the first drag 100–240 ms in the real
// app; HANDOFF.md). Checks that the first screen frame with both on makes no new target at the
// photo's size, that nothing is left to prepare after it, and that a photo of another size frees
// the spares it doesn't need. The freeze itself is timed in the real app:
// node tools/perf/inapp.mjs <photo> sliders,again.
import { Engine } from '../../src/engine/engine';
import { defaultRecipe } from '../../src/film/recipe';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };

function photo(eng: Engine, W: number, H: number) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const cx = c.getContext('2d')!;
  const g = cx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#a9b8c8'); g.addColorStop(1, '#4a3b2c');
  cx.fillStyle = g; cx.fillRect(0, 0, W, H);
  return eng.sourceFromImage(c, W, H);
}

async function check() {
  const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 320;
  const eng = new Engine(canvas);
  const gpu = eng.gpu as unknown as { make: (...a: unknown[]) => unknown };
  const made: string[] = [];
  const make = gpu.make.bind(gpu);
  gpu.make = (...a: unknown[]) => { made.push(`${a[0]}x${a[1]}`); return make(...a); };
  const src = photo(eng, 640, 427);
  const recipe = defaultRecipe();
  // An unedited frame first, as when a photo opens.
  eng.render(src, recipe, { target: 'screen', width: 480, height: 320, seed: 1 });
  // As Develop does while idle: the ambient light, then the targets.
  eng.measureAhead(src, recipe);
  const steps = eng.prepareSteps(src);
  assert(steps.length === 18, `planned ${steps.length} targets, expected 18 (9 Dehaze, 9 Texture)`);
  steps.forEach((s) => s());
  assert(eng.gpu.spareCount === 18, `reserved ${eng.gpu.spareCount}`);
  made.length = 0;
  eng.render(src, { ...recipe, texture: 40, dehaze: 30 }, { target: 'screen', width: 480, height: 320, seed: 1 });
  const atSize = made.filter((m) => m === '640x427');
  assert(atSize.length === 0, `the first Texture + Dehaze frame still made ${atSize.length} targets at the photo's size: ${made.join(' ')}`);
  assert(eng.gpu.spareCount === 0, `${eng.gpu.spareCount} spares left unused`);
  assert(eng.prepareSteps(src).length === 0, 'something left to prepare after the frame');
  assert(eng.gpu.gl.getError() === eng.gpu.gl.NO_ERROR, 'WebGL error');
  // Another photo of another size: nothing of the first photo's kept as a spare.
  const other = photo(eng, 600, 400);
  const more = eng.prepareSteps(other);
  more.slice(0, 3).forEach((s) => s());
  assert(eng.gpu.spareCount === 3, `spares ${eng.gpu.spareCount}`);
  assert(eng.prepareSteps(other).length === more.length - 3, 'a replan dropped spares it still needs');
  eng.prepareSteps(src);
  assert(eng.gpu.spareCount === 0, 'spares for another size were kept');
  eng.release(src); eng.release(other); eng.dispose();
  document.body.dataset.result = 'PASS: prepared targets cover the first Texture + Dehaze frame; replans keep what they need and free the rest';
}
check().catch((err) => { document.body.dataset.result = `FAIL: ${String(err)}`; });
