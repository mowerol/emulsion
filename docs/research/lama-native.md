# Native LaMa inference and cache

2026-11-04: the native backend is implemented and tested. **CPU is selected.**
It produces correct patches, but the measured warm time of about 2.2 seconds on
the M2 misses the strict 2-second target. CoreML with static batch 1 fails during
inference on the Fourier subgraph. The conditional MI-GAN investigation therefore
proceeded; [its static-core experiment](migan-fidelity.md) is substantially faster.
The develop view and export lifecycle are now integrated (2026-11-05; see `HANDOFF.md`).
The retouch UI, consent and warning/continue flow remain outstanding.

## Native interface

`src-tauri/src/inpaint.rs` verifies the pinned model bytes and loads those exact
bytes into a retained ONNX Runtime 1.23.2 session. Inputs are 512² RGBA8 sRGB and
512² mask bytes; any positive mask value means fill. Packing is RGB NCHW `/255`
and binary float mask. The graph already composites and scales to 0–255; the
adapter checks tensor dimensions and finite/ranged output before rounding RGB
to RGBA8 with opaque alpha. Colour conversion stays in `engine/remove.ts`.

Commands and the typed wrappers in `backend/api.ts`:

- `remove_status`: support, installed state, missing download bytes and model hash.
- `remove_install`: opt-in install, with `remove-download-progress` events. Reuses
  the object-mask installer, now in `ai_models.rs`, including the shared runtime.
  The model download is 208,044,816 bytes; another 9,999,931 bytes are needed if
  the runtime is absent. Both downloads are verified by their pinned SHA-256.
  The raw LaMa installation also writes the preserved Apache-2.0 license beside
  the model before publishing the package.
- `remove_cached_patch`: a validated 28-hex-character `key`, returning the existing
  raw RGBA8 patch or empty bytes on a miss. It checks record integrity and runs
  independently of the model worker. Develop uses it before crop preparation so
  returning to a photo restores its completed removals without another decode,
  capture preparation or inference, including across engine restarts.
- `remove_inpaint`: binary crop followed by mask, with a 28-hex-character patch
  key header; returns raw RGBA8. A serialized blocking worker keeps inference off
  the interface thread, retains one model session, and drops it on app exit.

App assets go in `app_data_dir()/ai-models`, with the LaMa model under
`remove-lama-fp32/lama_fp32.onnx`. No normal startup downloads or loads a model.
Development setup downloads into ignored `target/inpaint`; it does not install
anything into the app's model directory or consent on the user's behalf.

Patches live in `app_data_dir()/remove-patches/<model SHA-256>/`, outside sidecars.
The fixed-size binary record has a version marker and BLAKE3 pixel checksum.
Malformed, truncated or corrupted entries are misses and can be rebuilt. Entries
are written by rename, reads update usage time, and least-recently-used entries
are evicted above **512 MiB**. Native cache hits skip runtime/model initialization,
including after restart. A disk-write failure does not discard valid inference.

## Reproduce native inference

Prepare the verified model and six private crops as described in
[`tools/inpaint/README.md`](../../tools/inpaint/README.md). The native CLI needs
the ONNX Runtime already installed by the denoise setup, or `--runtime DYLIB`:

```sh
source ~/.cargo/env
cargo build --manifest-path src-tauri/Cargo.toml --features inpaint-probe --bin inpaint-probe
src-tauri/target/debug/inpaint-probe --provider cpu --repeat 4 \
  --output /tmp/lama-native-cpu \
  /tmp/lama-cases/whole-object-bottle.png /tmp/lama-cases/whole-object-bottle-mask.png
```

Repeat with `--provider coreml` and a fresh output directory. The CLI bypasses the
patch cache deliberately so each repeat actually performs inference. It saves
patch PNGs, load time, all per-patch times, and a strict pass/fail over repeats
after the first. Errors are retained in its JSON report. Provider failures are
reported rather than silently switched during measurement.

## Measurements

[Raw reports](lama-native.json), Apple M2 / macOS 26.5.1 / ORT 1.23.2, four
intra-op threads, one inter-op thread. Packing/output conversion is included in
per-patch time; PNG encoding is excluded. Session load includes hash verification.

| Run | Load | First patch | Warm patches | Result |
| --- | ---: | ---: | --- | --- |
| Final CPU, verified-buffer loading | 1.423 s | 2.178 s | 2.154 / 2.143 / 2.110 s | Correct; misses 2 s |
| CPU, batch fixed to 1 | 1.399 s | 2.231 s | 2.213 / 2.178 / 2.167 s | Correct; misses 2 s |
| CoreML, batch fixed to 1 | 3.672 s | Error | None | Cannot use |
| Initial CoreML, symbolic batch | 34.187 s | 2.465 s | 3.845 / 2.663 / 2.686 s | Slower; offload coverage unproven |

The published export has a symbolic batch axis despite fixed spatial dimensions.
Setting the `batch` dimension override to 1 enables static partitioning but fails
at a required Fourier `Gather` feature: “required but not specified.” The exact
ORT error is in JSON. The initial symbolic-batch result is not evidence of Neural
Engine execution and does not justify selecting CoreML.

The initial debug CPU load was 10.294 seconds because SHA-256 was unoptimized;
optimizing that dependency reduced load to 1.399 seconds without changing model
maths. This does not improve the ~2.2-second inference itself. Final code loads
the verified buffer directly instead of reopening the path; the final run above
checks that version and is recorded separately in the raw JSON.

The initial native CPU and symbolic-batch CoreML PNGs matched the PyTorch reference
at p99 0/255, max 1/255 after rounding, on the whole-bottle crop. The ignored
real-model test also verifies exact preservation outside the mask.

Checks cover crop/mask channel orientation and binary conversion, invalid output,
unverified models, bad download checksums, persistent cache hits without model
loading, corruption, path-key validation and LRU eviction. Ordinary tests require
no model/runtime/network. Real-model tests are opt-in; the installed LaMa test was
run successfully on this machine.
