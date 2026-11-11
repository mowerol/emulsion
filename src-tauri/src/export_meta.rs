// SPDX-License-Identifier: GPL-3.0-or-later
//! Metadata written into exported files, with Lightroom Classic's export choices: what to
//! include (copyright only; copyright and contact; all but camera information; all) and whether
//! to remove person and location information.
//!
//! One XMP packet is built per export and embedded with Adobe's XMP Toolkit (`XmpFile`), whose
//! JPEG and TIFF handlers also write it as native EXIF/TIFF tags and IPTC-IIM (the SDK's legacy
//! reconciliation), so apps that read only EXIF or IPTC see the same values. PNG gets the XMP.
//!
//! The camera's EXIF comes from the original through the same toolkit (it imports EXIF as XMP
//! for JPEG, TIFF, DNG and TIFF-based RAWs); for other RAWs (RAF, CR3...) from their embedded
//! JPEG preview, which carries the camera's EXIF; failing that, LibRaw's make, model and exposure.
//! What describes the original file rather than the export (pixel size, orientation,
//! compression, colour space) is left out or set for the export (sRGB, upright).

use serde::Deserialize;
use std::io;
use std::path::Path;
use xmp_toolkit::{xmp_ns, IterOptions, OpenFileOptions, XmpFile, XmpMeta, XmpValue};

use crate::xmp::{self, Interchange, Meta};

/// Lightroom Classic's Metadata › Include.
#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Include {
    Copyright,
    CopyrightContact,
    AllExceptCamera,
    All,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    /// The original photo, for its camera EXIF.
    pub source: String,
    pub include: Include,
    #[serde(default)]
    pub remove_person: bool,
    #[serde(default)]
    pub remove_location: bool,
    /// Lightroom's Write Keywords as Lightroom Hierarchy (`lr:hierarchicalSubject`).
    #[serde(default)]
    pub hierarchy: bool,
    /// The frame's stars and colour label.
    #[serde(default)]
    pub rating: u8,
    #[serde(default)]
    pub label: Option<String>,
    /// The photo's keywords and IPTC fields, as the app has them now.
    #[serde(default)]
    pub meta: Meta,
    /// Keyword paths marked Person in the Keyword List; removed (with those inside) by `remove_person`.
    #[serde(default)]
    pub person_keywords: Vec<String>,
}

const COPYRIGHT: &[&str] = &["copyright", "copyrightStatus", "usageTerms", "copyrightUrl"];
const CONTACT: &[&str] = &["creator", "jobTitle", "address", "contactCity", "contactState", "postalCode", "contactCountry", "phone", "email", "website"];
const LOCATION: &[&str] = &["location", "city", "state", "country", "countryCode"];

/// EXIF and TIFF properties that describe the original file, not the exported one.
const FILE_PROPERTIES: &[&str] = &[
    "ImageWidth", "ImageLength", "BitsPerSample", "Compression", "PhotometricInterpretation", "Orientation", "SamplesPerPixel",
    "PlanarConfiguration", "YCbCrSubSampling", "YCbCrPositioning", "XResolution", "YResolution", "ResolutionUnit",
    "PixelXDimension", "PixelYDimension", "ColorSpace", "CompressedBitsPerPixel", "ComponentsConfiguration", "NativeDigest",
];

/// Camera properties kept by "all except camera information": when and where.
fn not_camera(ns: &str, name: &str) -> bool {
    (ns == xmp_ns::EXIF && (name.starts_with("DateTime") || name.starts_with("GPS") || name.starts_with("SubSecTime")))
        || (ns == xmp_ns::XMP && name == "CreateDate")
        || (ns == xmp_ns::PHOTOSHOP && name == "DateCreated")
}

const EXIF_EX: &str = "http://cipa.jp/exif/1.0/";
const AUX: &str = "http://ns.adobe.com/exif/1.0/aux/";

