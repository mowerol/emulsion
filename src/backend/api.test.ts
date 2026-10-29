// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { HEADER_BYTES, parsePayload } from './api';

describe('image payload', () => {
  it('parses the header and pixel view', () => {
    const w = 3, h = 2;
    const buf = new ArrayBuffer(HEADER_BYTES + w * h * 8);
    const dv = new DataView(buf);
    dv.setUint32(0, w, true);
    dv.setUint32(4, h, true);
    dv.setUint32(8, 0, true);
    new Uint16Array(buf, HEADER_BYTES)[0] = 0x3c00;
    const img = parsePayload(buf);
    expect([img.width, img.height, img.mode]).toEqual([3, 2, 0]);
    expect(img.data.length).toBe(w * h * 4);
    expect(img.data[0]).toBe(0x3c00);
  });

  it('rejects truncated payloads', () => {
    const buf = new ArrayBuffer(HEADER_BYTES + 8);
    const dv = new DataView(buf);
    dv.setUint32(0, 4, true);
    dv.setUint32(4, 4, true);
    expect(() => parsePayload(buf)).toThrow(/expected/);
    expect(() => parsePayload(new ArrayBuffer(4))).toThrow(/short/);
  });
});
