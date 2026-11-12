// SPDX-License-Identifier: GPL-3.0-or-later
//! XMP interchange: stars, colour labels, keywords and IPTC fields shared with other tools
//! through `<name>.xmp` beside the photo, as Lightroom Classic, Bridge and Capture One write it
//! (the extension replaced, so `DSCF0001.RAF` → `DSCF0001.xmp`). Parsing and serialising use
//! Adobe's XMP Toolkit SDK (the `xmp_toolkit` crate, BSD), the reference implementation that
//! Lightroom and exiv2 are built on.
//!
//! - **Ownership.** One `<stem>.xmp` serves every file of that stem, so it belongs to one photo:
//!   a RAW over a DNG over anything else (Lightroom's RAW+JPEG pairs), and nobody when two files
//!   tie (two cameras' RAWs of the same name). A file that doesn't own it neither reads nor
//!   writes it; its marks stay in its `.emulsion.json`.
//! - **Writing** touches only the fields that changed and keeps everything else in the file
//!   (Lightroom's develop settings, darktable's history, other namespaces), then stamps
//!   `xmp:MetadataDate`. Nothing is ever written into a photo.
//! - **Reading.** `<stem>.xmp` (any case of `.xmp`); without it, darktable's `<name>.xmp` is read
//!   but never written. `read_embedded` reads the XMP inside JPEG, TIFF, DNG and RAW files.
//!
//! Lightroom's colour label names are written (`Red`, `Yellow`, `Green`, `Blue`); a label
//! Emulsion doesn't have (`Purple`, a custom set's name) reads as none and is left in the file
//! until another label replaces it. A reject flag is `xmp:Rating` -1, as Bridge and darktable write it
//! and Lightroom reads it; the photo's stars stay in Emulsion's sidecar while it is rejected and
//! go back into the XMP when it no longer is. A pick has no standard field and stays in the sidecar.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::UNIX_EPOCH;
use xmp_toolkit::{xmp_ns, OpenFileOptions, ToStringOptions, XmpDateTime, XmpFile, XmpMeta, XmpValue};

use crate::library::{classify, Kind};

/// Lightroom's namespace, for its keyword hierarchy (`lr:hierarchicalSubject`).
const LR: &str = "http://ns.adobe.com/lightroom/1.0/";
const PHOTOSHOP: &str = xmp_ns::PHOTOSHOP;
const IPTC: &str = xmp_ns::IPTC_CORE;

/// Lightroom's default label set, in Emulsion's order.
const LABELS: &[(&str, &str)] = &[("red", "Red"), ("yellow", "Yellow"), ("green", "Green"), ("blue", "Blue"), ("purple", "Purple")];

