// SPDX-License-Identifier: GPL-3.0-or-later
//! Camera RAW decoding through LibRaw (vendored in `vendor/libraw`).
//!
//! LibRaw reads, demosaics and white balances the file as shot, staying in the
//! camera's own colour space. The conversion to scene-linear Rec.2020 happens
//! here, from the camera's XYZ matrix, following dcraw's `cam_xyz_coeff`.

use image::{DynamicImage, ImageBuffer, Rgb};
use rayon::prelude::*;
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::Path;

type Mat3 = [[f32; 3]; 3];

#[repr(C)]
struct EmuRawInfo {
    width: c_int,
    height: c_int,
    cam_xyz: Mat3,
    cam_mul: [f32; 3],
    make: [c_char; 64],
    model: [c_char; 64],
}

impl EmuRawInfo {
    fn empty() -> Self {
        EmuRawInfo { width: 0, height: 0, cam_xyz: [[0.0; 3]; 3], cam_mul: [0.0; 3], make: [0; 64], model: [0; 64] }
    }
}

#[repr(C)]
struct EmuRawThumb {
    format: c_int,
    width: c_int,
    height: c_int,
    flip: c_int,
    data: *const u8,
    len: usize,
}

unsafe extern "C" {
    fn emu_raw_decode(
        path: *const c_char,
        half: c_int,
        info: *mut EmuRawInfo,
        out: *mut *mut c_void,
        pixels: *mut *const u16,
        err: *mut c_char,
        errlen: usize,
    ) -> c_int;
    fn emu_raw_info(path: *const c_char, info: *mut EmuRawInfo, err: *mut c_char, errlen: usize) -> c_int;
    fn emu_raw_thumb(path: *const c_char, thumb: *mut EmuRawThumb, out: *mut *mut c_void, err: *mut c_char, errlen: usize) -> c_int;
    fn emu_raw_free(img: *mut c_void);
}

/// Linear Rec.2020 to XYZ (D65).
const REC2020_TO_XYZ: Mat3 = [
    [0.636_958, 0.144_617, 0.168_881],
    [0.262_700, 0.677_998, 0.059_302],
    [0.000_000, 0.028_073, 1.060_985],
];

/// Gain from LibRaw's output, where sensor clipping is 1.0, to the engine's
/// scene scale, where middle grey is 0.18. Set so a raw file and the camera's
/// own JPEG of it land at about the same brightness through a neutral look:
/// the median ratio over 33 OM-3 and X-T30 II files was 1.5 to 1.8 with the
/// old tone curve and 1.9 with sigmoid (see `calibrate_baseline_gain`). At 1.8,
/// sensor clipping sits 3.3 stops over middle grey, which sigmoid renders at
/// about 87% of display white.
pub const BASELINE_GAIN: f32 = 1.8;

/// Cameras LibRaw reads but has no colour data for yet, mapped to a camera with
/// the same sensor. Matches are on LibRaw's normalised model name.
const SAME_SENSOR: &[(&str, &str, Mat3)] = &[
    // The OM-3 shares the OM-1's 20 MP stacked sensor. Values are LibRaw's OM-1
    // entry (src/tables/colordata.cpp), which matches Adobe's OM-1 ColorMatrix2.
    (
        "OM-3",
        "OM-1",
        [[0.9488, -0.3984, -0.0714], [-0.2887, 1.0945, 0.2229], [-0.0137, 0.0960, 0.5786]],
    ),
];

fn mul(a: &Mat3, b: &Mat3) -> Mat3 {
    let mut m = [[0f32; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            m[i][j] = (0..3).map(|k| a[i][k] * b[k][j]).sum();
        }
    }
    m
}

fn invert(m: &Mat3) -> Option<Mat3> {
    let [[a, b, c], [d, e, f], [g, h, i]] = *m;
    let det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if det.abs() < 1e-9 {
        return None;
    }
    let r = 1.0 / det;
    Some([
        [(e * i - f * h) * r, (c * h - b * i) * r, (b * f - c * e) * r],
        [(f * g - d * i) * r, (a * i - c * g) * r, (c * d - a * f) * r],
        [(d * h - e * g) * r, (b * g - a * h) * r, (a * e - b * d) * r],
    ])
}

