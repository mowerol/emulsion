// Copyright (C) 2017 Alasdair Newson, Noura Faraj, Bruno Galerne, Julie Delon.
// From the reference implementation of "Realistic Film Grain Rendering" (IPOL 2017,
// https://www.ipol.im/pub/art/2017/192): its cell seeds, hash and generators
// (src/pseudo_random_number_generator.cpp), licence GPL v3+. Mirrors src/engine/boolgrain.ts.
// SPDX-License-Identifier: GPL-3.0-or-later

uint wangHash(uint s) {
  s = (s ^ 61u) ^ (s >> 16u);
  s *= 9u;
  s = s ^ (s >> 4u);
  s *= 668265261u;
  s = s ^ (s >> 15u);
  return s;
}
uint cellSeed(int x, int y, uint offset) {
  uint s = (uint(y) % 65536u) * 65536u + (uint(x) % 65536u) + offset;
  return s == 0u ? 1u : s;
}
uint xorshift(inout uint s) {
  s ^= s << 13u;
  s ^= s >> 17u;
  s ^= s << 5u;
  return s;
}
float uniform01(inout uint s) { return float(xorshift(s)) / 4294967295.0; }
float gaussian01(inout uint s) {
  float u = uniform01(s), v = uniform01(s);
  return sqrt(-2.0 * log(u)) * cos(6.283185307179586 * v);
}
uint poisson(inout uint s, float lambda, float expLambda) {
  float u = uniform01(s);
  uint x = 0u;
  float prod = expLambda, sum = prod;
  float cap = floor(10000.0 * lambda);
  while (u > sum && float(x) < cap) {
    x += 1u;
    prod = prod * lambda / float(x);
    sum += prod;
  }
  return x;
}
