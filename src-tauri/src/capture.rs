// Copyright (c) 2019 Ingo Weyrich (heckflosse67@gmx.de)
// Ported from RawTherapee rtengine/capturesharpening.cc (calcRadiusBayer, calcRadiusXtrans,
// buildClipMaskBayer, buildClipMaskXtrans) and the raw scaling of rtengine/rawimagesource.cc
// (calculate_scale_mul) at commit b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c.
// Translated from C++ to Rust; the raw data comes from LibRaw's unpacked mosaic.
// SPDX-License-Identifier: GPL-3.0-or-later
//! What RawTherapee's capture sharpening reads from the raw sensor data before
//! demosaicing: the blur radius it deconvolves, estimated from how sharply
//! neighbouring green pixels can differ, and which pixels are near clipping.

use std::ffi::{c_char, c_int};
use std::path::Path;

#[repr(C)]
struct EmuRawMosaic {
    width: c_int,
    height: c_int,
    flip: c_int,
    pattern_size: c_int,
    pattern: [[u8; 6]; 6],
    black: [f32; 3],
    white: f32,
    pre_mul: [f32; 3],
}

unsafe extern "C" {
    fn emu_raw_mosaic(path: *const c_char, m: *mut EmuRawMosaic, data: *mut *mut u16, err: *mut c_char, errlen: usize) -> c_int;
    fn emu_raw_free_mosaic(data: *mut u16);
}

/// RawTherapee's ceiling on the auto radius.
pub const MAX_SIGMA: f32 = 2.0;
/// Pixels at or above this share of white count as clipped.
const CLIP_LIMIT: f32 = 0.95;
/// Neighbours darker than this (in RawTherapee's 0 to 65535 scale) don't count towards the radius.
const LOWER_LIMIT: f32 = 1000.0;

/// The sensor data scaled as RawTherapee scales it: black subtracted, then
/// multiplied so the strongest daylight channel reaches 65535 at white.
pub struct Mosaic {
    pub w: usize,
    pub h: usize,
    pub flip: i32,
    /// 2 (Bayer) or 6 (X-Trans).
    pub size: usize,
    pub pattern: [[u8; 6]; 6],
    pub data: Vec<f32>,
    /// White in the scaled data, per colour.
    pub white: [f32; 3],
}

impl Mosaic {
    fn at(&self, row: usize, col: usize) -> f32 {
        self.data[row * self.w + col]
    }
    pub fn color(&self, row: usize, col: usize) -> u8 {
        self.pattern[row % self.size][col % self.size]
    }
}

/// Read and scale the raw mosaic of a Bayer or X-Trans file.
pub fn mosaic(path: &Path) -> Result<Mosaic, String> {
    let cpath = std::ffi::CString::new(path.to_string_lossy().as_bytes()).map_err(|_| "bad path".to_string())?;
    let mut m = EmuRawMosaic { width: 0, height: 0, flip: 0, pattern_size: 0, pattern: [[0; 6]; 6], black: [0.0; 3], white: 0.0, pre_mul: [0.0; 3] };
    let mut data: *mut u16 = std::ptr::null_mut();
    let mut err = [0 as c_char; 256];
    let rc = unsafe { emu_raw_mosaic(cpath.as_ptr(), &mut m, &mut data, err.as_mut_ptr(), err.len()) };
    if rc != 0 {
        return Err(unsafe { std::ffi::CStr::from_ptr(err.as_ptr()) }.to_string_lossy().into_owned());
    }
    let (w, h) = (m.width as usize, m.height as usize);
    let raw = unsafe { std::slice::from_raw_parts(data, w * h) };
    // calculate_scale_mul, with LibRaw's daylight multipliers as RawTherapee's pre_mul.
    let pre = if m.pre_mul.iter().all(|v| *v > 0.0) { m.pre_mul } else { [1.0; 3] };
    let max_pre = pre.iter().cloned().fold(0.0f32, f32::max);
    let scale: [f32; 3] = std::array::from_fn(|c| pre[c] / max_pre * 65535.0 / (m.white - m.black[c]));
    let size = m.pattern_size as usize;
    let mut out = vec![0f32; w * h];
    for row in 0..h {
        for col in 0..w {
            let c = m.pattern[row % size][col % size] as usize;
            out[row * w + col] = (raw[row * w + col] as f32 - m.black[c]) * scale[c];
        }
    }
    unsafe { emu_raw_free_mosaic(data) };
    let white = std::array::from_fn(|c| (m.white - m.black[c]) * scale[c]);
    Ok(Mosaic { w, h, flip: m.flip, size, pattern: m.pattern, data: out, white })
}

