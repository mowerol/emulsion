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
    full_width: c_int,
    full_height: c_int,
    make: [c_char; 64],
    model: [c_char; 64],
    iso: f32,
    shutter: f32,
    aperture: f32,
    focal_length: f32,
    focal_length35: f32,
    dng: c_int,
}

impl EmuRawInfo {
    fn empty() -> Self {
        EmuRawInfo { width: 0, height: 0, cam_xyz: [[0.0; 3]; 3], cam_mul: [0.0; 3], full_width: 0, full_height: 0, make: [0; 64], model: [0; 64], iso: 0.0, shutter: 0.0, aperture: 0.0, focal_length: 0.0, focal_length35: 0.0, dng: 0 }
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

unsafe extern "C" {
    fn emu_omp_root();
}

/// Park one thread for the life of the app as an OpenMP root, before any LibRaw call. With
/// the parallel build, libomp shut its runtime down whenever the last thread that had used
/// it exited (tokio's blocking threads do when idle), and the next LibRaw call crashed on
/// a dangling lock (`__kmp_acquire_ticket_lock`; see `emu_omp_root` in raw_shim.cpp).
pub(crate) fn openmp_root() {
    static ROOT: std::sync::Once = std::sync::Once::new();
    ROOT.call_once(|| {
        let (ready, wait) = std::sync::mpsc::channel();
        std::thread::Builder::new()
            .name("openmp-root".into())
            .spawn(move || {
                unsafe { emu_omp_root() };
                let _ = ready.send(());
                loop {
                    std::thread::park();
                }
            })
            .expect("spawn the OpenMP root thread");
        let _ = wait.recv();
    });
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

/// darktable's (rawspeed's `cameras.xml`) entry for a camera, by LibRaw's normalised make and model.
/// LibRaw normalises OM Digital Solutions (OM System) cameras to "Olympus", while `cameras.xml`
/// files them under their own make, so an Olympus make also matches those.
fn darktable_camera(make: &str, model: &str) -> Option<&'static crate::rawspeed_cameras::Camera> {
    let key = |s: &str| s.to_lowercase().replace(|c: char| !c.is_ascii_alphanumeric(), "");
    let (make, model) = (key(make), key(model));
    let makes: &[&str] = if make == "olympus" { &["olympus", "omdigitalsolutions", "omsystem"] } else { &[] };
    let same_make = |m: &str| { let m = key(m); m == make || makes.contains(&m.as_str()) };
    crate::rawspeed_cameras::CAMERAS.iter().find(|c| key(c.model) == model && c.makes.iter().any(|m| same_make(m)))
}

/// darktable's crop (x, y, width, height) for a Sony ARW whose full readout LibRaw kept, as
/// rawspeed makes it: lossless-compressed ARWs (compression 7) are cut to SonyRawImageSize and
/// take no further crop (`ArwDecoder::decodeRawInternal`, `applyCrop = false`); others take the
/// camera's `cameras.xml` crop, a width or height ≤ 0 counting back from the edge
/// (`RawDecoder::setMetaData`).
fn darktable_crop(make: &str, model: &str, compression: u32, size: Option<(u32, u32)>, raw: (u32, u32)) -> Option<[u32; 4]> {
    if !make.eq_ignore_ascii_case("sony") {
        return None;
    }
    let crop = if compression == 7 {
        let (w, h) = size?;
        [0, 0, w as i64, h as i64]
    } else {
        let [x, y, w, h] = darktable_camera(make, model)?.crop?.map(i64::from);
        let w = if w <= 0 { raw.0 as i64 - x + w } else { w };
        let h = if h <= 0 { raw.1 as i64 - y + h } else { h };
        [x, y, w, h]
    };
    let [x, y, w, h] = crop;
    let fits = x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= raw.0 as i64 && y + h <= raw.1 as i64;
    // Even offsets keep LibRaw's CFA pattern.
    (fits && x % 2 == 0 && y % 2 == 0 && (w, h) != (raw.0 as i64, raw.1 as i64)).then(|| crop.map(|v| v as u32))
}

/// Called by the shim (`emu_open`) when LibRaw has kept a camera's whole sensor readout, having
/// no size for it: fills `out` with darktable's crop and returns 1, or returns 0.
#[unsafe(no_mangle)]
pub extern "C" fn emu_camera_crop(path: *const c_char, make: *const c_char, model: *const c_char, raw_w: c_int, raw_h: c_int, out: *mut c_int) -> c_int {
    if path.is_null() || make.is_null() || model.is_null() || out.is_null() || raw_w <= 0 || raw_h <= 0 {
        return 0;
    }
    let text = |p: *const c_char| unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned();
    // `c_path` made it from a UTF-8 path.
    let path = std::path::PathBuf::from(text(path));
    let Some((compression, size)) = crate::lens::sony_raw_ifd(&path) else { return 0 };
    match darktable_crop(&text(make), &text(model), compression, size, (raw_w as u32, raw_h as u32)) {
        Some(crop) => {
            for (i, v) in crop.into_iter().enumerate() {
                unsafe { *out.add(i) = v as c_int };
            }
            1
        }
        None => 0,
    }
}

/// The camera's XYZ matrix, chosen as darktable does: a DNG's own, else darktable's for the
/// camera (rawspeed's `cameras.xml`), else LibRaw's table. LibRaw's table matches models by
/// prefix, so a camera it doesn't know can take an older one's matrix (ILCE-7RM6 got the
/// 2013 ILCE-7R's); `cameras.xml` matches the model exactly.
fn colour_matrix(make: &str, model: &str, cam_xyz: &Mat3, dng: bool) -> (Option<Mat3>, ColourSource) {
    if dng && !is_zero(cam_xyz) {
        return (Some(*cam_xyz), ColourSource::Camera);
    }
    if let Some(m) = darktable_camera(make, model).and_then(|c| c.matrix) {
        return (Some(m.map(|row| row.map(|v| v as f32 / 10000.0))), ColourSource::Darktable);
    }
    if !is_zero(cam_xyz) {
        return (Some(*cam_xyz), ColourSource::Camera);
    }
    (None, ColourSource::None)
}

fn colour_of(info: &EmuRawInfo) -> (Option<Mat3>, ColourSource) {
    colour_matrix(&error_text(&info.make), &error_text(&info.model), &info.cam_xyz, info.dng != 0)
}

fn error_text(buf: &[c_char]) -> String {
    unsafe { CStr::from_ptr(buf.as_ptr()) }.to_string_lossy().into_owned()
}

fn c_path(path: &Path) -> Result<CString, String> {
    CString::new(path.to_string_lossy().as_bytes()).map_err(|_| format!("Invalid path {}", path.display()))
}

/// Capture settings without unpacking or decoding the sensor data.
pub fn exposure(path: &Path) -> Option<crate::exposure::Exposure> {
    let path = c_path(path).ok()?;
    let mut info = EmuRawInfo::empty();
    let mut err = [0 as c_char; 256];
    openmp_root();
    let rc = unsafe { emu_raw_info(path.as_ptr(), &mut info, err.as_mut_ptr(), err.len()) };
    if rc != 0 { return None; }
    let mut result = crate::exposure::Exposure::new(info.iso as f64, info.shutter as f64, info.aperture as f64, info.focal_length as f64);
    result.focal_length35 = (info.focal_length35.is_finite() && info.focal_length35 > 0.0).then_some(info.focal_length35 as f64);
    Some(result)
}

/// Read the catalog camera name for RAW containers without readable EXIF (e.g. CR3).
pub fn catalog_camera(path: &Path) -> Option<String> {
    let path = c_path(path).ok()?;
    let mut info = EmuRawInfo::empty();
    let mut err = [0 as c_char; 256];
    openmp_root();
    let rc = unsafe { emu_raw_info(path.as_ptr(), &mut info, err.as_mut_ptr(), err.len()) };
    if rc != 0 { return None; }
    let name = format!("{} {}", error_text(&info.make), error_text(&info.model)).trim().to_owned();
    (!name.is_empty()).then_some(name)
}

/// darktable's noise profile for the file's camera and ISO, read without decoding.
pub fn noise_profile(path: &Path) -> Option<crate::noiseprofiles::NoiseProfile> {
    let path = c_path(path).ok()?;
    let mut info = EmuRawInfo::empty();
    let mut err = [0 as c_char; 256];
    openmp_root();
    let rc = unsafe { emu_raw_info(path.as_ptr(), &mut info, err.as_mut_ptr(), err.len()) };
    (rc == 0).then(|| crate::noiseprofiles::for_camera(&error_text(&info.make), &error_text(&info.model), info.iso))
}

/// Where a RAW's standard colour matrix comes from; `None` shows the Develop panel's colour warning.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ColourSource {
    /// The DNG's own matrix, or LibRaw's for a camera darktable has none for.
    Camera,
    /// darktable's matrix for the camera (rawspeed's `cameras.xml`).
    Darktable,
    /// No matrix: camera RGB is treated as Rec.2020.
    None,
}

/// [`ColourSource`] for `path`, reading metadata only (for cached decodes made before it was sent).
pub fn colour_source_of(path: &Path) -> Option<ColourSource> {
    let path = c_path(path).ok()?;
    let mut info = EmuRawInfo::empty();
    let mut err = [0 as c_char; 256];
    openmp_root();
    let rc = unsafe { emu_raw_info(path.as_ptr(), &mut info, err.as_mut_ptr(), err.len()) };
    (rc == 0).then(|| colour_of(&info).1)
}

/// Profile metadata is independent of lens-profile availability.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraMetadata {
    pub make: String,
    pub model: String,
    pub camera_to_working: Mat3,
    pub neutral: Option<[f32; 3]>,
    pub baseline_gain: f32,
    /// darktable's noise profile for this camera at the shot's ISO (denoise, profiled).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub noise: Option<crate::noiseprofiles::NoiseProfile>,
    /// Where `camera_to_working` comes from; absent from older cached payloads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub colour: Option<ColourSource>,
}

