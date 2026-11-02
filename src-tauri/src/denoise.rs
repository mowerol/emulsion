// Copyright (C) 2026 darktable developers.
// Ported from darktable src/common/ai/restore_raw_linear.c and restore_common.h
// at commit 0c67b465033205c46735c5a194f2b23d55e68363.
// Rust translation of mirror padding, 32px overlap ramps and scalar gain match.
// Full-frame accumulation replaces upstream's strip storage with the same weights.
// Input comes from Emulsion's existing LibRaw decoder; its baseline gain is removed
// before inference and restored afterwards. The pinned model requests no extra WB
// or exposure normalization. The app caches full-strength output and blends it
// on the GPU before capture sharpening; the CLI can also blend in this module.
// SPDX-License-Identifier: GPL-3.0-or-later

use image::Rgb32FImage;
use ort::{
    ep::{CoreML, coreml::ModelFormat},
    session::{Session, builder::GraphOptimizationLevel},
    value::TensorRef,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{path::Path, time::Instant};

pub const MODEL_SHA256: &str = "df957efadcc152c007d5d3b0917bdff9e41c0d4a0efe56584ef30b36393cd181";
pub const TILE: usize = 512;
const OVERLAP: usize = 32;
const STEP: usize = TILE - 2 * OVERLAP;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Cpu,
    Coreml,
}

#[derive(Debug, Default, Serialize)]
pub struct Stats {
    pub tiles: usize,
    pub inference_seconds: f64,
    pub total_seconds: f64,
    pub first_tile_seconds: f64,
    pub min_gain: f32,
    pub max_gain: f32,
}

/// Full-resolution decode shared with the app, before any GPU processing.
pub fn decode_raw(path: &Path) -> Result<(Rgb32FImage, serde_json::Value), String> {
    if crate::library::classify(path) != crate::library::Kind::Raw {
        return Err("The denoise probe currently accepts camera RAW files only".into());
    }
    let decoded = crate::raw::decode(path, false)?;
    let metadata = serde_json::json!({
        "camera": decoded.camera,
        "exposure": crate::raw::exposure(path),
        "width": decoded.image.width(), "height": decoded.image.height(),
    });
    Ok((decoded.image.into_rgb32f(), metadata))
}

/// Read exposure metadata without unpacking the sensor pixels.
pub fn inspect(paths: Vec<std::path::PathBuf>) -> Vec<serde_json::Value> {
    paths
        .iter()
        .map(|path| serde_json::json!({ "path": path, "exposure": crate::raw::exposure(path) }))
        .collect()
}

/// Probe artifacts use the engine's existing binary header and signed RGBA16F
/// pixels. They intentionally omit lens/profile metadata for a neutral comparison.
pub fn write_payload(path: &Path, image: &Rgb32FImage) -> Result<(), String> {
    use std::io::Write;
    let mut file = std::io::BufWriter::new(
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|e| e.to_string())?,
    );
    let (w, h) = image.dimensions();
    let header = crate::decode::payload(
        w,
        h,
        crate::decode::InputMode::SceneLinear,
        None,
        (w, h),
        vec![],
    );
    file.write_all(&header).map_err(|e| e.to_string())?;
    for rgb in image.pixels() {
        for value in [rgb[0], rgb[1], rgb[2], 1.0] {
            let half = half::f16::from_f32(value);
            if !half.is_finite() {
                return Err("Image exceeds the engine's half-float range".into());
            }
            file.write_all(&half.to_le_bytes())
                .map_err(|e| e.to_string())?;
        }
    }
    file.flush().map_err(|e| e.to_string())
}

/// On-demand native inference. Runtime and model are loaded only when requested.
pub struct Denoiser {
    session: Session,
}

