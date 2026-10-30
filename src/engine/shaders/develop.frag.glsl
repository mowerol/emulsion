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
// The part of the image on screen when zoomed: offset xy, size zw, in image coordinates.
uniform vec4 uView;
// 1 marks clipped pixels: red where any channel is at white, blue where all are at black.
uniform float uClipShow;
// Split before/after: screen x (0 to 1) left of which the original shows; below 0, off.
uniform float uSplit;

void main() {
  vec2 uv = clamp(uView.xy + vUv * uView.zw, 0.0, 1.0);
  vec3 x = stageInput(texture(uSrc, uv));
  if (uCompare > 0.5 || vUv.x < uSplit) {
    outColor = vec4(stageOutput(stageToneNeutral(x)), 1.0);
    return;
  }
  // Scene light
  x = stageSharpen(x, uv);
  x = stageExposure(x);
  x = stageToneEqualizer(x, uv);
  x = stageColorBalance(x);
  x = stageLens(x, uv);
  x = stageOptics(x, uv);
  x = stageEmulsion(x);
  // Print
  vec3 e = stagePrint(stageTone(x));
  // Display
  vec3 d = stageOutput(e);
  d = stageGrain(d, uv);
  d = stageScanner(d);
  d = stageCurve(d);
  d = stageFinish(d);
  if (uClipShow > 0.5) {
    if (max(d.r, max(d.g, d.b)) >= 254.5 / 255.0) d = vec3(1.0, 0.18, 0.12);
    else if (max(d.r, max(d.g, d.b)) <= 0.5 / 255.0) d = vec3(0.15, 0.35, 1.0);
  }
  outColor = vec4(d, 1.0);
}
