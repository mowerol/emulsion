#!/bin/sh
# Builds darktable's own process_wavelets (denoise (profiled), Y0U0V0) and eaw_dn_decompose
# with small stubs, to make the denoiseprofile fixture.
# Usage: tools/denoise-reference/build.sh <darktable checkout at 20891f6c6fa7be995e5bf9dff9d1ee5062051773>
set -e
DT=${1:?darktable checkout}
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${TMPDIR:-/tmp}/emulsion-denoise-reference
mkdir -p "$OUT"
DP="$DT/src/iop/denoiseprofile.c"
EAW="$DT/src/common/eaw.c"
range() { sed -n "/$2/,/^}/p" "$1"; }
{
  echo '#include "stub.h"'
  sed -n '/^#define DT_IOP_DENOISE_PROFILE_BANDS/p;/^#define DT_IOP_DENOISE_PROFILE_P_FULCRUM/p' "$DP"
  sed -n '/^typedef enum dt_iop_denoiseprofile_mode_t/,/^} dt_iop_denoiseprofile_channel_t;/p' "$DP"
  sed -n '/^typedef struct dt_iop_denoiseprofile_data_t/,/^} dt_iop_denoiseprofile_data_t;/p' "$DP"
  sed -n '/^static inline float fast_mexp2f/,/^}/p' "$DT/src/common/math.h"
  sed -n '/^static inline int dwt_interleave_rows/,/^}/p' "$DT/src/common/dwt.h"
  echo 'typedef void((*eaw_dn_decompose_t)(float *const restrict out, const float *const restrict in, float *const restrict detail, dt_aligned_pixel_t sum_squared, const int scale, const float inv_sigma2, const int32_t width, const int32_t height));'
  echo 'typedef void((*eaw_synthesize_t)(float *const out, const float *const in, const float *const restrict detail, const float *const restrict thrsf, const float *const restrict boostf, const int32_t width, const int32_t height));'
  # All of eaw.c without its includes (accumulate, eaw_synthesize, dn_weight, eaw_dn_decompose).
  grep -v '^#include' "$EAW"
  for f in precondition backtransform precondition_v2 backtransform_v2 precondition_Y0U0V0 backtransform_Y0U0V0; do range "$DP" "^static inline void $f("; done
  for f in compute_wb_factors invert_matrix set_up_conversion_matrices variance_stabilizing_xform process_wavelets; do
    sed -n "/^static [a-z]* $f(/,/^}/p" "$DP"
  done
  cat "$HERE/glue.c"
} > "$OUT/reference.c"
cc -O0 -std=gnu99 -I"$HERE" -o "$OUT/denoise" "$OUT/reference.c" "$HERE/main.c" -lm
echo "$OUT/denoise"
