// SPDX-License-Identifier: GPL-3.0-or-later
// Texture ownership for the RawTherapee DCP stages. Tables are exact samples, not baked RGB LUTs.
import type { Uniforms } from './params';
import type { Gpu, Target } from './gpu';
import { columnMajor } from './color';
import { dcpCommit, dcpGammaData, TO_PROPHOTO, FROM_PROPHOTO, type DcpState, type DcpTable } from './dcp';
import type { CameraMetadata, CameraProfileId } from '../film/profiles';
import { profileFor } from './profilestore';

export const DCP_CAL_UNIT = 12,
  DCP_LOOK_UNIT = 13,
  DCP_CURVE_UNIT = 14,
  DCP_GAMMA_UNIT = 15;
/** Where a caller keeps the early pass's result (one per engine lane). */
export interface ProfileEarly {
  early: { input: WebGLTexture; key: string; out: Target } | null;
}

export class ProfileGpu {
  private state: DcpState | null = null;
  private gamma: WebGLTexture | null = null;
  private textures: WebGLTexture[] = [];
  constructor(private gpu: Gpu) {}
  private table(t: DcpTable | null): WebGLTexture {
    const g = this.gpu,
      gl = g.gl,
      tex = gl.createTexture()!;
    g.scratch();
    gl.bindTexture(gl.TEXTURE_3D, tex);
    const n = t ? t.data.length / 3 : 1,
      data = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      data[i * 4] = t?.data[i * 3] ?? 0;
      data[i * 4 + 1] = t?.data[i * 3 + 1] ?? 1;
      data[i * 4 + 2] = t?.data[i * 3 + 2] ?? 1;
    }
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGBA32F,
      t?.dims[1] ?? 1,
      t?.dims[0] ?? 1,
      t?.dims[2] ?? 1,
      0,
      gl.RGBA,
      gl.FLOAT,
      data,
    );
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
      gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.textures.push(tex);
    return tex;
  }
  resolve(choice: CameraProfileId, camera?: CameraMetadata | null, temperature?: number, auto?: string): DcpState | null {
    const selected = profileFor(choice, camera, auto);
    if (!selected || !camera) return null;
    const key = `${selected.id}|${JSON.stringify(camera)}|${temperature ?? ''}`;
    if (this.state?.key === key) return this.state;
    const state = dcpCommit(selected.profile, camera, selected.id, temperature);
    this.upload(state);
    return state;
  }
  /** Upload a committed profile state, preserving its exact calibration and tone samples. */
  upload(state: DcpState) {
    if (this.state?.key === state.key) return;
    for (const tex of this.textures) this.gpu.gl.deleteTexture(tex);
    this.textures = [];
    this.state = state;
    if (!this.gamma) {
      const gl = this.gpu.gl;
      this.gamma = gl.createTexture()!;
      this.gpu.scratch();
      gl.bindTexture(gl.TEXTURE_2D, this.gamma);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 256, 256, 0, gl.RGBA, gl.FLOAT, dcpGammaData());
      this.gpu.params(false);
    }
    this.table(state.map);
    this.table(state.profile.look);
    const gl = this.gpu.gl,
      tex = gl.createTexture()!;
    this.gpu.scratch();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      256,
      256,
      0,
      gl.RED,
      gl.FLOAT,
      state.profile.curve ?? new Float32Array(65536),
    );
    this.gpu.params(false);
    this.textures.push(tex);
  }
  uniforms(state: DcpState | null): Uniforms {
    if (!state)
      return {
        uDcpOn: 0,
        uDcpHasCurve: 0,
        uDcpCal: DCP_CAL_UNIT,
        uDcpLook: DCP_LOOK_UNIT,
        uDcpCurve: DCP_CURVE_UNIT,
        uDcpGamma: DCP_GAMMA_UNIT,
      };
    const dims = (t: DcpTable | null) => (t ? [...t.dims, t.gamma ? 1 : 0] : [1, 2, 1, 0]);
    return {
      uDcpOn: 1,
      uDcpHasCal: state.map ? 1 : 0,
      uDcpHasLook: state.profile.look ? 1 : 0,
      uDcpHasCurve: state.profile.curve ? 1 : 0,
      uDcpExposure: 2 ** state.profile.exposure,
      uDcpScale: state.scale,
      uDcpMatrix: columnMajor(state.matrix),
      uDcpToCamera: columnMajor(state.toCamera),
      uDcpToProPhoto: columnMajor(TO_PROPHOTO),
      uDcpFromProPhoto: columnMajor(FROM_PROPHOTO),
      uDcpCalDims: dims(state.map),
      uDcpLookDims: dims(state.profile.look),
      uDcpCal: DCP_CAL_UNIT,
      uDcpLook: DCP_LOOK_UNIT,
      uDcpCurve: DCP_CURVE_UNIT,
      uDcpGamma: DCP_GAMMA_UNIT,
    };
  }
  bind(state: DcpState | null) {
    if (!state) {
      this.gpu.bind3d(DCP_CAL_UNIT, null);
      this.gpu.bind3d(DCP_LOOK_UNIT, null);
      this.gpu.bind(DCP_CURVE_UNIT, this.gpu.blackTexture);
      this.gpu.bind(DCP_GAMMA_UNIT, this.gpu.blackTexture);
    } else {
      this.gpu.bind3d(DCP_CAL_UNIT, this.textures[0]);
      this.gpu.bind3d(DCP_LOOK_UNIT, this.textures[1]);
      this.gpu.bind(DCP_CURVE_UNIT, this.textures[2]);
      this.gpu.bind(DCP_GAMMA_UNIT, this.gamma!);
    }
  }
  source(cache: ProfileEarly, input: WebGLTexture, key: string, w: number, h: number, draw: (target: Target) => void): Target {
    if (cache.early?.input === input && cache.early.key === key) return cache.early.out;
    if (cache.early) this.gpu.free(cache.early.out);
    const out = this.gpu.target(w, h, true);
    draw(out);
    this.gpu.scratch();
    const gl = this.gpu.gl;
    gl.bindTexture(gl.TEXTURE_2D, out.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.gpu.params(true);
    cache.early = { input, key, out };
    return out;
  }
  dispose() {
    if (this.gamma) this.gpu.gl.deleteTexture(this.gamma);
    for (const tex of this.textures) this.gpu.gl.deleteTexture(tex);
  }
}