/// A decoded RAW.
pub struct Decoded {
    /// Scene-linear Rec.2020, scaled by [`BASELINE_GAIN`], white balanced as shot.
    pub image: DynamicImage,
    /// The as-shot white point, CIE 1931 xy, when the file records one.
    pub white: Option<[f32; 2]>,
    /// Size of a full-resolution decode, oriented.
    pub full_size: (u32, u32),
    pub camera_to_working: Mat3,
    pub camera: CameraMetadata,
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
    let (matrix, _) = colour_of(&info);
    white_point(&matrix?, &info.cam_mul)
}

/// The as-shot white point of `path`, reading metadata only.
pub fn as_shot_white(path: &Path) -> Result<Option<[f32; 2]>, String> {
    let cpath = c_path(path)?;
    let mut info = EmuRawInfo::empty();
    let mut err = [0 as c_char; 256];
    openmp_root();
    let rc = unsafe { emu_raw_info(cpath.as_ptr(), &mut info, err.as_mut_ptr(), err.len()) };
    if rc != 0 {
        return Err(format!("Could not read {}: {}", file_name(path), error_text(&err)));
    }
    Ok(white_for(&info))
}

/// The matrix from the engine's scene-linear Rec.2020 back to the 16-bit
/// white-balanced camera RGB LibRaw decodes to (0 to 65535 at sensor
/// clipping), undoing `decode`'s conversion and `BASELINE_GAIN`.
pub fn working_to_camera(path: &Path) -> Result<Mat3, String> {
    let cpath = c_path(path)?;
    let mut info = EmuRawInfo::empty();
    let mut err = [0 as c_char; 256];
    openmp_root();
    let rc = unsafe { emu_raw_info(cpath.as_ptr(), &mut info, err.as_mut_ptr(), err.len()) };
    if rc != 0 {
        return Err(format!("Could not read {}: {}", file_name(path), error_text(&err)));
    }
    let (matrix, _) = colour_of(&info);
    let m = matrix.and_then(|cx| camera_to(&cx, &REC2020_TO_XYZ)).unwrap_or([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]);
    let inv = invert(&m).ok_or("singular camera matrix")?;
    let k = 65535.0 / BASELINE_GAIN;
    Ok(inv.map(|row| row.map(|v| v * k)))
}

