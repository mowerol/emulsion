# GFX opening and progressive capture sharpening

Measured 2026-11-16 after Oli reported slow initial resolution and zoom on 100 MP
medium-format photos. Oli explicitly requested showing full resolution before
capture sharpening finishes, then applying it behind the scenes.

Raw observations: [gfx-open-zoom.json](app-performance/gfx-open-zoom.json).
Base: `a8554aff070a`. Implementation worktree: `emulsion-open-zoom`, branch
`perf/gfx-open-zoom`. Original files and the existing user app were left alone.

## Changes

- A newly displayed full-resolution RAW view first renders with capture sharpening
  deferred. The saved recipe, including noise reduction, other detail effects and
  retouching, stays intact. The same cancellable render loop then prepares and
  presents the fully sharpened result. A prepared full-source capture cache is
  used immediately. Navigation and new input cancel outdated continuations.
- The contrast search now has a compiled Wasm path. Overlapping 40px candidates
  are pruned using 10px block moments with conservative rounding bounds. Possible
  winners, near ties, eligibility boundaries, the fine search and the final
  threshold retain the original double-precision calculation and traversal order.
  No sensor pixels are sampled away. See [kernel notes](../../tools/capture-wasm/README.md).
- Packed GPU lightness reads directly into temporary Wasm memory, avoiding a
  second full-size double array (about 778 MiB at 102 MP). The module persists;
  each measurement's instance becomes collectible. The TypeScript path remains
  the fallback if compilation or allocation fails.
- Images at least 64 MiB cross into the Develop worker in transferable 8 MiB
  parts on separate message turns. Shared decoded cache buffers stay intact.
  The worker publishes a source only when both original and optional denoised
  planes are complete, retains early capture metadata, and drops cancelled
  transfers. Capture masks transfer ownership too.
- The status changes from “Loading full resolution” to “Refining detail” after
  the decode arrives. Screen measurements distinguish visible resolution from
  capture-complete detail and continue waiting for GPU completion and painting.
  Still/export rendering continues to use the complete requested recipe.

## Measurements

M2, visible native WKWebView, DPR 2, production frontend, optimized development
native code, isolated empty profiling catalog and scratch photo copies. Same
11662 × 8746 GFX100RF sample used in the earlier large-image work. These are
individual local observations with warm OS caches, not p95 or cold-disk claims.
Canvas size was approximately 1166² device pixels (the first baseline was 1164²).

The file's in-camera square crop uses only about one third of the sensor width.
A 2560px whole-image preview does not supply enough pixels for this fitted crop.
The opening measurement now requires enough source pixels for the actual crop;
counting the thumbnail or any decoded preview would overstate the improvement.

| Scenario | Before | After |
| --- | ---: | ---: |
| Open → visible resolution for the fitted crop | 23,268 ms | 12,788 ms |
| Open → capture-complete detail | 23,302 ms | 17,721 ms |
| Early Z → visible full-resolution detail | 10,851 ms, capture blocked presentation | 1,440 ms |
| Early Z → capture-complete detail | 10,851 ms | 2,924 ms |
| Warm Z after opening finished → visible resolution | 2,786 ms | 2,068 ms |
| Warm Z → capture-complete detail | 2,819 ms | 3,167 ms |
| Capture threshold work on the opening path | 4,205 ms | 1,341 ms |

Before chunking, the improved early-zoom path still spent 501 ms synchronously
handing the image to the worker, with a 521 ms screen gap. After chunking, the
observed early-zoom screen gap was 30 ms; the separate open-then-zoom run had a
36 ms gap. Some upload parts before zoom still encountered pauses of 127–191 ms
under allocation/GC pressure. Chunk size bounds bytes, not a universal time limit.

The warm zoom's final sharpened frame is slightly later because the progressive
path presents an intermediate frame before refining. The early-zoom results also
include work that can finish while opening; compare complete scenarios rather
than adding their stage timings. Native decoding, upload and regional preparation
remain significant. Neither opening nor zoom meets the existing provisional
one-second benchmark target, and the harness still reports that failure.

## Verification

- Compiled search tests compare exact thresholds against the TypeScript reference
  for both search passes, odd sizes, row padding, dark/bright inputs, repeated
  tiles, near ties and eligibility boundaries.
- A temporary validation run also compared the actual 11662 × 8746 GPU lightness
  readback against the original search: both returned threshold **0**. Its
  additional reference scan is excluded from latency measurements. Validation
  instrumentation was removed afterward.
- Render-loop regressions verify full-resolution presentation before capture,
  eventual use of the requested recipe, cancellation on navigation, paired image
  assembly, early capture metadata and rejection of released transfers.
- Worker-client tests perform actual ArrayBuffer transfers for paired 64 MiB
  planes, comparing every reassembled sample and preserving the cache buffers.
- `npm run build` passes TypeScript and the production Vite build.
- `npm test` passes **1028 tests in 131 files**.
- Native tests pass **161 tests**, with **25 fixture-dependent tests ignored**.
- Real GPU `region-detail`, `region-detail ... capture`, and `zoom-full-res` checks
  pass. Late/replaced capture matches the ready-source pixels exactly; the
  regional capture comparison stays within its existing 1/255 bound.

## Repeat

```sh
PROD=1 CATALOG=empty node tools/perf/inapp.mjs /path/to/photo.raf openzoom 180
PROD=1 CATALOG=empty node tools/perf/inapp.mjs /path/to/photo.raf zoomdetail 180
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml
node tools/browser-tests/realtime.mjs region-detail 90
node tools/browser-tests/realtime.mjs region-detail 60 capture
node tools/browser-tests/realtime.mjs zoom-full-res 60
```

The driver starts its own app identifier and port, uses a scratch photo and leaves
original sidecars/catalog alone. Keep its profiling window visible. `openzoom`
measures opening first, then a warm zoom; `zoomdetail` zooms after the driver's
usual startup settle without an additional viewing pause. No restart of the live
dev app is needed for these runs.
