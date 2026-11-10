# LaMa model sources and comparison contract

Checked 2026-11-04 for Remove issue 01. These are source findings, not a fidelity result. No model weights were downloaded during this research.

## Pins

| Component | Revision | Evidence |
| --- | --- | --- |
| Original PyTorch implementation, `advimman/lama` | `786f5936b27fb3dacd2b1ad799e4de968ea697e7` | [upstream commit](https://github.com/advimman/lama/commit/786f5936b27fb3dacd2b1ad799e4de968ea697e7) |
| Carve export implementation/notebook, `Carve-Photos/lama` | `f5fb39a18022c34a71bf9a47a6ec393c804b49ca` | [fork commit](https://github.com/Carve-Photos/lama/commit/f5fb39a18022c34a71bf9a47a6ec393c804b49ca) |
| Carve ONNX model repository | `c3c0c9e468934d62e79c329e35d82dd09ff8c444` | [model metadata API](https://huggingface.co/api/models/Carve/LaMa-ONNX?blobs=true) |
| Big-LaMa archive mirror used by Carve's notebook | `05cb2be7f8dbe6ca7c6e78f4fc827a4b2baaa4a9` | [archive metadata API](https://huggingface.co/api/models/smartywu/big-lama?blobs=true) |

These source revisions pin the implementations inspected. The published model does not identify the exact Git revision used to create its bytes; do not claim these revisions establish that historical provenance. The [pinned export notebook](https://github.com/Carve-Photos/lama/blob/f5fb39a18022c34a71bf9a47a6ec393c804b49ca/export_LaMa_to_onnx.ipynb) downloads `smartywu/big-lama` and extracts `big-lama/config.yaml` and `big-lama/models/best.ckpt`. The [original README](https://github.com/advimman/lama/blob/786f5936b27fb3dacd2b1ad799e4de968ea697e7/README.md) currently directs users to a Google Drive folder because its Yandex links failed. The mirror's [own card](https://huggingface.co/smartywu/big-lama/blob/05cb2be7f8dbe6ca7c6e78f4fc827a4b2baaa4a9/README.md) identifies its archive as a copy of the original pretrained model; independent equivalence to the original hosted archive has not been established here.

### Download manifest

`lama_fp32.onnx`:

- [Pinned download](https://huggingface.co/Carve/LaMa-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx)
- Bytes: `208044816` (208.0 MB decimal; 198.4 MiB).
- SHA-256: `1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6`.
- Hash and length are published by the [file page](https://huggingface.co/Carve/LaMa-ONNX/blob/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx) and [metadata API](https://huggingface.co/api/models/Carve/LaMa-ONNX?blobs=true). Use the SHA-256, not the distinct Xet hash.

`big-lama.zip`:

- [Pinned download](https://huggingface.co/smartywu/big-lama/resolve/05cb2be7f8dbe6ca7c6e78f4fc827a4b2baaa4a9/big-lama.zip)
- Bytes: `381428720`.
- SHA-256: `f1b358ca24093b93a106183b98a3dea6e8ed09f3b43ea7251eb2c81e7b4575f6`.
- These describe the complete ZIP, as published in [metadata](https://huggingface.co/api/models/smartywu/big-lama?blobs=true). No separate SHA-256 for the extracted `best.ckpt` was published in the sources inspected. Compute and record that hash after verifying and extracting this archive.

## Tensor contract

The [export notebook](https://github.com/Carve-Photos/lama/blob/f5fb39a18022c34a71bf9a47a6ec393c804b49ca/export_LaMa_to_onnx.ipynb) establishes:

| Tensor | Type / shape | Meaning |
| --- | --- | --- |
| `image` | float32 `[1,3,512,512]` | RGB, channel first, each original 8-bit value divided by 255 |
| `mask` | float32 `[1,1,512,512]` | Binary: 1 removes/fills; 0 preserves |
| `output` | float32 `[1,3,512,512]` | Composited RGB, clipped to **0–255**, not 0–1 |

The wrapper masks the input, concatenates the mask, runs the generator, composites using that same mask, multiplies by 255, and clamps. Pass the original RGB crop; masking is inside the graph. Its preprocessing makes any positive mask value 1. The export declares a dynamic batch axis; use batch 1 for this comparison and inspect runtime metadata before supporting others. Spatial size is fixed. Export is opset 17. The [model card](https://huggingface.co/Carve/LaMa-ONNX/blob/c3c0c9e468934d62e79c329e35d82dd09ff8c444/README.md) recommends `lama_fp32.onnx`; `lama.onnx` is a different, slower opset-18 export.

## Original PyTorch reference

Use the original repository, preserving its native Fourier implementation. Carve's altered Fourier unit is precisely what the comparison needs to evaluate. [Original FFC source](https://github.com/advimman/lama/blob/786f5936b27fb3dacd2b1ad799e4de968ea697e7/saicinpainting/training/modules/ffc.py), [Carve FFC source](https://github.com/Carve-Photos/lama/blob/f5fb39a18022c34a71bf9a47a6ec393c804b49ca/saicinpainting/training/modules/ffc.py).

Adapt the original [checkpoint loader](https://github.com/advimman/lama/blob/786f5936b27fb3dacd2b1ad799e4de968ea697e7/saicinpainting/training/trainers/__init__.py) and [prediction command](https://github.com/advimman/lama/blob/786f5936b27fb3dacd2b1ad799e4de968ea697e7/bin/predict.py) to keep float outputs for measurement:

```python
config = OmegaConf.load(model_dir / "config.yaml")
config.training_model.predict_only = True
config.visualizer.kind = "noop"
model = load_checkpoint(config, model_dir / "models/best.ckpt",
                        strict=False, map_location="cpu")
model.freeze()
model.eval()
# image: float32 RGB NCHW /255; mask: float32 binary N1HW
with torch.no_grad():
    result = model({"image": image, "mask": mask})["inpainted"]
    reference_255 = (result * 255).clamp(0, 255)
```

This is a recipe, not a complete installation script. The original [README](https://github.com/advimman/lama/blob/786f5936b27fb3dacd2b1ad799e4de968ea697e7/README.md) specifies PyTorch 1.8.0 / torchvision 0.9.0; its [requirements](https://github.com/advimman/lama/blob/786f5936b27fb3dacd2b1ad799e4de968ea697e7/requirements.txt) pin Lightning 1.2.9, Hydra 1.1.0 and Kornia 0.5.0. A runnable modern/macOS environment needs its own recorded dependency versions and compatibility changes.

The original [image loader](https://github.com/advimman/lama/blob/786f5936b27fb3dacd2b1ad799e4de968ea697e7/saicinpainting/evaluation/data.py) uses PIL RGB/L conversion and float32 division by 255. Its [prediction defaults](https://github.com/advimman/lama/blob/786f5936b27fb3dacd2b1ad799e4de968ea697e7/configs/prediction/default.yaml) use modulo-8 padding and disable refinement; exactly 512 × 512 needs no padding. The prediction command thresholds masks at `>0` and finally truncates outputs to uint8. For fidelity, compare float outputs before that final truncation; save both displayed outputs using the same conversion. Compute normalized differences as `abs(onnx_output-reference_255)/255`, with the same decoded crop and binary mask shared by both paths.

Carve's [announcement and follow-up](https://github.com/advimman/lama/issues/315) describe outputs as close and later explain a reported difference caused by forgetting the ONNX output's factor of 255. The card's stronger equality claim is not a substitute for the requested measurements.

## Attribution and training-data terms

Both the original and Carve fork carry Apache-2.0 and the exact notice `Copyright [2021] Samsung Research`. Preserve that text if copying relevant source, retain applicable notices, include Apache-2.0, and identify modifications. [Original license](https://github.com/advimman/lama/blob/786f5936b27fb3dacd2b1ad799e4de968ea697e7/LICENSE), [Carve license](https://github.com/Carve-Photos/lama/blob/f5fb39a18022c34a71bf9a47a6ec393c804b49ca/LICENSE).

The [Carve model card](https://huggingface.co/Carve/LaMa-ONNX/blob/c3c0c9e468934d62e79c329e35d82dd09ff8c444/README.md) and [checkpoint mirror card](https://huggingface.co/smartywu/big-lama/blob/05cb2be7f8dbe6ca7c6e78f4fc827a4b2baaa4a9/README.md) declare Apache-2.0. Credit the LaMa authors/paper and Carve's export (notebook author Nikita Selin, Carve.Photos Team). The original README identifies Big-LaMa as trained on Places2 Challenge. [Paper/authors and training source](https://github.com/advimman/lama/blob/786f5936b27fb3dacd2b1ad799e4de968ea697e7/README.md), [export notebook authorship](https://github.com/Carve-Photos/lama/blob/f5fb39a18022c34a71bf9a47a6ec393c804b49ca/export_LaMa_to_onnx.ipynb).

The live [official Places2 download page](http://places2.csail.mit.edu/download.html) now directs legacy Places365/Places205 access through an [official request form](https://docs.google.com/forms/d/e/1FAIpQLSetdVOXpHpU9mZ_BZhCKjke9nx9A3cklPVg4MbjkIcCzj3qbA/viewform). The form says image ownership stays with the image owners, restricts images to research, and limits the legacy release to reproducing/comparing algorithms. The [official homepage](http://places2.csail.mit.edu/index.html) describes academic research/education use. HTTP works; HTTPS on that host refused connections during this check. The older, commonly quoted non-commercial/no-image-redistribution wording is no longer present on the current download page, so this note does not present it as freshly verified.

Distinguish dataset access terms from the Apache declarations on code and weights. These primary sources do **not** expressly resolve whether the dataset restrictions attach to a trained LaMa checkpoint or its ONNX conversion. That remains an unresolved provenance/licensing question for distribution or commercial-use claims; neither unconditional clearance nor a categorical commercial-use ban on the model follows from the inspected text. Do not distribute Places training images with the comparison. The official Places365 repository separately [licenses its own pretrained scene-classification CNNs CC BY](https://github.com/CSAILVision/places365#acknowledgements-and-license); that grant does not identify LaMa weights.
