// SPDX-License-Identifier: GPL-3.0-or-later
// Local experiment only: wrap user-supplied official Fuji LUTs for Emulsion's sRGB LUT stage.
// F-Log2 encoding: FUJIFILM F-Log2 Data Sheet v1.1, section 2-3 (2024-11-21).
// https://dl.fujifilm-x.com/technical-data/F-Log2_DataSheet_E_Ver.1.1.pdf
// F-Gamut has the same primaries/white as Rec.2020; output has BT.709 primaries.
// Output interpretation: darktable's Gamma Rec709 RGB profile -> sRGB.
// Revision 2 fixes the earlier monitor-gamma-as-signal assumption; see fuji-transform.ts.
// Reuses Emulsion's existing darktable sigmoid inverse and tetrahedral LUT reader, unchanged.
// This script is GPL; Fujifilm's input LUTs and the generated LUTs are NOT relicensed by it.
// Usage (Node 24+): node tools/luts/bake-fuji.mjs <65Grid/F-Log2 folder> <local output folder>

import { registerHooks } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Node's type stripping handles the TS references; resolve their bundler-style relative imports.
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/src/') && !/\.[a-z]+$/i.test(specifier)) return next(specifier + '.ts', context);
    throw error;
  }
} });
const { adaptFuji: convert, encodeFLog2 } = await import('./fuji-transform.ts');
const { NEUTRAL, toneInverse, toneForward } = await import('../../src/engine/tone.ts');
const { parseCube, tetrahedral } = await import('../../src/engine/lut3d.ts');

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) throw new Error('Usage: node tools/luts/bake-fuji.mjs <65Grid/F-Log2 folder> <local output folder>');
const input = resolve(inputArg), output = resolve(outputArg);
if (output.startsWith(resolve('public') + '/')) throw new Error('Keep experimental Fuji LUTs outside bundled public assets');
mkdirSync(output, { recursive: true });
// Independent published code-value anchors and the existing neutral inverse.
assert.ok(Math.abs(encodeFLog2(0) * 1023 - 95) < 0.01);
assert.ok(Math.abs(encodeFLog2(0.18) * 1023 - 400) < 0.1);
assert.ok(Math.abs(encodeFLog2(0.9) * 1023 - 570) < 0.5);
for (const x of [0, 0.001, 0.18, 1, 8]) assert.ok(Math.abs(toneInverse(toneForward(x)) - x) < 1e-9);

const profiles = ['PROVIA', 'Velvia', 'ASTIA', 'CLASSIC-CHROME', 'CLASSIC-Neg.', 'REALA-ACE', 'PRO-Neg.Std', 'ETERNA', 'ETERNA-BB', 'ACROS'];
const level = 65;
const manifest = {
  experimental: true,
  revision: 2,
  input: 'Emulsion neutral print, encoded sRGB (existing display-LUT stage)',
  output: 'Encoded sRGB via darktable Gamma Rec709 RGB input profile (piecewise BT.709 transfer)',
  neutral: NEUTRAL, level,
  source: 'https://www.fujifilm-x.com/global/support/download/lut/ — GFX ETERNA 55 v1.10, F-Log2, 65Grid',
  limitations: 'Baked approximation. Gamut clipping in the existing display-LUT path is irreversible. Does not reproduce camera spectral processing or restore JPEG dynamic range. Local evaluation; no redistribution grant established.',
  profiles: [],
};
for (const name of profiles) {
  const source = readdirSync(input).find(file => file.startsWith(`FLog2_to_${name}_65grid_`) && file.endsWith('.cube'));
  if (!source) throw new Error(`Missing official 65-point F-Log2 LUT: ${name}`);
  const bytes = readFileSync(join(input, source));
  const original = parseCube(bytes.toString('utf8'));
  assert.equal(original.level, 65);
  const data = new Float32Array(level ** 3 * 3);
  const lines = [`# Local Emulsion conversion of FUJIFILM ${name}; NOT an open-source asset.`, '# Input/output: sRGB, specifically Emulsion neutral display-LUT stage.', '# F-Log2 source, Gamma Rec709 RGB to sRGB; revision 2. See manifest.json.', `TITLE "Emulsion Fuji ${name} (experimental)"`, `LUT_3D_SIZE ${level}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (let b = 0; b < level; b++) for (let g = 0; g < level; g++) for (let r = 0; r < level; r++) {
    const values = convert(original, [r / (level - 1), g / (level - 1), b / (level - 1)]);
    const index = ((b * level + g) * level + r) * 3;
    data.set(values, index);
    lines.push(values.map(v => v.toFixed(7)).join(' '));
  }
  const file = `Emulsion_Fuji_${name.replace(/\.$/, '')}_sRGB_65.cube`;
  const result = lines.join('\n') + '\n';
  writeFileSync(join(output, file), result);
  // Parse the written file with the real reader and compare off-grid interpolation to the direct chain.
  const baked = parseCube(result);
  assert.ok(baked.data.every(Number.isFinite));
  let maxChannelError = 0, squared = 0, samples = 0;
  for (let i = 0; i < 12000; i++) {
    const rgb = [((i * 137) % 12007) / 12006, ((i * 367) % 12011) / 12010, ((i * 853) % 12037) / 12036];
    const expected = convert(original, rgb), got = tetrahedral(baked, rgb);
    for (let c = 0; c < 3; c++) { const error = Math.abs(expected[c] - got[c]); maxChannelError = Math.max(maxChannelError, error); squared += error * error; samples++; }
  }
  const rmsChannelError = Math.sqrt(squared / samples);
  manifest.profiles.push({ name, file, source, sourceSha256: createHash('sha256').update(bytes).digest('hex'), sha256: createHash('sha256').update(result).digest('hex'), maxChannelError, rmsChannelError });
  console.log(`${name}: written; off-grid RMS ${(rmsChannelError * 255).toFixed(3)} / 255, worst ${(maxChannelError * 255).toFixed(2)} / 255`);
}
writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(output, 'README.txt'), `Experimental Fuji looks for Emulsion\n\nTen converted LUTs (revision 2), generated locally from the official GFX ETERNA 55 v1.10 F-Log2 65-point files.\nUse these in Emulsion's existing sRGB LUT stage. They are NOT log-input LUTs.\n\nConversion: sRGB display input -> inverse Emulsion neutral curve in Rec.2020 -> F-Log2 -> official Fuji LUT -> darktable Gamma Rec709 RGB input profile -> sRGB (revision 2).\n\nThese are baked approximations. Clipping already performed by the existing sRGB display-LUT path cannot be undone; a future direct scene-linear path would preserve more RAW gamut. Camera spectral processing, exposure calibration and JPEG rendering can still differ from an in-camera simulation. Grain and spatial processing are not included.\n\nFujifilm's original LUTs and these conversions are not licensed under the app's GPL. No affirmative app-redistribution permission was found. Keep local for evaluation; do not commit, upload or distribute them as part of Emulsion without resolving the applicable rights.\n\nSee manifest.json for sources, source/result hashes and measured interpolation error.\n`);
console.log(`Ten local LUTs ready in ${output}`);
