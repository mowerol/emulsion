// Copyright (c) 2021 xiongzhu666
// Ported from Sky-Segmentation-and-Post-processing onnx_interence.py at
// 1f7811b32b64ddc957269defff84bc87a3f0b74f (MIT). U²-Net sky inference: 320² RGB,
// ImageNet standardization, first output, min/max normalization, uint8 truncation.
// OpenCV's pixel-centre bilinear resize is expressed directly here (rounding may
// differ by one byte). The resulting mask is resized to the supplied render for storage.
// FP16 weights from voyagerfromeast/skyseg at d76f97cf68f049654f087d78d071dfd7505b2561;
// graph input and output remain float32. See NOTICE.md and licenses/skyseg.txt.
// SPDX-License-Identifier: GPL-3.0-or-later

use ort::{
    session::{Session, builder::GraphOptimizationLevel},
    value::TensorRef,
};
use std::path::Path;

const SIZE: usize = 320;
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];

pub fn valid_render(width: usize, height: usize, bytes: usize) -> bool {
    width > 0
        && height > 0
        && width <= 4096
        && height <= 4096
        && width.checked_mul(height).and_then(|n| n.checked_mul(4)) == Some(bytes)
}

fn axis(pos: usize, from: usize, to: usize) -> (usize, usize, f32) {
    let p = ((pos as f64 + 0.5) * from as f64 / to as f64 - 0.5).clamp(0.0, (from - 1) as f64);
    let a = p.floor() as usize;
    (a, (a + 1).min(from - 1), (p - a as f64) as f32)
}

fn bilinear(
    bytes: &[u8],
    width: usize,
    stride: usize,
    channel: usize,
    x: (usize, usize, f32),
    y: (usize, usize, f32),
) -> u8 {
    let (x0, x1, fx) = x;
    let (y0, y1, fy) = y;
    let at = |x, y| bytes[(y * width + x) * stride + channel] as f32;
    let a = at(x0, y0) * (1.0 - fx) + at(x1, y0) * fx;
    let b = at(x0, y1) * (1.0 - fx) + at(x1, y1) * fx;
    (a * (1.0 - fy) + b * fy).round() as u8
}

fn pack(rgba: &[u8], width: usize, height: usize) -> Result<Vec<f32>, String> {
    if !valid_render(width, height, rgba.len()) {
        return Err("Bad render for sky selection".into());
    }
    let mut out = vec![0.0; 3 * SIZE * SIZE];
    for y in 0..SIZE {
        for x in 0..SIZE {
            for c in 0..3 {
                let v = bilinear(
                    rgba,
                    width,
                    4,
                    c,
                    axis(x, width, SIZE),
                    axis(y, height, SIZE),
                );
                out[c * SIZE * SIZE + y * SIZE + x] = (v as f32 / 255.0 - MEAN[c]) / STD[c];
            }
        }
    }
    Ok(out)
}

fn unpack(shape: &[i64], values: &[f32], width: usize, height: usize) -> Result<Vec<u8>, String> {
    if shape != [1, 1, SIZE as i64, SIZE as i64] || values.len() != SIZE * SIZE {
        return Err("Unexpected sky model output dimensions".into());
    }
    if values.iter().any(|v| !v.is_finite()) {
        return Err("Invalid sky model output".into());
    }
    let lo = values.iter().copied().fold(f32::INFINITY, f32::min);
    let hi = values.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    // Upstream's normalization has no defined result for a constant map. Keep it empty.
    let mask: Vec<u8> = values
        .iter()
        .map(|v| {
            if hi > lo {
                ((v - lo) / (hi - lo) * 255.0) as u8
            } else {
                0
            }
        })
        .collect();
    let mut out = vec![0; width * height];
    for y in 0..height {
        for x in 0..width {
            out[y * width + x] = bilinear(
                &mask,
                SIZE,
                1,
                0,
                axis(x, SIZE, width),
                axis(y, SIZE, height),
            );
        }
    }
    Ok(out)
}

pub struct Sky {
    session: Session,
}

