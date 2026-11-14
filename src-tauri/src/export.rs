// SPDX-License-Identifier: GPL-3.0-or-later
//! Writing developed frames to disk. The GPU renders the final pixels (8-bit RGBA, or 16-bit RGB
//! for 16-bit TIFF and PNG); this module encodes them as JPEG, PNG or TIFF and places the file by
//! the export's rule for an existing name: a new name (`-2`, `-3`...), overwrite, or skip.
//! Every encoded frame embeds an sRGB ICC profile, matching the GPU's output pixels.
//! A frame is written in full under a hidden name, then moved to its own, so a crash or a full
//! disk never leaves a half-written file behind, and an overwrite never truncates the old one.

use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{DynamicImage, ImageBuffer, ImageEncoder, Rgb, RgbImage};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Cursor, ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// ICC's unmodified sRGB v2 profile (February 2015 revision). Source and terms: NOTICE.md.
const SRGB_ICC: &[u8] = include_bytes!("../data/sRGB2014.icc");

/// How TIFF pixels are compressed. LZW and ZIP use the horizontal predictor, as Lightroom's do.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TiffCompression {
    None,
    Lzw,
    Zip,
}

/// The file an export writes.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Format {
    Jpeg { quality: u8 },
    Png { bits: u8 },
    Tiff { bits: u8, compression: TiffCompression },
}

impl Format {
    pub fn ext(&self) -> &'static str {
        match self {
            Format::Jpeg { .. } => "jpg",
            Format::Png { .. } => "png",
            Format::Tiff { .. } => "tif",
        }
    }

    /// 16 when the frame comes as 16-bit RGB, 8 when it comes as 8-bit RGBA.
    pub fn bits(&self) -> u8 {
        match self {
            Format::Jpeg { .. } => 8,
            Format::Png { bits } | Format::Tiff { bits, .. } => if *bits == 16 { 16 } else { 8 },
        }
    }
}

/// What to do when the file name is already taken.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Existing {
    /// Add `-2`, `-3`... (never touches the other file).
    Rename,
    /// Replace it (never the photo being exported).
    Overwrite,
    /// Leave it and write nothing.
    Skip,
}

/// A frame's pixels as they come from the GPU.
pub enum Pixels<'a> {
    /// 8-bit RGBA, top row first.
    Rgba8(&'a [u8]),
    /// 16-bit RGB, top row first, little-endian bytes (a JS `Uint16Array`'s).
    Rgb16(&'a [u8]),
}

/// Where a frame went: `skipped` means a file of that name was there and was left alone.
#[derive(Debug, Serialize, PartialEq)]
pub struct Written {
    pub path: PathBuf,
    pub skipped: bool,
}

/// Why a frame was not written. `stop` means the destination itself failed (full, read-only,
/// gone, not allowed), so the frames after it would fail the same way.
#[derive(Debug, Serialize)]
pub struct WriteError {
    pub message: String,
    pub stop: bool,
}

impl From<String> for WriteError {
    fn from(message: String) -> Self {
        WriteError { message, stop: false }
    }
}

fn io_error(what: &str, path: &Path, e: &io::Error) -> WriteError {
    let (reason, stop) = match e.kind() {
        ErrorKind::StorageFull | ErrorKind::QuotaExceeded => ("the disk is full".to_string(), true),
        ErrorKind::ReadOnlyFilesystem => ("the disk is read-only".to_string(), true),
        ErrorKind::PermissionDenied => ("Emulsion is not allowed to write there".to_string(), true),
        ErrorKind::NotFound => ("the folder is no longer there".to_string(), true),
        _ => (e.to_string(), false),
    };
    WriteError { message: format!("Could not {what} {}: {reason}", path.display()), stop }
}

/// `<dir>/<stem>.<ext>`, or `<stem>-2.<ext>`, `<stem>-3.<ext>`... if taken.
pub fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.{ext}"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| dir.join(format!("{stem}-{n}.{ext}")))
        .find(|p| !p.exists())
        .expect("an unused file name")
}

/// Strip characters that are unsafe in file names on any platform.
pub fn safe_stem(stem: &str) -> String {
    let cleaned: String = stem
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() { "frame".into() } else { trimmed.into() }
}

