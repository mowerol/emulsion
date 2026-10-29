// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { assemble } from './glsl';
import { SHADERS } from './shaders';

describe('shader assembly', () => {
  it('resolves nested includes once each', () => {
    const files = { 'a.glsl': 'A\n#include "b.glsl"', 'b.glsl': 'B' };
    const out = assemble('#include "a.glsl"\n#include "b.glsl"\nmain', files);
    expect(out.match(/^B$/gm)).toHaveLength(1);
    expect(out).toContain('A');
    expect(out).toContain('main');
  });

  it('fails loudly on a missing include', () => {
    expect(() => assemble('#include "nope.glsl"', {})).toThrow(/nope\.glsl/);
  });

  it('builds every program with the version line first and no includes left', () => {
    for (const [name, src] of Object.entries(SHADERS)) {
      expect(src.startsWith('#version 300 es'), name).toBe(true);
      expect(src.includes('#include'), name).toBe(false);
    }
  });

  it('wires every develop stage', () => {
    for (const fn of ['stageInput', 'stageSharpen', 'stageExposure', 'stageLens', 'stageOptics', 'stageEmulsion', 'stageTone', 'stagePrint', 'stageOutput', 'stageGrain', 'stageScanner', 'stageFinish']) {
      expect(SHADERS.develop).toMatch(new RegExp(`\\b${fn}\\(`));
    }
  });
});
