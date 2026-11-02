// SPDX-License-Identifier: GPL-3.0-or-later
//! Opt-in native RawNIND experiment. See tools/denoise/README.md.
use emulsion_lib::denoise::{self, Denoiser, Provider};
use image::Rgb32FImage;
use serde_json::json;
use std::{path::PathBuf, time::Instant};

const USAGE: &str = "denoise-probe [--assets DIR] --output NEW_DIR [--provider cpu|coreml] [--crop X,Y,W,H] [--repeat N] [--strength 0..1] RAW\n\
    denoise-probe --inspect RAW [RAW ...]\n\
Run python3 tools/denoise/setup.py first. Outputs are experimental scene-linear buffers, not edited photographs.";

fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let mut assets = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/denoise/assets");
    let mut output = None;
    let mut provider = Provider::Cpu;
    let mut crop = None;
    let mut repeat: usize = 2;
    let mut strength = 1.0f32;
    let mut input = None;
    while let Some(arg) = args.next() {
        let value = |args: &mut std::iter::Skip<std::env::Args>| {
            args.next()
                .ok_or_else(|| format!("Missing value for {arg}"))
        };
        match arg.as_str() {
            "--help" | "-h" => {
                println!("{USAGE}");
                return Ok(());
            }
            "--assets" => assets = value(&mut args)?.into(),
            "--output" => output = Some(PathBuf::from(value(&mut args)?)),
            "--provider" => {
                provider = match value(&mut args)?.as_str() {
                    "cpu" => Provider::Cpu,
                    "coreml" => Provider::Coreml,
                    _ => return Err("Provider must be cpu or coreml".into()),
                }
            }
            "--crop" => {
                let values = value(&mut args)?
                    .split(',')
                    .map(str::parse::<u32>)
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                crop = Some(<[u32; 4]>::try_from(values).map_err(|_| "Crop must be X,Y,W,H")?);
            }
            "--repeat" => {
                repeat = value(&mut args)?
                    .parse()
                    .map_err(|_| "Invalid repeat count")?
            }
            "--strength" => strength = value(&mut args)?.parse().map_err(|_| "Invalid strength")?,
            "--inspect" => {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&denoise::inspect(
                        args.map(PathBuf::from).collect()
                    ))
                    .map_err(|e| e.to_string())?
                );
                return Ok(());
            }
            _ if arg.starts_with('-') => return Err(format!("Unknown option {arg}\n{USAGE}")),
            _ => {
                if input.replace(PathBuf::from(arg)).is_some() {
                    return Err(USAGE.into());
                }
            }
        }
    }
    let input = input.ok_or(USAGE)?;
    let output = output.ok_or(USAGE)?;
    if output.exists() {
        return Err(format!(
            "Output directory already exists: {}",
            output.display()
        ));
    }
    if repeat == 0 || repeat > 10 {
        return Err("Repeat must be between 1 and 10".into());
    }
    if !strength.is_finite() || !(0.0..=1.0).contains(&strength) {
        return Err("Strength must be between 0 and 1".into());
    }
    let runtime: serde_json::Value = serde_json::from_slice(
        &std::fs::read(assets.join("runtime.json"))
            .map_err(|e| format!("Read runtime.json: {e}. Run python3 tools/denoise/setup.py"))?,
    )
    .map_err(|e| e.to_string())?;
    let library = assets.join(
        runtime["library"]
            .as_str()
            .ok_or("Missing runtime library path")?,
    );
    let start = Instant::now();
    let mut denoiser = Denoiser::open(
        &library,
        &assets.join("model_linear.onnx"),
        provider,
        &assets.join("coreml-cache"),
    )?;
    let session_seconds = start.elapsed().as_secs_f64();
    let start = Instant::now();
    let (mut source, metadata) = denoise::decode_raw(&input)?;
    let decode_seconds = start.elapsed().as_secs_f64();
    if let Some([x, y, w, h]) = crop {
        if w == 0
            || h == 0
            || x.checked_add(w).is_none_or(|v| v > source.width())
            || y.checked_add(h).is_none_or(|v| v > source.height())
        {
            return Err(format!(
                "Crop outside {}x{} image",
                source.width(),
                source.height()
            ));
        }
        source = image::imageops::crop_imm(&source, x, y, w, h).to_image();
    }
    let mut runs = Vec::new();
    let mut denoised = Rgb32FImage::new(0, 0);
    for run in 0..repeat {
        eprintln!(
            "Run {}/{repeat}: {}x{} {provider:?}",
            run + 1,
            source.width(),
            source.height()
        );
        let (image, stats) = denoiser.process(&source, strength, |done, total| {
            if done == 1 || done % 10 == 0 || done == total {
                eprintln!("  tile {done}/{total}");
            }
        })?;
        runs.push(stats);
        denoised = image;
    }
    let channel_means = |image: &Rgb32FImage| -> [f64; 3] {
        let n = image.width() as f64 * image.height() as f64;
        let mut sum = [0.0; 3];
        for p in image.pixels() {
            for c in 0..3 {
                sum[c] += p[c] as f64 / n;
            }
        }
        sum
    };
    let mut mse = 0.0f64;
    let mut max_change = 0.0f32;
    for (a, b) in source.as_raw().iter().zip(denoised.as_raw()) {
        let d = a - b;
        mse += (d as f64).powi(2) / source.as_raw().len() as f64;
        max_change = max_change.max(d.abs());
    }
    let report = json!({
        "experiment": "RawNIND linear v1; no lens correction, DCP, sharpening or creative edits",
        "source_file": input.file_name().map(|name| name.to_string_lossy()),
        "model_sha256": denoise::MODEL_SHA256, "runtime": runtime,
        "provider_requested": provider, "metadata": metadata, "crop": crop,
        "processed_size": source.dimensions(), "strength": strength,
        "session_seconds": session_seconds, "decode_seconds": decode_seconds, "runs": runs,
        "source_channel_means": channel_means(&source), "output_channel_means": channel_means(&denoised),
        "linear_rms_change": mse.sqrt(), "linear_max_change": max_change,
        "peak_resident_bytes": peak_resident_bytes(),
    });
    // A new directory avoids overwriting another experiment or any original.
    std::fs::create_dir(&output)
        .map_err(|e| format!("Create new output directory {}: {e}", output.display()))?;
    denoise::write_payload(&output.join("source.rgba16f"), &source)?;
    denoise::write_payload(&output.join("denoised.rgba16f"), &denoised)?;
    std::fs::write(
        output.join("report.json"),
        serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    println!(
        "{}",
        serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?
    );
    Ok(())
}

#[cfg(unix)]
fn peak_resident_bytes() -> Option<u64> {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
    // SAFETY: getrusage initializes the correctly-sized system rusage struct
    // on success; assume_init is reached only after that success.
    if unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) } != 0 {
        return None;
    }
    let bytes = unsafe { usage.assume_init() }.ru_maxrss as u64;
    Some(if cfg!(target_os = "macos") {
        bytes
    } else {
        bytes * 1024
    })
}
#[cfg(not(unix))]
fn peak_resident_bytes() -> Option<u64> {
    None
}
