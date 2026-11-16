// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { cameraAutoWb, wbPreset } from './WhiteBalanceControls';
import { temperatureTint, whiteXy } from '../engine/whitebalance';

describe('white balance menu', () => {
  it('offers Camera Auto only when the file records it', () => {
    expect(cameraAutoWb(null)).toBeNull();
    expect(cameraAutoWb(undefined)).toBeNull();
    const auto = cameraAutoWb(whiteXy(5200, 4))!;
    expect(auto.temperature).toBeCloseTo(5200, 0);
    expect(auto.tint).toBeCloseTo(4, 1);
    expect(auto).toEqual(temperatureTint(whiteXy(5200, 4)));
  });

  it('names the entry a white balance is', () => {
    const auto = cameraAutoWb(whiteXy(5200, 4));
    expect(wbPreset(null, auto)).toBe('as-shot');
    expect(wbPreset(auto, auto)).toBe('camera-auto');
    // Saved through JSON it is the same.
    expect(wbPreset(JSON.parse(JSON.stringify(auto)), auto)).toBe('camera-auto');
    expect(wbPreset({ temperature: 5500, tint: 0 }, auto)).toBe('daylight');
    expect(wbPreset({ temperature: 5500, tint: 0 }, null)).toBe('daylight');
    // Moved off it with the sliders: custom.
    expect(wbPreset({ ...auto!, temperature: auto!.temperature + 40 }, auto)).toBe('custom');
    expect(wbPreset({ temperature: 5210, tint: 4 }, null)).toBe('custom');
  });
});
