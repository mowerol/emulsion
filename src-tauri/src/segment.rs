// Copyright (C) 2026 darktable developers.
// Ported from darktable src/common/ai/segmentation.c (SAM encode/decode, preprocessing,
// joint-bilateral mask upsampling), src/develop/masks/object.c (_run_decoder's refinement
// passes, _keep_seed_components, _mask_iou, _find_peak_point, _compute_bbox) and
// src/common/distance_transform.c (Felzenszwalb & Huttenlocher, as adapted by Hanno Schwalm),
// at commit e58544408dc9396dde06d564aadc64bcccf65327. DenseCRF is darktable's own C++,
// vendored unchanged in vendor/darktable-densecrf.
// Only the SAM path is ported (darktable also drives SegNext). Settings are darktable's
// defaults (darktableconfig.xml.in): threshold 0.5, 2 refinement passes, boundary refinement
// on with 3 iterations, colour sigma 10, bilateral weight 10.
// SPDX-License-Identifier: GPL-3.0-or-later

use ort::{
    ep::{CoreML, coreml::ModelFormat},
    session::{Session, builder::GraphOptimizationLevel},
    value::{DynValue, Tensor},
};
use std::path::Path;

/// darktable's SAM_INPUT_SIZE.
pub const INPUT_SIZE: usize = 1024;
/// ImageNet normalisation (segmentation.c IMG_MEAN, IMG_STD).
const IMG_MEAN: [f32; 3] = [123.675, 116.28, 103.53];
const IMG_STD: [f32; 3] = [58.395, 57.12, 57.375];
/// darktable's MAX_NUM_MASKS.
const MAX_NUM_MASKS: usize = 8;

/// plugins/darkroom/masks/object/* defaults.
pub const THRESHOLD: f32 = 0.5;
pub const REFINE_PASSES: usize = 2;
pub const CRF_ITERATIONS: i32 = 3;
pub const CRF_SIGMA_COLOR: f32 = 10.0;
pub const CRF_W_BILATERAL: f32 = 10.0;
/// object.c MASK_COMPONENT_FLOOR.
const MASK_COMPONENT_FLOOR: f32 = 0.05;
/// distance_transform.h DT_DISTANCE_TRANSFORM_MAX.
const DT_MAX: f32 = 1e20;

unsafe extern "C" {
    fn dt_dense_crf_binary(
        probabilities: *mut f32,
        rgb: *const u8,
        width: i32,
        height: i32,
        sigma_spatial: f32,
        sigma_rgb: f32,
        w_spatial: f32,
        w_bilateral: f32,
        n_iterations: i32,
    );
}

/// A prompt in encoded pixels (pixel j at j). Labels as SAM's: 1 adds, 0 takes away,
/// 2 and 3 are a box's top-left and bottom-right corners.
#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct Point {
    pub x: f32,
    pub y: f32,
    pub label: i32,
}

/// segmentation.c _preprocess_image: bilinear resize so the longer side is `target`
/// (pixel-centre sampling), zero padding, ImageNet normalisation, CHW. Returns the scale.
pub fn preprocess(rgb: &[u8], width: usize, height: usize, target: usize) -> (Vec<f32>, f32) {
    let scale = target as f32 / width.max(height) as f32;
    let new_w = ((width as f32 * scale + 0.5) as usize).min(target);
    let new_h = ((height as f32 * scale + 0.5) as usize).min(target);
    let mut out = vec![0.0f32; 3 * target * target];
    for y in 0..new_h {
        let src_y = ((y as f32 + 0.5) / scale - 0.5).max(0.0);
        let y0 = src_y as usize;
        let y1 = if y0 + 1 < height { y0 + 1 } else { y0 };
        let fy = src_y - y0 as f32;
        for x in 0..new_w {
            let src_x = ((x as f32 + 0.5) / scale - 0.5).max(0.0);
            let x0 = src_x as usize;
            let x1 = if x0 + 1 < width { x0 + 1 } else { x0 };
            let fx = src_x - x0 as f32;
            for c in 0..3 {
                let v00 = rgb[(y0 * width + x0) * 3 + c] as f32;
                let v01 = rgb[(y0 * width + x1) * 3 + c] as f32;
                let v10 = rgb[(y1 * width + x0) * 3 + c] as f32;
                let v11 = rgb[(y1 * width + x1) * 3 + c] as f32;
                let val = v00 * (1.0 - fx) * (1.0 - fy)
                    + v01 * fx * (1.0 - fy)
                    + v10 * (1.0 - fx) * fy
                    + v11 * fx * fy;
                out[c * target * target + y * target + x] = (val - IMG_MEAN[c]) / IMG_STD[c];
            }
        }
    }
    (out, scale)
}

#[inline]
fn luma709(p: &[u8]) -> i32 {
    (54 * p[0] as i32 + 183 * p[1] as i32 + 19 * p[2] as i32) >> 8
}

