# spektrafilm, November 2026: what changed, what else exists, and what to do

Research for Oli, 24 November 2026. Not legal advice. It builds on two earlier notes and does not repeat them:

- [spektrafilm.md](spektrafilm.md) (October): spektrafilm's inputs and outputs, overlaps with our stages, LUT mode, licences, stock coverage.
- [film-stock-options.md](film-stock-options.md) (30 October): CLUT packs, spectral_film_lut, Filmulator, ART, fitting, and darktable's native module (section 8).

**Short answer.** Nothing better than spektrafilm has appeared, and darktable's port of it is now the clear source to follow: it is the headline feature in darktable 5.8's draft release notes. But the way Emulsion's spektrafilm test pack is applied today (an sRGB `.cube` on the finished print) is not faithful. A spektrafilm stock has to replace the neutral sigmoid, as it does in darktable. So: add one **Film** stage in the tone stage's place, fed scene-linear light through a log shaper. Start with offline-baked 3D LUTs made by darktable's own code. Later, if live film controls are wanted, port darktable's table-based GPU path and bake the same 3D texture live. Don't run the spectral maths per pixel in the develop pass.

Sources, read at these commits (unmarked links point at them):

- spektrafilm `main` [`3bb2c2d`](https://github.com/andreavolpato/spektrafilm/tree/3bb2c2d2801ff68b92019cf1dbcbb133d60832bc) and `dev` [`6cd00c8`](https://github.com/andreavolpato/spektrafilm/tree/6cd00c8d4f30b5b550f50f4bbd3753c9f2a48507) (both unchanged since October); `experimental` [`28bf883`](https://github.com/andreavolpato/spektrafilm/tree/28bf883e1672e884307edc75852549376e13644e) (8 July 2026, new to these notes).
- darktable `master` [`64051a6`](https://github.com/darktable-org/darktable/tree/64051a66a3cc3e41dee057e13c17d5ae0e7f7b9c) (24 November 2026). The last commit to `src/iop/spektrafilm.c` is [`ebe4694`](https://github.com/darktable-org/darktable/commit/ebe469455a7c2abc59930e894b8d58fd007ef84b) (16 November).
- darktable-org/darktable-spektrafilm `main` [`b15cfe1`](https://github.com/darktable-org/darktable-spektrafilm/tree/b15cfe18fb35ec15084f78c986b0ebc730338e6e); piratenpanda/darktable-spektrafilm `arctic_upsampling` [`fc1b5e7`](https://github.com/piratenpanda/darktable-spektrafilm/tree/fc1b5e7cf42da7d9575f4558d75555842628a79a); piratenpanda/spektrafilm-stock-repo [`c6876b3`](https://github.com/piratenpanda/spektrafilm-stock-repo/tree/c6876b3bdefe3f38f70d053039f0c3bab1dea3bf).
- vkdt [`b10a84a`](https://github.com/hanatos/vkdt/tree/b10a84a461d8193783023758137fdc2b3ffcae5b/src/pipe/modules/filmsim), the last commit touching `filmsim`.
- JanLohse/spectral_film_lut [`b35bb15`](https://github.com/JanLohse/spectral_film_lut/tree/b35bb15fe833c22d11c70b8d699ca96939cf0932) (v0.19.1).
- ART [`925ce91`](https://github.com/artraweditor/ART/tree/925ce914a2f67e230c54713c975bf7a5ed6ba97b/tools/extlut).
- noahhaasis/negs [`7881844`](https://github.com/noahhaasis/negs/tree/78818445bd632f8dab78d70a5061b9219cc1b1b0); JamesQiu2005/SpektraLab [`e6fdcdb`](https://github.com/JamesQiu2005/SpektraLab/tree/e6fdcdb79c9b1e114e38f2ab12a505152d6e632f); DhaliwalX/fotufilm-engine [`96623ba`](https://github.com/DhaliwalX/fotufilm-engine/tree/96623ba0831a52dbddcda35727a206d4123a8b5f); turbasvin/spektrafilm-rs [`9dd59b0`](https://github.com/turbasvin/spektrafilm-rs/tree/9dd59b0380194b93686aaa230a8bb9680aa270a4).
- Emulsion: the working tree on 24 November 2026.

## 1. What changed upstream since October

### spektrafilm (Python)

| | October | Now |
| --- | --- | --- |
| Releases | v0.3.3 (6 June) | **No new release.** Still v0.3.3 ([releases](https://github.com/andreavolpato/spektrafilm/releases)). |
| `main`, `dev` | `3bb2c2d`, `6cd00c8` | **Unchanged.** `dev` has not merged into `main`. |
| Activity | | No push since 14 July. Open issues ask for B&W still films on `main` ([#74](https://github.com/andreavolpato/spektrafilm/issues/74), 9 November, unanswered) and for speed-ups ([#76](https://github.com/andreavolpato/spektrafilm/issues/76)). |
| Stars | about 1,260 | 2,412, 359 forks. |
| Licence | GPL-3.0 code, CC BY-SA 4.0 profiles with preamble v1.1 | **Unchanged** (the darktable pack's `LICENSE` is a byte copy, preamble v1.1 dated 2026-05-28: [README](https://github.com/darktable-org/darktable-spektrafilm/blob/b15cfe18fb35ec15084f78c986b0ebc730338e6e/README.md#licensing)). |

The real news is a branch called `experimental`, 25 commits on top of `dev` (13 June to 8 July; [compare dev...experimental](https://github.com/andreavolpato/spektrafilm/compare/dev...experimental)):

- **A new spectral upsampling method,** "arctic2026" in several revisions, made the default in [`a1c0bb0`](https://github.com/andreavolpato/spektrafilm/commit/a1c0bb0) ("set arctic2026beta04 default"), alongside Otsu 2018, Jakob 2019 and Mallett 2019 tables ([`02a1613`](https://github.com/andreavolpato/spektrafilm/commit/02a1613)).
- **Every film and paper profile is modified**, `neutral_print_filters.json` is refitted, white normalisation is changed so mid grey is exactly (1, 1, 1) ([`e301791`](https://github.com/andreavolpato/spektrafilm/commit/e301791)), and the gamut compression knees are retuned ([`4260c7b`](https://github.com/andreavolpato/spektrafilm/commit/4260c7b)). The test baselines were regenerated, so renders change.
- **LUT creator:** a params-first single-pair bake, `build_luts(params, spec)` ([`28bf883`](https://github.com/andreavolpato/spektrafilm/commit/28bf883e1672e884307edc75852549376e13644e), [single.py](https://github.com/andreavolpato/spektrafilm/blob/28bf883e1672e884307edc75852549376e13644e/src/spektrafilm_lut_creator/single.py#L1-L19)), "preparatory for gui integration"; "fix: lut midgray management" ([`06e778c`](https://github.com/andreavolpato/spektrafilm/commit/06e778c)); V-Log and DaVinci Wide Gamut inputs ([`8d4ff0f`](https://github.com/andreavolpato/spektrafilm/commit/8d4ff0f)).
- **Scene-linear LUT inputs are still silenced** "pending shaper support" on `experimental` ([color_spaces.py L253-287](https://github.com/andreavolpato/spektrafilm/blob/28bf883e1672e884307edc75852549376e13644e/src/spektrafilm_lut_creator/color_spaces.py#L253-L287)).

A correction to [spektrafilm.md](spektrafilm.md) section 4: the LUT creator already accepts **ACEScct** as an input on `main` ([color_spaces.py L332-335](https://github.com/andreavolpato/spektrafilm/blob/3bb2c2d2801ff68b92019cf1dbcbb133d60832bc/src/spektrafilm_lut_creator/color_spaces.py#L332-L335)). For log inputs the exposure gain is 1 and the headroom is the curve's own, about 10.3 stops above mid grey for ACEScct ([L585-612](https://github.com/andreavolpato/spektrafilm/blob/3bb2c2d2801ff68b92019cf1dbcbb133d60832bc/src/spektrafilm_lut_creator/color_spaces.py#L585-L612)). So upstream tooling can bake a scene-referred LUT; we would not have to write our own shaper around the runtime.

For SDR inputs (sRGB and friends) the creator applies a default +4 stops of gain "so the film's shoulder" is used, and notes that "midgray drifts ~1.5 stops as a side effect" (same lines). That is the trade any sRGB-in film LUT makes.

The author's [Q2 2026 digitisation campaign](https://discuss.pixls.us/t/2026-q2-data-sheets-digitization-campaign/58032) (30 May) put Double-X and Tri-X top of the poll and listed HP5 Plus only as a wishlist item. What landed was cine B&W on `dev`: Double-X 5222, Tri-X **7266 reversal** and 2302. Tri-X 400 and HP5 Plus still do not exist upstream ([#74](https://github.com/andreavolpato/spektrafilm/issues/74), including the reporter's own correction).

### darktable's spektrafilm module

- **It ships in darktable 5.8.** The draft release notes on master list it first under "The Big Ones": "A new tone mapper for analog film simulation based on the spektrafilm project" ([RELEASE_NOTES.md L55-66](https://github.com/darktable-org/darktable/blob/64051a66a3cc3e41dee057e13c17d5ae0e7f7b9c/RELEASE_NOTES.md#L55-L66)). The newest release is still 5.6.2 (4 October); `release-5.7.0` is the development tag ([releases](https://github.com/darktable-org/darktable/releases)). darktable's December releases came on 21 December in 2025 (5.4.0), so 5.8.0 is likely within weeks; that is an inference, not an announced date.
- **About 35 commits since `25124eb2e`**, almost all by piratenpanda (the module's maintainer), between 27 October and 19 November ([history of spektrafilm.c](https://github.com/darktable-org/darktable/commits/64051a66a3cc3e41dee057e13c17d5ae0e7f7b9c/src/iop/spektrafilm.c)). They are performance and robustness work: OpenCL kernels folded and buffers cut from five to four ([`bb40a3f`](https://github.com/darktable-org/darktable/commit/bb40a3fba9), [`6a61d45`](https://github.com/darktable-org/darktable/commit/6a61d45ebe)), the profile scan cached and the simulation no longer rebuilt for output gains ([`5b504be`](https://github.com/darktable-org/darktable/commit/5b504beabd), [`215e582`](https://github.com/darktable-org/darktable/commit/215e5827e4)), and three numerical fixes that touch rendering at the edges: the exposure floored at zero ([`4b97a4f`](https://github.com/darktable-org/darktable/commit/4b97a4f413)), the log-exposure floor added in float as the kernel does ([`15a5129`](https://github.com/darktable-org/darktable/commit/15a51299f7)), and Langmuir factors not read unparsed ([`c9ddf05`](https://github.com/darktable-org/darktable/commit/c9ddf052cf)). Open PRs are still landing ([#23244](https://github.com/darktable-org/darktable/pull/23244) "Final 58 opencl tuning", [#23253](https://github.com/darktable-org/darktable/pull/23253) on pack selection).
- **Validation claims are unchanged:** `spektra_sim.c` is "a validated port of spektrafilm 0.3.x, max deviation < 1e-4 vs the Python reference", and the GPU kernels were "validated against the CPU engine with POCL to ~1e-6" ([spektrafilm.c L37-59](https://github.com/darktable-org/darktable/blob/64051a66a3cc3e41dee057e13c17d5ae0e7f7b9c/src/iop/spektrafilm.c#L37-L59)). The OpenCL file itself says to "expect ~1e-3 vs the CPU path" because the kernels are float and the CPU is double ([spektrafilm.cl L36-44](https://github.com/darktable-org/darktable/blob/64051a66a3cc3e41dee057e13c17d5ae0e7f7b9c/data/kernels/spektrafilm.cl#L36-L44)). The port names its source as "spektrafilm 0.3.3" with section markers per Python file ([spektra_sim.c L19-33](https://github.com/darktable-org/darktable/blob/64051a66a3cc3e41dee057e13c17d5ae0e7f7b9c/src/common/spektra_sim.c#L19-L33)).
- **Ready for upstream's next data.** Pack formats 2 and 3 are read ([spektra_sim.h L98-99](https://github.com/darktable-org/darktable/blob/64051a66a3cc3e41dee057e13c17d5ae0e7f7b9c/src/common/spektra_sim.h#L98-L99)); an edit records the pack, the default spectral table and any table it was moved to ([spektrafilm.c L1068-1095](https://github.com/darktable-org/darktable/blob/64051a66a3cc3e41dee057e13c17d5ae0e7f7b9c/src/iop/spektrafilm.c#L1068-L1095)), and the code already mentions the arctic tables ([spektra_sim.c L1176](https://github.com/darktable-org/darktable/blob/64051a66a3cc3e41dee057e13c17d5ae0e7f7b9c/src/common/spektra_sim.c#L1176)). piratenpanda keeps a `packs/0.3.4` (format 3, hanatos2025 plus arctic2026beta04) on a personal branch ([arctic_upsampling](https://github.com/piratenpanda/darktable-spektrafilm/tree/fc1b5e7cf42da7d9575f4558d75555842628a79a)), not in the official repository.
- **Defaults** ([params struct L189-324](https://github.com/darktable-org/darktable/blob/64051a66a3cc3e41dee057e13c17d5ae0e7f7b9c/src/iop/spektrafilm.c#L189-L324)): halation and grain on, couplers 1.0 with 20 µm diffusion and a 200 µm tail, glare 0, scanner sharpening 0.7, auto print exposure off, paper = the film's target print. Push/pull is darktable's own documented approximation: film exposure minus the push, development gamma × 1.15 per stop ([L141-152](https://github.com/darktable-org/darktable/blob/64051a66a3cc3e41dee057e13c17d5ae0e7f7b9c/src/iop/spektrafilm.c#L141-L152), [L1899](https://github.com/darktable-org/darktable/blob/64051a66a3cc3e41dee057e13c17d5ae0e7f7b9c/src/iop/spektrafilm.c#L1899), [L1945-1951](https://github.com/darktable-org/darktable/blob/64051a66a3cc3e41dee057e13c17d5ae0e7f7b9c/src/iop/spektrafilm.c#L1945-L1951)). The [user manual](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/spektrafilm/) calls it a tone mapper that "takes the place of filmic rgb, sigmoid or AgX".
- **Data pack:** unchanged since 19 August. One pack, `packs/0.3.3`, described as "0.3.3 (dev branch)", 31 profiles (22 films, 9 papers), spectral table `565f4ec4` (hanatos2025) ([README](https://github.com/darktable-org/darktable-spektrafilm/blob/b15cfe18fb35ec15084f78c986b0ebc730338e6e/README.md#available-packs)). Profiles: Portra 160/400/800 (and 800 push 1 and 2), Gold 200, Ektar 100, UltraMax 400, Fujifilm C200, Pro 400H, X-TRA 400, Vision3 50D/200T/250D/500T, Verita 200D, Ektachrome 100, Kodachrome 64, Provia 100F, Velvia 100, Double-X, "Tri-X" (7266), 2302, and nine papers ([profiles/](https://github.com/darktable-org/darktable-spektrafilm/tree/b15cfe18fb35ec15084f78c986b0ebc730338e6e/packs/0.3.3/profiles)). GitHub reports "Other" as the licence: the data is CC BY-SA 4.0 with the spektrafilm preamble, the `tools/` are GPL-3.0-or-later ([README, Licensing](https://github.com/darktable-org/darktable-spektrafilm/blob/b15cfe18fb35ec15084f78c986b0ebc730338e6e/README.md#licensing)).
- **Community packs are coming.** On 23 November piratenpanda started a "Spektrafilm Pack Creator for darktable" that merges the base pack with Negs' extra profiles (below) into a downloadable pack ([README](https://github.com/piratenpanda/spektrafilm-stock-repo/blob/c6876b3bdefe3f38f70d053039f0c3bab1dea3bf/README.md), [sources.json](https://github.com/piratenpanda/spektrafilm-stock-repo/blob/c6876b3bdefe3f38f70d053039f0c3bab1dea3bf/sources.json)). It is a personal repository, not darktable-org.

### vkdt `filmsim`

Seven commits since `1ded4fb`, from 31 October to 23 November ([history](https://github.com/hanatos/vkdt/commits/b10a84a461d8193783023758137fdc2b3ffcae5b/src/pipe/modules/filmsim)): film exposure calibrated in setup instead of in the LUT ([`ad0408c`](https://github.com/hanatos/vkdt/commit/ad0408c8fc)), exposure normalisation dropped from the LUT generator ([`63316fa`](https://github.com/hanatos/vkdt/commit/63316fa543)), **neutral print filters refitted** ([`18819cf`](https://github.com/hanatos/vkdt/commit/18819cf215)), and illuminant fixes. It still keeps its own fits and defaults, so it remains a guide to GPU speed, not a reference for numbers.

### spectral_film_lut

Fifteen commits since `bcbcfc6`, released as v0.19.0 and v0.19.1 on 22 November ([compare](https://github.com/JanLohse/spectral_film_lut/compare/bcbcfc6...b35bb15fe833c22d11c70b8d699ca96939cf0932)). The ones that change renders are "rework dye_inhibition" and "fix color_masking" ([`aaf030f`](https://github.com/JanLohse/spectral_film_lut/commit/aaf030faec), [`718c153`](https://github.com/JanLohse/spectral_film_lut/commit/718c153bfc)); the rest is restructuring, tests and CI. Still MIT, 136 stars. **No new stocks in our gaps:** it has Tri-X 400 and Double-X 5222 for B&W, Superia X-TRA 400, Vision3 5219 for CineStill's base, and no HP5 or CineStill ([data tree](https://github.com/JanLohse/spectral_film_lut/tree/b35bb15fe833c22d11c70b8d699ca96939cf0932/src/spectral_film_lut/data)).

### ART

The extlut generator gained a backend for the Rust port spektrafilm-rs ([`7f03ebe`](https://github.com/artraweditor/ART/commit/7f03ebe876), 22 October) and turns its spatial diffusion off ([`e6a14b1`](https://github.com/artraweditor/ART/commit/e6a14b13e1)). Worth noting for us: ART feeds spektrafilm **scene-linear** light through a **PQ shaper** (1.0 = 100 nits, so about 100× diffuse white of headroom) and gets linear ACES2065-1 back, written as a CLF with a 1D shaper and a 3D LUT ([spektrafilm_mklut.py L153-171](https://github.com/artraweditor/ART/blob/925ce914a2f67e230c54713c975bf7a5ed6ba97b/tools/extlut/spektrafilm_mklut.py#L153-L171), [L264-275](https://github.com/artraweditor/ART/blob/925ce914a2f67e230c54713c975bf7a5ed6ba97b/tools/extlut/spektrafilm_mklut.py#L264-L275), [L630-645](https://github.com/artraweditor/ART/blob/925ce914a2f67e230c54713c975bf7a5ed6ba97b/tools/extlut/spektrafilm_mklut.py#L630-L645)). It also solves its own Y/M print filter shifts by least squares to neutralise grey ([L174-189](https://github.com/artraweditor/ART/blob/925ce914a2f67e230c54713c975bf7a5ed6ba97b/tools/extlut/spektrafilm_mklut.py#L174-L189)), which is ART's addition, not spektrafilm's.

## 2. Is there anything better or new?

The field has exploded around spektrafilm itself: a GitHub search for "spektrafilm" finds over 40 public repositories, most created since September ([search](https://github.com/search?q=spektrafilm&type=repositories)). Almost all are apps or plug-ins wrapping spektrafilm or a port of it. Nothing new models film differently and is better grounded.

### Candidates

| Project | What it is | Data provenance | Licence | Our stocks | Standing | Fit for Emulsion |
| --- | --- | --- | --- | --- | --- | --- |
| **darktable spektrafilm** | Native C port with OpenCL twin, unit tests, in darktable 5.8 | spektrafilm 0.3.3 profiles via the official pack | GPL-3.0-or-later code; CC BY-SA 4.0 data | Portra 160/400, Gold 200, Ektar 100, Pro 400H; Superia via X-TRA 400; CineStill via Vision3 500T; no Tri-X 400 or HP5 | darktable upstream; maintained weekly | **The source to follow** (section 3) |
| spektrafilm (Python) | The reference | Author's own profiles from datasheets and reflectance sets | GPL-3.0; CC BY-SA 4.0 | Same as darktable | 2,412 stars; no commits since July | Reference behind darktable; its LUT creator is a fallback bake tool |
| [spektrafilm-rs](https://github.com/turbasvin/spektrafilm-rs) | Rust port with GPU, CLI | spektrafilm's | GPL-3.0 | Same | 61 stars; last commit 15 June | Superseded by Negs (its fork) and darktable |
| [Negs](https://github.com/noahhaasis/negs) | Rust + WebGPU app built from spektrafilm-rs; web, Mac, Windows, Linux; exports a 33³ sRGB `.cube` | spektrafilm's, plus 29 Fotufilm profiles and about 25 Negs preparations from Fujifilm and Kodak datasheets ([README L246](https://github.com/noahhaasis/negs/blob/78818445bd632f8dab78d70a5061b9219cc1b1b0/README.md#L246)) | GPL-3.0; CC BY-SA 4.0 | **All nine**: X-TRA 400, CineStill 800T, HP5 Plus, an "experimental" Tri-X 400 ([profiles/](https://github.com/noahhaasis/negs/tree/78818445bd632f8dab78d70a5061b9219cc1b1b0/data/profiles)) | 94 stars, created 19 October, very active; feeds the darktable pack creator | Source of our current local test pack. A downstream fork with its own changes, so not the reference |
| [SpektraLab](https://github.com/JamesQiu2005/SpektraLab) | C++/Metal engine and Mac app derived from spektrafilm, with parity harnesses against the Python ([README L86-88](https://github.com/JamesQiu2005/SpektraLab/blob/e6fdcdb79c9b1e114e38f2ab12a505152d6e632f/README.md#L86-L88)) | spektrafilm's 28 profiles unmodified, plus its own Tri-X 400, T-Max 100, Acros II, HP5 Plus, Multigrade IV and many discontinued Fujifilm and Kodak stocks, built from datasheets with spektrafilm's profile factory ([NOTICE](https://github.com/JamesQiu2005/SpektraLab/blob/e6fdcdb79c9b1e114e38f2ab12a505152d6e632f/engine/resources_product/NOTICE.md)) | GPL-3.0-or-later; CC BY-SA 4.0 | All, with CineStill 800T as an **alias** of Vision3 500T with anti-halation off | 2,013 stars, very active | Best-documented B&W profiles outside upstream. App code is Swift/Metal, not portable to WebGL as is |
| [Fotufilm engine](https://github.com/DhaliwalX/fotufilm-engine) | Independent spectral film engine (Swift/Halide/Metal), Resolve and Final Cut plug-ins | 47 runtime profiles; prints digitised from named datasheets ([README L240-330](https://github.com/DhaliwalX/fotufilm-engine/blob/96623ba0831a52dbddcda35727a206d4123a8b5f/README.md#L240-L330)). Its CineStill 800T says `"manufacturer_data": false` (as converted by Negs: [cinestill_800t.json](https://github.com/noahhaasis/negs/blob/78818445bd632f8dab78d70a5061b9219cc1b1b0/data/profiles/cinestill_800t.json)) | Apache-2.0 code; CC BY-SA 4.0 profiles | All except Superia 400 by that name | 225 stars, created September | A different model, not the community's reference; its data reaches us only through Negs |
| [spektrafilm-ofx](https://github.com/chaert-s/spektrafilm-ofx) | OpenFX plug-in for Resolve and Nuke, Metal/Vulkan | spektrafilm's | GPL-3.0 | As spektrafilm | 397 stars; last push 6 July | Video tool; no gain over darktable for us |
| vkdt `filmsim` | GPU port (Vulkan compute) | spektrafilm `dev`, own fits | BSD-2-Clause | As spektrafilm dev | Active | Speed guide only (October conclusion stands) |
| spectral_film_lut | Independent datasheet model, LUT generator | Digitised datasheets in Python files | MIT | All but CineStill (via 5219) and HP5 | 136 stars | Fallback only; not darktable, smaller community |
| Filmulator | Generic development model | None per stock | GPL-3.0 | None | Last push July | Not a stock model (October conclusion stands) |

Others checked and set aside: RawTherapee has no film module or spektrafilm work ([issue search](https://github.com/RawTherapee/RawTherapee/issues?q=spektrafilm) returns nothing); [3D Colorimetric Film](https://discuss.pixls.us/t/poc-introduction-to-a-new-experimental-module-3d-colorimetric-film-3dcf/58009) in a darktable fork is a tone mapper "inspired by" spektrafilm with no film data; darktable RFCs for separate scene-referred halation and grain modules are open ([#22150](https://github.com/darktable-org/darktable/pull/22150), [#22311](https://github.com/darktable-org/darktable/pull/22311)).

### Papers and datasets

- "Emulating Emulsion" (SIGGRAPH 2025 poster, [project page](https://musicofmusix.github.io/siggraphposters25)) fits a 3×3, per-layer sigmoids and a second 3×3 to one stock (Velvia 100) from chart shots. No code or data link. It is close to Emulsion's old parametric stocks, fitted to film scans; one stock is not enough to use.
- "Deep Analog" ([arXiv 2608.14702](https://arxiv.org/abs/2608.14702), August 2026) predicts a 3D LUT from a reference image. It is learned, not data-grounded per stock.
- No new open dataset of film spectral data turned up. The datasheet digitising effort happens inside the projects above (spektrafilm's campaign, SpektraLab's and Negs' preparations, Fotufilm's profiles).
- I found no head-to-head comparison on discuss.pixls.us of spektrafilm, spectral_film_lut and vkdt. The darktable module's [implementation thread](https://discuss.pixls.us/t/spektrafilm-darktable-module-implementation-discussion/58744) is one of the forum's busiest.

### Commercial reference points

What users will compare against, for context only (closed, cannot be ported): [Dehancer](https://www.dehancer.com/), [FilmConvert](https://www.filmconvert.com/), [FilmBox](https://videovillage.com/filmbox/), [DxO FilmPack](https://www.dxo.com/dxo-filmpack/). The free spektrafilm apps above (SpektraLab, Negs) now set the bar for "spectral" film in the open.

### Verdict on alternatives

Nothing is better grounded than spektrafilm, and among its implementations darktable's is the one the porting rule picks: darktable upstream, a C reference with unit tests, a GPU twin validated against it, data pinned by hash. The new community profiles (SpektraLab's, Negs') are the only spektrafilm-format sources for Tri-X 400 and HP5 Plus, but they are downstream preparations, not upstream data.

## 3. Analysis for Emulsion today

### Where a look's LUT sits, and why a spektrafilm stock can't ride it

The develop pass runs, in this order ([develop.frag.glsl L168-197](../../src/engine/shaders/develop.frag.glsl)): the look's hidden colour balance, the photo's colour balance, masks, vignette, optics (halation and glow), then **`stageToneProfile`** (the neutral darktable sigmoid, scene to display-encoded Rec.2020 print), then **`stageLookPrint`** if a look has a LUT, then clarity, sharpening, grain, output, scanner, curve, finish.

`stageLookPrint` converts the print to **sRGB-encoded display values clamped to [0, 1]**, does darktable's tetrahedral lookup on texture unit 11, blends by Amount, and returns to print encoding ([lut.glsl L24-27, L82](../../src/engine/shaders/stages/lut.glsl); `LUT_UNIT` in [params.ts L77](../../src/engine/params.ts)). ARCHITECTURE says the Look "never supplies the base rendering" ([ARCHITECTURE.md L78](../ARCHITECTURE.md)). Emulsion's built-in looks and the LUT packs (t3mujinpack, Pat David) all work this way: hidden scene-side settings plus a display-referred LUT on the sigmoid's print.

So a LUT on this path sees light that the sigmoid has already tone-mapped and clipped at display white. A spektrafilm stock is itself a tone mapper (darktable: "takes the place of filmic rgb, sigmoid or AgX"). On this path its film and paper curves run on top of the sigmoid's curve: two tone curves, highlights already compressed, and the film's own shoulder never reached. That is what the **local test pack** does today: 11 Negs `.cube` files, "sRGB encoded, range 0..1 ... NOT log-input LUTs", installed in the `spektrafilm` local pack ([looks.ts L124](../../src/film/looks.ts); `local-looks/spektrafilm/README.txt`). Its README records that baking the sigmoid's inverse into the LUT was tried and rejected because the inverse is ill-conditioned near white. That rejection is correct, and it means the fix is upstream of the sigmoid, not inside the LUT.

**Conclusion: a spektrafilm stock needs its own Film stage that replaces `stageToneProfile` for that stock**, taking scene-linear Rec.2020 through a log shaper and returning the display-encoded Rec.2020 print that clarity and everything after expect (the layout in [spektrafilm.md](spektrafilm.md) section 3 still holds). It can reuse the lut3d port's tetrahedral lookup and a 3D texture; the darktable precedent is exact, since darktable's module replaces sigmoid. What changes is the domain and position, not the lookup code.

### The options

**(a) Offline-baked 3D LUT per stock, from darktable's code, in a new Film stage.**

- *How:* bake a 65³ lattice in a log shaper (ACEScct, which spektrafilm's creator and ART's precedent support; or a plain log2 range) through darktable's spektrafilm with every spatial and random effect off: halation, grain, diffusion, highlight boost, glare 0, scanner sharpening 0, and **coupler diffusion 0 µm with tail weight 0**, so the DIR-coupler chemistry runs per pixel as spektrafilm's LUT mode does. Two ways to run darktable's code: `darktable-cli` with an XMP holding only spektrafilm on a float lattice image in linear Rec.2020 (the released binary, unmodified), or a small C harness that links `spektra_sim.c` and calls its stage functions. Output linear Rec.2020 with darktable's OkLCh gamut compression on, then Emulsion applies the sRGB transfer, as the tone stage's output is encoded.
- *Fidelity:* darktable's numbers at grid points. darktable's own GPU path is already table-based (below), so a well-sampled LUT adds one more interpolation, measurable against the TS reference.
- *Cost on the GPU:* a shaper (three logs) and one tetrahedral lookup: 4 texel fetches, the same as today's look LUT. Negligible against the slider target.
- *Live controls:* film exposure (it is our Exposure, upstream of the LUT), white balance (ours, upstream). Push/pull as darktable defines it (exposure − stops, gamma × 1.15^stops) needs one LUT per push value; with Emulsion's four push values that is four LUTs per stock. Print exposure, filtration, paper, coupler amount are fixed at bake time.
- *Containment:* one stage file plus data. Halation and glow stay ours (already ported from darktable's `spektra_core.c` at `c96cf1d0`, [optics.ts header](../../src/engine/optics.ts)); grain stays darktable's grain module; Neutral and Emulsion Standard keep the sigmoid.
- *Licence:* the LUTs are CC BY-SA 4.0 derivatives; ship them with the unmodified licence file and a CHANGELOG, as darktable's pack does.

**(b) Live port of darktable's per-pixel colour path.**

What darktable actually runs on the GPU is not a spectral integral per pixel. The exact spectral mode "has no GPU path"; the GPU uses tables built on the CPU per film, paper and settings ([spektra_sim.h L246-262](https://github.com/darktable-org/darktable/blob/64051a66a3cc3e41dee057e13c17d5ae0e7f7b9c/src/common/spektra_sim.h#L246-L262), [L576-578](https://github.com/darktable-org/darktable/blob/64051a66a3cc3e41dee057e13c17d5ae0e7f7b9c/src/common/spektra_sim.h#L576-L578)): a Mitchell-cubic 2D table from chromaticity to film exposure, 1D density curves, a 3×3 coupler matrix, a 33³ monotone-PCHIP table for the enlarger and another for the scan, then OkLCh gamut compression ([spektrafilm.cl L28-41](https://github.com/darktable-org/darktable/blob/64051a66a3cc3e41dee057e13c17d5ae0e7f7b9c/data/kernels/spektrafilm.cl#L28-L41), [`sf_pchip3d` L216-258](https://github.com/darktable-org/darktable/blob/64051a66a3cc3e41dee057e13c17d5ae0e7f7b9c/data/kernels/spektrafilm.cl#L216-L258)). Each PCHIP lookup reads values and three slope tables at eight corners plus a clamp: about 34 RGB reads. Per pixel that is roughly 16 + 70 + 10 ≈ 100 texture reads and a few hundred arithmetic operations.

Cost estimates (not measured; to check with `tools/browser-tests/develop-cost.ts`):

| Per pixel | Reads | At the 2560 px preview (about 4.4 MP) | Verdict |
| --- | --- | --- | --- |
| Look LUT today, or option (a) | 4 | well under 1 ms | Free |
| darktable's table path inside the develop pass | about 100 | a few ms, plus register pressure in an already large shader (one `isnan` once made the develop pass 2.7× slower, [CLAUDE.md](../../CLAUDE.md)) | Risky for the 45 fps drag target |
| Exact spectral, 81 bands for film, enlarger and scan | about 250 exponentials and 1,500 multiply-adds | tens of ms | No; darktable doesn't either |

Texture units are the other limit: the develop pass uses 0-12, unit 13 is now the masks' Glow array (`MASK_GLOW_UNIT`, [params.ts L79](../../src/engine/params.ts)), so only 14 and 15 are free, against at least nine tables. For comparison, Negs takes about 0.9 s per full-resolution frame on an M1 Pro GPU with all its spatial effects, and renders only the visible pixels while a slider moves ([README L85-97](https://github.com/noahhaasis/negs/blob/78818445bd632f8dab78d70a5061b9219cc1b1b0/README.md#L85-L97)).

**(b′) The same port, baked live into the Film stage's 3D texture.** Run darktable's per-pixel table path over the 65³ lattice in a small GPU pass (or the worker), and keep the develop pass's single lookup. 274,625 lattice points at ~100 reads each is a fraction of a millisecond on the GPU. Emulsion already bakes LUTs at runtime for Fuji recipes ([`bakeFujiLut`](../../src/film/fujirecipe.ts)). The CPU-side table build (darktable's `sf_sim_build`: illuminants, dichroic filters, two 33³ tables over 81 bands, PCHIP slopes) has to be ported to TypeScript and redone when film, paper, filters or gammas change; print exposure is a log offset in the per-pixel path and needs only the lattice re-bake. This gives live film controls with (a)'s develop cost.

**(c) spectral_film_lut bakes.** MIT, scene-referred log input, Tri-X 400 included. But it is not darktable's, its colour masking was reworked a week ago, and its community is a fraction of spektrafilm's. Under the porting rule it loses to darktable for the colour stocks. Taking only its Tri-X 400 would put two film models side by side.

**(d) Community profiles for the gaps** (SpektraLab's Tri-X 400 and HP5 Plus, Negs' and Fotufilm's CineStill 800T and HP5 Plus). They load in darktable's engine (the pack creator merges Negs' data), so they could flow through (a) or (b′) unchanged. But they are not upstream data, and Fotufilm's CineStill 800T has no manufacturer data behind it.

### Comparison

| | (a) baked, darktable | (b) live in develop pass | (b′) live-baked | (c) spectral_film_lut | today's local pack |
| --- | --- | --- | --- | --- | --- |
| Porting rule | darktable's code and data | darktable's | darktable's | Not darktable | spektrafilm via Negs, wrong domain |
| Fidelity | Grid error only | darktable's GPU path | Grid error only | Its own model | Film curve on top of the sigmoid |
| Develop-pass cost | ~4 reads | ~100 reads, 9+ textures | ~4 reads | ~4 reads | ~4 reads |
| Live controls | Exposure, WB; push via 4 LUTs | All of darktable's | All of darktable's per-pixel ones | Exposure, WB | None |
| Effort | Days: bake tool, Film stage, TS reference, probe, licence files | Weeks | Weeks (port of `sf_sim_build` and the kernels) | Days | Done, but not faithful |
| Maintenance | Re-bake on a new darktable pack | Track darktable's C | Track darktable's C | Track a fast-moving model | n/a |

### Stock coverage with darktable's pack

| Emulsion stock | darktable pack 0.3.3 | Gap handling |
| --- | --- | --- |
| Portra 400, Portra 160, Gold 200, Ektar 100, Pro 400H | Yes | Use as is, on the profile's target print (Portra Endura, Crystal Archive Type II for Fujifilm). |
| Superia 400 | `fujifilm_xtra_400` (Superia X-TRA 400) | Name it Superia X-TRA 400. |
| CineStill 800T | None; `kodak_vision3_500t` is the base film | Vision3 500T with our halation, named for what it is, or follow SpektraLab's alias. Oli's call. |
| Tri-X 400 | None (`kodak_trix` is 7266 reversal) | Keep today's B&W looks until upstream adds it ([#74](https://github.com/andreavolpato/spektrafilm/issues/74)). |
| HP5 Plus | None | Same. |

Bonus stocks that come free with the pack: Portra 800 (with measured push 1 and 2), UltraMax 400, C200, Vision3 50D/250D/200T, Verita 200D, and slide films scanned directly.

### Things to settle before any code

- **Middle grey.** Still unmeasured (October question 6). darktable feeds its module scene-linear light after its exposure module; Emulsion's RAWs carry `BASELINE_GAIN` 1.8. The probe can compare a grey card's film density in Emulsion with darktable's on the same RAW.
- **Edit stability.** darktable stamps every edit with the pack and spectral table it was made with, because upstream "revises that table between releases and each revision renders differently" ([pack README](https://github.com/darktable-org/darktable-spektrafilm/blob/b15cfe18fb35ec15084f78c986b0ebc730338e6e/README.md#what-a-pack-is)). With `experimental` changing every profile and the upsampling, a spektrafilm 0.4 will change renders. Emulsion's sidecar should record the data version too, and keep old LUTs.
- **Whites and positive Blacks** have no sigmoid to move for a film stock (October question 4). darktable's manual points to the module's black and white point corrections or a curve after the module.

## Recommendation

1. **Follow darktable's spektrafilm module, at the `release-5.8.0` tag once it exists** (or a pinned master commit now), with its official 0.3.3 data pack. Not the Python, Negs, spectral_film_lut or vkdt.
2. **Add a Film stage that replaces the neutral sigmoid for spektrafilm stocks**, scene-linear in through a log shaper, display-encoded Rec.2020 out, using the lut3d port's lookup and a 3D texture. Do not put spektrafilm on the existing display-referred look-LUT slot, and retire the Negs `.cube` local pack once the stage works.
3. **Start with option (a):** per-stock 65³ LUTs baked offline by darktable's code with spatial effects and coupler diffusion off, four push values per stock using darktable's push/pull. Write the TypeScript reference (shaper plus lookup), check the GLSL with the probe, and check the bake against darktable's own render of a grey ramp and a colour chart.
4. **Plan (b′) as the follow-up** only if Oli wants live print exposure, filtration, paper choice or coupler amount: port darktable's table build and per-pixel kernels to TypeScript, bake the lattice on the GPU when those change. Never run the spectral path per pixel in the develop pass.
5. **Cover five colour stocks faithfully, Superia as X-TRA 400; keep Tri-X 400 and HP5 on their current B&W looks** until upstream or darktable's official pack has them. Decide CineStill with Oli.
6. **Record the data version per edit**, and ship the LUTs as CC BY-SA 4.0 data with the unmodified licence file, a CHANGELOG, NOTICE.md and About-screen credit.

## Open questions for Oli

1. **Can a look supply the base rendering?** A spektrafilm stock replaces the sigmoid, which ARCHITECTURE currently rules out for looks. Is a "film" look kind that swaps the tone stage acceptable, with Amount blending against the Neutral print?
2. **Pin to darktable 5.8 when it is tagged, or to master now?** Fixes are still landing weekly.
3. **Baked only (a), or plan for live controls (b′)?** If live, which matter: print exposure, M/Y filtration, paper, couplers, film gamma?
4. **Gaps:** Superia 400 renamed to X-TRA 400? CineStill 800T as "Vision3 500T" with our halation, as a SpektraLab-style alias, or dropped? Tri-X 400 and HP5 kept on their current looks, or taken from SpektraLab's or Negs' community profiles?
5. **Paper:** each film's target print only, or expose paper choice (a bake per paper)?
6. **Whites and positive Blacks** on film stocks: hide, map to print exposure, or apply after the stage (a deviation)?
7. **Naming and credit:** what to call the collection, given the licence preamble asks that "spektrafilm" not be used in product branding without asking ("uses spektrafilm" is fine)?
8. **The local Negs pack:** retire it once the Film stage exists?
