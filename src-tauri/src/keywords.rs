// SPDX-License-Identifier: GPL-3.0-or-later
//! Renaming, moving and deleting a keyword in photos the webview doesn't have open, as
//! Lightroom's Keyword List does across its catalog. Each photo's current keywords are read
//! the way a scan reads them and saved by edit_store. The legacy writer below is retained
//! only as a fixture for the old file format. The open folder's photos change through the
//! webview's store instead, so they stay undoable.

#[cfg(test)]
use std::path::Path;

#[cfg(test)]
use crate::library::with_newer_xmp;
#[cfg(test)]
use crate::xmp::{self, Meta};
#[cfg(test)]
use crate::sidecar;

/// `keyword` with `from` (and everything under it) moved to `to`, or `None` to delete it.
/// Case-insensitive on the path; `to` keeps its own case.
pub fn moved(keyword: &str, from: &str, to: Option<&str>) -> Option<String> {
    let (k, f) = (keyword.to_lowercase(), from.to_lowercase());
    let rest = if k == f { Some("") } else if k.starts_with(&format!("{f}|")) { Some(&keyword[from.len()..]) } else { None };
    match (rest, to) {
        (None, _) => Some(keyword.to_string()),
        (Some(_), None) => None,
        (Some(rest), Some(to)) => Some(format!("{to}{rest}")),
    }
}

/// Retag one photo. Returns its new metadata, or `None` when it didn't have the keyword.
#[cfg(test)]
pub fn retag(image: &Path, from: &str, to: Option<&str>) -> std::io::Result<Option<Meta>> {
    let from = xmp::tidy_path(from);
    let to = to.map(xmp::tidy_path).filter(|t| !t.is_empty());
    let owner = xmp::sidecar_for(image).is_some();
    let mut saved = with_newer_xmp(sidecar::read_synced(image), xmp::read_sidecar(image, owner));
    let keywords: Vec<String> = saved.meta.keywords.iter().filter_map(|k| moved(k, &from, to.as_deref())).collect();
    if keywords == saved.meta.keywords {
        return Ok(None);
    }
    saved.meta = Meta { keywords, ..saved.meta.clone() }.tidy();
    sidecar::write(image, &saved, false)?;
    Ok(Some(saved.meta))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn moves_a_keyword_and_its_children() {
        assert_eq!(moved("Places|UK|Kent", "places|uk", Some("Europe|UK")).as_deref(), Some("Europe|UK|Kent"));
        assert_eq!(moved("Places|UK", "Places|UK", Some("Britain")).as_deref(), Some("Britain"));
        assert_eq!(moved("Places|UKraine", "Places|UK", Some("X")).as_deref(), Some("Places|UKraine"));
        assert_eq!(moved("Places|UK|Kent", "Places|UK", None), None);
    }

    #[test]
    fn retags_a_photo_from_its_xmp_and_keeps_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("a.RAF");
        fs::write(&img, b"x").unwrap();
        // Keywords only in an XMP from another app: no Emulsion sidecar yet.
        let mut v = xmp::Interchange { rating: 3, ..Default::default() };
        v.meta.keywords = vec!["Places|UK|Kent".into(), "Dog".into()];
        xmp::write(&img, &v).unwrap();
        let meta = retag(&img, "Places|UK", Some("Europe|UK")).unwrap().unwrap();
        assert_eq!(meta.keywords, vec!["Europe|UK|Kent", "Dog"]);
        let back = xmp::read_sidecar(&img, true).unwrap().values;
        assert_eq!((back.rating, back.meta.keywords.clone()), (3, meta.keywords.clone()));
        assert!(retag(&img, "Cats", None).unwrap().is_none());
        assert_eq!(retag(&img, "Dog", None).unwrap().unwrap().keywords, vec!["Europe|UK|Kent"]);
        assert_eq!(sidecar::read(&img).unwrap().rating, 3);
    }
}
