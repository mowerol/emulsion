// The multigrid heal solver of src/engine/heal.ts (healSolve and what it calls), compiled to
// WebAssembly with SIMD: a pixel's four channels are one f32x4. Same loops in the same order and
// the same float operations (dot products summed in f64), so the pixels and the steps taken are
// identical to the TS fallback (tested).
// SPDX-License-Identifier: GPL-3.0-or-later

use core::arch::wasm32::*;

#[repr(C)]
pub struct Level {
    w: u32,
    h: u32,
    unknown: *const u8,
    band: *const u32,
    band_red: u32,
    band_count: u32,
    diag: *const f32,
    e: *mut f32,
    r: *mut f32,
    t: *mut f32,
}

#[inline(always)]
unsafe fn ld(a: *const f32, i: usize) -> v128 { v128_load(a.add(i) as *const v128) }
#[inline(always)]
unsafe fn st(a: *mut f32, i: usize, x: v128) { v128_store(a.add(i) as *mut v128, x) }
#[inline(always)]
fn high(x: v128) -> v128 { i32x4_shuffle::<2, 3, 0, 1>(x, x) }

#[inline(always)]
unsafe fn relax(e: *mut f32, r: *const f32, diag: *const f32, v: usize, p: usize) {
    let i = 4 * p;
    let sum = f32x4_add(f32x4_add(f32x4_add(f32x4_add(ld(r, i), ld(e, i - v)), ld(e, i - 4)), ld(e, i + 4)), ld(e, i + v));
    st(e, i, f32x4_div(sum, f32x4_splat(*diag.add(p))));
}

unsafe fn smooth(l: &Level, e: *mut f32, r: *const f32, colour: usize) {
    let (w, h) = (l.w as usize, l.h as usize);
    let s = w + 2;
    let v = 4 * s;
    for y in 0..h {
        let mut x = (y + colour) & 1;
        while x < w {
            let p = (y + 1) * s + x + 1;
            if *l.unknown.add(p) != 0 { relax(e, r, l.diag, v, p); }
            x += 2;
        }
    }
}

unsafe fn smooth_band(l: &Level, e: *mut f32, r: *const f32, colour: usize) {
    let v = 4 * (l.w as usize + 2);
    let (from, to) = if colour != 0 { (l.band_red, l.band_count) } else { (0, l.band_red) };
    for j in from..to { relax(e, r, l.diag, v, *l.band.add(j as usize) as usize); }
}

/// out = A e (summing e·out into dots in f64), or out = r − A e when r is given.
unsafe fn apply(l: &Level, e: *const f32, out: *mut f32, r: *const f32, dots: &mut [f64; 4]) {
    let (w, h) = (l.w as usize, l.h as usize);
    let s = w + 2;
    let v = 4 * s;
    let (mut lo, mut hi) = (f64x2_splat(0.0), f64x2_splat(0.0));
    for y in 0..h {
        for x in 0..w {
            let p = (y + 1) * s + x + 1;
            if *l.unknown.add(p) == 0 { continue; }
            let i = 4 * p;
            let c = ld(e, i);
            let around = f32x4_add(f32x4_add(f32x4_add(ld(e, i - v), ld(e, i - 4)), ld(e, i + 4)), ld(e, i + v));
            let a = f32x4_sub(f32x4_mul(f32x4_splat(*l.diag.add(p)), c), around);
            if !r.is_null() {
                st(out, i, f32x4_sub(ld(r, i), a));
            } else {
                st(out, i, a);
                lo = f64x2_add(lo, f64x2_mul(f64x2_promote_low_f32x4(c), f64x2_promote_low_f32x4(a)));
                hi = f64x2_add(hi, f64x2_mul(f64x2_promote_low_f32x4(high(c)), f64x2_promote_low_f32x4(high(a))));
            }
        }
    }
    *dots = [f64x2_extract_lane::<0>(lo), f64x2_extract_lane::<1>(lo), f64x2_extract_lane::<0>(hi), f64x2_extract_lane::<1>(hi)];
}

