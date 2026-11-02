// Runs darktable's bilateral blur or ellipse mask on numbers read from stdin and prints the result.
//   bilateral w h sigma_s sigma_r detail, then w*h*4 floats (Lab): prints the sliced w*h*4 floats
//   dwt w h scales merge_from preview_scale, then w*h*4 floats: prints each layer (scale, then w*h*4 floats) as
//     dwt_decompose passes it, then the rebuilt image
//   ellipse W H cx cy r0 r1 rotation border proportional: prints x y w h, then the w*h mask
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "common/bilateral.h"
#include "dwt.h"
#include "ellipse_parts.c"

static int g_n;
static void print_layer(float *layer, dwt_params_t *const p, const int scale)
{
  printf("%d\n", scale);
  for(int i = 0; i < g_n; i++) printf("%.9g\n", layer[i]);
}

int main(int argc, char **argv)
{
  char what[32];
  if(scanf("%31s", what) != 1) return 1;
  if(!strcmp(what, "bilateral"))
  {
    int w, h; float ss, sr, detail;
    if(scanf("%d %d %f %f %f", &w, &h, &ss, &sr, &detail) != 5) return 1;
    size_t n = (size_t)w * h * 4;
    float *in = malloc(n * sizeof(float)), *out = malloc(n * sizeof(float));
    for(size_t i = 0; i < n; i++) if(scanf("%f", &in[i]) != 1) return 1;
    dt_bilateral_t *b = dt_bilateral_init(w, h, ss, sr);
    dt_bilateral_splat(b, in);
    dt_bilateral_blur(b);
    dt_bilateral_slice(b, in, out, detail);
    for(size_t i = 0; i < n; i++) printf("%.9g\n", out[i]);
    return 0;
  }
  if(!strcmp(what, "dwt"))
  {
    int w, h, scales, merge; float ps;
    if(scanf("%d %d %d %d %f", &w, &h, &scales, &merge, &ps) != 5) return 1;
    g_n = w * h * 4;
    float *img = malloc(sizeof(float) * g_n);
    for(int i = 0; i < g_n; i++) if(scanf("%f", &img[i]) != 1) return 1;
    dwt_params_t *p = dt_dwt_init(img, w, h, 4, scales, 0, merge, NULL, ps);
    dwt_decompose(p, print_layer);
    printf("%d\n", -1);
    for(int i = 0; i < g_n; i++) printf("%.9g\n", img[i]);
    return 0;
  }
  if(!strcmp(what, "ellipse"))
  {
    // _ellipse_get_area then _ellipse_get_mask with no distortions.
    int W, H, prop; float cx, cy, r0, r1, rot, border;
    if(scanf("%d %d %f %f %f %f %f %f %d", &W, &H, &cx, &cy, &r0, &r1, &rot, &border, &prop) != 9) return 1;
    const float wd = W, ht = H;
    const float total[2] = { (prop ? r0 * (1.0f + border) : r0 + border) * MIN(wd, ht),
                             (prop ? r1 * (1.0f + border) : r1 + border) * MIN(wd, ht) };
    size_t count = 0;
    float *pts = _ellipse_points_to_transform(cx, cy, total[0], total[1], rot, wd, ht, &count);
    int w, h, px, py;
    _bounding_box(pts, count, &w, &h, &px, &py);
    printf("%d\n%d\n%d\n%d\n", px, py, w, h);
    float *points = malloc(sizeof(float) * 2 * w * h), *buf = malloc(sizeof(float) * w * h);
    for(int i = 0; i < h; i++) for(int j = 0; j < w; j++) { points[(i*w+j)*2] = j + px; points[(i*w+j)*2+1] = i + py; }
    const float center[2] = { cx * W, cy * H };
    const float radius[2] = { r0 * MIN(W, H), r1 * MIN(W, H) };
    float a, b, ta, tb, alpha;
    if(radius[0] >= radius[1]) { a = radius[0]; b = radius[1]; ta = total[0]; tb = total[1]; alpha = deg2radf(rot); }
    else { a = radius[1]; b = radius[0]; ta = total[1]; tb = total[0]; alpha = deg2radf(rot - 90.0f); }
    _fill_mask((size_t)w * h, buf, points, center, a, b, ta, tb, alpha, 0);
    for(int i = 0; i < w * h; i++) printf("%.9g\n", buf[i]);
    return 0;
  }
  return 1;
}