/// Where one IPTC field lives in XMP, as Lightroom Classic's Metadata panel writes it.
#[derive(Clone, Copy)]
enum Place {
    /// A simple property.
    Text(&'static str, &'static str),
    /// A language alternative (`x-default` read and written; other languages are dropped on a write).
    LangAlt(&'static str, &'static str),
    /// An array, shown with its items joined by `; ` (`true`: ordered, a `Seq`).
    List(&'static str, &'static str, bool),
    /// A field of `Iptc4xmpCore:CreatorContactInfo`.
    Contact(&'static str),
    /// `xmpRights:Marked`: `copyrighted` (True), `public` (False, public domain) or unset (unknown).
    Marked,
}

/// Every field Emulsion edits, by its id in `.emulsion.json` and the webview (`library/meta.ts`).
/// Lightroom's IPTC set: contact, content, image, status and copyright.
const FIELDS: &[(&str, Place)] = &[
    ("title", Place::LangAlt(xmp_ns::DC, "title")),
    ("caption", Place::LangAlt(xmp_ns::DC, "description")),
    ("headline", Place::Text(PHOTOSHOP, "Headline")),
    ("subjectCode", Place::List(IPTC, "SubjectCode", false)),
    ("captionWriter", Place::Text(PHOTOSHOP, "CaptionWriter")),
    ("creator", Place::List(xmp_ns::DC, "creator", true)),
    ("jobTitle", Place::Text(PHOTOSHOP, "AuthorsPosition")),
    ("address", Place::Contact("CiAdrExtadr")),
    ("contactCity", Place::Contact("CiAdrCity")),
    ("contactState", Place::Contact("CiAdrRegion")),
    ("postalCode", Place::Contact("CiAdrPcode")),
    ("contactCountry", Place::Contact("CiAdrCtry")),
    ("phone", Place::Contact("CiTelWork")),
    ("email", Place::Contact("CiEmailWork")),
    ("website", Place::Contact("CiUrlWork")),
    ("dateCreated", Place::Text(PHOTOSHOP, "DateCreated")),
    ("genre", Place::Text(IPTC, "IntellectualGenre")),
    ("sceneCode", Place::List(IPTC, "Scene", false)),
    ("location", Place::Text(IPTC, "Location")),
    ("city", Place::Text(PHOTOSHOP, "City")),
    ("state", Place::Text(PHOTOSHOP, "State")),
    ("country", Place::Text(PHOTOSHOP, "Country")),
    ("countryCode", Place::Text(IPTC, "CountryCode")),
    ("jobId", Place::Text(PHOTOSHOP, "TransmissionReference")),
    ("instructions", Place::Text(PHOTOSHOP, "Instructions")),
    ("credit", Place::Text(PHOTOSHOP, "Credit")),
    ("source", Place::Text(PHOTOSHOP, "Source")),
    ("copyright", Place::LangAlt(xmp_ns::DC, "rights")),
    ("copyrightStatus", Place::Marked),
    ("usageTerms", Place::LangAlt(xmp_ns::XMP_RIGHTS, "UsageTerms")),
    ("copyrightUrl", Place::Text(xmp_ns::XMP_RIGHTS, "WebStatement")),
];

const CONTACT: &str = "CreatorContactInfo";

/// Keywords and IPTC fields: what Lightroom's Keywording and Metadata panels edit. `fields`
/// holds the set ones by their `FIELDS` id (flattened in JSON: `{ "keywords": [], "title": ... }`).
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Meta {
    /// The keywords, in the order given. A keyword with parents is its path from the top,
    /// separated by `|` as in `lr:hierarchicalSubject` (`Places|UK|Kent`).
    pub keywords: Vec<String>,
    #[serde(flatten)]
    pub fields: BTreeMap<String, String>,
}

impl Meta {
    pub fn is_empty(&self) -> bool {
        self.keywords.is_empty() && self.fields.values().all(|v| v.trim().is_empty())
    }

    /// One field's value, empty when unset.
    pub fn get(&self, id: &str) -> &str {
        self.fields.get(id).map(String::as_str).unwrap_or("")
    }

    pub fn set(&mut self, id: &str, value: impl Into<String>) {
        let value = value.into();
        if value.is_empty() { self.fields.remove(id); } else { self.fields.insert(id.to_string(), value); }
    }

    /// Trimmed, unknown and empty fields dropped, empty and repeated keywords dropped
    /// (case-insensitively, the first kept).
    pub fn tidy(&self) -> Meta {
        let mut keywords: Vec<String> = Vec::new();
        for k in &self.keywords {
            let k = tidy_path(k);
            if !k.is_empty() && !keywords.iter().any(|x| x.to_lowercase() == k.to_lowercase()) {
                keywords.push(k);
            }
        }
        let mut out = Meta { keywords, fields: BTreeMap::new() };
        for (id, place) in FIELDS {
            let v = self.get(id).trim();
            let v = match place {
                Place::Marked => match v { "copyrighted" | "public" => v, _ => "" },
                _ => v,
            };
            out.set(id, v);
        }
        out
    }
}

/// A keyword path with each level trimmed and empty levels dropped.
pub fn tidy_path(k: &str) -> String {
    k.split('|').map(str::trim).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("|")
}

/// `dc:subject` for keywords: each keyword's name and its parents' names, once each, as
/// Lightroom writes them (its default, Include on Export, for every level).
fn subjects(keywords: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut add = |s: &str| {
        if !out.iter().any(|x| x.to_lowercase() == s.to_lowercase()) {
            out.push(s.to_string());
        }
    };
    for k in keywords {
        add(k.rsplit('|').next().unwrap_or(k));
    }
    for k in keywords {
        for level in k.split('|') {
            add(level);
        }
    }
    out
}

/// The keywords an XMP holds: Lightroom's paths, then any `dc:subject` that no path names.
fn keywords_of(m: &XmpMeta) -> Vec<String> {
    let paths: Vec<String> = items(m, LR, "hierarchicalSubject").iter().map(|p| tidy_path(p)).filter(|p| !p.is_empty()).collect();
    let named: std::collections::HashSet<String> = paths.iter().flat_map(|p| p.split('|').map(str::to_lowercase).collect::<Vec<_>>()).collect();
    let flat = items(m, xmp_ns::DC, "subject").into_iter().filter(|s| !named.contains(&s.trim().to_lowercase()));
    paths.into_iter().chain(flat).collect()
}

/// What Emulsion shares through XMP for one photo.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Interchange {
    /// Stars, 0 to 5; 0 while rejected, since the XMP's Rating then holds -1.
    pub rating: u8,
    pub label: Option<String>,
    /// Rejected: `xmp:Rating` -1.
    #[serde(default)]
    pub reject: bool,
    pub meta: Meta,
}

