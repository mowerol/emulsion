// SPDX-License-Identifier: GPL-3.0-or-later
// A 1:1 crop of a real RAW through darktable's spektrafilm chain, in the configurations the Film
// stage would be built up in, saved as sRGB PNGs for side-by-side viewing.
// The input is an Emulsion decode payload (src/backend/api.ts parsePayload: scene-linear
// Rec.2020, white-balanced as shot, half floats); the crop keeps the whole frame's pixel size on
// the film (36 mm across the long edge).
// node tools/spektrabake/photo.mjs <payload.bin> <film> <cx 0-1> <cy 0-1> <out dir> [ev] [w] [h]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, '.cache/spektrabake'), pack = join(here, '.cache/pack');
const [payload, film, cxs, cys, out, evs = '0', ws = '900', hs = '600'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const ev = Number(evs), CW = Number(ws), CH = Number(hs);

const buf = readFileSync(payload), dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const W = dv.getUint32(0, true), H = dv.getUint32(4, true), flags = dv.getUint32(12, true);
let off = 32;
if (flags & 2) off = Math.ceil((off + 4 + dv.getUint32(off, true)) / 4) * 4;
if (flags & 4) off = Math.ceil((off + 4 + dv.getUint32(off, true)) / 4) * 4;
if (flags & 16) off += 16;
const half = new Uint16Array(buf.buffer, buf.byteOffset + off, W * H * 4);
const h2f = (h) => {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  return e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
};
const x0 = Math.round(Number(cxs) * (W - CW)), y0 = Math.round(Number(cys) * (H - CH));
const crop = new Float32Array(CW * CH * 3), gain = 2 ** ev;
for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++)
  for (let c = 0; c < 3; c++) crop[3 * (y * CW + x) + c] = Math.max(0, h2f(half[4 * ((y0 + y) * W + x0 + x) + c]) * gain);
const inp = join(out, 'in.f32');
writeFileSync(inp, Buffer.from(crop.buffer));
const pixelUm = 36000 / Math.max(W, H);

// Rec.2020 to sRGB (both D65), then the sRGB transfer.
const M = [[1.6605, -0.5876, -0.0728], [-0.1246, 1.1329, -0.0083], [-0.0182, -0.1006, 1.1187]];
const enc = (l) => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(path, rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 3 * (y * w + x), p = [0, 1, 2].map(r => M[r][0] * rgb[i] + M[r][1] * rgb[i + 1] + M[r][2] * rgb[i + 2]);
    for (let c = 0; c < 3; c++) raw[y * (w * 3 + 1) + 1 + 3 * x + c] = Math.round(255 * Math.min(1, Math.max(0, enc(Math.max(0, p[c])))));
  }
  const chunk = (type, data) => { const t = Buffer.from(type), l = Buffer.alloc(4), c = Buffer.alloc(4); l.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([l, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const configs = { '1-per-pixel': ['--no-spread'], '2-couplers': [], '3-couplers-scatter': ['--scatter'], '0-no-couplers': ['--no-couplers'] };
for (const [name, args] of Object.entries(configs)) {
  const o = join(out, `${film}-${name}.f32`);
  execFileSync(bin, ['render', pack, film, inp, String(CW), String(CH), o, '--pixel-um', String(pixelUm), ...args]);
  png(join(out, `${film}-${name}.png`), new Float32Array(readFileSync(o).buffer.slice(0)), CW, CH);
  console.log(join(out, `${film}-${name}.png`));
}
