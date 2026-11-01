# LUT collection source verification

Checked 2026-10-31 against first-party pages. This note records asset provenance and distribution terms; the implementation must retain the license supplied with the exact files it bundles.

## G’MIC / Pat David implementation

Bundled 269 Cube files unchanged from [YahiaAngelo/Film-Luts](https://github.com/YahiaAngelo/Film-Luts/tree/af957b631a304e6be94778b96cb3395de3438e9f), pinned at `af957b631a304e6be94778b96cb3395de3438e9f`. Pat David’s [original category inventory](https://patdavid.net/2013/09/film-emulation-presets-in-gmic-gimp/) identifies the negative older/newer, instant consumer/professional, colour slide/negative and B&W families. These are the same film collection rather than two independent packs; the picker calls it **G’MIC / Pat David**. Cube files retain G’MIC’s existing 13-point sampling and values. The sRGB input follows the original collection README.

The repository’s MIT notice does not establish ownership of all upstream LUTs: its README disclaims that ownership. The original RawTherapee collection’s CC BY-SA 4.0 notice and credits (Pat David, Pavlov Dmitry, Michael Ezra) are therefore preserved alongside the repository README/MIT notice and full CC text; Cube adaptations remain CC BY-SA 4.0. Print (12) and Fuji X-Trans III (15) families are excluded pending separate provenance/input-encoding checks.

The second new picker pack is **PictureFX (legacy)**, the bounded 19-look collection below. All file hashes and metadata live in `src/film/lut-catalogue.json`; `tools/luts/import-packs.py` reproduces the copy/catalogue step from the reviewed local source checkouts. No colour processing algorithms were added: these use the existing darktable lut3d port, on display sRGB. PictureFX display sRGB is an explicitly recorded workflow assumption.

The picker now scopes presets to each pack, groups by category, and offers search plus pages of 12 photo previews. Common film IDs are retained when changing packs where a matching LUT exists; otherwise a supplied look is selected. New profiles use stable `lut:<pack>:<file stem>` stock IDs in existing recipes; unknown IDs still fall back. t3mujinpack stays the new-edit default. Current FreshLUTs CineStill and itch.io SX-70 are pending for the reasons below. Spectrail is omitted at Oli’s request.

## PictureFX versions have different terms

The [author's current PictureFX page](https://marcrphoto.wordpress.com/picturefx-pro-2024/) defaults to **CC BY-NC 4.0**, with exceptions where stated. It identifies FreshLUTs and the author's itch.io pages as official distribution channels, describes the older 2015/2016 PictureFX releases, and separately labels Kodak Aerochrome v1 **CC BY-SA 4.0**. Do not apply a repository's MIT license or a legacy pack's license to newer PictureFX assets automatically.

The same page describes ordinary PictureFX `.cube` files as 25-point grids. It recommends correcting exposure and white balance before the creative look. It does not establish one precise input encoding for every release; compatibility with RAW or LOG software is not a camera-log decoding specification. Match the exact asset's documented encoding before assigning its input colour space in Emulsion.

## FreshLUTs CineStill 800T

The [specific PictureFX CineStill 800T v1 listing](https://freshluts.com/luts/920) explicitly displays **CC0**, commercial use permitted, attribution unnecessary. Its author is MarcR. The [MarcR profile](https://freshluts.com/users/86490) identifies him as PictureFX's creator and links back to the author website. The [site's terms](https://freshluts.com/termsandconditions) also state that uploaded LUTs are CC0. These are stronger provenance evidence than an unrelated mirror's claim that all film LUTs are open source.

However, the listing's download button leads to [sign-up](https://freshluts.com/users/sign_up), and its public HTML exposes image previews, not a LUT download. No account was created and no gated download was bypassed. **The FreshLUTs-distributed file has not been obtained.** Do not substitute a similarly named itch.io file and claim it is the verified CC0 copy.

The listing's gamma field is “Other”, so it does not specify sRGB, Rec.709 or a camera log curve. Keep that uncertainty separate from the CC0 redistribution permission.

## Current itch.io files

- [CineStill 800T v1](https://picturefx.itch.io/picturefx-cinestill-800t-v10) lists 25- and 64-point `.cube` files and 125- and 512-pixel PNG Hald CLUTs in `CineStill-800-T-V1.0.zip`. The product page does not give an explicit permissive redistribution license overriding the author's default. The FreshLUTs CC0 statement applies to the FreshLUTs-distributed copy.
- [Polaroid SX-70 – The Core LUT](https://picturefx.itch.io/picturefx-polaroid-sx-70-the-core-lut) supplies a 16-bit 512-pixel PNG Hald CLUT, a converted `.cube`, and full/stripped RawTherapee PP3 profiles. Its [author article](https://marcrphoto.wordpress.com/2025/09/03/picturefx-polaroid-sx-70-the-core-lut/) describes neutral RAW/JPEG/TIFF/video input and permission to use and tweak. That is insufficiently explicit to treat app redistribution as a permissive license override. No specific FreshLUTs SX-70 listing was confirmed.

For the current CineStill/SX-70 itch assets, preserve a source link for future user import or obtain explicit redistribution permission; do not bundle them under an invented MIT/CC0 notice.

## Legacy PictureFX: bounded reusable subset

The official [G'MIC PictureFX catalogue](https://gmic.eu/color_presets/picturefx_sample_1.html) credits Marc Roovers and offers [a directly downloadable Cube pack](https://gmic.eu/color_presets/picturefx/picturefx_cube.zip) and [PNG Hald CLUT pack](https://gmic.eu/color_presets/picturefx/picturefx_haldclut.zip). These were downloaded without an account. The Cube archive contains 25 files, each a 13-point grid, but no license file.

An author-attributed [legacy PictureFX README](https://github.com/cedeber/hald-clut/blob/41cb940e6a85a5f4c18ff42f177db0f6be027a8b/HaldCLUT/PictureFX/README.txt) explicitly licenses PictureFX CLUTs **CC BY-SA 4.0**, credits Marc Roovers at `digicrea.be`, and thanks G'MIC and Jonas Wagner as distributors. It accompanies 19 PNGs in the same directory. The [collection index](https://github.com/cedeber/hald-clut/blob/41cb940e6a85a5f4c18ff42f177db0f6be027a8b/README.md) calls this PictureFX v2 and links the old author URL. These files entered that mirror in commit `41cb940e6a85a5f4c18ff42f177db0f6be027a8b`, dated 2019-02-27. The original `digicrea.be` page is currently unavailable; distinguish the preserved author-written license from a new statement by the mirror owner. The current author page independently confirms that PictureFX v2 was supplied to G'MIC in 2016.

The bounded recommendation is to distribute only the **19 corresponding legacy looks** with the author's README and CC BY-SA notice: seven AnalogFX, eight GoldFX, one TechnicalFX and three ZilverFX. Six additional Faux Infrared looks in today's G'MIC archive are outside this legacy README's accompanying file set and are not included in that recommendation. These are creative legacy effects, not the newer CineStill 800T or Polaroid SX-70 simulations.

Preserve attribution to Marc Roovers/PictureFX, link the source and [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), and identify G'MIC's conversion/resampling when distributing its Cube versions. The CC license permits commercial redistribution and adaptation subject to attribution and ShareAlike; later release terms do not revoke a correctly obtained earlier grant. Keep these assets under their own license rather than the app's software license.

Local review copies are in `/private/tmp/emulsion-lut-sources/`: `picturefx-legacy-19/` contains the 19 G'MIC Cubes plus the preserved `README.PictureFX.txt`; `picturefx-legacy-19-manifest.json` records every Cube's SHA-256 and source URLs. Input RGB primaries/transfer are not explicitly specified by this legacy README. The intended conventional image workflow suggests display RGB, but an sRGB declaration would be an implementation assumption, not an explicit license/source fact.

| Download | SHA-256 |
| --- | --- |
| G'MIC `picturefx_cube.zip` | `4dd2ed51376622c0a605d9e9fb865afb06cff64e56d871f49c6d2e0cf820cec2` |
| G'MIC `picturefx_haldclut.zip` | `2dd8f3ddfdf3d0039373a7b256799628de59f207330ee29f041347c4a52409eb` |

## RawTherapee's original collection

The official [RawTherapee HaldCLUT archive](https://rawtherapee.com/shared/HaldCLUT.zip), downloaded as `/private/tmp/emulsion-HaldCLUT.zip`, contains a `HaldCLUT/README.txt` identifying version **2015-09-20**, **CC BY-SA 4.0**, and credits Pat David, Pavlov Dmitry and Michael Ezra. It specifies sRGB, 8-bit/channel PNG unless a filename says otherwise. It contains no PictureFX files. It can establish provenance for that original film collection, not for PictureFX assets downloaded elsewhere.

## Spectrail

Excluded at Oli's request. Do not add a similarly named spectral film project as a substitute.

## Fujifilm official LUTs: feasibility, separate follow-up

Oli asked whether Fujifilm’s official log LUTs could be repurposed for Emulsion. **Technically yes, with a dedicated input/output transform; not through the existing sRGB display-LUT path.** No Fujifilm assets or runtime transforms have been added to the app; a separate local baking experiment is recorded below.

Inspected the official [GFX ETERNA 55 v1.10 download](https://www.fujifilm-x.com/global/support/download/lut/) (`gfx-eterna-55-3d-lut-v110.zip`, 2026-04-16). Its 33- and 65-point F-Log2/F-Log2C folders include ten simulations: Eterna, Provia, Velvia, Astia, Classic Chrome, Reala Ace, Pro Neg Std, Classic Neg, Eterna Bleach Bypass and Acros, plus WDR-709/log-709 utility transforms. No Nostalgic Neg or Pro Neg Hi is in this checked archive. F-Log contains a smaller set. The Cube headers and included overview PDFs explicitly identify the expected log encoding and BT.709 output primaries.

Fujifilm publishes [F-Log2 data sheet v1.1](https://dl.fujifilm-x.com/technical-data/F-Log2_DataSheet_E_Ver.1.1.pdf): scene-reflection-to-log formula and F-Gamut chromaticities (same primaries/white as Rec.2020). A future RAW path could encode scene-linear working RGB into F-Log2, apply the official table, interpret the documented output correctly, and rejoin the print pipeline without applying the normal sigmoid a second time. F-Log2C has different gamut metadata and needs its own transform. Do not assume log ranges, exposure calibration or output transfer functions are interchangeable. Amount blending needs a common output domain. Render comparisons against a documented reference are required before shipping. Camera spectral colour and upstream exposure processing still affect agreement with Fuji’s in-camera JPEGs; already-rendered JPEGs cannot recover RAW highlight information.

The download and its included overview PDFs contain no affirmative app-redistribution grant. The linked [Fujifilm terms](https://global.fujifilm.com/en/terms) restrict copying/modifying content except where expressly allowed; the download page expressly allows loading LUTs into editing software but does not establish permission to bundle or redistribute them. Investigate **user-supplied import** under the applicable file terms, or obtain permission before bundling. Do not label these official LUTs MIT/open source or manufacture a converted redistribution pack from them.

## Validation of the bundled additions

237 TypeScript tests and 36 Rust tests pass (four optional Rust checks ignored); typecheck and production/probe builds pass. All 288 Cube files pass the real parser, finite-value/interpolation and SHA-256 checks. Tests cover supported pack choices, stable common film IDs, unknown-ID rejection, sidecar round-trips, reset and copy/paste.

Headless browser checks cover both new pack option counts, preserving Portra across packs, changing to an available PictureFX look, lazy preview mounting, pagination, name search, keeping the pack when choosing a preview, Classic pack-aware paging/category filtering, and empty search results. Photo previews and the main photo were visually checked on the existing local RAW probe sample. Focused GPU check against the tetrahedral reference: worst relative error 0.000378 for G’MIC and 0.000369 for PictureFX (half-float Cube textures); existing Hald and LUT target checks continue to pass.

## Fuji LUT conversion completed locally (follow-up)

Oli clarified: “can you repurpose them into LUTs for us?” Implemented `tools/luts/bake-fuji.mjs`, a local CLI, and generated all ten 65-point sRGB test LUTs from the official GFX ETERNA 55 v1.10 **F-Log2 65Grid** originals. The script itself is GPL; neither original nor derived Fuji LUTs are relicensed by it. Converted assets remain outside the repository and bundled app.

Reproduction (Node 24+, source folder extracted locally from the official ZIP):

```sh
node tools/luts/bake-fuji.mjs /private/tmp/emulsion-fuji-original /private/tmp/emulsion-fuji-local/emulsion
```

**Initial revision, superseded below:** the transform undoes the exact neutral print encoding used before Emulsion’s current sRGB LUT stage (sRGB to Rec.2020, inverse neutral sigmoid), encodes F-Log2 using the official published formula, applies the official LUT with the existing darktable tetrahedral reference, initially interpreted output as BT.709 primaries/gamma 2.2 (incorrectly inferring the signal transfer from recommended monitor settings, white paper v1.01 p13), and writes sRGB output. Values/curves from the official table are retained, without eye-tuned grading. This bakes the adaptation into ordinary Cube files, avoiding any runtime engine change.

Validation: F-Log2 independently checked against the datasheet’s black/18%/90% code anchors; existing neutral inverse checked over scene values 0–8. All ten generated files pass the real Cube parser and finite-value checks. Each baked LUT is compared to the direct composite transform on 12,000 off-grid RGB samples: RMS 0.095–0.337 8-bit channel levels; worst sampled error 3.31–14.54 levels (strong gamut/clipping boundaries). These are test approximations: the existing display LUT stage’s gamut clipping is irreversible, so this cannot promise equivalence to a direct scene-linear path or Fuji’s in-camera spectral/exposure processing.

All ten rendered through the actual WebGL Engine on the local decoded RAW sample; all GL error values were zero, every look changed the photo, and Acros was verified exactly monochrome. Preview board visually inspected. Vite’s timestamped module URLs must be respected when modifying the test-only pack registry in the browser; otherwise a duplicate registry can silently yield the neutral fallback. The validation asserts that each LUT actually loads and Acros removes colour.

Persistent local artifacts: `/Users/oli/Dev/emulsion-local-luts/fujifilm-2026-10-31/` contains ten `.cube` files, source/output SHA-256 manifest, README, `preview.png`, and `Emulsion-Fuji-test-LUTs.zip`. Generated files are **not** in the app dropdown, public assets, git, or deployment. The browser harness is local `/private/tmp/fuji-preview.mjs`; its temporary server/browser were stopped. No commit/push authorised.

## Local dropdown integration

At Oli’s request the generated LUTs are now selectable in the local development app: **Develop → Presets → Looks → Fujifilm (local test)**. The Preset dropdown contains the ten named simulations; Amount, grading, copy/paste and photo previews use existing behaviour.

`local-looks/fuji-test/` contains ignored private Cube files and their catalogue. `src/film/local-looks.ts` discovers that optional JSON catalogue through Vite only in development. The stock registry and pack registry use its stable `lut:fuji-test:*` IDs; `lookFile` returns same-origin `/local-looks/fuji-test/…` URLs, accepted by the loader. A clone without the private catalogue has no test pack. The private assets are outside public/, so the release build copies none of them; the production DEV guard removes catalogue/pack metadata too. Verified no test pack strings or converted Cube files in dist.

`npm run check` passes: 238 TS tests and 36 Rust checks (four optional ignored), typecheck/build. Browser validated all ten real 65-point files via the loader, dropdown selection, Amount, ten photo previews and copied settings. Screenshot visually checked with Acros on the actual main photo. No processing maths or shaders changed. No commit/push authorised.

## Revision 2: shadow-loss diagnosis and correction

Oli found the first-version Fuji looks universally dark/shadowy. `node /private/tmp/check-fuji-brightness.mjs` isolated the actual installed Provia Cube, with no scanner or user grading, and failed on a 0.20 encoded grey becoming 0.0881. A smaller input 0.10 became 0.0103. This was reproduced in `src/film/looks.test.ts` before changing the files.

Tested signal transfer, legal/full-range input and scanner hypotheses separately. Full-range F-Log2 encoding already matched Fuji’s published 95/400/570 code anchors; legal-range remapping worsened the shadows. Scanner-free checks proved that Frontier’s extra contrast was not the root cause. The key assumption was applying a pure gamma-2.2 display decode to LUT output: Fuji’s paper recommends monitor settings, not a signal-transfer specification. Their Cube headers/overview identify output primaries as BT.709 but do not document a distinct mathematical transfer curve for each proprietary simulation.

For the photo adaptation we now use **darktable’s standard Gamma Rec709 RGB input profile**, with its piecewise inverse BT.709 OETF. Source: [darktable colorspaces.c](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/common/colorspaces.c#L456), Copyright (C) 2010-2026 darktable developers, GPL-3.0-or-later. This agrees with [ITU-R BT.709-6](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.709-6-201506-I%21%21PDF-E.pdf) and is explicitly a photo-space interpretation, not a claim of exact Fuji cinema reference-monitor appearance. Evaluating darktable’s exact profile using native LittleCMS independently matched the scalar implementation (fixtures in `fuji-transform.test.ts`). No exposure compensation or custom shadow curve was added.

`tools/luts/fuji-transform.ts` contains the credited, tested build-time adapter; `bake-fuji.mjs` regenerates revision 2 assets. Rebuilt all ten and installed via the ignored local catalogue, preserving stock IDs but changing filenames to `_r2_<hash>` so the running loader cannot reuse revision 1 tables. Provia’s 0.20 now becomes 0.1750 and 0.10 becomes 0.0906. The original failure test and the real GPU shadow test pass: 8-bit inputs 26/51/128 give 23/44/141, within one level of the reference. All ten load, previews, selection, Amount and copy settings pass; all ten standalone Engine photo renders have zero GL errors and Straight-scanner Acros stays exactly monochrome. Corrected preview visually inspected on the local decoded bridge RAW.

`npm run check`: 243 TypeScript tests, 36 Rust checks (4 optional ignored), typecheck/build pass. Revised Cubes’ direct-chain off-grid RMS error is 0.087–0.417 8-bit levels (12,000 samples/profile); sampled worst <16.08 at sharp gamut/clipping boundaries. Old algorithm self-comparison tests had validated baking fidelity but did not catch this colour-space assumption; new independent profile/neutral-reference tests and the actual shadow regression address that gap.

Persistent corrected artifacts: `/Users/oli/Dev/emulsion-local-luts/fujifilm-2026-10-31-r2/` contains Cubes, manifest, README, preview PNG and ZIP. Original first-version artifacts remain available separately. Browser diagnostic harnesses are private `/private/tmp/fuji-preview-v2.mjs` and `/private/tmp/fuji-dropdown-v2-check.mjs`; temporary browsers/servers stopped. No debug logging in app code. No commit/push authorised.