/// The radius to deconvolve: RawTherapee's calcRadiusBayer or calcRadiusXtrans, capped at 2.
pub fn auto_radius(m: &Mosaic) -> f32 {
    let clip = m.white[1];
    let r = if m.size == 2 { radius_bayer(m, LOWER_LIMIT, clip) } else { radius_xtrans(m, LOWER_LIMIT, clip) };
    r.min(MAX_SIGMA)
}

fn radius_bayer(m: &Mosaic, lower: f32, upper: f32) -> f32 {
    let (w, h) = (m.w, m.h);
    let fc = [m.color(0, 0), m.color(1, 0)];
    let mut max_ratio = 1f32;
    for row in 4..h.saturating_sub(4) {
        let mut col = 5 + (fc[row & 1] & 1) as usize;
        while col < w - 4 {
            let v00 = m.at(row, col);
            if v00 > 0.0 {
                let v1m1 = m.at(row + 1, col - 1);
                let v1p1 = m.at(row + 1, col + 1);
                let max0 = v00.max(v1m1);
                if v1m1 > 0.0 && max0 > lower {
                    let min = v00.min(v1m1);
                    if max0 > max_ratio * min {
                        // Skip pairs next to a clipped green.
                        let clipped = if max0 == v00 {
                            m.at(row - 1, col - 1).max(m.at(row - 1, col + 1)).max(v1p1) >= upper
                        } else {
                            m.at(row, col - 2).max(v00).max(m.at(row + 2, col - 2)).max(m.at(row + 2, col)) >= upper
                        };
                        if !clipped {
                            max_ratio = max0 / min;
                        }
                    }
                }
                let max1 = v00.max(v1p1);
                if v1p1 > 0.0 && max1 > lower {
                    let min = v00.min(v1p1);
                    if max1 > max_ratio * min {
                        let clipped = if max1 == v00 {
                            m.at(row - 1, col - 1).max(m.at(row - 1, col + 1)).max(v1p1) >= upper
                        } else {
                            v00.max(m.at(row, col + 2)).max(m.at(row + 2, col)).max(m.at(row + 2, col + 2)) >= upper
                        };
                        if !clipped {
                            max_ratio = max1 / min;
                        }
                    }
                }
            }
            col += 2;
        }
    }
    (1.0 / max_ratio.ln()).sqrt()
}

/// The first "solitary" green of the X-Trans pattern from (6, 6), as RawTherapee finds it.
fn xtrans_start(m: &Mosaic) -> (usize, usize) {
    for i in 6..12 {
        for j in 6..12 {
            if m.color(i, j) == 1 && m.color(i, j - 1) != m.color(i, j + 1) && m.color(i - 1, j) != 1 && m.color(i, j - 1) != 1 {
                return (i, j);
            }
        }
    }
    (12, 12)
}

