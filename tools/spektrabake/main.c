/*
    Copyright (C) 2026 darktable developers (the render path's coupler blur, from src/iop/spektrafilm.c).
    Emulsion's bake tool for the Film stage (docs/plans/film-stage.md). It links darktable's
    spektrafilm engine (src/common/spektra_sim.c, spektra_core.c at
    c247126f9a7a2c3cdfc0f675a7698c24710438ca), unmodified, and runs it with the module's default
    parameters (src/iop/spektrafilm.c commit_params). Film modeling powered by spektrafilm,
    GPLv3, (c) Andrea Volpato.

    bake    <pack> <film> <out prefix>          the app's .film file, then checks it against the engine
    render <pack> <film> <in.f32> <w> <h> <out.f32> [options]
           darktable's chain on a linear Rec.2020 image: expose, [scatter], log, couplers
           (with or without their spread), develop, print, scan. Options: --pixel-um X (default
           36000 / long edge), --push S, --no-couplers, --no-spread, --scatter.
    fixture <pack> <film> <out.json> [push]     scene colours and darktable's print, for the tests

    Colour management differs from darktable's in one place: darktable hands the engine its
    working profile adapted to D50; Emulsion's working space is linear Rec.2020 with a D65
    white, so the engine's own Rec.2020 setters are used (it adapts to the film's illuminant
    itself, with CAT16).

    SPDX-License-Identifier: GPL-3.0-or-later
*/
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "spektra_sim.h"
#include "spektra_core.h"

#ifndef N
#define N 65
#endif
/* LUT A's shaper: each channel log2-encoded over [LO, HI] stops (1.0 = diffuse white). */
#define SHAPER_LO (-18.0)
#define SHAPER_HI (6.0)

typedef struct { sf_pack_t *pack; sf_profile_t *film, *print; sf_sim_t *sim; int scan_film; char paper[256]; } ctx_t;

static void die(const char *m, const char *e) { fprintf(stderr, "%s%s%s\n", m, e ? ": " : "", e ? e : ""); exit(1); }

/* darktable's module defaults (spektrafilm.c params and commit_params), push as darktable does. */
static ctx_t open_sim(const char *dir, const char *film, double push, int couplers)
{
  ctx_t c = { 0 };
  char *err = NULL, path[4096];
  c.pack = sf_pack_load(dir, &err, NULL);
  if(!c.pack) die("pack", err);
  snprintf(path, sizeof path, "%s/profiles/%s.json", dir, film);
  c.film = sf_profile_load(path, 0.0f, &err);
  if(!c.film) die("film", err);
  /* darktable's paper choice (spektrafilm.c _auto_paper_entry, _resolve_stock): a positive is
     scanned directly; a negative prints on its named target, else on a paper of its channel
     model (Double-X, the pack's one untargeted negative, on the black-and-white 2302). */
  const char *target = sf_profile_target_print(c.film);
  const char *model = sf_profile_channel_model(c.film);
  c.scan_film = !strcmp(sf_profile_type(c.film), "positive");
  if(!c.scan_film)
  {
    if(!target) target = model && !strcmp(model, "bw") ? "kodak_2302" : NULL;
    if(!target) die("film has no target print", NULL);
    snprintf(path, sizeof path, "%s/profiles/%s.json", dir, target);
    c.print = sf_profile_load(path, 0.0f, &err);
    if(!c.print) die("print", err);
  }
  snprintf(c.paper, sizeof c.paper, "%s", c.scan_film ? "scan" : target);
  sf_sim_params_t sp;
  sf_sim_params_defaults(&sp);
  sp.exposure_comp_ev = 0.0 - push;
  sp.print_exposure = 1.0;
  sp.print_exposure_compensation = false;
  sp.couplers_active = couplers;
  sp.couplers_amount = couplers ? 1.0 : 0.0;
  sp.grain_rms_scale = sp.grain_uniformity_scale = sp.grain_particle_scale = sp.grain_density_min_scale = 1.0;
  sp.coupler_diffusion_um = 20.0;
  sp.coupler_tail_um = 200.0;
  sp.coupler_tail_weight = 0.03;
  sp.inhibition_samelayer = sp.inhibition_interlayer = 1.0;
  sp.preflash_exposure = 0.0;
  sp.scan_film = c.scan_film;
  sp.scan_black_correction = sp.scan_white_correction = false;
  sp.scan_black_level = 0.01;
  sp.scan_white_level = 0.98;
  sp.adaptation_bandwidth = true;
  sp.adaptation_surface = false;
  sp.lut_steps = 33; /* SF_LUT_STEPS */
  sp.out_luminance_boost = 1.0;
  sp.out_scale = 1.0;
  if(push != 0.0)
  {
    sp.film_morph_active = true;
    sp.film_morph_gamma = powf(1.15f, (float)push); /* SF_PUSH_PULL_GAMMA_PER_STOP */
    sp.film_morph_gamma_fast = sp.film_morph_gamma_slow = 1.0;
  }
  sf_sim_params_set_input_rec2020(&sp);
  sf_sim_params_set_output_rec2020(&sp);
  c.sim = sf_sim_build(c.pack, c.film, c.print, &sp, &err);
  if(!c.sim) die("build", err);
  return c;
}