impl Interchange {
    pub fn is_empty(&self) -> bool {
        self.rating == 0 && self.label.is_none() && !self.reject && self.meta.is_empty()
    }
}

fn stem_key(p: &Path) -> Option<String> {
    Some(p.file_stem()?.to_string_lossy().to_lowercase())
}

/// How strongly a file claims its stem's XMP: higher wins, a tie means nobody.
fn claim(p: &Path) -> u8 {
    let dng = p.extension().is_some_and(|e| e.eq_ignore_ascii_case("dng"));
    match classify(p) {
        Kind::Raw if !dng => 3,
        Kind::Raw => 2,
        Kind::Raster => 1,
        Kind::Other => 0,
    }
}

/// Whether `image` owns its stem's XMP among the photo files in its folder (`siblings` may
/// include `image` itself and files of other stems).
pub fn owns<'a>(image: &Path, siblings: impl IntoIterator<Item = &'a Path>) -> bool {
    let (Some(key), mine) = (stem_key(image), claim(image)) else { return false };
    if mine == 0 {
        return false;
    }
    let name = image.file_name();
    siblings.into_iter().filter(|s| s.file_name() != name && stem_key(s).as_ref() == Some(&key)).all(|s| claim(s) < mine)
}

/// `<stem>.xmp` beside `image`, preferring one that exists in any case of the extension.
fn stem_path(image: &Path) -> PathBuf {
    let lower = image.with_extension("xmp");
    if lower.exists() {
        return lower;
    }
    let upper = image.with_extension("XMP");
    if upper.exists() { upper } else { lower }
}

/// The XMP sidecar `image` reads and writes, or `None` when another file of its stem owns it.
/// Looks at the folder; `scan` uses `owns` with the listing it already has.
pub fn sidecar_for(image: &Path) -> Option<PathBuf> {
    let dir = image.parent()?;
    let siblings: Vec<PathBuf> = fs::read_dir(dir).ok()?.filter_map(|e| e.ok().map(|e| e.path())).collect();
    owns(image, siblings.iter().map(PathBuf::as_path)).then(|| stem_path(image))
}

/// Darktable's sidecar, `<name>.<ext>.xmp`: read when there is no `<stem>.xmp`.
fn darktable_path(image: &Path) -> PathBuf {
    let mut s = image.as_os_str().to_owned();
    s.push(".xmp");
    PathBuf::from(s)
}

/// Whether `image` has an XMP sidecar to read, its own or darktable's.
pub fn has_sidecar(image: &Path) -> bool {
    sidecar_for(image).is_some_and(|p| p.exists()) || darktable_path(image).exists()
}

