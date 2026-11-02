// Runs darktable's heal (built by build.sh) on a few synthetic stamps and writes
// src/engine/fixtures/heal-reference.json for heal.test.ts.
// Usage: node tools/heal-reference/make-fixture.mjs <path to the built heal binary>
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const bin = process.argv[2];
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

function stamp(w, h, maskAt) {
  const src = [], dest = [], mask = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // A textured source and a destination with a different gradient and a blemish.
    const t = 0.3 + 0.2 * Math.sin(x * 0.7) * Math.cos(y * 0.5) + 0.05 * rand();
    src.push(t, t * 0.8, t * 0.6, 0);
    const blemish = Math.hypot(x - w / 2, y - h / 2) < Math.min(w, h) / 5 ? 0.4 : 0;
    const g = 0.5 + 0.3 * (x / w) - 0.2 * (y / h) + 0.05 * rand();
    dest.push(g + blemish, g * 0.9, g * 0.7 - blemish / 2, 0);
    mask.push(maskAt(x, y));
  }
  return { w, h, src, dest, mask };
}

const disc = (w, h, r) => (x, y) => { const d = Math.hypot(x - w / 2, y - h / 2) / r; return d < 1 ? (1 - d * d) ** 2 : 0; };
const cases = [
  { name: 'odd disc', ...stamp(23, 19, disc(23, 19, 8)), maxIter: 2000 },
  { name: 'even disc', ...stamp(32, 24, disc(32, 24, 10)), maxIter: 2000 },
  { name: 'touching the edge', ...stamp(15, 15, (x, y) => (x < 9 && y > 3 ? 1 : 0)), maxIter: 2000 },
  { name: 'capped at 5 sweeps', ...stamp(21, 17, disc(21, 17, 7)), maxIter: 5 },
];
for (const c of cases) {
  const input = [c.w, c.h, c.maxIter, ...c.src, ...c.dest, ...c.mask].join('\n');
  c.out = execFileSync(bin, { input }).toString().trim().split('\n').map(Number);
}
writeFileSync(new URL('../../src/engine/fixtures/heal-reference.json', import.meta.url), JSON.stringify({ commit: '20891f6c6fa7be995e5bf9dff9d1ee5062051773', cases }));
console.log('wrote', cases.length, 'cases');