/// Decode `path`. With `half`, LibRaw skips the demosaic and returns half
/// size, which is several times faster and plenty for a preview.
pub fn decode(path: &Path, half: bool) -> Result<Decoded, String> {
    let cpath = c_path(path)?;
    let mut info = EmuRawInfo::empty();
    let mut img: *mut c_void = std::ptr::null_mut();
    let mut pixels: *const u16 = std::ptr::null();
    let mut err = [0 as c_char; 256];
    openmp_root();
    let rc = unsafe {
        emu_raw_decode(cpath.as_ptr(), half as c_int, &mut info, &mut img, &mut pixels, err.as_mut_ptr(), err.len())
    };
    if rc != 0 {
        if uses_jpeg_xl(path) {
            return Err(format!(
                "{} is a JPEG XL DNG (DNG 1.7) that Emulsion couldn't decode: {}",
                file_name(path),
                error_text(&err)
            ));
        }
        return Err(format!("Could not decode RAW {}: {}", file_name(path), error_text(&err)));
    }
    let (w, h) = (info.width as u32, info.height as u32);
    let model = error_text(&info.model);
    let make = error_text(&info.make);
    let (matrix, source) = colour_of(&info);
    match source {
        ColourSource::Darktable => eprintln!("[raw] {model}: using darktable's colour matrix"),
        ColourSource::None => eprintln!("[raw] {model}: no colour data, colours are approximate"),
        ColourSource::Camera => {}
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
            // Keep out-of-gamut values until lens CA has resampled the camera channels.
            // The GPU input stage clips them after correction (as before for other RAWs).
            *v = m[i][0] * c[0] + m[i][1] * c[1] + m[i][2] * c[2];
        }
    });
    unsafe { emu_raw_free(img) };

    let buf = ImageBuffer::<Rgb<f32>, _>::from_raw(w, h, out).ok_or("RAW image has the wrong size")?;
    let full_size = if info.full_width > 0 && info.full_height > 0 { (info.full_width as u32, info.full_height as u32) } else { (w, h) };
    let neutral = if info.cam_mul.iter().all(|v| v.is_finite() && *v > 0.0) {
        let mut n = info.cam_mul.map(|v| 1.0 / v);
        let maximum = n.iter().copied().fold(0.0f32, f32::max);
        n.iter_mut().for_each(|v| *v /= maximum);
        Some(n)
    } else { None };
    let noise = Some(crate::noiseprofiles::for_camera(&make, &model, info.iso));
    let colour = Some(source);
    let camera = CameraMetadata { make, model, camera_to_working: m, neutral, baseline_gain: BASELINE_GAIN, noise, colour };
    Ok(Decoded { image: DynamicImage::ImageRgb32F(buf), white: white_for(&info), full_size, camera_to_working: m, camera })
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string())
}