#[inline(always)]
fn across(i: usize, n: usize) -> usize {
    let c = (i >> 1) as isize;
    let j = if i & 1 != 0 { c + 1 } else { c - 1 };
    if j < 0 || j >= n as isize { c as usize } else { j as usize }
}

unsafe fn restrict(f: &Level, t: *const f32, c: &Level, rc: *mut f32) {
    let (cw, ch) = (c.w as usize, c.h as usize);
    let cs = cw + 2;
    for i in 0..4 * cs * (ch + 2) { *rc.add(i) = 0.0; }
    let (near, side, far) = (f32x4_splat(0.5625), f32x4_splat(0.1875), f32x4_splat(0.0625));
    let fs = f.w as usize + 2;
    for y in 0..f.h as usize {
        let jj = (y >> 1) + 1;
        let j2 = across(y, ch) + 1;
        for x in 0..f.w as usize {
            let p = (y + 1) * fs + x + 1;
            if *f.unknown.add(p) == 0 { continue; }
            let ii = (x >> 1) + 1;
            let i2 = across(x, cw) + 1;
            let val = ld(t, 4 * p);
            // The four targets in this order: they coincide at the edges.
            let a = 4 * (jj * cs + ii);
            st(rc, a, f32x4_add(ld(rc, a), f32x4_mul(near, val)));
            let b = 4 * (jj * cs + i2);
            st(rc, b, f32x4_add(ld(rc, b), f32x4_mul(side, val)));
            let cc = 4 * (j2 * cs + ii);
            st(rc, cc, f32x4_add(ld(rc, cc), f32x4_mul(side, val)));
            let d = 4 * (j2 * cs + i2);
            st(rc, d, f32x4_add(ld(rc, d), f32x4_mul(far, val)));
        }
    }
}

unsafe fn prolong(c: &Level, ec: *const f32, f: &Level, e: *mut f32) {
    let (cw, ch) = (c.w as usize, c.h as usize);
    let cs = cw + 2;
    let (near, side, far) = (f32x4_splat(0.5625), f32x4_splat(0.1875), f32x4_splat(0.0625));
    let fs = f.w as usize + 2;
    for y in 0..f.h as usize {
        let jj = (y >> 1) + 1;
        let j2 = across(y, ch) + 1;
        for x in 0..f.w as usize {
            let p = (y + 1) * fs + x + 1;
            if *f.unknown.add(p) == 0 { continue; }
            let ii = (x >> 1) + 1;
            let i2 = across(x, cw) + 1;
            let add = f32x4_add(f32x4_add(f32x4_add(f32x4_mul(near, ld(ec, 4 * (jj * cs + ii))), f32x4_mul(side, ld(ec, 4 * (jj * cs + i2)))),
                f32x4_mul(side, ld(ec, 4 * (j2 * cs + ii)))), f32x4_mul(far, ld(ec, 4 * (j2 * cs + i2))));
            st(e, 4 * p, f32x4_add(ld(e, 4 * p), add));
        }
    }
}

struct Settings { coarsest_sweeps: u32, band_sweeps: u32 }

unsafe fn vcycle(levels: &[Level], l: usize, cfg: &Settings) {
    let lv = &levels[l];
    let (e, r, t) = (lv.e, lv.r as *const f32, lv.t);
    for i in 0..4 * (lv.w as usize + 2) * (lv.h as usize + 2) { *e.add(i) = 0.0; }
    if l == levels.len() - 1 {
        smooth(lv, e, r, 0);
        for _ in 0..cfg.coarsest_sweeps { smooth(lv, e, r, 1); smooth(lv, e, r, 0); }
        return;
    }
    smooth(lv, e, r, 0);
    smooth(lv, e, r, 1);
    for _ in 0..cfg.band_sweeps { smooth_band(lv, e, r, 0); smooth_band(lv, e, r, 1); }
    let mut unused = [0.0f64; 4];
    apply(lv, e, t, r, &mut unused);
    let c = &levels[l + 1];
    restrict(lv, t, c, c.r);
    vcycle(levels, l + 1, cfg);
    prolong(c, c.e, lv, e);
    for _ in 0..cfg.band_sweeps { smooth_band(lv, e, r, 1); smooth_band(lv, e, r, 0); }
    smooth(lv, e, r, 1);
    smooth(lv, e, r, 0);
}

