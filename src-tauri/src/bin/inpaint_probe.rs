// SPDX-License-Identifier: GPL-3.0-or-later
//! Run an already-prepared crop through the same native adapter as Remove.
use emulsion_lib::{
    denoise::Provider,
    inpaint::{Lama, MODEL_SHA256, SIZE},
};
use std::{path::PathBuf, time::Instant};

fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut model = root.join("target/inpaint/assets/lama_fp32.onnx");
    let mut runtime = root
        .join("target/denoise/assets/onnxruntime-osx-arm64-1.23.2/lib/libonnxruntime.1.23.2.dylib");
    let mut provider = Provider::Cpu;
    let mut repeats: usize = 3;
    let mut output: Option<PathBuf> = None;
    let mut paths = Vec::new();
    while let Some(arg) = args.next() {
        let value = |args: &mut std::iter::Skip<std::env::Args>| {
            args.next()
                .ok_or_else(|| format!("Missing value for {arg}"))
        };
        match arg.as_str() {
            "--model" => model = value(&mut args)?.into(),
            "--runtime" => runtime = value(&mut args)?.into(),
            "--provider" => {
                provider = match value(&mut args)?.as_str() {
                    "cpu" => Provider::Cpu,
                    "coreml" => Provider::Coreml,
                    _ => return Err("Expected cpu or coreml".into()),
                }
            }
            "--repeat" => {
                repeats = value(&mut args)?
                    .parse()
                    .map_err(|_| "Invalid repeat count")?
            }
            "--output" => output = Some(value(&mut args)?.into()),
            "--help" | "-h" => {
                println!(
                    "inpaint-probe [--provider cpu|coreml] [--model FILE] [--runtime DYLIB] [--repeat N] --output NEW_DIR CROP.png MASK.png\nBoth inputs must already be 512 x 512. Output includes PNGs and a JSON timing report; no originals or recipes are modified."
                );
                return Ok(());
            }
            _ if arg.starts_with('-') => return Err(format!("Unknown argument {arg}")),
            _ => paths.push(PathBuf::from(arg)),
        }
    }
    if paths.len() != 2 || repeats < 2 {
        return Err("Provide CROP.png MASK.png and at least two repeats; see --help".into());
    }
    let output = output.ok_or("--output NEW_DIR is required")?;
    let image = image::open(&paths[0])
        .map_err(|e| e.to_string())?
        .to_rgba8();
    let mask = image::open(&paths[1])
        .map_err(|e| e.to_string())?
        .to_luma8();
    if image.dimensions() != (SIZE as u32, SIZE as u32) || mask.dimensions() != image.dimensions() {
        return Err("Inputs must already be 512 x 512".into());
    }
    if output.exists() {
        return Err("Output directory already exists".into());
    }
    std::fs::create_dir_all(&output).map_err(|e| e.to_string())?;
    let cache = root.join("target/inpaint/coreml-cache");
    let mut report = serde_json::json!({"model_sha256": MODEL_SHA256, "provider": provider, "threads": 4,
        "onnx_runtime": "1.23.2", "crop": paths[0], "mask": paths[1], "runs_seconds": [], "status": "loading"});
    let start = Instant::now();
    eprintln!("Loading {provider:?} session…");
    let result = (|| -> Result<(), String> {
        let mut model = Lama::open(&runtime, &model, provider, &cache)?;
        report["load_seconds"] = start.elapsed().as_secs_f64().into();
        eprintln!("Loaded in {:.3}s", start.elapsed().as_secs_f64());
        let mut times = Vec::new();
        for repeat in 0..repeats {
            let start = Instant::now();
            let pixels = model.process(image.as_raw(), mask.as_raw())?;
            times.push(start.elapsed().as_secs_f64());
            eprintln!("Patch {}: {:.3}s", repeat + 1, times.last().unwrap());
            image::save_buffer(
                output.join(format!("patch-{}.png", repeat + 1)),
                &pixels,
                SIZE as u32,
                SIZE as u32,
                image::ColorType::Rgba8,
            )
            .map_err(|e| e.to_string())?;
            report["runs_seconds"] = serde_json::to_value(&times).map_err(|e| e.to_string())?;
        }
        report["warm_pass_2s"] = times[1..].iter().all(|&s| s <= 2.0).into();
        report["status"] = "complete".into();
        Ok(())
    })();
    if let Err(e) = &result {
        report["status"] = "error".into();
        report["error"] = e.clone().into();
        report["elapsed_seconds"] = start.elapsed().as_secs_f64().into();
    }
    let json = serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?;
    std::fs::write(output.join("report.json"), &json).map_err(|e| e.to_string())?;
    println!("{json}");
    result
}