fn radius_xtrans(m: &Mosaic, lower: f32, upper: f32) -> f32 {
    let (starty, startx) = xtrans_start(m);
    let (w, h) = (m.w, m.h);
    let mut max_ratio = 1f32;
    let take = |a: f32, b: f32, max_ratio: &mut f32| {
        let maxv = a.max(b);
        if maxv > lower {
            let minv = a.min(b);
            if maxv > *max_ratio * minv {
                *max_ratio = maxv / minv;
            }
        }
    };
    let mut row = starty + 2;
    while row < h.saturating_sub(4) {
        let mut col = startx + 2;
        while col < w - 4 {
            let vp1p1 = m.at(row + 1, col + 1);
            let square_clipped = vp1p1.max(m.at(row + 1, col + 2)).max(m.at(row + 2, col + 1)).max(m.at(row + 2, col + 2)) >= upper;
            let solitary = m.at(row, col);
            if solitary > 1.0 && m.at(row - 1, col - 1).max(m.at(row - 1, col + 1)) < upper && solitary < upper {
                let vp1m1 = m.at(row + 1, col - 1);
                if vp1m1 > 1.0 && m.at(row + 1, col - 2).max(vp1m1).max(m.at(row + 2, col - 2)).max(m.at(row + 1, col - 1)) < upper {
                    take(solitary, vp1m1, &mut max_ratio);
                }
                if vp1p1 > 1.0 && !square_clipped {
                    take(solitary, vp1p1, &mut max_ratio);
                }
            }
            if !square_clipped {
                let vp2p2 = m.at(row + 2, col + 2);
                if vp2p2 > 1.0 {
                    if vp1p1 > 1.0 {
                        take(vp1p1, vp2p2, &mut max_ratio);
                    }
                    let right = m.at(row + 3, col + 3);
                    if right.max(m.at(row + 4, col + 2)).max(m.at(row + 4, col + 4)) < upper && right > 1.0 {
                        take(right, vp2p2, &mut max_ratio);
                    }
                }
                let vp1p2 = m.at(row + 1, col + 2);
                let vp2p1 = m.at(row + 2, col + 1);
                if vp2p1 > 1.0 {
                    if vp1p2 > 1.0 {
                        take(vp1p2, vp2p1, &mut max_ratio);
                    }
                    let left = m.at(row + 3, col);
                    if left.max(m.at(row + 4, col - 1)).max(m.at(row + 4, col + 1)) < upper && left > 1.0 {
                        take(left, vp2p1, &mut max_ratio);
                    }
                }
            }
            col += 3;
        }
        row += 3;
    }
    (1.0 / max_ratio.ln()).sqrt()
}

/// RawTherapee's clip mask: 0 within a 5×5 diamond of any pixel at 95% of white or more, else 1.
pub fn clip_mask(m: &Mosaic) -> Vec<u8> {
    let (w, h) = (m.w, m.h);
    let mut mask = vec![1u8; w * h];
    for row in 2..h.saturating_sub(2) {
        for col in 2..w.saturating_sub(2) {
            let c = m.color(row, col) as usize;
            if m.at(row, col) >= m.white[c] * CLIP_LIMIT {
                for (dr, span) in [(-2i32, 1i32), (-1, 2), (0, 2), (1, 2), (2, 1)] {
                    let r = (row as i32 + dr) as usize;
                    for dc in -span..=span {
                        mask[r * w + (col as i32 + dc) as usize] = 0;
                    }
                }
            }
        }
    }
    mask
}

/// Where an output pixel of an image oriented by LibRaw's `flip` lies in sensor
/// orientation, for a sensor image of w × h (dcraw's flip_index).
fn unflip(flip: i32, row: usize, col: usize, w: usize, h: usize) -> (usize, usize) {
    let (mut r, mut c) = if flip & 4 != 0 { (col, row) } else { (row, col) };
    if flip & 2 != 0 {
        r = h - 1 - r;
    }
    if flip & 1 != 0 {
        c = w - 1 - c;
    }
    (r, c)
}

/// The clip mask oriented like the decoded image and resampled to out_w × out_h:
/// an output pixel is masked (0) if any sensor pixel under it is.
pub fn oriented_mask(m: &Mosaic, mask: &[u8], out_w: usize, out_h: usize) -> Vec<u8> {
    let turned = m.flip & 4 != 0;
    let (ow, oh) = if turned { (m.h, m.w) } else { (m.w, m.h) };
    let (sx, sy) = (ow as f32 / out_w as f32, oh as f32 / out_h as f32);
    let mut out = vec![1u8; out_w * out_h];
    for y in 0..out_h {
        let (y0, y1) = ((y as f32 * sy) as usize, (((y + 1) as f32 * sy).ceil() as usize).min(oh));
        for x in 0..out_w {
            let (x0, x1) = ((x as f32 * sx) as usize, (((x + 1) as f32 * sx).ceil() as usize).min(ow));
            'block: for oy in y0..y1.max(y0 + 1) {
                for ox in x0..x1.max(x0 + 1) {
                    let (r, c) = unflip(m.flip, oy, ox, m.w, m.h);
                    if mask[r * m.w + c] == 0 {
                        out[y * out_w + x] = 0;
                        break 'block;
                    }
                }
            }
        }
    }
    out
}

/// What capture sharpening needs for one photo, read from the raw data once.
pub struct Info {
    pub radius: f32,
    mosaic: Mosaic,
    mask: Vec<u8>,
}

