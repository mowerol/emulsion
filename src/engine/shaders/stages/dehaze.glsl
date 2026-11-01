// SPDX-License-Identifier: GPL-3.0-or-later
// Darktable haze removal, adapted from src/iop/hazeremoval.c.
// The dark channel window follows darktable's w1=2+ceil(4*wscale) at preview
// scale. The dark channel itself is precomputed by dehaze.frag.glsl; this stage
// only evaluates the slider-dependent transmission and local refinement.

uniform float uDehazeOn;
uniform float uDehazeStrength;
uniform float uDehazeDistance;
uniform vec3 uDehazeA0;
uniform sampler2D uDehazeTex;

float dehazeDark(vec2 p) { return texture(uDehazeTex, p).r; }

float dehazeTransmission(vec2 p, vec2 texel) {
  float dark = dehazeDark(p);
  float a = max(min(uDehazeA0.r, min(uDehazeA0.g, uDehazeA0.b)), 1e-4);
  float t = 1.0 - dark / a * uDehazeStrength;

  // Darktable takes a box maximum of the transition map before its guided
  // filter. This is the same conservative estimate, evaluated around p.
  float transition = 0.0;
  for (int y = -4; y <= 4; y++) {
    for (int x = -4; x <= 4; x++) {
      vec2 q = clamp(p + vec2(x, y) * texel, 0.0, 1.0);
      float d = dehazeDark(q);
      transition = max(transition, 1.0 - d / a * uDehazeStrength);
    }
  }

  // A compact guided-filter refinement. The guide is the local scene colour;
  // nearby transition values are trusted in proportion to guide similarity.
  vec3 guide = max(stageInput(texture(uSrc, p)), vec3(0.0));
  float guideL = dot(guide, LUMA_W);
  float weighted = 0.0;
  float weights = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 q = clamp(p + vec2(x, y) * texel, 0.0, 1.0);
      vec3 c = max(stageInput(texture(uSrc, q)), vec3(0.0));
      float similarity = exp(-abs(dot(c, LUMA_W) - guideL) * 12.0);
      float td = 1.0 - dehazeDark(q) / a * uDehazeStrength;
      float w = similarity + 1e-3;
      weighted += td * w;
      weights += w;
    }
  }
  return mix(transition, weighted / weights, 0.75);
}

vec3 stageDehaze(vec3 x, vec2 uv) {
  if (uDehazeOn < 0.5) return x;
  vec2 texel = 1.0 / vec2(textureSize(uSrc, 0));
  float distanceMax = max(-1.125 * log(max(dehazeDark(uv), 1e-6)), 0.0);
  float tMin = clamp(exp(-uDehazeDistance * distanceMax), 1.0 / 1024.0, 1.0);
  float t = max(dehazeTransmission(uv, texel), tMin);
  return (x - uDehazeA0) / t + uDehazeA0;
}
