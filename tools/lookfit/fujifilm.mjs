// SPDX-License-Identifier: GPL-3.0-or-later
// Reads the JPEG settings a Fujifilm camera records in its makernotes (tag numbers and values
// from ExifTool's FujiFilm tag table, https://exiftool.org/TagNames/FujiFilm.html).
import { openSync, readSync, closeSync } from 'node:fs';

const FILM = { 0x0: 'Provia', 0x100: 'Studio Portrait', 0x110: 'Studio Portrait Enhanced Saturation', 0x120: 'Astia', 0x200: 'Velvia', 0x300: 'Astia', 0x400: 'Velvia', 0x500: 'Pro Neg. Std', 0x501: 'Pro Neg. Hi', 0x600: 'Classic Chrome', 0x700: 'Eterna', 0x800: 'Classic Negative', 0x900: 'Bleach Bypass', 0xa00: 'Nostalgic Neg', 0xb00: 'Reala ACE' };
const MONO = { 0x300: 'B&W', 0x301: 'B&W Red', 0x302: 'B&W Yellow', 0x303: 'B&W Green', 0x310: 'Sepia', 0x500: 'Acros', 0x501: 'Acros Red', 0x502: 'Acros Yellow', 0x503: 'Acros Green' };
const SAT = { 0x0: '0', 0x80: '+1', 0x100: '+2', 0xc0: '+3', 0xe0: '+4', 0x180: '-1', 0x400: '-2', 0x4c0: '-3', 0x4e0: '-4' };
// Highlight and shadow tone: negative numbers are harder (ExifTool: -16 = +1, 16 = -1).
const tone = (v) => v === null ? null : `${-v / 16 > 0 ? '+' : ''}${-v / 16}`;
const strength = (v) => v === null ? null : ({ 0: 'Off', 32: 'Weak', 64: 'Strong' })[v] ?? String(v);

function exifSegment(path) {
  const fd = openSync(path, 'r');
  let d = Buffer.alloc(256 * 1024);
  readSync(fd, d, 0, d.length, 0);
  // A RAF carries the camera's JPEG at the offset its header gives; read the settings from that.
  if (d.toString('latin1', 0, 15) === 'FUJIFILMCCD-RAW') {
    const at = d.readUInt32BE(84);
    d = Buffer.alloc(256 * 1024);
    readSync(fd, d, 0, d.length, at);
  }
  closeSync(fd);
  for (let i = 2; i < d.length - 4;) {
    if (d[i] !== 0xff) return null;
    const marker = d[i + 1], len = d.readUInt16BE(i + 2);
    if (marker === 0xe1 && d.toString('latin1', i + 4, i + 10) === 'Exif\0\0') return d.subarray(i + 10, i + 2 + len);
    i += 2 + len;
  }
  return null;
}

function readIfd(t, off, le) {
  const u16 = (o) => le ? t.readUInt16LE(o) : t.readUInt16BE(o);
  const u32 = (o) => le ? t.readUInt32LE(o) : t.readUInt32BE(o);
  const out = new Map();
  for (let k = 0, n = u16(off); k < n; k++) {
    const p = off + 2 + 12 * k;
    out.set(u16(p), { type: u16(p + 2), count: u32(p + 4), at: p + 8, ptr: u32(p + 8) });
  }
  return out;
}

function first(t, e, le) {
  if (!e) return null;
  const size = { 1: 1, 3: 2, 4: 4, 8: 2, 9: 4 }[e.type];
  if (!size) return null;
  const o = size * e.count <= 4 ? e.at : e.ptr;
  switch (e.type) {
    case 1: return t[o];
    case 3: return le ? t.readUInt16LE(o) : t.readUInt16BE(o);
    case 8: return le ? t.readInt16LE(o) : t.readInt16BE(o);
    case 4: return le ? t.readUInt32LE(o) : t.readUInt32BE(o);
    case 9: return le ? t.readInt32LE(o) : t.readInt32BE(o);
  }
  return null;
}

/** The camera's JPEG settings, from a JPEG or from the JPEG inside a RAF, or null when the file
 * has no Fujifilm makernotes. A RAF's `dr` is the DR it was captured at. */
export function fujiSettings(path) {
  try {
    const t = exifSegment(path);
    if (!t) return null;
    const le = t.toString('latin1', 0, 2) === 'II';
    const ifd0 = readIfd(t, le ? t.readUInt32LE(4) : t.readUInt32BE(4), le);
    const exif = readIfd(t, first(t, ifd0.get(0x8769), le), le);
    const note = exif.get(0x927c);
    if (!note) return null;
    const mn = t.subarray(note.ptr);
    if (mn.toString('latin1', 0, 8) !== 'FUJIFILM') return null;
    const tags = readIfd(mn, mn.readUInt32LE(8), true);
    const get = (tag) => first(mn, tags.get(tag), true);
    const sat = get(0x1003), film = get(0x1401);
    const mono = sat !== null && MONO[sat];
    const clarity = get(0x100f);
    return {
      film: mono || (film === null ? null : FILM[film] ?? `0x${film.toString(16)}`),
      highlight: tone(get(0x1041)), shadow: tone(get(0x1040)),
      color: mono ? 'mono' : sat === null ? null : SAT[sat] ?? `0x${sat.toString(16)}`,
      clarity: clarity === null ? null : String(((clarity << 0) | 0) / 1000),
      colorChrome: strength(get(0x1048)), fxBlue: strength(get(0x104e)),
      // DR: the manual setting's development DR, else what DR Auto chose.
      dr: get(0x1403) ?? get(0x140b) ?? null,
    };
  } catch { return null; }
}
