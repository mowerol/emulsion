# RAW highlight recovery

Research, 2026-11-12. No decoder changes or image benchmarks performed. The agreed
work sequence and editing behaviour are in the
[implementation plan](../plans/raw-highlight-recovery.md); this note supplies the
source analysis and technical decision gates.

## Recommendation

First preserve sensor information that the current white-balance scaling discards, with explicit gain and clipping metadata. Then compare LibRaw recovery against a pinned darktable implementation before choosing the shipping algorithm. A `highlight` switch alone changes brightness and is not a complete recovery feature.

Keep three problems separate:

1. **WB-induced clipping:** valid sensor values exceed LibRaw's integer buffer after channel multiplication. Prevent this loss before demosaic.
2. **Sensor saturation:** one or more measured channels are already missing. Estimate from surviving channels/neighbours; wholly clipped areas cannot yield measured detail.
3. **Rendering:** highlight compression, sigmoid and exposure determine whether retained/reconstructed values look white, grey or coloured. Changing these cannot restore discarded sensor values. The distinction between clipping and reconstruction is explained in the [darktable manual](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/highlight-reconstruction/).

## What Emulsion currently does

- [raw_shim.cpp](../../src-tauri/native/raw_shim.cpp), `emu_raw_decode`: camera RGB (`output_color=0`), 16-bit, linear gamma, `no_auto_bright=1`, camera WB, `highlight=0`; same entry point for half/full decodes.
- [raw.rs](../../src-tauri/src/raw.rs), `decode`: multiply by the camera-to-Rec.2020 matrix and `BASELINE_GAIN / 65535`, where `BASELINE_GAIN=1.8`. Floating output supports values above 1, but conversion happens after integer clipping.
- [decode.rs](../../src-tauri/src/decode.rs), `load_for_engine`: chooses half-size for smaller previews, with full-resolution fallback. Exports/full views must share the same normalization and recovery policy.
- The vendor is LibRaw **0.22.3** ([version header](../../src-tauri/vendor/libraw/libraw/libraw_version.h)). In this tree highlight algorithms live in [postprocessing_aux.cpp](../../src-tauri/vendor/libraw/src/postprocessing/postprocessing_aux.cpp), **not** `highlights.cpp`.

## LibRaw modes: source behaviour, not just their labels

