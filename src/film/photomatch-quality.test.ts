// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCube, tetrahedral, writeCube } from '../engine/lut3d';
import { matchPhotoLook, type MatchImage } from './photomatch';

function readBmp(path: string): MatchImage {
  const buf = readFileSync(path);
  const offset = buf.readUInt32LE(10);
  const width = buf.readInt32LE(18);
  const rawHeight = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  const stride = Math.ceil((width * bpp) / 32) * 4;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcY = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const s = offset + srcY * stride + x * (bpp / 8);
      const d = (y * width + x) * 4;
      data[d] = buf[s + 2];
      data[d + 1] = buf[s + 1];
      data[d + 2] = buf[s];
      data[d + 3] = 255;
    }
  }
  return { width, height, data };
}

function toBmp(image: MatchImage, path: string) {
  const { width, height } = image;
  const stride = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + stride * height;
  const buf = Buffer.alloc(size);
  buf.write('BM', 0);
  buf.writeUInt32LE(size, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(-height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = 54 + y * stride + x * 3;
      buf[d] = image.data[s + 2];
      buf[d + 1] = image.data[s + 1];
      buf[d + 2] = image.data[s];
    }
  }
  writeFileSync(path, buf);
}

const apply = (lut: ReturnType<typeof parseCube>, image: MatchImage): MatchImage => {
  const data = new Uint8Array(image.data.length);
  for (let i = 0; i < image.data.length; i += 4) {
    const out = tetrahedral(lut, [image.data[i] / 255, image.data[i + 1] / 255, image.data[i + 2] / 255]);
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(Math.min(1, Math.max(0, out[c])) * 255);
    data[i + 3] = image.data[i + 3];
  }
  return { ...image, data };
};

// Optional local quality check. Normal tests never depend on private photos or LUT files.
// EMULSION_MATCH_SAMPLE=/path/to/24bit.bmp EMULSION_MATCH_LUT=/path/to/look.cube npm test -- src/film/photomatch-quality.test.ts
describe('real photo validation', () => {
  it.skipIf(!process.env.EMULSION_MATCH_SAMPLE || !process.env.EMULSION_MATCH_LUT)('improves a known LUT match on a real sample', () => {
    const target = readBmp(process.env.EMULSION_MATCH_SAMPLE!);
    const known = parseCube(
      readFileSync(process.env.EMULSION_MATCH_LUT!, 'utf8'),
    );
    const reference = apply(known, target);
    const started = performance.now();
    const match = matchPhotoLook(target, reference, { level: 33 });
    const ms = performance.now() - started;
    const matched = apply(match.lut, target);
    const withoutHue = apply(matchPhotoLook(target, reference, { level: 33, matchHue: false }).lut, target);

    let errGen = 0;
    let errBase = 0;
    let errWithoutHue = 0;
    const n = target.data.length / 4;
    for (let i = 0; i < target.data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        errGen += Math.abs(matched.data[i + c] - reference.data[i + c]);
        errBase += Math.abs(target.data[i + c] - reference.data[i + c]);
        errWithoutHue += Math.abs(withoutHue.data[i + c] - reference.data[i + c]);
      }
    }
    errGen /= n * 3 * 255;
    errBase /= n * 3 * 255;
    errWithoutHue /= n * 3 * 255;

    // LUT-to-LUT error on a neutral-ramp + hue sweep grid, ignoring out-of-gamut clipping.
    let lutErr = 0;
    let lutN = 0;
    for (let r = 0; r < 17; r++) {
      for (let g = 0; g < 17; g++) {
        for (let b = 0; b < 17; b++) {
          const inp: [number, number, number] = [r / 16, g / 16, b / 16];
          const a = tetrahedral(known, inp);
          const c = tetrahedral(match.lut, inp);
          for (let k = 0; k < 3; k++) {
            lutErr += Math.abs(a[k] - c[k]);
            lutN++;
          }
        }
      }
    }
    lutErr /= lutN;

    toBmp(target, '/tmp/pm-before.bmp');
    toBmp(reference, '/tmp/pm-reference.bmp');
    toBmp(matched, '/tmp/pm-matched.bmp');
    writeFileSync('/tmp/pm-match.cube', writeCube(match.lut, 'Photo match'));

    const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
    console.log(`match ${ms.toFixed(0)}ms, samples ${match.report.samples.join('/')}`);
    console.log(`image error: generated ${pct(errGen)} vs identity ${pct(errBase)}`);
    console.log(`lut grid error: ${pct(lutErr)}`);
    console.log('tone', match.report.tone.map(([x, y]) => `${x.toFixed(3)}->${y.toFixed(3)}`).join(' '));
    console.log('chroma', match.report.chroma.toFixed(3), 'hues', match.report.hues.map((h) => h.toFixed(2)).join(' '));
    console.log('casts', match.report.casts.map(([a, b]) => `[${a.toFixed(4)},${b.toFixed(4)}]`).join(' '));
    writeFileSync('/tmp/pm-validation.json', JSON.stringify({ milliseconds: ms, samples: match.report.samples,
      matchedMeanAbsoluteError: errGen, baselineMeanAbsoluteError: errBase, withoutHueMeanAbsoluteError: errWithoutHue,
      hueShiftsDegrees: match.report.hueShifts.map(h => h * 180 / Math.PI), lutMeanAbsoluteError: lutErr }, null, 2));
    expect(errGen).toBeLessThan(errBase * 0.75);
  });
});
