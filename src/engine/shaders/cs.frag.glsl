#version 300 es
// Copyright (c) 2019 Ingo Weyrich (heckflosse67@gmx.de)
// Ported from RawTherapee rtengine/capturesharpening.cc and rtengine/rt_algo.cc (buildBlendMask)
// at commit b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c. Translated from C++ to GLSL; one
// deconvolution over the whole photo with per-tile early stops. Mirrors src/engine/capture.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Capture sharpening, one step per draw (uMode), on one-channel images:
//  0 luminance Y of the source uS (RawTherapee's RGB2Y of camera RGB)
//  1 lightness L of uS (0 to 32768, RawTherapee's RGB2L)
//  2 the blend mask from uL's local contrast, times the clip mask uClip
//  3 uR through the 1D Gaussian uG along uDir
//  4 per stop tile, 1 if its largest blend (uBl) is under 0.01: left alone
//  5 Y over the estimate uEst blurred by the kernel
//  6 the estimate times the ratio uR blurred by the kernel, unless its tile (uF) has stopped
//  7 per tile column and pixel row, any estimate under half its blended original
// 10 per tile, stopped already (uF) or any of its rows tripped (uR, from 7)
//  8 the source scaled by new over old luminance
//  9 four lightness values of uL per texel, for reading back
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;

uniform int uMode;
uniform sampler2D uS;
uniform sampler2D uY;
uniform sampler2D uL;
uniform sampler2D uClip;
uniform sampler2D uEst;
uniform sampler2D uR;
uniform sampler2D uBl;
uniform sampler2D uF;
uniform mat3 uToCam;
uniform float uThreshold;
uniform float uG[13];
uniform int uGHalf;
uniform ivec2 uDir;
uniform float uK[169];
uniform int uKHalf;
uniform int uBorder;
uniform ivec2 uTiles;

// The working images are all the source's size; set once per pixel in main().
ivec2 gMax;
float at(sampler2D t, ivec2 p) { return texelFetch(t, clamp(p, ivec2(0), gMax), 0).r; }

// RawTherapee's computeXYZ2LabY: L* × 327.68 of camera-scale luminance (65535 = white).
float labY(float y) {
  float f = y / 65535.0;
  return f > 216.0 / 24389.0 ? 327.68 * (116.0 * pow(f, 1.0 / 3.0) - 16.0) : 327.68 * (24389.0 / 27.0) * f;
}

float blendFactor(float val, float threshold) {
  float x = -16.0 + (16.0 / threshold) * val;
  return 0.5 * (1.0 + x / sqrt(1.0 + x * x));
}

// Local contrast in L* / 16 from neighbours one and two away; the outer two rows and columns copy inwards.
float contrastAt(ivec2 p) {
  p = clamp(p, ivec2(2), gMax - 2);
  float a = at(uL, p + ivec2(1, 0)) - at(uL, p - ivec2(1, 0));
  float b = at(uL, p + ivec2(0, 1)) - at(uL, p - ivec2(0, 1));
  float c = at(uL, p + ivec2(2, 0)) - at(uL, p - ivec2(2, 0));
  float d = at(uL, p + ivec2(0, 2)) - at(uL, p - ivec2(0, 2));
  return sqrt(a * a + b * b + c * c + d * d) * 0.0625 / 327.68;
}

// RawTherapee's 2D kernel over a one-channel image, edges clamped.
float kernelAt(sampler2D t, ivec2 p) {
  float s = 0.0;
  int n = 2 * uKHalf + 1;
  for (int j = -uKHalf; j <= uKHalf; j++)
    for (int i = -uKHalf; i <= uKHalf; i++) {
      float w = uK[(j + uKHalf) * n + (i + uKHalf)];
      if (w > 0.0) s += w * at(t, p + ivec2(i, j));
    }
  return s;
}

// The stop tile of a pixel along one axis (tileOf in capture.ts).
int tileOf(int p, int count) { return clamp(p < uBorder ? 0 : (p - uBorder) / 32, 0, count - 1); }

// The pixels of a stop tile along one axis: the first tile takes the border, the last the rest.
ivec2 tileRange(int t, int count, int size) {
  return ivec2(t == 0 ? 0 : uBorder + t * 32, t == count - 1 ? size : uBorder + (t + 1) * 32);
}

