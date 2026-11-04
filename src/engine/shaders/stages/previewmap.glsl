// SPDX-License-Identifier: GPL-3.0-or-later
// A live whole-photo effect sampled at the sharp region's coordinates.
uniform vec4 uPreviewMapRoi;
vec2 previewMapUv(vec2 uv, float enabled) {
  return enabled > 0.5 ? uPreviewMapRoi.xy + uv * uPreviewMapRoi.zw : uv;
}
