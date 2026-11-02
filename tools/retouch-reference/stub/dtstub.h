#pragma once
// Just enough of darktable's headers to build bilateral.c and ellipse.c's mask maths on their own.
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <float.h>
#include <stdio.h>
typedef int gboolean;
#define TRUE 1
#define FALSE 0
typedef float dt_aligned_pixel_t[4];
#define DT_OMP_FOR(...)
#define DT_OMP_FOR_SIMD(...)
#define DT_OMP_SIMD(...)
#define DT_OMP_PRAGMA(...)
#define DT_OMP_DECLARE_SIMD(...)
#define for_each_channel(c, ...) for(size_t c = 0; c < 4; c++)
#define copy_pixel(d, s) memcpy((d), (s), 4*sizeof(float))
#define dt_alloc_align_float(n) ((float*)calloc((n), sizeof(float)))
#define dt_calloc_align_float(n) ((float*)calloc((n), sizeof(float)))
#define dt_free_align(p) free(p)
#define dt_print(...)
#define dt_get_num_threads() 1
#define CLAMPS(a, mn, mx) ((a) < (mn) ? (mn) : ((a) > (mx) ? (mx) : (a)))
#define CLIP(x) ((x) < 0 ? 0.0f : ((x) > 1.0f ? 1.0f : (x)))
#define MIN(a, b) ((a) < (b) ? (a) : (b))
#define MAX(a, b) ((a) > (b) ? (a) : (b))
#define M_PI_F 3.14159265358979324f
#define M_PI_2f 1.57079632679489662f
#define DT_2PI_F 6.28318530717958648f
static inline float deg2radf(const float d) { return d * M_PI_F / 180.0f; }

// For dwt.c: image buffers and helpers, single-threaded.
#include <stdarg.h>
#include <assert.h>
typedef struct dt_iop_roi_t { int x, y, width, height; float scale; } dt_iop_roi_t;
#define restrict __restrict
#define DT_IMGSZ_CH_MASK 0x0000FFFF
#define DT_IMGSZ_PERTHREAD 0x00010000
#define DT_IMGSZ_CLEARBUF 0x00020000
#define DT_IMGSZ_INPUT 0x00040000
#define DT_IMGSZ_WIDTH 0x00100000
#define dt_get_perthread(buf, padsize) (buf)
#define dt_free_align(p) free(p)
static inline gboolean dt_iop_alloc_image_buffers(void *module, const dt_iop_roi_t *roi_in, const dt_iop_roi_t *roi_out, ...)
{
  va_list args; va_start(args, roi_out);
  for(;;)
  {
    const int size = va_arg(args, int);
    if(size == 0) { float **p = va_arg(args, float **); (void)p; break; }
    float **bufptr = va_arg(args, float **);
    const int ch = size & DT_IMGSZ_CH_MASK;
    const size_t n = (size & DT_IMGSZ_WIDTH) ? (size_t)ch * roi_in->width : (size_t)ch * roi_in->width * roi_in->height;
    *bufptr = calloc(n, sizeof(float));
    if(size & DT_IMGSZ_PERTHREAD) { size_t *pad = va_arg(args, size_t *); *pad = n; }
  }
  va_end(args);
  return TRUE;
}
static inline void dt_iop_image_add_image(float *const buf, const float *const other, const size_t width, const size_t height, const size_t ch)
{ for(size_t i = 0; i < width * height * ch; i++) buf[i] += other[i]; }
static inline void dt_iop_image_copy_by_size(float *const out, const float *const in, const size_t width, const size_t height, const size_t ch)
{ memcpy(out, in, sizeof(float) * width * height * ch); }
static inline void dt_iop_image_fill(float *const buf, const float fill_value, const size_t width, const size_t height, const size_t ch)
{ for(size_t i = 0; i < width * height * ch; i++) buf[i] = fill_value; }
