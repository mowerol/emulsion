# App-wide performance audit

2026-11-02. Target: Apple M2, 16 GiB RAM, 10,000-photo Library; 50,000-photo state/scan stress case. Exact image results are the constraint. This is the analysis and ranked implementation backlog requested in the approved plan, not an implementation of the optimizations below.

## Conclusions

1. **Finish and validate bounded full-resolution processing first.** The historical WebKit memory termination is a stability failure, not simply a slow shader. The ROI implementation is being developed concurrently; this audit does not certify that unfinished implementation. Avoid a second competing renderer rewrite.
2. **Fix retained stage buffers and export failure cleanup.** The corrected GPU harness reproduces substantial retention after `dropBuffers`, even though the newer `dispose` correctly releases stage targets. A failed profile preparation also bypasses export's release guard.
3. **Virtualize Library and Filmstrip.** WebKit mounts all 10,000 photos into 138,445 DOM nodes and takes 1.43 s to commit them. Selection commits reach 112 ms p95. IntersectionObserver limits thumbnail work; it does not limit DOM size.
4. **Coordinate background CPU/GPU work and bound caches by bytes.** More concurrency can make the active photo slower and increase peak memory. Thumbnails, look previews, histogram, export, decode and inference need a shared policy and separate ownership guarantees.
5. **Optimize repeated analysis and serialized recipes after those changes.** They are real opportunities, but isolated edit-state updates are only ~1 ms p95 at 10,000 photos in the final samples (an earlier WebKit run during compilation reached 3 ms). Rewriting the entire store first would target the smaller measured cost.

## Evidence boundaries and reproducibility

The source was copied before browser measurements because another agent is changing AI masks and ROI in the shared workspace. [snapshot.json](app-performance/snapshot.json) records the base commit and SHA-256 hashes of the copied frontend/native source. This is a **dirty snapshot based on `f5cb551`**, not a benchmark of that commit or of subsequent ROI changes. The temporary checkout path is a session artifact; the hashes and raw results are retained. Node modules, native vendor sources and native build scaffolding were reused locally; the snapshot is not a hermetic build archive.

Raw measurements are in [results.json](app-performance/results.json), with individual `*.chrome.txt` and `*.webkit.txt` files alongside it. Browser audit code: [audit.tsx](../../tools/performance/audit.tsx). Reproduce a new snapshot with:

```sh
node tools/performance/run.mjs state chrome
node tools/performance/run.mjs library webkit
node tools/performance/run.mjs memory webkit
# To compare engines on identical source, supply the printed snapshot directory:
node tools/performance/run.mjs library chrome /path/to/emulsion-audit-...
```

The Swift runner creates a real WKWebView at 1200×800 CSS pixels, DPR 2 on this machine. Chrome used its real Metal GPU, real wall time and DPR 1. This is a **WKWebView surrogate with mocked Tauri IPC**, not an instrumented Tauri application. Differences are descriptive, not a controlled comparison of rendering engines. Development modules, timer precision, JIT, background activity and the small sample counts affect timings. The synthetic Library has no photo file I/O or successful thumbnails. Its commit durations exclude image decoding and full compositor presentation. Selection uses forced React commits to isolate the synchronous work; it is not an input-to-photon measurement. No cold OS-cache claim is made. Some state/memory runs overlapped the native benchmark build; memory-byte totals remain useful, their render timings are not compared.

## Measured Library and state costs

| Workload | Chrome | WKWebView | Boundary |
| --- | ---: | ---: | --- |
| Mount 1,000 Library photos | 169 ms | 212 ms | Single synchronous React commit |
| Mount 10,000 Library photos | 1,129 ms | 1,426 ms | Single synchronous React commit |
| Select in 10,000 photos, median / p95 | 23.9 / 35.4 ms | 93 / 112 ms | 12 forced commits |
| Filter 10,000 to 1,666 photos | 133 ms | 189 ms | Single forced commit |
| Mount 10,000 Filmstrip photos | 682 ms | 782 ms | Single synchronous React commit |
| Edit one recipe among 10,000, median / p95 | 0.7 / 1.0 ms | 1 / 1 ms | 30 isolated store updates, no mounted UI |
| Edit one recipe among 50,000, median / p95 | 3.6 / 4.6 ms | 5 / 8 ms | 30 isolated store updates, no mounted UI |

At 10,000 photos Library has **138,445 DOM elements**, and Filmstrip has **86,703**, with 10,000 frame buttons. At 1,000 photos Library has 13,945 elements. This directly confirms linear DOM growth. Both components map every shown photo ([Library](../../src/ui/Library.tsx), [Filmstrip](../../src/ui/Filmstrip.tsx)). Memoized cells do not avoid parent enumeration, mounting or the per-cell visibility/subscription machinery.

