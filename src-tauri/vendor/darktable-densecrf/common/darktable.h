// SPDX-License-Identifier: GPL-3.0-or-later
// Emulsion's stand-in for darktable's common/darktable.h: only what densecrf.cc and
// iop/Permutohedral.h use. Built without OpenMP, so the parallel macros are empty and
// there is one thread; memory is aligned as dt_alloc_aligned aligns it (64 bytes).
#pragma once

#include <stdlib.h>
#include <stddef.h>

#define DT_OMP_FOR(...)
#define DT_OMP_SIMD(...)
#define DT_ALIGNED_PIXEL __attribute__((aligned(16)))
typedef DT_ALIGNED_PIXEL float dt_aligned_pixel_t[4];

#define DT_DEBUG_ALWAYS 0
#define DT_DEBUG_MEMORY 0
#define dt_print(...) ((void)0)

static inline void *dt_alloc_aligned(size_t size)
{
  void *p = NULL;
  return posix_memalign(&p, 64, size ? size : 64) == 0 ? p : NULL;
}
#define dt_free_align(p) free(p)
static inline int dt_get_num_threads(void) { return 1; }
static inline int dt_get_thread_num(void) { return 0; }

// common/dttypes.h, without OpenMP.
#define for_four_channels(_var, ...) for (size_t _var = 0; _var < 4; _var++)
// glib's MAX, which darktable.h brings in.
#ifndef MAX
#define MAX(a, b) (((a) > (b)) ? (a) : (b))
#endif
