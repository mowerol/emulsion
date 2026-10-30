#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// The develop pass. Each stage lives in its own file under stages/ so modules
// can be replaced independently (see docs/ARCHITECTURE.md).
#include "common.glsl"
#include "stages/tone.glsl"
#include "stages/clarity.glsl"
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
// Crop and straighten: the source point under a frame point f is (dot(uGeoU, (f, 1)), dot(uGeoV, (f, 1))).
uniform vec3 uGeoU;
uniform vec3 uGeoV;
// Display colour for frame pixels off the photo (only while cropping).
uniform vec3 uOutside;
// 1 renders the clarity filter's input instead: the print's lightness in .r.
uniform float uClarityOut;

void main() {
  vec3 f = vec3(uView.xy + vUv * uView.zw, 1.0);
  vec2 uv = vec2(dot(uGeoU, f), dot(uGeoV, f));
  vec2 edge = 0.5 / vec2(textureSize(uSrc, 0));
  if (any(lessThan(uv, -edge)) || any(greaterThan(uv, 1.0 + edge))) {
    outColor = vec4(uOutside, 1.0);
    return;
  }
  uv = clamp(uv, 0.0, 1.0);
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
  vec3 e = stageTone(x);
  if (uClarityOut > 0.5) {
    outColor = vec4(clarityLightness(e), 0.0, 0.0, 1.0);
    return;
  }
  e = stagePrint(stageClarity(e, uv));
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
