# Fitting looks to Fujifilm film simulations

How the Emulsion x Fuji looks were made (2026-11-14/15), and how to make more. Each look is fitted
to many RAW + camera JPEG pairs at once, numerically, instead of by eye. By eye fails: a look is a
few global controls, so fixing one photo's sky moves every other photo's blues.

## What's here

| File | Does |
|---|---|
| `lookfit.mjs` | Fits one look to RAW+JPEG pairs. Default: the master tone curve (+ exposure per photo). `--color`: HSL x 24, colour balance saturation/chroma x 8, vibrance, 3 tint wheels. `--color --evaluate`: measure only (also reports grey a*/b* offsets). `--color --bw` / `--sepia`: a black and white look's HSL brightness (and tint wheels). Runs the real engine in headless Chrome (`tools/browser-tests/look-fit*.ts`); decodes with the ignored Rust test `decode::dump_engine_payloads`. Output in `.scratch/lookfit/`. |
| `batch.sh` | For each `"<look id>|<Tag>[|bw|sepia]"`: verify the JPEGs, fit tone on the DR100 photos, then colour on all. Results in `.scratch/batch/<id>/` (`fitted-look.json`, reports). Needs `.scratch/batch/<id>/start.json`. Run under `caffeinate -i`. |
| `apply.py` | Writes fitted looks into a looks JSON (category "Emulsion x Fuji"; `bw` when the look is desaturated). Edit its `NAMES` for new looks. |
| `xraw_folder.py` | Builds an X RAW Studio folder: RAWs cloned once per simulation (`<RAW>_<Tag>.RAF`), each with its settings file. |
| `verify.py` | Checks every JPEG in a folder against its RAF: one simulation, base settings, DR100, white balance shift matching the RAW. |
| `compare.mjs` | Labelled side-by-side images, `--sides` for the website's sliders, `--grid` for one photo in several simulations. |
| `fujifilm.mjs`, `fujiexif.py` | Read Fujifilm maker notes (film simulation, tones, Colour, DR, WB shift). |

Run from the worktree root after `source ~/.cargo/env`, with
`CARGO_TARGET_DIR=/Users/oli/Dev/emulsion/src-tauri/target` (reuses the main checkout's build).

## The process

1. **Pick the RAWs.** Use RAWs **captured at DR100** (read the DR from the RAF, not the folder's JPEG).
   Choose for colour coverage, not count: about 40-70 photos, spread across trips, no near-repeat
   frames. What was done: measure every DR100 RAW's colour from its embedded preview (Lab hue shares in
   8 bands), then pick greedily for the bands the set lacks. Teal is rare at DR100 in Oli's library;
   8 teal DR200/DR400 RAWs were added, and the colour fit counts them for colour only (hue and
   saturation, not lightness) at +1/+2 EV. The current set: `X RAW DR100 set`, `X RAW DR100 set 2`,
   `X RAW teal set (DR200-400)` in `/Volumes/Oli External/Photos/2025` (78 RAWs; leave out
   DSCF6087, which renders ~0.5 stop too bright, unexplained).
2. **Make the X RAW Studio folder** with `xraw_folder.py`, from a template `.FP2` at the base
   recipe. Pasting settings in X RAW Studio copies one photo's white balance shift onto all of them:
   don't. Every RAW must keep **its own** shift (the RAF's as-shot white balance includes it; tested
   by grey offsets across shift groups: equal). Never set the shift to 0.