#[inline]
fn bilinear4(v00: f32, v01: f32, v10: f32, v11: f32, fx: f32, fy: f32) -> f32 {
    v00 * (1.0 - fx) * (1.0 - fy) + v01 * fx * (1.0 - fy) + v10 * (1.0 - fx) * fy + v11 * fx * fy
}

/// segmentation.c _crop_resize_mask: the valid part of a decoder mask, upsampled to the
/// encoded size, joint-bilaterally on Rec.709 luma when a guide is given, then a sigmoid
/// (SAM gives logits).
#[allow(clippy::too_many_arguments)]
pub fn crop_resize_mask(
    src: &[f32],
    src_w: usize,
    src_h: usize,
    dst_w: usize,
    dst_h: usize,
    scale: f32,
    apply_sigmoid: bool,
    guide: Option<&[u8]>,
    sigma_range: f32,
) -> Vec<f32> {
    let valid_w = ((dst_w as f32 * scale + 0.5) as usize).min(src_w);
    let valid_h = ((dst_h as f32 * scale + 0.5) as usize).min(src_h);
    let guide = guide.filter(|g| sigma_range > 1e-4 && g.len() == dst_w * dst_h * 3);
    let mut lut = [0.0f32; 256];
    if guide.is_some() {
        let inv = 1.0 / (2.0 * sigma_range * sigma_range);
        for (i, v) in lut.iter_mut().enumerate() {
            let d = i as f32 / 255.0;
            *v = (-d * d * inv).exp();
        }
    }
    let inv_scale = if scale > 1e-6 { 1.0 / scale } else { 0.0 };
    let mut dst = vec![0.0f32; dst_w * dst_h];
    for y in 0..dst_h {
        let sy = ((y as f32 + 0.5) * scale - 0.5).max(0.0);
        let y0 = (sy as usize).min(valid_h - 1);
        let y1 = (y0 + 1).min(valid_h - 1);
        let fy = sy - y0 as f32;
        for x in 0..dst_w {
            let sx = ((x as f32 + 0.5) * scale - 0.5).max(0.0);
            let x0 = (sx as usize).min(valid_w - 1);
            let x1 = (x0 + 1).min(valid_w - 1);
            let fx = sx - x0 as f32;
            let v00 = src[y0 * src_w + x0];
            let v01 = src[y0 * src_w + x1];
            let v10 = src[y1 * src_w + x0];
            let v11 = src[y1 * src_w + x1];
            let mut val = match guide {
                None => bilinear4(v00, v01, v10, v11, fx, fy),
                Some(g) => {
                    let gw = dst_w as i32;
                    let gh = dst_h as i32;
                    let at = |gx: i32, gy: i32| luma709(&g[((gy * gw + gx) * 3) as usize..]);
                    let luma_ref = at(x as i32, y as i32);
                    let pos = |i: usize| (i as f32 + 0.5) * inv_scale - 0.5;
                    let ix = |v: f32, n: i32| ((v + 0.5) as i32).clamp(0, n - 1);
                    let ix00 = ix(pos(x0), gw);
                    let ix01 = ix(pos(x1), gw);
                    let iy00 = ix(pos(y0), gh);
                    let iy01 = ix(pos(y1), gh);
                    let r00 = lut[(luma_ref - at(ix00, iy00)).unsigned_abs() as usize];
                    let r01 = lut[(luma_ref - at(ix01, iy00)).unsigned_abs() as usize];
                    let r10 = lut[(luma_ref - at(ix00, iy01)).unsigned_abs() as usize];
                    let r11 = lut[(luma_ref - at(ix01, iy01)).unsigned_abs() as usize];
                    let w00 = (1.0 - fx) * (1.0 - fy) * r00;
                    let w01 = fx * (1.0 - fy) * r01;
                    let w10 = (1.0 - fx) * fy * r10;
                    let w11 = fx * fy * r11;
                    let wsum = w00 + w01 + w10 + w11;
                    if wsum > 1e-6 {
                        (v00 * w00 + v01 * w01 + v10 * w10 + v11 * w11) / wsum
                    } else {
                        bilinear4(v00, v01, v10, v11, fx, fy)
                    }
                }
            };
            if apply_sigmoid {
                val = 1.0 / (1.0 + (-val).exp());
            }
            dst[y * dst_w + x] = val;
        }
    }
    dst
}

