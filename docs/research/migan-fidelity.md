# MI-GAN as a fast Remove candidate

2026-11-04: the conditional fast-model experiment **passes fidelity and the
2-second speed bound in Python/ONNX Runtime** on the M2. It is not installed,
bundled or selected by the desktop app, and it has no native adapter yet.

[Primary-source research](migan-model-sources.md), [raw results](migan-fidelity.json),
and runnable tool [`tools/inpaint/migan.py`](../../tools/inpaint/migan.py).
The experiment was triggered by LaMa's [native speed result](lama-native.md).

## What was compared

The original inference generator from
[Picsart's pinned source](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/lib/model_zoo/migan_inference.py)
is loaded directly, unchanged, with the author's released `migan_512_places2.pt`
weights loaded strictly. Its static 512 core is exported with the official
export script's opset-12/float32 contract, using the legacy PyTorch exporter.
No training modules or compiled extensions are required.

The checkpoint SHA-256 was computed from the author's linked Google Drive release:
`1d6087eee0aac8923ad2606be5d8caeb4824d3e4de331995e420c74e124a466a`.
It was not independently published. The tool pins that hash on subsequent runs,
along with source and license hashes. The generated ONNX hash and length are
recorded in JSON; it is a local export, not the author's published pipeline.

The same six crops/masks as LaMa feed both runtimes. MI-GAN uses the inverse
mask convention: known-region mask `K = 1-hole`; input is
`concat(K-0.5, (2*RGB/255-1)*K)`. Both outputs are denormalized, clamped and
composited identically before comparison. This is the pure-core route; the
published uint8 pipeline adds another crop/resize and mask treatment, so it is
not interchangeable with this export. See the source note for exact contracts.

## Results

Apple M2, four CPU threads, ONNX Runtime 1.23.2, PyTorch 2.8.0, ONNX 1.19.1.
Numbers are float-output differences in 8-bit channel units before PNG rounding.

| Crop | Masked p99 | Maximum difference | ONNX seconds |
| --- | ---: | ---: | ---: |
| Sky / pole | 0.00009155 | 0.00093079 | 0.296 |
| Foliage / leaf | 0.00013733 | 0.00038910 | 0.690 |
| Stone / mark | 0.00007752 | 0.00015259 | 0.253 |
| Water / reflection | 0.00004578 | 0.00009155 | 0.249 |
| Straight edge / lamp | 0.00004578 | 0.00007629 | 0.252 |
| Whole object / bottle | 0.00011444 | 0.00069427 | 0.253 |

All whole-crop and masked p99 values are below 2/255. Codex inspected all six
PyTorch/ONNX image pairs and found no visible conversion differences. The model's
bottle fill is visibly different from LaMa's and reconstructs part of a container
shape on the wall. This is a quality trade-off, not an export-fidelity failure;
neither model should be described as universally better from six crops.

Most sequential loaded-session crops took ~0.25 seconds, with one 0.69-second
sample. These are Python measurements over the pure 512 core, excluding native
IPC, crop planning and cache I/O. A native benchmark remains required before
claiming end-to-end app latency. Local results are in
`/private/tmp/emulsion-migan-fidelity/comparison.html`; photos stay outside Git.

## Reproduce

With the existing inpaint venv and prepared six-case manifest:

```sh
src-tauri/target/inpaint/venv/bin/pip install -r tools/inpaint/requirements.txt
src-tauri/target/inpaint/venv/bin/python tools/inpaint/migan.py \
  /tmp/lama-cases/cases.json --output /tmp/migan-comparison
```

The script explicitly downloads the inference source, license and 29.6 MB
checkpoint into ignored development assets, then creates a local ONNX export.
It never alters an installed app model or changes saved LaMa spots. A production
fast option still needs a verified distributable artifact, native tensor adapter,
model identity in recipes/cache keys, and its own CPU/CoreML benchmark.
