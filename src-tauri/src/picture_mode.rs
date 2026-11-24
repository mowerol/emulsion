// SPDX-License-Identifier: GPL-3.0-or-later
//! The black and white (or sepia) picture mode a camera recorded in a RAW's maker note, so an
//! unedited RAW shot in black and white opens in black and white, as a Fujifilm RAW opens with
//! its film simulation (`lens::fuji_simulation`). The tag numbers and values are file-format
//! facts from ExifTool's tag tables (exiftool.org/TagNames: Panasonic, Olympus, Sony, Pentax,
//! Nikon, Canon); no ExifTool code is used. Every read is bounded: no tag, directory or file
//! region larger than READ_MAX is loaded, and only a few directories are followed.
use std::{
    cell::RefCell,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

/// What the camera recorded, by the names `SIMULATION_LOOKS` (src/film/looks.ts) maps to looks:
/// plain black and white, a high-contrast black and white, or sepia.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Bw,
    BwDynamic,
    Sepia,
}

impl Mode {
    pub fn name(self) -> &'static str {
        match self {
            Mode::Bw => "bw",
            Mode::BwDynamic => "bw-dynamic",
            Mode::Sepia => "sepia",
        }
    }
}

const READ_MAX: usize = 1 << 16;

struct Source {
    file: RefCell<File>,
    len: u64,
}

impl Source {
    fn read(&self, offset: u64, size: usize) -> Option<Vec<u8>> {
        if size > READ_MAX || offset.checked_add(size as u64)? > self.len {
            return None;
        }
        let mut out = vec![0; size];
        let mut file = self.file.borrow_mut();
        file.seek(SeekFrom::Start(offset)).ok()?;
        file.read_exact(&mut out).ok()?;
        Some(out)
    }
}

/// A TIFF-style directory reader: offsets are relative to `base`, in the given byte order.
#[derive(Clone, Copy)]
struct Tiff<'a> {
    src: &'a Source,
    base: u64,
    le: bool,
}

#[derive(Clone, Debug)]
struct Entry {
    id: u16,
    typ: u16,
    count: u32,
    /// The value's absolute position in the file.
    at: u64,
    size: usize,
    /// The value field itself (an offset when the value doesn't fit).
    field: u32,
}

impl<'a> Tiff<'a> {
    fn u16(&self, b: &[u8]) -> u16 {
        if self.le { u16::from_le_bytes([b[0], b[1]]) } else { u16::from_be_bytes([b[0], b[1]]) }
    }
    fn u32(&self, b: &[u8]) -> u32 {
        let a = [b[0], b[1], b[2], b[3]];
        if self.le { u32::from_le_bytes(a) } else { u32::from_be_bytes(a) }
    }
    /// A TIFF header at `base` (II or MM; standard, Olympus ORF and Panasonic RW2 signatures).
    fn header(src: &'a Source, base: u64) -> Option<(Self, u32)> {
        let h = src.read(base, 8)?;
        let le = match &h[..2] {
            b"II" => true,
            b"MM" => false,
            _ => return None,
        };
        let t = Tiff { src, base, le };
        [42, 0x4f52, 0x5352, 0x55].contains(&t.u16(&h[2..4])).then_some((t, t.u32(&h[4..8])))
    }
    /// The entries of the directory at `offset` (relative to base) and the next one's offset.
    fn dir(&self, offset: u64) -> Option<(Vec<Entry>, u32)> {
        let pos = self.base.checked_add(offset)?;
        let n = self.u16(&self.src.read(pos, 2)?) as usize;
        if n == 0 || n > 512 {
            return None;
        }
        let bytes = self.src.read(pos + 2, n * 12 + 4)?;
        let entries = bytes[..n * 12].chunks_exact(12).enumerate().filter_map(|(i, b)| {
            let typ = self.u16(&b[2..4]);
            let unit = match typ {
                1 | 2 | 6 | 7 => 1,
                3 | 8 => 2,
                4 | 9 | 11 | 13 => 4,
                5 | 10 | 12 => 8,
                _ => return None,
            };
            let count = self.u32(&b[4..8]);
            let size = (count as usize).checked_mul(unit)?;
            let field = self.u32(&b[8..12]);
            let at = if size <= 4 { pos + 2 + (i * 12) as u64 + 8 } else { self.base.checked_add(field as u64)? };
            Some(Entry { id: self.u16(b), typ, count, at, size, field })
        }).collect();
        Some((entries, self.u32(&bytes[n * 12..])))
    }
    fn bytes(&self, e: &Entry, max: usize) -> Option<Vec<u8>> {
        self.src.read(e.at, e.size.min(max))
    }
    /// The `i`th number of an integer entry.
    fn num(&self, e: &Entry, i: usize) -> Option<i64> {
        let unit = match e.typ {
            1 | 6 | 7 => 1,
            3 | 8 => 2,
            4 | 9 | 13 => 4,
            _ => return None,
        };
        if i >= e.count as usize {
            return None;
        }
        let b = self.src.read(e.at + (i * unit) as u64, unit)?;
        Some(match e.typ {
            1 | 7 => b[0] as i64,
            6 => b[0] as i8 as i64,
            3 => self.u16(&b) as i64,
            8 => self.u16(&b) as i16 as i64,
            4 | 13 => self.u32(&b) as i64,
            _ => self.u32(&b) as i32 as i64,
        })
    }
    fn text(&self, e: &Entry) -> String {
        let b = self.bytes(e, 64).unwrap_or_default();
        String::from_utf8_lossy(b.split(|c| *c == 0).next().unwrap_or_default()).trim().to_owned()
    }
}

