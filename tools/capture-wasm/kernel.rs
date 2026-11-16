// Copyright (c) 2019 Ingo Weyrich (heckflosse67@gmx.de)
// Ported from RawTherapee rtengine/rt_algo.cc at commit
// b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c, via src/engine/capture.ts.
// Same tile order, double arithmetic, variance and threshold search. No fast math.
// SPDX-License-Identifier: GPL-3.0-or-later

struct Plane<'a> { w: usize, h: usize, stride: usize, data: &'a [f32] }
impl Plane<'_> {
    fn at(&self, x: usize, y: usize) -> f64 { self.data[y * self.stride + x] as f64 }
    fn variance(&self, y: usize, x: usize, size: usize) -> f64 {
        let mut avg = 0.0;
        for j in y..y + size { for i in x..x + size { avg += self.at(i, j); } }
        avg /= (size * size) as f64;
        if avg < 2000.0 || avg > 20000.0 { return f64::INFINITY; }
        let mut v = 0.0;
        for j in y..y + size { for i in x..x + size {
            let d = self.at(i, j) - avg;
            v += d * d;
        } }
        v /= (size * size) as f64 * avg;
        if avg < 2000.0 || avg > 20000.0 || v < 0.5 { f64::INFINITY } else { v }
    }
    fn contrast(&self, x: usize, y: usize) -> f64 {
        let x = x.max(2).min(self.w - 3);
        let y = y.max(2).min(self.h - 3);
        let a = self.at(x + 1, y) - self.at(x - 1, y);
        let b = self.at(x, y + 1) - self.at(x, y - 1);
        let c = self.at(x + 2, y) - self.at(x - 2, y);
        let d = self.at(x, y + 2) - self.at(x, y - 2);
        ((a * a + b * b + c * c + d * d).sqrt() * 0.0625) / 327.68
    }
    fn threshold(&self, y: usize, x: usize, size: usize) -> f64 {
        let mut contrasts = [0.0; 76 * 76];
        let mut n = 0;
        for j in y + 2..y + size - 2 { for i in x + 2..x + size - 2 {
            contrasts[n] = self.contrast(i, j); n += 1;
        } }
        let limit = ((size - 4) * (size - 4)) as f64 / 100.0;
        let mut c = 1;
        while c < 100 {
            let t = c as f64 / 100.0;
            let mut sum = 0.0;
            for &v in &contrasts[..n] {
                let x = -16.0 + (16.0 / t) * v;
                sum += 0.5 * (1.0 + x / (1.0 + x * x).sqrt());
            }
            if sum <= limit { break; }
            c += 1;
        }
        (c + 1) as f64 / 100.0
    }
    fn auto(&self, blocks: &mut [[f64; 2]]) -> f64 {
        let mut best = (f64::INFINITY, 0, 0);
        for ty in 0..self.h / 80 { for tx in 0..self.w / 80 {
            let v = self.variance(ty * 80, tx * 80, 80);
            if v < best.0 { best = (v, ty * 80, tx * 80); }
        } }
        if best.0 <= 1.0 { return self.threshold(best.1, best.2, 80); }
        // The overlapping 40px search otherwise revisits each pixel sixteen times
        // for both mean and variance. Moments of 10px blocks only reject candidates
        // that cannot win; every contender is still evaluated in the reference order
        // with the original two-pass variance. Near ties and eligibility boundaries
        // always take that exact path.
        let bw = self.w / 10;
        for by in 0..self.h / 10 { for bx in 0..bw {
            let mut sum = 0.0;
            let mut square = 0.0;
            for y in by * 10..by * 10 + 10 { for x in bx * 10..bx * 10 + 10 {
                let v = self.at(x, y);
                sum += v; square += v * v;
            } }
            blocks[by * bw + bx] = [sum, square];
        } }
        best = (f64::INFINITY, 0, 0);
        for ty in 0..(self.h / 10).saturating_sub(3) { for tx in 0..(self.w / 10).saturating_sub(3) {
            let mut sum = 0.0;
            let mut square = 0.0;
            for by in ty..ty + 4 { for bx in tx..tx + 4 {
                let b = blocks[by * bw + bx]; sum += b[0]; square += b[1];
            } }
            let avg = sum / 1600.0;
            let mean_square = square / 1600.0;
            // These bounds exceed the accumulated f64 rounding error of the 100-
            // sample blocks, 16-block combination and reference's 1600-sample sums
            // by over three orders of magnitude for finite f32 lightness inputs.
            let mean_error = 1e-9 * (mean_square.sqrt() + 1.0);
            if avg + mean_error < 2000.0 || avg - mean_error > 20000.0 { continue; }
            let variance = (mean_square - avg * avg) / avg;
            let error = 1e-9 * (avg.abs() + (mean_square / avg).abs() + variance.abs() + 1.0);
            if variance.is_finite() && (variance + error < 0.5 || variance - error > best.0) { continue; }
            let v = self.variance(ty * 10, tx * 10, 40);
            if v < best.0 { best = (v, ty * 10, tx * 10); }
        } }
        let mut fine = (f64::INFINITY, 0, 0);
        if self.w >= 40 && self.h >= 40 {
            for y in best.1.saturating_sub(10)..=(best.1 + 10).min(self.h - 40) {
                for x in best.2.saturating_sub(10)..=(best.2 + 10).min(self.w - 40) {
                    let v = self.variance(y, x, 40);
                    if v < fine.0 { fine = (v, y, x); }
                }
            }
        }
        if fine.0 <= 8.0 { self.threshold(fine.1, fine.2, 40) } else { 0.0 }
    }
}

// JS grows and fills this fresh instance's memory directly with the GPU readback.
// No allocator, second full-image copy or permanently retained pixel buffer.
#[no_mangle]
pub extern "C" fn scratch() -> usize {
    unsafe extern "C" { static __heap_base: u8; }
    &raw const __heap_base as usize
}

#[no_mangle]
pub unsafe extern "C" fn auto_contrast(data: *const f32, w: usize, h: usize, stride: usize, moments: *mut [f64; 2]) -> f64 {
    Plane { w, h, stride, data: std::slice::from_raw_parts(data, stride * h) }
        .auto(std::slice::from_raw_parts_mut(moments, (w / 10) * (h / 10)))
}