impl Sky {
    pub fn open(path: &Path) -> Result<Self, String> {
        let session = Session::builder()
            .map_err(|e| e.to_string())?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| e.to_string())?
            .with_intra_threads(4)
            .map_err(|e| e.to_string())?
            .commit_from_file(path)
            .map_err(|e| e.to_string())?;
        Ok(Self { session })
    }

    pub fn select(&mut self, rgba: &[u8], width: usize, height: usize) -> Result<Vec<u8>, String> {
        let input = pack(rgba, width, height)?;
        let input = TensorRef::from_array_view(([1, 3, SIZE, SIZE], input.as_slice()))
            .map_err(|e| e.to_string())?;
        let outputs = self
            .session
            .run(ort::inputs![input])
            .map_err(|e| e.to_string())?;
        let (shape, values) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| e.to_string())?;
        unpack(shape, values, width, height)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_validation_rejects_empty_oversized_and_overflowing_dimensions() {
        assert!(valid_render(1536, 1024, 1536 * 1024 * 4));
        for (w, h, n) in [
            (0, 1, 0),
            (1, 0, 0),
            (usize::MAX, 2, 8),
            (4097, 1, 16388),
            (2, 2, 15),
        ] {
            assert!(!valid_render(w, h, n));
        }
    }

    #[test]
    fn preprocessing_matches_upstream_rgb_channels_and_normalization() {
        let input = pack(&[255, 128, 0, 27], 1, 1).unwrap();
        for (c, byte) in [255.0, 128.0, 0.0].into_iter().enumerate() {
            assert!(
                input[c * SIZE * SIZE..(c + 1) * SIZE * SIZE]
                    .iter()
                    .all(|v| (v - (byte / 255.0 - MEAN[c]) / STD[c]).abs() < 1e-6)
            );
        }
        // OpenCV INTER_LINEAR pixel centres; alpha is ignored.
        assert_eq!(
            bilinear(&[0, 100, 200, 255], 2, 1, 0, axis(1, 2, 4), axis(1, 2, 4)),
            72
        );
    }

    #[test]
    fn postprocessing_uses_first_map_normalization_and_preserves_orientation() {
        let mut values = vec![0.2; SIZE * SIZE];
        values[SIZE..2 * SIZE].fill(0.5);
        values[2 * SIZE..].fill(0.8);
        let out = unpack(&[1, 1, 320, 320], &values, SIZE, SIZE).unwrap();
        assert_eq!(out[0], 0);
        assert_eq!(out[SIZE], 127); // upstream truncates, not rounds
        assert_eq!(out[2 * SIZE], 255);
        assert!(unpack(&[1, 3, 320, 320], &values, 2, 2).is_err());
        assert_eq!(
            unpack(&[1, 1, 320, 320], &vec![0.5; SIZE * SIZE], 2, 3).unwrap(),
            vec![0; 6]
        );
        values[0] = f32::NAN;
        assert!(unpack(&[1, 1, 320, 320], &values, 2, 2).is_err());
    }

    /// EMULSION_SKY=<onnx> EMULSION_SKY_IMAGE=<photo> EMULSION_ORT=<dylib>
    /// cargo test --lib sky_on_photo -- --ignored --nocapture
    #[test]
    #[ignore]
    fn sky_on_photo() {
        ort::init_from(std::env::var("EMULSION_ORT").unwrap())
            .unwrap()
            .commit();
        let image = image::open(std::env::var("EMULSION_SKY_IMAGE").unwrap())
            .unwrap()
            .to_rgba8();
        let (w, h) = (image.width(), image.height());
        let t = std::time::Instant::now();
        let mut model = Sky::open(Path::new(&std::env::var("EMULSION_SKY").unwrap())).unwrap();
        println!("load {:?}", t.elapsed());
        let t = std::time::Instant::now();
        let mask = model
            .select(image.as_raw(), w as usize, h as usize)
            .unwrap();
        println!(
            "inference {:?}, selected {:.1}%",
            t.elapsed(),
            mask.iter().filter(|&&v| v > 127).count() as f64 * 100.0 / mask.len() as f64
        );
        assert!(mask.iter().any(|&v| v > 127));
        image::GrayImage::from_raw(w, h, mask)
            .unwrap()
            .save(std::env::var("EMULSION_SKY_OUT").unwrap())
            .unwrap();
    }
}
