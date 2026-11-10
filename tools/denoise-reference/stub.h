/* Minimal stand-ins for the darktable headers process_wavelets and eaw_dn_decompose need. */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <sys/types.h>
typedef int gboolean;
#define TRUE 1
#define FALSE 0
#define DT_PIXEL_APPLY_DPI(v) (v)
typedef float __attribute__((aligned(16))) dt_aligned_pixel_t[4];
typedef float __attribute__((aligned(16))) dt_colormatrix_t[4][4];
#define for_each_channel(_var, ...) for(size_t _var = 0; _var < 4; _var++)
#define DT_OMP_FOR(...)
#define DT_OMP_SIMD(...)
#define dt_omploop_sfence()
#define MAX(a, b) ((a) > (b) ? (a) : (b))
#define MIN(a, b) ((a) < (b) ? (a) : (b))
#define CLAMP(x, lo, hi) MAX(MIN((x), (hi)), (lo))
#define dt_log2f log2f
#define dt_free_align free
#define debug_dump_PFM(...)
static inline void copy_pixel_nontemporal(float *const out, const float *const in) { memcpy(out, in, 4 * sizeof(float)); }
static inline void dt_apply_transposed_color_matrix(const dt_aligned_pixel_t in, const dt_colormatrix_t m, dt_aligned_pixel_t out)
{ for(int r = 0; r < 4; r++) out[r] = in[0] * m[0][r] + in[1] * m[1][r] + in[2] * m[2][r]; }
static inline void dt_colormatrix_transpose(dt_colormatrix_t out, const dt_colormatrix_t in)
{ for(int i = 0; i < 4; i++) for(int j = 0; j < 4; j++) out[i][j] = in[j][i]; }
typedef struct dt_draw_curve_t dt_draw_curve_t;
typedef struct { int width, height; float scale; } dt_iop_roi_t;
typedef struct { struct { struct { float coeffs[4]; } temperature; float processed_maximum[4]; } dsc; } dt_dev_pixelpipe_t;
typedef struct { void *data; float iscale; struct { int width, height; } buf_in; dt_dev_pixelpipe_t *pipe; int colors; } dt_dev_pixelpipe_iop_t;
typedef struct { int unused; } dt_iop_module_t;
static inline gboolean dt_iop_alloc_image_buffers(dt_iop_module_t *s, const dt_iop_roi_t *i, const dt_iop_roi_t *o, int c1, float **a, int c2, float **b, int c3, float **c, int z, void *n)
{ size_t px = (size_t)i->width * i->height; *a = calloc(px * c1, 4); *b = calloc(px * c2, 4); *c = calloc(px * c3, 4); return 1; }
static inline void dt_iop_image_fill(float *buf, float v, int w, int h, int ch) { for(size_t k = 0; k < (size_t)w * h * ch; k++) buf[k] = v; }
static inline void dt_iop_copy_image_roi(float *out, const float *in, int ch, const dt_iop_roi_t *i, const dt_iop_roi_t *o) { memcpy(out, in, (size_t)i->width * i->height * 16); }
#define for_four_channels(_var, ...) for(size_t _var = 0; _var < 4; _var++)
static inline void dt_vector_exp(const dt_aligned_pixel_t in, dt_aligned_pixel_t out) { for(int c = 0; c < 4; c++) out[c] = expf(in[c]); }
static inline void dt_vector_min(dt_aligned_pixel_t out, const dt_aligned_pixel_t a, const dt_aligned_pixel_t b) { for(int c = 0; c < 4; c++) out[c] = fminf(a[c], b[c]); }
static inline void dt_vector_max(dt_aligned_pixel_t out, const dt_aligned_pixel_t a, const dt_aligned_pixel_t b) { for(int c = 0; c < 4; c++) out[c] = fmaxf(a[c], b[c]); }
