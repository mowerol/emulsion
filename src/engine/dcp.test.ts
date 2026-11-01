// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import native from './fixtures/dcp-native.json';
import {
  dcpCameraToXyz,
  dcpHsd,
  dcpLateProphoto,
  dcpWhite,
  dcpTemperature,
  parseDcp,
  toneCurve,
  type DcpProfile,
  type DcpTable,
} from './dcp';
import type { Mat3, Vec3 } from '../film/stocks';
import { readFileSync } from 'node:fs';
const table = (t: (typeof native.tables)[number]): DcpTable => ({
  dims: t.dims as Vec3,
  gamma: t.gamma,
  data: new Float32Array(t.data),
});
const profile = (forward = false): DcpProfile => ({
  name: 'Reference',
  camera: 'Test',
  copyright: 'Test',
  matrix1: native.matrix1 as Mat3,
  matrix2: native.matrix2 as Mat3,
  forward1: forward ? (native.forward1 as Mat3) : null,
  forward2: forward ? (native.forward2 as Mat3) : null,
  temperature1: 2850,
  temperature2: 6500,
  map1: null,
  map2: null,
  look: null,
  curve: null,
  exposure: 0,
});
const close = (a: number[], b: number[], digits = 5) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
describe('RawTherapee DCP profile', () => {
  it('reads a complete DCP with dual matrices, tables, baseline exposure and tone curve', () => {
    const bytes = readFileSync(new URL('./fixtures/synthetic.dcp', import.meta.url));
    const p = parseDcp(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(p.name).toBe('Camera Standard');
    expect(p.camera).toBe('Test Camera');
    expect(p.matrix1).toEqual(native.matrix1);
    expect(p.matrix2).toEqual(native.matrix2);
    expect(p.forward1).toEqual(native.forward1);
    expect(p.forward2).toEqual(native.forward2);
    expect([p.temperature1, p.temperature2, p.exposure]).toEqual([2850, 6500, 0.25]);
    expect(p.map1?.dims).toEqual([4, 3, 3]);
    expect(p.map1?.gamma).toBe(true);
    expect(p.look?.data).toEqual(p.map1?.data);
    expect(p.curve?.length).toBe(65536);
    expect(p.curve![32768]).toBeGreaterThan(0.69);
  });
  it('matches native dual-illuminant matrices, with and without forward matrices', () => {
    for (const c of native.matrices) {
      const p = profile(c.forward),
        n = c.neutral as Vec3;
      close(dcpWhite(p, n), c.expected.whiteXY, 10);
      expect(dcpTemperature(dcpWhite(p, n))).toBeCloseTo(c.expected.temperature, 6);
      close(dcpCameraToXyz(p, n).flat(), c.expected.cameraToXyzD50.flat(), 9);
    }
  });
  it('matches native 2.5D and 3D HSV table interpolation, gamma, seams and HDR extrapolation', () => {
    for (const t of native.tables)
      for (let i = 0; i < t.inputs.length; i++) close(dcpHsd(table(t), t.inputs[i] as Vec3), t.outputs[i], 4);
  });
  it('matches native baseline exposure, look table and Adobe tone curve, including OOG rules', () => {
    for (const c of native.step2) {
      const p = {
        exposure: Math.log2(c.scale),
        look: c.look ? table(c.table) : null,
        curve: c.tone ? toneCurve(c.points) : null,
      };
      for (let i = 0; i < c.inputs.length; i++) close(dcpLateProphoto(c.inputs[i] as Vec3, p), c.outputs[i], 4);
    }
  });
  it('rejects malformed profiles before they can enter processing', () => {
    for (const bytes of [
      new ArrayBuffer(0),
      new Uint8Array([73, 73, 42, 0, 255, 255, 255, 127]).buffer,
      new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]).buffer,
    ])
      expect(() => parseDcp(bytes)).toThrow();
  });
});
