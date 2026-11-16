#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// A zoomed-in region's spots while the retouch worker makes them at full size: where the whole
// photo's retouched preview differs from its input, that preview scaled up (soft but without the
// blemish); everywhere else the region's own pixels, exactly. darktable's darkroom shows its
// preview pipe until the full pipe catches up; this does so only inside the spots.
precision highp float;
out vec4 outColor;
uniform sampler2D uSharp;
uniform sampler2D uBefore;
uniform sampler2D uAfter;
// The region in whole-photo coordinates (x, y, w, h), and its size in texels.
uniform vec4 uRoi;
uniform vec2 uSize;
void main() {
  vec4 sharp = texelFetch(uSharp, ivec2(gl_FragCoord.xy), 0);
  vec2 uv = uRoi.xy + gl_FragCoord.xy / uSize * uRoi.zw;
  vec4 before = textureLod(uBefore, uv, 0.0), after = textureLod(uAfter, uv, 0.0);
  vec3 d = abs(after.rgb - before.rgb);
  // A change of a thousandth of linear light or more counts as inside a spot.
  float inside = clamp(max(d.r, max(d.g, d.b)) * 1000.0, 0.0, 1.0);
  outColor = mix(sharp, after, inside);
}
