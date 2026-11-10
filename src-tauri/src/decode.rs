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

pub const HEADER_BYTES: usize = 32;

/// Open a photo, apply its EXIF orientation and convert it to sRGB from its embedded ICC
/// profile.
pub fn open_oriented(path: &Path) -> Result<DynamicImage, String> {
    let (img, icc) = open_tagged(path)?;
    Ok(to_srgb(img, icc.as_deref()))
}

/// Open a photo and apply its EXIF orientation, returning its embedded ICC profile
/// unapplied so callers can shrink the image before converting it with [`to_srgb`].
pub fn open_tagged(path: &Path) -> Result<(DynamicImage, Option<Vec<u8>>), String> {
    let reader = ImageReader::open(path)
        .map_err(|e| format!("Could not open {}: {e}", path.display()))?
        .with_guessed_format()
        .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    let mut decoder = reader.into_decoder().map_err(|e| unsupported(path, &e.to_string()))?;
    let orientation = decoder.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let icc = decoder.icc_profile().ok().flatten();
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| unsupported(path, &e.to_string()))?;
    img.apply_orientation(orientation);
    Ok((img, icc))
}

fn unsupported(path: &Path, e: &str) -> String {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string());
    if e.contains("YCbCr") {
        return format!("{name} is a JPEG-compressed TIFF, which Emulsion can't read yet. Save it as an uncompressed, LZW or ZIP TIFF.");
    }
    format!("Unsupported or damaged image {name}: {e}")
}

/// Convert an 8- or 16-bit image from its embedded ICC profile to sRGB (relative
/// colorimetric, through moxcms), keeping its bit depth. Images without a profile, with an
/// sRGB one, or with one moxcms can't use are returned unchanged, so they read as sRGB as
/// before. Float images are left alone: they are taken as linear sRGB already.
pub fn to_srgb(img: DynamicImage, icc: Option<&[u8]>) -> DynamicImage {
    use moxcms::{ColorProfile, DataColorSpace, Layout, TransformOptions};
    let Some(icc) = icc else { return img };
    let Ok(src) = ColorProfile::new_from_slice(icc) else { return img };
    if matches!(img, DynamicImage::ImageRgb32F(_) | DynamicImage::ImageRgba32F(_)) || is_srgb(&src) {
        return img;
    }
    let srgb = ColorProfile::new_srgb();
    let opts = TransformOptions::default();
    let (w, h) = (img.width(), img.height());
    let wide = matches!(img, DynamicImage::ImageLuma16(_) | DynamicImage::ImageLumaA16(_) | DynamicImage::ImageRgb16(_) | DynamicImage::ImageRgba16(_));
    let layout = match src.color_space {
        DataColorSpace::Rgb => Layout::Rgb,
        DataColorSpace::Gray => Layout::Gray,
        // CMYK and other spaces were already converted naively by the decoder.
        _ => return img,
    };
    let converted = if wide {
        let px: Vec<u16> = if layout == Layout::Gray { img.to_luma16().into_raw() } else { img.to_rgb16().into_raw() };
        let Ok(t) = src.create_transform_16bit(layout, &srgb, Layout::Rgb, opts) else { return img };
        let mut out = vec![0u16; w as usize * h as usize * 3];
        if t.transform(&px, &mut out).is_err() {
            return img;
        }
        image::ImageBuffer::<image::Rgb<u16>, _>::from_raw(w, h, out).map(DynamicImage::ImageRgb16)
    } else {
        let px: Vec<u8> = if layout == Layout::Gray { img.to_luma8().into_raw() } else { img.to_rgb8().into_raw() };
        let Ok(t) = src.create_transform_8bit(layout, &srgb, Layout::Rgb, opts) else { return img };
        let mut out = vec![0u8; w as usize * h as usize * 3];
        if t.transform(&px, &mut out).is_err() {
            return img;
        }
        image::RgbImage::from_raw(w, h, out).map(DynamicImage::ImageRgb8)
    };
    converted.unwrap_or(img)
}