/// distance_transform.c _image_distance_transform: the 1-D lower envelope of parabolas.
fn dt_1d(f: &[f32], z: &mut [f32], d: &mut [f32], v: &mut [usize], n: usize) {
    let sq = |q: usize| (q as f32) * (q as f32);
    let mut k = 0usize;
    v[0] = 0;
    z[0] = -DT_MAX;
    z[1] = DT_MAX;
    for q in 1..n {
        let mut s = (f[q] + sq(q)) - (f[v[k]] + sq(v[k]));
        while s <= z[k] * (2 * q - 2 * v[k]) as f32 {
            k -= 1;
            s = (f[q] + sq(q)) - (f[v[k]] + sq(v[k]));
        }
        s /= (2 * q - 2 * v[k]) as f32;
        k += 1;
        v[k] = q;
        z[k] = s;
        z[k + 1] = DT_MAX;
    }
    k = 0;
    for (q, dq) in d.iter_mut().enumerate().take(n) {
        while z[k + 1] < q as f32 {
            k += 1;
        }
        let dx = q as f32 - v[k] as f32;
        *dq = dx * dx + f[v[k]];
    }
}

/// dt_image_distance_transform with DT_DISTANCE_TRANSFORM_MASK: Euclidean distance to the
/// nearest pixel below `clip`. Returns the field and its maximum.
pub fn distance_transform(src: &[f32], width: usize, height: usize, clip: f32) -> (Vec<f32>, f32) {
    let mut out: Vec<f32> = src.iter().map(|&v| if v < clip { 0.0 } else { DT_MAX }).collect();
    let maxdim = width.max(height);
    let mut f = vec![0.0f32; maxdim];
    let mut z = vec![0.0f32; maxdim + 1];
    let mut d = vec![0.0f32; maxdim];
    let mut v = vec![0usize; maxdim];
    for x in 0..width {
        for y in 0..height {
            f[y] = out[y * width + x];
        }
        dt_1d(&f, &mut z, &mut d, &mut v, height);
        for y in 0..height {
            out[y * width + x] = d[y];
        }
    }
    let mut max = 0.0f32;
    for y in 0..height {
        f[..width].copy_from_slice(&out[y * width..(y + 1) * width]);
        dt_1d(&f, &mut z, &mut d, &mut v, width);
        for x in 0..width {
            let val = d[x].sqrt();
            out[y * width + x] = val;
            max = max.max(val);
        }
    }
    (out, max)
}

/// object.c _mask_iou.
pub fn mask_iou(a: &[f32], b: &[f32], threshold: f32) -> f32 {
    let (mut inter, mut uni) = (0usize, 0usize);
    for (&x, &y) in a.iter().zip(b) {
        let (a, b) = (x > threshold, y > threshold);
        inter += (a & b) as usize;
        uni += (a | b) as usize;
    }
    if uni > 0 { inter as f32 / uni as f32 } else { 0.0 }
}

/// object.c _find_peak_point: the deepest interior point (at least 4 px deep), away from the
/// positive prompts by `min_separation`.
pub fn find_peak_point(
    mask: &[f32],
    w: usize,
    h: usize,
    threshold: f32,
    exclude: &[Point],
    min_separation: f32,
) -> Option<Point> {
    let min_depth = 4.0f32;
    let (mut dist, max_dist) = distance_transform(mask, w, h, threshold);
    if max_dist <= min_depth {
        return None;
    }
    let sep_sq = min_separation * min_separation;
    for p in exclude.iter().filter(|p| p.label == 1) {
        let x0 = ((p.x - min_separation) as i32).max(0);
        let x1 = ((p.x + min_separation) as i32).min(w as i32 - 1);
        let y0 = ((p.y - min_separation) as i32).max(0);
        let y1 = ((p.y + min_separation) as i32).min(h as i32 - 1);
        for y in y0..=y1 {
            for x in x0..=x1 {
                let dx = x as f32 - p.x;
                let dy = y as f32 - p.y;
                if dx * dx + dy * dy < sep_sq {
                    dist[y as usize * w + x as usize] = 0.0;
                }
            }
        }
    }
    let mut best = min_depth;
    let mut best_idx = None;
    for (i, &d) in dist.iter().enumerate() {
        if d > best {
            best = d;
            best_idx = Some(i);
        }
    }
    best_idx.map(|i| Point { x: (i % w) as f32, y: (i / w) as f32, label: 1 })
}

/// object.c _compute_bbox: the box around mask > threshold, padded by `padding` of its size.
pub fn compute_bbox(mask: &[f32], w: usize, h: usize, threshold: f32, padding: f32) -> Option<(Point, Point)> {
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
    for y in 0..h {
        for x in 0..w {
            if mask[y * w + x] > threshold {
                min_x = min_x.min(x as i32);
                min_y = min_y.min(y as i32);
                max_x = max_x.max(x as i32);
                max_y = max_y.max(y as i32);
            }
        }
    }
    if max_x == i32::MIN {
        return None;
    }
    let pad_x = ((max_x - min_x) as f32 * padding) as i32 + 1;
    let pad_y = ((max_y - min_y) as f32 * padding) as i32 + 1;
    let (w, h) = (w as i32, h as i32);
    Some((
        Point { x: (min_x - pad_x).clamp(0, w - 1) as f32, y: (min_y - pad_y).clamp(0, h - 1) as f32, label: 2 },
        Point { x: (max_x + pad_x).clamp(0, w - 1) as f32, y: (max_y + pad_y).clamp(0, h - 1) as f32, label: 3 },
    ))
}