unsafe fn dot(l: &Level, a: *const f32, b: *const f32) -> [f64; 4] {
    let (w, h) = (l.w as usize, l.h as usize);
    let s = w + 2;
    let (mut lo, mut hi) = (f64x2_splat(0.0), f64x2_splat(0.0));
    for y in 0..h {
        for x in 0..w {
            let p = (y + 1) * s + x + 1;
            if *l.unknown.add(p) == 0 { continue; }
            let (va, vb) = (ld(a, 4 * p), ld(b, 4 * p));
            lo = f64x2_add(lo, f64x2_mul(f64x2_promote_low_f32x4(va), f64x2_promote_low_f32x4(vb)));
            hi = f64x2_add(hi, f64x2_mul(f64x2_promote_low_f32x4(high(va)), f64x2_promote_low_f32x4(high(vb))));
        }
    }
    [f64x2_extract_lane::<0>(lo), f64x2_extract_lane::<1>(lo), f64x2_extract_lane::<0>(hi), f64x2_extract_lane::<1>(hi)]
}

fn ratio(a: &[f64; 4], b: &[f64; 4]) -> v128 {
    let q = |k: usize| if b[k] > 0.0 { (a[k] / b[k]) as f32 } else { 0.0 };
    f32x4(q(0), q(1), q(2), q(3))
}

/// healSolve: conjugate gradients preconditioned by the V-cycle. Level 0's e, r (holding b) and
/// t are the preconditioned residual, the residual and A·p; x and p are padded level-0 vectors.
#[no_mangle]
pub unsafe extern "C" fn solve(levels: *const Level, count: u32, x: *mut f32, p: *mut f32, tolerance: f64,
    max_steps: u32, coarsest_sweeps: u32, band_sweeps: u32) -> u32 {
    let levels = core::slice::from_raw_parts(levels, count as usize);
    let cfg = Settings { coarsest_sweeps, band_sweeps };
    let l0 = &levels[0];
    let (w, h) = (l0.w as usize, l0.h as usize);
    let s = w + 2;
    let n4 = 4 * s * (h + 2);
    let (z, r, q) = (l0.e, l0.r, l0.t);
    vcycle(levels, 0, &cfg);
    for i in 0..n4 { *p.add(i) = *z.add(i); }
    let mut rz = dot(l0, r, z);
    let mut pq = [0.0f64; 4];
    let mut steps = 0u32;
    while steps < max_steps {
        steps += 1;
        apply(l0, p, q, core::ptr::null(), &mut pq);
        let alpha = ratio(&rz, &pq);
        let mut big = f32x4_splat(0.0);
        for y in 0..h {
            for xx in 0..w {
                let c = (y + 1) * s + xx + 1;
                if *l0.unknown.add(c) == 0 { continue; }
                let i = 4 * c;
                let d = f32x4_mul(alpha, ld(p, i));
                st(x, i, f32x4_add(ld(x, i), d));
                st(r, i, f32x4_sub(ld(r, i), f32x4_mul(alpha, ld(q, i))));
                big = f32x4_max(big, f32x4_abs(d));
            }
        }
        let most = f32x4_max(big, high(big));
        let most = f32x4_max(most, i32x4_shuffle::<1, 0, 3, 2>(most, most));
        if (f32x4_extract_lane::<0>(most) as f64) <= tolerance { break; }
        vcycle(levels, 0, &cfg);
        pq = dot(l0, r, z);
        let beta = ratio(&pq, &rz);
        rz = pq;
        for y in 0..h {
            for xx in 0..w {
                let c = (y + 1) * s + xx + 1;
                if *l0.unknown.add(c) == 0 { continue; }
                let i = 4 * c;
                st(p, i, f32x4_add(ld(z, i), f32x4_mul(beta, ld(p, i))));
            }
        }
    }
    steps
}

// JS lays its buffers out from here, growing memory as it needs. No Rust allocator is used.
#[no_mangle]
pub extern "C" fn scratch() -> usize {
    unsafe extern "C" { static __heap_base: u8; }
    &raw const __heap_base as usize
}
