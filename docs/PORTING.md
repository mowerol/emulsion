# Porting code from other projects

Minilab is GPL-3.0-or-later so it can take code from the best open-source photo tools. This page covers what is compatible, how to credit it, and how to check a port.

This is a working guide, not legal advice.

## What is compatible

| Project | Licence | Can we copy code? |
| --- | --- | --- |
| darktable | GPL-3.0-or-later | Yes |
| RawTherapee | GPL-3.0 | Yes |
| ART | GPL-3.0 | Yes |
| LibRaw | LGPL-2.1 or CDDL-1.0 | Yes, as a library (use the LGPL option) |
| G'MIC | CeCILL-2.1 (GPL-compatible) | Yes |
| Film LUT and CLUT packs | Varies, often Creative Commons | Check each pack. Only ship packs whose licence allows redistribution |
| MIT, BSD, Apache-2.0 code | Permissive | Yes, keeping their notices |

Ideas, maths and algorithms described in papers or documentation can always be reimplemented. Copying code, including translating it line by line into GLSL or TypeScript, makes a derivative work, which is fine here as long as the rules below are followed.

## Rules for every port

1. **Keep the upstream copyright lines.** Put them at the top of the ported file, above Minilab's SPDX line, exactly as they appear upstream.
2. **Say where it came from.** Under the copyright lines, add: `Ported from <project> <path> at commit <hash>. <What changed>.`
3. **Add a NOTICE entry** in [NOTICE.md](../NOTICE.md) using the template there.
4. **Record the upstream commit**, so the port can be compared and updated later.
5. **One upstream module per stage file** where possible, so attribution stays obvious.

Example header for a GLSL stage:

```glsl
// Copyright (C) 20XX-20XX <upstream authors, verbatim>
// Ported from darktable src/iop/<module>.c at commit <hash>.
// Translated from C to GLSL; parameters mapped to Minilab's recipe.
// SPDX-License-Identifier: GPL-3.0-or-later
```

## How to port a module

1. Read the upstream module and its documentation. Note its working space and units. darktable works in scene-linear Rec.2020, as Minilab does, so most of its modules map across directly.
2. Write the per-pixel maths in TypeScript first (like `src/engine/tone.ts`), with tests that check values produced by the upstream tool. `darktable-cli` can render reference images with a given style.
3. Translate it to a GLSL stage and wire it in (see "Adding or replacing a stage" in [ARCHITECTURE.md](ARCHITECTURE.md)).
4. Compare the GPU output with the reference using the engine probe.
5. Keep Minilab's sliders simple. Map them onto the upstream parameters rather than exposing every upstream control.

## Candidates

Paths are as of darktable 5.x; check the current tree before porting.

| Minilab stage | Upstream module | Why |
| --- | --- | --- |
| Tone | darktable `src/iop/sigmoid.c` | Smooth highlight roll-off past the white point, hue-preserving options; replaces the placeholder curve |
| Grain | darktable `src/iop/grain.c` | Grain modelled on film, with a luminance response |
| Exposure and colour | darktable `src/iop/colorbalancergb.c` | Perceptual saturation and colour grading |
| Input (film scans) | darktable `src/iop/negadoctor.c` | Invert real colour negative scans |
| Input (RAW) | LibRaw | Decoding, including Fuji X-Trans and OM System files |