const KEPT: i32 = -2;

/// object.c _mark_area_kept.
fn mark_area_kept(labels: &mut [i32], stack: &mut Vec<usize>, w: usize, h: usize, start: usize) {
    let label = labels[start];
    stack.clear();
    stack.push(start);
    labels[start] = KEPT;
    while let Some(p) = stack.pop() {
        let (px, py) = (p % w, p / w);
        for (ok, q) in [(py > 0, p.wrapping_sub(w)), (py < h - 1, p + w), (px > 0, p.wrapping_sub(1)), (px < w - 1, p + 1)] {
            if ok && labels[q] == label {
                labels[q] = KEPT;
                stack.push(q);
            }
        }
    }
}

/// object.c _keep_seed_components: keep the areas the positive prompts are in (or the largest),
/// each a core above the threshold with its soft edge down to 0.05, and zero the rest.
pub fn keep_seed_components(mask: &mut [f32], w: usize, h: usize, threshold: f32, prompts: &[Point]) {
    let npix = w * h;
    let mut labels = vec![0i32; npix];
    let mut stack: Vec<usize> = Vec::with_capacity(npix);
    let mut n_labels = 0i32;
    let mut best_area = 0usize;
    let mut best_start = None;
    for i in 0..npix {
        if mask[i] <= threshold || labels[i] != 0 {
            continue;
        }
        if n_labels >= i16::MAX as i32 {
            for k in i..npix {
                if mask[k] > threshold && labels[k] == 0 {
                    labels[k] = -1;
                }
            }
            break;
        }
        n_labels += 1;
        let label = n_labels;
        let mut area = 0usize;
        stack.clear();
        stack.push(i);
        labels[i] = label;
        while let Some(p) = stack.pop() {
            area += 1;
            let (px, py) = (p % w, p / w);
            for (ok, q) in [(py > 0, p.wrapping_sub(w)), (py < h - 1, p + w), (px > 0, p.wrapping_sub(1)), (px < w - 1, p + 1)] {
                if ok && labels[q] == 0 && mask[q] > threshold {
                    labels[q] = label;
                    stack.push(q);
                }
            }
        }
        if area > best_area {
            best_area = area;
            best_start = Some(i);
        }
    }
    let Some(best_start) = best_start else { return };
    // Grow every core's edge at once, breadth first, so each edge pixel goes to the nearest core.
    let mut queue: Vec<usize> = (0..npix).filter(|&i| labels[i] > 0).collect();
    let mut head = 0;
    while head < queue.len() {
        let p = queue[head];
        head += 1;
        let label = labels[p];
        let (px, py) = (p % w, p / w);
        for (ok, q) in [(py > 0, p.wrapping_sub(w)), (py < h - 1, p + w), (px > 0, p.wrapping_sub(1)), (px < w - 1, p + 1)] {
            if ok && labels[q] == 0 && mask[q] > MASK_COMPONENT_FLOOR {
                labels[q] = label;
                queue.push(q);
            }
        }
    }
    let mut any = false;
    for p in prompts.iter().filter(|p| p.label == 1) {
        // C's lrintf rounds half to even.
        let sx = (p.x.round_ties_even() as i32).clamp(0, w as i32 - 1) as usize;
        let sy = (p.y.round_ties_even() as i32).clamp(0, h as i32 - 1) as usize;
        let s = sy * w + sx;
        if labels[s] > 0 {
            mark_area_kept(&mut labels, &mut stack, w, h, s);
        }
        any |= labels[s] == KEPT;
    }
    if !any {
        mark_area_kept(&mut labels, &mut stack, w, h, best_start);
    }
    for i in 0..npix {
        if labels[i] != KEPT {
            mask[i] = 0.0;
        }
    }
}

/// darktable's dt_dense_crf_binary, as _run_decoder calls it (spatial sigma 5, weight 3).
pub fn dense_crf(mask: &mut [f32], rgb: &[u8], w: usize, h: usize) {
    assert_eq!(mask.len(), w * h);
    assert_eq!(rgb.len(), w * h * 3);
    unsafe {
        dt_dense_crf_binary(
            mask.as_mut_ptr(),
            rgb.as_ptr(),
            w as i32,
            h as i32,
            5.0,
            CRF_SIGMA_COLOR,
            3.0,
            CRF_W_BILATERAL,
            CRF_ITERATIONS,
        );
    }
}

