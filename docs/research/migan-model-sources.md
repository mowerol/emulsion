# MI-GAN candidate: sources and comparison contract

Checked 2026-11-04 as a possible Remove fallback. This does not select MI-GAN or establish a LaMa performance failure. No complete model was downloaded; artifact signatures below were inspected through bounded HTTP ranges.

## Official sources and pins

The official implementation is [Picsart-AI-Research/MI-GAN](https://github.com/Picsart-AI-Research/MI-GAN), inspected at commit [`2b793c5ece43f4253e32d4afc257120a5deed6f5`](https://github.com/Picsart-AI-Research/MI-GAN/commit/2b793c5ece43f4253e32d4afc257120a5deed6f5). The official README links the lead author's Hugging Face repository for the prebuilt pipeline. Its inspected revision is `406830d0fa60666da0071c342ad2fbc8f30c5c64`. [Model metadata and published hashes](https://huggingface.co/api/models/andraniksargsyan/migan?blobs=true).

| Published ONNX artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| [migan_pipeline_v2.onnx](https://huggingface.co/andraniksargsyan/migan/resolve/406830d0fa60666da0071c342ad2fbc8f30c5c64/migan_pipeline_v2.onnx) | 28079181 | `6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b` |
| [migan.onnx](https://huggingface.co/andraniksargsyan/migan/resolve/406830d0fa60666da0071c342ad2fbc8f30c5c64/migan.onnx) | 29546882 | `593eba0b7e04730f1b61c0a3cbca68d97d8d6a7ff5c6a44a7b9d7fcd880fc5ae` |

**Both published files are dynamic image/mask pipelines.** The filename `migan.onnx` does not mean a static four-channel core model. At these pinned URLs, bounded tail reads show `image` and `mask` uint8 inputs and `result` uint8 output in both artifacts. The older file declares opset 12; v2 declares opset 17. The official [pipeline builder](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/scripts/create_onnx_pipeline.py) corresponds to the latter contract. An official, already published static 512 core export was **not** found in these sources.

The official 512 PyTorch state dictionary is [`migan_512_places2.pt` on Google Drive](https://drive.google.com/file/d/1D_YCuCgo20S2256sqpedsmENNm2WMtVY/view). The author directly identifies that file in [issue 25](https://github.com/Picsart-AI-Research/MI-GAN/issues/25); the repository's [checkpoint folder](https://drive.google.com/drive/folders/1xNtvN2lto0p5yFKOEEg9RioMjGrYM74w) is another official entry point. No immutable revision or SHA-256 for the `.pt` was published in the inspected sources. Download once from that source, record its size and hash, and retain it outside the repository. Treat a generated static ONNX file as a new artifact with its own hash and recorded export environment; the published pipeline hashes do not authenticate it.

## Contracts: core and pipeline

### Static core to export locally

The [official export script](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/scripts/export_inference_model.py) uses a float32 `input` shaped `[1,4,resolution,resolution]`, float32 `output`, opset 12 and no dynamic axes. For resolution 512, the output is `[1,3,512,512]`. This export contains the generator, with preprocessing and compositing performed by the caller.

For one shared 512 × 512 uint8 RGB crop `I` and a hole mask `H` (1 = remove), create the **known-region** mask `K = 1-H`. The [official demo preprocessing](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/scripts/demo.py) gives:

```text
rgb = float32(I) * 2/255 - 1       # RGB NCHW
input = concat(K - 0.5, rgb * K)  # mask channel first, then RGB
raw = generator(input)            # float32 NCHW RGB
predicted_255 = clamp((raw * 0.5 + 0.5) * 255, 0, 255)
composited_255 = I * K + predicted_255 * (1-K)
```

`K` must be binary float32, `[1,1,512,512]`. This convention is the inverse of LaMa's hole-mask input. Raw output uses the model's normalized RGB interpretation; it is not guaranteed to stay within −1..1 because the [generator](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/lib/model_zoo/migan_inference.py) returns a synthesis sum without a final clamp. Clamp identically after both runtimes.

### Published pipeline

| Tensor | Contract |
| --- | --- |
| `image` | uint8 RGB `[1,3,H,W]` |
| `mask` | uint8 `[1,1,H,W]`, 255 = known, 0 = hole |
| `result` | uint8 RGB `[1,3,H,W]`, composited result |

The graph metadata uses symbolic batch and spatial dimensions. Use batch 1: the builder's bounding-box code squeezes tensors and computes one crop; symbolic metadata is not evidence of correct multi-image batching. The builder resizes the mask to image dimensions and runs a 512 core after its own crop/resize, then blends and writes back. Its defaults include crop padding 128, minimum crop side equal to the model resolution, bilinear RGB resizing, nearest-neighbor mask resizing, max-pooling of the known mask, and a 5 × 5 sigma-1 Gaussian blend. [Pipeline implementation](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/scripts/create_onnx_pipeline.py).

For Emulsion's existing crop planning and brush compositing, a static core is the cleaner experiment: the pipeline adds a second crop and its own edge treatment. That is an integration recommendation based on the source, not a measured quality result.

## Reference and export recipe

Use the released `.pt` with the official `migan_inference.Generator(resolution=512)`, `load_state_dict`, `eval()`, CPU float32 and `torch.no_grad()`. The [inference module](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/lib/model_zoo/migan_inference.py) itself imports only NumPy and PyTorch. Loading that file directly with `importlib.util.spec_from_file_location` avoids the [package initializer](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/lib/model_zoo/__init__.py), which imports the training `migan` and `comodgan` modules. The standalone inference path needs no custom compiled extensions. Do not run weight reparameterization again: the published `.pt` is already the inference state dictionary used by the [demo](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/scripts/demo.py).

For a static export, apply the export script's final `torch.onnx.export` call directly to this loaded inference generator with dummy input `[1,4,512,512]`, `input_names=["input"]`, `output_names=["output"]`, opset 12 and no dynamic axes. Record the PyTorch/exporter/ONNX versions and explicitly select the legacy exporter where modern PyTorch would otherwise change defaults. This is an adaptation of the official script, which starts from a training `.pkl`, copies/reparameterizes weights into the same inference class, and then exports it. [Official export implementation](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/scripts/export_inference_model.py).

For fidelity, feed precisely the same prepared `input` to PyTorch and ONNX Runtime. Compare raw float tensors as a diagnostic, and the identically converted/composited 0–255 float outputs for the Remove tolerance (`p99 <= 2` in 8-bit units). Save both visual outputs with the same final uint8 conversion. Compare on the original six crops and masks, and report runtime/provider/thread configuration, warm-up and model load separately. Do not compare the official demo's bicubic preprocessing against the pipeline's bilinear preprocessing and attribute that discrepancy to ONNX.

To validate the published pipeline instead, run the official `MIGAN_Pipeline` PyTorch wrapper with the same checkpoint against v2 ONNX using cloned identical uint8 images and masks; the PyTorch wrapper mutates its image argument when writing the crop back. This tests the complete pipeline, including blending and uint8 truncation, rather than core export fidelity. [Wrapper and example ONNX invocation](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/scripts/create_onnx_pipeline.py).

## macOS performance guidance

No official macOS CPU or M2 latency guarantee was found. The [README](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/README.md) explicitly distinguishes paper timings of the pure model from the later pipeline's extra processing. Its CUDA-pinned [requirements](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/requirements.txt) are not a macOS installation recipe. In the author's [license/inference clarification](https://github.com/Picsart-AI-Research/MI-GAN/issues/25), inference deliberately avoids custom CUDA implementations to support ONNX/mobile deployment.

Measure the static 512 core with Emulsion's actual ONNX Runtime version and CPU execution provider first, then CoreML. Sweep a small number of CPU intra-op thread counts and retain one session rather than paying initialization per crop. This measurement recommendation follows [ONNX Runtime's official threading guide](https://onnxruntime.ai/docs/performance/tune-performance/threading.html); it does not predict MI-GAN's M2 timing. Include crop conversion/compositing in the user-facing latency assessment and report them separately from session inference.

## License and provenance

The official [`LICENSE`](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/LICENSE) and [`LICENSE-WEIGHTS`](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/LICENSE-WEIGHTS) are MIT with exact notice `Copyright (c) 2024 Picsart AI Research (PAIR)`. Preserve that notice and permission text for copied source/weights. The [author's HF license](https://huggingface.co/andraniksargsyan/migan/blob/406830d0fa60666da0071c342ad2fbc8f30c5c64/LICENSE) carries the same grant. Credit the paper's authors: Andranik Sargsyan, Shant Navasardyan, Xingqian Xu and Humphrey Shi.

In [issue 25](https://github.com/Picsart-AI-Research/MI-GAN/issues/25), the author explicitly confirms the released PyTorch and ONNX weights are MIT; he does not resolve the question about rights inherited through the training teacher/code. The model is trained on Places2 and distilled using a Co-Mod-GAN teacher. Preserve that provenance distinction: the explicit MIT weights grant is stronger evidence than a repository-only inference, while it is not an answer to every training-data/teacher-rights question. The current official Places legacy data terms are documented in [the LaMa source note](lama-model-sources.md#attribution-and-training-data-terms). No Places training images are needed to compare local photo crops.
