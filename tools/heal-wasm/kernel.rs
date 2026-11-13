// Copyright (C) 2017-2024 darktable developers.
// Ported from darktable src/common/heal.c at commit
// 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2), via src/engine/heal.ts.
// Same red/black runs, f32 arithmetic and sweep order. Error sums use f64 as in the TS port.
// SPDX-License-Identifier: GPL-3.0-or-later

unsafe fn iteration(active: *mut f32, neighbor: *const f32, height: usize, width: usize,
    runs: *const u32, nruns: usize, start: usize, w: f32) -> f64 {
    let mut error = [0.0f64; 3];
    let vert = 4 * width;
    for i in 0..nruns {
        let idx = *runs.add(2 * i) as usize;
        let count = *runs.add(2 * i + 1) as usize;
        let index = 4 * idx;
        let row = idx / width;
        let a = 4.0 - (row == 1) as u8 as f32 - (row == height) as u8 as f32;
        let lr = 4 * (start ^ (row & 1));
        for c in 0..4 {
            if count == 1 {
                let col = idx % width;
                let left = col > 0 || lr != 0;
                let right = col + 1 < width || lr == 0;
                let aa = a - (!left) as u8 as f32 - (!right) as u8 as f32;
                let l = if left { *neighbor.add(index + lr + c - 4) } else { 0.0 };
                let r = if right { *neighbor.add(index + lr + c) } else { 0.0 };
                let p = index + c;
                let d = w * (aa * *active.add(p) - (((*neighbor.add(p - vert) + *neighbor.add(p + vert)) + l) + r));
                *active.add(p) -= d;
                if c < 3 { error[c] += (d as f64) * (d as f64); }
            } else {
                let mut l = *neighbor.add(index + lr + c - 4);
                for j in 0..count {
                    let p = index + 4 * j + c;
                    let r = *neighbor.add(p + lr);
                    let d = w * (a * *active.add(p) - (((*neighbor.add(p - vert) + *neighbor.add(p + vert)) + l) + r));
                    *active.add(p) -= d;
                    if c < 3 { error[c] += (d as f64) * (d as f64); }
                    l = r;
                }
            }
        }
    }
    error[0] + error[1] + error[2]
}

#[no_mangle]
pub unsafe extern "C" fn laplace(red: *mut f32, black: *mut f32, width: usize, height: usize,
    red_runs: *const u32, red_count: usize, black_runs: *const u32, black_count: usize,
    w: f32, exit: f64, max_iter: u32) -> u32 {
    for iter in 0..max_iter {
        let mut error = iteration(black, red, height, width, black_runs, black_count, 1, w);
        error += iteration(red, black, height, width, red_runs, red_count, 0, w);
        if error < exit { return iter + 1; }
    }
    max_iter
}

// JS owns a reusable scratch buffer, grown by memory.grow. No Rust allocator is used.
#[no_mangle]
pub extern "C" fn scratch() -> usize {
    unsafe extern "C" { static __heap_base: u8; }
    &raw const __heap_base as usize
}