/// White-balanced camera RGB to the RGB space described by `rgb_to_xyz`. Rows
/// of camera-from-RGB are normalised so a neutral (1, 1, 1) stays neutral,
/// as dcraw does; LibRaw has already applied the white balance.
fn camera_to(cam_xyz: &Mat3, rgb_to_xyz: &Mat3) -> Option<Mat3> {
    let mut cam_rgb = mul(cam_xyz, rgb_to_xyz);
    for row in cam_rgb.iter_mut() {
        let sum: f32 = row.iter().sum();
        if sum.abs() < 1e-9 {
            return None;
        }
        row.iter_mut().for_each(|v| *v /= sum);
    }
    invert(&cam_rgb)
}

fn is_zero(m: &Mat3) -> bool {
    m.iter().flatten().all(|v| *v == 0.0)
}

/// The camera's XYZ matrix, or a same-sensor camera's when LibRaw has none.
fn colour_matrix(model: &str, cam_xyz: &Mat3) -> (Option<Mat3>, Option<&'static str>) {
    if !is_zero(cam_xyz) {
        return (Some(*cam_xyz), None);
    }
    match SAME_SENSOR.iter().find(|(m, _, _)| *m == model) {
        Some((_, donor, matrix)) => (Some(*matrix), Some(*donor)),
        None => (None, None),
    }
}

fn error_text(buf: &[c_char]) -> String {
    unsafe { CStr::from_ptr(buf.as_ptr()) }.to_string_lossy().into_owned()
}

fn c_path(path: &Path) -> Result<CString, String> {
    CString::new(path.to_string_lossy().as_bytes()).map_err(|_| format!("Invalid path {}", path.display()))
}

/// A decoded RAW.
pub struct Decoded {
    /// Scene-linear Rec.2020, scaled by [`BASELINE_GAIN`], white balanced as shot.
    pub image: DynamicImage,
    /// The as-shot white point, CIE 1931 xy, when the file records one.
    pub white: Option<[f32; 2]>,
}

/// Chromaticity of the light the camera balanced for: a surface recorded as
/// neutral has raw values 1 / multiplier, and the camera's matrix takes them to
/// XYZ (darktable's WB_coeffs_to_illuminant_xy, without its D50 adaptation as
/// Emulsion works in D65).
pub fn white_point(cam_xyz: &Mat3, cam_mul: &[f32; 3]) -> Option<[f32; 2]> {
    if cam_mul.iter().any(|m| !(*m > 0.0)) {
        return None;
    }
    let xyz_from_cam = invert(cam_xyz)?;
    let neutral = [1.0 / cam_mul[0], 1.0 / cam_mul[1], 1.0 / cam_mul[2]];
    let xyz: Vec<f32> = (0..3).map(|i| (0..3).map(|j| xyz_from_cam[i][j] * neutral[j]).sum()).collect();
    let sum = xyz[0] + xyz[1] + xyz[2];
    (sum > 0.0 && xyz.iter().all(|v| v.is_finite())).then(|| [xyz[0] / sum, xyz[1] / sum])
}

fn white_for(info: &EmuRawInfo) -> Option<[f32; 2]> {
    let model = error_text(&info.model);
    let (matrix, _) = colour_matrix(&model, &info.cam_xyz);
    white_point(&matrix?, &info.cam_mul)
}

/// The as-shot white point of `path`, reading metadata only.
pub fn as_shot_white(path: &Path) -> Result<Option<[f32; 2]>, String> {
    let cpath = c_path(path)?;
    let mut info = EmuRawInfo::empty();
    let mut err = [0 as c_char; 256];
    let rc = unsafe { emu_raw_info(cpath.as_ptr(), &mut info, err.as_mut_ptr(), err.len()) };
    if rc != 0 {
        return Err(format!("Could not read {}: {}", file_name(path), error_text(&err)));
    }
    Ok(white_for(&info))
}