/// TIFF compression code for JPEG XL, added in DNG 1.7.
const COMPRESSION_JPEG_XL: u32 = 52546;

/// Whether any image in this TIFF-based file (a DNG) is JPEG XL compressed. LibRaw decodes
/// these through `jxl.rs`; this only explains a failed decode, so it reads the whole file.
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
/// The RAW's embedded JPEG preview as stored (with the camera's EXIF, for most cameras).
pub fn embedded_jpeg(path: &Path) -> Option<Vec<u8>> {
    let cpath = c_path(path).ok()?;
    let mut t = EmuRawThumb { format: 0, width: 0, height: 0, flip: 0, data: std::ptr::null(), len: 0 };
    let mut img: *mut c_void = std::ptr::null_mut();
    let mut err = [0 as c_char; 256];
    openmp_root();
    let rc = unsafe { emu_raw_thumb(cpath.as_ptr(), &mut t, &mut img, err.as_mut_ptr(), err.len()) };
    if rc != 0 {
        return None;
    }
    let bytes = (t.format == 1).then(|| unsafe { std::slice::from_raw_parts(t.data, t.len) }.to_vec());
    unsafe { emu_raw_free(img) };
    bytes
}

/// Make, model and exposure settings read by LibRaw, for RAWs whose EXIF nothing else reads.
pub fn camera_info(path: &Path) -> Option<(String, String, crate::exposure::Exposure)> {
    let cpath = c_path(path).ok()?;
    let mut info = EmuRawInfo::empty();
    let mut err = [0 as c_char; 256];
    openmp_root();
    let rc = unsafe { emu_raw_info(cpath.as_ptr(), &mut info, err.as_mut_ptr(), err.len()) };
    if rc != 0 {
        return None;
    }
    let mut e = crate::exposure::Exposure::new(info.iso as f64, info.shutter as f64, info.aperture as f64, info.focal_length as f64);
    e.focal_length35 = (info.focal_length35.is_finite() && info.focal_length35 > 0.0).then_some(info.focal_length35 as f64);
    Some((error_text(&info.make), error_text(&info.model), e))
}