impl Info {
    pub fn read(path: &Path) -> Result<Info, String> {
        let mosaic = mosaic(path)?;
        let radius = auto_radius(&mosaic);
        let mask = clip_mask(&mosaic);
        Ok(Info { radius, mosaic, mask })
    }

    pub fn mask_at(&self, w: usize, h: usize) -> Vec<u8> {
        oriented_mask(&self.mosaic, &self.mask, w, h)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bayer(w: usize, h: usize, f: impl Fn(usize, usize) -> f32) -> Mosaic {
        let mut data = vec![0f32; w * h];
        for r in 0..h {
            for c in 0..w {
                data[r * w + c] = f(r, c);
            }
        }
        // RGGB
        let mut pattern = [[0u8; 6]; 6];
        for (i, row) in pattern.iter_mut().enumerate() {
            for (j, v) in row.iter_mut().enumerate() {
                *v = match (i % 2, j % 2) {
                    (0, 0) => 0,
                    (1, 1) => 2,
                    _ => 1,
                };
            }
        }
        Mosaic { w, h, flip: 0, size: 2, pattern, data, white: [65535.0; 3] }
    }

    #[test]
    fn a_sharper_green_step_means_a_smaller_radius() {
        // Greens that differ by a factor k across a diagonal give sqrt(1 / ln k).
        let soft = bayer(64, 64, |r, c| if r + c < 64 { 20000.0 } else { 30000.0 });
        let hard = bayer(64, 64, |r, c| if r + c < 64 { 4000.0 } else { 30000.0 });
        let (rs, rh) = (auto_radius(&soft), auto_radius(&hard));
        assert!((rs - (1.0 / 1.5f32.ln()).sqrt().min(MAX_SIGMA)).abs() < 1e-4, "{rs}");
        assert!((rh - (1.0 / 7.5f32.ln()).sqrt()).abs() < 1e-4, "{rh}");
    }

    #[test]
    fn orients_and_shrinks_the_mask() {
        // A 4x2 sensor with its top-right pixel clipped, turned 90 degrees clockwise (flip 6).
        let m = Mosaic { w: 4, h: 2, flip: 6, size: 2, pattern: [[1; 6]; 6], data: vec![0.0; 8], white: [1.0; 3] };
        let mut mask = vec![1u8; 8];
        mask[3] = 0;
        // Turned clockwise, the sensor's top right ends up bottom right of a 2x4 image.
        let out = oriented_mask(&m, &mask, 2, 4);
        assert_eq!(out, vec![1, 1, 1, 1, 1, 1, 1, 0]);
        // Shrunk to 1x2, the masked pixel takes its block with it.
        assert_eq!(oriented_mask(&m, &mask, 1, 2), vec![1, 0]);
    }

    #[test]
    fn masks_around_clipped_pixels() {
        let m = bayer(16, 16, |r, c| if (r, c) == (8, 8) { 65000.0 } else { 1000.0 });
        let mask = clip_mask(&m);
        assert_eq!(mask[8 * 16 + 8], 0);
        assert_eq!(mask[6 * 16 + 8], 0);
        assert_eq!(mask[6 * 16 + 6], 1);
        assert_eq!(mask.iter().filter(|v| **v == 0).count(), 21);
    }

    /// Prints the auto radius for real files. Run with
    /// `EMULSION_RAW_SAMPLES=a.orf:b.raf cargo test --release --lib measure_radius -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn measure_radius() {
        let samples = std::env::var("EMULSION_RAW_SAMPLES").expect("set EMULSION_RAW_SAMPLES");
        for path in samples.split(':') {
            let t = std::time::Instant::now();
            let m = mosaic(Path::new(path)).unwrap();
            let r = auto_radius(&m);
            let clipped = clip_mask(&m).iter().filter(|v| **v == 0).count() as f32 / (m.w * m.h) as f32;
            println!(
                "{:<14} {}x{} {} radius {r:.3}  clipped {:.2}%  {:?}",
                Path::new(path).file_name().unwrap().to_string_lossy(),
                m.w,
                m.h,
                if m.size == 2 { "Bayer  " } else { "X-Trans" },
                clipped * 100.0,
                t.elapsed()
            );
        }
    }
}