bool stoppedAt(ivec2 p) { return texelFetch(uF, ivec2(tileOf(p.x, uTiles.x), tileOf(p.y, uTiles.y)), 0).r > 0.5; }

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  gMax = textureSize(uS, 0) - 1;
  if (uMode == 0) {
    vec3 cam = uToCam * texelFetch(uS, p, 0).rgb;
    outColor = vec4(dot(vec3(0.2627, 0.6780, 0.0593), max(cam, vec3(0.0))), 0.0, 0.0, 1.0);
  } else if (uMode == 1) {
    vec3 cam = uToCam * texelFetch(uS, p, 0).rgb;
    outColor = vec4(labY(dot(vec3(0.212671, 0.715160, 0.072169), cam)), 0.0, 0.0, 1.0);
  } else if (uMode == 2) {
    float clip = at(uClip, clamp(p, ivec2(2), gMax - 2));
    outColor = vec4(uThreshold == 0.0 ? 1.0 : clip * blendFactor(contrastAt(p), uThreshold), 0.0, 0.0, 1.0);
  } else if (uMode == 3) {
    float s = 0.0;
    for (int i = -uGHalf; i <= uGHalf; i++) {
      s += uG[i + uGHalf] * at(uR, p + i * uDir);
    }
    outColor = vec4(s, 0.0, 0.0, 1.0);
  } else if (uMode == 4) {
    ivec2 size = textureSize(uBl, 0);
    ivec2 xr = tileRange(p.x, uTiles.x, size.x);
    ivec2 yr = tileRange(p.y, uTiles.y, size.y);
    float m = 0.0;
    for (int y = yr.x; y < yr.y; y++)
      for (int x = xr.x; x < xr.y; x++) m = max(m, texelFetch(uBl, ivec2(x, y), 0).r);
    outColor = vec4(m < 0.01 ? 1.0 : 0.0, 0.0, 0.0, 1.0);
  } else if (uMode == 5) {
    outColor = vec4(texelFetch(uY, p, 0).r / max(kernelAt(uEst, p), 0.00001), 0.0, 0.0, 1.0);
  } else if (uMode == 6) {
    float est = texelFetch(uEst, p, 0).r;
    outColor = vec4(stoppedAt(p) ? est : est * kernelAt(uR, p), 0.0, 0.0, 1.0);
  } else if (uMode == 7) {
    ivec2 xr = tileRange(p.x, uTiles.x, gMax.x + 1);
    float stop = 0.0;
    for (int x = xr.x; x < xr.y; x++) {
      ivec2 q = ivec2(x, p.y);
      if (texelFetch(uEst, q, 0).r < texelFetch(uY, q, 0).r * texelFetch(uBl, q, 0).r * 0.5) {
        stop = 1.0;
        break;
      }
    }
    outColor = vec4(stop, 0.0, 0.0, 1.0);
  } else if (uMode == 10) {
    float stop = texelFetch(uF, p, 0).r;
    ivec2 yr = tileRange(p.y, uTiles.y, gMax.y + 1);
    for (int y = yr.x; y < yr.y && stop < 0.5; y++) stop = max(stop, texelFetch(uR, ivec2(p.x, y), 0).r);
    outColor = vec4(stop, 0.0, 0.0, 1.0);
  } else if (uMode == 8) {
    ivec2 size = textureSize(uS, 0);
    vec4 src = texelFetch(uS, p, 0);
    float Y = texelFetch(uY, p, 0).r;
    bool inside = all(greaterThanEqual(p, ivec2(uBorder))) && all(lessThan(p, size - uBorder));
    float k = inside ? mix(Y, texelFetch(uEst, p, 0).r, texelFetch(uBl, p, 0).r) / max(Y, 0.00001) : 1.0;
    outColor = vec4(src.rgb * k, src.a);
  } else {
    ivec2 size = textureSize(uL, 0);
    vec4 o;
    for (int k = 0; k < 4; k++) o[k] = texelFetch(uL, ivec2(min(4 * p.x + k, size.x - 1), p.y), 0).r;
    outColor = o;
  }
}
