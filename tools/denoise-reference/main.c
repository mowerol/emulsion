/* Runs darktable's process_wavelets (Y0U0V0, new VST) on an image read from stdin:
 *   w h fullw fullh scale strength shadows bias force_y0 force_u0v0 a1 b1 wb0 wb1 wb2
 * then w*h*4 floats. Writes w*h*4 floats. */
#include "stub.h"
#include <stdio.h>

void run(int w, int h, int fw, int fh, float scale, const float *p, const float *in, float *out);
int main(void)
{
  int w, h, fw, fh; float scale, prm[10];
  if(scanf("%d %d %d %d %f", &w, &h, &fw, &fh, &scale) != 5) return 1;
  for(int i = 0; i < 10; i++) if(scanf("%f", &prm[i]) != 1) return 1;
  size_t n = (size_t)w * h * 4;
  float *in = malloc(n * 4), *out = malloc(n * 4);
  for(size_t i = 0; i < n; i++) if(scanf("%f", &in[i]) != 1) return 1;
  run(w, h, fw, fh, scale, prm, in, out);
  for(size_t i = 0; i < n; i++) printf("%.9g\n", out[i]);
  return 0;
}