fn rgb8(px: &Pixels, width: u32, height: u32) -> Result<RgbImage, String> {
    let n = width as usize * height as usize;
    let rgb: Vec<u8> = match px {
        Pixels::Rgba8(b) if b.len() == n * 4 => b.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect(),
        Pixels::Rgba8(b) => return Err(format!("Expected {} bytes for a {width}x{height} frame, got {}", n * 4, b.len())),
        Pixels::Rgb16(b) if b.len() == n * 6 => b.chunks_exact(2).map(|v| (u16::from_le_bytes([v[0], v[1]]) >> 8) as u8).collect(),
        Pixels::Rgb16(b) => return Err(format!("Expected {} bytes for a 16-bit {width}x{height} frame, got {}", n * 6, b.len())),
    };
    if n == 0 {
        return Err(format!("A {width}x{height} frame has no pixels"));
    }
    RgbImage::from_raw(width, height, rgb).ok_or_else(|| "Frame size does not match its pixels".into())
}

fn rgb16(px: &Pixels, width: u32, height: u32) -> Result<Vec<u16>, String> {
    let n = width as usize * height as usize;
    match px {
        Pixels::Rgb16(b) if n > 0 && b.len() == n * 6 => Ok(b.chunks_exact(2).map(|v| u16::from_le_bytes([v[0], v[1]])).collect()),
        Pixels::Rgb16(b) => Err(format!("Expected {} bytes for a 16-bit {width}x{height} frame, got {}", n * 6, b.len())),
        // An 8-bit frame widened, so the file is still 16-bit when asked.
        Pixels::Rgba8(_) => Ok(rgb8(px, width, height)?.into_raw().into_iter().map(|v| v as u16 * 257).collect()),
    }
}

pub fn encode(px: &Pixels, width: u32, height: u32, format: Format) -> Result<Vec<u8>, String> {
    // Tag the finished sRGB pixels; the source photo's profile describes its input,
    // not this developed frame. Keep the published profile intact.
    let mut out = Vec::new();
    match format {
        Format::Jpeg { quality } => {
            let mut encoder = JpegEncoder::new_with_quality(&mut out, quality.clamp(1, 100));
            encoder.set_icc_profile(SRGB_ICC.to_vec()).map_err(|e| format!("Could not tag JPEG as sRGB: {e}"))?;
            encoder.encode_image(&rgb8(px, width, height)?)
                .map_err(|e| format!("Could not encode JPEG: {e}"))?;
        }
        Format::Png { .. } => {
            let img = if format.bits() == 16 {
                let buf: ImageBuffer<Rgb<u16>, Vec<u16>> =
                    ImageBuffer::from_raw(width, height, rgb16(px, width, height)?).ok_or("Frame size does not match its pixels")?;
                DynamicImage::ImageRgb16(buf)
            } else {
                DynamicImage::ImageRgb8(rgb8(px, width, height)?)
            };
            let mut encoder = PngEncoder::new_with_quality(&mut out, CompressionType::Default, FilterType::Adaptive);
            encoder.set_icc_profile(SRGB_ICC.to_vec()).map_err(|e| format!("Could not tag PNG as sRGB: {e}"))?;
            img.write_with_encoder(encoder)
                .map_err(|e| format!("Could not encode PNG: {e}"))?;
        }
        Format::Tiff { compression, .. } => {
            use tiff::encoder::{colortype, Compression, DeflateLevel, TiffEncoder};
            use tiff::tags::{Predictor, Tag};
            let mut cursor = Cursor::new(&mut out);
            let err = |e: tiff::TiffError| format!("Could not encode TIFF: {e}");
            let encoder = TiffEncoder::new(&mut cursor).map_err(err)?;
            let mut encoder = match compression {
                TiffCompression::None => encoder,
                TiffCompression::Lzw => encoder.with_compression(Compression::Lzw).with_predictor(Predictor::Horizontal),
                TiffCompression::Zip => encoder.with_compression(Compression::Deflate(DeflateLevel::Balanced)).with_predictor(Predictor::Horizontal),
            };
            if format.bits() == 16 {
                let pixels = rgb16(px, width, height)?;
                let mut img = encoder.new_image::<colortype::RGB16>(width, height).map_err(err)?;
                img.encoder().write_tag(Tag::IccProfile, SRGB_ICC).map_err(err)?;
                img.write_data(&pixels).map_err(err)?;
            } else {
                let pixels = rgb8(px, width, height)?;
                let mut img = encoder.new_image::<colortype::RGB8>(width, height).map_err(err)?;
                img.encoder().write_tag(Tag::IccProfile, SRGB_ICC).map_err(err)?;
                img.write_data(pixels.as_raw()).map_err(err)?;
            }
        }
    }
    Ok(out)
}