The public [parameter documentation](https://www.libraw.org/docs/API-datastruct-eng.html#libraw_output_params_t) calls modes 0 clip, 1 unclip, 2 blend, 3+ rebuild. The critical scaling is in [scale_colors](../../src-tauri/vendor/libraw/src/postprocessing/postprocessing_utils_dcrdefs.cpp), lines 111–221; [scale_colors_loop](../../src-tauri/vendor/libraw/src/postprocessing/postprocessing_utils.cpp), lines 144–190, clamps to unsigned 16-bit.

Let `w[c]` be the **actual effective four WB multipliers**, after fallback/green handling, `m=min(w)`, `M=max(w)` and `W` the effective black-subtracted maximum. Ignoring per-channel black differences:

```text
mode 0: code[c] = clip16((raw[c] - black[c]) * w[c]/m * 65535/W)
mode 1+:code[c] = clip16((raw[c] - black[c]) * w[c]/M * 65535/W)
gain to match mode-0 unclipped brightness: K = M/m
```

For `w=[2,1,1.5,1]`, switching to mode 1 halves unclipped output (−1 EV). Restoring ×2 **after conversion to float** preserves the old midtone normalization while retaining WB headroom. Keeping the old Rust scale alone makes the photo darker. Applying compensation inside the u16 path recreates clipping. This is a derivation from the local scaling code, not a measured result.

| Mode | Actual work after scaling/demosaic | Consequence |
| --- | --- | --- |
| 0 | No explicit recovery call; min-normalized WB clips in `scale_colors_loop` | Some valid channel information disappears before demosaic. |
| 1 | Max-normalized WB; no recovery call | Useful preservation baseline; retains uneven sensor saturation and can reveal magenta. |
| 2 | Same max normalization; `blend_highlights` computes a common threshold from `min(65535*pre_mul)`, reduces opponent chroma using a clipped reference, preserves the opponent luminance component | Often desaturates objectionable highlights; does not propagate missing colour or detail spatially. |
| 3–9 | Same max normalization; `recover_highlights` estimates channel ratios on a coarse map, propagates them spatially, and raises other channels using the largest-`pre_mul` channel as guide | A real reconstruction heuristic, with integer ceilings and limited evidence when its guide is saturated. Not equivalent to darktable's current recovery. |

For 3+, `grow=2^(4-highlight)` changes propagation and its pull toward ratio 1; higher modes allow more propagation and less neutral bias. Benchmark 3, 5 and 9 rather than treating this number as recovery “strength”. The code uses `hsat=32000*pre_mul`, guide threshold 24000 and `SCALE=4>>shrink`; it only raises reconstructed values and clamps at 65535. Half-size processing changes sample aggregation even though the map scale compensates for shrink. Source: local [blend/recover implementations](../../src-tauri/vendor/libraw/src/postprocessing/postprocessing_aux.cpp), lines 279–421; [upstream counterpart](https://github.com/LibRaw/LibRaw/blob/master/src/postprocessing/postprocessing_aux.cpp).

[dcraw_process](../../src-tauri/vendor/libraw/src/postprocessing/dcraw_process.cpp) runs black/maximum adjustment → WB scaling → pre-interpolation/demosaic → highlight blend/rebuild → output conversion. `output_color=0` bypasses the colour transform, not WB/recovery. `no_auto_bright` disables histogram brightening at [memory output](../../src-tauri/vendor/libraw/src/postprocessing/mem_image.cpp), not `scale_colors` or maximum adjustment.

## Metadata and format limits

- Return the **applied** scale/gain from processing. `cam_mul` alone misses auto-WB fallback, daylight fallback, already-applied WB and CRW white-patch WB; `scale_colors` also fills the second green. Capture effective multipliers before normalization or derive `K=1/min(normalized pre_mul)` immediately after scaling, guarded for valid values and all four channels.
- Distinguish `maximum` (processing ceiling), `data_maximum` (observed image maximum), `linear_max[4]` (optional channel metadata, including black), and DNG white/black metadata. `maximum` mutates during black subtraction and automatic adjustment; `adjust_maximum` may lower it toward observed values. Record before/after values, selected WB source and warnings for evaluation. Do not silently change `adjust_maximum_thr` in the first comparison. Sources: [LibRaw colour data docs](https://www.libraw.org/docs/API-datastruct-eng.html#libraw_colordata_t), local [adjust_maximum](../../src-tauri/vendor/libraw/src/utils/utils_libraw.cpp), lines 448–465.
- “65535 means sensor clipping in every channel” is inaccurate after WB. In max-normalized camera RGB each nominal channel ceiling is proportional to `w[c]/M`; after compensation it is proportional to `w[c]/m`. Per-channel black/white differences need their own treatment. Derive a saturation mask in sensor units, not by testing Rec.2020 against 1.
- LibRaw recovery is post-demosaic, with no Bayer-only gate in its dispatch; evaluate Bayer and X-Trans separately. Its RGB algorithms can run on full-colour/linear RAWs, but this does not establish quality or a correct clipping model for computational DNGs.
- Linear DNGs have no CFA evidence to reconstruct. LibRaw's half-size option is ignored for full-colour data ([size documentation](https://www.libraw.org/docs/API-datastruct-eng.html#libraw_image_sizes_t)); floating DNG input can be normalized to integer by [convertFloatToInt](../../src-tauri/vendor/libraw/src/decoders/fp_dng.cpp). Include integer/floating and already-WB-applied DNGs in the compatibility gate.

## Upstream alternatives

**darktable is the reference candidate.** Its current default is inpaint opposed. This uses neighbouring raw-channel estimates in cube-root space plus chrominance from near-clipped regions; the implementation names wrong white points, difficult lighting and unsuitable WB as failure causes. It has Bayer/X-Trans handling and a distinct linear-RAW path. Source: [opposed.c](https://github.com/darktable-org/darktable/blob/master/src/iop/hlreconstruct/opposed.c).

Its recovery runs early, before input colour profiling and typically before demosaic. Guided Laplacians targets smooth detail/gradient reconstruction but is Bayer-only and more expensive. Segmentation can infer plausible structure in fully clipped regions; it does not recover lost measurements. Current dispatch provides a linear-RAW opposed fallback and tracks per-channel processed maxima. Sources: [highlights.c](https://github.com/darktable-org/darktable/blob/master/src/iop/highlights.c), [manual](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/highlight-reconstruction/). Port placement and WB units must follow that implementation; a shader on finished Rec.2020 pixels is not the same algorithm.

**RawTherapee is a useful second comparison.** It supplies luminance, CIELab, dcraw-derived blend, colour propagation and a darktable-derived inpaint-opposed implementation. `rawimagesource.cc` applies spatial colour recovery to float camera channels before its final WB step, tracks per-channel clipping limits, and dispatches the other methods separately. This is a useful integration reference; it does not prove superiority on Emulsion's files. Sources: [rawimagesource.cc](https://github.com/RawTherapee/RawTherapee/blob/dev/rtengine/rawimagesource.cc), [hilite_recon.cc](https://github.com/RawTherapee/RawTherapee/blob/dev/rtengine/hilite_recon.cc). The older [RawPedia description](https://rawpedia.rawtherapee.com/RawPedia.pdf) also warns that colour propagation can bleed incorrect neighbouring colours; current source includes more methods than that snapshot.

These upstream links track branches as researched. **Pin commits and reference application versions before porting or producing golden outputs.** [PORTING.md](../PORTING.md), rule 6, favours darktable by default and requires Oli's agreement for deviations; a LibRaw benchmark is not an implicit decision to ship its recovery instead.

## Proposed work and decision gates

1. **Preservation experiment:** add an internal comparison mode for LibRaw 0/1/2/3/5/9, with actual WB gain/black/white metadata returned across the C ABI. Restore mode-0 midtone scale in Rust float before the existing matrix/baseline gain, with no clamp. Do not change exposure normalization or sigmoid in the same experiment.
2. **Benchmark and choose:** compare corrected mode 1 (preservation only), LibRaw recovery modes and pinned darktable opposed; add guided Laplacians for difficult Bayer fixtures, and RawTherapee where its result is better. Keep camera matrices, WB target and view transform aligned; inspect raw-linear values separately from rendered pictures. Darktable opposed is the preferred production destination under rule 6, subject to these comparisons; segmentation is a possible later option for difficult large regions. Any LibRaw-only shipping choice needs an explicit upstream-deviation decision.
3. **Shipping gate:** automatic recovery for **new** RAW edits, with saved decoder/recovery version and an explicit legacy-rendering/off policy. Existing recipes should not silently change. Use the project's effect-version precedent; decide migration policy before release. Exposure/highlights slider changes operate on retained floats without triggering a new decode; changing recovery configuration may invalidate decode state.
4. **Contract gate:** audit [working_to_camera](../../src-tauri/src/raw.rs), sharpening thresholds and [capture.rs](../../src-tauri/src/capture.rs) before changing scale. Capture's mosaic uses **daylight** `pre_mul`, unlike the as-shot decode; its dilated sharpening clip mask is not a reconstruction mask. Preserve or explicitly revise the inverse/gain contract.
5. **Denoise/cache gate:** [denoise.rs](../../src-tauri/src/denoise.rs) removes `BASELINE_GAIN` for AI input; check preserved/reconstructed highlights against its trained input range. Extend [noise_cache.rs](../../src-tauri/src/noise_cache.rs) `key()` (currently `raw-nind-v1-libraw0223-darktable2-baseline…`) and all decoded-image caches with decoder/recovery policy/version. Old denoise output must not be reused with new RAW interpretation.
6. **Port feasibility gate:** for a faithful darktable CFA port, identify a seam **before demosaic** and storage that retains float reconstruction above the u16 ceiling. A callback writing floats back into LibRaw's u16 image can discard recovered headroom; a later Rec.2020 GPU effect changes the algorithm's input. Resolve float demosaic/output transport, CFA alignment, and half/full processing parity before committing to that architecture. Linear DNG needs the upstream linear path rather than a fabricated CFA.

## Validation before enabling by default

- Fixtures: unclipped neutral/ramp, recoverable one-/two-channel clips, all-channel speculars, clouds beside blue sky/foliage, skin, coloured lights, tungsten WB and high ISO. Include at least Bayer, X-Trans, linear DNG, floating DNG and missing/invalid-WB metadata.
- Prove preservation with synthetic sensor ramps: mode 0 plateaus early, corrected mode 1 retains distinctions; unclipped midtones match the old normalization within quantization/demosaic tolerance. Test actual-WB fallback and green handling, not only `cam_mul` arithmetic.
- Compare half-size preview to full-resolution output downsampled to the same view, plus 100% crops. Check hue, boundaries, false detail and reconstructed-region extent; do not require exact identity from different demosaics.
- Inspect at −2/−4 EV before the display transform, then at normal exposure through identical rendering. Reject a result that merely darkens the image or hides magenta through global desaturation. All-clipped areas should remain plausible without invented-detail claims.
- Record median/p95 decode latency and peak memory for half/full files and expensive cases. Reopen saved recipes, alternate recovery modes, run capture sharpening/AI denoise, and verify cache invalidation and export consistency.
- Open decisions: acceptable preview/export deviation and latency; the explicit upgrade flow for legacy edits; details of the planned per-image off option; which formats need a documented fallback. No quality or performance claims are established until these comparisons run.
