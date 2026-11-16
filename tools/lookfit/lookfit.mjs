// SPDX-License-Identifier: GPL-3.0-or-later
// Fit a look's tone curve to the camera's own JPEGs over several RAW+JPEG pairs at once.
//
//   node tools/lookfit/lookfit.mjs [options] PHOTO.RAF [PHOTO.RAF ...]
//
// Each RAW needs its camera JPEG beside it (same name). The RAWs go through the app's real
// engine on the GPU (headless Chrome, tools/browser-tests/look-fit.ts) with the look applied and
// its master RGB curve fitted; the look's colour balance, HSL and channel curves are kept.
//
// Options:
//   --looks FILE    looks JSON holding the look (default src/film/emulsion-looks.json); a file
//                   with one look object (id, name, settings) works too
//   --look ID       which look in it (default emulsion-film-chrome)
//   --edge N        long edge to develop and compare at (default 768)
//   --nodes a,b,..  the fitted curve's x positions (default 0,.06,.15,.28,.42,.56,.7,.84,1)
//   --smooth K      penalty on bends between nodes (default 0.0005)
//   --fix-dr        hold DR200/DR400 photos at +1/+2 EV instead of fitting their exposure
//   --color         fit the look's colour instead of its tone: HSL (hue, saturation, brightness
//                   of the 8 bands), colour balance saturation and chroma by tone, vibrance and the
//                   shadows/midtones/highlights tint wheels, with the curve kept. DR200/DR400
//                   photos are held at +1/+2 EV and count for colour only (hue and saturation, not
//                   lightness); every 4th DR100 photo is held out of the fit and only reported. Writes <look>.color-fitted.json
//   --bw            with --color: fit a black and white look, only its HSL brightness per band
//                   (the colour filter); every photo's lightness counts, DR200/DR400 too (held at
//                   +1/+2 EV)
//   --sepia         like --bw, with the shadows/midtones/highlights tint wheels as well
//   --evaluate      with --color: measure the look as it is, without fitting (per photo ΔE and
//                   the mean a*/b* offset of the JPEG's greys, render minus JPEG)
//   --exposure EV   hold every photo at this exposure (tone and colour) instead of 0 or its DR's;
//                   `fit` (tone only) fits each photo's exposure, reported as the current look's best
//   --balance       with --color: spread the samples evenly over colour instead of over the frame,
//                   for a single scene such as a studio test chart (mostly background otherwise)
//   --fix A,B       move every photo's JPEG by B minus A, two more JPEGs of the same RAW (say a raw
//                   converter's Provia and the camera's own Provia JPEG), to take that converter's
//                   own error out of its other simulations; see correctBy in fitlib.ts
//   --holdout N     with --color: hold out every Nth photo (default 4; 0 holds none)
//   --prior K       with --color: pull towards the starting settings (default 0.002)
//   --flat-tone     first set the look's colour balance tone controls to 0 (lightness of the
//                   shadows/midtones/highlights wheels and global, brilliance, contrast), so the
//                   curve carries the tone; hues, amounts and saturation stay
//
// DR100 photos are held at exposure 0, so the curve is fitted for the brightness a photo opens
// at; every other photo's exposure is fitted and reported. Fujifilm makernotes are read from
// the JPEGs to find the DR and warn when the film simulation settings differ between photos.
// Output in .scratch/lookfit/: report.json, tone.svg (response per photo against the curves) and
// <look>.fitted.json (the look with the fitted curve). Nothing in the repo is changed.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fujiSettings } from './fujifilm.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const looksFile = resolve(opt('--looks', 'src/film/emulsion-looks.json'));
const lookId = opt('--look', 'emulsion-film-chrome');
const colorMode = flag('--color');
const evaluateOnly = flag('--evaluate');
const edge = Number(opt('--edge', colorMode ? 512 : 768));
const nodes = opt('--nodes', '0,0.06,0.15,0.28,0.42,0.56,0.7,0.84,1').split(',').map(Number);
const smooth = Number(opt('--smooth', 0.0005));
const fixDr = flag('--fix-dr');
const flatTone = flag('--flat-tone');
const bwParams = flag('--sepia') ? 'sepia' : flag('--bw') ? 'bw' : 'color';
const fixedExposure = opt('--exposure', null);
const balance = flag('--balance');
const fix = opt('--fix', null)?.split(',').map((f) => resolve(f));
const holdout = Number(opt('--holdout', 4));
const prior = Number(opt('--prior', 0.002));
if (!args.length || args.some((a) => a.startsWith('--'))) {
  console.error('Usage: node tools/lookfit/lookfit.mjs [--looks FILE] [--look ID] [--edge N] [--nodes a,b,..] [--smooth K] [--fix-dr] PHOTO.RAF ...');
  process.exit(2);
}

