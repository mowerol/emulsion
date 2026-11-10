/* Appended after the upstream functions: fills the pipe and data structs as process() would. */
void run(int w, int h, int fw, int fh, float scale, const float *p, const float *in, float *out)
{
  dt_iop_denoiseprofile_data_t d;
  memset(&d, 0, sizeof d);
  d.strength = p[0]; d.shadows = p[1]; d.bias = p[2];
  for(int b = 0; b < DT_IOP_DENOISE_PROFILE_BANDS; b++)
    for(int c = 0; c < DT_DENOISE_PROFILE_NONE; c++) d.force[c][b] = 0.5f;
  for(int b = 0; b < DT_IOP_DENOISE_PROFILE_BANDS; b++)
  {
    d.force[DT_DENOISE_PROFILE_Y0][b] = p[3];
    d.force[DT_DENOISE_PROFILE_U0V0][b] = p[4];
  }
  d.a[0] = d.a[1] = d.a[2] = p[5];
  d.b[0] = d.b[1] = d.b[2] = p[6];
  d.mode = MODE_WAVELETS;
  d.wb_adaptive_anscombe = TRUE;
  d.fix_anscombe_and_nlmeans_norm = TRUE;
  d.use_new_vst = TRUE;
  d.wavelet_color_mode = MODE_Y0U0V0;
  dt_dev_pixelpipe_t pipe;
  memset(&pipe, 0, sizeof pipe);
  for(int c = 0; c < 3; c++) pipe.dsc.temperature.coeffs[c] = p[7 + c];
  /* The preview pipe's buffer is the full image downscaled by `scale` (iscale), its ROI at scale. */
  dt_dev_pixelpipe_iop_t piece = { &d, 1.0f, { fw, fh }, &pipe, 4 };
  dt_iop_roi_t roi = { w, h, scale };
  dt_iop_module_t self = { 0 };
  process_wavelets(&self, &piece, in, out, &roi, &roi, eaw_dn_decompose, eaw_synthesize);
}
