// SPDX-License-Identifier: GPL-3.0-or-later
// Local experiment only: install Negs/spektrafilm LUTs as an Emulsion look pack.
//
// The Negs .cube files are built for sRGB-encoded input and output. Emulsion's LUT stage feeds
// the LUT exactly that: the neutral print, encoded sRGB. For a display-referred photo that is the
// source image itself, so the LUTs are installed byte-for-byte; for RAW it is Emulsion's neutral
// rendering, which is the same kind of image Negs receives from a camera pipeline.
//
// The LUTs also bake the manual exposure used when they were generated. Gold 200 and Portra 400
// were exported at the same exposure; Portra 800 came out ~1.7 EV hotter. A per-stock `ev` applies
// a linear pre-gain (decode sRGB, scale by 2^ev, encode) so the three sit at the same exposure.
//
// Baking the neutral-curve inverse into the LUT was tried and rejected: the inverse sigmoid is
// ill-conditioned near white, so small print differences become enormous out-of-gamut scene chroma
// and a 65^3 grid produces visible blocky artifacts in saturated highlights. Direct application is
// stable and reproduces Negs' per-pixel rendering exactly.
//
// The spektrafilm profile data behind these LUTs is CC BY-SA 4.0 (Andrea Volpato). Keep them local
// for evaluation; redistribution needs attribution and the same licence.
//
// Usage (Node 24+): node tools/luts/install-spektrafilm.mjs <Negs .cube folder> [output folder]

import { registerHooks } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/src/') && !/\.[a-z]+$/i.test(specifier)) return next(specifier + '.ts', context);
    throw error;
  }
} });

const { parseCube, tetrahedral, writeCube } = await import('../../src/engine/lut3d.ts');
const { srgbEotf, srgbOetf } = await import('../../src/engine/color.ts');

const [inputArg, outputArg = 'local-looks/spektrafilm'] = process.argv.slice(2);
if (!inputArg) throw new Error('Usage: node tools/luts/install-spektrafilm.mjs <Negs .cube folder> [output folder]');
const input = resolve(inputArg), output = resolve(outputArg);
if (output.startsWith(resolve('public') + '/')) throw new Error('Keep experimental spektrafilm LUTs outside bundled public assets');
mkdirSync(output, { recursive: true });

// Source filename stem, Emulsion stock id, display name, ISO for grain sizing, optional pre-gain.
// `ev` applies a linear exposure pre-gain when a Cube was exported at a different manual exposure
// than its siblings; none are needed at present.
const stocks = [
  { match: 'kodak_gold_200_kodak_portra_endura', id: 'gold200', name: 'Gold 200', iso: 200 },
  { match: 'kodak_portra_400_kodak_portra_endura', id: 'portra400', name: 'Portra 400', iso: 400 },
  { match: 'kodak_portra_800_kodak_portra_endura', id: 'portra800', name: 'Portra 800', iso: 800 },
  { match: 'kodak_ultramax_400_kodak_portra_endura', id: 'ultramax400', name: 'UltraMax 400', iso: 400 },
  { match: 'kodak_ektar_100_kodak_portra_endura', id: 'ektar100', name: 'Ektar 100', iso: 100 },
  { match: 'fujifilm_pro_400h_fujifilm_crystal_archive_typeii', id: 'pro400h', name: 'Pro 400H', iso: 400 },
  { match: 'fujifilm_c200_fujifilm_crystal_archive_typeii', id: 'c200', name: 'C200', iso: 200 },
  { match: 'fujifilm_xtra_400_fujifilm_crystal_archive_typeii', id: 'superia400', name: 'Superia X-TRA 400', iso: 400 },
  { match: 'kodak_ektachrome_100_direct_scan', id: 'ektachrome100', name: 'Ektachrome 100', iso: 100 },
  { match: 'kodak_kodachrome_64_direct_scan', id: 'kodachrome64', name: 'Kodachrome 64', iso: 64 },
  { match: 'fujifilm_velvia_100_direct_scan', id: 'velvia100', name: 'Velvia 100', iso: 100 },
];

const manifest = {
  experimental: true,
  input: 'sRGB encoded, range 0..1 (Emulsion display-LUT stage)',
  output: 'sRGB encoded',
  level: 33,
  source: 'Negs / spektrafilm (https://github.com/noahhaasis/negs): negatives on Kodak Portra Endura or Fujifilm Crystal Archive Type II paper, slides as direct scans',
  licence: 'spektrafilm profile data is CC BY-SA 4.0, Andrea Volpato. These LUTs are derivative data under the same licence.',
  limitations: 'Per-pixel only: grain, halation, scatter, glare, diffusion, lens blur, sharpening, RAW development and post-tab edits are not included. The LUT bakes the manual exposure used when it was generated.',
  profiles: [],
};

