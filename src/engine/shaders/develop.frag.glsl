#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// The develop pass. Each stage lives in its own file under stages/ so modules
// can be replaced independently (see docs/ARCHITECTURE.md).
uniform sampler2D uSrc;

#include "common.glsl"
#include "stages/tone.glsl"
#include "stages/clarity.glsl"
#include "stages/usm.glsl"
#include "stages/input.glsl"
#include "stages/optics.glsl"
#include "stages/exposure.glsl"
#include "stages/toneequalizer.glsl"
#include "stages/dehaze.glsl"
#include "stages/texture.glsl"
#include "stages/colorbalance.glsl"
#include "stages/masks.glsl"
#include "stages/colorequal.glsl"
#include "stages/lens.glsl"
#include "stages/output.glsl"
#include "stages/lut.glsl"
#include "stages/dcp.glsl"
#include "stages/grain.glsl"
#include "stages/scanner.glsl"
#include "stages/curve.glsl"
#include "stages/finish.glsl"

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
uniform vec3 uGeoW;
// Display colour for frame pixels off the photo (only while cropping).
uniform vec3 uOutside;
// Renders a multi-scale filter's input instead, over the whole source: 1, the print's
// lightness for clarity (0 to 1); 2, the scene's L* for texture; 3, the print's lightness
// after clarity, for sharpening (0 to 1); 4, the colour equalizer's analysis (ceAnalyse); 5, the
// scene after the masks' exposure instances, for the range picker (the engine leaves out the
// picked mask and those after it, so this is that mask's exposure instance's input); 6, mask
// uMaskTap's exposure instance's input and its unrefined value, for mask refinement; 7, the
// scene's L* after Texture (the photo's and earlier masks' instances) with mask uTapMask's value
// in .g, a masked Texture instance's input; 8, the print's lightness after Clarity likewise; 9
// and 10, a masked haze removal instance's input and mask (see main).
uniform float uTap;
uniform float uTapMask;
// 1 shows Sharpening's contrast mask as grey instead of the photo.
uniform float uUsmShowMask;

void main() {
  vec3 f = vec3(uView.xy + vUv * uView.zw, 1.0);
  float denominator = dot(uGeoW, f);
  if (abs(denominator) < 1e-8) { outColor = vec4(uOutside, 1.0); return; }
  vec2 uv = vec2(dot(uGeoU, f), dot(uGeoV, f)) / denominator;
  vec2 edge = 0.5 / vec2(textureSize(uSrc, 0));
  if (any(lessThan(uv, -edge)) || any(greaterThan(uv, 1.0 + edge))) {
    outColor = vec4(uOutside, 1.0);
    return;
  }
  uv = clamp(uv, 0.0, 1.0);
  if (uUsmShowMask > 0.5) {
    outColor = vec4(vec3(usmMask(uv)), 1.0);
    return;
  }
  vec3 x = stageInput(texture(uSrc, uv));
  if (uCompare > 0.5 || vUv.x < uSplit) {
    vec3 original = stageDcpLate(x);
    vec3 originalPrint = uDcpHasCurve > 0.5 ? srgbOetf(max(original, vec3(0.0))) : stageToneNeutral(original);
    outColor = vec4(stageOutput(originalPrint), 1.0);
    return;
  }
  computeMasks(uv, vec2(textureSize(uSrc, 0)));
  if (uTap > 8.5) {
    // A masked haze removal instance's input (the instances before it bound as uDehazeTex) and
    // its mask there: 9, the input and the unrefined mask, for refining it; 10, the mask.
    vec3 xin = stageDehaze(x, uv);
    int i = int(uTapMask + 0.5);
    if (uTap < 9.5) outColor = vec4(xin, maskAt(i, xin));
    else outColor = vec4(uMaskLocal[i].z > 0.5 ? maskRefinedDehaze(i, uv) : maskAt(i, xin), 0.0, 0.0, 1.0);
    return;
  }
  // Scene light
  x = stageSharpen(x, uv);
  x = stageDehaze(x, uv);
  x = stageExposure(x);
  x = stageMaskExposure(x);
  if (uTap > 5.5 && uTap < 6.5) {
    outColor = gMaskTapOut;
    return;
  }
  if (uTap > 4.5 && uTap < 5.5) {
    outColor = vec4(x, 1.0);
    return;
  }
  x = stageToneEqualizer(x, uv);
  x = stageMaskToneEqualizer(x, uv);
  if (uTap > 1.5 && uTap < 2.5) {
    outColor = vec4(labL(x), 0.0, 0.0, 1.0);
    return;
  }
  x = stageTexture(x, uv);
  if (uTap > 6.5 && uTap < 7.5) {
    outColor = vec4(labL(x), gMaskFinal[int(uTapMask + 0.5)], 0.0, 1.0);
    return;
  }
  if (uTap > 3.5 && uTap < 4.5) {
    outColor = ceAnalyse(x);
    return;
  }
  x = stageColorEqual(x, uv);
  x = stageProfileColorBalance(x);
  x = stageColorBalance(x);
  x = stageMaskColorBalance(x);
  x = stageLens(x, uv);
  x = stageOptics(x, uv);
  // The camera profile renders the print, then the optional look applies to it.
  vec3 e;
  vec3 base = stageDcpLate(x);
  if (uDcpHasCurve > 0.5) {
    e = srgbOetf(max(base, vec3(0.0)));
    if (uProfileTargetsOn > 0.5) e = stageToneProfile(vec3(toneInverse(e.r), toneInverse(e.g), toneInverse(e.b)));
  } else e = stageToneProfile(base);
  if (uLutOn > 0.5) e = stageLookPrint(e);
  if (uTap > 0.5 && uTap < 1.5) {
    outColor = vec4(clarityLightness(e), 0.0, 0.0, 1.0);
    return;
  }
  e = stageClarity(e, uv);
  if (uTap > 7.5 && uTap < 8.5) {
    outColor = vec4(clarityLightness(e), gMaskFinal[int(uTapMask + 0.5)], 0.0, 1.0);
    return;
  }
  if (uTap > 2.5 && uTap < 3.5) {
    outColor = vec4(clarityLightness(e), 0.0, 0.0, 1.0);
    return;
  }
  e = stageUnsharpMask(e, uv);
  e = stageGrain(e, uv);
  // Display
  vec3 d = stageOutput(e);
  d = stageScanner(d);
  d = stageCurve(d);
  d = stageFinish(d);
  d = maskOverlay(d);
  if (uClipShow > 0.5) {
    if (max(d.r, max(d.g, d.b)) >= 254.5 / 255.0) d = vec3(1.0, 0.18, 0.12);
    else if (max(d.r, max(d.g, d.b)) <= 0.5 / 255.0) d = vec3(0.15, 0.35, 1.0);
  }
  outColor = vec4(d, 1.0);
}
