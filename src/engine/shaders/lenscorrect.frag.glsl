#version 300 es
// Copyright (C) 2019-2026 darktable developers.
// SPDX-License-Identifier: GPL-3.0-or-later
// lens.cc embedded metadata v2 at 20891f6c. Source-space vignetting before
// bilinear resampling, with one position per channel for chromatic aberration.
#include "common.glsl"
uniform sampler2D uTex;
uniform mat3 uLensToCamera;
uniform mat3 uLensFromCamera;
uniform vec2 uLensCenter;
uniform int uLensCount;
uniform int uLensVigCount;
uniform float uLensKnots[16];
uniform vec3 uLensFactors[16];
uniform float uLensVigKnots[16];
uniform float uLensVig[16];
vec3 lensFactor(float r) {
  if(r<uLensKnots[0]) return uLensFactors[0];
  for(int i=1;i<16;i++) {
    if(i>=uLensCount) break;
    if(r>=uLensKnots[i-1] && r<=uLensKnots[i]) return mix(uLensFactors[i-1],uLensFactors[i],(r-uLensKnots[i-1])/(uLensKnots[i]-uLensKnots[i-1]));
  }
  return uLensFactors[uLensCount-1];
}
float lensVignette(float r) {
  if(r<uLensVigKnots[0]) return uLensVig[0];
  for(int i=1;i<16;i++) {
    if(i>=uLensVigCount) break;
    if(r>=uLensVigKnots[i-1] && r<=uLensVigKnots[i]) return mix(uLensVig[i-1],uLensVig[i],(r-uLensVigKnots[i-1])/(uLensVigKnots[i]-uLensVigKnots[i-1]));
  }
  return uLensVig[uLensVigCount-1];
}
vec3 lensPixel(ivec2 pixel) {
  ivec2 size=textureSize(uTex,0);
  pixel=clamp(pixel,ivec2(0),size-1);
  // Centre is darktable's integer-pixel centre, transformed with EXIF orientation.
  float r=length(vec2(pixel)+0.5-vec2(size)*uLensCenter)/length(vec2(size)*0.5);
  return (uLensToCamera*texelFetch(uTex,pixel,0).rgb)/max(1e-4,lensVignette(r));
}
vec3 lensBilinear(vec2 uv) {
  vec2 p=uv*vec2(textureSize(uTex,0))-0.5;
  ivec2 a=ivec2(floor(p));vec2 f=fract(p);
  return mix(mix(lensPixel(a),lensPixel(a+ivec2(1,0)),f.x),mix(lensPixel(a+ivec2(0,1)),lensPixel(a+ivec2(1,1)),f.x),f.y);
}
void main() {
  vec2 size=vec2(textureSize(uTex,0));
  vec2 q=(vUv-uLensCenter)*size;
  vec3 f=lensFactor(length(q)/length(size*0.5));
  vec3 color;
  for(int c=0;c<3;c++) color[c]=lensBilinear(uLensCenter+q*f[c]/size)[c];
  outColor=vec4(max(uLensFromCamera*color,vec3(0.0)),1.0);
}