static double shaper_decode(double v) { return exp2(SHAPER_LO + v * (SHAPER_HI - SHAPER_LO)); }

/* sRGB transfer, extended to negative and >1 values by symmetry and continuation. */
static float oetf(float l)
{
  const float a = fabsf(l), e = a <= 0.0031308f ? 12.92f * a : 1.055f * powf(a, 1.0f / 2.4f) - 0.055f;
  return l < 0 ? -e : e;
}

static int write_f32(const char *path, const float *v, size_t n)
{
  FILE *f = fopen(path, "wb");
  if(!f) return 0;
  const int ok = fwrite(v, sizeof(float), n, f) == n;
  fclose(f);
  return ok;
}

static float *read_f32(const char *path, size_t n)
{
  FILE *f = fopen(path, "rb");
  if(!f) die("cannot read", path);
  float *v = malloc(n * sizeof(float));
  if(fread(v, sizeof(float), n, f) != n) die("short file", path);
  fclose(f);
  return v;
}

/* LUT B's input: film density per channel (curves_before of lograw - corr), over [lo, hi]. */
typedef struct { float lo[3], hi[3]; } domain_t;

/* sf_sim_develop's curve lookup, from darktable's exported table (interp_curve_uniform_f). */
static float curve_at(const sf_sim_gpu_t *g, const float *curves, float x, int c)
{
  const float t = (x - g->le0) * g->inv_le_step;
  if(t <= 0.0f) return curves[c];
  if(t >= (float)(SF_NLE - 1)) return curves[(SF_NLE - 1) * 3 + c];
  const int i = (int)t;
  const float f = t - i;
  return fmaf(f, curves[(i + 1) * 3 + c] - curves[i * 3 + c], curves[i * 3 + c]);
}

static domain_t density_domain(const sf_sim_gpu_t *g)
{
  domain_t d;
  for(int k = 0; k < 3; k++)
  {
    d.lo[k] = INFINITY; d.hi[k] = -INFINITY;
    for(int i = 0; i < SF_NLE; i++) { d.lo[k] = fminf(d.lo[k], g->curves_before[i * 3 + k]); d.hi[k] = fmaxf(d.hi[k], g->curves_before[i * 3 + k]); }
  }
  return d;
}

static void lut_a(const ctx_t *c, float *out /* N^3 * 3, r fastest */)
{
  const size_t n = (size_t)N * N * N;
  float *rgb = malloc(n * 3 * sizeof(float));
  for(int b = 0; b < N; b++)
    for(int g = 0; g < N; g++)
      for(int r = 0; r < N; r++)
      {
        float *p = rgb + 3 * (((size_t)b * N + g) * N + r);
        p[0] = (float)shaper_decode(r / (N - 1.0));
        p[1] = (float)shaper_decode(g / (N - 1.0));
        p[2] = (float)shaper_decode(b / (N - 1.0));
      }
  sf_sim_expose(c->sim, rgb, out, n, 3, 3);
  sf_sim_lograw(c->sim, out, n, 3);
  free(rgb);
}

