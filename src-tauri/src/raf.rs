// SPDX-License-Identifier: GPL-3.0-or-later
//! Fuji's composition metadata. All geometry stays separate from the full RAW decode.
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

#[derive(Clone, Debug)]
pub struct RafCrop {
    /// Sensor coordinates: left, top, width, height.
    pub area: [f64; 4],
    pub aspect: Option<(u16, u16)>, // height, width
    pub zoom_active: bool,
    pub zoom: Option<[f64; 4]>, // relative to the camera area
}

fn pair(v: &[u8]) -> Option<(u16, u16)> {
    (v.len() == 4).then(|| {
        (
            u16::from_be_bytes([v[0], v[1]]),
            u16::from_be_bytes([v[2], v[3]]),
        )
    })
}
fn inside(r: [f64; 4], w: f64, h: f64) -> bool {
    r.iter().all(|v| v.is_finite())
        && r[0] >= 0.0
        && r[1] >= 0.0
        && r[2] > 0.0
        && r[3] > 0.0
        && r[0] + r[2] <= w
        && r[1] + r[3] <= h
}

/// Small bounded reads; malformed/unsupported metadata never prevents opening a photo.
pub fn read(path: &Path) -> Option<RafCrop> {
    if !path.extension()?.eq_ignore_ascii_case("raf") {
        return None;
    }
    let mut file = File::open(path).ok()?;
    let mut header = [0u8; 100];
    file.read_exact(&mut header).ok()?;
    if !header.starts_with(b"FUJIFILMCCD-RAW ") {
        return None;
    }
    let start = u32::from_be_bytes(header[92..96].try_into().ok()?) as u64;
    let len = u32::from_be_bytes(header[96..100].try_into().ok()?) as usize;
    if !(4..=1_048_576).contains(&len)
        || start < 100
        || start.checked_add(len as u64)? > file.metadata().ok()?.len()
    {
        return None;
    }
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = vec![0; len];
    file.read_exact(&mut bytes).ok()?;
    let mut c = parse(&bytes)?;
    if c.zoom_active && c.zoom.is_none() {
        let ratio = crate::lens::digital_zoom(path)?;
        let mm = [45u16, 63, 80]
            .into_iter()
            .find(|mm| (ratio / (*mm as f64 / 35.0) - 1.0).abs() < 0.03)?;
        let zoom = nominal_zoom(c.area[2], c.area[3], mm);
        if !inside(zoom, c.area[2], c.area[3]) {
            return None;
        }
        c.zoom = Some(zoom);
        eprintln!(
            "[raw] {}: missing RAF zoom rectangle; using nominal {mm} mm crop",
            path.display()
        );
    }
    Some(c)
}

fn parse(bytes: &[u8]) -> Option<RafCrop> {
    let count = u32::from_be_bytes(bytes.get(..4)?.try_into().ok()?) as usize;
    if count > 512 {
        return None;
    }
    let (mut full, mut origin, mut size, mut aspect, mut zoom_origin, mut zoom_size) =
        (None, None, None, None, None, None);
    let mut active = false;
    let mut pos = 4;
    for _ in 0..count {
        let head = bytes.get(pos..pos + 4)?;
        let tag = u16::from_be_bytes([head[0], head[1]]);
        let len = u16::from_be_bytes([head[2], head[3]]) as usize;
        pos += 4;
        let value = bytes.get(pos..pos + len)?;
        pos += len;
        match tag {
            0x100 => full = Some(pair(value)?),
            0x110 => origin = Some(pair(value)?),
            0x111 => size = Some(pair(value)?),
            0x115 => aspect = Some(pair(value)?),
            0x117 => {
                active = match u32::from_be_bytes(value.try_into().ok()?) {
                    0 => false,
                    1 => true,
                    _ => return None,
                }
            }
            0x118 => zoom_origin = Some(pair(value)?),
            0x119 => zoom_size = Some(pair(value)?),
            _ => {} // RAF also contains large unrelated entries; skip without allocating.
        }
    }
    let (fh, fw) = full?;
    if fh > 20000 || fw > 20000 {
        return None;
    }
    let (top, left) = origin?;
    let (h, w) = size?;
    let area = [left as f64, top as f64, w as f64, h as f64];
    if !inside(area, fw as f64, fh as f64) {
        return None;
    }
    let zoom = if active {
        // Like the area tags, the directory stores height/top before width/left.
        match (zoom_origin, zoom_size) {
            (Some((zt, zl)), Some((zh, zw))) => {
                let r = [zl as f64, zt as f64, zw as f64, zh as f64];
                if !inside(r, w as f64, h as f64) {
                    return None;
                }
                Some(r)
            }
            (None, None) => None, // read() may recover from EXIF DigitalZoomRatio.
            _ => return None,
        }
    } else {
        None
    };
    Some(RafCrop {
        area,
        aspect,
        zoom_active: active,
        zoom,
    })
}

