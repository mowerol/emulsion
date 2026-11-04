# Zoom to sharp detail

Measured 2026-11-03 on the real app, following Oli's report of a slow wait after zooming.
Raw timings: [zoom-detail.json](app-performance/zoom-detail.json). This work preserves
LibRaw's demosaic, colour, precision and full-resolution output.

## Reproduction

```sh
node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomdetail
```

Fresh app process and scratch copy, visible WKWebView, M2, 26 MP X-T30 II RAF,
1552 × 1036 device-pixel canvas, DPR 2. No claim of cold OS caches. The scenario
presses Z with Texture, Clarity and Dehaze off, then waits for a full-resolution
screen frame's GPU fence and two animation frames. It excludes frames where the
engine still shows the preview during motion (`stoodIn`) and draft frames. It measures a display estimate,
not input-to-photon latency. The default provisional bar is 1000 ms, configurable
with `PERF_SHARP_MS`. A timeout is a failure, never a successful slow sample.

## Measurements and decisions

| Configuration | Z to sharp estimate | LibRaw | Pixel packing / metadata | Native → frontend overhead | First frame incl. CPU / GPU queue |
| --- | ---: | ---: | ---: | ---: | ---: |
| Serial baseline | 12,741 ms | 10,941 ms including colour | 572 ms | 70 ms | 744 ms |
| Serial repeat | 12,805 ms | 10,925 ms + 28 ms colour | 550 ms | 59 ms | 749 ms |
| Parallel, four threads | 6,961 ms | 4,688 ms + 29 ms colour | 609 ms | 91 ms | 1,145 ms |
| Parallel + optimized image dependency | 6,341 ms | 4,926 ms + 26 ms colour | 146 ms | 127 ms | 704 ms |
| Final, probes removed | 5,897 ms | not instrumented | not instrumented | not instrumented | 756 ms |

Ranked hypotheses were native processing, transfer of the ~200 MB payload,
background queueing, then first upload/render. Measurements put the main cost in
LibRaw; native queue wait was below 0.04 ms. Transfer is not the multi-second cost.
CPU upload submission was 15–55 ms; GPU upload/mipmap completion is included in
subsequent fence timing, not isolated by that CPU number.

Two exact improvements are implemented:

- Enable the vendored LibRaw's existing OpenMP code on macOS when `libomp` is
  available. Statically link the runtime; cap decoding at four threads and restore
  the native worker's prior OpenMP setting afterward. No vendor source changes.
- Optimize the `image` dependency in development. Initial 1664 px preview native
  processing fell from 3434 ms to 472 ms. Its resize/packing component fell from
  2567 ms to 92 ms. A concurrent 2560 px preview's resize/packing fell from
  3777 ms to 182 ms. Release builds already optimize this dependency.

The final measurement after probe removal is 5897 ms (first full-resolution render
starts at 4814 ms, upload CPU submission 35 ms, first frame 756 ms). `npm run check`
passes: 536 frontend tests, 70 Rust tests, nine ignored; the separate real-photo
reference test also passes. `otool -L` confirms no libomp dylib dependency.

These results more than halve the fresh zoom wait but **do not meet the one-second bar**.
The remaining ~5 seconds of native decoding and ~0.7 seconds of first-frame work
needed further work. Oli delegated the next choice ("i dont know. you pick").
The selected mechanism is now bounded preparation of the exact decode, below;
a faster interim demosaic is not used.

## Exact detail prepared while viewing

Develop prepares the active photo after 750 ms of quiet, with no source upload or
change to Fit. Preparation uses the same keyed request and 512 MiB decoded cache
as foreground zoom. There is one running background decode and only the latest
pending photo; navigation, editing or unmount cancels pending work. A native call
already running must finish. Foreground requests share their own pending decode
and never wait for unrelated background admission. The cache generation check
prevents completed pre-clear loads from repopulating it or deleting newer requests.

Speculation is limited to payloads no larger than 256 MiB (this 26 MP RAF is
~199 MiB); larger photos still decode on demand. It never starts noise reduction
speculatively. No additional GPU source or regional maps are created at Fit.

```sh
# Current startup/early zoom behavior: no added viewing pause.
node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomdetail
# Same app/photo, six seconds of viewing before Z.
node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomprepared
```

| Final behavior | Z to actual sharp detail | First detailed render starts | First detailed frame incl. queue |
| --- | ---: | ---: | ---: |
| No added viewing pause | 5697 ms | 4640 ms | 705 ms |
| Six-second viewing pause, exact decode prepared | 1260 ms | 161 ms | 789 ms |

The first prepared run appeared to pass at 950 ms, but the instrumentation could
count a full-resolution *source* while the engine showed the preview during motion.
That result is discarded. The stricter check excludes `stoodIn` and draft frames;
1260 ms is the retained prepared result. It **still fails** the provisional
one-second goal. Deferring histogram reads until GPU idle (1337 ms) and avoiding
histogram recounts on full-source swaps (1312 ms) did not improve it; both trials
were removed. First regional allocation/build remains a real cost. No instant-zoom
or p95 claim is made. The viewing pause moves native work earlier; it does not
make the RAW demosaic itself faster.

Checks after preparation: `npm run check` passes (541 frontend, 70 Rust, nine
ignored), the eight cache tests cover coalescing, byte eviction, cancellation,
latest-only background admission, failures, foreground bypass and clear/load races.
The browser `zoom-full-res` regression passes with an added real Develop scenario:
background work keeps Fit and the loading badge unchanged, then zoom reuses its
exact decode. The browser fixture passes its standalone strict type check.


## Output verification

The complete 208,367,856-byte payload from the serial build has BLAKE3
`7f7052afbdeef8c94b9f8dd0a6834cb18e91c8223f294cbf2a6bef3364483f7f`.
The parallel build matches byte for byte, including metadata and signed half floats.

```sh
EMULSION_RAW_SAMPLE="$HOME/Pictures/1OKK6432.RAF" \
EMULSION_RAW_PAYLOAD_HASH=7f7052afbdeef8c94b9f8dd0a6834cb18e91c8223f294cbf2a6bef3364483f7f \
cargo test --manifest-path src-tauri/Cargo.toml full_resolution_payload_matches_reference -- --ignored --nocapture
```

This ignored test requires the local read-only fixture; no photo pixels are stored
in the repo. To compare another photo, capture its payload hash using the serial
reference build and supply that hash to the same test with parallel decoding.
Do not treat the test process's elapsed time as app latency: it includes hashing
with development dependencies. Temporary native and frontend stage logs have been
removed; the `zoomdetail` scenario remains as the latency regression loop.