/// Decode `path`. With `half`, LibRaw skips the demosaic and returns half
/// size, which is several times faster and plenty for a preview.
pub fn decode(path: &Path, half: bool) -> Result<Decoded, String> {
    let cpath = c_path(path)?;
    let mut info = EmuRawInfo::empty();
    let mut img: *mut c_void = std::ptr::null_mut();
    let mut pixels: *const u16 = std::ptr::null();
    let mut err = [0 as c_char; 256];
    let rc = unsafe {
        emu_raw_decode(cpath.as_ptr(), half as c_int, &mut info, &mut img, &mut pixels, err.as_mut_ptr(), err.len())
    };
    if rc != 0 {
        if uses_jpeg_xl(path) {
            return Err(format!(
                "{} is a DNG compressed with JPEG XL (DNG 1.7, as written by DxO PureRAW 6), which Emulsion can't decode yet.",
                file_name(path)
            ));
        }
        return Err(format!("Could not decode RAW {}: {}", file_name(path), error_text(&err)));
    }
    let (w, h) = (info.width as u32, info.height as u32);
    let model = error_text(&info.model);
    let (matrix, borrowed_from) = colour_matrix(&model, &info.cam_xyz);
    match (matrix, borrowed_from) {
        (_, Some(donor)) => eprintln!("[raw] {model}: using the {donor}'s colour data (same sensor)"),
        (None, _) => eprintln!("[raw] {model}: no colour data, colours are approximate"),
        _ => {}
    }
    // Without colour data, treat camera RGB as Rec.2020: roughly right, never broken.
    let m = matrix.and_then(|cx| camera_to(&cx, &REC2020_TO_XYZ)).unwrap_or([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]);

    let n = w as usize * h as usize * 3;
    let src = unsafe { std::slice::from_raw_parts(pixels, n) };
    let scale = BASELINE_GAIN / 65535.0;
    let mut out = vec![0f32; n];
    out.par_chunks_mut(3).zip(src.par_chunks(3)).for_each(|(o, s)| {
        let c = [s[0] as f32 * scale, s[1] as f32 * scale, s[2] as f32 * scale];
        for (i, v) in o.iter_mut().enumerate() {
            *v = (m[i][0] * c[0] + m[i][1] * c[1] + m[i][2] * c[2]).max(0.0);
        }
    });
    unsafe { emu_raw_free(img) };

    let buf = ImageBuffer::<Rgb<f32>, _>::from_raw(w, h, out).ok_or("RAW image has the wrong size")?;
    Ok(Decoded { image: DynamicImage::ImageRgb32F(buf), white: white_for(&info) })
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string())
}

/// TIFF compression code for JPEG XL, added in DNG 1.7.
const COMPRESSION_JPEG_XL: u32 = 52546;

/// Whether any image in this TIFF-based file (a DNG) is JPEG XL compressed.
/// Only used to explain a failed decode, so it reads the whole file.
fn uses_jpeg_xl(path: &Path) -> bool {
    std::fs::read(path).map(|d| tiff_compressions(&d).contains(&COMPRESSION_JPEG_XL)).unwrap_or(false)
}

/// Compression codes of every image in a TIFF, following SubIFDs.
fn tiff_compressions(d: &[u8]) -> Vec<u32> {
    let le = match d.get(..2) {
        Some(b"II") => true,
        Some(b"MM") => false,
        _ => return Vec::new(),
    };
    let u16_at = |o: usize| d.get(o..o + 2).map(|b| if le { u16::from_le_bytes([b[0], b[1]]) } else { u16::from_be_bytes([b[0], b[1]]) });
    let u32_at = |o: usize| {
        d.get(o..o + 4).map(|b| {
            let b = [b[0], b[1], b[2], b[3]];
            if le { u32::from_le_bytes(b) } else { u32::from_be_bytes(b) }
        })
    };
    let mut found = Vec::new();
    let mut queue: Vec<usize> = u32_at(4).map(|o| vec![o as usize]).unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    while let Some(ifd) = queue.pop() {
        if ifd == 0 || !seen.insert(ifd) || seen.len() > 64 {
            continue;
        }
        let Some(n) = u16_at(ifd) else { continue };
        for i in 0..n as usize {
            let e = ifd + 2 + i * 12;
            let (Some(tag), Some(kind), Some(count)) = (u16_at(e), u16_at(e + 2), u32_at(e + 4)) else { break };
            match (tag, kind) {
                // Compression, SHORT or LONG, stored inline.
                (259, 3) => found.extend(u16_at(e + 8).map(u32::from)),
                (259, 4) => found.extend(u32_at(e + 8)),
                // SubIFDs: one offset inline, or a list elsewhere.
                (330, 4 | 13) => {
                    let at = if count == 1 { e + 8 } else { u32_at(e + 8).unwrap_or(0) as usize };
                    queue.extend((0..count.min(16) as usize).filter_map(|k| u32_at(at + k * 4)).map(|o| o as usize));
                }
                _ => {}
            }
        }
        queue.extend(u32_at(ifd + 2 + n as usize * 12).map(|o| o as usize));
    }
    found
}

