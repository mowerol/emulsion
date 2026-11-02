# Native performance audit

2026-11-02. Supporting analysis for the app-wide performance audit. **Static code inspection, not new native timings.** HEAD was `0093c334ba60b225090497ebe4da7cc81aa64bcb`; AI-mask and ROI development was occurring concurrently in the dirty tree. The findings below concern the inspected native/API code, not claims that a moving engine implementation still behaves as an earlier handoff described. No application code was changed.

## Evidence and priorities

### 1. Introduce admission control before increasing concurrency

All normal Tauri commands use a common `spawn_blocking` wrapper, but that wrapper does not enforce job priority, byte admission or stale-request cancellation ([commands.rs:14](../../src-tauri/src/commands.rs#L14)). Catalog metadata and white-point batches use Rayon parallel iteration ([commands.rs:29](../../src-tauri/src/commands.rs#L29), [commands.rs:114](../../src-tauri/src/commands.rs#L114)). A frontend limit of four thumbnail fetches is useful but does not constrain concurrent Develop decodes, exports or inference ([thumbs.ts:19](../../src/library/thumbs.ts#L19)).

**Inference:** a job being off the UI thread does not prevent it competing with the active photo for memory bandwidth, CPU and temporary image storage. No measured queue-wait or contention breakdown exists in this audit. Do not call unrestricted parallel decoding a speed improvement: each decode can retain several large buffers.

**Task N1, high priority:** add a native work coordinator with job identity, purpose (active preview/full, visible thumbnail, metadata, export, inference), estimated working bytes, queue timestamp and source generation. Admit one large decode/inference initially; admit background work only when active work is not waiting, and retain an explicit export quota so continuous interaction cannot starve an export. Cancellation removes queued work; already-running uninterruptible LibRaw calls finish with obsolete results discarded. Preserve atomic sidecar writes outside cancellable image-work queues. Tune concurrency only from queue-wait, throughput and peak-RSS measurements.

**Acceptance:** rapid A→B→C navigation cannot accumulate a queue of background decodes before C; simultaneous metadata, thumbnails and export stay within the configured admission budget; encode/decode jobs have separate queue and execution durations; canceled jobs cannot publish another photo's result.

### 2. Avoid duplicate decoding without changing preview pixels

`load_for_engine` selects half-size LibRaw decoding at ≤2560 px, then downsizes; separate 512 and 2560 requests still perform separate LibRaw decodes. A small sensor can require an additional full decode when its half-size result is too small ([decode.rs:165](../../src-tauri/src/decode.rs#L165)). Ordinary images are fully decoded and oriented before resize ([decode.rs:176](../../src-tauri/src/decode.rs#L176)). The JS image cache suppresses duplicates only for the same requested edge; export calls `loadImage` directly rather than `loadCachedImage` ([thumbs.ts:24](../../src/library/thumbs.ts#L24), [export.ts:36](../../src/library/export.ts#L36)).

Capture metadata has a one-photo cache, but concurrent misses can both call `Info::read` because the lock is released before the read. Every capture request separately reopens metadata for the working-to-camera matrix ([commands.rs:86](../../src-tauri/src/commands.rs#L86), [raw.rs:235](../../src-tauri/src/raw.rs#L235)).

**Task N2, high priority:** coalesce identical native requests by canonical source identity, file version, decoder version, decode mode, edge and noise-reduction state. Coalesce capture-info misses and cache the matrix with the same source version. Instrument cross-size requests first. Reusing an already-resized preview to make a thumbnail can change resampling results; do not silently introduce that shortcut. If cross-size sharing is worthwhile, share the same pre-resize decode while retaining each existing resize path and test pixels.

**Acceptance:** simultaneous identical requests invoke LibRaw/capture extraction once; changed files invalidate caches; half/full decode distinction survives; small-sensor fallback stays correct; virtual copies share source work; signed RAW values and existing payload pixels remain unchanged. Cache limits include all live references and in-flight allocations, not merely map entries.

### 3. Make denoise cache retention visible and shorten critical sections

The denoise worker deliberately retains one full-resolution RGB32F original/result pair and its model ([noise_cache.rs:22](../../src-tauri/src/noise_cache.rs#L22)); it frees the old pair before loading another. At 7728×5152, the two RGB32F planes alone occupy **955,551,744 bytes (~911 MiB)**. This is native memory, separate from webview/GPU allocations. The mutex stays held through disk-cache reads or inference, disk-cache writes, resizing and payload packing ([noise_cache.rs:225](../../src-tauri/src/noise_cache.rs#L225)). Full-size payload construction clones the original image, then clones/resizes the denoised image. The model/pair are explicitly released at app exit ([noise_cache.rs:211](../../src-tauri/src/noise_cache.rs#L211), [lib.rs:137](../../src-tauri/src/lib.rs#L137)). This is intentional retention, not evidence of a leak.

**Task N3, medium priority:** retain serialized inference, but release the worker lock once an `Arc<Pair>` has been obtained for output conversion. Include the retained pair and transient output copies in the global memory budget. Pack unchanged full-size source/result planes directly into a correctly reserved payload rather than cloning full RGB32F images first; preserve half-float conversion order. Add a deliberate idle/memory-pressure release path for the pair/model, preserving the valid disk cache and provider fallback. Moving writes off the critical path requires retaining atomic cache publication and accounting for the pair until the write finishes.

**Acceptance:** same-photo resized requests share one inference; identical half-float payloads at all sizes; disk-cache hits do not load the model; retries remain explicit; memory returns to a documented idle plateau; concurrent requests do not multiply full-size transient copies without admission.

### 4. Keep SAM responsiveness separate from model warm-up and refinement

SAM keeps its model, one encoding and last mask until shutdown ([ai_masks.rs:190](../../src-tauri/src/ai_masks.rs#L190)). Encoding and decoding execute while holding the SAM mutex inside blocking work; DenseCRF clones mask/RGB under that mutex **before** calling `spawn_blocking` ([ai_masks.rs:280](../../src-tauri/src/ai_masks.rs#L280)). Thus a refinement request can synchronously wait for an encoder/decoder lock in the async command, even though DenseCRF itself runs off-thread. It is not established that this blocks the native UI thread.

SAM's encoder and denoiser each configure four intra-op threads; their independent workers do not coordinate with each other or Rayon ([segment.rs:480](../../src-tauri/src/segment.rs#L480), [denoise.rs:127](../../src-tauri/src/denoise.rs#L127)). Encoding also clones incoming RGBA then allocates RGB; refinement clones float mask and RGB. These are visible costs, not proof they dominate latency.

**Prior measurements, not rerun:** the handoff reports M2 CPU SAM load ~0.2 s, encode ~1.4 s, decode ~55 ms and DenseCRF ~1.7 s. It reports CoreML's first encoder compilation ~56 s and subsequent model load ~11 s. These support retaining the current CPU default pending a controlled provider comparison; they do not justify promising a GPU speedup.

**Task N4, medium priority:** move SAM lock acquisition/snapshot cloning into the blocking job; timestamp lock wait separately; admit refinement with source/prompt generations and discard superseded results. Keep the immediate SAM mask followed by refined mask behavior. Account for resident models and snapshot copies; evict encoding separately from model when possible. Defer DenseCRF threading until profiling shows its bottleneck and a reference-equivalence test exists.

**Acceptance:** stale clicks/photo switches cannot commit refinements; warm clicks reuse the encoder; overlapping SAM and denoise obey the global budget; disabling/re-enabling the tool has measured warm/cold costs; undo state remains correct before performance claims.

### 5. Reduce export peak copies and close all failure paths

Export is sequential per photo. It decodes, uploads, prepares, reads the full RGBA8 output back, transfers it to Rust, and writes JPEG ([export.ts:57](../../src/library/export.ts#L57)). `write_export` clones the raw request body before blocking; JPEG encoding then allocates an RGB copy and the encoded JPEG ([commands.rs:160](../../src-tauri/src/commands.rs#L160), [export.rs:32](../../src-tauri/src/export.rs#L32)). A 7728×5152 frame is ~152 MiB of RGBA8, before the RGB copy, request storage and GPU buffers. Tauri transport's own copy count was not measured; do not describe this as zero-copy.

The `finally` that releases the source starts **after** `ensureCapture` and `engine.prepare`. A failing prepare therefore bypasses that cleanup ([export.ts:65](../../src/library/export.ts#L65)). Export cancellation is checked between photos, not during a photo. These are confirmed control-flow properties, not measured causes of interactive lag.

**Task N5, high priority for cleanup; later for throughput:** put all work following source creation under the release guard, including capture preparation and profile loading. Serialize ownership of the shared offscreen engine across export, thumbnail and look-preview jobs. Instrument decode, prepare/render, readback, IPC clone, RGB conversion and JPEG encoding before selecting optimizations. Avoid raising export parallelism until GPU and native admission are bounded. Investigate direct RGB/streaming encoder paths only if they preserve the chosen JPEG output contract; removing a required output plane is not automatically safe.

**Acceptance:** injected capture/profile/readback/encoding errors release all owned resources; a batch has a bounded memory plateau; cancellation prevents the next photo and cleans up the current one; JPEG dimensions, crop, orientation, quality, filename collision behavior and pixels remain compatible.

### 6. Stream large-folder discovery after profiling the initial scan

The scanner walks entries, reads each sidecar, accumulates all entries, sorts them and returns one complete result ([library.rs:138](../../src-tauri/src/library.rs#L138), [library.rs:180](../../src-tauri/src/library.rs#L180)). Large object rasters therefore contribute to scan payload size before the UI can use the result. White points and catalog metadata are separate batches. No 10,000-file native scan benchmark was run here.

**Task N6, medium priority:** measure traversal, sidecar read/parse, sort, serialization, transfer and frontend normalization independently on cold/warm 10,000-photo fixtures. If first usable Library latency is dominated by all-at-once scanning, expose source-generation-tagged batches with completion/error events. Keep the final deterministic order and selection identity; stage metadata enrichment independently. Index by canonical source and file version before attempting a database migration.

**Acceptance:** first usable thumbnails can appear before full enrichment; switching sources rejects old batches; partial errors remain visible; final ordering, virtual-copy families and save semantics match the existing scanner; memory and transfer bytes are reported for sidecars with large rasters.

## Measurement gaps and source snapshot

This supporting audit ran no new real-photo native performance tests. Claims of speedup require cold/warm native runs with decode counts, queue waits, native RSS, webview/GPU memory, transferred bytes and p50/p95 timings. Existing source unit tests establish behavior, not latency or app-wide contention. None of the recommendations requires lowering image precision or replacing a community algorithm.

SHA-256 of the principal files inspected (concurrent tree; compare these before implementing):

```text
commands.rs       89681f3a7a9facac51f50731c1cac50e140a915ba3e1609f5db9304b00126295
decode.rs         795ee376ee86d69162f1201adbb0981fcc593e2e2addcf21a706ca3dcfba3a3c
noise_cache.rs    81023d6d5d2804e26474567763e38749d070d3c998a9fcc97c5e2d491613663e
ai_masks.rs       7871f663dbd087bee7dc58aefc4abe47ed8c21c96fb7f067bd61abb44b8a2ec5
library/export.ts 27754d8ee6510c376d41cf84b14f1293894ee95b4881ba6472431e8343cbe19f
```
