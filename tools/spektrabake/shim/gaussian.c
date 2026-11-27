/*
    Copyright (C) 2012-2026 darktable developers.
    Two functions copied unchanged from darktable src/common/gaussian.c at
    c247126f9a7a2c3cdfc0f675a7698c24710438ca, which spektra_core.c calls.
    SPDX-License-Identifier: GPL-3.0-or-later
*/
#include <math.h>
#include "common/gaussian.h"

void dt_gaussian_yvv_coeffs(const float sigma,
                            float out[4])
{
  const double s = (double)sigma;
  const double q = (s >= 2.5) ? (0.98711 * s - 0.96330)
                              : (3.97156 - 4.14554 * sqrt(1.0 - 0.26891 * s));
  const double q2 = q * q, q3 = q2 * q;
  const double b0 = 1.57825 + 2.44413 * q + 1.4281 * q2 + 0.422205 * q3;
  const double b1 = 2.44413 * q + 2.85619 * q2 + 1.26661 * q3;
  const double b2 = -(1.4281 * q2 + 1.26661 * q3);
  const double b3 = 0.422205 * q3;
  out[1] = (float)(b1 / b0);
  out[2] = (float)(b2 / b0);
  out[3] = (float)(b3 / b0);
  out[0] = (float)(1.0 - (b1 + b2 + b3) / b0);
}

int dt_gaussian_kernel_1d(const float sigma,
                          float *const kernel,
                          const int max_radius)
{
  int radius = (int)(3.0f * sigma + 0.5f);
  if(radius < 1) radius = 1;
  if(radius > max_radius) radius = max_radius;
  double sum = 0.0;
  const double inv2s2 = 1.0 / (2.0 * (double)sigma * (double)sigma);
  for(int i = -radius; i <= radius; i++)
  {
    const double v = exp(-(double)(i * i) * inv2s2);
    kernel[i + radius] = (float)v;
    sum += v;
  }
  const float invsum = (float)(1.0 / sum);
  for(int i = 0; i < 2 * radius + 1; i++) kernel[i] *= invsum;
  return radius;
}