/// Whether a profile is sRGB in all but name: sRGB primaries and white, and the sRGB curve
/// on every channel, checked by converting a ramp through it.
fn is_srgb(p: &moxcms::ColorProfile) -> bool {
    use moxcms::{ColorProfile, Layout, TransformOptions};
    if p.color_space != moxcms::DataColorSpace::Rgb {
        return false;
    }
    let Ok(t) = p.create_transform_8bit(Layout::Rgb, &ColorProfile::new_srgb(), Layout::Rgb, TransformOptions::default()) else {
        return false;
    };
    // Primaries, secondaries, greys and some mid colours.
    let probe: Vec<u8> = [
        [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255],
        [255, 255, 255], [128, 128, 128], [32, 32, 32], [200, 120, 60], [40, 90, 170], [90, 180, 120],
    ]
    .concat();
    let mut out = vec![0u8; probe.len()];
    t.transform(&probe, &mut out).is_ok() && probe.iter().zip(&out).all(|(a, b)| a.abs_diff(*b) <= 1)
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
    } else if let DynamicImage::ImageRgb32F(buf) = &img {
        // The image crate clamps float pixels to 0..1 when it resizes, which clipped RAW
        // previews (sensor clipping sits at BASELINE_GAIN, out-of-gamut values are negative)
        // and HDR float TIFFs. Same triangle filter, without the clamp.
        DynamicImage::ImageRgb32F(resize_rgb32f(buf, nw, nh))
    } else {
        img.resize_exact(nw, nh, FilterType::Triangle)
    }
}

/// Triangle-filter weights for each output position along one axis, as the image crate's
/// `resize` computes them (filter support scaled by the reduction ratio).
fn triangle_weights(src: u32, dst: u32) -> Vec<(usize, Vec<f32>)> {
    let ratio = src as f32 / dst as f32;
    let sratio = ratio.max(1.0);
    let support = sratio;
    (0..dst)
        .map(|o| {
            let centre = (o as f32 + 0.5) * ratio;
            let left = ((centre - support).floor() as i64).clamp(0, src as i64 - 1) as usize;
            let right = ((centre + support).ceil() as i64).clamp(left as i64 + 1, src as i64) as usize;
            let mut w: Vec<f32> = (left..right).map(|i| (1.0 - ((i as f32 - (centre - 0.5)) / sratio).abs()).max(0.0)).collect();
            let sum: f32 = w.iter().sum();
            if sum > 0.0 {
                w.iter_mut().for_each(|v| *v /= sum);
            }
            (left, w)
        })
        .collect()
}

fn resize_rgb32f(src: &image::Rgb32FImage, nw: u32, nh: u32) -> image::Rgb32FImage {
    let (w, h) = (src.width() as usize, src.height() as usize);
    let s = src.as_raw();
    let xs = triangle_weights(w as u32, nw);
    let ys = triangle_weights(h as u32, nh);
    // Horizontal pass over every source row, then vertical.
    let mut mid = vec![0f32; nw as usize * h * 3];
    mid.par_chunks_mut(nw as usize * 3).enumerate().for_each(|(y, row)| {
        let line = &s[y * w * 3..(y + 1) * w * 3];
        for (x, (left, wt)) in xs.iter().enumerate() {
            let mut acc = [0f32; 3];
            for (k, wv) in wt.iter().enumerate() {
                let p = (left + k) * 3;
                for c in 0..3 {
                    acc[c] += line[p + c] * wv;
                }
            }
            row[x * 3..x * 3 + 3].copy_from_slice(&acc);
        }
    });
    let stride = nw as usize * 3;
    let mut out = vec![0f32; stride * nh as usize];
    out.par_chunks_mut(stride).enumerate().for_each(|(y, row)| {
        let (top, wt) = &ys[y];
        for (k, wv) in wt.iter().enumerate() {
            let line = &mid[(top + k) * stride..(top + k + 1) * stride];
            row.iter_mut().zip(line).for_each(|(o, v)| *o += v * wv);
        }
    });
    image::Rgb32FImage::from_raw(nw, nh, out).expect("resized buffer size")
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
    linear_f16_rgba_impl(img, false)
}