fn find(dir: &[Entry], id: u16) -> Option<&Entry> {
    dir.iter().find(|e| e.id == id)
}

/// The black and white or sepia mode the camera recorded in the RAW at `path`, if any. Fujifilm
/// RAFs are read by `lens::fuji_simulation` instead.
pub fn read(path: &Path) -> Option<Mode> {
    let file = File::open(path).ok()?;
    let src = Source { len: file.metadata().ok()?.len(), file: RefCell::new(file) };
    let head = src.read(0, 16)?;
    // Canon CR3 (ISO media): the maker note is the TIFF in the CMT3 box, near the start.
    if &head[4..8] == b"ftyp" && &head[8..12] == b"crx " {
        let start = src.read(0, READ_MAX.min(src.len as usize))?;
        let at = start.windows(4).position(|w| w == b"CMT3")? as u64 + 4;
        let (t, first) = Tiff::header(&src, at)?;
        return canon(t, &t.dir(first as u64)?.0);
    }
    let (t, first) = Tiff::header(&src, 0)?;
    let mut make = String::new();
    let mut note = None;
    let mut private = None;
    let mut pending = vec![(t, first as u64)];
    let mut seen = 0;
    while let Some((t, offset)) = pending.pop() {
        seen += 1;
        if seen > 24 || offset == 0 {
            continue;
        }
        let Some((dir, next)) = t.dir(offset) else { continue };
        if next != 0 && t.base == 0 && seen < 4 {
            pending.push((t, next as u64));
        }
        for e in &dir {
            match e.id {
                0x10f if make.is_empty() => make = t.text(e).to_uppercase(),
                // EXIF and SubIFDs (an ARW's or a DNG's maker note can sit under either).
                0x8769 | 0x14a => {
                    for i in 0..(e.count as usize).min(4) {
                        if let Some(o) = t.num(e, i) {
                            pending.push((t, o as u64));
                        }
                    }
                }
                // A Panasonic RW2's EXIF lives in its embedded JPEG.
                0x2e if t.base == 0 && e.size > 4 => {
                    if let Some(exif) = jpeg_exif(&src, e.at) {
                        pending.push(exif);
                    }
                }
                0x927c if note.is_none() => note = Some((t, e.clone())),
                0xc634 if private.is_none() => private = Some((t, e.clone())),
                _ => {}
            }
        }
    }
    if let Some((t, e)) = note {
        return maker_note(&make, t, &e);
    }
    dng_private(&make, private?)
}

/// The TIFF in a JPEG's EXIF segment, the JPEG starting at `at`.
fn jpeg_exif(src: &Source, at: u64) -> Option<(Tiff<'_>, u64)> {
    let mut pos = at + 2;
    for _ in 0..32 {
        let h = src.read(pos, 4)?;
        if h[0] != 0xff || matches!(h[1], 0xda | 0xd9) {
            return None;
        }
        let len = u16::from_be_bytes([h[2], h[3]]) as u64;
        if h[1] == 0xe1 && src.read(pos + 4, 6)? == b"Exif\0\0" {
            let (t, first) = Tiff::header(src, pos + 10)?;
            return Some((t, first as u64));
        }
        pos += 2 + len;
    }
    None
}

