// Copyright (C) 2026 darktable developers.
// Reference harness for darktable spektra_core.c at
// c96cf1d0de8fff468e9eddee28621e91f83bdf1a. Upstream routines are
// extracted unmodified into upstream.inc by generate.py.
// SPDX-License-Identifier: GPL-3.0-or-later

#include "upstream.inc"

static float number(char **argv, int at) { return strtof(argv[at], NULL); }

int main(int argc, char **argv)
{
  if(argc < 2) return 2;
  if(strcmp(argv[1], "plan") == 0)
  {
    if(argc != 4) return 2;
    sf_diffusion_plan_t p;
    sf_diffusion_build_plan(0, number(argv, 2), number(argv, 3), &p);
    printf("{\"scatter\":%.9g,\"components\":[", p.p_s);
    for(int j = 0; j < p.n; j++)
      printf("%s{\"sigmaUm\":%.9g,\"weight\":[%.9g,%.9g,%.9g]}",
             j ? "," : "", p.sigma_um[j], p.wr[j], p.wg[j], p.wb[j]);
    puts("]}");
    return 0;
  }
  if(strcmp(argv[1], "mix") == 0)
  {
    if(argc != 12) return 2;
    const double amount = (double)number(argv, 2);
    const double strength[3] = { strtod(argv[3], NULL), strtod(argv[4], NULL), strtod(argv[5], NULL) };
    const float a_f[3] = { (float)(strength[0] * amount), (float)(strength[1] * amount), (float)(strength[2] * amount) };
    float raw[3] = { number(argv, 6), number(argv, 7), number(argv, 8) };
    const float blur[3] = { number(argv, 9), number(argv, 10), number(argv, 11) };
    // Verbatim final per-pixel expression from sf_halation. The separate
    // mode permits a supplied blur, independently testing the combine step.
    for(size_t i = 0; i < 3; i++)
    {
      const int c = i % 3;
      raw[i] = fmaf(a_f[c], blur[i], raw[i]) / (1.0f + a_f[c]);
    }
    printf("[%.9g,%.9g,%.9g]\n", raw[0], raw[1], raw[2]);
    return 0;
  }
  if(argc < 5) return 2;
  const int w = atoi(argv[2]), h = atoi(argv[3]);
  if(w < 1 || h < 1 || w > 32768 || h > 32768) return 2;
  const size_t n = (size_t)w * h * 3;
  float *raw = dt_alloc_align_float(n);
  float *scratch = dt_alloc_align_float((size_t)w * h);
  if(!raw || !scratch || fread(raw, sizeof(float), n, stdin) != n) return 3;
  if(strcmp(argv[1], "gaussian") == 0)
  {
    if(argc != 5) return 2;
    const float sigma = number(argv, 4);
    if(sigma >= SF_WIDE_BLUR_EFFECT_SIGMA)
      sf_blur_plane3_wide(raw, w, h, 0, 0, sigma, scratch);
    else
    {
      float *trans = dt_alloc_align_float((size_t)w * h);
      const float sig3[3] = { sigma, sigma, sigma };
      _blur_per_channel(raw, w, h, sig3, scratch, trans);
      dt_free_align(trans);
    }
  }
  else if(strcmp(argv[1], "halation") == 0)
  {
    if(argc != 11) return 2;
    const double strength[3] = { strtod(argv[7], NULL), strtod(argv[8], NULL), strtod(argv[9], NULL) };
    const double zeros[3] = { 0, 0, 0 };
    sf_halation(raw, w, h, 0, 0, strtod(argv[4], NULL), zeros, zeros,
                zeros, 0, 1, number(argv, 5), number(argv, 6), strength,
                strtod(argv[10], NULL));
  }
  else if(strcmp(argv[1], "diffusion") == 0)
  {
    if(argc != 8) return 2;
    sf_diffusion_filter(raw, w, h, 0, 0, strtod(argv[4], NULL), 0,
                       number(argv, 5), number(argv, 6), number(argv, 7));
  }
  else return 2;
  if(fwrite(raw, sizeof(float), n, stdout) != n) return 3;
  dt_free_align(raw);
  dt_free_align(scratch);
  return 0;
}