fn nominal_zoom(w: f64, h: f64, mm: u16) -> [f64; 4] {
    let factor = mm as f64 / 35.0;
    let zw = (w / factor / 2.0).round() * 2.0;
    let zh = (h / factor / 2.0).round() * 2.0;
    [(w - zw) / 2.0, (h - zh) / 2.0, zw, zh]
}

const ASPECTS: [(u16, u16, f64, f64); 9] = [
    (3, 4, 11648.0, 8736.0),
    (2, 3, 11648.0, 7768.0),
    (9, 16, 11648.0, 6552.0),
    (24, 65, 11648.0, 4304.0),
    (6, 17, 11648.0, 4112.0),
    (4, 5, 10928.0, 8736.0),
    (6, 7, 10192.0, 8736.0),
    (1, 1, 8736.0, 8736.0),
    (4, 3, 6544.0, 8736.0),
];

impl RafCrop {
    /// Pixels relative to the camera's output area, before orientation.
    pub fn frame(&self) -> [f64; 4] {
        let [_, _, cw, ch] = self.area;
        let r = self.zoom.unwrap_or([0.0, 0.0, cw, ch]);
        let Some((ah, aw)) = self.aspect else {
            return r;
        };
        if ah == 0 || aw == 0 {
            return r;
        }
        let ratio = aw as f64 / ah as f64;
        let Some(&(_, _, tw, th)) = ASPECTS
            .iter()
            .find(|&&(h, w, _, _)| ((w as f64 / h as f64) / ratio - 1.0).abs() < 0.01)
        else {
            return r;
        };
        let (w, h) = if self.zoom.is_none() && cw == 11648.0 && ch == 8736.0 {
            (tw, th)
        } else if (r[2] / r[3] / ratio - 1.0).abs() < 0.001 {
            (r[2], r[3])
        } else if r[2] / r[3] > ratio {
            (((r[3] * ratio / 2.0).round() * 2.0).min(r[2]), r[3])
        } else {
            (r[2], ((r[2] / ratio / 2.0).round() * 2.0).min(r[3]))
        };
        if w <= 0.0 || h <= 0.0 {
            return r;
        }
        [r[0] + (r[2] - w) / 2.0, r[1] + (r[3] - h) / 2.0, w, h]
    }

    pub fn relative(&self) -> [f32; 4] {
        let r = self.frame();
        [
            r[0] / self.area[2],
            r[1] / self.area[3],
            r[2] / self.area[2],
            r[3] / self.area[3],
        ]
        .map(|v| v as f32)
    }

    /// Use the full-resolution, unrotated LibRaw visible geometry even for a half decode.
    pub fn decoded(&self, w: u32, h: u32, left: i32, top: i32, flip: i32) -> Option<[f32; 4]> {
        let mut r = self.frame();
        r[0] += self.area[0] - left as f64;
        r[1] += self.area[1] - top as f64;
        if !inside(r, w as f64, h as f64) {
            return None;
        }
        let r = [
            r[0] / w as f64,
            r[1] / h as f64,
            r[2] / w as f64,
            r[3] / h as f64,
        ]
        .map(|v| v as f32);
        let r = orient(r, flip);
        if r.into_iter()
            .zip([0.0, 0.0, 1.0, 1.0])
            .all(|(v, full)| (v - full).abs() < 1e-6)
        {
            None
        } else {
            Some(r)
        }
    }
}