/// A maker note at `e` (in TIFF `t`), by the camera's make.
fn maker_note(make: &str, t: Tiff, e: &Entry) -> Option<Mode> {
    let h = t.bytes(e, 16)?;
    let at = e.at;
    let le_at = |i: usize| match h.get(i..i + 2)? {
        b"II" => Some(true),
        b"MM" => Some(false),
        _ => None,
    };
    let rel = |base: u64, le: bool| Tiff { src: t.src, base, le };
    if h.starts_with(b"Panasonic\0\0\0") {
        return panasonic(t, &t.dir(at - t.base + 12)?.0);
    }
    if h.starts_with(b"OLYMPUS\0") {
        let o = rel(at, le_at(8)?);
        return olympus(o, &o.dir(12)?.0);
    }
    if h.starts_with(b"OM SYSTEM\0\0\0") {
        let o = rel(at, le_at(12)?);
        return olympus(o, &o.dir(16)?.0);
    }
    if h.starts_with(b"Nikon\0") {
        let (n, first) = Tiff::header(t.src, at + 10)?;
        return nikon(n, &n.dir(first as u64)?.0);
    }
    if h.starts_with(b"AOC\0") {
        // Offsets relative to the enclosing TIFF; byte order at 4 ("  " means the file's).
        let n = Tiff { le: le_at(4).unwrap_or(t.le), ..t };
        return pentax(n, &n.dir(at - t.base + 6)?.0);
    }
    if h.starts_with(b"PENTAX \0") {
        let n = rel(at, le_at(8)?);
        return pentax(n, &n.dir(10)?.0);
    }
    if h.starts_with(b"SONY") {
        return sony(t, &t.dir(at - t.base + 12)?.0);
    }
    // Sony (most bodies) and Canon start the directory straight away.
    if make.starts_with("SONY") {
        return sony(t, &t.dir(at - t.base)?.0);
    }
    if make.starts_with("CANON") {
        return canon(t, &t.dir(at - t.base)?.0);
    }
    None
}

