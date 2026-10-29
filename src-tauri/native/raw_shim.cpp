// SPDX-License-Identifier: GPL-3.0-or-later
// A narrow C interface over LibRaw for raw.rs. LibRaw demosaics and white
// balances; the colour conversion is left to Rust so it can be tested there.

#include <cstdio>
#include <cstring>
#include <new>

#include "libraw/libraw.h"

extern "C" {

struct EmuRawInfo {
  int width;
  int height;
  // Camera from XYZ (D65), as in DNG ColorMatrix2. All zero when LibRaw has no data for the camera.
  float cam_xyz[3][3];
  char make[64];
  char model[64];
};

struct EmuRawThumb {
  // 1 for JPEG bytes, 2 for 8-bit RGB pixels.
  int format;
  int width;
  int height;
  // LibRaw's flip code: 0 none, 3 180 degrees, 5 90 counter-clockwise, 6 90 clockwise.
  int flip;
  const unsigned char *data;
  size_t len;
};

static void set_error(char *err, size_t len, const char *what, int code) {
  if (err && len) snprintf(err, len, "%s: %s", what, libraw_strerror(code));
}

static void copy_str(char *dst, const char *src, size_t len) {
  strncpy(dst, src, len - 1);
  dst[len - 1] = '\0';
}

// Decode to 16-bit linear camera RGB, white balanced as shot and oriented.
// On success `*out` holds an image for emu_raw_free and its pixels start at `*pixels`.
int emu_raw_decode(const char *path, int half, EmuRawInfo *info, void **out, const unsigned short **pixels,
                   char *err, size_t errlen) {
  LibRaw *raw = new (std::nothrow) LibRaw(0);
  if (!raw) return LIBRAW_UNSUFFICIENT_MEMORY;
  libraw_output_params_t &p = raw->imgdata.params;
  p.output_color = 0;  // stay in camera space
  p.output_bps = 16;
  p.gamm[0] = 1.0;
  p.gamm[1] = 1.0;
  p.no_auto_bright = 1;
  p.use_camera_wb = 1;
  p.half_size = half ? 1 : 0;
  p.highlight = 0;  // clip

  int rc = raw->open_file(path);
  if (rc != LIBRAW_SUCCESS) {
    set_error(err, errlen, "open", rc);
    delete raw;
    return rc;
  }
  if ((rc = raw->unpack()) != LIBRAW_SUCCESS) {
    set_error(err, errlen, "unpack", rc);
    delete raw;
    return rc;
  }
  if ((rc = raw->dcraw_process()) != LIBRAW_SUCCESS) {
    set_error(err, errlen, "process", rc);
    delete raw;
    return rc;
  }
  libraw_processed_image_t *img = raw->dcraw_make_mem_image(&rc);
  if (!img) {
    set_error(err, errlen, "image", rc);
    delete raw;
    return rc;
  }
  if (img->type != LIBRAW_IMAGE_BITMAP || img->colors != 3 || img->bits != 16) {
    if (err && errlen) snprintf(err, errlen, "unexpected output format");
    LibRaw::dcraw_clear_mem(img);
    delete raw;
    return LIBRAW_UNSPECIFIED_ERROR;
  }

  info->width = img->width;
  info->height = img->height;
  for (int i = 0; i < 3; i++)
    for (int j = 0; j < 3; j++) info->cam_xyz[i][j] = raw->imgdata.color.cam_xyz[i][j];
  copy_str(info->make, raw->imgdata.idata.normalized_make, sizeof info->make);
  copy_str(info->model, raw->imgdata.idata.normalized_model, sizeof info->model);

  *out = img;
  *pixels = reinterpret_cast<const unsigned short *>(img->data);
  delete raw;
  return LIBRAW_SUCCESS;
}

// The largest preview embedded in the file. Free with emu_raw_free.
int emu_raw_thumb(const char *path, EmuRawThumb *thumb, void **out, char *err, size_t errlen) {
  LibRaw *raw = new (std::nothrow) LibRaw(0);
  if (!raw) return LIBRAW_UNSUFFICIENT_MEMORY;
  int rc = raw->open_file(path);
  if (rc != LIBRAW_SUCCESS) {
    set_error(err, errlen, "open", rc);
    delete raw;
    return rc;
  }
  if ((rc = raw->unpack_thumb()) != LIBRAW_SUCCESS) {
    set_error(err, errlen, "preview", rc);
    delete raw;
    return rc;
  }
  libraw_processed_image_t *img = raw->dcraw_make_mem_thumb(&rc);
  if (!img) {
    set_error(err, errlen, "preview", rc);
    delete raw;
    return rc;
  }
  thumb->format = img->type == LIBRAW_IMAGE_JPEG ? 1 : (img->colors == 3 && img->bits == 8 ? 2 : 0);
  thumb->width = img->width;
  thumb->height = img->height;
  thumb->flip = raw->imgdata.sizes.flip;
  thumb->data = img->data;
  thumb->len = img->data_size;
  *out = img;
  delete raw;
  return LIBRAW_SUCCESS;
}

void emu_raw_free(void *img) { LibRaw::dcraw_clear_mem(static_cast<libraw_processed_image_t *>(img)); }

}  // extern "C"
