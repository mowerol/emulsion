// SPDX-License-Identifier: GPL-3.0-or-later
// Finish: matte fade and a touch of dither to prevent banding.

uniform float uFade;
// One step of the output's depth: 1/255, or 1/65535 for a 16-bit export.
uniform float uDither;

vec3 stageFinish(vec3 d) {
  d = uFade + d * (1.0 - uFade);
  d += (hash12(gl_FragCoord.xy + uSeed * 13.0) - 0.5) * uDither;
  return clamp(d, 0.0, 1.0);
}