/// A loaded SAM model: the encoder (CoreML where it works) and the decoder (CPU, without
/// graph optimisation, as darktable loads it).
pub struct Sam {
    encoder: Session,
    decoder: Session,
    /// Decoder input i takes encoder output enc_order[i].
    enc_order: Vec<usize>,
    num_masks: usize,
    dec_h: usize,
    dec_w: usize,
    prev_mask_dim: usize,
    low_res: bool,
}

/// One photo's encoding: the encoder outputs and the render they came from.
pub struct Encoding {
    pub width: usize,
    pub height: usize,
    pub scale: f32,
    outputs: Vec<(Vec<i64>, Vec<f32>)>,
    pub rgb: Vec<u8>,
    prev_mask: Vec<f32>,
    has_prev_mask: bool,
}

fn shape_of(v: &ort::value::ValueType) -> Vec<i64> {
    v.tensor_shape().map(|s| s.to_vec()).unwrap_or_default()
}

impl Encoding {
    /// dt_seg_reset_prev_mask: a new selection, with no earlier mask to start from.
    pub fn reset(&mut self) {
        self.prev_mask.fill(0.0);
        self.has_prev_mask = false;
    }
}

impl Sam {
    /// Loads encoder.onnx and decoder.onnx from a darktable model folder. ONNX Runtime must
    /// already be initialised (ai_runtime). `coreml_cache` enables CoreML for the encoder.
    pub fn open(dir: &Path, coreml_cache: Option<&Path>) -> Result<Self, String> {
        let e = |e: ort::Error| e.to_string();
        let mut eb = Session::builder()
            .map_err(e)?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(e)?
            .with_intra_threads(4)
            .map_err(e)?;
        if let Some(cache) = coreml_cache {
            std::fs::create_dir_all(cache).map_err(|e| e.to_string())?;
            eb = eb
                .with_execution_providers([CoreML::default()
                    .with_model_format(ModelFormat::MLProgram)
                    .with_static_input_shapes(true)
                    .with_model_cache_dir(cache.display().to_string())
                    .build()
                    .error_on_failure()])
                .map_err(e)?;
        }
        let encoder = eb.commit_from_file(dir.join("encoder.onnx")).map_err(e)?;
        let decoder = Session::builder()
            .map_err(e)?
            .with_optimization_level(GraphOptimizationLevel::Disable)
            .map_err(e)?
            .commit_from_file(dir.join("decoder.onnx"))
            .map_err(e)?;

        let n_enc = encoder.outputs().len();
        if n_enc == 0 || n_enc > 4 {
            return Err(format!("Unsupported SAM encoder ({n_enc} outputs)"));
        }
        // segmentation.c: match decoder inputs to encoder outputs by name, exact first.
        let enc_names: Vec<&str> = encoder.outputs().iter().map(|o| o.name()).collect();
        let mut enc_order: Vec<usize> = (0..n_enc).collect();
        let mut used = vec![false; n_enc];
        for (di, input) in decoder.inputs().iter().take(n_enc).enumerate() {
            let dec = input.name();
            let mut best = None;
            for (ei, enc) in enc_names.iter().enumerate() {
                if used[ei] {
                    continue;
                }
                if *enc == dec {
                    best = Some(ei);
                    break;
                }
                if best.is_none() && (enc.contains(dec) || dec.contains(enc)) {
                    best = Some(ei);
                }
            }
            if let Some(b) = best {
                enc_order[di] = b;
                used[b] = true;
            }
        }
        let outs = decoder.outputs();
        let mask_shape = shape_of(outs[0].dtype());
        let mut num_masks = if mask_shape.len() >= 4 && mask_shape[1] > 1 { mask_shape[1] as usize } else { 0 };
        if num_masks == 0 {
            let iou = outs.get(1).map(|o| shape_of(o.dtype())).unwrap_or_default();
            num_masks = if iou.len() >= 2 && iou[1] > 0 { iou[1] as usize } else { 1 };
        }
        let num_masks = num_masks.min(MAX_NUM_MASKS);
        let dim = |i: usize| (mask_shape.len() >= 4 && mask_shape[i] > 0).then(|| mask_shape[i] as usize);
        let dec_h = dim(2).unwrap_or(INPUT_SIZE);
        let dec_w = dim(3).unwrap_or(INPUT_SIZE);
        let mut prev_mask_dim = 256;
        let low_res = outs.len() >= 3;
        if let Some(o) = outs.get(2) {
            let s = shape_of(o.dtype());
            if s.len() >= 4 && s[2] > 0 && s[3] > 0 {
                prev_mask_dim = s[2] as usize;
            }
        }
        Ok(Self { encoder, decoder, enc_order, num_masks, dec_h, dec_w, prev_mask_dim, low_res })
    }