/* Print and scan from film density; output linear Rec.2020. */
static void print_scan(const ctx_t *c, float *cmy, float *out, size_t n)
{
  float *lr = malloc(n * 3 * sizeof(float));
  if(!c->scan_film)
  {
    sf_sim_print_expose(c->sim, cmy, lr, n, 3, 3);
    sf_sim_print_develop(c->sim, lr, cmy, n, 3, 3);
  }
  sf_sim_scan(c->sim, cmy, NULL, out, n, 3, 3);
  free(lr);
}

/* Develop, print and scan, from log exposure and the correction; output linear Rec.2020. */
static void finish(const ctx_t *c, const float *x, const float *corr, float *out, size_t n)
{
  float *cmy = malloc(n * 3 * sizeof(float)), *lr = malloc(n * 3 * sizeof(float));
  sf_sim_develop(c->sim, x, corr, cmy, n, 3, 3);
  if(!c->scan_film)
  {
    sf_sim_print_expose(c->sim, cmy, lr, n, 3, 3);
    sf_sim_print_develop(c->sim, lr, cmy, n, 3, 3);
  }
  sf_sim_scan(c->sim, cmy, NULL, out, n, 3, 3);
  free(cmy);
  free(lr);
}

/* The full chain on a linear Rec.2020 image, as darktable's process() runs it (no grain,
   halation, diffusion filter, highlight boost, glare or scanner sharpening). */
static int cmd_render(const char *dir, const char *film, const char *in, int w, int h, const char *outp, int argc, char **argv)
{
  double push = 0, pixel_um = 36000.0 / (w > h ? w : h);
  int couplers = 1, spread = 1, scatter = 0;
  for(int i = 0; i < argc; i++)
  {
    if(!strcmp(argv[i], "--pixel-um") && i + 1 < argc) pixel_um = atof(argv[++i]);
    else if(!strcmp(argv[i], "--push") && i + 1 < argc) push = atof(argv[++i]);
    else if(!strcmp(argv[i], "--no-couplers")) couplers = 0;
    else if(!strcmp(argv[i], "--no-spread")) spread = 0;
    else if(!strcmp(argv[i], "--scatter")) scatter = 1;
    else die("unknown option", argv[i]);
  }
  ctx_t c = open_sim(dir, film, push, couplers);
  const size_t npix = (size_t)w * h;
  float *rgb = read_f32(in, npix * 3);
  float *plane = malloc(npix * 3 * sizeof(float)), *buf_a = malloc(npix * 3 * sizeof(float)),
        *buf_b = malloc(npix * 3 * sizeof(float)), *scratch = malloc(npix * 3 * sizeof(float)), *out = malloc(npix * 3 * sizeof(float));
  sf_sim_expose(c.sim, rgb, plane, npix, 3, 3);
  if(scatter)
  {
    double core[3], tail[3], tw[3];
    sf_sim_scatter_params(c.sim, core, tail, tw);
    const double zero[3] = { 0, 0, 0 };
    sf_halation(plane, w, h, 0, 0, pixel_um, core, tail, tw, 1.0f, 1.0f, 0.0f, 1.0f, zero, 65.0, buf_a, buf_b, scratch);
  }
  sf_sim_lograw(c.sim, plane, npix, 3);
  float *corr = buf_a;
  if(couplers)
  {
    sf_sim_develop_corr(c.sim, plane, corr, npix, 3);
    if(spread)
    {
      /* darktable src/iop/spektrafilm.c process(), the coupler field's diffusion */
      double cdiff_um, ctail_um, ctail_w;
      sf_sim_coupler_diffusion(c.sim, &cdiff_um, &ctail_um, &ctail_w);
      const float csigma = (float)cdiff_um / fmaxf((float)pixel_um, 1e-3f);
      if(ctail_w > 0.0)
      {
        const float amp[3] = { SF_EXPTAIL_A0, SF_EXPTAIL_A1, SF_EXPTAIL_A2 };
        const float rat[3] = { SF_EXPTAIL_R0, SF_EXPTAIL_R1, SF_EXPTAIL_R2 };
        const float tail_px = (float)ctail_um / fmaxf((float)pixel_um, 1e-3f);
        float *const mix = buf_b;
        const float wbase = 1.0f - (float)ctail_w;
        sf_blur_plane3_wide_accum(corr, mix, w, h, 0, 0, csigma, NULL, 0, scratch);
        for(size_t i = 0; i < npix * 3; i++) mix[i] = wbase * mix[i];
        for(int g3 = 0; g3 < 3; g3++)
        {
          const float ts = rat[g3] * tail_px;
          const float wk = (float)ctail_w * amp[g3];
          sf_blur_plane3_wide_accum(corr, mix, w, h, 0, 0, ts, (const float[3]){ wk, wk, wk }, 0, scratch);
        }
        corr = mix;
      }
      else if(csigma > 0.1f)
        sf_blur_plane3_wide(corr, w, h, 0, 0, csigma, buf_b);
    }
  }
  finish(&c, plane, couplers ? corr : NULL, out, npix);
  if(!write_f32(outp, out, npix * 3)) die("write", outp);
  printf("%s: %dx%d, %.3f um/px, couplers %d spread %d scatter %d\n", outp, w, h, pixel_um, couplers, couplers && spread, scatter);
  return 0;
}

