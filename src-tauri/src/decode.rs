// SPDX-License-Identifier: GPL-3.0-or-later
//! Decoding photos into the engine's input format.
//!
//! The engine receives RGBA half floats. For ordinary photos (JPEG, PNG, TIFF,
//! WebP) the values are linear light in sRGB primaries, still display-referred;
//! the GPU input stage expands them to scene-referred Rec.2020. RAW files arrive
//! already scene-referred (mode 2), decoded by LibRaw in raw.rs.

use half::f16;
use image::{imageops::FilterType, DynamicImage, ImageDecoder, ImageReader};
use rayon::prelude::*;
use std::path::Path;
use std::sync::OnceLock;

use crate::library::{classify, Kind};
use crate::raw;

/// How the engine should interpret the pixels. Mirrors `InputMode` in the frontend.
#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputMode {
    /// Linear light, sRGB primaries, display-referred (decoded JPEG/PNG/TIFF).
    DisplayLinear = 0,
    // 1 = sRGB-encoded 8-bit, used only for in-browser thumbnails.
    /// Scene-referred linear Rec.2020 (RAW).
    SceneLinear = 2,
}

/// Previews at or below this size decode RAWs at half resolution, which is
/// several times faster and still at least 2600 px wide for 20 MP sensors.
const RAW_HALF_MAX_EDGE: u32 = 2560;

pub const HEADER_BYTES: usize = 24;

/// Open a photo and apply its EXIF orientation.
pub fn open_oriented(path: &Path) -> Result<DynamicImage, String> {
    let reader = ImageReader::open(path)
        .map_err(|e| format!("Could not open {}: {e}", path.display()))?
        .with_guessed_format()
        .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    let mut decoder = reader
        .into_decoder()
        .map_err(|e| format!("Unsupported or damaged image {}: {e}", path.display()))?;
    let orientation = decoder.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut img = DynamicImage::from_decoder(decoder)
        .map_err(|e| format!("Could not decode {}: {e}", path.display()))?;
    img.apply_orientation(orientation);
    Ok(img)
}

/// Size that fits within `max_edge` on the long side, never upscaling.
pub fn fit(w: u32, h: u32, max_edge: Option<u32>) -> (u32, u32) {
    match max_edge {
        Some(m) if m > 0 && w.max(h) > m => {
            let s = m as f64 / w.max(h) as f64;
            (((w as f64 * s).round() as u32).max(1), ((h as f64 * s).round() as u32).max(1))
        }
        _ => (w, h),
    }
}

pub fn resize_to(img: DynamicImage, max_edge: Option<u32>) -> DynamicImage {
    let (w, h) = (img.width(), img.height());
    let (nw, nh) = fit(w, h, max_edge);
    if (nw, nh) == (w, h) {
        img
    } else {
        img.resize_exact(nw, nh, FilterType::Triangle)
    }
}

#[inline]
pub fn srgb_to_linear(v: f32) -> f32 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

fn lut8() -> &'static [u16; 256] {
    static L: OnceLock<[u16; 256]> = OnceLock::new();
    L.get_or_init(|| {
        let mut t = [0u16; 256];
        for (i, v) in t.iter_mut().enumerate() {
            *v = f16::from_f32(srgb_to_linear(i as f32 / 255.0)).to_bits();
        }
        t
    })
}

fn lut16() -> &'static [u16] {
    static L: OnceLock<Vec<u16>> = OnceLock::new();
    L.get_or_init(|| (0..65536u32).map(|i| f16::from_f32(srgb_to_linear(i as f32 / 65535.0)).to_bits()).collect())
}

const ONE: u16 = 0x3C00; // f16 1.0

/// RGBA half floats (little-endian bytes), linear light, alpha forced to 1.
pub fn linear_f16_rgba(img: &DynamicImage) -> Vec<u8> {
    let px = img.width() as usize * img.height() as usize;
    let mut out = vec![0u8; px * 8];
    match img {
        DynamicImage::ImageRgb32F(_) | DynamicImage::ImageRgba32F(_) => {
            // Float images are taken as already linear.
            let src = img.to_rgba32f();
            out.par_chunks_mut(8).zip(src.as_raw().par_chunks(4)).for_each(|(o, s)| {
                for c in 0..3 {
                    o[c * 2..c * 2 + 2].copy_from_slice(&f16::from_f32(s[c].max(0.0)).to_bits().to_le_bytes());
                }
                o[6..8].copy_from_slice(&ONE.to_le_bytes());
            });
        }
        DynamicImage::ImageLuma16(_)
        | DynamicImage::ImageLumaA16(_)
        | DynamicImage::ImageRgb16(_)
        | DynamicImage::ImageRgba16(_) => {
            let lut = lut16();
            let src = img.to_rgba16();
            out.par_chunks_mut(8).zip(src.as_raw().par_chunks(4)).for_each(|(o, s)| {
                for c in 0..3 {
                    o[c * 2..c * 2 + 2].copy_from_slice(&lut[s[c] as usize].to_le_bytes());
                }
                o[6..8].copy_from_slice(&ONE.to_le_bytes());
            });
        }
        _ => {
            let lut = lut8();
            let src = img.to_rgba8();
            out.par_chunks_mut(8).zip(src.as_raw().par_chunks(4)).for_each(|(o, s)| {
                for c in 0..3 {
                    o[c * 2..c * 2 + 2].copy_from_slice(&lut[s[c] as usize].to_le_bytes());
                }
                o[6..8].copy_from_slice(&ONE.to_le_bytes());
            });
        }
    }
    out
}