3. **Oli converts** in X RAW Studio (it uses the camera, so only the X-T30 II's simulations).
   Spot-check one file's settings in the app first.
4. **Verify** with `verify.py FOLDER _Tag`.
5. **Fit**: a start look per simulation in `.scratch/batch/<id>/start.json` (Classic Negative's colour
   balance masks only: shadows_weight, white_fulcrum, highlights_weight, grey_fulcrum,
   mask_grey_fulcrum; straight curves; zero HSL), then `caffeinate -i tools/lookfit/batch.sh
   "<id>|<Tag>" ...`. About 12 min per look on an awake Mac; idle, it slows to an hour and the
   tone fit times out.
6. **Apply** with `apply.py /Users/oli/Dev/emulsion/src/film/emulsion-looks.json <id> ...`, then run
   the look tests (`npx vitest run src/film src/ui/lookbrowser*.test.ts`). Pin the curve's white
   point to 1 (batch.sh does).
7. **Compare**: `compare.mjs --out DIR [--sides DIR] PHOTO ...`; it renders the RAW at full
   resolution and shrinks both sides alike (a half-size decode made the Emulsion side look soft).

## Things learned

- **DR200/DR400** captures are 1/2 stops darker than DR100; the camera's DR200 JPEG also rolls the
  highlights off differently, so fit only DR100 *captures*. X RAW Studio's DR100 conversion of a
  DR200 capture brightens it by exactly a stop (needs +1 EV in Emulsion, which `lookfit.mjs` sets
  from the RAF's DR).
- Zero colour balance's tone controls before fitting tone (`--flat-tone`): the curve then carries it.
- Rare colours (cyan, purple, magenta) are poorly constrained; a start near neutral keeps them sane.
- Results (ΔE76 fitted / held out): Classic Negative 2.41/2.32, Classic Chrome 1.79/2.10,
  Pro Neg Hi 1.86/2.22, Pro Neg Std 1.59/1.90, Provia 1.75/2.05, Velvia 2.78/3.43 (its saturation
  boost isn't constant; the sliders can't follow it), Astia 2.35/2.34, Eterna 1.53/2.00, Bleach
  Bypass 1.92/2.71.

## Emulsion Standard from Lightroom's Adobe Color (2026-11-15)

Emulsion Standard (revision 3) is fitted to Lightroom's Adobe Color across three cameras, so it isn't
one camera's rendering: Fuji RAWs now open with their simulation's look, so Standard mostly serves the
others.

- **Photos:** `/Volumes/Oli External/Photos/2025/Adobe Color set`: the 77 X-T30 II RAWs (the set above
  minus DSCF6087) plus 22 OM-3 and 5 E-300 ORFs picked for colour coverage the same way.
- **Lightroom export:** Profile **Adobe Color** (Lightroom records it as `crs:CameraProfile="Adobe Standard"`
  with the Look "Adobe Color"; check the XMP in each export), everything else at defaults, no Auto, white
  balance As Shot, lens profile corrections as Lightroom defaults them; JPEG, full size, no output
  sharpening, each named as its RAW and saved beside it. Adobe RGB exports are fine (the decoder converts
  them through their profile). Watch for Lightroom's Raw Defaults: with "Camera Settings" it gave the OM-3
  files "Camera Natural" instead, which had to be re-exported.
- **Fit:** `lookfit.mjs --look emulsion-standard --flat-tone` on the 96 normally exposed photos (the 8 teal
  DR200/DR400 Fujis left out), the white point pinned, then `--color` on all 104, every photo at exposure 0.
- **Result** (ΔE76, current Standard -> fitted; held-out photos in brackets): X-T30 II 5.5 -> 3.4 (5.6 -> 3.7),
  OM-3 7.7 -> 7.2 (7.5 -> 6.4), E-300 11.5 -> 9.7 (17.3 -> 13.8). Oli checked it on real photos before it
  replaced revision 2.

**Per-camera brightness (parked).** One curve can't fit Adobe Color on all three cameras because cameras
keep different headroom between metered grey and clipping, which Adobe evens out per model (DNG
BaselineExposure). Measured (`--free-others`): OM-3 +0.3 EV, E-300 -0.75 EV or lower, against the
X-T30 II. Measuring it from each RAW's embedded JPEG preview fails (the maker's tone curve and picture
settings swamp it: OM-3 +1.15, E-300 -0.16); measuring the RAW's own headroom (median luminance against
clipping, compensation and DR removed, `raw::headroom` on branch `feat/camera-exposure`) agrees (OM-3 +0.05,
E-300 -0.74). Learning it in the background was dropped because brightness would shift once a camera
finished calibrating; raw.pixls.us has too few photos per camera (685 of 1,035 models have one file) for a
built-in table. Emulsion Standard is fitted without any offset.

## Black and white (2026-11-15)

All nine black and white simulations were fitted from `X RAW all BW sims` (78 RAWs x 9; Tags Acros,
AcrosYe, AcrosR, AcrosG, Mono, MonoYe, MonoR, MonoG, Sepia): `caffeinate -i tools/lookfit/batch.sh
"emulsion-fuji-acros|Acros|bw" ... "emulsion-fuji-sepia|Sepia|sepia"` with `ALL="X RAW all BW sims"`.
- The JPEGs record the mode in Saturation (0x300 B&W, 0x301 red filter, 0x302 yellow, 0x303 green,
  0x310 Sepia, 0x500-0x503 Acros and its filters); `verify.py` accepts them. `lens.rs` names each
  (`acros-r`, `monochrome-ye`, ...) and `simulationLook` opens it with `emulsion-fuji-<name>`.
- Start looks: colour balance `chroma_global: -1` (it runs before the four ways, so a tint survives;
  HSL runs before colour balance, so its brightness per band still sees the colours), Emulsion Neg's
  masks, straight curve, zero HSL.
