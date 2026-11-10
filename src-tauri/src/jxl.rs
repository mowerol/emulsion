// SPDX-License-Identifier: GPL-3.0-or-later
//! JPEG XL tiles of DNG 1.7 files, decoded for LibRaw.
//!
//! LibRaw only decodes DNG compression 52546 (JPEG XL) when built with Adobe's DNG SDK and
//! libjxl; otherwise it leaves `jxl_dng_load_raw_placeholder`. Our vendored copy fills that
//! loader in `vendor/libraw/src/decoders/dng.cpp` the way LibRaw's own tiled loaders work, and
//! calls [`emu_jxl_decode_tile`] for each tile's pixels. Decoding uses jxl-oxide (pure Rust,
//! conformance tested), which keeps the build free of another C++ codec.
//!
//! Apple ProRAW (48 MP, iOS 26) and DxO PureRAW 6 write these files.

use jxl_oxide::JxlImage;
use std::ffi::c_int;

/// The tile's samples as stored integers, interleaved, clamped to the DNG's `bits` per sample.
///
/// The integer range comes from the codestream's own bit depth, not the DNG's: Apple's 48 MP
/// ProRAW declares 10 bits per sample in the DNG but codes its tiles as 16-bit JPEG XL whose
/// values stay within 0..=1023 (the indices of its 1024-entry LinearizationTable).
pub fn decode_tile(data: &[u8], bits: u32) -> Result<(u32, u32, u32, Vec<u16>), String> {
    if !(1..=16).contains(&bits) {
        return Err(format!("unsupported DNG sample depth {bits}"));
    }
    let image = JxlImage::builder().read(data).map_err(|e| format!("JPEG XL: {e}"))?;
    let coded = match image.image_header().metadata.bit_depth {
        jxl_oxide::image::BitDepth::IntegerSample { bits_per_sample } if (1..=16).contains(&bits_per_sample) => bits_per_sample,
        other => return Err(format!("unsupported JPEG XL sample format {other:?}")),
    };
    let render = image.render_frame(0).map_err(|e| format!("JPEG XL: {e}"))?;
    let mut stream = render.stream_no_alpha();
    let (w, h, c) = (stream.width(), stream.height(), stream.channels());
    let mut buf = vec![0f32; w as usize * h as usize * c as usize];
    stream.write_to_buffer(&mut buf);
    // jxl-oxide maps the coded range 0..=2^coded - 1 to 0..=1; undo that.
    let scale = ((1u32 << coded) - 1) as f32;
    let max = ((1u32 << bits) - 1) as f32;
    let out = buf.iter().map(|v| (v * scale).round().clamp(0.0, max) as u16).collect();
    Ok((w, h, c, out))
}

/// Decode one JPEG XL tile for LibRaw. On success `*pixels` holds `width × height × channels`
/// stored sample values, to be freed with [`emu_jxl_free`].
///
/// # Safety
/// `data` must point at `len` readable bytes and the out pointers must be valid.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn emu_jxl_decode_tile(
    data: *const u8,
    len: usize,
    bits: c_int,
    width: *mut c_int,
    height: *mut c_int,
    channels: *mut c_int,
    pixels: *mut *mut u16,
) -> c_int {
    if data.is_null() || len == 0 {
        return 1;
    }
    let bytes = unsafe { std::slice::from_raw_parts(data, len) };
    let result = std::panic::catch_unwind(|| decode_tile(bytes, bits.max(0) as u32));
    match result {
        Ok(Ok((w, h, c, values))) => {
            let boxed = values.into_boxed_slice();
            unsafe {
                *width = w as c_int;
                *height = h as c_int;
                *channels = c as c_int;
                *pixels = Box::into_raw(boxed) as *mut u16;
            }
            0
        }
        Ok(Err(e)) => {
            eprintln!("[raw] {e}");
            1
        }
        Err(_) => 1,
    }
}

/// Free pixels from [`emu_jxl_decode_tile`].
///
/// # Safety
/// `pixels` and `count` must come from one successful `emu_jxl_decode_tile` call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn emu_jxl_free(pixels: *mut u16, count: usize) {
    if !pixels.is_null() {
        drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(pixels, count)) });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_garbage_without_panicking() {
        assert!(decode_tile(b"not a jpeg xl stream", 10).is_err());
        assert!(decode_tile(&[0xff, 0x0a], 10).is_err());
        assert!(decode_tile(&[], 0).is_err());
    }

    #[test]
    #[ignore = "set EMULSION_JXL_TILE to a tile extracted from a DNG, and EMULSION_JXL_BITS to its BitsPerSample"]
    fn decodes_a_real_tile() {
        let data = std::fs::read(std::env::var("EMULSION_JXL_TILE").unwrap()).unwrap();
        let bits: u32 = std::env::var("EMULSION_JXL_BITS").map(|b| b.parse().unwrap()).unwrap_or(16);
        let (w, h, c, v) = decode_tile(&data, bits).unwrap();
        assert_eq!(v.len(), (w * h * c) as usize);
        let max = *v.iter().max().unwrap();
        let mean = v.iter().map(|&x| x as f64).sum::<f64>() / v.len() as f64;
        eprintln!("{w}x{h}x{c}, mean {mean:.1}, max {max}");
        assert!(max < 1 << bits && mean > 1.0);
    }
}