/// The original's camera data as XMP (`tiff:`, `exif:`, `exifEX:`, `aux:`, capture dates).
fn camera_xmp(source: &Path) -> Option<XmpMeta> {
    let read = |p: &Path| -> Option<XmpMeta> {
        let mut f = XmpFile::new().ok()?;
        f.open_file(p, OpenFileOptions::default().for_read().use_smart_handler()).ok()?;
        let m = f.xmp();
        f.close();
        m.filter(|m| m.contains_property(xmp_ns::TIFF, "Make") || m.contains_property(xmp_ns::EXIF, "DateTimeOriginal"))
    };
    if let Some(m) = read(source) {
        return Some(m);
    }
    if crate::library::classify(source) != crate::library::Kind::Raw {
        return None;
    }
    if let Some(jpeg) = crate::raw::embedded_jpeg(source) {
        // The toolkit reads files only.
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let p = std::env::temp_dir().join(format!("emulsion-preview-{}-{n}.jpg", std::process::id()));
        let found = std::fs::write(&p, jpeg).ok().and_then(|_| read(&p));
        let _ = std::fs::remove_file(&p);
        if found.is_some() {
            return found;
        }
    }
    let (make, model, e) = crate::raw::camera_info(source)?;
    let mut m = XmpMeta::new().ok()?;
    let mut put = |ns: &str, name: &str, v: String| {
        if !v.is_empty() {
            let _ = m.set_property(ns, name, &v.into());
        }
    };
    put(xmp_ns::TIFF, "Make", make);
    put(xmp_ns::TIFF, "Model", model);
    let ratio = |v: f64| format!("{}/100", (v * 100.0).round() as i64);
    if let Some(v) = e.shutter {
        put(xmp_ns::EXIF, "ExposureTime", if v < 1.0 { format!("1/{}", (1.0 / v).round() as i64) } else { ratio(v) });
    }
    if let Some(v) = e.aperture {
        put(xmp_ns::EXIF, "FNumber", ratio(v));
    }
    if let Some(v) = e.focal_length {
        put(xmp_ns::EXIF, "FocalLength", ratio(v));
    }
    if let Some(v) = e.focal_length35 {
        put(xmp_ns::EXIF, "FocalLengthIn35mmFilm", (v.round() as i64).to_string());
    }
    if let Some(v) = e.iso {
        let iso = XmpValue::new("ISOSpeedRatings".to_string()).set_is_array(true).set_is_ordered(true);
        let _ = m.append_array_item(xmp_ns::EXIF, &iso, &(v.round() as i64).to_string().as_str().into());
    }
    Some(m)
}

/// Delete the top-level properties of `m` that `keep` refuses (namespace URI, local name).
fn prune(m: &mut XmpMeta, keep: impl Fn(&str, &str) -> bool) {
    let top: Vec<(String, String)> = m
        .iter(IterOptions::default())
        .filter(|p| !p.name.is_empty() && !p.name.contains('/') && !p.name.contains('['))
        .map(|p| (p.schema_ns.clone(), p.name.clone()))
        .collect();
    for (ns, name) in top {
        let local = name.split_once(':').map_or(name.as_str(), |(_, l)| l);
        if !keep(&ns, local) {
            let _ = m.delete_property(&ns, &name);
        }
    }
}

/// The XMP packet for an exported frame.
pub fn packet(req: &Request) -> io::Result<XmpMeta> {
    let camera = matches!(req.include, Include::All | Include::AllExceptCamera).then(|| camera_xmp(Path::new(&req.source))).flatten();
    let found = camera.is_some();
    let mut m = match camera { Some(c) => c, None => XmpMeta::new().map_err(io::Error::other)? };
    if found {
        prune(&mut m, |ns, name| {
            let wanted = if req.include == Include::All {
                [xmp_ns::TIFF, xmp_ns::EXIF, EXIF_EX, AUX].contains(&ns) || not_camera(ns, name)
            } else {
                not_camera(ns, name)
            };
            wanted && !FILE_PROPERTIES.contains(&name) && !(req.remove_location && name.starts_with("GPS"))
        });
        if req.include == Include::All {
            m.set_property(xmp_ns::TIFF, "Orientation", &"1".into()).map_err(io::Error::other)?;
            m.set_property(xmp_ns::EXIF, "ColorSpace", &"1".into()).map_err(io::Error::other)?;
        }
    }
    // Fields by what is included.
    let mut meta = Meta { keywords: Vec::new(), ..Default::default() };
    let wanted = |id: &str| match req.include {
        Include::Copyright => COPYRIGHT.contains(&id),
        Include::CopyrightContact => COPYRIGHT.contains(&id) || CONTACT.contains(&id),
        _ => !(req.remove_location && LOCATION.contains(&id)),
    };
    for (id, value) in &req.meta.fields {
        if wanted(id) {
            meta.set(id, value.clone());
        }
    }
    let all = matches!(req.include, Include::All | Include::AllExceptCamera);
    if all {
        let person = |k: &str| {
            req.remove_person && req.person_keywords.iter().any(|p| { let (k, p) = (k.to_lowercase(), xmp::tidy_path(p).to_lowercase()); k == p || k.starts_with(&format!("{p}|")) })
        };
        meta.keywords = req.meta.keywords.iter().filter(|k| !person(k)).cloned().collect();
    }
    let values = Interchange { rating: if all { req.rating.min(5) } else { 0 }, label: if all { req.label.clone() } else { None }, reject: false, meta };
    xmp::fill(&mut m, &values, req.hierarchy)?;
    m.set_property(xmp_ns::XMP, "CreatorTool", &"Emulsion".into()).map_err(io::Error::other)?;
    Ok(m)
}