/// The camera's own preview embedded in the file, oriented.
pub fn embedded_preview(path: &Path) -> Result<DynamicImage, String> {
    let cpath = c_path(path)?;
    let mut t = EmuRawThumb { format: 0, width: 0, height: 0, flip: 0, data: std::ptr::null(), len: 0 };
    let mut img: *mut c_void = std::ptr::null_mut();
    let mut err = [0 as c_char; 256];
    let rc = unsafe { emu_raw_thumb(cpath.as_ptr(), &mut t, &mut img, err.as_mut_ptr(), err.len()) };
    if rc != 0 {
        return Err(format!("No preview in {}: {}", path.display(), error_text(&err)));
    }
    let bytes = unsafe { std::slice::from_raw_parts(t.data, t.len) };
    let decoded = match t.format {
        1 => image::load_from_memory_with_format(bytes, image::ImageFormat::Jpeg).map_err(|e| e.to_string()),
        2 => ImageBuffer::<Rgb<u8>, _>::from_raw(t.width as u32, t.height as u32, bytes.to_vec())
            .map(DynamicImage::ImageRgb8)
            .ok_or_else(|| "preview has the wrong size".to_string()),
        _ => Err("unsupported preview format".to_string()),
    };
    unsafe { emu_raw_free(img) };
    let preview = decoded.map_err(|e| format!("Could not read the preview in {}: {e}", path.display()))?;
    Ok(match t.flip {
        3 => preview.rotate180(),
        5 => preview.rotate270(),
        6 => preview.rotate90(),
        _ => preview,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRGB_TO_XYZ: Mat3 = [[0.412_453, 0.357_580, 0.180_423], [0.212_671, 0.715_160, 0.072_169], [0.019_334, 0.119_193, 0.950_227]];

    /// Fujifilm X-T30 II, from LibRaw's colour table.
    const XT30II: Mat3 = [[1.3426, -0.6334, -0.1177], [-0.4244, 1.2136, 0.2371], [-0.0580, 0.1303, 0.5980]];

    fn close(a: &Mat3, b: &Mat3, tol: f32) -> bool {
        a.iter().flatten().zip(b.iter().flatten()).all(|(x, y)| (x - y).abs() < tol)
    }

    #[test]
    fn matches_libraw_for_srgb_output() {
        // LibRaw's own camera-to-sRGB matrix for the X-T30 II (raw-identify -v).
        let libraw = [[1.2384, 0.0315, -0.2699], [-0.1470, 1.5570, -0.4100], [0.0037, -0.3954, 1.3916]];
        assert!(close(&camera_to(&XT30II, &SRGB_TO_XYZ).unwrap(), &libraw, 2e-3));
    }

    #[test]
    fn neutral_stays_neutral() {
        let m = camera_to(&XT30II, &REC2020_TO_XYZ).unwrap();
        for row in m {
            assert!((row.iter().sum::<f32>() - 1.0).abs() < 1e-4);
        }
    }

    #[test]
    fn om3_borrows_the_om1_matrix() {
        let (m, from) = colour_matrix("OM-3", &[[0.0; 3]; 3]);
        assert_eq!(from, Some("OM-1"));
        assert_eq!(m.unwrap()[0][0], 0.9488);
        let (m, from) = colour_matrix("X-T30 II", &XT30II);
        assert_eq!((m, from), (Some(XT30II), None));
        assert_eq!(colour_matrix("Unknown", &[[0.0; 3]; 3]), (None, None));
    }

    /// Median luminance of the camera's preview in scene light (through the
    /// inverse of the neutral tone curve) over the RAW's, per file. The median
    /// of these ratios is the right `BASELINE_GAIN`. Run with
    /// `EMULSION_RAW_SAMPLES="a.ORF:b.RAF" cargo test calibrate -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn calibrate_baseline_gain() {
        // Mirrors toneInverse in src/engine/tone.ts: the neutral sigmoid
        // (paper exposure, film power, paper power; no fog), run backwards.
        let (paper_exp, film_power, paper_power) = (0.735_28_f32, 1.291_181_f32, 0.837_748_f32);
        let tone_inverse = |e: f32| {
            let lin = crate::decode::srgb_to_linear(e.clamp(0.0, 1.0));
            let r = lin.min(1.0 - 1e-7).powf(1.0 / paper_power);
            (paper_exp * r / (1.0 - r)).powf(1.0 / film_power)
        };
        let median = |mut v: Vec<f32>| {
            v.sort_by(f32::total_cmp);
            v[v.len() / 2]
        };
        let samples = std::env::var("EMULSION_RAW_SAMPLES").expect("set EMULSION_RAW_SAMPLES");
        let mut ratios = Vec::new();
        for path in samples.split(':') {
            let raw = decode(Path::new(path), true).unwrap();
            let y = &REC2020_TO_XYZ[1];
            let raw_y = median(raw.image.to_rgb32f().pixels().map(|p| (y[0] * p[0] + y[1] * p[1] + y[2] * p[2]) / BASELINE_GAIN).collect());
            let jpeg_y = median(
                embedded_preview(Path::new(path))
                    .unwrap()
                    .to_rgb8()
                    .pixels()
                    .map(|p| {
                        let l: Vec<f32> = p.0.iter().map(|v| crate::decode::srgb_to_linear(*v as f32 / 255.0)).collect();
                        let lum = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
                        let e = if lum <= 0.003_130_8 { lum * 12.92 } else { 1.055 * lum.powf(1.0 / 2.4) - 0.055 };
                        tone_inverse(e)
                    })
                    .collect(),
            );
            println!("{path:<60} raw {raw_y:.4}  jpeg {jpeg_y:.4}  ratio {:.3}", jpeg_y / raw_y);
            ratios.push(jpeg_y / raw_y);
        }
        println!("median ratio {:.3}", median(ratios));
    }

    /// A little-endian TIFF: IFD0 (uncompressed) pointing at one SubIFD with `sub_compression`.
    fn tiff_with_subifd(sub_compression: u16) -> Vec<u8> {
        let mut d = b"II*\0".to_vec();
        d.extend(8u32.to_le_bytes());
        // IFD0 at 8: two entries, then next-IFD 0. SubIFD follows at 8 + 2 + 24 + 4 = 38.
        d.extend(2u16.to_le_bytes());
        d.extend([3, 1, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0]); // Compression = 1
        d.extend([74, 1, 4, 0, 1, 0, 0, 0, 38, 0, 0, 0]); // SubIFDs = [38]
        d.extend(0u32.to_le_bytes());
        d.extend(1u16.to_le_bytes());
        d.extend([3, 1, 3, 0, 1, 0, 0, 0]);
        d.extend(sub_compression.to_le_bytes());
        d.extend([0, 0]);
        d.extend(0u32.to_le_bytes());
        d
    }

    #[test]
    fn finds_jpeg_xl_in_subifds() {
        assert_eq!(tiff_compressions(&tiff_with_subifd(52546)), vec![1, 52546]);
        assert_eq!(tiff_compressions(&tiff_with_subifd(7)), vec![1, 7]);
        assert!(tiff_compressions(b"not a tiff").is_empty());

        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("pureraw.dng");
        std::fs::write(&p, tiff_with_subifd(52546)).unwrap();
        let err = decode(&p, true).err().expect("a JPEG XL DNG must not decode");
        assert!(err.contains("JPEG XL"), "{err}");
    }

    #[test]
    fn finds_the_as_shot_white_point() {
        // With the camera matrix of an sRGB-like camera, multipliers that make
        // raw (1, 1, 1) neutral put the white at that space's white, D65.
        let xyz_from_srgb: Mat3 = [[0.412_456, 0.357_576, 0.180_438], [0.212_673, 0.715_152, 0.072_175], [0.019_334, 0.119_192, 0.950_304]];
        let cam_xyz = invert(&xyz_from_srgb).unwrap();
        let w = white_point(&cam_xyz, &[1.0, 1.0, 1.0]).unwrap();
        assert!((w[0] - 0.3127).abs() < 1e-3 && (w[1] - 0.3290).abs() < 1e-3, "{w:?}");
        // A camera that needed more red gain was under bluer light.
        let blue = white_point(&cam_xyz, &[2.0, 1.0, 1.0]).unwrap();
        assert!(blue[0] < w[0]);
        assert_eq!(white_point(&cam_xyz, &[0.0, 1.0, 1.0]), None);
    }

    #[test]
    fn reports_files_that_are_not_raw() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("fake.orf");
        std::fs::write(&p, b"not a raw file").unwrap();
        assert!(decode(&p, true).is_err());
        assert!(embedded_preview(&p).is_err());
    }
}
