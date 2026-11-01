// SPDX-License-Identifier: GPL-3.0-or-later
//! Bounded IPC boundary for RawTherapee's camera-based perspective fit.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Perspective {
    pub rotation: f64,
    pub vertical: f64,
    pub horizontal: f64,
    pub focal_length: f64,
}

unsafe extern "C" {
    fn emulsion_perspective(pixels: *const u8, w: i32, h: i32, axis: i32, values: *mut f64) -> i32;
    #[cfg(test)]
    fn emulsion_perspective_matrix(w: i32, h: i32, values: *const f64, out: *mut f32);
}

pub fn fit(pixels: &[u8], width: u32, height: u32, axis: &str, current: Perspective) -> Result<Perspective, String> {
    let axis = match axis { "vertical" => 0, "horizontal" => 1, "both" => 2, _ => return Err("Invalid perspective direction".into()) };
    if width < 16 || height < 16 || width > 1000 || height > 1000 || pixels.len() != width as usize * height as usize * 4 {
        return Err("Perspective analysis requires RGBA pixels between 16 and 1000 pixels per side".into());
    }
    let mut v = [current.rotation, current.vertical, current.horizontal, current.focal_length];
    if v.iter().any(|v| !v.is_finite()) || v[0].abs() > 20.0 || v[1].abs() > 80.0 || v[2].abs() > 80.0 || !(1.0..=2000.0).contains(&v[3]) {
        return Err("Invalid perspective parameters".into());
    }
    // The adapter never retains pointers; size and every parameter are checked above.
    let ok = unsafe { emulsion_perspective(pixels.as_ptr(), width as i32, height as i32, axis, v.as_mut_ptr()) };
    if ok == 0 || v.iter().any(|v| !v.is_finite()) {
        return Err("Could not find enough reliable lines. Try another direction or adjust the sliders.".into());
    }
    Ok(Perspective { rotation: v[0], vertical: v[1], horizontal: v[2], focal_length: v[3] })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_data_and_reports_featureless_images() {
        let p = Perspective { rotation: 0.0, vertical: 0.0, horizontal: 0.0, focal_length: 28.0 };
        assert!(fit(&[], 100, 100, "vertical", p).is_err());
        assert!(fit(&vec![128; 64*64*4], 64, 64, "vertical", p).is_err());
        assert!(fit(&[], u32::MAX, u32::MAX, "both", p).is_err());
        assert!(fit(&[], 0, 0, "invalid", p).is_err());
    }

    #[test]
    fn detects_and_straightens_synthetic_converging_verticals() {
        let (w, h) = (600, 400);
        let values = [3.0, 15.0, 0.0, 28.0];
        let mut m = [0f32; 9];
        unsafe { emulsion_perspective_matrix(w, h, values.as_ptr(), m.as_mut_ptr()); }
        let mut pixels = vec![255; w as usize*h as usize*4];
        for y in 0..h { for x in 0..w {
            let den=m[6]*x as f32+m[7]*y as f32+m[8];
            let u=(m[0]*x as f32+m[1]*y as f32+m[2])/den;
            // Parallel lines in corrected space, projected back onto a tilted camera.
            let dark=(u/60.0).round()*60.0;
            if (u-dark).abs()<2.0 {
                let i=((y*w+x)*4) as usize;
                pixels[i..i+3].fill(10);
            }
        }}
        let initial=Perspective { rotation: 0.0, vertical: 0.0, horizontal: 0.0, focal_length: 28.0 };
        let out=fit(&pixels, w as u32, h as u32, "vertical", initial).unwrap();
        assert!((out.rotation-values[0]).abs()<0.3, "{out:?}");
        assert!((out.vertical-values[1]).abs()<0.7, "{out:?}");
        let repeat=fit(&pixels, w as u32, h as u32, "vertical", initial).unwrap();
        assert_eq!(out.rotation, repeat.rotation);
    }

    #[test]
    fn recovers_horizontal_and_combined_camera_angles() {
        let (w, h) = (600, 400);
        for (axis, values) in [("horizontal", [-2.0, 0.0, 12.0, 35.0]), ("both", [3.0, 15.0, -12.0, 28.0])] {
            let mut m = [0f32; 9];
            unsafe { emulsion_perspective_matrix(w, h, values.as_ptr(), m.as_mut_ptr()); }
            let mut pixels = vec![255; w as usize * h as usize * 4];
            for y in 0..h { for x in 0..w {
                let den=m[6]*x as f32+m[7]*y as f32+m[8];
                let u=(m[0]*x as f32+m[1]*y as f32+m[2])/den;
                let v=(m[3]*x as f32+m[4]*y as f32+m[5])/den;
                let horizontal=(v-(v/60.0).round()*60.0).abs()<2.0;
                let vertical=axis=="both" && (u-(u/60.0).round()*60.0).abs()<2.0;
                if horizontal || vertical {
                    let i=((y*w+x)*4) as usize;
                    pixels[i..i+3].fill(10);
                }
            }}
            let initial=Perspective { rotation: 0.0, vertical: 0.0, horizontal: 0.0, focal_length: values[3] };
            let out=fit(&pixels, w as u32, h as u32, axis, initial).unwrap();
            assert!((out.rotation-values[0]).abs()<0.4, "{axis}: {out:?}");
            assert!((out.vertical-values[1]).abs()<0.8, "{axis}: {out:?}");
            assert!((out.horizontal-values[2]).abs()<0.8, "{axis}: {out:?}");
        }
    }
}
