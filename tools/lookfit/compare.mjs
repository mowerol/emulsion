// SPDX-License-Identifier: GPL-3.0-or-later
// Labelled side-by-side images: each Fujifilm JPEG (from X RAW Studio) beside Emulsion's render of
// the same RAW with the matching Emulsion x Fuji look, for every simulation that has a look.
//
//   node tools/lookfit/compare.mjs --out DIR [--looks FILE] [--edge N] STEM [STEM ...]
//
// STEM is a RAW's name without extension (1OKK3518). Classic Negative pairs come from the
// "X RAW DR100 set" folders, the others from "X RAW all film sims" and, black and white, "X RAW all
// BW sims" (<STEM>_<Sim>.RAF/.jpg).
// Renders through the real engine in headless Chrome (look-compare.ts); writes one JPEG per pair.
import { createServer } from 'vite';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const out = resolve(opt('--out', '.scratch/compare-out'));
const looksFile = resolve(opt('--looks', '/Users/oli/Dev/emulsion/src/film/emulsion-looks.json'));
const edge = Number(opt('--edge', 1600));
// --sides DIR: also write each side alone as <stem>-<sim>-fujifilm.webp and -emulsion.webp.
const sides = opt('--sides', null);
// --grid PHOTO:Sim,Sim,...: also one image of that photo in those simulations (repeatable).
const gridSpecs = [];
for (let g; (g = opt('--grid', null));) gridSpecs.push(g);
const ROOT = opt('--photos', '/Volumes/Oli External/Photos/2025');
if (!args.length) { console.error('Usage: node tools/lookfit/compare.mjs --out DIR STEM ...'); process.exit(2); }

const SIMS = [
  ['ClassicNeg', 'Classic Negative', 'emulsion-fuji-classic-negative'], ['ClassicChrome', 'Classic Chrome', 'emulsion-fuji-classic-chrome'],
  ['ProNegHi', 'Pro Neg. Hi', 'emulsion-film-pro-neg-hi'], ['ProNegStd', 'Pro Neg. Std', 'emulsion-film-pro-neg-std'],
  ['Provia', 'Provia', 'emulsion-film-provia'], ['Velvia', 'Velvia', 'emulsion-film-velvia'], ['Astia', 'Astia', 'emulsion-film-astia'],
  ['Eterna', 'Eterna', 'emulsion-film-eterna'], ['BleachBypass', 'Eterna Bleach Bypass', 'emulsion-film-bleach'],
  ...[['Acros', 'Acros', 'acros'], ['AcrosYe', 'Acros + Ye', 'acros-ye'], ['AcrosR', 'Acros + R', 'acros-r'], ['AcrosG', 'Acros + G', 'acros-g'],
    ['Mono', 'Monochrome', 'monochrome'], ['MonoYe', 'Monochrome + Ye', 'monochrome-ye'], ['MonoR', 'Monochrome + R', 'monochrome-r'],
    ['MonoG', 'Monochrome + G', 'monochrome-g'], ['Sepia', 'Sepia', 'sepia']].map(([tag, label, id]) => [tag, label, `emulsion-fuji-${id}`, 'X RAW all BW sims']),
];
const looks = Object.fromEntries(JSON.parse(readFileSync(looksFile, 'utf8')).map((l) => [l.id, { name: l.name, revision: l.revision, settings: l.settings }]));
const work = resolve('.scratch/compare');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });

const items = [];
const dumps = [];
for (const stem of args) {
  let raw = null;
  for (const [tag, label, look, folder = 'X RAW all film sims'] of SIMS) {
    if (!looks[look]) continue;
    const [rawPath, jpegPath] = tag === 'ClassicNeg'
      ? ['X RAW DR100 set', 'X RAW DR100 set 2'].map((d) => join(ROOT, d, stem)).map((p) => [`${p}.RAF`, `${p}.jpg`]).find(([r, j]) => existsSync(r) && existsSync(j)) ?? []
      : [join(ROOT, folder, `${stem}_${tag}.RAF`), join(ROOT, folder, `${stem}_${tag}.jpg`)];
    if (!rawPath || !existsSync(rawPath) || !existsSync(jpegPath)) { console.log(`${stem}: no ${label} pair, skipped`); continue; }
    // The RAW at full resolution (the page shrinks it with the JPEG, the same way).
    if (!raw) { raw = `${stem}.raw.bin`; dumps.push(`20000\t${rawPath}\t${join(work, raw)}`); }
    const jpeg = `${stem}_${tag}.jpg`;
    copyFileSync(jpegPath, join(work, jpeg));
    items.push({ name: stem, simulation: label, look, raw, jpeg, exposure: 0, file: `${stem} ${label}.jpg` });
  }
}
const cargo = spawnSync('cargo', ['test', '--lib', '--manifest-path', 'src-tauri/Cargo.toml', 'dump_engine_payloads', '--', '--ignored'],
  { env: { ...process.env, EMULSION_LOOKFIT_DUMP: dumps.join('\n') }, encoding: 'utf8' });
if (cargo.status !== 0) { console.error(cargo.stdout, cargo.stderr); throw new Error('Decoding failed (source ~/.cargo/env first?)'); }
const grids = gridSpecs.map((spec) => {
  const [photo, sims] = spec.split(':');
  const rows = sims.split(',').map((tag) => items.findIndex((it) => it.name === photo && it.jpeg === `${photo}_${tag}.jpg`));
  if (rows.some((r) => r < 0)) throw new Error(`No pair for every simulation in ${spec}`);
  return { name: photo, rows, file: `${photo} ${sims.split(',').length} simulations.jpg` };
});
writeFileSync(join(work, 'manifest.json'), JSON.stringify({ looks, items, separate: !!sides, grids, edge }));

process.env.VITE_ENGINE ??= 'main';
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const profile = mkdtempSync(join(tmpdir(), 'emulsion-compare-'));
const debugPort = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(process.env.BROWSER_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run',
  `--user-data-dir=${profile}`, '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', `--remote-debugging-port=${debugPort}`,
  `http://127.0.0.1:${server.httpServer.address().port}/tools/browser-tests/look-compare.html`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  if (!target) throw new Error('Chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); });
  const evaluate = async (expression) => (await new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })); })).result?.result?.value;
  let result = null;
  for (const t0 = Date.now(); Date.now() - t0 < 900_000 && !result; await sleep(500)) result = await evaluate('document.body?.dataset.result ?? null');
  if (!result?.startsWith('PASS')) throw new Error(result ?? 'timed out');
  for (const [i, item] of items.entries()) {
    const url = await evaluate(`window.outputs[${i}]`);
    writeFileSync(join(out, item.file), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    console.log(`wrote ${join(out, item.file)}`);
    if (sides) {
      mkdirSync(sides, { recursive: true });
      const pair = await evaluate(`window.sides[${i}]`);
      const base = `${item.name}-${item.jpeg.replace(/^[^_]*_|\.jpg$/g, '').toLowerCase()}`;
      pair.forEach((u, k) => writeFileSync(join(sides, `${base}-${k ? 'emulsion' : 'fujifilm'}.webp`), Buffer.from(u.slice(u.indexOf(',') + 1), 'base64')));
    }
  }
  for (const [i, grid] of grids.entries()) {
    const url = await evaluate(`window.grids[${i}]`);
    writeFileSync(join(out, grid.file), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    console.log(`wrote ${join(out, grid.file)}`);
  }
  ws.close();
} finally {
  chrome.kill();
  await server.close();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