impl Denoiser {
    pub fn open(
        runtime: &Path,
        model: &Path,
        provider: Provider,
        cache: &Path,
    ) -> Result<Self, String> {
        let bytes = std::fs::read(model).map_err(|e| format!("Read model: {e}"))?;
        let actual = format!("{:x}", Sha256::digest(&bytes));
        if actual != MODEL_SHA256 {
            return Err(format!(
                "Wrong RawNIND model: expected {MODEL_SHA256}, got {actual}. Run tools/denoise/setup.py."
            ));
        }
        if !runtime.is_file() {
            return Err(format!(
                "ONNX Runtime library not found: {}",
                runtime.display()
            ));
        }
        // The serialized worker selects the library before any ORT API call.
        ort::init_from(runtime).map_err(|e| e.to_string())?.commit();
        let mut builder = Session::builder()
            .map_err(|e| e.to_string())?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| e.to_string())?
            .with_intra_threads(4)
            .map_err(|e| e.to_string())?;
        if matches!(provider, Provider::Coreml) {
            if !cfg!(target_os = "macos") {
                return Err("CoreML requires macOS".into());
            }
            std::fs::create_dir_all(cache).map_err(|e| e.to_string())?;
            builder = builder
                .with_execution_providers([CoreML::default()
                    .with_model_format(ModelFormat::MLProgram)
                    .with_static_input_shapes(true)
                    .with_model_cache_dir(cache.join(MODEL_SHA256).display().to_string())
                    .build()
                    .error_on_failure()])
                .map_err(|e| e.to_string())?;
        }
        let session = builder
            .commit_from_memory(&bytes)
            .map_err(|e| e.to_string())?;
        Ok(Self { session })
    }

    /// Explicit provider selection keeps CPU/CoreML comparisons honest. The
    /// caller may retry the whole image on CPU if the CoreML run fails.
    pub fn process(
        &mut self,
        source: &Rgb32FImage,
        strength: f32,
        progress: impl FnMut(usize, usize),
    ) -> Result<(Rgb32FImage, Stats), String> {
        tiled(
            source,
            strength,
            |input| {
                let tensor = TensorRef::from_array_view(([1, 3, TILE, TILE], input))
                    .map_err(|e| e.to_string())?;
                let outputs = self
                    .session
                    .run(ort::inputs!["input" => tensor])
                    .map_err(|e| e.to_string())?;
                let (shape, data) = outputs[0]
                    .try_extract_tensor::<f32>()
                    .map_err(|e| e.to_string())?;
                if shape.as_ref() != [1, 3, TILE as i64, TILE as i64] {
                    return Err(format!("Unexpected model output shape: {shape:?}"));
                }
                Ok(data.to_vec())
            },
            progress,
        )
    }
}

// Upstream's periodic reflection (does not repeat the edge pixel).
fn mirror(i: isize, n: usize) -> usize {
    if n <= 1 {
        return 0;
    }
    let period = 2 * (n - 1);
    let i = i.unsigned_abs() % period;
    if i >= n { period - i } else { i }
}

fn seam(pos: usize, base: usize, end: usize, before: bool, after: bool) -> f32 {
    let p = pos as isize;
    let b = base as isize;
    let e = end as isize;
    let o = OVERLAP as isize;
    if before && p < b + o {
        return ((p - (b - o)) as f32 + 0.5) / (2 * OVERLAP) as f32;
    }
    if after && p >= e - o {
        return 1.0 - ((p - (e - o)) as f32 + 0.5) / (2 * OVERLAP) as f32;
    }
    1.0
}

fn match_gain(input: &[f32], output: &mut [f32]) -> Result<f32, String> {
    if output.len() != input.len() || output.iter().any(|v| !v.is_finite()) {
        return Err("Model returned the wrong size or non-finite pixels".into());
    }
    let im = input.iter().map(|v| *v as f64).sum::<f64>() / input.len() as f64;
    let om = output.iter().map(|v| *v as f64).sum::<f64>() / output.len() as f64;
    let gain = if om.abs() > 1e-8 {
        (im / om) as f32
    } else {
        1.0
    };
    for v in output {
        *v *= gain;
        if !v.is_finite() {
            return Err("Non-finite output after gain matching".into());
        }
    }
    Ok(gain)
}

