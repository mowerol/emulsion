// SPDX-License-Identifier: GPL-3.0-or-later
// Input: bring any source into scene-linear Rec.2020.
//   0  linear light, sRGB primaries, display-referred (decoded JPEG/PNG/TIFF)
//   1  sRGB-encoded, display-referred (8-bit thumbnails)
//   2  scene-linear Rec.2020 (RAW)
// Display-referred sources are expanded with the inverse of the neutral tone
// curve, so a frame with no look applied renders back exactly as it came in.

uniform int uInputMode;
uniform mat3 uToWorking;

vec3 stageInput(vec4 tex) {
  if (uInputMode == 2) return max(tex.rgb, vec3(0.0));
  vec3 lin = uInputMode == 1 ? srgbEotf(clamp(tex.rgb, 0.0, 1.0)) : max(tex.rgb, vec3(0.0));
  vec3 e = srgbOetf(clamp(uToWorking * lin, 0.0, 1.0));
  return vec3(toneInverse(e.r), toneInverse(e.g), toneInverse(e.b));
}
