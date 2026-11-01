#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// The camera profile's early pass: matrix and calibration table, cached before scene analysis.
#include "common.glsl"
#include "stages/dcp.glsl"

uniform sampler2D uTex;

void main() { outColor = vec4(stageDcpEarly(texture(uTex, vUv).rgb), 1.0); }
