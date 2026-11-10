// Copyright [2021] Samsung Research
// Model adapter follows advimman/lama saicinpainting/training/trainers/default.py
// at 786f5936b27fb3dacd2b1ad799e4de968ea697e7 and Carve-Photos/lama's export notebook
// at f5fb39a18022c34a71bf9a47a6ec393c804b49ca (Apache-2.0).
// The ONNX graph includes masking, generation, composition and scaling to 0..255.
// This adapter packs sRGB RGBA8 and a binary mask into the graph's NCHW tensors,
// validates its output and rounds to RGBA8. Colour conversion lives in engine/remove.ts.
// SPDX-License-Identifier: GPL-3.0-or-later

use crate::denoise::Provider;
use ort::{
    ep::{CoreML, coreml::ModelFormat},
    session::{Session, builder::GraphOptimizationLevel},
    value::TensorRef,
};
use sha2::{Digest, Sha256};
use std::path::Path;

pub const SIZE: usize = 512;
pub const PIXELS: usize = SIZE * SIZE;
pub const MODEL_SHA256: &str = "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6";

/// Crop and mask share the top-row-first convention of engine/remove.ts.
pub fn pack(rgba: &[u8], mask: &[u8]) -> Result<(Vec<f32>, Vec<f32>), String> {
    if rgba.len() != PIXELS * 4 || mask.len() != PIXELS {
        return Err("Remove needs a 512 x 512 RGBA crop and a 512 x 512 mask".into());
    }
    let mut image = vec![0.0; PIXELS * 3];
    for (i, p) in rgba.chunks_exact(4).enumerate() {
        for c in 0..3 {
            image[c * PIXELS + i] = p[c] as f32 / 255.0;
        }
    }
    Ok((
        image,
        mask.iter()
            .map(|&v| if v > 0 { 1.0 } else { 0.0 })
            .collect(),
    ))
}

fn unpack(shape: &[i64], values: &[f32]) -> Result<Vec<u8>, String> {
    if shape != [1, 3, SIZE as i64, SIZE as i64] || values.len() != PIXELS * 3 {
        return Err("Unexpected Remove model output dimensions".into());
    }
    if values
        .iter()
        .any(|v| !v.is_finite() || !(0.0..=255.0).contains(v))
    {
        return Err("Invalid Remove model output pixels".into());
    }
    let mut rgba = vec![255; PIXELS * 4];
    for i in 0..PIXELS {
        for c in 0..3 {
            rgba[i * 4 + c] = values[c * PIXELS + i].round() as u8;
        }
    }
    Ok(rgba)
}

/// A retained native session. Provider choice is explicit for reproducible benchmarks.
pub struct Lama {
    session: Session,
}

