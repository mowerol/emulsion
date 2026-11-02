// SPDX-License-Identifier: GPL-3.0-or-later
//! Capture settings, read independently of pixel decoding or import membership.
use exif::{Exif, In, Reader, Tag, Value};
use serde::Serialize;
use std::{fs::File, io::BufReader, path::Path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exposure {
    pub iso: Option<f64>,
    /// Exposure time in seconds.
    pub shutter: Option<f64>,
    pub aperture: Option<f64>,
    pub focal_length: Option<f64>,
    pub focal_length35: Option<f64>,
}

impl Exposure {
    pub fn new(iso: f64, shutter: f64, aperture: f64, focal_length: f64) -> Self {
        let valid = |v: f64| (v.is_finite() && v > 0.0).then_some(v);
        Self { iso: valid(iso), shutter: valid(shutter), aperture: valid(aperture), focal_length: valid(focal_length), focal_length35: None }
    }
}

fn number(exif: &Exif, tag: Tag) -> Option<f64> {
    let value = &exif.get_field(tag, In::PRIMARY)?.value;
    let n = match value {
        Value::Rational(v) => v.first()?.to_f64(),
        Value::SRational(v) => v.first()?.to_f64(),
        _ => value.get_uint(0)? as f64,
    };
    n.is_finite().then_some(n)
}

fn settings(exif: &Exif) -> Exposure {
    let iso = number(exif, Tag::PhotographicSensitivity).filter(|v| *v > 0.0 && *v < 65535.0)
        .or_else(|| number(exif, Tag::ISOSpeed)).unwrap_or(0.0);
    let shutter = number(exif, Tag::ExposureTime).filter(|v| *v > 0.0)
        .or_else(|| number(exif, Tag::ShutterSpeedValue).map(|v| 2.0f64.powf(-v))).unwrap_or(0.0);
    let aperture = number(exif, Tag::FNumber).filter(|v| *v > 0.0)
        .or_else(|| number(exif, Tag::ApertureValue).map(|v| 2.0f64.powf(v / 2.0))).unwrap_or(0.0);
    let mut result = Exposure::new(iso, shutter, aperture, number(exif, Tag::FocalLength).unwrap_or(0.0));
    result.focal_length35 = number(exif, Tag::FocalLengthIn35mmFilm).filter(|v| *v > 0.0);
    result
}

pub fn read(path: &Path) -> Option<Exposure> {
    if crate::library::classify(path) == crate::library::Kind::Raw {
        return crate::raw::exposure(path);
    }
    let mut file = BufReader::new(File::open(path).ok()?);
    let exif = Reader::new().read_from_container(&mut file).ok()?;
    Some(settings(&exif))
}

/// Library metadata is independent of pixel decoding and camera rendering profiles.
#[derive(Debug, Serialize)]
pub struct CatalogMetadata {
    pub camera: Option<String>,
    /// Local capture date, YYYY-MM-DD; no timezone is invented for EXIF timestamps.
    pub date: Option<String>,
}

fn text(exif: &Exif, tag: Tag) -> Option<String> {
    match &exif.get_field(tag, In::PRIMARY)?.value {
        Value::Ascii(values) => {
            let value = String::from_utf8_lossy(values.first()?).trim_matches('\0').trim().to_owned();
            (!value.is_empty()).then_some(value)
        }
        _ => None,
    }
}

fn catalog_settings(exif: &Exif) -> CatalogMetadata {
    let make = text(exif, Tag::Make).unwrap_or_default();
    let model = text(exif, Tag::Model).unwrap_or_default();
    let camera = format!("{make} {model}").trim().to_owned();
    let date = text(exif, Tag::DateTimeOriginal).or_else(|| text(exif, Tag::DateTime))
        .and_then(|value| {
            let bytes = value.as_bytes();
            if bytes.len() < 10 || bytes[4] != b':' || bytes[7] != b':' { return None; }
            let digits = [0, 1, 2, 3, 5, 6, 8, 9];
            if !digits.iter().all(|i| bytes[*i].is_ascii_digit()) { return None; }
            let month: u8 = value[5..7].parse().ok()?;
            let day: u8 = value[8..10].parse().ok()?;
            if !(1..=12).contains(&month) || !(1..=31).contains(&day) { return None; }
            Some(value[..10].replace(':', "-"))
        });
    CatalogMetadata { camera: (!camera.is_empty()).then_some(camera), date }
}

pub fn catalog(path: &Path) -> CatalogMetadata {
    let mut result = File::open(path).ok()
        .and_then(|file| Reader::new().read_from_container(&mut BufReader::new(file)).ok())
        .map(|exif| catalog_settings(&exif))
        .unwrap_or(CatalogMetadata { camera: None, date: None });
    if result.camera.is_none() && crate::library::classify(path) == crate::library::Kind::Raw {
        result.camera = crate::raw::catalog_camera(path);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiff(tags: &[(u16, u16, Vec<u8>)]) -> Vec<u8> {
        let mut bytes = b"II*\0\x08\0\0\0".to_vec();
        // IFD0 points to the EXIF IFD at byte 26.
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(0x8769u16.to_le_bytes());
        bytes.extend(4u16.to_le_bytes());
        bytes.extend(1u32.to_le_bytes());
        bytes.extend(26u32.to_le_bytes());
        bytes.extend(0u32.to_le_bytes());
        bytes.extend((tags.len() as u16).to_le_bytes());
        bytes.resize(28 + tags.len() * 12 + 4, 0);
        for (i, (tag, typ, value)) in tags.iter().enumerate() {
            let pos = 28 + i * 12;
            bytes[pos..pos + 2].copy_from_slice(&tag.to_le_bytes());
            bytes[pos + 2..pos + 4].copy_from_slice(&typ.to_le_bytes());
            bytes[pos + 4..pos + 8].copy_from_slice(&1u32.to_le_bytes());
            if value.len() <= 4 {
                bytes[pos + 8..pos + 8 + value.len()].copy_from_slice(value);
            } else {
                let offset = bytes.len() as u32;
                bytes[pos + 8..pos + 12].copy_from_slice(&offset.to_le_bytes());
                bytes.extend(value);
            }
        }
        bytes
    }

    fn rational(n: u32, d: u32) -> Vec<u8> {
        [n.to_le_bytes(), d.to_le_bytes()].concat()
    }

    #[test]
    fn reads_capture_settings_from_tiff_and_jpeg_containers() {
        let tiff = tiff(&[
            (0x829a, 5, rational(1, 250)), (0x829d, 5, rational(28, 10)),
            (0x8827, 3, 400u16.to_le_bytes().to_vec()), (0x920a, 5, rational(35, 1)),
            (0xa405, 3, 52u16.to_le_bytes().to_vec()),
        ]);
        let mut jpeg = vec![0xff, 0xd8, 0xff, 0xe1];
        jpeg.extend(((tiff.len() + 8) as u16).to_be_bytes());
        jpeg.extend(b"Exif\0\0");
        jpeg.extend(&tiff);
        jpeg.extend([0xff, 0xd9]);
        for (ext, bytes) in [(".tif", tiff), (".jpg", jpeg)] {
            let file = tempfile::Builder::new().suffix(ext).tempfile().unwrap();
            std::fs::write(file.path(), bytes).unwrap();
            let exposure = read(file.path()).unwrap();
            assert_eq!(exposure.iso, Some(400.0));
            assert_eq!(exposure.shutter, Some(1.0 / 250.0));
            assert_eq!(exposure.aperture, Some(2.8));
            assert_eq!(exposure.focal_length, Some(35.0));
            assert_eq!(exposure.focal_length35, Some(52.0));
        }
    }

    #[test]
    fn falls_back_to_apex_tags_and_extended_iso() {
        let bytes = tiff(&[
            (0x8827, 3, 65535u16.to_le_bytes().to_vec()),
            (0x8833, 4, 102400u32.to_le_bytes().to_vec()),
            (0x9201, 10, rational(8, 1)), (0x9202, 5, rational(6, 1)),
        ]);
        let exif = Reader::new().read_raw(bytes).unwrap();
        let exposure = settings(&exif);
        assert_eq!(exposure.iso, Some(102400.0));
        assert_eq!(exposure.shutter, Some(1.0 / 256.0));
        assert_eq!(exposure.aperture, Some(8.0));
        assert_eq!(exposure.focal_length, None);
    }

    #[test]
    fn missing_or_invalid_metadata_does_not_invent_settings() {
        let exif = Reader::new().read_raw(tiff(&[(0x829a, 5, rational(1, 0))])).unwrap();
        let exposure = settings(&exif);
        assert_eq!(exposure.shutter, None);
        assert_eq!(exposure.iso, None);
        assert_eq!(Exposure::new(f64::NAN, -1.0, 0.0, f64::INFINITY).focal_length, None);
        let file = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(file.path(), b"not an image").unwrap();
        assert!(read(file.path()).is_none());
    }

    #[test]
    fn indexes_capture_dates_without_inventing_missing_metadata() {
        let value = b"2026:10:12 07:42:00\0";
        let mut bytes = tiff(&[(0x9003, 2, value.to_vec())]);
        // The scalar fixture helper writes a count of one; ASCII counts bytes.
        bytes[32..36].copy_from_slice(&(value.len() as u32).to_le_bytes());
        let exif = Reader::new().read_raw(bytes.clone()).unwrap();
        let metadata = catalog_settings(&exif);
        assert_eq!(metadata.date.as_deref(), Some("2026-10-12"));
        assert_eq!(metadata.camera, None);
        bytes[49] = b'9'; // Invalid month 90.
        let exif = Reader::new().read_raw(bytes).unwrap();
        assert_eq!(catalog_settings(&exif).date, None);
        let file = tempfile::NamedTempFile::new().unwrap();
        assert_eq!(catalog(file.path()).date, None);
        assert_eq!(catalog(file.path()).camera, None);
    }
}