/// Embed `packet` in the exported file at `path` (JPEG, TIFF or PNG, by its extension).
pub fn embed(path: &Path, packet: &XmpMeta) -> io::Result<()> {
    let mut f = XmpFile::new().map_err(io::Error::other)?;
    f.open_file(path, OpenFileOptions::default().for_update().use_smart_handler()).map_err(|e| io::Error::other(format!("could not open the export to add metadata: {e}")))?;
    f.put_xmp(packet).map_err(|e| io::Error::other(format!("could not add metadata: {e}")))?;
    f.try_close().map_err(|e| io::Error::other(format!("could not add metadata: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::{write_frame, Existing, Format, Pixels};
    use std::str::FromStr;

    /// A camera JPEG: EXIF written through the toolkit, as the spike showed it does.
    fn camera_jpeg(dir: &Path) -> std::path::PathBuf {
        let p = dir.join("DSCF0001.JPG");
        let mut img = image::RgbImage::new(16, 16);
        img.fill(90);
        img.save(&p).unwrap();
        let m = XmpMeta::from_str(r#"<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:tiff="http://ns.adobe.com/tiff/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/"
 tiff:Make="FUJIFILM" tiff:Model="X-T30 II" tiff:Orientation="6" exif:DateTimeOriginal="2026-07-22T17:17:34" exif:FNumber="28/10"
 exif:ExposureTime="1/250" exif:PixelXDimension="6240" exif:GPSLatitude="51,22.5N" exif:GPSLongitude="1,26.1E"/>
</rdf:RDF></x:xmpmeta>"#).unwrap();
        embed(&p, &m).unwrap();
        p
    }

    fn request(source: &Path, include: Include) -> Request {
        let mut meta = Meta { keywords: vec!["Places|UK|Kent".into(), "People|Sam".into(), "Beach".into()], ..Default::default() };
        meta.set("copyright", "© 2026 Oli");
        meta.set("creator", "Oli");
        meta.set("email", "o@example.com");
        meta.set("city", "Margate");
        meta.set("title", "Low tide");
        Request { source: source.to_string_lossy().into(), include, remove_person: false, remove_location: false, hierarchy: false, rating: 4, label: Some("green".into()), meta, person_keywords: vec!["People".into()] }
    }

    fn export(dir: &Path, req: &Request, format: Format, name: &str) -> std::path::PathBuf {
        let (w, h) = (8, 6);
        let rgba = vec![128u8; (w * h * 4) as usize];
        let rgb16 = vec![30000u16; (w * h * 3) as usize];
        let rgb16: Vec<u8> = rgb16.iter().flat_map(|v| v.to_ne_bytes()).collect();
        let px = if format.bits() == 16 { Pixels::Rgb16(&rgb16) } else { Pixels::Rgba8(&rgba) };
        let out = dir.join("out");
        let written = write_frame(&out, name, &px, w, h, format, Existing::Rename, None, Some(req)).unwrap();
        assert!(std::fs::read_dir(&out).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().contains("partial")));
        written.path
    }

    fn exif_of(p: &Path) -> Vec<(String, String)> {
        let mut r = std::io::BufReader::new(std::fs::File::open(p).unwrap());
        exif::Reader::new().read_from_container(&mut r).map(|e| e.fields().map(|f| (f.tag.to_string(), f.display_value().to_string())).collect()).unwrap_or_default()
    }

    fn xmp_of(p: &Path) -> XmpMeta {
        let mut f = XmpFile::new().unwrap();
        f.open_file(p, OpenFileOptions::default().for_read().use_smart_handler()).unwrap();
        f.xmp().unwrap()
    }

    #[test]
    fn all_metadata_in_jpeg_tiff_and_png() {
        let dir = tempfile::tempdir().unwrap();
        let src = camera_jpeg(dir.path());
        let req = request(&src, Include::All);
        for (format, name) in [(Format::Jpeg { quality: 90 }, "a"), (Format::Tiff { bits: 16, compression: crate::export::TiffCompression::Lzw }, "b"), (Format::Png { bits: 8 }, "c")] {
            let p = export(dir.path(), &req, format, name);
            let m = xmp_of(&p);
            assert_eq!(m.property(xmp_ns::TIFF, "Make").map(|v| v.value).as_deref(), Some("FUJIFILM"), "{p:?}");
            assert_eq!(m.property(xmp_ns::TIFF, "Orientation").map(|v| v.value).as_deref(), Some("1"), "exports are upright");
            assert!(!m.contains_property(xmp_ns::EXIF, "PixelXDimension"), "the original's size is not the export's");
            let v = crate::xmp::values_of_meta(&m);
            assert_eq!((v.rating, v.label.as_deref()), (4, Some("green")));
            // Without Lightroom hierarchy: each keyword's name, then its parents', once each.
            assert_eq!(v.meta.keywords, vec!["Kent", "Sam", "Beach", "Places", "UK", "People"]);
            assert!(!m.contains_property("http://ns.adobe.com/lightroom/1.0/", "hierarchicalSubject"));
            if !matches!(format, Format::Png { .. }) {
                let exif = exif_of(&p);
                let get = |t: &str| exif.iter().find(|(k, _)| k == t).map(|(_, v)| v.clone());
                assert_eq!(get("Make").as_deref(), Some("\"FUJIFILM\""), "{p:?}: {exif:?}");
                assert!(get("Copyright").is_some_and(|c| c.contains("2026 Oli")), "{exif:?}");
                assert!(get("GPSLatitude").is_some(), "{exif:?}");
                assert!(get("DateTimeOriginal").is_some(), "{exif:?}");
            }
        }
    }

    #[test]
    fn lightrooms_include_choices() {
        let dir = tempfile::tempdir().unwrap();
        let src = camera_jpeg(dir.path());
        let jpeg = Format::Jpeg { quality: 90 };
        let subject = |m: &XmpMeta| m.property_array(xmp_ns::DC, "subject").map(|v| v.value).collect::<Vec<_>>();

        let m = xmp_of(&export(dir.path(), &request(&src, Include::Copyright), jpeg, "c"));
        assert!(m.contains_property(xmp_ns::DC, "rights") && !m.contains_property(xmp_ns::DC, "creator"));
        assert!(!m.contains_property(xmp_ns::TIFF, "Make") && subject(&m).is_empty() && !m.contains_property(xmp_ns::XMP, "Rating"));

        let m = xmp_of(&export(dir.path(), &request(&src, Include::CopyrightContact), jpeg, "cc"));
        assert!(m.contains_property(xmp_ns::DC, "creator") && m.contains_property(xmp_ns::IPTC_CORE, "CreatorContactInfo"));
        assert!(!m.contains_property(xmp_ns::DC, "title") && !m.contains_property(xmp_ns::PHOTOSHOP, "City"));

        let m = xmp_of(&export(dir.path(), &request(&src, Include::AllExceptCamera), jpeg, "ae"));
        assert!(!m.contains_property(xmp_ns::TIFF, "Make") && !m.contains_property(xmp_ns::EXIF, "FNumber"));
        assert!(m.contains_property(xmp_ns::EXIF, "DateTimeOriginal") && m.contains_property(xmp_ns::EXIF, "GPSLatitude"));
        assert!(m.contains_property(xmp_ns::DC, "title") && subject(&m).contains(&"Kent".to_string()));

        let mut req = request(&src, Include::All);
        req.remove_location = true;
        req.remove_person = true;
        req.hierarchy = true;
        let p = export(dir.path(), &req, jpeg, "private");
        let m = xmp_of(&p);
        assert!(!m.contains_property(xmp_ns::EXIF, "GPSLatitude") && !m.contains_property(xmp_ns::PHOTOSHOP, "City"));
        assert!(exif_of(&p).iter().all(|(k, _)| !k.starts_with("GPS")), "no GPS in the EXIF either");
        let s = subject(&m);
        assert!(s.contains(&"Kent".to_string()) && !s.contains(&"Sam".to_string()) && !s.contains(&"People".to_string()), "{s:?}");
        let h: Vec<String> = m.property_array("http://ns.adobe.com/lightroom/1.0/", "hierarchicalSubject").map(|v| v.value).collect();
        assert_eq!(h, vec!["Places|UK|Kent", "Beach"]);
    }

    /// A real Fuji RAF (no toolkit handler): its EXIF comes from the embedded JPEG.
    #[test]
    #[ignore]
    fn raf_camera_data_from_its_preview() {
        let raf = Path::new(&std::env::var("HOME").unwrap()).join("Pictures/1OKK6432.RAF");
        let m = camera_xmp(&raf).expect("camera data");
        assert_eq!(m.property(xmp_ns::TIFF, "Model").map(|v| v.value).as_deref(), Some("X-T30 II"));
        assert!(m.contains_property(EXIF_EX, "LensModel"));
    }
}