    /// dt_seg_encode_image: encode an 8-bit RGB render (darktable renders at 1536 px).
    pub fn encode(&mut self, rgb: Vec<u8>, width: usize, height: usize) -> Result<Encoding, String> {
        if rgb.len() != width * height * 3 || width == 0 || height == 0 {
            return Err("Bad render for segmentation".into());
        }
        let (input, scale) = preprocess(&rgb, width, height, INPUT_SIZE);
        let tensor = Tensor::from_array(([1usize, 3, INPUT_SIZE, INPUT_SIZE], input)).map_err(|e| e.to_string())?;
        let name = self.encoder.inputs()[0].name().to_string();
        let outputs = self
            .encoder
            .run(ort::inputs![name => tensor])
            .map_err(|e| e.to_string())?;
        let mut cached = vec![];
        for (_, value) in outputs.iter() {
            let (shape, data) = value.try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
            cached.push((shape.to_vec(), data.to_vec()));
        }
        Ok(Encoding {
            width,
            height,
            scale,
            outputs: cached,
            rgb,
            prev_mask: vec![0.0; self.prev_mask_dim * self.prev_mask_dim],
            has_prev_mask: false,
        })
    }

    /// dt_seg_compute_mask: one decode of the points (encoded pixels), the best mask by
    /// predicted IoU, upsampled to the encoded size as probabilities.
    pub fn compute_mask(&mut self, enc: &mut Encoding, points: &[Point]) -> Result<Vec<f32>, String> {
        if points.is_empty() {
            return Err("No prompts".into());
        }
        let total = points.len() + 1;
        let mut coords = Vec::with_capacity(total * 2);
        let mut labels = Vec::with_capacity(total);
        for p in points {
            coords.push(p.x * enc.scale);
            coords.push(p.y * enc.scale);
            labels.push(p.label as f32);
        }
        // SAM's ONNX padding point.
        coords.extend([0.0, 0.0]);
        labels.push(-1.0);
        let e = |e: ort::Error| e.to_string();
        let mut inputs: Vec<(String, DynValue)> = vec![];
        let names: Vec<String> = self.decoder.inputs().iter().map(|i| i.name().to_string()).collect();
        let n_enc = enc.outputs.len();
        for (di, name) in names.iter().take(n_enc).enumerate() {
            let (shape, data) = &enc.outputs[self.enc_order[di]];
            let shape: Vec<usize> = shape.iter().map(|&d| d as usize).collect();
            inputs.push((name.clone(), Tensor::from_array((shape, data.clone())).map_err(e)?.into_dyn()));
        }
        let pm = self.prev_mask_dim;
        let rest: [DynValue; 4] = [
            Tensor::from_array(([1usize, total, 2], coords)).map_err(e)?.into_dyn(),
            Tensor::from_array(([1usize, total], labels)).map_err(e)?.into_dyn(),
            Tensor::from_array(([1usize, 1, pm, pm], enc.prev_mask.clone())).map_err(e)?.into_dyn(),
            Tensor::from_array(([1usize], vec![if enc.has_prev_mask { 1.0f32 } else { 0.0 }])).map_err(e)?.into_dyn(),
        ];
        for (name, value) in names.iter().skip(n_enc).zip(rest) {
            inputs.push((name.clone(), value));
        }
        let outputs = self.decoder.run(inputs).map_err(e)?;
        let (mshape, masks) = outputs[0].try_extract_tensor::<f32>().map_err(e)?;
        let (_, iou) = outputs[1].try_extract_tensor::<f32>().map_err(e)?;
        let nm = (mshape[1] as usize).min(self.num_masks.max(1)).min(iou.len());
        let (dec_h, dec_w) = (mshape[2] as usize, mshape[3] as usize);
        let per = dec_h * dec_w;
        let mut best = 0;
        for m in 1..nm {
            if iou[m] > iou[best] {
                best = m;
            }
        }
        if self.low_res {
            let (_, low) = outputs[2].try_extract_tensor::<f32>().map_err(e)?;
            enc.prev_mask.copy_from_slice(&low[best * pm * pm..(best + 1) * pm * pm]);
        } else {
            enc.prev_mask.copy_from_slice(&masks[best * per..best * per + pm * pm]);
        }
        enc.has_prev_mask = true;
        let mask_scale = enc.scale * dec_h as f32 / INPUT_SIZE as f32;
        let _ = (self.dec_h, self.dec_w);
        Ok(crop_resize_mask(
            &masks[best * per..(best + 1) * per],
            dec_w,
            dec_h,
            enc.width,
            enc.height,
            mask_scale,
            true,
            Some(&enc.rgb),
            0.1,
        ))
    }

    /// object.c _run_decoder: decode all the prompts, refine with the mask's peak and box until
    /// it settles, keep the areas clicked, then snap to edges with DenseCRF. As in darktable,
    /// each decode starts from the last one's low-res mask; `reset` starts a new selection.
    #[allow(dead_code)] // The app runs decode and dense_crf apart, to show the mask sooner.
    pub fn run_decoder(&mut self, enc: &mut Encoding, prompts: &[Point]) -> Result<Vec<f32>, String> {
        let mut mask = self.decode(enc, prompts)?;
        dense_crf(&mut mask, &enc.rgb, enc.width, enc.height);
        Ok(mask)
    }