/* darktable lut3d's tetrahedral interpolation (as Emulsion's lut3d port), r fastest. */
static void tetra(const float *lut, float r, float g, float b, float *o)
{
  const float s = N - 1;
  r = fminf(fmaxf(r, 0), 1) * s; g = fminf(fmaxf(g, 0), 1) * s; b = fminf(fmaxf(b, 0), 1) * s;
  int r0 = (int)fminf(floorf(r), N - 2), g0 = (int)fminf(floorf(g), N - 2), b0 = (int)fminf(floorf(b), N - 2);
  const float fr = r - r0, fg = g - g0, fb = b - b0;
#define AT(R, G, B, K) lut[3 * ((((size_t)(b0 + (B))) * N + (g0 + (G))) * N + (r0 + (R))) + (K)]
  for(int k = 0; k < 3; k++)
  {
    const float c000 = AT(0, 0, 0, k), c111 = AT(1, 1, 1, k);
    float v;
    if(fr > fg)
    {
      if(fg > fb) v = c000 + fr * (AT(1, 0, 0, k) - c000) + fg * (AT(1, 1, 0, k) - AT(1, 0, 0, k)) + fb * (c111 - AT(1, 1, 0, k));
      else if(fr > fb) v = c000 + fr * (AT(1, 0, 0, k) - c000) + fb * (AT(1, 0, 1, k) - AT(1, 0, 0, k)) + fg * (c111 - AT(1, 0, 1, k));
      else v = c000 + fb * (AT(0, 0, 1, k) - c000) + fr * (AT(1, 0, 1, k) - AT(0, 0, 1, k)) + fg * (c111 - AT(1, 0, 1, k));
    }
    else
    {
      if(fb > fg) v = c000 + fb * (AT(0, 0, 1, k) - c000) + fg * (AT(0, 1, 1, k) - AT(0, 0, 1, k)) + fr * (c111 - AT(0, 1, 1, k));
      else if(fb > fr) v = c000 + fg * (AT(0, 1, 0, k) - c000) + fb * (AT(0, 1, 1, k) - AT(0, 1, 0, k)) + fr * (c111 - AT(0, 1, 1, k));
      else v = c000 + fg * (AT(0, 1, 0, k) - c000) + fr * (AT(1, 1, 0, k) - AT(0, 1, 0, k)) + fb * (c111 - AT(1, 1, 0, k));
    }
    o[k] = v;
  }
#undef AT
}