pub fn embedded_preview(path: &Path) -> Result<DynamicImage, String> {
    let cpath = c_path(path)?;
    let mut t = EmuRawThumb { format: 0, width: 0, height: 0, flip: 0, data: std::ptr::null(), len: 0 };
    let mut img: *mut c_void = std::ptr::null_mut();
    let mut err = [0 as c_char; 256];
    openmp_root();
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

    #[test]
    fn darktable_crops_sony_readouts_as_rawspeed_does() {
        // ILCE-7RM6 lossless ARW: 10240 × 7168 readout, SonyRawImageSize 10008 × 6672.
        assert_eq!(darktable_crop("Sony", "ILCE-7RM6", 7, Some((10008, 6672)), (10240, 7168)), Some([0, 0, 10008, 6672]));
        // Other ARWs take cameras.xml's crop: width -8.
        assert_eq!(darktable_crop("Sony", "ILCE-7RM6", 32767, None, (10240, 7168)), Some([0, 0, 10232, 7168]));
        assert_eq!(darktable_crop("Sony", "ILCE-7RM6", 7, None, (10240, 7168)), None);
        assert_eq!(darktable_crop("Sony", "ILCE-7RM6", 7, Some((10240, 7168)), (10240, 7168)), None);
        assert_eq!(darktable_crop("Fujifilm", "X-T30 II", 7, Some((100, 100)), (200, 200)), None);
    }

    #[test]
    fn colour_source_names_where_the_matrix_comes_from() {
        let zero = [[0.0; 3]; 3];
        // A DNG keeps its own matrix.
        assert_eq!(colour_matrix("Fujifilm", "X-T30 II", &SRGB_TO_XYZ, true), (Some(SRGB_TO_XYZ), ColourSource::Camera));
        // darktable's exact entry wins over LibRaw's (prefix-matched) table: for the ILCE-7RM6,
        // LibRaw supplies the 2013 ILCE-7R's matrix.
        let (m, from) = colour_matrix("Sony", "ILCE-7RM6", &SRGB_TO_XYZ, false);
        assert_eq!((m.unwrap()[0], from), ([1.1765, -0.5595, -0.1192], ColourSource::Darktable));
        let (m, from) = colour_matrix("OM Digital Solutions", "OM-3", &zero, false);
        assert_eq!((m.unwrap()[0][0], from), (0.909, ColourSource::Darktable));
        // LibRaw reports OM System cameras as "Olympus" (an OM-3 ORF does).
        let (m, from) = colour_matrix("Olympus", "OM-3", &zero, false);
        assert_eq!((m.unwrap()[0][0], from), (0.909, ColourSource::Darktable));
        // LibRaw's table where darktable has nothing; nothing at all is uncalibrated.
        assert_eq!(colour_matrix("Nobody", "Camera 1", &SRGB_TO_XYZ, false), (Some(SRGB_TO_XYZ), ColourSource::Camera));
        assert_eq!(colour_matrix("Nobody", "Camera 1", &zero, false), (None, ColourSource::None));
        assert_eq!(serde_json::to_string(&ColourSource::Darktable).unwrap(), r#"{"kind":"darktable"}"#);
    }

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

    /// A Sony ARW LibRaw has no size for decodes at darktable's crop, without the black padding.
    /// `EMULSION_SONY_ARW=a.arw cargo test crops_unknown_sony -- --ignored --nocapture`
    /// (an ILCE-7RM6 lossless ARW: 10240 × 7168 readout, 10008 × 6672 image).
    #[test]
    #[ignore]
    fn crops_unknown_sony_readouts() {
        let path = std::path::PathBuf::from(std::env::var("EMULSION_SONY_ARW").expect("set EMULSION_SONY_ARW"));
        for half in [true, false] {
            let d = decode(&path, half).unwrap();
            let img = d.image.to_rgb32f();
            let (w, h) = img.dimensions();
            eprintln!("half={half}: {w} × {h}, full {:?}, colour {:?}", d.full_size, d.camera.colour);
            assert_eq!(d.camera.colour, Some(ColourSource::Darktable));
            let (fw, fh) = d.full_size;
            assert_eq!((fw.max(fh), fw.min(fh)), (10008, 6672));
            // The last column and row carry the picture, not padding.
            let mean = |pixels: Vec<f32>| pixels.iter().sum::<f32>() / pixels.len() as f32;
            let col = mean((0..h).flat_map(|y| img.get_pixel(w - 1, y).0).collect());
            let row = mean((0..w).flat_map(|x| img.get_pixel(x, h - 1).0).collect());
            let centre = mean((0..w).flat_map(|x| img.get_pixel(x, h / 2).0).collect());
            eprintln!("  edge means: column {col:.4}, row {row:.4}, centre row {centre:.4}");
            assert!(col > centre * 0.05 && row > centre * 0.05, "black band at the edge");
        }
    }

    /// `EMULSION_RAW_SAMPLES=a.RAF cargo test libraw_survives -- --ignored`.
    #[test]
    #[ignore]
    fn libraw_survives_threads_that_exit() {
        // Without `openmp_root`, the parallel build crashed (SIGSEGV in libomp) on the second
        // or third round: each round's threads were libomp's only roots, and their exit tore
        // the runtime down under the next call. Mirrors tokio's blocking threads.
        let samples = std::env::var("EMULSION_RAW_SAMPLES").expect("set EMULSION_RAW_SAMPLES");
        let path = std::path::PathBuf::from(samples.split(':').next().unwrap());
        for round in 0..300 {
            let threads: Vec<_> = (0..1 + round % 6)
                .map(|_| {
                    let path = path.clone();
                    std::thread::spawn(move || as_shot_white(&path).unwrap())
                })
                .collect();
            for t in threads {
                t.join().unwrap();
            }
        }
    }

    /// A half-size decode reports the photo's full size, the same as a full decode.
    /// The preview is half size, so this is what 100% zoom is measured in. Run with
    /// `EMULSION_RAW_SAMPLES="a.ORF:b.RAF" cargo test half_size_reports -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn half_size_reports_the_full_size() {
        let samples = std::env::var("EMULSION_RAW_SAMPLES").expect("set EMULSION_RAW_SAMPLES");
        for path in samples.split(':') {
            let (half, full) = (decode(Path::new(path), true).unwrap(), decode(Path::new(path), false).unwrap());
            eprintln!("{path}: half {}x{} reports {:?}; full {}x{} reports {:?}", half.image.width(), half.image.height(), half.full_size, full.image.width(), full.image.height(), full.full_size);
            assert_eq!(full.full_size, (full.image.width(), full.image.height()));
            assert_eq!(half.full_size, full.full_size, "{path}");
            // Asking for an edge gets that edge, even where the half-size image is smaller.
            let bytes = crate::decode::load_for_engine(Path::new(path), Some(2560)).unwrap();
            let (w, h) = (u32::from_le_bytes(bytes[0..4].try_into().unwrap()), u32::from_le_bytes(bytes[4..8].try_into().unwrap()));
            assert_eq!(w.max(h), 2560.min(full.full_size.0.max(full.full_size.1)), "{path}");
        }
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

    /// A real JPEG XL DNG (Apple ProRAW 48 MP, DxO PureRAW 6) decodes at full and half size,
    /// with the colour matrix from the file.
    #[test]
    #[ignore = "set EMULSION_JXL_DNG to a JPEG XL compressed DNG"]
    fn decodes_jpeg_xl_dngs() {
        let path = std::env::var("EMULSION_JXL_DNG").expect("set EMULSION_JXL_DNG");
        let path = Path::new(&path);
        assert!(uses_jpeg_xl(path), "not a JPEG XL DNG");
        for half in [false, true] {
            let d = decode(path, half).unwrap();
            let px = d.image.to_rgb32f();
            let mean: f32 = px.as_raw().iter().sum::<f32>() / px.as_raw().len() as f32;
            eprintln!("half={half}: {}x{} of {:?}, mean {mean:.3}", px.width(), px.height(), d.full_size);
            assert!(mean > 0.005 && mean < 1.0, "implausible mean {mean}");
            assert_ne!(d.camera_to_working, [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]], "no colour matrix");
        }
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
