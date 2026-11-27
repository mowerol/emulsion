// SPDX-License-Identifier: GPL-3.0-or-later
// Fixture for engine/filmdev.test.ts: a 64 x 40 image of hard edges and colour blocks, and
// darktable's render of it on a film stock with the couplers per pixel (--no-spread) and spreading,
// at 50 µm per pixel (the spread's core 0.4 px, its tail 2–11 px), as linear Rec.2020 float32.
// node tools/spektrabake/edges-fixture.mjs [film]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, '.cache/spektrabake'), pack = join(here, '.cache/pack');
const film = process.argv[2] ?? 'kodak_gold_200';
const out = join(here, '../../src/engine/fixtures');
const W = 64, H = 40, img = new Float32Array(W * H * 3);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let c = [0.18, 0.18, 0.18];
  if (x >= 8 && x < 24 && y >= 8 && y < 32) c = [1.2, 1.2, 1.2];          // bright square
  if (x >= 32 && x < 48 && y >= 8 && y < 20) c = [0.6, 0.08, 0.05];       // red block
  if (x >= 32 && x < 48 && y >= 20 && y < 32) c = [0.05, 0.25, 0.08];     // green block
  if (x >= 52 && x < 60) c = [0.02, 0.02, 0.02];                           // dark bar
  if (y >= 34) c = c.map(v => v * (0.3 + 1.4 * x / W));                   // ramp strip
  img.set(c, 3 * (y * W + x));
}
writeFileSync(join(out, 'film-edges.in.f32'), Buffer.from(img.buffer));
for (const [name, args] of [['perpixel', ['--no-spread']], ['spread', []]]) {
  execFileSync(bin, ['render', pack, film, join(out, 'film-edges.in.f32'), String(W), String(H), join(out, `film-edges.${film}.${name}.f32`), '--pixel-um', '50', ...args]);
}
console.log(`wrote ${film} fixtures to ${out}`);