const f = (v) => v === null || v === undefined ? '   -' : (v >= 0 ? '+' : '') + v.toFixed(1);
const ev = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} EV`;

const work = resolve('.scratch/lookfit');
mkdirSync(work, { recursive: true });

// The look.
const looksJson = JSON.parse(readFileSync(looksFile, 'utf8'));
const list = Array.isArray(looksJson) ? looksJson : looksJson.looks ?? (looksJson.settings ? [looksJson] : Object.values(looksJson));
const look = list.find((l) => l && (l.id === lookId || list.length === 1 && l.settings));
if (!look?.settings) throw new Error(`No look ${lookId} in ${looksFile}`);
const TONE_KEYS = ['shadows_Y', 'midtones_Y', 'highlights_Y', 'global_Y', 'brilliance_global', 'brilliance_shadows', 'brilliance_midtones', 'brilliance_highlights', 'contrast'];
if (flatTone && look.settings.colorBalance) {
  const cb = look.settings.colorBalance;
  console.log('Flat tone: ' + TONE_KEYS.filter((k) => cb[k]).map((k) => `${k} ${(+cb[k]).toFixed(3)} -> 0`).join(', '));
  for (const k of TONE_KEYS) delete cb[k];
}

// The pairs.
const photos = args.map((raw, i) => {
  raw = resolve(raw);
  const stem = raw.replace(/\.[^.]+$/, '');
  const jpeg = ['.JPG', '.jpg', '.JPEG', '.jpeg'].map((e) => stem + e).find(existsSync);
  if (!jpeg) throw new Error(`No camera JPEG beside ${raw}`);
  const fuji = fujiSettings(jpeg);
  // The exposure follows the DR the RAW was captured at (a DR200 capture is a stop darker, even
  // when X RAW Studio develops its JPEG at DR100 and brightens it back itself).
  const dr = fujiSettings(raw)?.dr ?? fuji?.dr ?? null;
  const exposure = fixedExposure === 'fit' ? null : fixedExposure !== null ? Number(fixedExposure) : dr === null || dr === 100 ? 0 : fixDr ? Math.log2(dr / 100) : null;
  return { name: basename(raw), rawPath: raw, jpegPath: jpeg, raw: `p${i}.raw.bin`, jpeg: `p${i}.jpg.bin`, dr, exposure, fuji,
    fix: fix ? { from: `p${i}.fixa.bin`, to: `p${i}.fixb.bin` } : undefined };
});
if (!photos.some((p) => p.exposure !== null)) photos[0].exposure = 0;

const recipeKeys = ['film', 'highlight', 'shadow', 'color', 'clarity', 'colorChrome', 'fxBlue'];
for (const p of photos) console.log(`${p.name}: ${p.fuji ? recipeKeys.map((k) => `${k} ${p.fuji[k]}`).join(', ') + `, JPEG DR${p.fuji.dr ?? '?'}` + (p.fuji.dr !== p.dr ? `, RAW captured at DR${p.dr ?? '?'}` : '') : 'no Fujifilm settings found'}`);
const differs = recipeKeys.filter((k) => new Set(photos.map((p) => String(p.fuji?.[k]))).size > 1);
if (differs.length) console.log(`\nWARNING: these photos were shot with different JPEG settings (${differs.join(', ')}); one look can't match them all.\n`);

// Decode both files exactly as the app hands them to the engine.
const target = process.env.CARGO_TARGET_DIR ?? resolve('src-tauri/target');
const dump = photos.flatMap((p) => [`${edge}\t${p.rawPath}\t${join(work, p.raw)}`, `${edge}\t${p.jpegPath}\t${join(work, p.jpeg)}`,
  ...(p.fix ? [`${edge}\t${fix[0]}\t${join(work, p.fix.from)}`, `${edge}\t${fix[1]}\t${join(work, p.fix.to)}`] : [])]).join('\n');
// The same files at the same size as the last run are decoded already: reuse them.
const dumpList = join(work, 'decoded.txt');
const decoded = existsSync(dumpList) && readFileSync(dumpList, 'utf8') === dump && dump.split('\n').every((l) => existsSync(l.split('\t')[2]));
if (!decoded) {
  if (existsSync(dumpList)) writeFileSync(dumpList, '');
  const cargo = spawnSync('cargo', ['test', '--lib', '--manifest-path', 'src-tauri/Cargo.toml', 'dump_engine_payloads', '--', '--ignored', '--nocapture'],
    { env: { ...process.env, CARGO_TARGET_DIR: target, EMULSION_LOOKFIT_DUMP: dump }, encoding: 'utf8' });
  if (cargo.status !== 0) { console.error(cargo.stdout, cargo.stderr); throw new Error('Decoding failed (source ~/.cargo/env first?)'); }
  writeFileSync(dumpList, dump);
}

