// SPDX-License-Identifier: GPL-3.0-or-later
// The film's modulation transfer through darktable's spektrafilm chain, measured the way a
// datasheet does it: sinusoidal exposure at a small modulation around mid grey, the output's
// modulation at each frequency over its modulation at a very low one (so the curves' gain
// cancels). Configurations: no couplers, couplers without spread, couplers with spread, and
// couplers with spread plus scatter.
// node tools/spektrabake/mtf.mjs [film] [pixelUm]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, '.cache/spektrabake'), pack = join(here, '.cache/pack'), tmp = join(here, '.cache/mtf');
mkdirSync(tmp, { recursive: true });
const film = process.argv[2] ?? 'kodak_portra_400';
const pixelUm = Number(process.argv[3] ?? 6);
const W = 1536, H = 4, STOPS = 0.15;
const freqs = [1, 2.5, 5, 10, 20, 40, 60, 80];
const configs = { none: ['--no-couplers'], local: ['--no-spread'], couplers: [], 'couplers+scatter': ['--scatter'] };

function render(f, args) {
  const period = 1000 / (f * pixelUm), img = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = 0.18 * 2 ** (STOPS * Math.sin(2 * Math.PI * x / period));
    img.set([v, v, v], 3 * (y * W + x));
  }
  const inp = join(tmp, 'in.f32'), out = join(tmp, 'out.f32');
  writeFileSync(inp, Buffer.from(img.buffer));
  execFileSync(bin, ['render', pack, film, inp, String(W), String(H), out, '--pixel-um', String(pixelUm), ...args]);
  const o = new Float32Array(readFileSync(out).buffer.slice(0));
  // Least-squares amplitude of the sine at this frequency over the middle half (log output).
  return [0, 1, 2].map(c => {
    let ss = 0, sc = 0, s2 = 0, c2 = 0, sxc = 0, m = 0, n = 0;
    for (let x = W / 4; x < 3 * W / 4; x++) m += Math.log(o[3 * (1 * W + x) + c]), n++;
    m /= n;
    for (let x = W / 4; x < 3 * W / 4; x++) {
      const v = Math.log(o[3 * (1 * W + x) + c]) - m, a = 2 * Math.PI * x / period;
      ss += v * Math.sin(a); sc += v * Math.cos(a); s2 += Math.sin(a) ** 2; c2 += Math.cos(a) ** 2; sxc += Math.sin(a) * Math.cos(a);
    }
    const det = s2 * c2 - sxc * sxc, A = (ss * c2 - sc * sxc) / det, B = (sc * s2 - ss * sxc) / det;
    return Math.hypot(A, B);
  });
}

const result = {};
for (const [name, args] of Object.entries(configs)) {
  const amps = freqs.map(f => render(f, args));
  result[name] = freqs.map((f, i) => [f, amps[i].map((a, c) => +(a / amps[0][c]).toFixed(3))]);
  console.log(`${film} ${name} (R/G/B, relative to ${freqs[0]} c/mm):`);
  for (const [f, v] of result[name].slice(1)) console.log(`  ${String(f).padStart(3)} c/mm  ${v.map(x => x.toFixed(2)).join(' / ')}`);
}
writeFileSync(join(tmp, `${film}.json`), JSON.stringify(result, null, 1));
