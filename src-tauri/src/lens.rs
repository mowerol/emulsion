// Copyright (C) 2009-2026 darktable developers (metadata extraction).
// Copyright (C) 2011-2023 darktable developers (DNG opcodes).
// SPDX-License-Identifier: GPL-3.0-or-later
//! Bounded TIFF/maker-note readers for darktable's embedded lens metadata v2.
//! Source: darktable common/exif.cc and common/dng_opcode.c at 20891f6c.
use serde::Serialize;
use std::{
    cell::RefCell,
    collections::HashSet,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Correction {
    Fuji {
        knots: Vec<f64>,
        distortion: Vec<f64>,
        red: Vec<f64>,
        blue: Vec<f64>,
        vignette: Vec<f64>,
        crop: f64,
    },
    Sony {
        distortion: Vec<f64>,
        red: Vec<f64>,
        blue: Vec<f64>,
        vignette: Vec<f64>,
    },
    Olympus {
        distortion: Option<Vec<f64>>,
        ca: Option<Vec<f64>>,
    },
    Dng {
        warp: Option<Vec<Vec<f64>>>,
        vignette: Option<Vec<f64>>,
    },
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LensMetadata {
    pub camera: String,
    pub camera_to_working: Option<[[f32; 3]; 3]>,
    pub orientation: u16,
    pub lens: String,
    pub correction: Option<Correction>,
    pub unsupported: Option<String>,
}
struct Data {
    file: RefCell<File>,
    len: u64,
}
impl Data {
    fn read(&self, offset: u64, size: usize) -> Option<Vec<u8>> {
        if size > 1_048_576 || offset.checked_add(size as u64)? > self.len {
            return None;
        }
        let mut out = vec![0; size];
        let mut file = self.file.borrow_mut();
        file.seek(SeekFrom::Start(offset)).ok()?;
        file.read_exact(&mut out).ok()?;
        Some(out)
    }
}
#[derive(Clone, Copy)]
struct Tiff<'a> {
    data: &'a Data,
    base: u64,
    le: bool,
}
#[derive(Clone)]
struct Tag {
    id: u16,
    typ: u16,
    count: usize,
    value: Vec<u8>,
    offset: u64,
}
impl<'a> Tiff<'a> {
    fn u16(&self, b: &[u8]) -> u16 {
        let a = [b[0], b[1]];
        if self.le {
            u16::from_le_bytes(a)
        } else {
            u16::from_be_bytes(a)
        }
    }
    fn u32(&self, b: &[u8]) -> u32 {
        let a = [b[0], b[1], b[2], b[3]];
        if self.le {
            u32::from_le_bytes(a)
        } else {
            u32::from_be_bytes(a)
        }
    }
    fn at(data: &'a Data, base: u64) -> Option<(Self, u32)> {
        let h = data.read(base, 8)?;
        let le = match &h[..2] {
            b"II" => true,
            b"MM" => false,
            _ => return None,
        };
        let t = Self { data, base, le };
        // Standard TIFF plus Olympus ORF's TIFF signatures.
        if ![42, 0x4f52, 0x5352].contains(&t.u16(&h[2..4])) {
            return None;
        }
        Some((t, t.u32(&h[4..8])))
    }
    fn tags(&self, offset: u32) -> Option<(Vec<Tag>, u32)> {
        let pos = self.base.checked_add(offset as u64)?;
        let n = self.u16(&self.data.read(pos, 2)?) as usize;
        if n > 512 {
            return None;
        }
        let bytes = self.data.read(pos + 2, n * 12 + 4)?;
        let mut tags = Vec::new();
        for (index, b) in bytes[..n * 12].chunks_exact(12).enumerate() {
            let typ = self.u16(&b[2..4]);
            let count = self.u32(&b[4..8]) as usize;
            let unit: usize = match typ {
                1 | 2 | 6 | 7 => 1,
                3 | 8 => 2,
                4 | 9 | 11 | 13 => 4,
                5 | 10 | 12 => 8,
                _ => continue,
            };
            let size = unit.checked_mul(count)?;
            // Only metadata used here, never pixel strips or opaque camera data.
            let id = self.u16(b);
            if !matches!(
                id,
                0x10f
                    | 0x110
                    | 0x112
                    | 0x14a
                    | 0x8769
                    | 0x927c
                    | 0xa434
                    | 0xf000
                    | 0xf00b
                    | 0xf00f
                    | 0xf010
                    | 0x7032
                    | 0x7035
                    | 0x7037
                    | 0xc74e
                    | 0x104d
                    | 0x2040
                    | 0x150a
                    | 0x150c
                    | 0x2010
                    | 0x0203
            ) {
                continue;
            }
            let address = if size <= 4 {
                pos + 2 + (index * 12) as u64 + 8
            } else {
                self.base.checked_add(self.u32(&b[8..12]) as u64)?
            };
            let value = if size <= 4 {
                b[8..8 + size].to_vec()
            } else {
                match self
                    .data
                    .read(address, if id == 0x927c { size.min(32) } else { size })
                {
                    Some(v) => v,
                    None => continue,
                }
            };
            tags.push(Tag {
                id,
                typ,
                count,
                value,
                offset: address,
            });
        }
        Some((tags, self.u32(&bytes[n * 12..])))
    }
    fn numbers(&self, tag: &Tag) -> Option<Vec<f64>> {
        let unit = match tag.typ {
            1 | 6 => 1,
            3 | 8 => 2,
            4 | 9 | 11 | 13 => 4,
            5 | 10 | 12 => 8,
            _ => return None,
        };
        let mut out = Vec::new();
        for b in tag.value.chunks_exact(unit) {
            let v = match tag.typ {
                1 => b[0] as f64,
                6 => (b[0] as i8) as f64,
                3 => self.u16(b) as f64,
                8 => (self.u16(b) as i16) as f64,
                4 | 13 => self.u32(b) as f64,
                9 => (self.u32(b) as i32) as f64,
                11 => f32::from_bits(self.u32(b)) as f64,
                5 => {
                    let d = self.u32(&b[4..]);
                    if d == 0 {
                        return None;
                    }
                    self.u32(b) as f64 / d as f64
                }
                10 => {
                    let d = self.u32(&b[4..]) as i32;
                    if d == 0 {
                        return None;
                    }
                    (self.u32(b) as i32) as f64 / d as f64
                }
                12 => {
                    let a: [u8; 8] = b.try_into().ok()?;
                    f64::from_bits(if self.le {
                        u64::from_le_bytes(a)
                    } else {
                        u64::from_be_bytes(a)
                    })
                }
                _ => return None,
            };
            if !v.is_finite() {
                return None;
            }
            out.push(v);
        }
        (out.len() == tag.count).then_some(out)
    }
}
fn text(tag: &Tag) -> String {
    String::from_utf8_lossy(&tag.value)
        .trim_matches('\0')
        .trim()
        .to_string()
}
fn values(t: &Tiff, tags: &[Tag], id: u16) -> Option<Vec<f64>> {
    t.numbers(tags.iter().find(|x| x.id == id)?)
}
fn fuji(t: &Tiff, tags: &[Tag], crop: f64) -> Option<Correction> {
    let d = values(t, tags, 0xf00b)?;
    let c = values(t, tags, 0xf00f)?;
    let v = values(t, tags, 0xf010)?;
    let n = match (d.len(), c.len(), v.len()) {
        (19, 29, 19) => 9,
        (23, 31, 23) => 11,
        _ => return None,
    };
    let knots = d[1..=n].to_vec();
    if knots.windows(2).any(|k| k[1] <= k[0]) || knots[0] < 0.0 || knots[n - 1] > 4.0 {
        return None;
    }
    let mut red = Vec::new();
    let mut blue = Vec::new();
    for i in 0..n {
        let kc = if n == 9 {
            c[i + 1]
        } else if i == 0 {
            0.0
        } else {
            c[i]
        };
        if (knots[i] - kc).abs() > 1e-6 || (knots[i] - v[i + 1]).abs() > 1e-6 {
            return None;
        }
        red.push(if n == 9 {
            c[i + 10]
        } else if i == 0 {
            0.0
        } else {
            c[i + 10]
        });
        blue.push(if n == 9 {
            c[i + 19]
        } else if i == 0 {
            0.0
        } else {
            c[i + 20]
        });
    }
    Some(Correction::Fuji {
        knots,
        distortion: d[n + 1..].to_vec(),
        red,
        blue,
        vignette: v[n + 1..].to_vec(),
        crop,
    })
}
fn sony(t: &Tiff, tags: &[Tag]) -> Option<Correction> {
    let d = values(t, tags, 0x7037)?;
    let c = values(t, tags, 0x7035)?;
    let v = values(t, tags, 0x7032)?;
    let n = *d.first()? as usize;
    if !(2..=16).contains(&n)
        || d.len() < n + 1
        || c.len() < 2 * n + 1
        || v.len() < n + 1
        || c[0] != 2.0 * n as f64
        || v[0] != n as f64
    {
        return None;
    }
    Some(Correction::Sony {
        distortion: d[1..=n].to_vec(),
        red: c[1..=n].to_vec(),
        blue: c[n + 1..=2 * n].to_vec(),
        vignette: v[1..=n].to_vec(),
    })
}
fn olympus(t: &Tiff, tags: &[Tag]) -> Option<Correction> {
    let distortion = values(t, tags, 0x150a).filter(|v| v.len() == 4);
    let ca = values(t, tags, 0x150c).filter(|v| v.len() == 6);
    if distortion.is_none() && ca.is_none() {
        return None;
    }
    Some(Correction::Olympus { distortion, ca })
}
fn dng(bytes: &[u8]) -> Result<Option<Correction>, String> {
    fn long(b: &[u8], i: usize) -> Option<u32> {
        Some(u32::from_be_bytes(b.get(i..i + 4)?.try_into().ok()?))
    }
    fn doubles(b: &[u8]) -> Option<Vec<f64>> {
        let v: Vec<_> = b
            .chunks_exact(8)
            .map(|b| f64::from_be_bytes(b.try_into().unwrap()))
            .collect();
        v.iter().all(|v| v.is_finite()).then_some(v)
    }
    let parse = || -> Option<Result<Option<Correction>, String>> {
        let count = long(bytes, 0)?;
        if count > 128 {
            return None;
        }
        let mut pos = 4;
        let mut warp = None;
        let mut vignette = None;
        for _ in 0..count {
            let id = long(bytes, pos)?;
            let flags = long(bytes, pos + 8)?;
            let len = long(bytes, pos + 12)? as usize;
            pos += 16;
            let b = bytes.get(pos..pos.checked_add(len)?)?;
            pos += len;
            match id {
                1 => {
                    let planes = long(b, 0)? as usize;
                    if planes != 1 && planes != 3 {
                        return None;
                    }
                    if b.len() != 4 + planes * 48 + 16 {
                        return None;
                    }
                    let v = doubles(&b[4..])?;
                    if v[planes * 6..].iter().any(|v| (*v - 0.5).abs() > 1e-6)
                        || v[..planes * 6]
                            .chunks_exact(6)
                            .any(|v| v[4] != 0.0 || v[5] != 0.0)
                    {
                        return Some(Err(
                            "Off-centre or tangential DNG warp is not supported".into()
                        ));
                    }
                    warp = Some(
                        v[..planes * 6]
                            .chunks_exact(6)
                            .map(|v| v[..4].to_vec())
                            .collect(),
                    );
                }
                3 => {
                    if b.len() != 56 {
                        return None;
                    }
                    let v = doubles(b)?;
                    if v[5..].iter().any(|v| (*v - 0.5).abs() > 1e-6) {
                        return Some(Err("Off-centre DNG vignette is not supported".into()));
                    }
                    vignette = Some(v[..5].to_vec());
                }
                _ => {
                    if flags & 1 == 0 {
                        return Some(Err(format!("Unsupported mandatory DNG opcode {id}")));
                    }
                }
            }
        }
        Some(Ok(if warp.is_some() || vignette.is_some() {
            Some(Correction::Dng { warp, vignette })
        } else {
            None
        }))
    };
    parse().unwrap_or_else(|| Err("Invalid DNG lens opcodes".into()))
}

/// No unbounded file reads, tag allocations or directory recursion. Invalid/unknown profiles
/// do not prevent decoding; unsupported DNG models carry an explanation to the UI.
pub fn read(path: &Path) -> Option<LensMetadata> {
    let file = File::open(path).ok()?;
    let data = Data {
        len: file.metadata().ok()?.len(),
        file: RefCell::new(file),
    };
    let header = data.read(0, 108)?;
    let base = if header.starts_with(b"FUJIFILMCCD-RAW ") {
        u32::from_be_bytes(header[100..104].try_into().ok()?) as u64
    } else {
        0
    };
    let (root, first) = Tiff::at(&data, base)?;
    let mut all = Vec::new();
    let mut visited = HashSet::new();
    let mut pending = vec![(root, first)];
    // RAF's camera/lens EXIF and maker notes live in its embedded JPEG, separate from raw TIFF.
    if base != 0 {
        let jpeg = u32::from_be_bytes(header[84..88].try_into().ok()?) as u64;
        let mut pos = jpeg + 2;
        for _ in 0..128 {
            let Some(h) = data.read(pos, 4) else {
                break;
            };
            if h[0] != 0xff || matches!(h[1], 0xda | 0xd9) {
                break;
            }
            let len = u16::from_be_bytes([h[2], h[3]]) as u64;
            if len < 2 {
                break;
            }
            if h[1] == 0xe1 && data.read(pos + 4, 6).is_some_and(|v| v == b"Exif\0\0") {
                if let Some(exif) = Tiff::at(&data, pos + 10) {
                    pending.push(exif);
                }
            }
            pos += 2 + len;
        }
    }
    while let Some((t, offset)) = pending.pop() {
        if all.len() >= 32 || !visited.insert((t.base, offset)) {
            continue;
        }
        let Some((tags, next)) = t.tags(offset) else {
            continue;
        };
        if next != 0 {
            pending.push((t, next));
        }
        for tag in &tags {
            if matches!(tag.id, 0x14a | 0x8769 | 0xf000 | 0x2040 | 0x2010) {
                if let Some(v) = t.numbers(tag) {
                    for x in v.into_iter().take(16) {
                        pending.push((t, x as u32));
                    }
                }
            }
            if tag.id == 0x927c {
                let h = &tag.value;
                let start = if h.starts_with(b"OM SYSTEM\0\0\0II") {
                    Some(16)
                } else if h.starts_with(b"OLYMPUS\0II") {
                    Some(12)
                } else {
                    None
                };
                if let Some(start) = start {
                    pending.push((
                        Tiff {
                            data: &data,
                            base: tag.offset,
                            le: true,
                        },
                        start,
                    ));
                }
                // Fuji maker note header: offsets relative to FUJIFILM, little endian.
                if h.starts_with(b"FUJIFILM") && h.len() >= 12 {
                    pending.push((
                        Tiff {
                            data: &data,
                            base: tag.offset,
                            le: true,
                        },
                        u32::from_le_bytes(h[8..12].try_into().ok()?),
                    ));
                }
            }
        }
        all.push((t, tags));
    }
    let find_text = |id| {
        all.iter()
            .flat_map(|(_, tags)| tags)
            .find(|tag| tag.id == id)
            .map(text)
            .unwrap_or_default()
    };
    let camera = format!("{} {}", find_text(0x10f), find_text(0x110))
        .trim()
        .to_string();
    let lens = {
        let x = find_text(0xa434);
        if x.is_empty() { find_text(0x0203) } else { x }
    };
    let crop = if all.iter().any(|(t, tags)| {
        values(t, tags, 0x104d).is_some_and(|v| matches!(v.first(), Some(2.0 | 4.0)))
    }) {
        1.25
    } else {
        1.0
    };
    let mut correction = None;
    let mut unsupported = None;
    for (t, tags) in &all {
        if let Some(tag) = tags.iter().find(|tag| tag.id == 0xc74e) {
            match dng(&tag.value) {
                Ok(Some(c)) => correction = Some(c),
                Err(e) => unsupported = Some(e),
                _ => {}
            }
        }
        correction = correction
            .or_else(|| fuji(t, tags, crop))
            .or_else(|| sony(t, tags))
            .or_else(|| olympus(t, tags));
    }
    if unsupported.is_some() {
        correction = None;
    }
    let orientation = all
        .iter()
        .find_map(|(t, tags)| values(t, tags, 0x112).and_then(|v| v.first().copied()))
        .unwrap_or(1.0) as u16;
    Some(LensMetadata {
        camera,
        camera_to_working: None,
        orientation,
        lens,
        correction,
        unsupported,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tiff(tags: Vec<(u16, u16, u32, Vec<u8>)>) -> Vec<u8> {
        let mut bytes = b"II*\0\x08\0\0\0".to_vec();
        let n = tags.len();
        bytes.extend_from_slice(&(n as u16).to_le_bytes());
        bytes.resize(8 + 2 + n * 12 + 4, 0);
        for (i, (id, typ, count, value)) in tags.into_iter().enumerate() {
            let pos = 10 + i * 12;
            bytes[pos..pos + 2].copy_from_slice(&id.to_le_bytes());
            bytes[pos + 2..pos + 4].copy_from_slice(&typ.to_le_bytes());
            bytes[pos + 4..pos + 8].copy_from_slice(&count.to_le_bytes());
            if value.len() <= 4 {
                bytes[pos + 8..pos + 8 + value.len()].copy_from_slice(&value);
            } else {
                let offset = bytes.len() as u32;
                bytes[pos + 8..pos + 12].copy_from_slice(&offset.to_le_bytes());
                bytes.extend(value);
            }
        }
        bytes.resize(bytes.len().max(108), 0);
        bytes
    }
    fn read_bytes(bytes: &[u8]) -> Option<LensMetadata> {
        let f = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(f.path(), bytes).unwrap();
        read(f.path())
    }
    #[test]
    fn fuji_reads_both_table_generations_and_rejects_mismatched_knots() {
        let rational = |v: Vec<f64>| {
            v.into_iter()
                .flat_map(|v| {
                    let mut b = ((v * 1000.0).round() as i32).to_le_bytes().to_vec();
                    b.extend(1000i32.to_le_bytes());
                    b
                })
                .collect::<Vec<u8>>()
        };
        for n in [9, 11] {
            let knots: Vec<f64> = (0..n)
                .map(|i| {
                    if n == 9 {
                        (i + 1) as f64 / 10.0
                    } else {
                        i as f64 / 10.0
                    }
                })
                .collect();
            let mut d = vec![0.0];
            d.extend(&knots);
            d.extend(vec![-2.0; n]);
            let mut v = vec![0.0];
            v.extend(&knots);
            v.extend(vec![90.0; n]);
            let mut c = vec![0.0];
            c.extend(if n == 9 {
                knots.clone()
            } else {
                knots[1..].to_vec()
            });
            c.extend(vec![0.001; if n == 9 { 19 } else { 20 }]);
            let bytes = tiff(vec![
                (0xf00b, 10, d.len() as u32, rational(d)),
                (0xf00f, 10, c.len() as u32, rational(c)),
                (0xf010, 10, v.len() as u32, rational(v)),
            ]);
            match read_bytes(&bytes).unwrap().correction.unwrap() {
                Correction::Fuji { knots: actual, .. } => assert_eq!(actual, knots),
                _ => panic!("Fuji"),
            }
        }
    }
    #[test]
    fn sony_padded_signed_tables_use_active_counts() {
        let array = |values: Vec<i16>| values.into_iter().flat_map(i16::to_le_bytes).collect();
        let bytes = tiff(vec![
            (
                0x7037,
                8,
                17,
                array([vec![2, -12, -30], vec![0; 14]].concat()),
            ),
            (
                0x7035,
                8,
                33,
                array([vec![4, 60, 70, -20, -30], vec![0; 28]].concat()),
            ),
            (
                0x7032,
                8,
                17,
                array([vec![2, 10, 40], vec![0; 14]].concat()),
            ),
        ]);
        match read_bytes(&bytes).unwrap().correction.unwrap() {
            Correction::Sony {
                distortion,
                red,
                blue,
                vignette,
            } => {
                assert_eq!(distortion, vec![-12.0, -30.0]);
                assert_eq!(red, vec![60.0, 70.0]);
                assert_eq!(blue, vec![-20.0, -30.0]);
                assert_eq!(vignette, vec![10.0, 40.0]);
            }
            _ => panic!("Sony profile"),
        }
    }
    #[test]
    fn large_olympus_makernote_is_read_by_offsets_not_loaded_in_full() {
        let mut note = vec![0; 1_800_000];
        note[..16].copy_from_slice(b"OM SYSTEM\0\0\0II\x04\0");
        note[16..18].copy_from_slice(&1u16.to_le_bytes());
        note[18..20].copy_from_slice(&0x2040u16.to_le_bytes());
        note[20..22].copy_from_slice(&13u16.to_le_bytes());
        note[22..26].copy_from_slice(&1u32.to_le_bytes());
        note[26..30].copy_from_slice(&128u32.to_le_bytes());
        note[128..130].copy_from_slice(&1u16.to_le_bytes());
        note[130..132].copy_from_slice(&0x150au16.to_le_bytes());
        note[132..134].copy_from_slice(&11u16.to_le_bytes());
        note[134..138].copy_from_slice(&4u32.to_le_bytes());
        note[138..142].copy_from_slice(&256u32.to_le_bytes());
        for (i, v) in [-0.06f32, 0.03, -0.001, 1.0].iter().enumerate() {
            note[256 + i * 4..260 + i * 4].copy_from_slice(&v.to_le_bytes());
        }
        let bytes = tiff(vec![(0x927c, 7, note.len() as u32, note)]);
        assert!(matches!(
            read_bytes(&bytes).unwrap().correction,
            Some(Correction::Olympus {
                distortion: Some(_),
                ..
            })
        ));
    }
    #[test]
    fn cyclic_and_truncated_directories_do_not_loop_or_panic() {
        let bytes = tiff(vec![(0x8769, 4, 1, 8u32.to_le_bytes().to_vec())]);
        assert!(read_bytes(&bytes).unwrap().correction.is_none());
        for n in [0, 4, 8, 32, 64] {
            assert!(read_bytes(&bytes[..n]).is_none());
        }
    }
    #[test]
    #[ignore = "set EMULSION_LENS_RAW and EMULSION_LENS_PAYLOAD to inspect a real decode"]
    fn decoded_payload() {
        let path = std::env::var("EMULSION_LENS_RAW").unwrap();
        let payload = crate::decode::load_for_engine(Path::new(&path), Some(800)).unwrap();
        assert_ne!(
            u32::from_le_bytes(payload[12..16].try_into().unwrap()) & 2,
            0
        );
        std::fs::write(std::env::var("EMULSION_LENS_PAYLOAD").unwrap(), payload).unwrap();
    }
    #[test]
    #[ignore = "set EMULSION_LENS_SAMPLES to RAW paths separated by :"]
    fn real_metadata() {
        for path in std::env::var("EMULSION_LENS_SAMPLES")
            .expect("sample paths")
            .split(':')
        {
            let metadata = read(Path::new(path)).expect("TIFF metadata");
            assert!(
                metadata.correction.is_some() || metadata.unsupported.is_some(),
                "No corrections: {path}: {metadata:?}"
            );
            println!("{}", serde_json::json!({"path":path,"metadata":metadata}));
        }
    }
    #[test]
    fn rejects_malformed_opcodes_and_unsupported_models() {
        assert!(dng(&[0, 0, 0, 1]).is_err());
        let mut data = 1u32.to_be_bytes().to_vec();
        for x in [1u32, 0x01030000, 0, 68] {
            data.extend(x.to_be_bytes());
        }
        data.extend(1u32.to_be_bytes());
        for x in [1.0f64, 0.0, 0.0, 0.0, 0.1, 0.0, 0.5, 0.5] {
            data.extend(x.to_be_bytes());
        }
        assert!(dng(&data).unwrap_err().contains("tangential"));
        data[56..64].copy_from_slice(&0f64.to_be_bytes());
        assert!(matches!(dng(&data), Ok(Some(Correction::Dng { .. }))));
    }
}