if (colorMode) {
  writeFileSync(join(work, 'color-manifest.json'), JSON.stringify({
    look: { id: look.id, name: look.name, revision: look.revision ?? 1, settings: look.settings },
    // RAWs captured at DR200/DR400 count for colour only (their hue and saturation, not lightness).
    photos: photos.map(({ name, raw, jpeg, dr, fix }) => ({ name, raw, jpeg, dr, fix,
      exposure: fixedExposure !== null ? Number(fixedExposure) : dr && dr > 100 ? Math.log2(dr / 100) : 0, colorOnly: bwParams === 'color' && !!dr && dr > 100 })),
    params: bwParams, balance,
    holdout: evaluateOnly ? 0 : holdout, samples: 2500, prior, iterations: evaluateOnly ? 0 : 8,
  }));
  const run = spawnSync('node', ['tools/browser-tests/realtime.mjs', 'look-fit-color', '1200'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const line = run.stdout.trim().split('\n').pop() ?? '';
  if (!line.startsWith('PASS: ')) { console.error(run.stdout, run.stderr); throw new Error('The colour fit did not finish'); }
  const result = JSON.parse(line.slice(6));
  writeFileSync(join(work, 'color-report.json'), JSON.stringify(result, null, 1));
  const fittedLook = { ...structuredClone(look), settings: result.settings };
  writeFileSync(join(work, `${look.id}.color-fitted.json`), JSON.stringify(fittedLook, null, 2));
  const mean = (list, key) => list.length ? (list.reduce((a, p) => a + p[key].meanDE, 0) / list.length).toFixed(2) : '-';
  const train = result.photos.filter((p) => !p.held), held = result.photos.filter((p) => p.held);
  console.log(`\nLook: ${look.name} (${look.id}) from ${looksFile}`);
  console.log(`Mean ΔE (CIE76, render vs camera JPEG): fitted on ${train.length} photos ${mean(train, 'before')} -> ${mean(train, 'after')}; held out ${held.length} photos ${mean(held, 'before')} -> ${mean(held, 'after')}\n`);
  for (const p of result.photos) console.log(`  ${p.name.padEnd(14)} ${p.held ? 'held out' : p.colorOnly ? `DR${p.dr} col` : '        '}  ΔE ${p.before.meanDE.toFixed(1).padStart(5)} -> ${p.after.meanDE.toFixed(1).padStart(5)}   ΔL* ${p.after.meanDL >= 0 ? '+' : ''}${p.after.meanDL.toFixed(1)}`);
  console.log('\nBy colour (camera JPEG hue, or the scene’s in Emulsion Standard for black and white; chroma > 12), all photos: ΔE, then render minus JPEG in chroma, hue (degrees) and lightness');
  result.sectors.before.forEach((b, i) => {
    const a = result.sectors.after[i];
    const sg = (v, d = 1) => v === null ? '   -' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;
    console.log(`  ${b.hue.padEnd(8)} ${(b.share * 100).toFixed(0).padStart(3)}%   ΔE ${b.meanDE?.toFixed(1) ?? '-'} -> ${a.meanDE?.toFixed(1) ?? '-'}   chroma ${sg(b.chroma)} -> ${sg(a.chroma)}   hue ${sg(b.hueShift)} -> ${sg(a.hueShift)}   lightness ${sg(b.lightness)} -> ${sg(a.lightness)}`);
  });
  console.log('\nChanged settings:');
  for (const c of result.changes) console.log(`  ${c.name.padEnd(28)} ${String(c.from).padStart(8)} -> ${c.to}`);
  console.log(`\nWrote ${join(work, 'color-report.json')}\n      ${join(work, `${look.id}.color-fitted.json`)}`);
  process.exit(0);
}

writeFileSync(join(work, 'manifest.json'), JSON.stringify({
  look: { id: look.id, name: look.name, revision: look.revision ?? 1, settings: look.settings },
  photos: photos.map(({ name, raw, jpeg, dr, exposure, fix }) => ({ name, raw, jpeg, dr, exposure, fix })),
  nodes, exposures: [-1, 3, 0.05], smooth,
}));

const run = spawnSync('node', ['tools/browser-tests/realtime.mjs', 'look-fit', '900'], { encoding: 'utf8', maxBuffer: 64 << 20 });
const line = run.stdout.trim().split('\n').pop() ?? '';
if (!line.startsWith('PASS: ')) { console.error(run.stdout, run.stderr); throw new Error('The fit did not finish'); }
const result = JSON.parse(line.slice(6));
writeFileSync(join(work, 'report.json'), JSON.stringify(result, null, 1));

const fittedLook = structuredClone(look);
fittedLook.settings.curve = { ...(look.settings.curve ?? { r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] }), rgb: result.fitted };
writeFileSync(join(work, `${look.id}.fitted.json`), JSON.stringify(fittedLook, null, 2));
writeFileSync(join(work, 'tone.svg'), chart(result));

// Summary.
console.log(`Look: ${look.name} (${look.id}) from ${looksFile}`);
console.log('ΔL* is render minus JPEG, by the JPEG\'s lightness (<25 | 25-50 | 50-75 | >75); |ΔL| and ΔE are means.\n');
for (const p of result.photos) {
  console.log(`${p.name}  DR${p.dr ?? '?'}  ${p.samples} samples  aligned at scale ${p.align.scale}, shift ${p.align.dx},${p.align.dy} px (edge match ${p.align.score})`);
  for (const [label, r] of [['current look  ', p.before], ['current, best ', p.originalBest], ['fitted curve  ', p.after]]) {
    console.log(`  ${label} ${ev(r.exposure).padStart(9)}   ΔL* ${r.zones.map((z) => f(z.meanDL).padStart(5)).join(' |')}   |ΔL| ${r.meanAbsDL.toFixed(1)}   ΔE ${r.meanDE.toFixed(1)}`);
  }
}
console.log(`\nFitted master curve (x, y): ${JSON.stringify(result.fitted)}`);
console.log(`\nWrote ${join(work, 'report.json')}\n      ${join(work, 'tone.svg')}\n      ${join(work, `${look.id}.fitted.json`)}`);

function chart(r) {
  const S = 520, P = 40, X = (v) => P + v * S, Y = (v) => P + (1 - v) * S;
  const colours = ['#d1495b', '#2e86ab', '#e9a03b', '#3b8b5a', '#8a5bd1', '#6b6b6b'];
  const line = (vals, colour, dash = '') => `<polyline fill="none" stroke="${colour}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''} points="${vals.map((v, i) => `${X(Math.min(1, i * 4 / 255)).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/>`;
  const dots = r.photos.map((p, k) => p.response.map(([x, y, w]) => `<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="${Math.max(1, Math.min(4, Math.sqrt(w) * 40)).toFixed(1)}" fill="${colours[k % colours.length]}" fill-opacity="0.45"/>`).join('')).join('');
  const legend = [...(r.photos.length > 6 ? [['#bbb', `${r.photos.length} photos (camera JPEG)`]] : r.photos.map((p, k) => [colours[k % colours.length], `${p.name} at ${ev(p.after.exposure)} (camera JPEG)`])), ['#111', 'fitted curve'], ['#999', 'current curve']]
    .map(([c, t], i) => `<rect x="${P + 10}" y="${P + 10 + i * 18}" width="10" height="10" fill="${c}"/><text x="${P + 26}" y="${P + 19 + i * 18}" font-size="12">${t}</text>`).join('');
  const grid = [0.25, 0.5, 0.75].map((v) => `<line x1="${X(v)}" y1="${Y(0)}" x2="${X(v)}" y2="${Y(1)}" stroke="#eee"/><line x1="${X(0)}" y1="${Y(v)}" x2="${X(1)}" y2="${Y(v)}" stroke="#eee"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S + 2 * P}" height="${S + 2 * P + 20}" font-family="-apple-system, sans-serif">
<rect width="100%" height="100%" fill="#fff"/>${grid}<rect x="${P}" y="${P}" width="${S}" height="${S}" fill="none" stroke="#ccc"/>
<line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" stroke="#ddd" stroke-dasharray="4 4"/>
${dots}${line(r.curves.original, '#999', '6 4')}${line(r.curves.fitted, '#111')}${legend}
<text x="${P + S / 2}" y="${S + 2 * P + 4}" font-size="12" text-anchor="middle">input to the master curve (render, display value)</text>
<text x="12" y="${P + S / 2}" font-size="12" text-anchor="middle" transform="rotate(-90 12 ${P + S / 2})">camera JPEG (before channel curves)</text>
</svg>`;
}
