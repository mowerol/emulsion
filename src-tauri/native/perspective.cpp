// Copyright (c) 2019 Alberto Griggio <alberto.griggio@gmail.com>
// copyright (c) 2016 Ulrich Pegelow.
// Ported from RawTherapee rtengine/perspectivecorrection.cc at
// b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c. Headless adapter; the detector,
// RANSAC and camera-based Nelder-Mead maths are included unchanged;
// detector scratch/cache storage is initialized (see vendor README).
// SPDX-License-Identifier: GPL-3.0-or-later
#include <algorithm>
#include <array>
#include <cassert>
#include <cfloat>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <vector>
#include "homogeneouscoordinates.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif
namespace {
using gboolean = bool;
constexpr bool TRUE = true, FALSE = false;
struct MyMutex {
  std::mutex mutex;
  struct MyLock { std::lock_guard<std::mutex> guard; MyLock(MyMutex &m): guard(m.mutex) {} };
};
#define _(msg) (msg)
#define dt_control_log(msg) ((void)0)
#define CLAMP(x, lo, hi) std::max((lo), std::min((hi), (x)))
// Adjugate inverse, replacing RawTherapee's general matrix helper.
int mat3inv(float *dst, const float *s) {
  float a[9] = {s[4]*s[8]-s[5]*s[7], s[2]*s[7]-s[1]*s[8], s[1]*s[5]-s[2]*s[4],
    s[5]*s[6]-s[3]*s[8], s[0]*s[8]-s[2]*s[6], s[2]*s[3]-s[0]*s[5],
    s[3]*s[7]-s[4]*s[6], s[1]*s[6]-s[0]*s[7], s[0]*s[4]-s[1]*s[3]};
  const float det = s[0]*a[0]+s[1]*a[3]+s[2]*a[6];
  if (!std::isfinite(det) || std::abs(det)<1e-12f) return 1;
  for(int i=0;i<9;i++) dst[i]=a[i]/det;
  return 0;
}
#include "ashift_dt.c"
// Upstream uses the C random generator; serialize fits for reproducibility.
std::mutex fit_mutex;
}

// pixels: display-encoded neutral RGBA, already oriented and lens-corrected.
// axis: 0 vertical, 1 horizontal, 2 both. in/out: roll, pitch, yaw, focal35.
extern "C" int emulsion_perspective(const unsigned char *pixels, int w, int h, int axis, double *values) {
  std::lock_guard<std::mutex> lock(fit_mutex);
  dt_iop_ashift_params_t p{};
  p.rotation=values[0]; p.camera_pitch=values[1]; p.camera_yaw=values[2];
  p.f_length=values[3]; p.crop_factor=1; p.aspect=1; p.mode=ASHIFT_MODE_SPECIFIC;
  dt_iop_ashift_gui_data_t g{};
  g.buf_width=w; g.buf_height=h; g.buf_scale=1;
  g.rotation_range=ROTATION_RANGE_SOFT;
  g.lensshift_v_range=g.lensshift_h_range=LENSSHIFT_RANGE_SOFT;
  g.shear_range=SHEAR_RANGE_SOFT;
  g.camera_pitch_range=g.camera_yaw_range=CAMERA_ANGLE_RANGE_SOFT;
  std::vector<float> buffer(static_cast<size_t>(w)*h*4);
  for(size_t i=0;i<buffer.size();i++) buffer[i]=pixels[i]/255.f;
  g.buf=buffer.data();
  dt_iop_module_t module{&g, 0};
  const auto dir=axis==0?ASHIFT_FIT_VERTICALLY:axis==1?ASHIFT_FIT_HORIZONTALLY:ASHIFT_FIT_BOTH_SHEAR;
  srand(1);
  const bool ok=do_get_structure(&module, &p, ASHIFT_ENHANCE_EDGES) && do_fit(&module, &p, dir);
  free(g.lines); free(g.points); free(g.points_idx);
  if(!ok) return 0;
  values[0]=p.rotation; values[1]=p.camera_pitch; values[2]=p.camera_yaw;
  return 1;
}

// Native reference for the TypeScript homography port (also used by tests).
extern "C" void emulsion_perspective_matrix(int w, int h, const double *v, float *out) {
  homography(out, v[0], 0, 0, 0, v[1], v[2], v[3], 0, 1, w, h, ASHIFT_HOMOGRAPH_FORWARD);
}