pub fn encode_jpeg(rgba: &[u8], width: u32, height: u32, quality: u8) -> Result<Vec<u8>, String> {
    encode(&Pixels::Rgba8(rgba), width, height, Format::Jpeg { quality })
}

/// Make the export folder and check a file can be written in it, before any frame is developed.
pub fn check_dir(dir: &Path) -> Result<(), WriteError> {
    fs::create_dir_all(dir).map_err(|e| io_error("create", dir, &e))?;
    let probe = temp_path(dir, "write-check", "tmp");
    let written = fs::File::create_new(&probe).and_then(|mut f| f.write_all(b"emulsion"));
    let _ = fs::remove_file(&probe);
    written.map_err(|e| io_error("write to", dir, &e))
}

/// A hidden temporary file; it keeps the export's extension so the XMP Toolkit can recognise it.
fn temp_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    dir.join(format!(".{stem}.emulsion-{}-{n}.partial.{ext}", std::process::id()))
}

/// The file a frame of `stem` would be written to, for checking before developing it.
pub fn target(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    dir.join(format!("{}.{ext}", safe_stem(stem)))
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Write `bytes` as `<stem>.<ext>` by the `existing` rule. With `Rename` nothing is overwritten,
/// even a file that appears meanwhile: the name is claimed with an exclusive create, then the
/// finished temporary file is renamed over that claim. `Overwrite` renames the finished file over
/// the old one in one step, and refuses when that would be `protect` (the photo itself).
pub fn place(dir: &Path, stem: &str, ext: &str, bytes: &[u8], existing: Existing, protect: Option<&Path>) -> Result<Written, WriteError> {
    place_with(dir, stem, ext, bytes, existing, protect, None)
}

/// `place`, embedding `meta` in the file before it takes its name (`export_meta`).
fn place_with(dir: &Path, stem: &str, ext: &str, bytes: &[u8], existing: Existing, protect: Option<&Path>, meta: Option<&xmp_toolkit::XmpMeta>) -> Result<Written, WriteError> {
    let wanted = dir.join(format!("{stem}.{ext}"));
    if existing == Existing::Skip && fs::symlink_metadata(&wanted).is_ok() {
        return Ok(Written { path: wanted, skipped: true });
    }
    if existing == Existing::Overwrite {
        if wanted.is_dir() {
            return Err(format!("Could not write {}: a folder has that name", wanted.display()).into());
        }
        if protect.is_some_and(|p| same_file(p, &wanted)) {
            return Err(format!("Did not write {}: it would replace the original photo", wanted.display()).into());
        }
    }
    let tmp = temp_path(dir, stem, ext);
    let written = fs::File::create_new(&tmp).and_then(|mut f| f.write_all(bytes));
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(io_error("write", &wanted, &e));
    }
    if let Some(meta) = meta {
        if let Err(e) = crate::export_meta::embed(&tmp, meta) {
            let _ = fs::remove_file(&tmp);
            return Err(format!("Could not write {}: {e}", wanted.display()).into());
        }
    }
    if let Err(e) = fs::File::open(&tmp).and_then(|f| crate::durable::sync(&f)) {
        let _ = fs::remove_file(&tmp);
        return Err(io_error("write", &wanted, &e));
    }
    if existing == Existing::Overwrite {
        return match fs::rename(&tmp, &wanted) {
            Ok(()) => Ok(Written { path: wanted, skipped: false }),
            Err(e) => {
                let _ = fs::remove_file(&tmp);
                Err(io_error("write", &wanted, &e))
            }
        };
    }
    let mut path = if existing == Existing::Skip { wanted.clone() } else { unique_path(dir, stem, ext) };
    let claimed = loop {
        match fs::File::create_new(&path) {
            Ok(_) => break Ok(()),
            // A file of that name appeared while this one was written.
            Err(e) if e.kind() == ErrorKind::AlreadyExists && existing == Existing::Skip => {
                let _ = fs::remove_file(&tmp);
                return Ok(Written { path, skipped: true });
            }
            Err(e) if e.kind() == ErrorKind::AlreadyExists => path = unique_path(dir, stem, ext),
            Err(e) => break Err(e),
        }
    };
    if let Err(e) = claimed.and_then(|_| fs::rename(&tmp, &path)) {
        let _ = fs::remove_file(&tmp);
        // Only an empty claim of ours, never someone else's file.
        if fs::metadata(&path).map(|m| m.len() == 0).unwrap_or(false) {
            let _ = fs::remove_file(&path);
        }
        return Err(io_error("write", &path, &e));
    }
    Ok(Written { path, skipped: false })
}

