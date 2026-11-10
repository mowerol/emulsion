// SPDX-License-Identifier: GPL-3.0-or-later
//! Camera noise profiles for denoise (profiled), ported from darktable.
//!
//! Copyright (C) 2011-2024 darktable developers.
//! Port of `src/common/noiseprofiles.c` (`dt_noiseprofile_get_matching`,
//! `dt_noiseprofile_interpolate`) and the auto-profile choice in
//! `src/iop/denoiseprofile.c` (`dt_iop_denoiseprofile_get_auto_profile`) at darktable
//! 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (5.6.2). `data/noiseprofiles.json` is
//! darktable's database at the same commit, unmodified
//! (SHA-256 d206530db4921482cd73aa4ad9bb53561b33f50d6499664298bb14520734afb3).
//!
//! Deviation, recorded as the plan asks: darktable names cameras through rawspeed,
//! Emulsion through LibRaw's normalised make/model. Where LibRaw's maker differs
//! (OM System bodies are "Olympus" to LibRaw), [`MAKER_ALIASES`] adds darktable's maker
//! as a second candidate. The model must still match exactly, as upstream.
//! Highlight-preservation ISO compensation is not ported (docs/plans/noise-reduction.md).

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

const JSON: &str = include_str!("../data/noiseprofiles.json");

/// LibRaw normalised maker → darktable maker names that may also hold its models.
const MAKER_ALIASES: &[(&str, &str)] = &[("Olympus", "OM System"), ("OM Digital", "OM System")];

/// The noise model `V(X) = a·E[X] + b` per raw channel, as the denoise stage uses it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoiseProfile {
    /// darktable's label: `found ISO 4000`, `interpolated ISO 1000` or `generic poissonian`.
    pub name: String,
    pub iso: f32,
    pub a: [f32; 3],
    pub b: [f32; 3],
    /// No profile for this camera at this ISO: darktable's generic Poissonian profile.
    pub generic: bool,
}

#[derive(Deserialize)]
struct Db { noiseprofiles: Vec<Maker> }
#[derive(Deserialize)]
struct Maker { maker: String, models: Vec<Model> }
#[derive(Deserialize)]
struct Model { model: String, profiles: Vec<Entry> }
#[derive(Deserialize, Clone)]
struct Entry {
    #[serde(default)]
    skip: bool,
    iso: f64,
    a: [f64; 3],
    b: [f64; 3],
}

fn db() -> &'static Db {
    static DB: OnceLock<Db> = OnceLock::new();
    DB.get_or_init(|| serde_json::from_str(JSON).expect("bundled noiseprofiles.json"))
}

fn generic() -> NoiseProfile {
    NoiseProfile { name: "generic poissonian".into(), iso: 0.0, a: [0.0001; 3], b: [0.0; 3], generic: true }
}

/// `dt_noiseprofile_get_matching`: the camera's profiles sorted by ISO, `skip` entries left out.
/// Upstream prepends while reading and then stable-sorts, so equal ISOs end up last-read first.
fn matching(make: &str, model: &str) -> Vec<Entry> {
    let aliases: Vec<&str> = MAKER_ALIASES.iter().filter(|(m, _)| *m == make).map(|(_, a)| *a).collect();
    for maker in &db().noiseprofiles {
        // g_strstr_len(camera_maker, -1, maker): the database maker is a substring of the camera's.
        if !(make.contains(maker.maker.as_str()) || aliases.contains(&maker.maker.as_str())) { continue; }
        if let Some(m) = maker.models.iter().find(|m| m.model == model) {
            let mut out: Vec<Entry> = m.profiles.iter().filter(|p| !p.skip).cloned().collect();
            out.reverse();
            // dt_noiseprofile_t.iso is an int and _sort_by_iso compares those.
            out.sort_by_key(|p| p.iso as i32);
            return out;
        }
    }
    Vec::new()
}

