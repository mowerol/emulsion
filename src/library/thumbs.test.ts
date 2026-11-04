// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureCapture } from './thumbs';
import { InputMode } from '../engine/params';

const api = vi.hoisted(() => ({ captureInfo: vi.fn(), logToTerminal: vi.fn() }));
vi.mock('../backend/api', async importOriginal => ({ ...await importOriginal<typeof import('../backend/api')>(), ...api }));

beforeEach(() => { api.captureInfo.mockReset(); api.logToTerminal.mockReset(); });
describe('capture metadata preparation', () => {
  it('shares sensor metadata between idle preparation and an early foreground zoom', async () => {
    let resolve!: (v: { radius: number; toCam: number[]; mask: Uint8Array }) => void;
    api.captureInfo.mockImplementation(() => new Promise(r => { resolve = r; }));
    const src = { mode: InputMode.SceneLinear, w: 100, h: 80, capture: false };
    const eng = { attachCapture: vi.fn(() => { src.capture = true; }) };
    const background = ensureCapture(eng, src, 'photo.raf');
    const foreground = ensureCapture(eng, src, 'photo.raf');
    expect(foreground).toBe(background);
    resolve({ radius: .7, toCam: [], mask: new Uint8Array() });
    expect(await foreground).toBe(true);
    expect(api.captureInfo).toHaveBeenCalledOnce();
    expect(eng.attachCapture).toHaveBeenCalledOnce();
    expect(await ensureCapture(eng, src, 'photo.raf')).toBe(true);
    expect(api.captureInfo).toHaveBeenCalledOnce();
  });

  it('allows a failed preparation to retry', async () => {
    api.captureInfo.mockRejectedValueOnce(Error('read failed')).mockResolvedValueOnce({ radius: .7, toCam: [], mask: new Uint8Array() });
    const src = { mode: InputMode.SceneLinear, w: 100, h: 80 };
    const eng = { attachCapture: vi.fn() };
    expect(await ensureCapture(eng, src, 'photo.raf')).toBe(false);
    expect(await ensureCapture(eng, src, 'photo.raf')).toBe(true);
    expect(api.captureInfo).toHaveBeenCalledTimes(2);
    expect(eng.attachCapture).toHaveBeenCalledOnce();
  });
});
