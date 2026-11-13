// SPDX-License-Identifier: GPL-3.0-or-later
// A narrow C interface over LibRaw for raw.rs. LibRaw demosaics and white
// balances; the colour conversion is left to Rust so it can be tested there.

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <new>

#include "libraw/libraw.h"

extern "C" {

struct EmuRawInfo {
  int width;
  int height;
  // Camera from XYZ (D65), as in DNG ColorMatrix2. All zero when LibRaw has no data for the camera.
  float cam_xyz[3][3];
  // As-shot white balance multipliers for R, G, B. All zero when the file has none.
  float cam_mul[3];
  // Size of a full decode, oriented.
  int full_width;
  int full_height;
  char make[64];
  char model[64];
  float iso;
  float shutter;
  float aperture;
  float focal_length;
  float focal_length35;
  // Nonzero for a DNG, whose own matrix cam_xyz holds.
  int dng;
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

// The undemosaiced sensor data of a Bayer or X-Trans file, for capture sharpening.
struct EmuRawMosaic {
  // Visible area, in sensor orientation (before `flip`).
  int width;
  int height;
  // LibRaw's flip code, as in EmuRawThumb.
  int flip;
  // Size of the colour pattern: 2 for Bayer, 6 for X-Trans, 0 for anything else.
  int pattern_size;
  // Colour of each pattern cell from the visible area's top left: 0 red, 1 green, 2 blue.
  unsigned char pattern[6][6];
  // Black level per colour (red, green, blue) and the white level.
  float black[3];
  float white;
  // LibRaw's daylight multipliers (pre_mul) for red, green, blue.
  float pre_mul[3];
};

static void set_error(char *err, size_t len, const char *what, int code) {
  if (err && len) snprintf(err, len, "%s: %s", what, libraw_strerror(code));
}

static void copy_str(char *dst, const char *src, size_t len) {
  strncpy(dst, src, len - 1);
  dst[len - 1] = '\0';
}

// A DNG's own camera-from-XYZ matrix, built as LibRaw's identify() builds it for its
// cmatrix (src/metadata/identify.cpp): the D65 ColorMatrix, else another daylight-type one,
// times CameraCalibration and AnalogBalance. LibRaw keeps the result private and leaves
// color.cam_xyz to its own camera table, which has no entry for many DNG writers (Apple
// ProRAW, phones, converters). False when the file carries no usable matrix.
static bool dng_cam_xyz(LibRaw *raw, float out[3][3]) {
  const libraw_colordata_t &c = raw->imgdata.color;
  if (!raw->imgdata.idata.dng_version || raw->imgdata.idata.colors != 3) return false;
  int pick = -1;
  for (int i = 0; i < 2 && pick < 0; i++)
    if (c.dng_color[i].illuminant == LIBRAW_WBI_D65) pick = i;
  for (int i = 0; i < 2 && pick < 0; i++) {
    const int ill = c.dng_color[i].illuminant;
    if (ill == LIBRAW_WBI_Daylight || ill == LIBRAW_WBI_D55 || ill == LIBRAW_WBI_D75 || ill == LIBRAW_WBI_D50 ||
        ill == LIBRAW_WBI_Flash)
      pick = i;
  }
  if (pick < 0) return false;
  const libraw_dng_color_t &d = c.dng_color[pick];
  double cc[3][3];
  const bool calibrated = d.parsedfields & LIBRAW_DNGFM_CALIBRATION;
  bool any = false;
  for (int i = 0; i < 3; i++)
    for (int j = 0; j < 3; j++) {
      cc[i][j] = calibrated ? d.calibration[i][j] : (i == j);
      any |= d.colormatrix[i][j] != 0;
    }
  if (!any) return false;
  const bool balanced = c.dng_levels.parsedfields & LIBRAW_DNGFM_ANALOGBALANCE;
  for (int i = 0; i < 3; i++) {
    const double ab = balanced && c.dng_levels.analogbalance[i] > 0 ? c.dng_levels.analogbalance[i] : 1.0;
    for (int j = 0; j < 3; j++) cc[i][j] *= ab;
  }
  for (int r = 0; r < 3; r++)
    for (int k = 0; k < 3; k++) {
      double v = 0;
      for (int j = 0; j < 3; j++) v += cc[r][j] * d.colormatrix[j][k];
      out[r][k] = float(v);
    }
  return true;
}

// darktable's crop for a camera whose whole sensor readout LibRaw kept (src/raw.rs).
int emu_camera_crop(const char *path, const char *make, const char *model, int raw_w, int raw_h, int *out);

// open_file, then darktable's crop where LibRaw has no size for the camera: it leaves the whole
// readout (no margins), which for a Sony ARW it doesn't know includes the black padding around
// the image. Set before unpack, which keeps these sizes for processing.
static int emu_open(LibRaw *raw, const char *path) {
  int rc = raw->open_file(path);
  if (rc != LIBRAW_SUCCESS) return rc;
  libraw_image_sizes_t &s = raw->imgdata.sizes;
  if (raw->imgdata.idata.dng_version || s.left_margin || s.top_margin || s.width != s.raw_width ||
      s.height != s.raw_height)
    return rc;
  int c[4];
  if (emu_camera_crop(path, raw->imgdata.idata.normalized_make, raw->imgdata.idata.normalized_model, s.raw_width,
                      s.raw_height, c) &&
      c[0] + c[2] <= s.raw_width && c[1] + c[3] <= s.raw_height) {
    s.left_margin = c[0];
    s.top_margin = c[1];
    s.width = c[2];
    s.height = c[3];
    s.iwidth = s.width;
    s.iheight = s.height;
  }
  return rc;
}

// Colour metadata, read after open_file.
static void fill_colour_info(LibRaw *raw, EmuRawInfo *info) {
  for (int i = 0; i < 3; i++) {
    for (int j = 0; j < 3; j++) info->cam_xyz[i][j] = raw->imgdata.color.cam_xyz[i][j];
    info->cam_mul[i] = raw->imgdata.color.cam_mul[i];
  }
  // For DNGs, LibRaw colours from the file's matrix, not its table: do the same.
  dng_cam_xyz(raw, info->cam_xyz);
  info->dng = raw->imgdata.idata.dng_version != 0;
  const libraw_image_sizes_t &s = raw->imgdata.sizes;
  const bool turned = s.flip & 4;
  info->full_width = turned ? s.height : s.width;
  info->full_height = turned ? s.width : s.height;
  copy_str(info->make, raw->imgdata.idata.normalized_make, sizeof info->make);
  copy_str(info->model, raw->imgdata.idata.normalized_model, sizeof info->model);
  info->iso = raw->imgdata.other.iso_speed;
  info->shutter = raw->imgdata.other.shutter;
  info->aperture = raw->imgdata.other.aperture;
  info->focal_length = raw->imgdata.other.focal_len;
  info->focal_length35 = raw->imgdata.lens.FocalLengthIn35mmFormat;
}

// Make the calling thread an OpenMP root that stays registered. libomp tears down its
// runtime, including the lock behind LibRaw's allocator (`#pragma omp critical` in
// libraw_alloc.h), when the last root thread exits; the next LibRaw call from a new thread
// then takes a dangling lock and crashes in __kmp_acquire_ticket_lock. Our calls come from
// tokio's blocking threads, which exit when idle, so the app parks one thread here for good
// (raw::openmp_root). Reproduced and checked with short-lived threads, 2026-11-04.
void emu_omp_root(void) {
#ifdef LIBRAW_USE_OPENMP
#pragma omp parallel
  { (void)omp_get_thread_num(); }
#endif
}

// Decode to 16-bit linear camera RGB, white balanced as shot and oriented.
// On success `*out` holds an image for emu_raw_free and its pixels start at `*pixels`.
int emu_raw_decode(const char *path, int half, EmuRawInfo *info, void **out, const unsigned short **pixels,
                   char *err, size_t errlen) {
#ifdef LIBRAW_USE_OPENMP
  // Full X-Trans demosaicing benefits from the efficiency cores too. Keep small
  // preview decodes at four threads and bound full-size work to eight. This
  // setting belongs to the blocking worker and is restored after the decode.
  struct DecodeThreads {
    int previous;
    DecodeThreads(bool preview) : previous(omp_get_max_threads()) {
      const int limit = preview ? 4 : 8;
      omp_set_num_threads(previous > limit ? limit : previous);
    }
    ~DecodeThreads() { omp_set_num_threads(previous); }
  } threads(half != 0);
#endif
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

  int rc = emu_open(raw, path);
  if (rc != LIBRAW_SUCCESS) {
    set_error(err, errlen, "open", rc);
    delete raw;
    return rc;
  }
  // The photo's size, read before processing: with half_size, dcraw_process shrinks
  // imgdata.sizes to the half-size image, and the preview then claimed the photo was
  // half as big as it is (so 100% zoom showed 50%).
  const libraw_image_sizes_t &opened = raw->imgdata.sizes;
  const int open_w = (opened.flip & 4) ? opened.height : opened.width;
  const int open_h = (opened.flip & 4) ? opened.width : opened.height;
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
  fill_colour_info(raw, info);
  // A full decode is the photo's size; a half-size one takes it from before processing.
  info->full_width = half ? open_w : img->width;
  info->full_height = half ? open_h : img->height;

  *out = img;
  *pixels = reinterpret_cast<const unsigned short *>(img->data);
  delete raw;
  return LIBRAW_SUCCESS;
}

// Colour metadata only, without decoding: much faster than emu_raw_decode.
int emu_raw_info(const char *path, EmuRawInfo *info, char *err, size_t errlen) {
  LibRaw *raw = new (std::nothrow) LibRaw(0);
  if (!raw) return LIBRAW_UNSUFFICIENT_MEMORY;
  int rc = emu_open(raw, path);
  if (rc != LIBRAW_SUCCESS) {
    set_error(err, errlen, "open", rc);
    delete raw;
    return rc;
  }
  info->width = raw->imgdata.sizes.iwidth;
  info->height = raw->imgdata.sizes.iheight;
  fill_colour_info(raw, info);
  delete raw;
  return LIBRAW_SUCCESS;
}

// The largest preview embedded in the file. Free with emu_raw_free.
int emu_raw_thumb(const char *path, EmuRawThumb *thumb, void **out, char *err, size_t errlen) {
  LibRaw *raw = new (std::nothrow) LibRaw(0);
  if (!raw) return LIBRAW_UNSUFFICIENT_MEMORY;
  int rc = emu_open(raw, path);
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

// The visible sensor data, unprocessed. On success `*data` is width × height
// values from malloc, for emu_raw_free_mosaic.
int emu_raw_mosaic(const char *path, EmuRawMosaic *m, unsigned short **data, char *err, size_t errlen) {
  LibRaw *raw = new (std::nothrow) LibRaw(0);
  if (!raw) return LIBRAW_UNSUFFICIENT_MEMORY;
  int rc = emu_open(raw, path);
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
  const libraw_image_sizes_t &s = raw->imgdata.sizes;
  const libraw_colordata_t &c = raw->imgdata.color;
  const unsigned short *src = raw->imgdata.rawdata.raw_image;
  const bool xtrans = raw->imgdata.idata.filters == 9;
  const bool bayer = raw->imgdata.idata.filters > 1000 && raw->imgdata.idata.colors == 3;
  if (!src || !(xtrans || bayer)) {
    if (err && errlen) snprintf(err, errlen, "not a Bayer or X-Trans file");
    delete raw;
    return LIBRAW_UNSPECIFIED_ERROR;
  }
  m->width = s.width;
  m->height = s.height;
  m->flip = s.flip;
  m->pattern_size = xtrans ? 6 : 2;
  for (int i = 0; i < 6; i++)
    for (int j = 0; j < 6; j++) {
      int col = raw->COLOR(i, j);
      m->pattern[i][j] = (unsigned char)(col == 3 ? 1 : col);
    }
  for (int k = 0; k < 3; k++) {
    m->black[k] = (float)(c.black + c.cblack[k]);
    m->pre_mul[k] = c.pre_mul[k];
  }
  m->white = (float)c.maximum;
  unsigned short *out = static_cast<unsigned short *>(malloc(sizeof(unsigned short) * s.width * s.height));
  if (!out) {
    delete raw;
    return LIBRAW_UNSUFFICIENT_MEMORY;
  }
  for (int row = 0; row < s.height; row++)
    memcpy(out + (size_t)row * s.width, src + (size_t)(row + s.top_margin) * s.raw_pitch / 2 + s.left_margin, sizeof(unsigned short) * s.width);
  *data = out;
  delete raw;
  return LIBRAW_SUCCESS;
}

void emu_raw_free_mosaic(unsigned short *data) { free(data); }

void emu_raw_free(void *img) { LibRaw::dcraw_clear_mem(static_cast<libraw_processed_image_t *>(img)); }

}  // extern "C"