pub fn orient([x, y, w, h]: [f32; 4], flip: i32) -> [f32; 4] {
    let r = match flip {
        3 => [1.0 - x - w, 1.0 - y - h, w, h],
        5 => [y, 1.0 - x - w, h, w],
        6 => [1.0 - y - h, x, h, w],
        _ => [x, y, w, h],
    };
    // Subtracting normalized f32 edges can leave a tiny negative at a valid boundary.
    [r[0].max(0.0), r[1].max(0.0), r[2], r[3]]
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraFrame {
    pub rect: [f32; 4],
    pub width: u32,
    pub height: u32,
    pub aspect: Option<String>,
    pub tele: Option<u16>,
}

pub fn metadata(path: &Path) -> Option<CameraFrame> {
    let c = read(path)?;
    let flip = match crate::lens::read(path).map(|m| m.orientation) {
        Some(3) => 3,
        Some(8) => 5,
        Some(6) => 6,
        _ => 0,
    };
    let [_, _, w, h] = c.area;
    let (width, height) = if flip & 4 != 0 {
        (h as u32, w as u32)
    } else {
        (w as u32, h as u32)
    };
    let aspect = c
        .aspect
        .filter(|(h, w)| *h > 0 && *w > 0)
        .map(|(h, w)| format!("{w}:{h}"));
    let tele = c.zoom.and_then(|r| {
        let factor = (w / r[2]).min(h / r[3]);
        [45u16, 63, 80]
            .into_iter()
            .find(|mm| (factor / (*mm as f64 / 35.0) - 1.0).abs() < 0.03)
    });
    Some(CameraFrame {
        rect: orient(c.relative(), flip),
        width,
        height,
        aspect,
        tele,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample(aspect: (u16, u16), zoom: Option<[u16; 4]>) -> Vec<u8> {
        let pair = |a: u16, b: u16| [a.to_be_bytes(), b.to_be_bytes()].concat();
        let mut tags = vec![
            (0x100u16, pair(8754, 11808)),
            (0x110, pair(7, 8)),
            (0x111, pair(8736, 11648)),
            (0x115, pair(aspect.0, aspect.1)),
            (0x117, (zoom.is_some() as u32).to_be_bytes().to_vec()),
        ];
        if let Some([t, l, h, w]) = zoom {
            tags.extend([(0x118, pair(t, l)), (0x119, pair(h, w))]);
        }
        // Real directories also have large white-balance and calibration tables.
        tags.push((0x999, vec![0; 128]));
        let mut bytes = (tags.len() as u32).to_be_bytes().to_vec();
        for (tag, value) in tags {
            bytes.extend(tag.to_be_bytes());
            bytes.extend((value.len() as u16).to_be_bytes());
            bytes.extend(value);
        }
        bytes
    }
    fn close(a: [f32; 4], b: [f32; 4]) {
        for (a, b) in a.into_iter().zip(b) {
            assert!((a - b).abs() < 1e-6, "{a} != {b}");
        }
    }
    #[test]
    fn official_aspects_have_exact_decoded_pixels() {
        for (ah, aw, w, h) in ASPECTS {
            let c = parse(&sample((ah, aw), None)).unwrap();
            assert_eq!(c.frame(), [(11648.0 - w) / 2.0, (8736.0 - h) / 2.0, w, h]);
            let expected = [
                (8.0 + (11648.0 - w) / 2.0) / 11662.0,
                (5.0 + (8736.0 - h) / 2.0) / 8746.0,
                w / 11662.0,
                h / 8746.0,
            ]
            .map(|v| v as f32);
            close(c.decoded(11662, 8746, 0, 2, 0).unwrap(), expected);
        }
    }
    #[test]
    fn sampled_panorama_and_tele_map_from_camera_area_to_decode() {
        let a = parse(&sample((24, 65), None)).unwrap();
        close(a.relative(), [0.0, 2216.0 / 8736.0, 1.0, 4304.0 / 8736.0]);
        close(
            a.decoded(11662, 8746, 0, 2, 0).unwrap(),
            [
                8.0 / 11662.0,
                2221.0 / 8746.0,
                11648.0 / 11662.0,
                4304.0 / 8746.0,
            ],
        );
        let b = parse(&sample((3, 4), Some([1950, 2600, 4836, 6448]))).unwrap();
        assert_eq!(b.frame(), [2600.0, 1950.0, 6448.0, 4836.0]);
        close(
            b.decoded(11662, 8746, 0, 2, 0).unwrap(),
            [
                2608.0 / 11662.0,
                1955.0 / 8746.0,
                6448.0 / 11662.0,
                4836.0 / 8746.0,
            ],
        );
    }
    #[test]
    fn all_tele_sizes_and_aspects_stay_inside_the_recorded_zoom() {
        for zoom in [
            [971, 1294, 6794, 9060],
            [1950, 2600, 4836, 6448],
            [2457, 3276, 3822, 5096],
        ] {
            for (h, w, _, _) in ASPECTS {
                let c = parse(&sample((h, w), Some(zoom))).unwrap();
                let r = c.frame();
                assert!(r[0] >= zoom[1] as f64 && r[1] >= zoom[0] as f64);
                assert!(r[2] <= zoom[3] as f64 && r[3] <= zoom[2] as f64);
                assert!((r[2] / r[3] / (w as f64 / h as f64) - 1.0).abs() < 0.001);
            }
        }
    }
    #[test]
    fn nominal_fallback_is_centered_even_and_never_replaces_recorded_geometry() {
        for mm in [45, 63, 80] {
            let r = nominal_zoom(11648.0, 8736.0, mm);
            assert_eq!(r[0] * 2.0 + r[2], 11648.0);
            assert_eq!(r[1] * 2.0 + r[3], 8736.0);
            assert_eq!(r[2] % 2.0, 0.0);
            assert_eq!(r[3] % 2.0, 0.0);
            assert!((11648.0 / r[2] - mm as f64 / 35.0).abs() < 0.001);
        }
        let sampled = parse(&sample((3, 4), Some([1950, 2600, 4836, 6448]))).unwrap();
        assert_ne!(sampled.frame(), nominal_zoom(11648.0, 8736.0, 63));
    }

    #[test]
    fn orientation_matches_the_pixel_rotation_and_round_trips() {
        let r = [0.1, 0.2, 0.3, 0.4];
        close(orient(r, 0), r);
        close(orient(r, 3), [0.6, 0.4, 0.3, 0.4]);
        close(orient(r, 5), [0.2, 0.6, 0.4, 0.3]);
        close(orient(r, 6), [0.4, 0.1, 0.4, 0.3]);
        close(orient(orient(r, 3), 3), r);
        close(orient(orient(r, 5), 6), r);
        close(orient(orient(r, 6), 5), r);
        let c = parse(&sample((24, 65), None)).unwrap();
        close(
            c.decoded(11662, 8746, 0, 2, 6).unwrap(),
            orient(c.decoded(11662, 8746, 0, 2, 0).unwrap(), 6),
        );
    }
    #[test]
    fn smaller_camera_areas_use_ratio_and_unknown_aspects_keep_the_area() {
        let mut c = parse(&sample((24, 65), None)).unwrap();
        c.area = [0.0, 0.0, 6000.0, 4000.0];
        assert_eq!(c.frame(), [0.0, 892.0, 6000.0, 2216.0]);
        c.aspect = Some((0, 65));
        assert_eq!(c.frame(), [0.0, 0.0, 6000.0, 4000.0]);
        c.aspect = Some((11, 19));
        assert_eq!(c.frame(), [0.0, 0.0, 6000.0, 4000.0]);
        assert!(c.decoded(5000, 4000, 0, 0, 0).is_none());
    }
    #[test]
    fn malformed_directories_and_file_bounds_fall_back() {
        let valid = sample((3, 4), None);
        for len in 0..valid.len() {
            assert!(parse(&valid[..len]).is_none());
        }
        assert!(parse(&513u32.to_be_bytes()).is_none());
        assert!(parse(&sample((3, 4), Some([9000, 2600, 4836, 6448]))).is_none());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.raf");
        let mut header = vec![0; 100];
        header[..16].copy_from_slice(b"FUJIFILMCCD-RAW ");
        header[92..96].copy_from_slice(&100u32.to_be_bytes());
        header[96..100].copy_from_slice(&(valid.len() as u32).to_be_bytes());
        std::fs::write(&path, [&header[..], &valid[..]].concat()).unwrap();
        assert!(read(&path).is_some());
        header[92..96].copy_from_slice(&u32::MAX.to_be_bytes());
        std::fs::write(&path, [&header[..], &valid[..]].concat()).unwrap();
        assert!(read(&path).is_none());
        assert!(read(&dir.path().join("missing.raf")).is_none());
    }
}