- `--bw` fits only HSL brightness per band (the colour filter); `--sepia` adds the tint wheels. Every
  photo's lightness counts, DR200/DR400 too (at +1/+2 EV): they hold most of the cyan. The report
  sorts by the scene's hue in Emulsion Standard, since the JPEG is grey.
- Tone and brightness share the overall level, so the batch runs tone, brightness, tone, brightness.
- Results (ΔE76 fitted / held out): Acros 0.83/1.15, Acros + Ye 0.95/1.31, Acros + R 1.21/1.50,
  Acros + G 1.06/1.30, Monochrome 0.79/1.07, Monochrome + Ye 0.90/1.23, Monochrome + R
  1.17/1.41, Monochrome + G 1.01/1.25, Sepia 1.77/2.08.
- The red filters reach the slider's limit (blue brightness -100, green about -96) and still leave
  blue skies ~0.6 L* and cyan ~5 L* lighter than the camera's. Darktable's channel mixer rgb (grey
  tab) would follow them exactly, if that is ever wanted; Oli found them good as they are.
- Acros adds its own grain at higher ISO, which the fit ignores (grain defaults to 0).
- Not distinguished: Monochrome's warm/cool toning (WC/MG), which the base recipe leaves at 0.

## Simulations the X-T30 II lacks: one studio RAW through Lightroom (2026-11-16)

Reala Ace and Nostalgic Neg aren't in the X-T30 II, so X RAW Studio can't make them. They were fitted
to Lightroom's Camera Matching profiles applied to one RAW of DPReview's studio scene (X-T5, base ISO,
daylight; ColorChecker, grey scale, paints, threads, colour wheels, printed faces). Lightroom only lists
those profiles for bodies that have the simulation.

- **Exports:** Lightroom Classic, Profile "Camera REALA ACE v2" and "Camera NOSTALGIC Neg" (a Look on the
  Provia profile; check the XMP), white balance As Shot, everything else at defaults, lens profile off,
  full-size JPEG. Each export goes beside a link to the RAF with the same name.
- **Fit:** `lookfit.mjs --flat-tone --exposure 0`, pin the white point, then `--color --balance --holdout 0`,
  from the usual start (Classic Negative's colour balance masks, straight curve, zero HSL). `--balance`
  spreads the colour samples over hue and lightness; spread over the frame they are mostly the black
  background.
- **Is one scene enough?** Checked on simulations we have the camera's own JPEGs for: each was fitted from
  the one X-T5 export, then scored against the camera JPEGs of the 77 X-T30 II photos (`--color --evaluate`,
  ΔE76):

  | | from one studio export | our look (fitted on those 77) | Provia instead |
  |---|---|---|---|
  | Classic Chrome (Lightroom) | 1.95 | 1.84 | 5.50 |
  | Classic Chrome (Capture One) | 2.04 | | |
  | Pro Neg Hi (Lightroom) | 2.31 | 1.91 | 3.48 |
  | Classic Negative (Capture One) | 2.96 | 2.45 | 7.85 |

  Greens and yellows carry over worst (the scene's greens are fake grass and feathers).
- **Lightroom or Capture One:** both alike, Lightroom slightly closer (Provia's ColorChecker against the
  camera's own JPEG, brightness matched: 2.55 against 2.80; both more contrasty and more saturated in
  oranges, yellows and skin than the camera). Averaging them doesn't help; their errors agree.
- **Brightness:** the X-T5's own JPEG is ~0.35 EV brighter than Lightroom's, Capture One's and our Provia
  (fitted on the X-T30 II), which agree with each other (ours vs Lightroom's Provia ΔE 1.8). So the
  exports are fitted at exposure 0, with no offset.
- **Not used:** `--fix A,B` (moves the export by the converter's Provia error against the camera's Provia
  JPEG, fitted at +0.35 EV) made every check worse (Classic Chrome 2.13, Pro Neg Hi 2.43): the converter's
  error on Provia doesn't carry to its other profiles.
- **Results** on the studio scene (ΔE76 against the export): Reala Ace 2.36, Nostalgic Neg 3.12 (Capture
  One's: 2.51, 3.36). Nostalgic Neg's leftovers are greens, yellows and magentas (~5). A camera JPEG pair
  (someone's X-T5, X100VI or X-T50 RAW+JPEG shot in either simulation) would beat this; nothing here has
  been checked against the camera.
- `compare.mjs --pair RAW,JPEG,LOOK,LABEL,Lightroom` makes the side-by-sides from any such pair.