The state benchmark calls the real `editActive`/`editRecipes`, history grouping and persistence scheduling with mocked writes. It does not mount React subscribers, wait for sidecar disk I/O, or include GPU rendering. `editRecipes` maps the photo array and `persistSources` scans photo/hidden/candidate families ([store](../../src/library/store.ts)). Those costs scale, but are much smaller than the mounted Library sample at the agreed 10,000-photo size.

A valid synthetic RLE object raster adds 699,052 characters to a recipe (674 → 700,201 serialized characters). Serializing the large recipe reached 0.5 ms p95 in Chrome and 1 ms in WebKit over 100 calls; small-recipe timing was below the clocks' resolution. A *labelled*, one-photo edit with that raster also stayed near timer resolution because it shares the immutable object and avoids automatic change-description serialization. This does **not** establish that unlabelled HSL edits, normalization, repeated `sectionChanged`, sidecar serialization or 200 distinct mask-history entries are cheap. Measure those call sites before a payload-store migration.

## Measured GPU lifetimes

The new accounting hooks track each context's active unit and target bindings, explicit mip levels, generated mip chains, immutable 2D storage, 3D/array depth and deletion. They count logical texture storage, **not** driver allocations, WebContent RSS, GPU-process RSS, framebuffers, programs or CPU copies. It covers the formats used by this harness; it is not a general-purpose compressed/cube/video texture profiler. Unlike the earlier harness, it does not apply a blanket 1.33 mip factor to every target or mix texture-unit state across contexts.

Three independent engine cycles, each rendering a synthetic 640×427 half-float source with Dehaze, Highlights, Colour, Texture, Clarity and Sharpening, gave identical storage totals in Chrome and WebKit:

| Point | First cycle logical bytes | Meaning |
| --- | ---: | --- |
| Engine and source initialized | 2,912,156 | Includes source mip chain |
| After rendering | 87,163,276 | 60 textures, GL error 0 |
| After source release + `dropBuffers(640,427)` | 30,607,372 | 10 textures retained |
| After `dispose()` | 4 | One 1×1 fallback texture |

The dominant retained amount is exactly `640 × 427 × 16 × 7 = 30,607,360` bytes: **five RGBA32F Colour targets plus two RGBA32F Sharpening targets**. The frozen `dropLaneBuffers` omits both groups, while `freeLaneTargets` releases them ([engine](../../src/engine/engine.ts)). The new disposal behavior corrects the earlier broad claim that disposal leaves those stage buffers behind. Three cycles leave only 4, 8 and 12 logical bytes respectively; do not turn that tiny fallback-texture retention into a claim of a multi-gigabyte disposal leak. Context/program/driver cleanup still needs lifecycle testing.

At 7728×5152, seven such full-size targets alone would occupy **4,459,241,472 bytes (4.15 GiB)**. This is an arithmetic extrapolation of the formats and dimensions, not a new 40 MP allocation experiment. It makes export cleanup a priority even if interactive ROI later bounds viewport maps. Full-image exports still require an independent memory strategy.

The earlier native-app WebKit terminations and ~10.4 GB process figures are **historical evidence recorded in the working handoff notes**, not freshly reproduced here. No test intentionally re-triggered the user's webview termination. The snapshot already contains lane scaffolding; the live tree subsequently added more ROI code. All lifetime findings must be rechecked after that work lands.

## Scheduling, caching and native paths

See [the native audit](app-performance-native.md) for source citations and N1–N6 tasks. Key confirmed control-flow issues:

- Export creates/uploads a source, then awaits capture/profile preparation **before** entering its `try/finally`. Preparation failure can skip `release` and `dropBuffers`. This is separate from the incomplete normal cleanup above.
- Thumbnails, look previews and export reuse the same offscreen engine. Individual synchronous draws are ordered, but asynchronous preparation and source lifetimes can interleave. Use an explicit engine lease rather than assuming an `await` preserves ownership.
- The decoded payload cache has a 512 MiB budget, but Develop caches four GPU sources by count, thumbnail URL maps grow until cleared, raw preview and object caches have separate bounds, and stage targets sit outside those budgets. Individual bounded caches do not bound aggregate memory.
- `ImageLoadCache.clear()` clears bookkeeping but does not stop old promises from completing and populating entries. Thumbnail jobs similarly have no global generation barrier around a clear. Prove this with delayed completions before changing it; stale cache repopulation is a lifecycle hazard, not a measured cause of the user's slowdown.
- Histogram readback occurs 120 ms after edits pause; thumbnail redevelopment uses 400 ms. Timers are not a job coordinator: a new edit can arrive after work starts. Measure queue wait, synchronous readback and stale completions separately.
- Tone-equalizer analysis, highlight extraction and scanner blur still have paths doing work per draw. Cache each on its actual upstream dependencies; an unchanged recipe, a pan and an edit to a downstream slider must be distinct benchmark cases.
- Native commands use `spawn_blocking`, but metadata Rayon, LibRaw, SAM and denoise have no common priority/working-byte admission. SAM refinement snapshots can wait on its mutex before entering blocking work. Denoise keeps its mutex through cache I/O and output preparation.