/// Header followed by pixels. The header is width, height, mode and flags as
/// little-endian u32 (flag 1: a white point follows), then the as-shot white
/// point x and y as little-endian f32.
pub fn payload(w: u32, h: u32, mode: InputMode, white: Option<[f32; 2]>, pixels: Vec<u8>) -> Vec<u8> {
    let mut out = Vec::with_capacity(HEADER_BYTES + pixels.len());
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&h.to_le_bytes());
    out.extend_from_slice(&(mode as u32).to_le_bytes());
    out.extend_from_slice(&(white.is_some() as u32).to_le_bytes());
    let [x, y] = white.unwrap_or([0.0, 0.0]);
    out.extend_from_slice(&x.to_le_bytes());
    out.extend_from_slice(&y.to_le_bytes());
    out.extend_from_slice(&pixels);
    out
}

/// Decode `path` for the engine, scaled to `max_edge` when given.
pub fn load_for_engine(path: &Path, max_edge: Option<u32>) -> Result<Vec<u8>, String> {
    if classify(path) == Kind::Raw {
        let half = max_edge.is_some_and(|m| m <= RAW_HALF_MAX_EDGE);
        let raw = raw::decode(path, half)?;
        let img = resize_to(raw.image, max_edge);
        let (w, h) = (img.width(), img.height());
        return Ok(payload(w, h, InputMode::SceneLinear, raw.white, linear_f16_rgba(&img)));
    }
    let img = resize_to(open_oriented(path)?, max_edge);
    let (w, h) = (img.width(), img.height());
    Ok(payload(w, h, InputMode::DisplayLinear, None, linear_f16_rgba(&img)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    fn px(bytes: &[u8], i: usize) -> [f32; 4] {
        let o = HEADER_BYTES + i * 8;
        let mut v = [0f32; 4];
        for c in 0..4 {
            v[c] = f16::from_bits(u16::from_le_bytes([bytes[o + c * 2], bytes[o + c * 2 + 1]])).to_f32();
        }
        v
    }

    #[test]
    fn fit_never_upscales() {
        assert_eq!(fit(6000, 4000, Some(2560)), (2560, 1707));
        assert_eq!(fit(4000, 6000, Some(2560)), (1707, 2560));
        assert_eq!(fit(800, 600, Some(2560)), (800, 600));
        assert_eq!(fit(800, 600, None), (800, 600));
    }

    #[test]
    fn srgb_curve_endpoints() {
        assert_eq!(srgb_to_linear(0.0), 0.0);
        assert!((srgb_to_linear(1.0) - 1.0).abs() < 1e-6);
        assert!((srgb_to_linear(0.5) - 0.2140).abs() < 1e-3);
    }

    #[test]
    fn decodes_8_and_16_bit_to_linear_half_floats() {
        let dir = tempfile::tempdir().unwrap();

        let p8 = dir.path().join("a.png");
        ImageBuffer::from_fn(4, 2, |x, _| if x == 0 { Rgb([255u8, 128, 0]) } else { Rgb([0u8, 0, 0]) })
            .save(&p8)
            .unwrap();
        let out = load_for_engine(&p8, None).unwrap();
        assert_eq!(u32::from_le_bytes(out[0..4].try_into().unwrap()), 4);
        assert_eq!(u32::from_le_bytes(out[4..8].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(out[8..12].try_into().unwrap()), 0);
        assert_eq!(u32::from_le_bytes(out[12..16].try_into().unwrap()), 0, "ordinary photos carry no white point");
        assert_eq!(out.len(), HEADER_BYTES + 4 * 2 * 8);
        let v = px(&out, 0);
        assert!((v[0] - 1.0).abs() < 1e-3 && (v[1] - 0.2158).abs() < 2e-3 && v[2] == 0.0 && v[3] == 1.0);

        let p16 = dir.path().join("b.tif");
        ImageBuffer::from_fn(2, 2, |_, _| Rgb([65535u16, 32768, 0])).save(&p16).unwrap();
        let out = load_for_engine(&p16, None).unwrap();
        let v = px(&out, 3);
        assert!((v[0] - 1.0).abs() < 1e-3 && (v[1] - 0.2140).abs() < 2e-3 && v[3] == 1.0);
    }

    #[test]
    fn resizes_to_max_edge() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("big.png");
        ImageBuffer::from_fn(300, 200, |_, _| Rgb([10u8, 20, 30])).save(&p).unwrap();
        let out = load_for_engine(&p, Some(150)).unwrap();
        assert_eq!(u32::from_le_bytes(out[0..4].try_into().unwrap()), 150);
        assert_eq!(u32::from_le_bytes(out[4..8].try_into().unwrap()), 100);
    }

    #[test]
    fn reports_unreadable_files() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("fake.jpg");
        std::fs::write(&p, b"not an image").unwrap();
        assert!(load_for_engine(&p, None).is_err());
    }
}