impl Lama {
    pub fn open(
        runtime: &Path,
        model: &Path,
        provider: Provider,
        cache: &Path,
    ) -> Result<Self, String> {
        let bytes = std::fs::read(model)
            .map_err(|e| format!("Remove model is missing or could not be read: {e}"))?;
        if format!("{:x}", Sha256::digest(&bytes)) != MODEL_SHA256 {
            return Err("Remove model did not match its pinned SHA-256 checksum".into());
        }
        if !runtime.is_file() {
            return Err("ONNX Runtime is not installed".into());
        }
        ort::init_from(runtime).map_err(|e| e.to_string())?.commit();
        let err = |e: ort::Error| e.to_string();
        let mut builder = Session::builder()
            .map_err(err)?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(err)?
            .with_intra_threads(4)
            .map_err(err)?
            .with_inter_threads(1)
            .map_err(err)?
            // Carve's spatial dimensions are fixed, but its batch axis is symbolic.
            // Remove always runs one crop; resolve that axis before CoreML partitioning.
            .with_dimension_override("batch", 1)
            .map_err(err)?;
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
                .map_err(err)?;
        }
        // Load the exact bytes that were verified, even if the file changes meanwhile.
        let session = builder.commit_from_memory(&bytes).map_err(err)?;
        Ok(Self { session })
    }

    pub fn process(&mut self, rgba: &[u8], mask: &[u8]) -> Result<Vec<u8>, String> {
        let (image, mask) = pack(rgba, mask)?;
        let image = TensorRef::from_array_view(([1, 3, SIZE, SIZE], image.as_slice()))
            .map_err(|e| e.to_string())?;
        let mask = TensorRef::from_array_view(([1, 1, SIZE, SIZE], mask.as_slice()))
            .map_err(|e| e.to_string())?;
        let outputs = self
            .session
            .run(ort::inputs!["image" => image, "mask" => mask])
            .map_err(|e| e.to_string())?;
        let output = outputs
            .get("output")
            .ok_or("Remove model has no output tensor")?;
        let (shape, pixels) = output
            .try_extract_tensor::<f32>()
            .map_err(|e| e.to_string())?;
        unpack(shape, pixels)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crop_and_mask_round_trip_preserves_channels_and_orientation() {
        let mut rgba = vec![255; PIXELS * 4];
        for i in 0..PIXELS {
            rgba[i * 4] = (i % 251) as u8;
            rgba[i * 4 + 1] = (i / SIZE % 253) as u8;
            rgba[i * 4 + 2] = (i % SIZE % 255) as u8;
        }
        let mut mask = vec![0; PIXELS];
        mask[SIZE + 9] = 1;
        mask[PIXELS - 1] = 255;
        let (image, binary) = pack(&rgba, &mask).unwrap();
        let values: Vec<_> = image.iter().map(|v| v * 255.0).collect();
        assert_eq!(
            unpack(&[1, 3, SIZE as i64, SIZE as i64], &values).unwrap(),
            rgba
        );
        assert_eq!(binary[SIZE + 9], 1.0);
        assert_eq!(binary[PIXELS - 1], 1.0);
        assert_eq!(binary.iter().sum::<f32>(), 2.0);
        assert!(pack(&rgba[..4], &mask).is_err());
        assert!(pack(&rgba, &mask[..1]).is_err());
    }

    #[test]
    fn rejects_invalid_output_and_unverified_models() {
        let shape = [1, 3, SIZE as i64, SIZE as i64];
        let mut values = vec![10.0; PIXELS * 3];
        for value in [f32::NAN, f32::INFINITY, -1.0, 256.0] {
            values[0] = value;
            assert!(unpack(&shape, &values).is_err());
        }
        assert!(unpack(&shape, &[]).is_err());
        let temp = tempfile::tempdir().unwrap();
        let model = temp.path().join("wrong.onnx");
        std::fs::write(&model, b"wrong").unwrap();
        assert!(
            Lama::open(Path::new("unused"), &model, Provider::Cpu, temp.path())
                .err()
                .unwrap()
                .contains("checksum")
        );
    }

    #[test]
    #[ignore = "requires tools/inpaint/setup.py and the local ONNX Runtime"]
    fn installed_lama_preserves_unmasked_pixels() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let runtime = root.join(
            "target/denoise/assets/onnxruntime-osx-arm64-1.23.2/lib/libonnxruntime.1.23.2.dylib",
        );
        let model = root.join("target/inpaint/assets/lama_fp32.onnx");
        let cache = tempfile::tempdir().unwrap();
        let mut lama = Lama::open(&runtime, &model, Provider::Cpu, cache.path()).unwrap();
        let rgba = vec![170; PIXELS * 4];
        let mut mask = vec![0; PIXELS];
        for y in 200..300 {
            mask[y * SIZE + 200..y * SIZE + 300].fill(255);
        }
        let patch = lama.process(&rgba, &mask).unwrap();
        for (i, p) in patch.chunks_exact(4).enumerate() {
            assert_eq!(p[3], 255);
            if mask[i] == 0 {
                assert_eq!(&p[..3], &[170, 170, 170]);
            }
        }
    }
}