## New native scan/decode measurements

[native.json](app-performance/native.json) contains direct calls to the frozen scanner and decoder, compiled as an extra test module **only in the disposable checkout**. Three scans per size; two decode calls per photo/size. The native test passed. Compilation took 63 s, excluded from the 77.9 s test execution. Native vendor/build scaffolding came from the shared checkout, so this is not a hermetic native snapshot.

| Native workload | Observed milliseconds |
| --- | ---: |
| Scan 1,000 entries | 15.6–19.9 |
| Scan 10,000 entries | 185.6–233.3 |
| Scan 50,000 entries | 1,069.6–1,131.5 |
| `1OKK6437.JPG`, 512 / 2560 edge | 8,400–8,558 / 11,632–11,768 |
| `1OKK6434.RAF`, 512 / 2560 edge | 2,260–2,283 / 4,915–5,786 |
| `P9250490.ORF`, 512 / 2560 edge | 1,654–1,702 / 4,133–5,234 |

These are **development/test profile** timings: the package config optimizes Emulsion itself to level 2 but dependencies use their default test-profile optimization. They must not be presented as release performance, or as isolating LibRaw alone. Each decode includes native decode/resize, colour/half-float packing and metadata; it excludes Tauri transport and GPU work. Calls deliberately bypass frontend caching and reuse OS caches; the second request is not a warm decoded-cache hit. There are only two samples, so no decode p95 is claimed. The input filenames identify local samples; no photo pixels were added to the repo.

The scans use zero-byte JPEG-named files without sidecars: realistic filesystem enumeration/stat/sort and missing-sidecar checks, but **not** a representative edited library with large mask sidecars, metadata enrichment or thumbnail extraction. They were created immediately before the scans, not under cold disk-cache conditions. The measured ~0.2 s scan at 10k does not explain the 1.43 s UI mount and does not justify a database migration. First compare optimized dependency/release profiles and timestamp decode sub-stages, then consider native decoder or scanner changes. This profile comparison is an early backlog prerequisite, not permission to change decode quality or defaults.

## Ordered implementation backlog

These are implementation tickets, not completed fixes. Preserve full-precision intermediates and the existing mathematical references. Source hashes and entrypoints above define the audited revision; reconcile each ticket with the concurrent ROI work before editing.

| Priority / owner | Concrete change and interface | Expected benefit / confidence | Required acceptance |
| --- | --- | --- | --- |
| P0 engine/export | Put **all** post-source-creation work under one release guard. Make `dropBuffers` release Colour/USM targets and invalidate their scene/final keys in both lanes. | Confirmed failure path and measured retention; removes up to 112 bytes per source pixel from retained targets. | Inject prepare/render/readback/encode failures; retained stage bytes return to baseline; a second render still matches a fresh engine exactly; batch export plateaus. |
| P0 ROI integration | Complete the existing ROI work as one coordinated change. Introduce explicit source scale/region origin and whole-photo dependencies, rather than using region width/full width as scale. | Large expected win; current unfinished implementation not certified. | Per-stage whole/region comparisons including corners, crop/perspective/lens, capture tile alignment, retouch source dependencies, Texture support and Clarity coarse boundary. No automatic whole-40-MP fallback may silently reintroduce the crash. |
| P1 Library | Virtualize grid rows and Filmstrip columns. Start with one viewport of overscan each side. Preserve IDs, collection drag, keyboard range selection, accessibility and scroll restoration; scroll-to-active must work when the cell is unmounted. | Measured large cost; no image-quality risk. | 10k and 50k mounted DOM bounded by viewport + overscan; selection/filter/navigation benchmarks; p95 selection commit target <16 ms at 10k on this Mac; functional Library tests. |
| P1 work coordinator | Add generation-tagged frontend jobs and a per-context engine lease. Priorities: current interaction, visible photo/results, explicit export quota, visible thumbnails, speculative previews/metadata. Native N1 adds byte admission before `spawn_blocking`. | High-confidence contention risk; actual speedup unmeasured. | No obsolete result commits after A→B→C; at most one active render lease per context; queued background work cannot delay a waiting interaction; export progresses under continuous edits; cancellation never drops atomic saves. |
| P1 cache ownership | Account for GPU sources, maps, decoded images, object rasters and URL blobs separately, with aggregate telemetry. Add generation barriers to clear/dispose and release leases. Evict recomputable inactive data before blocking active work. | Confirmed fragmented bounds; size of benefit needs production trace. | Repeat 20 photo/zoom/tool/export cycles; memory reaches a plateau; delayed pre-clear loads cannot repopulate stale caches; no URL/texture use after release. Establish a safe byte budget from native process high-water marks, not the historical 8 GB termination figure alone. |
| P2 analysis caching | Key TEQ/highlight/scanner analysis by source generation, source scale/region, masks and exact upstream settings. Expose per-stage cache-hit counters only in profiling builds. | Avoidable work visible statically; magnitude unknown. | Every cached result equals fresh computation; pan/downstream-edit cases skip work, relevant upstream edits invalidate; no new full-size caches without a measured memory budget. |
| P2 native decode | Implement N2–N4: capture single-flight keyed by file identity, narrower denoise lock phases and SAM blocking boundaries. Then coalesce compatible decode requests under N1. | Confirmed duplicate-work/lock paths; throughput gain depends on workload. | Cold/warm and concurrent identical requests; one native operation per identity; file changes invalidate; stale completions discarded; CPU/provider reference checks unchanged. |
| P2 state/recipes | Add source-family lookup indexes and narrower subscriptions where mounted profiling still shows cost after virtualization. Replace repeated full recipe cache serialization with immutable payload identity plus edit revisions, not a lossy hash alone. | Measured state-only cost modest at 10k; large-mask call-site evidence incomplete. | Changed frame/copy families only; exact undo/redo/sidecars; no same-length/changed-raster cache collision; compare labelled/unlabelled edits with large masks before/after. |
| P3 scan/export throughput | Use native scan/decode stage timings below to choose incremental scan batching or duplicate-decode removal. Profile RGBA readback/IPC/JPEG conversion before changing encoders or adding export concurrency. | Prioritize from measurements; no speedup estimate yet. | Same ordering, crop, filenames, marks/copies, image pixels and quality contract; bounded batch memory; cancellation between photos remains reliable. |

