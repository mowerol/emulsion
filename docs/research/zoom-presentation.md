# Zoom presentation race, 2026-11-13

Oli confirmed that **both** zoom directions still glitched in production, describing a border
at the top and bottom. The four earlier sizing changes in HANDOFF.md did not resolve this.

## Reproduction and evidence

Used the release binary with embedded assets/release CSP, a copied real catalog, 22,000 scratch
photos and `1OKK6432.RAF`, DPR 2, window 1440 × 780. The retained `zoomtrace` scenario toggles
Z in and out with 100, 500 and 2000 ms pauses at 100%, recording intrinsic/CSS sizes after paint.

```sh
CATALOG=real FILL=22000 PACKAGED=1 node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomtrace 300
```

The scenario emits `PERF-APP-PID` and `PERF-TRACE-READY` for a recorder. Record **only that
process's window**, with `screencapture -v -o -l <window-id> -V 18 <new-file.mov>`.
`-o` excludes the shadow surrounding the app window, making the capture exactly 2880 × 1624.
An existing output file causes recording to fail; always choose a new filename.

The pre-fix recording showed two distinct defects:

- The canvas's shadow grew before the photo changed, producing floating top/bottom borders.
- The new zoomed frame briefly occupied the old Fit rectangle, then expanded vertically.
  On zoom out, the whole photo briefly occupied the taller rectangle before shrinking.
  `object-fit: contain` did not prevent this; page-side intrinsic-size readings cannot certify
  what WebKit's independently updated worker placeholder displayed.

The fixture-specific video checker detected 40 frames with a floating top border before the
fix and zero after it. Transition contact sheets were also inspected: the corrected release
recording switches between the complete Fit and 100% rectangles without those intermediate
shapes. Oli then tried the rebuilt production app and said "way better"; this confirms the
improvement, without claiming that every remaining zoom/performance issue is resolved.

Session artifacts and capture/check scripts are in `/private/tmp/emulsion-zoom-investigation`:
`before.mov`, `before.mov.normalized.mov`, `sized.mov`, `transition.png`,
`sized-transition.png`, `check-bands.py`, `normalize.py`, `run.mjs`, `window.swift`.
The checker uses fixed pixel positions for this fixture/window; it is not a general UI test.
The pre-fix recording was normalized to remove its window shadow before comparison.

```sh
python3 /private/tmp/emulsion-zoom-investigation/check-bands.py /private/tmp/emulsion-zoom-investigation/before.mov.normalized.mov
# FAIL: floating top border while photo remains at Fit: 40 recorded frames
python3 /private/tmp/emulsion-zoom-investigation/check-bands.py /private/tmp/emulsion-zoom-investigation/sized.mov
# PASS: floating top border while photo remains at Fit: 0 recorded frames
```

An intermediate candidate omitted explicit canvas width/height updates. It produced persistent
letterboxing and is **not** the fix (`after.mov`). The real-GPU browser regression caught the
size mismatch. `sized.mov` is the final candidate, with explicit backing dimensions.

## Change

The worker renders on its own OffscreenCanvas and transfers each completed ImageBitmap with
the frame's dimensions. DevelopClient installs the bitmap and updates backing dimensions;
Develop updates canvas/wrapper CSS dimensions in the same main-thread task. This gives the
frame and its box one presentation boundary. It removes the rAF polling, resize timeout and
settle-frame guesses. The GPU engine, source/decode ownership and zoom math are unchanged.
Frames arriving after disposal close their bitmap instead of displaying it.

## Validation and remaining limits

- `npm run check`: 904 JavaScript tests and 132 Rust tests passed (20 Rust tests ignored).
- `developclient.test.ts`: failed on the old placeholder path, passes on bitmap presentation;
  checks frame/box delivery and native bitmap cleanup after disposal.
- `node tools/browser-tests/realtime.mjs zoom-presentation 40`: real worker/GPU pixels survive
  repeated aspect changes, including portrait, with a deliberately busy main thread.
- `node tools/browser-tests/realtime.mjs zoom-full-res 90`: existing shared-decode, prepared
  zoom, held-input and final-release regression passes on the main-thread engine.
- Final isolated release `zoomtrace,controls` run, without concurrent builds/browser tests:

| Exposure drag | Photo fps | Controls fps | Worst control frame | Input-to-GPU ms |
| --- | ---: | ---: | ---: | ---: |
| 1 | 37.7 | 59.6 | 45 ms | 72 |
| 2 | 48.4 | 59.9 | 19 ms | 61 |
| 3 | 47.6 | 58.5 | 61 ms | 58 |

These still fail the strict no-control-frame-over-25-ms bar in two drags. There is no paired
slider baseline for attributing a latency change to this presentation path; do not claim a
complete performance fix. Full-resolution decode/upload stalls and soft-to-sharp redraws
remain separate from the recorded shape defect. Crop/mask/heal overlays, pinch, panning and
window/panel resizing still need Oli's normal app check.

The normal production app was built at
`src-tauri/target/release/bundle/macos/Emulsion.app`; `codesign --verify --deep --strict` passes.
`tauri build --bundles app` produced the app but failed its subsequent updater signature step
because the private key was absent. Completed local packaging successfully with
`npx tauri bundle --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'`.
No release was published and no signing configuration was changed.