// Remove previously installed Cubes so a re-run cannot leave an orphaned variant behind.
for (const file of readdirSync(output)) if (file.endsWith('.cube')) rmSync(join(output, file));

const catalogue = [];
for (const stock of stocks) {
  const source = readdirSync(input).find((file) => file.startsWith(stock.match) && file.endsWith('.cube'));
  if (!source) throw new Error(`Missing Negs LUT for ${stock.name}: ${stock.match}*.cube`);
  const original = readFileSync(join(input, source));
  const originalText = original.toString('utf8');
  const size = /LUT_3D_SIZE\s+(\d+)/.exec(originalText);
  assert.ok(size, `${source} has no LUT_3D_SIZE`);
  const level = Number(size[1]);
  assert.equal(level, 33, `${source} should be 33^3`);

  let bytes = original;
  if (stock.ev !== undefined) {
    // Linear exposure pre-gain: the LUT's input is sRGB-encoded scene, so decode, scale, encode.
    const lut = parseCube(originalText);
    const data = new Float32Array(lut.data.length);
    for (let b = 0; b < level; b++) for (let g = 0; g < level; g++) for (let r = 0; r < level; r++) {
      const v = [r / (level - 1), g / (level - 1), b / (level - 1)];
      const gained = v.map((x) => srgbOetf(Math.pow(2, stock.ev) * srgbEotf(x)));
      data.set(tetrahedral(lut, gained), ((b * level + g) * level + r) * 3);
    }
    bytes = Buffer.from(writeCube({ level, data }, `Emulsion Spektrafilm ${stock.name} (exposure-corrected)`, [
      `Negs/spektrafilm ${stock.name} on Kodak Portra Endura, with a ${stock.ev} EV linear pre-gain.`,
      'Input/output: sRGB, Emulsion neutral display-LUT stage.',
      'Corrects the manual exposure baked into the source Cube; see manifest.json.',
      'Derived from spektrafilm data, CC BY-SA 4.0 (Andrea Volpato). Local evaluation only.',
    ], 7));
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const file = `${stock.match}_${sha256.slice(0, 8)}.cube`;
  writeFileSync(join(output, file), bytes);
  catalogue.push({
    id: `lut:spektrafilm:${stock.id}`,
    pack: 'spektrafilm',
    name: stock.name,
    category: 'Spectral film',
    file,
    iso: stock.iso,
    sha256,
  });
  manifest.profiles.push({
    name: stock.name, file, source, sha256,
    ...(stock.ev !== undefined ? { exposureCorrectionEv: stock.ev } : {}),
  });
  console.log(`${stock.name}: ${file}${stock.ev !== undefined ? ` (${stock.ev} EV)` : ''}`);
}

writeFileSync(join(output, 'catalogue.json'), JSON.stringify(catalogue, null, 2) + '\n');
writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(output, 'README.txt'), `Experimental spektrafilm looks for Emulsion

${catalogue.length} LUTs from Negs/spektrafilm Cubes (33-point), installed as an Emulsion look pack.
Use them in Emulsion's existing sRGB LUT stage. They are NOT log-input LUTs.

Negs builds these for sRGB-encoded input. Emulsion's LUT stage feeds exactly that, so the Cubes
are installed unchanged. On a display-referred photo the stage input is the source image; on RAW
it is Emulsion's neutral rendering, the same kind of image Negs gets from a camera pipeline.

Stocks: Kodak Gold 200, Portra 400, Portra 800, UltraMax 400 and Ektar 100 on Kodak Portra
Endura; Fujifilm Pro 400H, C200 and Superia X-TRA 400 on Fujifilm Crystal Archive Type II; and
the slide films Kodak Ektachrome 100, Kodachrome 64 and Fujifilm Velvia 100 as direct scans (no
print). Each Cube bakes the manual exposure used when it was generated; the negatives were
exported at a matched exposure. The slides sit about 0.1 lower at mid-grey with deeper blacks,
as a direct scan of reversal film does, and are installed unchanged.

Baking the neutral-curve inverse into the LUT was tried and rejected: the inverse is
ill-conditioned near white, so small print differences become enormous out-of-gamut scene chroma
and a 65^3 grid shows visible blocky artifacts in saturated highlights.

These are per-pixel approximations. Grain, halation, scatter, glare, diffusion, lens blur,
sharpening, RAW development and post-tab edits are not included.

Licence: the spektrafilm profile data behind these LUTs is CC BY-SA 4.0, Copyright (c) Andrea
Volpato (https://github.com/andreavolpato/spektrafilm). These LUTs are derivative data under the
same licence and must credit the author if redistributed. Keep local for evaluation.

See manifest.json for sources and hashes.
`);
console.log(`${catalogue.length} local LUTs ready in ${output}`);
