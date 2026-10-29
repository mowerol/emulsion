#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
// Full-screen triangle pair. Textures store the top image row first, so passes
// that write to textures sample straight through and only the final pass to the
// screen flips.
in vec2 aPos;
uniform float uFlipY;
out vec2 vUv;
void main() {
  vec2 uv = aPos * 0.5 + 0.5;
  vUv = vec2(uv.x, mix(uv.y, 1.0 - uv.y, uFlipY));
  gl_Position = vec4(aPos, 0.0, 1.0);
}
