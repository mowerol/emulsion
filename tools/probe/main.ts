// SPDX-License-Identifier: GPL-3.0-or-later
// Engine probe: renders a synthetic frame through the real engine in any
// browser and reports pixel values, so stage changes and ports can be checked
// numerically. See docs/ARCHITECTURE.md, "Testing".
import { Engine } from '../../src/engine/engine';
import { defaultRecipe, type Recipe } from '../../src/film/recipe';

const W = 1200, H = 800;
const c = document.createElement('canvas');
c.width = W; c.height = H;
const g = c.getContext('2d')!;
g.fillStyle = '#202020'; g.fillRect(0, 0, W, H);
g.fillStyle = '#ffffff'; g.beginPath(); g.arc(600, 400, 30, 0, Math.PI * 2); g.fill();
g.fillStyle = 'rgb(128,128,128)'; g.fillRect(100, 100, 100, 100);

const view = document.createElement('canvas');
view.width = W; view.height = H;
document.body.append(view);
const out: Record<string, unknown> = {};
try {
  const eng = new Engine(view);
  out.hdr = eng.gpu.hdr;
  const src = eng.sourceFromImage(c, W, H);
  const at = (px: Uint8Array, x: number, y: number) => Array.from(px.slice((y * W + x) * 4, (y * W + x) * 4 + 3));
  const run = (r: Recipe | null) => eng.readPixels(src, r, W, H, 1);
  const base: Recipe = { ...defaultRecipe('cinestill800t'), grain: 0, scanner: 'straight' };
  const orig = run(null);
  const off = run({ ...base, halation: 0, glow: 0 });
  const hal = run({ ...base, halation: 100, glow: 0 });
  const glow = run({ ...base, halation: 0, glow: 100 });
  for (const [name, px] of [['orig', orig], ['off', off], ['hal', hal], ['glow', glow]] as const) {
    out[name] = { center: at(px, 600, 400), d10: at(px, 640, 400), d25: at(px, 655, 400), d45: at(px, 675, 400), d70: at(px, 700, 400), far: at(px, 900, 400), grey: at(px, 150, 150) };
  }
  const gl = eng.gpu.gl;
  out.err = gl.getError();
  out.ext = gl.getSupportedExtensions();
} catch (e) {
  out.error = String(e);
}
(window as unknown as { result: unknown }).result = out;
const { ext: _ext, ...report } = out;
void _ext;
fetch('/report?' + encodeURIComponent(JSON.stringify(report))).catch(() => {});