Full-resolution regional processing is not simply cropping every shader input. Dehaze ambient light and capture thresholds are global; multiscale Texture can reach much of the frame; Clarity needs coarse boundary data; retouch can read far-away source spots. A shared scratch pool also cannot overwrite persistent Colour scene analysis, dehaze guide means or outputs still sampled by a downstream pass. Encode lifetimes and invalidation before sharing storage. Preview-derived global values must be compared against the selected whole-image reference before being called exact.

## Coverage and remaining measurements

This audit supplies new Library/state measurements in both browser engines, corrected GPU lifecycle measurements, native source analysis and a disposable native scan/decode harness. It **does not establish** the proposed ≤50 ms Fit / ≤100 ms 100% input-to-visible p95 targets. The surrogate lacks the real Tauri IPC, user photo recipes and compositor presentation timestamps.

Before declaring app-wide performance goals met, add production-shaped trace scenarios for cold/warm launch, first preview, rapid navigation, Fit→100%→pan→Fit, tool open/close persistence, inference overlap, and single/batch export. Correlate input/store/React/render/fence timings with native queue/decode/resize/transfer/inference/encode timings using request IDs and generations. Record actual photo dimensions/settings and all concurrent jobs; report p50/p95/worst and memory plateau independently. GPU timer queries are optional; fence completion and one-pixel readback are different instruments and must be labelled.

Use the confirmed Clone/Heal report as its own native-app reproduction: no spots, tool open then closed, all sliders, photo retained after earlier zoom. The synthetic `retouch-sliders` run from the previous session did not reproduce it; neither the Library findings nor the memory arithmetic proves its cause. Preserve that uncertainty until a matching trace exists.

No renderer rewrite, lower-precision intermediates, adaptive-quality dragging, changed algorithms, database migration or model-provider switch is justified by these data alone. No app source was changed for this audit.

## Validation of the audit tools

Six browser mode/backend combinations completed (state, Library and memory in Chrome and WKWebView), with an additional WebKit state repetition after the native build. All memory draws reported GL error 0. The native scan/decode test passed. The browser audit and its imported snapshot source passed a strict standalone TypeScript check; Node scripts passed syntax checks; the Python helper compiled; the Swift runner compiled and executed. The frozen frontend suite passed **477 tests in 62 files** after supplying its existing public LUT assets and `tools/luts` test dependency. The first suite attempt failed because those assets were missing from the disposable checkout; the runner now supplies them. This is not a full check of the concurrently changing live tree or certification of the in-progress ROI implementation.

After the snapshot, the other agent recorded ROI phase 1 checks in HANDOFF (486 frontend tests, region probes and ~570 MB of textures for a default 40 MP view). Those are separate-agent results, not rerun here. The recorded gate still falls back to whole-photo processing for retouch, Texture, Clarity and several masked filters: the expensive combined recipe remains a required acceptance case. Preview-derived halation products also need comparison with the agreed exact-output contract rather than assuming every visible difference is acceptable.