/// Never-overwrite placement (`place` with `Existing::Rename`).
pub fn write_new(dir: &Path, stem: &str, ext: &str, bytes: &[u8]) -> Result<PathBuf, WriteError> {
    place(dir, stem, ext, bytes, Existing::Rename, None).map(|w| w.path)
}

/// Encode a frame and write it into `dir` (made if missing) under `stem`'s safe name.
pub fn write_frame(
    dir: &Path,
    stem: &str,
    px: &Pixels,
    width: u32,
    height: u32,
    format: Format,
    existing: Existing,
    protect: Option<&Path>,
    meta: Option<&crate::export_meta::Request>,
) -> Result<Written, WriteError> {
    fs::create_dir_all(dir).map_err(|e| io_error("create", dir, &e))?;
    let stem = safe_stem(stem);
    // Checked before encoding too, so a skipped frame costs nothing more.
    if existing == Existing::Skip && fs::symlink_metadata(dir.join(format!("{stem}.{}", format.ext()))).is_ok() {
        return Ok(Written { path: dir.join(format!("{stem}.{}", format.ext())), skipped: true });
    }
    let packet = match meta.map(crate::export_meta::packet).transpose() {
        Ok(p) => p,
        Err(e) => return Err(format!("Could not prepare the metadata for {stem}: {e}").into()),
    };
    let bytes = encode(px, width, height, format)?;
    place_with(dir, &stem, format.ext(), &bytes, existing, protect, packet.as_ref())
}