/* A lattice's inputs: N^3 points over each channel's [lo, hi], r fastest. */
static void grid(const domain_t *d, float *x)
{
  for(int b = 0; b < N; b++)
    for(int gg = 0; gg < N; gg++)
      for(int r = 0; r < N; r++)
      {
        float *p = x + 3 * (((size_t)b * N + gg) * N + r);
        const int i[3] = { r, gg, b };
        for(int k = 0; k < 3; k++) p[k] = d->lo[k] + (d->hi[k] - d->lo[k]) * i[k] / (N - 1.0f);
      }
}

/* The app's file for one film (src/engine/film.ts): lattice A, scene light to film log exposure,
   and lattice B, film density to the finished print (print exposure, paper and scan; a slide's B
   scans the film directly), with the film's curves and coupler data. Then the file's path is
   checked against the engine, per pixel. */
static int cmd_bake(const char *dir, const char *film, const char *prefix)
{
  ctx_t c = open_sim(dir, film, 0.0, 1);
  const size_t n = (size_t)N * N * N;
  sf_sim_gpu_t *g = sf_sim_gpu_export(c.sim);
  if(!g) die("gpu export", NULL);
  float *A = malloc(n * 3 * sizeof(float)), *B = malloc(n * 3 * sizeof(float)), *x = malloc(n * 3 * sizeof(float));
  lut_a(&c, A);
  /* B spans the film's whole density range, so the curve's clamping carries over exactly. */
  const domain_t d = density_domain(g);
  grid(&d, x);
  print_scan(&c, x, B, n);
  for(size_t i = 0; i < n * 3; i++) { B[i] = (float)(_Float16)oetf(B[i]); A[i] = (float)(_Float16)A[i]; }

  double cd, ct, cw, core[3], tail[3], tw[3];
  sf_sim_coupler_diffusion(c.sim, &cd, &ct, &cw);
  sf_sim_scatter_params(c.sim, core, tail, tw);
  char *json = NULL;
  size_t jl = 0;
  FILE *f = open_memstream(&json, &jl);
  fprintf(f, "{\"film\":\"%s\",\"print\":\"%s\",\"push\":0,\"pack\":\"%s\",\"packHash\":\"%08x\",\"lutHash\":\"%08x\",\"darktable\":\"c247126f9a7a2c3cdfc0f675a7698c24710438ca\",",
          film, c.paper, sf_pack_version(c.pack), sf_pack_hash(c.pack), sf_pack_lut_hash(c.pack));
  fprintf(f, "\"n\":%d,\"shaper\":[%g,%g],\"densityB\":{\"lo\":[%.9g,%.9g,%.9g],\"hi\":[%.9g,%.9g,%.9g]},", N, SHAPER_LO, SHAPER_HI, d.lo[0], d.lo[1], d.lo[2], d.hi[0], d.hi[1], d.hi[2]);
  fprintf(f, "\"couplers\":{\"active\":%d,\"positive\":%d,\"M\":[", g->couplers_active, g->film_positive);
  for(int i = 0; i < 9; i++) fprintf(f, "%s%.9g", i ? "," : "", g->couplers_M[i]);
  fprintf(f, "],\"dmax\":[%.9g,%.9g,%.9g],\"donorLangmuir\":%d,\"donorK\":[%.9g,%.9g,%.9g],\"donorDref\":[%.9g,%.9g,%.9g],",
          g->film_dmax[0], g->film_dmax[1], g->film_dmax[2], g->couplers_donor_lm, g->couplers_donor_K[0], g->couplers_donor_K[1], g->couplers_donor_K[2],
          g->couplers_donor_Dref[0], g->couplers_donor_Dref[1], g->couplers_donor_Dref[2]);
  fprintf(f, "\"receiverLangmuir\":%d,\"receiverK\":[%.9g,%.9g,%.9g],\"receiverCref\":[%.9g,%.9g,%.9g],\"diffusionUm\":%g,\"tailUm\":%g,\"tailWeight\":%g,",
          g->couplers_recv_lm, g->couplers_recv_Kr[0], g->couplers_recv_Kr[1], g->couplers_recv_Kr[2],
          g->couplers_recv_cref[0], g->couplers_recv_cref[1], g->couplers_recv_cref[2], cd, ct, cw);
  fprintf(f, "\"le0\":%.9g,\"invLeStep\":%.9g,\"curvesNorm\":[", g->le0, g->inv_le_step);
  for(int i = 0; i < SF_NLE * 3; i++) fprintf(f, "%s%.7g", i ? "," : "", g->curves_norm[i]);
  fprintf(f, "],\"curvesBefore\":[");
  for(int i = 0; i < SF_NLE * 3; i++) fprintf(f, "%s%.7g", i ? "," : "", g->curves_before[i]);
  fprintf(f, "]},\"scatter\":{\"core\":[%g,%g,%g],\"tail\":[%g,%g,%g],\"tailWeight\":[%g,%g,%g]}}",
          core[0], core[1], core[2], tail[0], tail[1], tail[2], tw[0], tw[1], tw[2]);
  fclose(f);

  /* "EMFILM\0\1", the JSON's length (u32 LE), the JSON padded to 4 bytes, then lattices A and B in
     half floats (N^3 x RGB each, r fastest). */
  char path[4096];
  snprintf(path, sizeof path, "%s.film", prefix);
  FILE *ff = fopen(path, "wb");
  if(!ff) die("write", path);
  const uint32_t padded = (uint32_t)((jl + 3) / 4 * 4);
  fwrite("EMFILM\0\1", 1, 8, ff);
  fwrite(&padded, 4, 1, ff);
  fwrite(json, 1, jl, ff);
  for(size_t i = jl; i < padded; i++) fputc(' ', ff);
  _Float16 *h16 = malloc(n * 3 * sizeof(_Float16));
  for(size_t i = 0; i < n * 3; i++) h16[i] = (_Float16)A[i];
  fwrite(h16, sizeof(_Float16), n * 3, ff);
  for(size_t i = 0; i < n * 3; i++) h16[i] = (_Float16)B[i];
  fwrite(h16, sizeof(_Float16), n * 3, ff);
  fclose(ff);
  free(h16);
  free(json);

  /* Check: B(curvesBefore(A(x) - corr(A(x)))) against the engine, per pixel, over scene colours. */
  enum { MS = 200000 };
  float *rgb = malloc(MS * 3 * sizeof(float)), *raw = malloc(MS * 3 * sizeof(float)), *corr = malloc(MS * 3 * sizeof(float)), *ref = malloc(MS * 3 * sizeof(float));
  srand(7);
  for(int i = 0; i < MS; i++)
  {
    if(i < 1000) { const float v = (float)exp2(-12.0 + 15.0 * i / 999.0); rgb[3 * i] = rgb[3 * i + 1] = rgb[3 * i + 2] = v; continue; }
    const double y = exp2(-11.0 + 14.0 * rand() / (double)RAND_MAX);
    for(int k = 0; k < 3; k++) rgb[3 * i + k] = (float)(y * (0.05 + 0.95 * rand() / (double)RAND_MAX));
  }
  sf_sim_expose(c.sim, rgb, raw, MS, 3, 3);
  sf_sim_lograw(c.sim, raw, MS, 3);
  sf_sim_develop_corr(c.sim, raw, corr, MS, 3);
  finish(&c, raw, corr, ref, MS);
  double worst = 0, sum = 0, ramp = 0;
  for(int i = 0; i < MS; i++)
  {
    float v[3], la[3], cr[3], xx[3], o[3];
    for(int k = 0; k < 3; k++) v[k] = (float)((log2(fmax(rgb[3 * i + k], 1e-30)) - SHAPER_LO) / (SHAPER_HI - SHAPER_LO));
    tetra(A, v[0], v[1], v[2], la);
    sf_sim_develop_corr(c.sim, la, cr, 1, 3);
    for(int k = 0; k < 3; k++)
    {
      float crv = cr[k];
      if(g->couplers_recv_lm) crv = crv * (g->couplers_recv_Kr[k] + g->couplers_recv_cref[k]) / (g->couplers_recv_Kr[k] + crv);
      xx[k] = (curve_at(g, g->curves_before, la[k] - crv, k) - d.lo[k]) / (d.hi[k] - d.lo[k]);
    }
    tetra(B, xx[0], xx[1], xx[2], o);
    double e = 0;
    for(int k = 0; k < 3; k++) e = fmax(e, fabs(o[k] - oetf(ref[3 * i + k])) * 255.0);
    worst = fmax(worst, e); sum += e;
    if(i < 1000) ramp = fmax(ramp, e);
  }
  printf("%s (%s): against the engine, 8-bit steps: mean %.3f, worst %.2f, grey ramp %.2f\n", film, c.paper, sum / MS, worst, ramp);
  free(rgb); free(raw); free(corr); free(ref); free(A); free(B); free(x);
  sf_sim_gpu_free(g);
  return 0;
}