fn tiled(
    source: &Rgb32FImage,
    strength: f32,
    mut infer: impl FnMut(&[f32]) -> Result<Vec<f32>, String>,
    mut progress: impl FnMut(usize, usize),
) -> Result<(Rgb32FImage, Stats), String> {
    if !strength.is_finite() || !(0.0..=1.0).contains(&strength) {
        return Err("Strength must be between 0 and 1".into());
    }
    let (w, h) = (source.width() as usize, source.height() as usize);
    if w == 0 || h == 0 || source.as_raw().iter().any(|v| !v.is_finite()) {
        return Err("Input must be a non-empty finite linear RGB image".into());
    }
    if strength == 0.0 {
        return Ok((source.clone(), Stats::default()));
    }
    let start = Instant::now();
    let mut stats = Stats {
        min_gain: f32::INFINITY,
        max_gain: f32::NEG_INFINITY,
        ..Stats::default()
    };
    let (cols, rows) = (w.div_ceil(STEP), h.div_ceil(STEP));
    let mut result = vec![0.0; w * h * 3];
    let plane = TILE * TILE;
    let mut input = vec![0.0; plane * 3];
    let src = source.as_raw();
    let baseline = crate::raw::BASELINE_GAIN;
    for ty in 0..rows {
        for tx in 0..cols {
            let (xb, yb) = (tx * STEP, ty * STEP);
            let (xe, ye) = ((xb + STEP).min(w), (yb + STEP).min(h));
            for dy in 0..TILE {
                let sy = mirror(yb as isize - OVERLAP as isize + dy as isize, h);
                for dx in 0..TILE {
                    let sx = mirror(xb as isize - OVERLAP as isize + dx as isize, w);
                    for c in 0..3 {
                        input[c * plane + dy * TILE + dx] = src[(sy * w + sx) * 3 + c] / baseline;
                    }
                }
            }
            let inference_start = Instant::now();
            let mut output = infer(&input)?;
            let seconds = inference_start.elapsed().as_secs_f64();
            stats.inference_seconds += seconds;
            if stats.tiles == 0 {
                stats.first_tile_seconds = seconds;
            }
            let gain = match_gain(&input, &mut output)?;
            stats.min_gain = stats.min_gain.min(gain);
            stats.max_gain = stats.max_gain.max(gain);
            let x0 = if tx > 0 {
                xb.saturating_sub(OVERLAP)
            } else {
                xb
            };
            let y0 = if ty > 0 {
                yb.saturating_sub(OVERLAP)
            } else {
                yb
            };
            let x1 = if tx + 1 < cols {
                (xe + OVERLAP).min(w)
            } else {
                xe
            };
            let y1 = if ty + 1 < rows {
                (ye + OVERLAP).min(h)
            } else {
                ye
            };
            for y in y0..y1 {
                let my = (OVERLAP as isize + y as isize - yb as isize) as usize;
                let ay = seam(y, yb, ye, ty > 0, ty + 1 < rows);
                for x in x0..x1 {
                    let mx = (OVERLAP as isize + x as isize - xb as isize) as usize;
                    let weight = ay * seam(x, xb, xe, tx > 0, tx + 1 < cols);
                    let dst = (y * w + x) * 3;
                    for c in 0..3 {
                        let denoised = output[c * plane + my * TILE + mx] * baseline;
                        let blended = strength * denoised + (1.0 - strength) * src[dst + c];
                        result[dst + c] += weight * blended;
                    }
                }
            }
            stats.tiles += 1;
            progress(stats.tiles, cols * rows);
        }
    }
    stats.total_seconds = start.elapsed().as_secs_f64();
    Ok((
        Rgb32FImage::from_raw(w as u32, h as u32, result).ok_or("Invalid image size")?,
        stats,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tiled_identity_preserves_edges_seams_sign_and_partial_tiles() {
        // Includes four-tile junctions, last cores narrower than the overlap,
        // single-pixel images and negative wide-gamut camera values.
        for (w, h) in [(1, 1), (3, 2), (449, 451), (897, 65), (65, 897)] {
            let source = Rgb32FImage::from_fn(w, h, |x, y| {
                image::Rgb([(x as f32 / w as f32) - 0.2, y as f32 / h as f32, 0.7])
            });
            let (out, _) = tiled(
                &source,
                0.65,
                |v| Ok(v.iter().map(|x| x * -2.5).collect()),
                |_, _| {},
            )
            .unwrap();
            let error = source
                .as_raw()
                .iter()
                .zip(out.as_raw())
                .map(|(a, b)| (a - b).abs())
                .fold(0.0f32, f32::max);
            assert!(error < 5e-7, "{w}x{h}: {error}");
        }
    }

    #[test]
    fn off_bypasses_inference_exactly() {
        let source = Rgb32FImage::from_pixel(2, 3, image::Rgb([-0.01, 0.23, 1.9]));
        let (out, stats) =
            tiled(&source, 0.0, |_| panic!("off must not infer"), |_, _| {}).unwrap();
        assert_eq!(source, out);
        assert_eq!(stats.tiles, 0);
    }

    #[test]
    fn invalid_inference_does_not_make_an_image() {
        let source = Rgb32FImage::from_pixel(2, 3, image::Rgb([0.1; 3]));
        assert!(tiled(&source, 1.0, |v| Ok(vec![f32::NAN; v.len()]), |_, _| {}).is_err());
        assert!(tiled(&source, 1.0, |_| Ok(vec![]), |_, _| {}).is_err());
        assert!(tiled(&source, f32::NAN, |_| unreachable!(), |_, _| {}).is_err());
    }
}
