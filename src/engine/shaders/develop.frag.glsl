#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// The develop pass. Each stage lives in its own file under stages/ so modules
// can be replaced independently (see docs/ARCHITECTURE.md).
#include "common.glsl"
#include "stages/tone.glsl"
#include "stages/input.glsl"
#include "stages/optics.glsl"
#include "stages/exposure.glsl"
#include "stages/toneequalizer.glsl"
#include "stages/colorbalance.glsl"
#include "stages/lens.glsl"
#include "stages/emulsion.glsl"
#include "stages/output.glsl"
#include "stages/grain.glsl"
#include "stages/scanner.glsl"
#include "stages/curve.glsl"
#include "stages/finish.glsl"

uniform sampler2D uSrc;
// 1 shows the original: input and output only.
uniform float uCompare;

void main() {
  vec3 x = stageInput(texture(uSrc, vUv));
  if (uCompare > 0.5) {
    outColor = vec4(stageOutput(stageToneNeutral(x)), 1.0);
    return;
  }
  // Scene light
  x = stageSharpen(x, vUv);
  x = stageExposure(x);
  x = stageToneEqualizer(x, vUv);
  x = stageColorBalance(x);
  x = stageLens(x, vUv);
  x = stageOptics(x, vUv);
  x = stageEmulsion(x);
  // Print
  vec3 e = stagePrint(stageTone(x));
  // Display
  vec3 d = stageOutput(e);
  d = stageGrain(d, vUv);
  d = stageScanner(d);
  d = stageCurve(d);
  outColor = vec4(stageFinish(d), 1.0);
}