/* Scene colours and darktable's print for each (per-pixel couplers, sRGB-encoded linear Rec.2020),
   as JSON, for the TypeScript reference's tests. */
static int cmd_fixture(const char *dir, const char *film, const char *outp, double push)
{
  ctx_t c = open_sim(dir, film, push, 1);
  enum { M = 48 };
  float rgb[M * 3], raw[M * 3], corr[M * 3], out[M * 3];
  for(int i = 0; i < M; i++)
  {
    /* a grey ramp over 12 stops, then colours from deep shadow to highlight */
    const double y = i < 16 ? exp2(-10.0 + 12.0 * i / 15.0) : exp2(-8.0 + 10.0 * ((i * 7) % 32) / 31.0);
    for(int k = 0; k < 3; k++)
      rgb[3 * i + k] = (float)(i < 16 ? y : y * (0.08 + 0.92 * (((i * (k + 3) * 13) % 29) / 28.0)));
  }
  sf_sim_expose(c.sim, rgb, raw, M, 3, 3);
  sf_sim_lograw(c.sim, raw, M, 3);
  sf_sim_develop_corr(c.sim, raw, corr, M, 3);
  finish(&c, raw, corr, out, M);
  FILE *f = fopen(outp, "w");
  if(!f) die("write", outp);
  fprintf(f, "{\n  \"film\": \"%s\",\n  \"push\": %g,\n  \"cases\": [\n", film, push);
  for(int i = 0; i < M; i++)
    fprintf(f, "    [[%.9g, %.9g, %.9g], [%.7g, %.7g, %.7g]]%s\n", rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2],
            oetf(out[3 * i]), oetf(out[3 * i + 1]), oetf(out[3 * i + 2]), i < M - 1 ? "," : "");
  fprintf(f, "  ]\n}\n");
  fclose(f);
  return 0;
}

int main(int argc, char **argv)
{
  if(argc >= 5 && !strcmp(argv[1], "fixture")) return cmd_fixture(argv[2], argv[3], argv[4], argc > 5 ? atof(argv[5]) : 0.0);
  if(argc >= 5 && !strcmp(argv[1], "bake")) return cmd_bake(argv[2], argv[3], argv[4]);
  if(argc >= 8 && !strcmp(argv[1], "render")) return cmd_render(argv[2], argv[3], argv[4], atoi(argv[5]), atoi(argv[6]), argv[7], argc - 8, argv + 8);
  fprintf(stderr, "usage: spektrabake bake|render|check ... (see main.c)\n");
  return 2;
}
