#pragma once
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdio.h>
typedef int gboolean;
#define TRUE 1
#define FALSE 0
typedef float dt_aligned_pixel_t[4];
#define DT_OMP_FOR(...)
#define DT_OMP_PRAGMA(...)
#define for_each_channel(c, ...) for(size_t c = 0; c < 4; c++)
#define copy_pixel(d, s) memcpy((d), (s), 4*sizeof(float))
#define dt_alloc_align_float(n) ((float*)calloc((n), sizeof(float)))
#define dt_alloc_align_type(t, n) ((t*)calloc((n), sizeof(t)))
#define dt_free_align(p) free(p)
#define dt_print(...)
#define DT_DEBUG_ALWAYS 0
