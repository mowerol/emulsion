# LaMa fidelity experiment

Compares Carve's `lama_fp32.onnx` with the original PyTorch big-lama generator,
including its original `torch.fft` implementation. This is development tooling;
Python, checkpoints and photos are not shipped with the desktop app.

From the repo root, with Python 3.12:

```sh
python3.12 -m venv src-tauri/target/inpaint/venv
src-tauri/target/inpaint/venv/bin/pip install -r tools/inpaint/requirements.txt
src-tauri/target/inpaint/venv/bin/python tools/inpaint/setup.py
src-tauri/target/inpaint/venv/bin/python tools/inpaint/prepare.py --output /tmp/lama-cases
src-tauri/target/inpaint/venv/bin/python tools/inpaint/compare.py /tmp/lama-cases/cases.json --output /tmp/lama-comparison
```

Setup downloads about 590 MB of pinned model files into the ignored `target`
directory and verifies both SHA-256 hashes. It clones the original implementation
at a fixed commit. `--work` selects another experiment directory. It never installs
the app's model or downloads anything from normal app startup.

`prepare.py` reads the existing samples under `~/Pictures` (override with
`--photos`), makes six 512 × 512 crops and binary brush masks, and records the
preparation in `cases.json`. It does not edit originals. This set covers sky,
foliage, stone, water, a straight edge and a bottle. There is no person in these
samples; the bottle is an explicit whole-object substitute.

For other photos, create a JSON array of at least six objects:

```json
[{"name": "sky", "image": "sky.png", "mask": "sky-mask.png"}]
```

Paths are relative to the manifest; image and mask must already be 512 × 512.
Use 8-bit sRGB images. Positive mask values mean fill, zero means keep. Keep
photos, manifests and visual artifacts outside the tracked repo. Output must be
a new directory so an earlier experiment cannot be overwritten accidentally.

`report.json` records model/source hashes, package versions, timings, and
p50/p99/max absolute channel differences in 8-bit units. Both paths receive the
same decoded RGB float32 `/255` and binary mask. ONNX output is already in
0–255; the original generator gets the same mask concatenation and composition
as upstream's inference wrapper, then the same scaling/clipping. The generator
and checkpoint state are loaded strictly, without modifying upstream source.

The numeric gate requires p99 ≤ 2/255 over both the whole crop and masked pixels
separately. Mask-only statistics stop unchanged surroundings from hiding a bad
fill. Measurements use float outputs before PNG rounding. `comparison.html`
shows the mask, original PyTorch result, ONNX result and difference amplified
16 times at 100%. **Visual review is required separately**; a numeric pass alone
does not complete the fidelity gate. First-call timing is included in the first
case; these measurements are not the native CPU/CoreML benchmark.

Run the gate's regression checks:

```sh
src-tauri/target/inpaint/venv/bin/python -m unittest discover -s tools/inpaint -p 'test_*.py'
```

The modern Python environment imports the upstream generator directly, avoiding
the old training CLI's dependencies. The verified Lightning checkpoint includes
training metadata, so its legacy pickle loader is enabled only after checking
its bytes against the pinned archive. See [source notes](../../docs/research/lama-model-sources.md)
for pins, attribution and the training-data terms, and [measured report](../../docs/research/lama-onnx-fidelity.md)
for results.

## Native backend

The native `inpaint-probe` runs the same Rust adapter as the desktop command.
It accepts a prepared 512² PNG crop and mask, retains one session, and saves PNGs
and load/per-patch timings. See [native commands and measurements](../../docs/research/lama-native.md).
Develop and export use the same native adapter.

## Remove context quality probe (#48)

With the existing model environment prepared, run from the repo root:

```sh
src-tauri/target/inpaint/venv/bin/python tools/inpaint/quality.py --output /tmp/remove-quality
```

The output directory must be new. No downloads occur. The probe uses Vite to load
the app's actual retouch code, then feeds its crop, resampled image and binary mask
to the verified FP32 model on CPU. It tests a dark object over a known blue
background: one small removal and large removals in synthetic 24 MP and 96 MP
photos. It selects the preview or full source using the app's normal rule.

`report.json` records source/model/input hashes, dependency versions, crop geometry,
masked fraction, inference time and color error in the center of the removed
object. The measured disk has one quarter of the spot's full-size radius, so the
same part of the object is compared when the context changes. The numeric gate
requires p99 absolute channel error below 10/255; it exits nonzero on failure.
Inspect the input, mask and output PNGs separately. This narrow regression probe
does not establish reconstruction quality on natural photographs or RAW files.
See [the issue 48 findings](../../docs/research/issue-48-remove-context.md).

## Conditional MI-GAN candidate

LaMa misses the strict 2-second native bound on this M2, so `migan.py` checks the
planned lighter option. It downloads the author's inference source and `.pt`,
exports the static 512 core locally, and compares against unmodified PyTorch on
the same six cases. The checkpoint's pinned hash was computed from that linked
release, rather than independently published. Run it with the same manifest and
a new `--output`; see [results and commands](../../docs/research/migan-fidelity.md).
This candidate is not selected or installed in the desktop app.