pub fn write_jpeg(dir: &Path, stem: &str, rgba: &[u8], width: u32, height: u32, quality: u8) -> Result<PathBuf, WriteError> {
    write_frame(dir, stem, &Pixels::Rgba8(rgba), width, height, Format::Jpeg { quality }, Existing::Rename, None, None).map(|w| w.path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        assert_eq!(unique_path(d, "a", "jpg"), d.join("a.jpg"));
        fs::write(d.join("a.jpg"), b"").unwrap();
        assert_eq!(unique_path(d, "a", "jpg"), d.join("a-2.jpg"));
        fs::write(d.join("a-2.jpg"), b"").unwrap();
        assert_eq!(unique_path(d, "a", "jpg"), d.join("a-3.jpg"));
    }

    #[test]
    fn cleans_stems() {
        assert_eq!(safe_stem("DSCF0001"), "DSCF0001");
        assert_eq!(safe_stem("a/b:c"), "a_b_c");
        assert_eq!(safe_stem(" .. "), "frame");
    }

    #[test]
    fn writes_a_valid_jpeg() {
        let dir = tempfile::tempdir().unwrap();
        let rgba: Vec<u8> = (0..(8 * 4)).flat_map(|i| [(i * 7) as u8, 100, 200, 255]).collect();
        let path = write_jpeg(&dir.path().join("Emulsion exports"), "frame", &rgba, 8, 4, 90).unwrap();
        let img = image::open(&path).unwrap();
        assert_eq!((img.width(), img.height()), (8, 4));
    }

    #[test]
    fn writes_leave_no_temporary_files() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        fs::write(d.join("a.jpg"), b"theirs").unwrap();
        check_dir(d).unwrap();
        assert_eq!(write_new(d, "a", "jpg", b"ours").unwrap(), d.join("a-2.jpg"));
        assert_eq!(fs::read(d.join("a.jpg")).unwrap(), b"theirs");
        assert_eq!(fs::read(d.join("a-2.jpg")).unwrap(), b"ours");
        let mut names: Vec<_> = fs::read_dir(d).unwrap().map(|e| e.unwrap().file_name()).collect();
        names.sort();
        assert_eq!(names, ["a-2.jpg", "a.jpg"]);
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_folder_stops_the_export() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path().join("locked");
        fs::create_dir(&d).unwrap();
        fs::set_permissions(&d, fs::Permissions::from_mode(0o555)).unwrap();
        let checked = check_dir(&d);
        let written = write_new(&d, "a", "jpg", b"x");
        fs::set_permissions(&d, fs::Permissions::from_mode(0o755)).unwrap();
        // Root can write anywhere, so there is nothing to check there.
        if checked.is_ok() { return; }
        assert!(checked.unwrap_err().stop);
        assert!(written.unwrap_err().stop);
    }

    #[test]
    fn rejects_mismatched_buffers() {
        assert!(encode_jpeg(&[0; 10], 2, 2, 90).is_err());
        assert!(encode_jpeg(&[], 0, 0, 90).is_err());
    }

    fn ramp16(w: u32, h: u32) -> Vec<u8> {
        (0..w * h * 3).flat_map(|i| ((i * 4099) as u16).to_le_bytes()).collect()
    }

    #[test]
    fn srgb_profile_survives_every_format_and_metadata_choice() {
        use crate::export_meta::{Include, Request};
        use image::{ImageDecoder, ImageReader};

        let dir = tempfile::tempdir().unwrap();
        // A wider-gamut original must not supply the developed export's profile.
        let source = dir.path().join("source.png");
        let mut encoder = PngEncoder::new(fs::File::create(&source).unwrap());
        encoder.set_icc_profile(moxcms::ColorProfile::new_display_p3().encode().unwrap()).unwrap();
        encoder.write_image(&[128, 90, 200], 1, 1, image::ExtendedColorType::Rgb8).unwrap();

        let (w, h) = (7, 5);
        let bytes = ramp16(w, h);
        let want16: Vec<u16> = bytes.chunks_exact(2).map(|v| u16::from_le_bytes([v[0], v[1]])).collect();
        let want8: Vec<u8> = want16.iter().map(|v| (v >> 8) as u8).collect();
        let formats = [
            Format::Jpeg { quality: 90 },
            Format::Png { bits: 8 },
            Format::Png { bits: 16 },
            Format::Tiff { bits: 8, compression: TiffCompression::None },
            Format::Tiff { bits: 8, compression: TiffCompression::Lzw },
            Format::Tiff { bits: 8, compression: TiffCompression::Zip },
            Format::Tiff { bits: 16, compression: TiffCompression::None },
            Format::Tiff { bits: 16, compression: TiffCompression::Lzw },
            Format::Tiff { bits: 16, compression: TiffCompression::Zip },
        ];
        for format in formats {
            for include in [None, Some(Include::Copyright), Some(Include::CopyrightContact), Some(Include::AllExceptCamera), Some(Include::All)] {
                let req = include.map(|include| Request {
                    source: source.to_string_lossy().into(), include,
                    remove_person: true, remove_location: true, hierarchy: false,
                    rating: 0, label: None, meta: Default::default(), person_keywords: Vec::new(),
                });
                let written = write_frame(dir.path(), "frame", &Pixels::Rgb16(&bytes), w, h, format, Existing::Rename, None, req.as_ref()).unwrap();
                let mut decoder = ImageReader::open(&written.path).unwrap().into_decoder().unwrap();
                let icc = if matches!(format, Format::Tiff { .. }) {
                    let mut tiff = tiff::decoder::Decoder::new(std::io::BufReader::new(fs::File::open(&written.path).unwrap())).unwrap();
                    tiff.get_tag_u8_vec(tiff::tags::Tag::IccProfile).expect("TIFF ICC tag")
                } else {
                    decoder.icc_profile().unwrap().expect("export has an ICC profile")
                };
                assert_eq!(icc, SRGB_ICC, "{format:?}, {include:?}");
                let profile = moxcms::ColorProfile::new_from_slice(&icc).expect("valid ICC profile");
                assert_eq!(profile.color_space, moxcms::DataColorSpace::Rgb);
                let img = DynamicImage::from_decoder(decoder).unwrap();
                assert_eq!((img.width(), img.height()), (w, h));
                // Embedding the profile and then reconciling metadata must keep pixel values
                // and precision intact. JPEG's lossy encoding is checked separately.
                if format.bits() == 16 {
                    assert_eq!(img.color(), image::ColorType::Rgb16);
                    assert_eq!(img.to_rgb16().into_raw(), want16, "{format:?}, {include:?}");
                } else if !matches!(format, Format::Jpeg { .. }) {
                    assert_eq!(img.color(), image::ColorType::Rgb8);
                    assert_eq!(img.to_rgb8().into_raw(), want8, "{format:?}, {include:?}");
                }
            }
        }
    }

    #[test]
    fn sixteen_bit_png_and_tiff_keep_every_value() {
        let (w, h) = (7, 5);
        let bytes = ramp16(w, h);
        let want: Vec<u16> = bytes.chunks_exact(2).map(|v| u16::from_le_bytes([v[0], v[1]])).collect();
        for format in [
            Format::Png { bits: 16 },
            Format::Tiff { bits: 16, compression: TiffCompression::None },
            Format::Tiff { bits: 16, compression: TiffCompression::Lzw },
            Format::Tiff { bits: 16, compression: TiffCompression::Zip },
        ] {
            let file = encode(&Pixels::Rgb16(&bytes), w, h, format).unwrap();
            let img = image::load_from_memory(&file).unwrap();
            assert_eq!((img.width(), img.height()), (w, h), "{format:?}");
            assert_eq!(img.to_rgb16().into_raw(), want, "{format:?}");
        }
    }

    #[test]
    fn eight_bit_files_drop_alpha_and_keep_values() {
        let (w, h) = (6, 3);
        let rgba: Vec<u8> = (0..w * h).flat_map(|i| [(i * 13) as u8, (i * 5) as u8, 255 - i as u8, 255]).collect();
        let rgb: Vec<u8> = rgba.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect();
        for format in [
            Format::Png { bits: 8 },
            Format::Tiff { bits: 8, compression: TiffCompression::None },
            Format::Tiff { bits: 8, compression: TiffCompression::Lzw },
            Format::Tiff { bits: 8, compression: TiffCompression::Zip },
        ] {
            let file = encode(&Pixels::Rgba8(&rgba), w, h, format).unwrap();
            let img = image::load_from_memory(&file).unwrap();
            assert_eq!(img.color(), image::ColorType::Rgb8, "{format:?}");
            assert_eq!(img.to_rgb8().into_raw(), rgb, "{format:?}");
        }
    }

    #[test]
    fn eight_bit_frames_widen_for_sixteen_bit_files() {
        let rgba = [0u8, 128, 255, 255];
        let file = encode(&Pixels::Rgba8(&rgba), 1, 1, Format::Tiff { bits: 16, compression: TiffCompression::None }).unwrap();
        assert_eq!(image::load_from_memory(&file).unwrap().to_rgb16().into_raw(), [0, 128 * 257, 65535]);
    }

    #[test]
    fn existing_files_by_rule() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        fs::write(d.join("a.tif"), b"theirs").unwrap();
        let skipped = place(d, "a", "tif", b"ours", Existing::Skip, None).unwrap();
        assert_eq!(skipped, Written { path: d.join("a.tif"), skipped: true });
        assert_eq!(fs::read(d.join("a.tif")).unwrap(), b"theirs");
        let fresh = place(d, "b", "tif", b"new", Existing::Skip, None).unwrap();
        assert_eq!(fresh, Written { path: d.join("b.tif"), skipped: false });
        let renamed = place(d, "a", "tif", b"ours", Existing::Rename, None).unwrap();
        assert_eq!(renamed.path, d.join("a-2.tif"));
        let over = place(d, "a", "tif", b"ours", Existing::Overwrite, None).unwrap();
        assert_eq!(over, Written { path: d.join("a.tif"), skipped: false });
        assert_eq!(fs::read(d.join("a.tif")).unwrap(), b"ours");
        let mut names: Vec<_> = fs::read_dir(d).unwrap().map(|e| e.unwrap().file_name()).collect();
        names.sort();
        assert_eq!(names, ["a-2.tif", "a.tif", "b.tif"]);
    }

    #[test]
    fn overwrite_never_replaces_the_photo_itself() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        fs::write(d.join("IMG_1.jpg"), b"original").unwrap();
        let err = place(d, "IMG_1", "jpg", b"export", Existing::Overwrite, Some(&d.join("IMG_1.jpg"))).unwrap_err();
        assert!(!err.stop);
        assert_eq!(fs::read(d.join("IMG_1.jpg")).unwrap(), b"original");
        assert_eq!(fs::read_dir(d).unwrap().count(), 1);
    }

    #[test]
    fn formats_parse_from_the_interface() {
        let f: Format = serde_json::from_str(r#"{"kind":"tiff","bits":16,"compression":"zip"}"#).unwrap();
        assert_eq!(f, Format::Tiff { bits: 16, compression: TiffCompression::Zip });
        assert_eq!((f.ext(), f.bits()), ("tif", 16));
        let j: Format = serde_json::from_str(r#"{"kind":"jpeg","quality":90}"#).unwrap();
        assert_eq!((j.ext(), j.bits()), ("jpg", 8));
        let e: Existing = serde_json::from_str(r#""overwrite""#).unwrap();
        assert_eq!(e, Existing::Overwrite);
    }
}