/// `dt_iop_denoiseprofile_get_auto_profile`: the exact ISO, else linear interpolation between
/// the two bracketing ISOs, else (outside the range or no camera) the generic profile.
pub fn for_camera(make: &str, model: &str, exif_iso: f32) -> NoiseProfile {
    let iso = exif_iso as i32;
    let profiles = matching(make, model);
    let mut last: Option<&Entry> = None;
    for current in &profiles {
        let ci = current.iso as i32;
        if ci == iso {
            return NoiseProfile {
                name: format!("found ISO {iso}"), iso: iso as f32,
                a: current.a.map(|v| v as f32), b: current.b.map(|v| v as f32), generic: false,
            };
        }
        if let Some(l) = last {
            let li = l.iso as i32;
            if li < iso && ci > iso {
                // dt_noiseprofile_interpolate, in single precision as upstream.
                let t = ((iso - li) as f32 / (ci - li) as f32).clamp(0.0, 1.0);
                let lerp = |p: f64, q: f64| (1.0 - t) * p as f32 + t * q as f32;
                return NoiseProfile {
                    name: format!("interpolated ISO {iso}"), iso: iso as f32,
                    a: [0, 1, 2].map(|k| lerp(l.a[k], current.a[k])),
                    b: [0, 1, 2].map(|k| lerp(l.b[k], current.b[k])),
                    generic: false,
                };
            }
        }
        last = Some(current);
    }
    generic()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_iso_uses_that_profile() {
        let p = for_camera("Fujifilm", "X-T30 II", 1600.0);
        assert_eq!(p.name, "found ISO 1600");
        assert!(!p.generic);
        assert!(p.a[1] > 0.0);
    }

    #[test]
    fn between_isos_interpolates_linearly() {
        let lo = for_camera("Fujifilm", "X-T30 II", 1600.0);
        let hi = for_camera("Fujifilm", "X-T30 II", 2000.0);
        let mid = for_camera("Fujifilm", "X-T30 II", 1800.0);
        assert_eq!(mid.name, "interpolated ISO 1800");
        for k in 0..3 {
            assert!((mid.a[k] - 0.5 * (lo.a[k] + hi.a[k])).abs() <= 1e-6 * hi.a[k].abs().max(1e-12));
        }
    }

    #[test]
    fn outside_the_range_or_unknown_camera_is_generic() {
        // X-T30 II starts at ISO 160; upstream does not clamp to the first profile.
        assert!(for_camera("Fujifilm", "X-T30 II", 125.0).generic);
        assert!(for_camera("Fujifilm", "X-T30 II", 99999.0).generic);
        assert!(for_camera("Fujifilm", "No Such Camera", 800.0).generic);
        // Model must be exact, maker a substring.
        assert!(for_camera("Fujifilm", "x-t30 ii", 1600.0).generic);
        assert!(!for_camera("FUJIFILM Fujifilm Corp", "X-T30 II", 1600.0).generic);
        let g = for_camera("Nobody", "Nothing", 100.0);
        assert_eq!((g.a, g.b, g.name.as_str()), ([0.0001; 3], [0.0; 3], "generic poissonian"));
    }

    #[test]
    fn libraw_olympus_om_bodies_find_om_system_profiles() {
        let p = for_camera("Olympus", "OM-3", 4000.0);
        assert!(!p.generic, "{p:?}");
        assert_eq!(p.name, "interpolated ISO 4000");
    }

    #[test]
    fn skip_entries_are_ignored() {
        let skipped: Vec<(String, String, f64)> = db().noiseprofiles.iter().flat_map(|mk| mk.models.iter().flat_map(move |m| {
            m.profiles.iter().filter(|p| p.skip).map(move |p| (mk.maker.clone(), m.model.clone(), p.iso))
        })).collect();
        for (maker, model, iso) in skipped.iter().take(20) {
            let p = for_camera(maker, model, *iso as f32);
            let kept = matching(maker, model).iter().any(|e| e.iso as i32 == *iso as i32);
            if !kept { assert!(!p.name.starts_with("found"), "{maker} {model} {iso}: {p:?}"); }
        }
    }

    /// Prints the profile each sample RAW matches: `EMULSION_RAW_SAMPLES=a.ORF:b.RAF`.
    #[test]
    #[ignore = "requires EMULSION_RAW_SAMPLES"]
    fn sample_raws_match_profiles() {
        let paths = std::env::var("EMULSION_RAW_SAMPLES").expect("set EMULSION_RAW_SAMPLES");
        for p in paths.split(':') {
            let profile = crate::raw::noise_profile(std::path::Path::new(p));
            eprintln!("{p}: {profile:?}");
            assert!(profile.is_some_and(|p| !p.generic), "{p} has no profile");
        }
    }
}
