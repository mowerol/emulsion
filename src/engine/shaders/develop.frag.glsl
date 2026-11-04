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
// and 10, a masked haze removal instance's input and mask (see main); 11, tap 3 resumed from
// the print tap 1 wrote to outPrint, bound as uSrc (the same operations on the same values, so
// Sharpening's input costs one clarity step instead of a develop pass). With detail before
// Exposure (uTextureLog): 12, Clarity's input, the log lightness after Texture's change; 13, a
// masked Clarity instance's, after the instances before it, with the mask's value in .g;
// 14, the colour equalizer's RGB change for a live regional stand-in.
uniform float uTap;
// Tap 1 also writes the print it measured (Clarity's input) here, when a second target is bound.
layout(location = 1) out vec4 outPrint;
uniform float uTapMask;
// 1 shows Sharpening's contrast mask as grey instead of the photo.
uniform float uUsmShowMask;
// The part of the whole source the source texture holds (offset xy, size zw, in whole-source
// coordinates): (0, 0, 1, 1) for a whole source, a region at full size otherwise (docs/plans/
// roi.md). Position on the photo (masks, the tone equalizer map, vignette, halation, glow, grain)
// is in the whole source; the source and the maps made from it are read in the region.
uniform vec4 uRoi;

void main() {
  vec3 f = vec3(uView.xy + vUv * uView.zw, 1.0);
  float denominator = dot(uGeoW, f);
  if (abs(denominator) < 1e-8) { outColor = vec4(uOutside, 1.0); return; }
  vec2 uv = vec2(dot(uGeoU, f), dot(uGeoV, f)) / denominator;
  vec2 whole = vec2(textureSize(uSrc, 0)) / uRoi.zw;
  vec2 edge = 0.5 / whole;
  if (any(lessThan(uv, -edge)) || any(greaterThan(uv, 1.0 + edge))) {
    outColor = vec4(uOutside, 1.0);
    return;
  }
  uv = clamp(uv, 0.0, 1.0);
  vec2 ruv = (uv - uRoi.xy) / uRoi.zw;
  if (uTap > 10.5 && uTap < 11.5) {
    vec3 print = stageClarity(texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0).rgb, ruv);
    outColor = vec4(clarityLightness(print), 0.0, 0.0, 1.0);
    return;
  }
  if (uUsmShowMask > 0.5) {
    outColor = vec4(vec3(usmMask(ruv)), 1.0);
    return;
  }
  vec3 x = stageInput(texture(uSrc, ruv));
  if (uCompare > 0.5 || vUv.x < uSplit) {
    vec3 original = stageDcpLate(x);
    vec3 originalPrint = uDcpHasCurve > 0.5 ? srgbOetf(max(original, vec3(0.0))) : stageToneNeutral(original);
    outColor = vec4(stageOutput(originalPrint), 1.0);
    return;
  }
  computeMasks(uv, whole);
  if (uTap > 8.5 && uTap < 10.5) {
    // A masked haze removal instance's input (the instances before it bound as uDehazeTex) and
    // its mask there: 9, the input and the unrefined mask, for refining it; 10, the mask.
    vec3 xin = stageDehaze(x, ruv);
    int i = int(uTapMask + 0.5);
    if (uTap < 9.5) outColor = vec4(xin, maskAt(i, xin));
    else outColor = vec4(uMaskLocal[i].z > 0.5 ? maskRefinedDehaze(i, uv) : maskAt(i, xin), 0.0, 0.0, 1.0);
    return;
  }
  // Scene light
  x = stageSharpen(x, ruv);
  x = stageDehaze(x, ruv);
  // With detail before Exposure, Texture's input is the log lightness here (detaillog.glsl).
  vec3 preExposure = x;
  if (uTextureLog > 0.5 && uTap > 1.5 && uTap < 2.5) {
    outColor = vec4(logLightness(x), 0.0, 0.0, 1.0);
    return;
  }
  if (uTap > 11.5 && uTap < 12.5) {
    outColor = vec4(clarityLogInput(x, uTextureOn > 0.5 ? texture(uTextureTex, ruv).r : 0.0), 0.0, 0.0, 1.0);
    return;
  }
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
  if (uTap > 12.5 && uTap < 13.5) {
    float du = uTextureOn > 0.5 ? texture(uTextureTex, ruv).r : 0.0;
    float acc = uClarityOn > 0.5 ? texture(uClarityTex, ruv).r : 0.0;
    outColor = vec4(clamp(clarityLogInput(preExposure, du) + acc, LL_LOG_RANGE.x, LL_LOG_RANGE.y), gMaskFinal[int(uTapMask + 0.5)], 0.0, 1.0);
    return;
  }
  if (uTextureLog > 0.5 && uTap > 6.5 && uTap < 7.5) {
    // A masked instance's input in log lightness: before Exposure, plus the instances before it.
    float acc = uTextureOn > 0.5 ? texture(uTextureTex, ruv).r : 0.0;
    outColor = vec4(logLightness(preExposure) + acc, gMaskFinal[int(uTapMask + 0.5)], 0.0, 1.0);
    return;
  }
  x = stageTexture(x, ruv);
  if (uTap > 6.5 && uTap < 7.5) {
    outColor = vec4(labL(x), gMaskFinal[int(uTapMask + 0.5)], 0.0, 1.0);
    return;
  }
  if (uTap > 3.5 && uTap < 4.5) {
    outColor = ceAnalyse(x);
    return;
  }
  if (uTap > 13.5) {
    // Live colour stand-in: the effect's change, not the preview's finished pixels.
    outColor = vec4(stageColorEqual(x, ruv) - x, 1.0);
    return;
  }
  x = stageColorEqual(x, ruv);
  x = stageProfileColorBalance(x);
  x = stageColorBalance(x);
  x = stageMaskColorBalance(x);
  x = stageLens(x, uv);
  x = stageOptics(x, uv);
  x = stageClarityLog(x, ruv);
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
    outPrint = vec4(e, 1.0);
    return;
  }
  if (uTextureLog < 0.5) e = stageClarity(e, ruv);
  if (uTap > 7.5 && uTap < 8.5) {
    outColor = vec4(clarityLightness(e), gMaskFinal[int(uTapMask + 0.5)], 0.0, 1.0);
    return;
  }
  if (uTap > 2.5 && uTap < 3.5) {
    outColor = vec4(clarityLightness(e), 0.0, 0.0, 1.0);
    return;
  }
  e = stageUnsharpMask(e, ruv);
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
