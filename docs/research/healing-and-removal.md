# Healing, cloning and removal (with AI removal)

Researched 2026-11-02. What the community tools offer, which to port, and how AI removal could fit in. The redesign left the Heal tool out "until a healing module is ported (darktable retouch)". This note covers that module and what comes after it.

## What Lightroom offers (the reference for the user experience)

Lightroom's Remove panel has three modes: **Remove**, **Heal** and **Clone**. Remove uses Content-Aware fill by default. A "Generative AI" checkbox switches it to Firefly, which runs in the cloud. Adobe recommends Heal and Clone for small marks such as sensor dust and blemishes, Remove for small whole objects, and Generative Remove for large ones. ([Adobe: Generative Remove FAQ](https://helpx.adobe.com/lightroom/desktop/using/generative-remove-faq.html))

## Classical tools: darktable's retouch module (recommended)

**Pick: darktable `src/iop/retouch.c`, with `src/common/heal.c`.** It is the most complete open-source retouching module. It also uses the drawn shapes we already ported for masks. RawTherapee has only a spot removal tool, added after long forum requests ([pixls.us thread](https://discuss.pixls.us/t/rt-no-spot-removal-tool/795)). It does less: no wavelet scales and no fill or blur modes. ART adds nothing here.

What retouch does ([manual 5.6: retouch](https://docs.darktable.org/usermanual/5.6/en/module-reference/processing-modules/retouch/)):
- **Tools:** Clone copies a source area over the target. Heal does the same, then blends the colour and luma to fit the surroundings. Fill paints a colour, with a brightness control. Blur applies a Gaussian or bilateral blur with a radius.
- **Shapes:** circle, ellipse, path and brush. The source and the target are the same shape. Circles and ellipses are placed with one click and drag. Each shape has its own opacity.
- **Source placement:** a + shows the default source while you hover. Shift+click sets the source relative to the cursor; Ctrl+Shift+click sets it at a fixed point in the image.
- **Wavelet scales:** an edit can apply to one detail layer only. For example, heal a blotch on a coarse scale and keep the fine skin texture. "Merge from" applies one edit to several scales at once. This is retouch's advantage over every other free tool.
- **Pipeline:** linear, scene-referred RGB, before exposure. It comes after the geometry modules (lens correction, perspective), so shapes stay on the photo when the crop or rotation changes. Check the exact position in darktable's v3.0 order when porting.

**Heal algorithm** (`heal.c`, Copyright 2017-2024 darktable developers, GPL-3.0-or-later): it is based on GIMP's healing tool (Jean-Yves Couleaud), which follows T. Georgiev, *Photoshop Healing Brush: a Tool for Seamless Cloning*. It subtracts the source from the target, solves the Laplace equation ΔI = 0 on that difference with the shape's edge as the boundary condition, and adds the result back. The solver is red/black Gauss-Seidel with successive over-relaxation. It stops early once the residual drops below 0.1/255. darktable's OpenCL path calls the CPU code, because an OpenCL reduction was too slow.

### How it fits Emulsion

- **Model:** a `retouch` list in the recipe. Each entry has a tool, a shape (reusing the mask shape types and darktable's brush), a source offset, opacity, a wavelet scale range, and a fill colour or blur radius. Shapes are stored in source coordinates, like masks, so they follow crop, turns and flips (`geometryMatrix`).
- **Engine:** a pre-pass that writes a retouched copy of the source, the way haze removal already writes the module's input (`dehaze.frag.glsl`). The develop pass, the tone equalizer map, halation extraction and dehaze all read that copy. This needs no new texture unit in the develop pass.
- **Heal on the GPU:** red/black SOR maps to one fragment pass per colour per iteration. Unlike OpenCL, a WebGL2 pass can't reduce the residual cheaply. Either run a fixed iteration count, or read back a small reduced texture every N iterations to check for convergence. Running a fixed count would be a deviation from upstream, so ask first. Cache each healed shape's result per source, so slider drags don't rerun it.
- **Wavelets:** darktable's retouch uses its own à-trous decomposition (`dwt.c`). We already ported the contrast equalizer's à-trous decomposition for Texture, so check how much of it can be reused.
- **Reference and tests:** `src/engine/retouch.ts` and `heal.ts`, with a twin in `stages/retouch.glsl` and a probe case. This is the usual pipeline rule.
- **UI:** the Heal tool in the canvas tool pill, with Heal, Clone, Fill and Blur modes. Shapes are drawn with the existing mask overlay editor, and the source is shown and dragged as a linked shape. The brush keys ([ ]) work the same.

Order: Clone and Heal with circle and brush first (sensor dust and blemishes). Then ellipse and path, Fill and Blur, and wavelet scales last.

## AI removal

No community editor offers local AI removal that we could port. darktable's model repository (`darktable-org/darktable-ai`) has denoise, upscale and SAM mask models, but no inpainting model ([models directory](https://github.com/darktable-org/darktable-ai/tree/master/models)). RapidRAW added local LaMa inpainting in 2026, but it is AGPL-3.0 and its implementation is young, so we should use it as a reference only ([Neowin: RapidRAW 1.5.3](https://www.neowin.net/software/rapidraw-153/)). So the model choice follows the paper rule: implement from the model's own paper and code, and credit both in `NOTICE.md`.

| Model | Licence | Size | Fit |
|---|---|---|---|
| **LaMa (big-lama)**: Suvorov et al., *Resolution-robust Large Mask Inpainting with Fourier Convolutions*, WACV 2022 | Code and weights Apache-2.0. Trained on Places2 / Places Challenge (the Places2 terms should be checked) | ONNX `lama_fp32.onnx`, about 208 MB, fixed 512×512 input ([Carve/LaMa-ONNX](https://huggingface.co/Carve/LaMa-ONNX)) | **Recommended.** It is the community default for local object removal (Lama Cleaner/IOPaint, ComfyUI nodes, RapidRAW). Good on large masks and repeating texture, and it holds up at up to about 2K, though trained at 256 ([advimman/lama](https://github.com/advimman/lama)). |
| **MI-GAN**: Picsart AI Research, ICCV 2023 | MIT | About 7× smaller than LaMa | A lighter, faster alternative. Quality is lower on large regions. Picsart says the paper's speed figures don't apply to its ONNX export ([Picsart-AI-Research/MI-GAN](https://github.com/Picsart-AI-Research/MI-GAN)). |
| Diffusion inpainting (SD-based) | Varies, often restrictive | Gigabytes | Out of scope: slow on an M2 and prone to inventing objects. Adobe's Firefly forum threads complain about exactly that. |

Carve's ONNX export rewrites LaMa's Fourier convolutions so they can be exported. Its model card has claimed both "identical" and "close" results in different revisions. Verify it against the PyTorch model on a few crops before relying on it, as the denoise work did for RawNIND.

### How it fits Emulsion

The native groundwork exists already from the denoise experiment: `ort` rc.11 with ONNX Runtime 1.23.2, CoreML or CPU chosen explicitly, pinned model downloads with hashes, and models stored in app data (`tools/denoise/`, `docs/research/ai-noise-reduction.md`).

- **Selecting what to remove:** a brush stroke over the object (Lightroom's model), or a click using the SAM 2.1 object masks already planned in `docs/plans/masks.md`. The selection is dilated by a few pixels, as removal tools do.
- **Inference:** crop the area around the mask with surrounding context, scale it to 512, run LaMa, scale the fill back up, and composite it only inside the feathered mask. For large regions at full resolution the fill will be soft. A detail or grain restoration step could fix that, but upstream has nothing like it to port, so ask Oli before inventing one.
- **Colour:** LaMa expects 8-bit sRGB. Run it at the retouch position (scene-linear, before exposure), through a fixed encode and decode. Then exposure and tone sliders don't rerun it, and the fill follows the rest of the edit.
- **Storage:** the result isn't cheap to recompute (about a second, plus a 200 MB model), so cache the filled patch as a 16-bit file keyed by the source, the mask and the model hash. The sidecar stores the stroke, the model id and the patch's hash, and recomputes the patch if it's missing. That keeps sidecars small and render-stable. It does mean the patch cache needs backing up (see [backups.md](backups.md)), or recomputing on another Mac.
- **UI:** the Remove mode in the Heal tool, with an "AI" option as Lightroom has. The model downloads on first use with a visible size. It is opt-in and runs offline, like darktable's AI features.

## Proposal (roadmap)

1. **Retouch, port of darktable:** Clone and Heal with circle and brush shapes, as a pre-pass before exposure. Then ellipse and path, Fill and Blur, and finally the wavelet scales.
2. **AI Remove (LaMa, ONNX):** brush or SAM selection, crop-and-fill at 512, a cached patch, opt-in model download. Check the ONNX export against PyTorch first, and measure speed and memory on the M2 as the denoise work did.
3. **MI-GAN as a fast option**, if LaMa is too slow on large regions.

Questions for Oli:
- Should Heal on the GPU use a fixed iteration count? That is a deviation from upstream, which stops when the residual is small enough.
- Where should the AI fill patches be kept: app data or beside the photo?
- Is a detail or grain restoration step for soft fills wanted, given there's no upstream to port?
- Is darktable's retouch the right base, or does he want Lightroom's single Remove brush first?