pub fn mtime_ms(p: &Path) -> Option<u64> {
    let t = fs::metadata(p).ok()?.modified().ok()?;
    Some(t.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

/// A sidecar found for `image`: what it says, when it last changed, and whether it is the one
/// Emulsion writes (`false` for darktable's).
pub struct Found {
    pub values: Interchange,
    pub mtime: u64,
    pub own: bool,
}

/// Read the XMP sidecar of `image`, given whether `image` owns its stem's (`owns`).
pub fn read_sidecar(image: &Path, owner: bool) -> Option<Found> {
    if owner {
        let p = stem_path(image);
        if let Some(found) = read_file(&p, true) {
            return Some(found);
        }
    }
    read_file(&darktable_path(image), false)
}

fn read_file(p: &Path, own: bool) -> Option<Found> {
    let text = fs::read_to_string(p).ok()?;
    if !text.contains("rdf:RDF") {
        return None;
    }
    let m = XmpMeta::from_str(&text).ok()?;
    Some(Found { values: values_of(&m), mtime: mtime_ms(p)?, own })
}

/// The XMP inside `image` (JPEG, TIFF, DNG, most RAWs), if it has any.
pub fn read_embedded(image: &Path) -> Option<Interchange> {
    let mut f = XmpFile::new().ok()?;
    let base = || OpenFileOptions::default().for_read().only_xmp();
    if f.open_file(image, base().use_smart_handler()).is_err() {
        f = XmpFile::new().ok()?;
        f.open_file(image, base().use_packet_scanning()).ok()?;
    }
    let m = f.xmp();
    f.close();
    m.map(|m| values_of(&m))
}

fn text(m: &XmpMeta, ns: &str, name: &str) -> String {
    m.property(ns, name).map(|v| v.value.trim().to_string()).unwrap_or_default()
}

fn lang_alt(m: &XmpMeta, ns: &str, name: &str) -> String {
    m.localized_text(ns, name, None, "x-default").map(|(v, _)| v.value.trim().to_string()).unwrap_or_default()
}

fn items(m: &XmpMeta, ns: &str, name: &str) -> Vec<String> {
    m.property_array(ns, name).map(|v| v.value).collect()
}

fn joined(values: Vec<String>) -> String {
    values.iter().map(|s| s.trim()).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("; ")
}

fn read_field(m: &XmpMeta, place: Place) -> String {
    match place {
        Place::Text(ns, name) => text(m, ns, name),
        Place::LangAlt(ns, name) => lang_alt(m, ns, name),
        Place::List(ns, name, _) => joined(items(m, ns, name)),
        Place::Contact(field) => m.struct_field(IPTC, CONTACT, IPTC, field).map(|v| v.value.trim().to_string()).unwrap_or_default(),
        Place::Marked => match text(m, xmp_ns::XMP_RIGHTS, "Marked").to_lowercase().as_str() {
            "true" => "copyrighted".into(),
            "false" => "public".into(),
            _ => String::new(),
        },
    }
}

/// Stars, label, keywords and fields of an XMP packet (an exported file's, in tests).
#[cfg(test)]
pub fn values_of_meta(m: &XmpMeta) -> Interchange {
    values_of(m)
}

fn values_of(m: &XmpMeta) -> Interchange {
    let rating = m.property(xmp_ns::XMP, "Rating").and_then(|v| v.value.trim().parse::<f64>().ok()).unwrap_or(0.0);
    let label = m.property(xmp_ns::XMP, "Label").and_then(|v| label_id(&v.value));
    let mut meta = Meta { keywords: keywords_of(m), fields: BTreeMap::new() };
    for (id, place) in FIELDS {
        meta.set(id, read_field(m, *place));
    }
    let meta = meta.tidy();
    let reject = rating < 0.0;
    Interchange { rating: if reject { 0 } else { rating.round().clamp(0.0, 5.0) as u8 }, label, reject, meta }
}

fn label_id(name: &str) -> Option<String> {
    LABELS.iter().find(|(_, n)| n.eq_ignore_ascii_case(name.trim())).map(|(id, _)| id.to_string())
}

fn label_name(id: &str) -> Option<&'static str> {
    LABELS.iter().find(|(i, _)| *i == id).map(|(_, n)| *n)
}

fn err(e: impl std::fmt::Display) -> io::Error {
    io::Error::other(e.to_string())
}

fn set_text(m: &mut XmpMeta, ns: &str, name: &str, value: &str) -> io::Result<()> {
    if value.is_empty() { m.delete_property(ns, name) } else { m.set_property(ns, name, &value.into()) }.map_err(err)
}

fn set_lang_alt(m: &mut XmpMeta, ns: &str, name: &str, value: &str) -> io::Result<()> {
    // Replaced whole: other languages' text would no longer describe the photo.
    m.delete_property(ns, name).map_err(err)?;
    if value.is_empty() { Ok(()) } else { m.set_localized_text(ns, name, None, "x-default", value).map_err(err) }
}

fn set_items(m: &mut XmpMeta, ns: &str, name: &str, values: &[String], ordered: bool) -> io::Result<()> {
    m.delete_property(ns, name).map_err(err)?;
    let array = XmpValue::new(name.to_string()).set_is_array(true).set_is_ordered(ordered);
    for v in values {
        m.append_array_item(ns, &array, &v.as_str().into()).map_err(err)?;
    }
    Ok(())
}

fn write_field(m: &mut XmpMeta, place: Place, value: &str) -> io::Result<()> {
    match place {
        Place::Text(ns, name) => set_text(m, ns, name, value),
        Place::LangAlt(ns, name) => set_lang_alt(m, ns, name, value),
        Place::List(ns, name, ordered) => {
            let values: Vec<String> = value.split(';').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
            if values.is_empty() { m.delete_property(ns, name).map_err(err) } else { set_items(m, ns, name, &values, ordered) }
        }
        Place::Contact(field) => {
            if value.is_empty() {
                if m.contains_struct_field(IPTC, CONTACT, IPTC, field) { m.delete_struct_field(IPTC, CONTACT, IPTC, field).map_err(err)?; }
                Ok(())
            } else {
                m.set_struct_field(IPTC, CONTACT, IPTC, field, &value.into()).map_err(err)
            }
        }
        Place::Marked => set_text(m, xmp_ns::XMP_RIGHTS, "Marked", match value { "copyrighted" => "True", "public" => "False", _ => "" }),
    }
}

/// Set `want` on `m`, touching only what differs from what it holds. Returns whether anything
/// changed.
fn apply(m: &mut XmpMeta, want: &Interchange) -> io::Result<bool> {
    let have = values_of(m);
    let want = Interchange { meta: want.meta.tidy(), ..want.clone() };
    let mut changed = false;
    let rating = |i: &Interchange| if i.reject { -1 } else { i.rating.min(5) as i32 };
    if rating(&want) != rating(&have) {
        set_text(m, xmp_ns::XMP, "Rating", &match rating(&want) { 0 => String::new(), r => r.to_string() })?;
        changed = true;
    }
    if want.label != have.label {
        set_text(m, xmp_ns::XMP, "Label", want.label.as_deref().and_then(label_name).unwrap_or(""))?;
        changed = true;
    }
    let (w, h) = (&want.meta, &have.meta);
    if w.keywords != h.keywords {
        if w.keywords.is_empty() { m.delete_property(xmp_ns::DC, "subject").map_err(err)? } else { set_items(m, xmp_ns::DC, "subject", &subjects(&w.keywords), false)? }
        // Lightroom's paths when any keyword has parents; flat keywords are their own paths.
        if w.keywords.iter().any(|k| k.contains('|')) {
            set_items(m, LR, "hierarchicalSubject", &w.keywords, false)?;
        } else if m.contains_property(LR, "hierarchicalSubject") {
            m.delete_property(LR, "hierarchicalSubject").map_err(err)?;
        }
        changed = true;
    }
    for (id, place) in FIELDS {
        let (wv, hv) = (w.get(id), h.get(id));
        if wv != hv {
            write_field(m, *place, wv)?;
            changed = true;
        }
    }
    // A contact block whose last field was cleared goes too.
    if FIELDS.iter().all(|(id, p)| !matches!(p, Place::Contact(_)) || w.get(id).is_empty()) && m.contains_property(IPTC, CONTACT) {
        m.delete_property(IPTC, CONTACT).map_err(err)?;
    }
    if changed {
        if let Ok(now) = XmpDateTime::current() {
            m.set_property_date(xmp_ns::XMP, "MetadataDate", &now.into()).map_err(err)?;
        }
    }
    Ok(changed)
}

/// Set `values` on `m` (a new packet for an exported file). Lightroom's keyword paths are
/// written only with `hierarchy` (its Write Keywords as Lightroom Hierarchy).
pub fn fill(m: &mut XmpMeta, values: &Interchange, hierarchy: bool) -> io::Result<()> {
    XmpMeta::register_namespace(LR, "lr").map_err(err)?;
    apply(m, values)?;
    if !hierarchy && m.contains_property(LR, "hierarchicalSubject") {
        m.delete_property(LR, "hierarchicalSubject").map_err(err)?;
    }
    Ok(())
}

/// Write `values` into `image`'s XMP sidecar, keeping everything else in it. Returns the
/// sidecar's modified time afterwards, or `None` when `image` has no sidecar of its own (another
/// file owns its stem) or there is nothing to say and no file yet. A file that can't be parsed
/// is left alone (an error), never replaced.
pub fn write(image: &Path, values: &Interchange) -> io::Result<Option<u64>> {
    let Some(target) = sidecar_for(image) else { return Ok(None) };
    write_to(&target, values)
}

fn write_to(target: &Path, values: &Interchange) -> io::Result<Option<u64>> {
    let mut m = match fs::read_to_string(target) {
        // The toolkit reads text without RDF as empty XMP, which a write would replace.
        Ok(text) if !text.contains("rdf:RDF") => return Err(err(format!("{} is not XMP", target.display()))),
        Ok(text) => XmpMeta::from_str(&text).map_err(|e| err(format!("{} is not readable XMP: {e}", target.display())))?,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            if values.is_empty() {
                return Ok(None);
            }
            XmpMeta::new().map_err(err)?
        }
        Err(e) => return Err(e),
    };
    XmpMeta::register_namespace(LR, "lr").map_err(err)?;
    if apply(&mut m, values)? {
        let text = m.to_string_with_options(ToStringOptions::default().omit_packet_wrapper().set_newline("\n".into())).map_err(err)?;
        let mut tmp = target.as_os_str().to_owned();
        tmp.push(".tmp");
        let tmp = PathBuf::from(tmp);
        fs::write(&tmp, text)?;
        fs::rename(&tmp, target)?;
    }
    Ok(mtime_ms(target))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> PathBuf {
        PathBuf::from(s)
    }

    fn some(rating: u8, label: Option<&str>, keywords: &[&str]) -> Interchange {
        Interchange { rating, label: label.map(Into::into), reject: false, meta: Meta { keywords: keywords.iter().map(|s| s.to_string()).collect(), ..Meta::default() } }
    }

    #[test]
    fn a_raw_owns_its_stem_over_its_jpeg() {
        let files = [p("/a/X.RAF"), p("/a/X.JPG"), p("/a/Y.jpg")];
        let s = || files.iter().map(PathBuf::as_path);
        assert!(owns(&files[0], s()));
        assert!(!owns(&files[1], s()));
        assert!(owns(&files[2], s()));
        // Two RAWs of one name: nobody.
        let twins = [p("/a/X.RAF"), p("/a/X.CR3")];
        assert!(!owns(&twins[0], twins.iter().map(PathBuf::as_path)));
        // A DNG yields to a camera RAW but not to a JPEG.
        let dng = [p("/a/X.dng"), p("/a/x.jpg")];
        assert!(owns(&dng[0], dng.iter().map(PathBuf::as_path)));
        assert_eq!(stem_path(Path::new("/a/X.RAF")), p("/a/X.xmp"));
    }

    #[test]
    fn writes_and_reads_back_in_lightrooms_fields() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("DSCF0001.RAF");
        fs::write(&img, b"x").unwrap();
        let mut v = some(4, Some("green"), &["Beach", "Family", "beach"]);
        v.meta.set("title", "Low tide");
        v.meta.set("caption", "Morning, before the rain");
        v.meta.set("creator", "Oli; Sam");
        v.meta.set("copyright", "© 2026");
        v.meta.set("city", "Margate");
        v.meta.set("country", "United Kingdom");
        assert!(write(&img, &v).unwrap().is_some());
        let text = fs::read_to_string(dir.path().join("DSCF0001.xmp")).unwrap();
        assert!(text.contains("xmp:Rating=\"4\"") || text.contains("<xmp:Rating>4</xmp:Rating>"), "{text}");
        assert!(text.contains("Green"), "{text}");
        let back = read_sidecar(&img, true).unwrap();
        assert!(back.own);
        assert_eq!(back.values.rating, 4);
        assert_eq!(back.values.label.as_deref(), Some("green"));
        assert_eq!(back.values.meta.keywords, vec!["Beach", "Family"]);
        assert_eq!(back.values.meta.get("creator"), "Oli; Sam");
        assert_eq!(back.values.meta, v.meta.tidy());
    }

    #[test]
    fn keyword_paths_round_trip_as_lightroom_writes_them() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("h.RAF");
        fs::write(&img, b"x").unwrap();
        write(&img, &some(0, None, &[" Places | UK|Kent ", "Beach", "places|uk|kent"])).unwrap();
        let m = XmpMeta::from_str(&fs::read_to_string(dir.path().join("h.xmp")).unwrap()).unwrap();
        assert_eq!(items(&m, xmp_ns::DC, "subject"), vec!["Kent", "Beach", "Places", "UK"]);
        assert_eq!(items(&m, LR, "hierarchicalSubject"), vec!["Places|UK|Kent", "Beach"]);
        assert_eq!(read_sidecar(&img, true).unwrap().values.meta.keywords, vec!["Places|UK|Kent", "Beach"]);
        // No parents left: plain dc:subject and no hierarchy.
        write(&img, &some(0, None, &["Beach"])).unwrap();
        let text = fs::read_to_string(dir.path().join("h.xmp")).unwrap();
        assert!(!text.contains("hierarchicalSubject") && !text.contains("Kent"), "{text}");
    }

    #[test]
    fn writes_lightrooms_iptc_set() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("f.RAF");
        fs::write(&img, b"x").unwrap();
        let mut v = some(0, None, &[]);
        for (id, value) in [
            ("headline", "Storm"), ("jobTitle", "Photographer"), ("email", "a@b.c"), ("contactCity", "Deal"),
            ("copyrightStatus", "copyrighted"), ("usageTerms", "Editorial only"), ("copyrightUrl", "https://x.y"),
            ("sceneCode", "011900; 011000"), ("countryCode", "GBR"), ("credit", "Oli"), ("dateCreated", "2026-11-11"),
        ] {
            v.meta.set(id, value);
        }
        write(&img, &v).unwrap();
        let text = fs::read_to_string(dir.path().join("f.xmp")).unwrap();
        for s in ["photoshop:Headline", "Iptc4xmpCore:CreatorContactInfo", "Iptc4xmpCore:CiEmailWork", "xmpRights:Marked", "True", "xmpRights:UsageTerms", "Iptc4xmpCore:Scene", "photoshop:AuthorsPosition"] {
            assert!(text.contains(s), "{s} in {text}");
        }
        assert_eq!(read_sidecar(&img, true).unwrap().values.meta, v.meta.tidy());
        // Public domain is False; clearing the contact fields removes the block.
        v.meta.set("copyrightStatus", "public");
        v.meta.set("email", "");
        v.meta.set("contactCity", "");
        write(&img, &v).unwrap();
        let text = fs::read_to_string(dir.path().join("f.xmp")).unwrap();
        assert!(text.contains("False") && !text.contains("CreatorContactInfo"), "{text}");
        let back = read_sidecar(&img, true).unwrap().values.meta;
        assert_eq!((back.get("copyrightStatus"), back.get("email")), ("public", ""));
        // An unknown status or field is dropped.
        let mut odd = Meta::default();
        odd.set("copyrightStatus", "maybe");
        odd.set("nonsense", "x");
        assert!(odd.tidy().is_empty());
    }

    #[test]
    fn keeps_what_other_tools_wrote() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("a.nef");
        fs::write(&img, b"x").unwrap();
        // A Lightroom sidecar: develop settings, a keyword hierarchy, a custom label, a reject.
        fs::write(
            dir.path().join("a.xmp"),
            r#"<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:lr="http://ns.adobe.com/lightroom/1.0/"
 xmp:Rating="-1" xmp:Label="To Print" crs:Exposure2012="+0.35">
<dc:subject><rdf:Bag><rdf:li>Places</rdf:li><rdf:li>Kent</rdf:li><rdf:li>Dog</rdf:li></rdf:Bag></dc:subject>
<lr:hierarchicalSubject><rdf:Bag><rdf:li>Places|Kent</rdf:li><rdf:li>Animals|Dog</rdf:li></rdf:Bag></lr:hierarchicalSubject>
</rdf:Description></rdf:RDF></x:xmpmeta>"#,
        )
        .unwrap();
        let found = read_sidecar(&img, true).unwrap();
        assert_eq!((found.values.rating, found.values.reject), (0, true), "a reject reads as a reject flag");
        assert_eq!(found.values.label, None, "a custom Lightroom label is not an Emulsion label");
        // Drop Dog, add a title: the reject, the custom label and the develop settings stay.
        assert_eq!(found.values.meta.keywords, vec!["Places|Kent", "Animals|Dog"], "Lightroom's paths are the keywords");
        let mut want = found.values.clone();
        want.meta.keywords = vec!["Places|Kent".into()];
        want.meta.set("title", "Harbour");
        write(&img, &want).unwrap();
        let text = fs::read_to_string(dir.path().join("a.xmp")).unwrap();
        assert!(text.contains("Exposure2012") && text.contains("+0.35"), "{text}");
        assert!(text.contains("To Print") && text.contains("-1"), "{text}");
        assert!(text.contains("Places|Kent") && !text.contains("Animals|Dog") && !text.contains(">Dog<"), "{text}");
        assert!(text.contains("MetadataDate"), "{text}");
        assert_eq!(read_sidecar(&img, true).unwrap().values.meta.get("title"), "Harbour");
        // A label replaces the custom one; the reject stays until it is cleared.
        want.label = Some("red".into());
        write(&img, &want).unwrap();
        let text = fs::read_to_string(dir.path().join("a.xmp")).unwrap();
        assert!(text.contains("Red") && !text.contains("To Print") && text.contains("-1"), "{text}");
        // Purple, Lightroom's fifth colour, is written and read back as itself.
        want.label = Some("purple".into());
        write(&img, &want).unwrap();
        assert!(fs::read_to_string(dir.path().join("a.xmp")).unwrap().contains("Purple"));
        assert_eq!(read_sidecar(&img, true).unwrap().values.label.as_deref(), Some("purple"));
    }

    #[test]
    fn nothing_to_say_writes_nothing_and_a_jpeg_twin_never_writes() {
        let dir = tempfile::tempdir().unwrap();
        let jpg = dir.path().join("b.jpg");
        fs::write(&jpg, b"x").unwrap();
        assert_eq!(write(&jpg, &Interchange::default()).unwrap(), None);
        assert!(!dir.path().join("b.xmp").exists());
        fs::write(dir.path().join("b.ARW"), b"x").unwrap();
        assert_eq!(write(&jpg, &some(3, None, &[])).unwrap(), None);
        assert!(!dir.path().join("b.xmp").exists());
    }

    #[test]
    fn an_unreadable_sidecar_is_never_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("c.cr3");
        fs::write(&img, b"x").unwrap();
        fs::write(dir.path().join("c.xmp"), b"not xml <").unwrap();
        assert!(write(&img, &some(2, None, &[])).is_err());
        assert_eq!(fs::read(dir.path().join("c.xmp")).unwrap(), b"not xml <");
    }

    #[test]
    fn reads_darktables_sidecar_when_there_is_no_other() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("d.ORF");
        fs::write(&img, b"x").unwrap();
        write_to(&dir.path().join("d.ORF.xmp"), &some(5, None, &["dt"])).unwrap();
        let found = read_sidecar(&img, true).unwrap();
        assert!(!found.own);
        assert_eq!(found.values.rating, 5);
    }

    #[test]
    fn reads_xmp_embedded_in_a_jpeg() {
        // A minimal JPEG with an APP1 XMP segment.
        let xmp = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="3" xmp:Label="Blue"/></rdf:RDF></x:xmpmeta>"#;
        let mut img = image::RgbImage::new(8, 8);
        img.fill(128);
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpeg).encode_image(&img).unwrap();
        let header = b"http://ns.adobe.com/xap/1.0/\0";
        let len = (2 + header.len() + xmp.len()) as u16;
        let mut out = jpeg[..2].to_vec();
        out.extend_from_slice(&[0xFF, 0xE1]);
        out.extend_from_slice(&len.to_be_bytes());
        out.extend_from_slice(header);
        out.extend_from_slice(xmp.as_bytes());
        out.extend_from_slice(&jpeg[2..]);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("e.jpg");
        fs::write(&path, out).unwrap();
        let v = read_embedded(&path).unwrap();
        assert_eq!((v.rating, v.label.as_deref()), (3, Some("blue")));
        assert!(read_embedded(&dir.path().join("missing.jpg")).is_none());
    }
}