fn linear_f16_rgba_impl(img: &DynamicImage, preserve_negative: bool) -> Vec<u8> {
    let px = img.width() as usize * img.height() as usize;
    let mut out = vec![0u8; px * 8];
    match img {
        DynamicImage::ImageRgb32F(_) | DynamicImage::ImageRgba32F(_) => {
            // Float images are taken as already linear.
            let src = img.to_rgba32f();
            out.par_chunks_mut(8).zip(src.as_raw().par_chunks(4)).for_each(|(o, s)| {
                for c in 0..3 {
                    o[c * 2..c * 2 + 2].copy_from_slice(&f16::from_f32(if preserve_negative { s[c] } else { s[c].max(0.0) }).to_bits().to_le_bytes());
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
/// little-endian u32 (flag 1: a white point follows), the as-shot white point x
/// and y as little-endian f32, then the size of a full-resolution decode as u32.
/// Flag 2 appends a u32 JSON length and lens metadata (padded to a 4-byte boundary) before pixels.
pub fn payload(w: u32, h: u32, mode: InputMode, white: Option<[f32; 2]>, full: (u32, u32), pixels: Vec<u8>) -> Vec<u8> {
    let mut out = Vec::with_capacity(HEADER_BYTES + pixels.len());
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&h.to_le_bytes());
    out.extend_from_slice(&(mode as u32).to_le_bytes());
    out.extend_from_slice(&(white.is_some() as u32).to_le_bytes());
    let [x, y] = white.unwrap_or([0.0, 0.0]);
    out.extend_from_slice(&x.to_le_bytes());
    out.extend_from_slice(&y.to_le_bytes());
    out.extend_from_slice(&full.0.to_le_bytes());
    out.extend_from_slice(&full.1.to_le_bytes());
    out.extend_from_slice(&pixels);
    out
}

/// Decode `path` for the engine, scaled to `max_edge` when given.
pub fn load_for_engine(path: &Path, max_edge: Option<u32>) -> Result<Vec<u8>, String> {
    if classify(path) == Kind::Raw {
        let half = max_edge.is_some_and(|m| m <= RAW_HALF_MAX_EDGE);
        let mut raw = raw::decode(path, half)?;
        // A small sensor's half-size image can fall short of the edge asked for: decode in full.
        let (w, h) = (raw.image.width(), raw.image.height());
        if half && max_edge.is_some_and(|m| w.max(h) < m && w.max(h) < raw.full_size.0.max(raw.full_size.1)) {
            raw = raw::decode(path, false)?;
        }
        return raw_for_engine(path, raw, max_edge);
    }
    let (original, icc) = open_tagged(path)?;
    let full = (original.width(), original.height());
    // Convert after shrinking: a preview costs a fraction of a full-size conversion.
    let img = to_srgb(resize_to(original, max_edge), icc.as_deref());
    let (w, h) = (img.width(), img.height());
    Ok(payload(w, h, InputMode::DisplayLinear, None, full, linear_f16_rgba(&img)))
}

pub fn raw_for_engine(path: &Path, raw: raw::Decoded, max_edge: Option<u32>) -> Result<Vec<u8>, String> {
        let img = resize_to(raw.image, max_edge);
        let (w, h) = (img.width(), img.height());
        let mut bytes = payload(w, h, InputMode::SceneLinear, raw.white, raw.full_size, vec![]);
        if let Some(lens) = crate::lens::read(path).and_then(|mut m| { m.camera_to_working = Some(raw.camera_to_working); serde_json::to_vec(&m).ok() }) {
            let flags = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) | 2;
            bytes[12..16].copy_from_slice(&flags.to_le_bytes());
            bytes.extend_from_slice(&(lens.len() as u32).to_le_bytes());
            bytes.extend_from_slice(&lens);
            while bytes.len() % 4 != 0 { bytes.push(0); }
        }
        let camera = serde_json::to_vec(&raw.camera).map_err(|e| format!("Camera metadata: {e}"))?;
        let flags = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) | 4;
        bytes[12..16].copy_from_slice(&flags.to_le_bytes());
        bytes.extend_from_slice(&(camera.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&camera);
        while bytes.len() % 4 != 0 { bytes.push(0); }
        bytes.extend_from_slice(&linear_f16_rgba_impl(&img, true));
        Ok(bytes)
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

    /// Byte-for-byte check of a real full-resolution decode across native build changes.
    /// Supply a read-only RAW and the BLAKE3 payload hash captured with the reference build.
    #[test]
    #[ignore = "requires EMULSION_RAW_SAMPLE and EMULSION_RAW_PAYLOAD_HASH"]
    fn full_resolution_payload_matches_reference() {
        let path = std::env::var("EMULSION_RAW_SAMPLE").expect("set EMULSION_RAW_SAMPLE");
        let expected = std::env::var("EMULSION_RAW_PAYLOAD_HASH").expect("set EMULSION_RAW_PAYLOAD_HASH");
        let started = std::time::Instant::now();
        let bytes = load_for_engine(Path::new(&path), None).unwrap();
        let hash = blake3::hash(&bytes).to_hex().to_string();
        eprintln!("full-resolution payload: {hash}, {} bytes, {:?}", bytes.len(), started.elapsed());
        assert_eq!(hash, expected, "decoded pixels or metadata changed");
    }

    #[test]
    fn raw_payload_preserves_signed_working_values_for_camera_channel_reconstruction() {
        let image=DynamicImage::ImageRgb32F(ImageBuffer::<Rgb<f32>, _>::from_raw(1,1,vec![-0.25,0.2,0.7]).unwrap());
        let first=|bytes:Vec<u8>|f16::from_bits(u16::from_le_bytes([bytes[0],bytes[1]])).to_f32();
        assert_eq!(first(linear_f16_rgba_impl(&image,true)),-0.25);
        assert_eq!(first(linear_f16_rgba(&image)),0.0);
    }

    #[test]
    fn float_resize_keeps_scene_values_and_matches_the_image_crate() {
        let (w, h) = (37u32, 23u32);
        let vals: Vec<f32> = (0..w * h * 3).map(|i| ((i * 7919) % 997) as f32 / 997.0).collect();
        let img = ImageBuffer::<Rgb<f32>, _>::from_raw(w, h, vals.clone()).unwrap();
        let ours = resize_rgb32f(&img, 11, 7);
        let theirs = DynamicImage::ImageRgb32F(img).resize_exact(11, 7, FilterType::Triangle).to_rgb32f();
        for (a, b) in ours.as_raw().iter().zip(theirs.as_raw()) {
            assert!((a - b).abs() < 1e-4, "{a} vs {b}");
        }
        // Scaled out of 0..1, the same filter gives the same values scaled: nothing is clamped.
        let wide: Vec<f32> = vals.iter().map(|v| v * 4.0 - 1.0).collect();
        let big = resize_rgb32f(&ImageBuffer::from_raw(w, h, wide).unwrap(), 11, 7);
        for (a, b) in big.as_raw().iter().zip(ours.as_raw()) {
            assert!((a - (b * 4.0 - 1.0)).abs() < 1e-4);
        }
        let flat = resize_to(DynamicImage::ImageRgb32F(ImageBuffer::from_raw(4, 4, vec![1.8f32; 48]).unwrap()), Some(2));
        assert!(flat.to_rgb32f().as_raw().iter().all(|v| (v - 1.8).abs() < 1e-5));
    }

    #[test]
    fn converts_embedded_profiles_to_srgb() {
        use moxcms::ColorProfile;
        // Pure Display P3 red is outside sRGB: it converts to a clipped, still red value.
        let p3 = ColorProfile::new_display_p3().encode().unwrap();
        let red = DynamicImage::ImageRgb8(ImageBuffer::from_raw(1, 1, vec![255u8, 0, 0]).unwrap());
        let out = to_srgb(red.clone(), Some(&p3)).to_rgb8();
        assert_eq!(out.get_pixel(0, 0).0[0], 255);
        // A P3 mid grey stays grey (same white and curve as sRGB).
        let grey = DynamicImage::ImageRgb16(ImageBuffer::from_raw(1, 1, vec![30000u16; 3]).unwrap());
        let g = to_srgb(grey, Some(&p3)).to_rgb16().get_pixel(0, 0).0;
        assert!(g.iter().all(|v| v.abs_diff(30000) < 40), "{g:?}");
        // A less saturated P3 colour lands inside sRGB, more saturated than it was.
        let mid = DynamicImage::ImageRgb8(ImageBuffer::from_raw(1, 1, vec![200u8, 100, 80]).unwrap());
        let m = to_srgb(mid, Some(&p3)).to_rgb8().get_pixel(0, 0).0;
        assert!(m[0] > 200 && m[1] < 100, "{m:?}");
        // sRGB, missing or unreadable profiles leave the pixels alone.
        let srgb = ColorProfile::new_srgb().encode().unwrap();
        assert_eq!(to_srgb(red.clone(), Some(&srgb)).to_rgb8().into_raw(), vec![255, 0, 0]);
        assert_eq!(to_srgb(red.clone(), None).to_rgb8().into_raw(), vec![255, 0, 0]);
        assert_eq!(to_srgb(red, Some(b"junk")).to_rgb8().into_raw(), vec![255, 0, 0]);
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
        assert_eq!(u32::from_le_bytes(out[24..28].try_into().unwrap()), 4, "full width");
        assert_eq!(u32::from_le_bytes(out[28..32].try_into().unwrap()), 2, "full height");
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
        // The header still reports the full size, for zooming to 100%.
        assert_eq!(u32::from_le_bytes(out[24..28].try_into().unwrap()), 300);
        assert_eq!(u32::from_le_bytes(out[28..32].try_into().unwrap()), 200);
    }

    #[test]
    fn reports_unreadable_files() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("fake.jpg");
        std::fs::write(&p, b"not an image").unwrap();
        assert!(load_for_engine(&p, None).is_err());
    }
}