/// A DNG's DNGPrivateData: Adobe's copy of the original maker note (any camera converted to
/// DNG), or a Ricoh GR's own Pentax-style note.
fn dng_private(make: &str, (t, e): (Tiff, Entry)) -> Option<Mode> {
    let h = t.bytes(&e, 20)?;
    if h.starts_with(b"RICOH\0") || h.starts_with(b"PENTAX \0") {
        let skip = if h.starts_with(b"RICOH\0") { 6 } else { 8 };
        let le = match &h[skip..skip + 2] {
            b"II" => true,
            b"MM" => false,
            _ => return None,
        };
        let n = Tiff { src: t.src, base: e.at, le };
        return pentax(n, &n.dir(skip as u64 + 2)?.0);
    }
    // "Adobe\0", "MakN", count (4, big endian), byte order (2), original offset (4), note.
    if !h.starts_with(b"Adobe\0MakN") {
        return None;
    }
    let le = match &h[14..16] {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let original = u32::from_be_bytes(h[16..20].try_into().ok()?) as u64;
    let start = e.at + 20;
    let size = u32::from_be_bytes(h[10..14].try_into().ok()?).saturating_sub(6) as usize;
    // The note's offsets were relative to the original file's TIFF, `original` bytes before it.
    let base = start.checked_sub(original)?;
    let t = Tiff { src: t.src, base, le };
    let note = Entry { id: 0x927c, typ: 7, count: size as u32, at: start, size, field: original as u32 };
    maker_note(make, t, &note)
}

/// Panasonic: FilmMode (0x0042) on older bodies like the LX3, PhotoStyle (0x0089) on newer ones,
/// ColorEffect (0x0028), and the Monochrome scene/shooting mode (0x001f).
fn panasonic(t: Tiff, d: &[Entry]) -> Option<Mode> {
    let v = |id| find(d, id).and_then(|e| t.num(e, 0));
    match v(0x0089) {
        Some(4 | 11) => return Some(Mode::Bw),
        Some(15) => return Some(Mode::BwDynamic),
        _ => {}
    }
    match v(0x0042) {
        Some(5 | 7) => return Some(Mode::Bw),
        Some(6) => return Some(Mode::BwDynamic),
        _ => {}
    }
    match v(0x0028) {
        Some(4) => return Some(Mode::Bw),
        Some(5) => return Some(Mode::Sepia),
        _ => {}
    }
    (v(0x001f) == Some(89)).then_some(Mode::Bw)
}

/// Olympus and OM System: CameraSettings (0x2020) PictureMode (0x0520; Monochrome Profiles,
/// Monotone, Sepia) with its tone (0x0526), and the monochrome art filters (0x0529, 0x052f).
fn olympus(t: Tiff, d: &[Entry]) -> Option<Mode> {
    let e = find(d, 0x2020)?;
    let offset = if e.typ == 7 { e.at - t.base } else { e.field as u64 };
    let (cs, _) = t.dir(offset)?;
    let v = |id, i| find(&cs, id).and_then(|e| t.num(e, i));
    match v(0x0520, 0) {
        Some(512) => return Some(Mode::Sepia),
        Some(12 | 13 | 14 | 18 | 256) => {
            let sepia = v(0x0526, 0) == Some(2) || v(0x053b, 0) == Some(2);
            return Some(if sepia { Mode::Sepia } else { Mode::Bw });
        }
        _ => {}
    }
    match v(0x0529, 0) {
        Some(14) => return Some(Mode::Sepia),
        Some(6 | 19 | 32) => return Some(Mode::BwDynamic),
        _ => {}
    }
    (v(0x052f, 4) == Some(0x8060)).then_some(Mode::Bw)
}

/// Sony: CreativeStyle (0xb020, text), else ColorMode (0xb029), and the monochrome picture
/// effects (0x200e).
fn sony(t: Tiff, d: &[Entry]) -> Option<Mode> {
    if let Some(e) = find(d, 0xb020).filter(|e| e.typ == 2) {
        match t.text(e).as_str() {
            "BW" => return Some(Mode::Bw),
            "Sepia" => return Some(Mode::Sepia),
            _ => {}
        }
    }
    match find(d, 0x200e).and_then(|e| t.num(e, 0)) {
        Some(13) => return Some(Mode::BwDynamic),
        Some(80) => return Some(Mode::Bw),
        _ => {}
    }
    match find(d, 0xb029).and_then(|e| t.num(e, 0)) {
        Some(6) => Some(Mode::Bw),
        Some(17) => Some(Mode::Sepia),
        _ => None,
    }
}

/// Pentax and Ricoh: ImageTone (0x004f; the custom image or Ricoh GR image control).
fn pentax(t: Tiff, d: &[Entry]) -> Option<Mode> {
    match find(d, 0x004f).and_then(|e| t.num(e, 0))? {
        5 | 258 | 259 => Some(Mode::Bw),
        260 | 261 => Some(Mode::BwDynamic),
        _ => None,
    }
}

/// Nikon: PictureControlData (0x0023): the Picture Control's base, and its toning.
fn nikon(t: Tiff, d: &[Entry]) -> Option<Mode> {
    let b = t.bytes(find(d, 0x0023)?, 128)?;
    // Versions 01xx and 02xx put the base at 24 and toning at 56 or 64; 03xx at 28 and 72.
    let (base, toning) = match b.get(..2)? {
        b"01" => (24, 56),
        b"02" => (24, 64),
        b"03" => (28, 72),
        _ => return None,
    };
    let text = |at: usize| b.get(at..at + 20).map(|s| String::from_utf8_lossy(s.split(|c| *c == 0).next().unwrap_or_default()).to_uppercase());
    let name = text(base)?;
    if !name.contains("MONOCHROME") {
        return None;
    }
    Some(match b.get(toning) {
        Some(0x81) => Mode::Sepia,
        _ if name.contains("DEEP") => Mode::BwDynamic,
        _ => Mode::Bw,
    })
}

/// Canon: PictureStyle (ProcessingInfo 0x00a0, index 10; a user style counts by its base,
/// 0x4008), or on older bodies PhotoEffect (CameraSettings 0x0001, index 40).
fn canon(t: Tiff, d: &[Entry]) -> Option<Mode> {
    const MONOCHROME: i64 = 0x86;
    let style = find(d, 0x00a0).and_then(|e| t.num(e, 10));
    let user = |i| find(d, 0x4008).and_then(|e| t.num(e, i));
    match style {
        Some(MONOCHROME) => return Some(Mode::Bw),
        Some(s @ 0x21..=0x23) if user(s as usize - 0x21) == Some(MONOCHROME) => return Some(Mode::Bw),
        _ => {}
    }
    match find(d, 0x0001).and_then(|e| t.num(e, 40)) {
        Some(5) => Some(Mode::Bw),
        Some(4) => Some(Mode::Sepia),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// A little-endian TIFF: IFD0 with Make, then an EXIF IFD whose maker note is `note`
    /// (laid out by `make_note`, which gets the note's absolute offset).
    fn file(make: &str, make_note: impl Fn(u32) -> Vec<u8>) -> tempfile::NamedTempFile {
        let mut b = b"II*\0\x08\0\0\0".to_vec();
        let make_at = 8 + 2 + 2 * 12 + 4;
        let mut make_bytes = make.as_bytes().to_vec();
        make_bytes.push(0);
        let exif_at = make_at + make_bytes.len() as u32;
        let note_at = exif_at + 2 + 12 + 4;
        let note = make_note(note_at);
        b.extend(2u16.to_le_bytes());
        for (id, typ, count, value) in [(0x10fu16, 2u16, make_bytes.len() as u32, make_at), (0x8769, 4, 1, exif_at)] {
            b.extend(id.to_le_bytes());
            b.extend(typ.to_le_bytes());
            b.extend(count.to_le_bytes());
            b.extend(value.to_le_bytes());
        }
        b.extend(0u32.to_le_bytes());
        b.extend(&make_bytes);
        b.extend(1u16.to_le_bytes());
        b.extend(0x927cu16.to_le_bytes());
        b.extend(7u16.to_le_bytes());
        b.extend((note.len() as u32).to_le_bytes());
        b.extend(note_at.to_le_bytes());
        b.extend(0u32.to_le_bytes());
        b.extend(note);
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(&b).unwrap();
        f
    }

    /// A little-endian directory at `at` (absolute) of short values, with any larger values
    /// after it; `rel` is what its offsets are relative to.
    fn dir(at: u32, rel: u32, tags: &[(u16, u16, Vec<u8>)]) -> Vec<u8> {
        let mut b = Vec::new();
        let mut extra: Vec<u8> = Vec::new();
        let extra_at = at + 2 + tags.len() as u32 * 12 + 4;
        b.extend((tags.len() as u16).to_le_bytes());
        for (id, typ, value) in tags {
            let unit = match typ { 3 | 8 => 2, 4 | 13 => 4, _ => 1 };
            b.extend(id.to_le_bytes());
            b.extend(typ.to_le_bytes());
            b.extend(((value.len() / unit) as u32).to_le_bytes());
            if value.len() <= 4 {
                let mut v = value.clone();
                v.resize(4, 0);
                b.extend(v);
            } else {
                b.extend((extra_at + extra.len() as u32 - rel).to_le_bytes());
                extra.extend(value);
            }
        }
        b.extend(0u32.to_le_bytes());
        b.extend(extra);
        b
    }

    fn shorts(v: &[u16]) -> Vec<u8> {
        v.iter().flat_map(|v| v.to_le_bytes()).collect()
    }

    fn panasonic_file(tags: &[(u16, u16, Vec<u8>)]) -> Option<Mode> {
        let f = file("Panasonic", |at| [b"Panasonic\0\0\0".to_vec(), dir(at + 12, 0, tags)].concat());
        read(f.path())
    }

    #[test]
    fn reads_panasonic_film_mode_photo_style_and_colour_effect() {
        // The LX3 records Dynamic B&W in both FilmMode and ColorEffect.
        assert_eq!(panasonic_file(&[(0x28, 3, shorts(&[4])), (0x42, 3, shorts(&[6]))]), Some(Mode::BwDynamic));
        assert_eq!(panasonic_file(&[(0x42, 3, shorts(&[5]))]), Some(Mode::Bw));
        assert_eq!(panasonic_file(&[(0x28, 3, shorts(&[5]))]), Some(Mode::Sepia));
        assert_eq!(panasonic_file(&[(0x89, 3, shorts(&[11]))]), Some(Mode::Bw));
        assert_eq!(panasonic_file(&[(0x89, 3, shorts(&[15]))]), Some(Mode::BwDynamic));
        // Nostalgic, colour effect off: colour.
        assert_eq!(panasonic_file(&[(0x28, 3, shorts(&[1])), (0x42, 3, shorts(&[10]))]), None);
    }

    fn olympus_file(settings: &[(u16, u16, Vec<u8>)]) -> Option<Mode> {
        let f = file("OM Digital Solutions", |at| {
            let mut note = b"OM SYSTEM\0\0\0II\x04\0".to_vec();
            // Main directory at 16 with one entry, CameraSettings (IFD) at 16 + 18.
            note.extend(dir(at + 16, at, &[(0x2020, 13, (16u32 + 18).to_le_bytes().to_vec())]));
            note.extend(dir(at + 34, at, settings));
            note
        });
        read(f.path())
    }

    #[test]
    fn reads_olympus_picture_mode_and_art_filters() {
        assert_eq!(olympus_file(&[(0x520, 3, shorts(&[256, 2]))]), Some(Mode::Bw));
        assert_eq!(olympus_file(&[(0x520, 3, shorts(&[12, 0]))]), Some(Mode::Bw));
        assert_eq!(olympus_file(&[(0x520, 3, shorts(&[256, 2])), (0x526, 8, shorts(&[2]))]), Some(Mode::Sepia));
        assert_eq!(olympus_file(&[(0x520, 3, shorts(&[512, 2]))]), Some(Mode::Sepia));
        assert_eq!(olympus_file(&[(0x520, 3, shorts(&[2, 2])), (0x529, 3, shorts(&[19, 0, 0, 0]))]), Some(Mode::BwDynamic));
        // Natural, with the monochrome profile's own settings stored but not in use (OM-3).
        assert_eq!(olympus_file(&[(0x520, 3, shorts(&[2, 2])), (0x537, 8, shorts(&[3, 0, 0, 0, 0, 0])), (0x53b, 8, shorts(&[1]))]), None);
    }

    #[test]
    fn reads_sony_creative_style() {
        let sony = |tags: &[(u16, u16, Vec<u8>)]| {
            let f = file("SONY", |at| dir(at, 0, tags));
            read(f.path())
        };
        assert_eq!(sony(&[(0xb020, 2, b"BW\0".to_vec())]), Some(Mode::Bw));
        assert_eq!(sony(&[(0xb020, 2, b"Sepia\0".to_vec())]), Some(Mode::Sepia));
        assert_eq!(sony(&[(0xb020, 2, b"Standard\0".to_vec()), (0xb029, 4, 0u32.to_le_bytes().to_vec())]), None);
        assert_eq!(sony(&[(0xb029, 4, 6u32.to_le_bytes().to_vec())]), Some(Mode::Bw));
        assert_eq!(sony(&[(0x200e, 3, shorts(&[13]))]), Some(Mode::BwDynamic));
    }

    #[test]
    fn reads_canon_picture_style() {
        let canon = |tags: &[(u16, u16, Vec<u8>)]| {
            let f = file("Canon", |at| dir(at, 0, tags));
            read(f.path())
        };
        let mut processing = vec![0u16; 16];
        processing[10] = 0x86;
        assert_eq!(canon(&[(0xa0, 8, shorts(&processing))]), Some(Mode::Bw));
        processing[10] = 0x22;
        assert_eq!(canon(&[(0xa0, 8, shorts(&processing)), (0x4008, 3, shorts(&[0x81, 0x86, 0x81]))]), Some(Mode::Bw));
        processing[10] = 0x81;
        assert_eq!(canon(&[(0xa0, 8, shorts(&processing))]), None);
    }

    #[test]
    fn reads_nikon_picture_control() {
        let nikon = |data: Vec<u8>| {
            let f = file("NIKON CORPORATION", |_| {
                let mut note = b"Nikon\0\x02\x10\0\0II*\0\x08\0\0\0".to_vec();
                note.extend(dir(8, 0, &[(0x23, 7, data.clone())]));
                note
            });
            read(f.path())
        };
        let control = |version: &[u8], base_at: usize, name: &str, toning_at: usize, toning: u8| {
            let mut b = vec![0u8; 80];
            b[..4].copy_from_slice(version);
            b[base_at..base_at + name.len()].copy_from_slice(name.as_bytes());
            b[toning_at] = toning;
            b
        };
        assert_eq!(nikon(control(b"0100", 24, "MONOCHROME", 56, 0x80)), Some(Mode::Bw));
        assert_eq!(nikon(control(b"0310", 28, "MONOCHROME", 72, 0x81)), Some(Mode::Sepia));
        assert_eq!(nikon(control(b"0310", 28, "DEEP TONE MONOCHROME", 72, 0x80)), Some(Mode::BwDynamic));
        assert_eq!(nikon(control(b"0200", 24, "STANDARD", 64, 0x80)), None);
    }

    #[test]
    #[ignore = "set EMULSION_MODE_SAMPLES to RAW paths separated by :"]
    fn real_picture_modes() {
        for path in std::env::var("EMULSION_MODE_SAMPLES").expect("sample paths").split(':') {
            println!("{path}: {:?}", read(Path::new(path)));
        }
    }
}
