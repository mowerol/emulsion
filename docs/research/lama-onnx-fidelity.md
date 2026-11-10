# LaMa ONNX fidelity

2026-11-04: **PASS** for the six tested crops. Carve's pinned FP32 ONNX export
matches the original big-lama generator within the agreed p99 ≤ 2/255 bound,
including when measured over generated pixels alone. Visual comparison showed
no visible export differences. This validates conversion fidelity for these
samples; it does not establish removal quality for every object or photograph.

## Reproduction and provenance

[Tool and commands](../../tools/inpaint/README.md), [raw measurements](lama-onnx-fidelity.json),
and [primary-source investigation](lama-model-sources.md).

The reference imports the unmodified generator from
[`advimman/lama` at `786f593`](https://github.com/advimman/lama/tree/786f5936b27fb3dacd2b1ad799e4de968ea697e7),
with its native `torch.fft`, loading generator weights strictly from the
[pinned checkpoint archive](https://huggingface.co/smartywu/big-lama/resolve/05cb2be7f8dbe6ca7c6e78f4fc827a4b2baaa4a9/big-lama.zip)
used by Carve's export notebook. Extracted `best.ckpt` SHA-256:
`fccb7adffd53ec0974ee5503c3731c2c2f1e7e07856fd9228cdcc0b46fd5d423`.
The archive and ONNX file hashes are verified before loading; extracted checkpoint
and configuration bytes are checked against the verified archive as well.

Both paths receive identical decoded 8-bit sRGB `/255` and binary masks. The
reference repeats the original inference wrapper's mask concatenation and
composition, without training infrastructure, refinement or a replacement Fourier
unit. ONNX output is already composited float32 RGB in 0–255. Measurements use
float output before PNG quantization; visual images use identical rounding.

Machine: Apple M2, macOS 26.5.1, Python 3.12.13, PyTorch 2.8.0,
ONNX Runtime 1.23.2, NumPy 2.2.6, Pillow 11.3.0, four CPU threads.
The original generator code was unchanged. Modern dependencies replace the old
training environment; the report records the actual versions used.

## Results

All differences below are absolute RGB channel differences in **8-bit units**;
divide by 255 for normalized values. Masked statistics exclude unchanged context.

| Crop | Masked p50 | Masked p99 | Masked max | Whole p99 |
| --- | ---: | ---: | ---: | ---: |
| Sky / pole | 0.00003052 | 0.00036621 | 0.00135803 | 0.00003052 |
| Foliage / leaf | 0.00017357 | 0.00176628 | 0.00567245 | 0.00020218 |
| Stone / mark | 0.00010681 | 0.00090271 | 0.00262451 | 0 |
| Water / reflection | 0.00006104 | 0.00048828 | 0.00128174 | 0.00006104 |
| Straight edge / lamp | 0.00003052 | 0.00015259 | 0.00038147 | 0 |
| Whole object / bottle | 0.00018311 | 0.00114441 | 0.01569366 | 0.00064087 |

Worst masked p99: **0.00176628/255**, against 2/255. Worst individual channel
difference: **0.01569366/255**, also below that threshold.

The available samples contain no person; a completely masked bottle substitutes
for that whole-object case. Stone and water cases cover texture filling, rather
than claiming a separate identifiable object in each. The sky case deliberately
retains crossing cables; both models leave identical disconnected cable remnants.
The bottle case likewise shows LaMa's imperfect reconstruction beside a neighboring
bottle, identically in both paths.

Local photos, prepared crops and visual results remain outside the repo:
`/private/tmp/emulsion-lama-cases-v2/` and
`/private/tmp/emulsion-lama-fidelity-v2/comparison.html`. The preparation script
records crop coordinates and masks, and the committed JSON records input hashes.
Codex inspected all six PyTorch/ONNX PNG pairs; the first five were unchanged
between runs (identical crop and mask hashes), and the final whole-bottle pair was
reviewed separately after expanding its mask to cover the entire bottle.

The ONNX Python runs in the final comparison took 2.46–2.77 seconds per crop;
session load took its own recorded time. These are fidelity-run observations,
not the native CPU/CoreML speed acceptance test. That benchmark uses
`inpaint-probe` with repeated patches and separate loading time.