    /// run_decoder without the DenseCRF step, so the selection can be shown before its
    /// edges are refined.
    pub fn decode(&mut self, enc: &mut Encoding, prompts: &[Point]) -> Result<Vec<f32>, String> {
        let (w, h) = (enc.width, enc.height);
        let mut points = prompts.to_vec();
        let mut mask: Option<Vec<f32>> = None;
        let mut box_added = false;
        for pass in 0..REFINE_PASSES {
            let new_mask = self.compute_mask(enc, &points)?;
            if let Some(old) = &mask
                && mask_iou(old, &new_mask, THRESHOLD) > 0.99
            {
                mask = Some(new_mask);
                break;
            }
            mask = Some(new_mask);
            if pass + 1 >= REFINE_PASSES {
                break;
            }
            let m = mask.as_ref().unwrap();
            let mut any = false;
            if let Some(peak) = find_peak_point(m, w, h, THRESHOLD, &points, 8.0) {
                points.push(peak);
                any = true;
            }
            if !box_added && let Some((tl, br)) = compute_bbox(m, w, h, THRESHOLD, 0.05) {
                points.push(tl);
                points.push(br);
                box_added = true;
                any = true;
            }
            if !any {
                break;
            }
        }
        let mut mask = mask.ok_or("No mask")?;
        keep_seed_components(&mut mask, w, h, THRESHOLD, prompts);
        Ok(mask)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preprocess_normalises_and_pads() {
        // 4x2 grey 128 into an 8x8 target: scale 2, 8x4 content, zero padding below.
        let rgb = vec![128u8; 4 * 2 * 3];
        let (out, scale) = preprocess(&rgb, 4, 2, 8);
        assert_eq!(scale, 2.0);
        for c in 0..3 {
            let want = (128.0 - IMG_MEAN[c]) / IMG_STD[c];
            assert!((out[c * 64] - want).abs() < 1e-6);
            assert!((out[c * 64 + 3 * 8 + 7] - want).abs() < 1e-6);
            assert_eq!(out[c * 64 + 4 * 8], 0.0);
        }
    }

    #[test]
    fn distance_transform_is_euclidean() {
        // One hole in the middle of a 7x7 field.
        let mut m = vec![1.0f32; 49];
        m[3 * 7 + 3] = 0.0;
        let (d, max) = distance_transform(&m, 7, 7, 0.5);
        assert_eq!(d[3 * 7 + 3], 0.0);
        assert!((d[3 * 7 + 4] - 1.0).abs() < 1e-6);
        assert!((d[0] - (18.0f32).sqrt()).abs() < 1e-5);
        assert!((max - (18.0f32).sqrt()).abs() < 1e-5);
    }

    #[test]
    fn seed_components_keep_the_clicked_area() {
        // Two blobs; a click on the smaller keeps it and drops the larger.
        let (w, h) = (10, 3);
        let mut m = vec![0.0f32; w * h];
        for y in 0..h {
            m[y * w + 1] = 0.9;
            for x in 5..9 {
                m[y * w + x] = 0.9;
            }
        }
        m[w + 2] = 0.2; // soft edge of the small blob
        keep_seed_components(&mut m, w, h, 0.5, &[Point { x: 1.0, y: 1.0, label: 1 }]);
        assert_eq!(m[w + 1], 0.9);
        assert_eq!(m[w + 2], 0.2);
        assert_eq!(m[w + 6], 0.0);
        // No positive prompt in any blob: the largest stays.
        let mut m2 = vec![0.0f32; w * h];
        for y in 0..h {
            m2[y * w + 1] = 0.9;
            for x in 5..9 {
                m2[y * w + x] = 0.9;
            }
        }
        keep_seed_components(&mut m2, w, h, 0.5, &[Point { x: 3.0, y: 1.0, label: 1 }]);
        assert_eq!(m2[w + 1], 0.0);
        assert_eq!(m2[w + 6], 0.9);
    }

    #[test]
    fn bbox_and_peak() {
        let (w, h) = (20, 20);
        let mut m = vec![0.0f32; w * h];
        for y in 5..15 {
            for x in 5..15 {
                m[y * w + x] = 1.0;
            }
        }
        let (tl, br) = compute_bbox(&m, w, h, 0.5, 0.05).unwrap();
        assert_eq!((tl.x, tl.y, tl.label), (4.0, 4.0, 2));
        assert_eq!((br.x, br.y, br.label), (15.0, 15.0, 3));
        let p = find_peak_point(&m, w, h, 0.5, &[], 8.0).unwrap();
        assert!((9.0..=10.0).contains(&p.x) && (9.0..=10.0).contains(&p.y));
        assert_eq!(mask_iou(&m, &m, 0.5), 1.0);
    }

    #[test]
    fn upsampling_without_guide_is_bilinear_then_sigmoid() {
        // A constant logit stays constant through the resize.
        let src = vec![2.0f32; 16];
        let out = crop_resize_mask(&src, 4, 4, 8, 8, 0.5, true, None, 0.1);
        let want = 1.0 / (1.0 + (-2.0f32).exp());
        assert!(out.iter().all(|v| (v - want).abs() < 1e-6));
    }

    #[test]
    fn crf_sharpens_toward_the_edge() {
        // A soft mask across a hard colour edge is pushed to the edge's sides.
        let (w, h) = (32, 8);
        let mut rgb = vec![0u8; w * h * 3];
        let mut m = vec![0.0f32; w * h];
        for y in 0..h {
            for x in 0..w {
                if x >= 16 {
                    rgb[(y * w + x) * 3..(y * w + x) * 3 + 3].copy_from_slice(&[230, 230, 230]);
                }
                m[y * w + x] = (x as f32 / (w - 1) as f32).clamp(0.05, 0.95);
            }
        }
        let before = m.clone();
        dense_crf(&mut m, &rgb, w, h);
        assert!(m[4 * w + 2] < before[4 * w + 2]);
        assert!(m[4 * w + 29] > before[4 * w + 29]);
    }

    /// The real model on a real photo: EMULSION_SAM=<model folder> EMULSION_SAM_IMAGE=<jpeg>
    /// cargo test --release --lib sam_on_photo -- --ignored --nocapture
    #[test]
    #[ignore]
    fn sam_on_photo() {
        let dir = std::path::PathBuf::from(std::env::var("EMULSION_SAM").unwrap());
        let runtime = std::env::var("EMULSION_ORT").unwrap_or_else(|_| {
            concat!(env!("CARGO_MANIFEST_DIR"), "/target/denoise/assets/onnxruntime-osx-arm64-1.23.2/lib/libonnxruntime.1.23.2.dylib").into()
        });
        ort::init_from(runtime).unwrap().commit();
        let img = image::open(std::env::var("EMULSION_SAM_IMAGE").unwrap()).unwrap().to_rgb8();
        let k = 1536.0 / img.width().max(img.height()) as f32;
        let img = image::imageops::thumbnail(&img, (img.width() as f32 * k) as u32, (img.height() as f32 * k) as u32);
        let (w, h) = (img.width() as usize, img.height() as usize);
        let t = std::time::Instant::now();
        let cache = std::env::var("EMULSION_SAM_COREML").ok().map(std::path::PathBuf::from);
        let mut sam = Sam::open(&dir, cache.as_deref()).unwrap();
        println!("load {:?}; masks {} dec {}x{} prev {} low_res {}", t.elapsed(), sam.num_masks, sam.dec_w, sam.dec_h, sam.prev_mask_dim, sam.low_res);
        println!("enc out {:?}", sam.encoder.outputs().iter().map(|o| o.name().to_string()).collect::<Vec<_>>());
        println!("dec in {:?} order {:?}", sam.decoder.inputs().iter().map(|o| o.name().to_string()).collect::<Vec<_>>(), sam.enc_order);
        let t = std::time::Instant::now();
        let rgb = img.into_raw();
        sam.encode(rgb.clone(), w, h).unwrap();
        println!("encode {:?}", t.elapsed());
        let t = std::time::Instant::now();
        let mut enc = sam.encode(rgb, w, h).unwrap();
        println!("encode again {:?}", t.elapsed());
        let t = std::time::Instant::now();
        let click = Point { x: w as f32 / 2.0, y: h as f32 / 2.0, label: 1 };
        let one = sam.compute_mask(&mut enc, &[click]).unwrap();
        println!("one decode {:?}", t.elapsed());
        let t = std::time::Instant::now();
        let mut crf = one.clone();
        dense_crf(&mut crf, &enc.rgb, w, h);
        println!("densecrf {:?}", t.elapsed());
        enc.reset();
        let t = std::time::Instant::now();
        let mask = sam.run_decoder(&mut enc, &[click]).unwrap();
        println!("decode+refine {:?}", t.elapsed());
        let sel = mask.iter().filter(|&&v| v > 0.5).count();
        println!("selected {:.1}%", 100.0 * sel as f32 / mask.len() as f32);
        let out: Vec<u8> = mask.iter().map(|v| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8).collect();
        let path = std::env::var("EMULSION_SAM_OUT").unwrap_or_else(|_| "/tmp/sam-mask.png".into());
        image::GrayImage::from_raw(w as u32, h as u32, out).unwrap().save(&path).unwrap();
        assert!(sel > 0);
    }
}
