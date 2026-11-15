# Fitting looks to Fujifilm film simulations

How the Emulsion x Fuji looks were made (2026-11-14/15), and how to make more. Each look is fitted
to many RAW + camera JPEG pairs at once, numerically, instead of by eye. By eye fails: a look is a
few global controls, so fixing one photo's sky moves every other photo's blues.

## What's here

| File | Does |
|---|---|
| `lookfit.mjs` | Fits one look to RAW+JPEG pairs. Default: the master tone curve (+ exposure per photo). `--color`: HSL x 24, colour balance saturation/chroma x 8, vibrance, 3 tint wheels. `--color --evaluate`: measure only (also reports grey a*/b* offsets). Runs the real engine in headless Chrome (`tools/browser-tests/look-fit*.ts`); decodes with the ignored Rust test `decode::dump_engine_payloads`. Output in `.scratch/lookfit/`. |
| `batch.sh` | For each `"<look id>|<Tag>"`: verify the JPEGs, fit tone on the DR100 photos, then colour on all. Results in `.scratch/batch/<id>/` (`fitted-look.json`, reports). Needs `.scratch/batch/<id>/start.json`. Run under `caffeinate -i`. |
| `apply.py` | Writes fitted looks into a looks JSON (category "Emulsion x Fuji"). Edit its `NAMES` for new looks. |
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
5. **Fit**: a start look per simulation in `.scratch/batch/<id>/start.json` (Emulsion Neg's colour
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

## Next: black and white

Folder ready for Oli to convert: `X RAW all BW sims` (702 clones; Tags Acros, AcrosYe, AcrosR,
AcrosG, Mono, MonoYe, MonoR, MonoG, Sepia; X RAW names Acros AcrosYe AcrosR AcrosG BW BYe BR BG
Sepia; base, DR100, no toning or grain, own WB shift). Before fitting:
- `verify.py` rejects a non-zero Saturation tag; black and white JPEGs record their mode there
  (0x300-0x303 B&W, 0x310 Sepia, 0x500-0x503 Acros), so accept those.
- Start looks fully desaturated (colour balance `saturation_global: -1`, as B&W Dynamic/Classic do);
  fit the tone curve and HSL **brightness** per band (which is what the colour filters change);
  HSL hue/saturation and colour balance chroma do nothing to a grey result, so drop them from the
  fit (`PARAMS` in `look-fit-color.ts`).
- Sepia also needs its tint fitted (the tint wheels, applied after the desaturation).
- Acros adds its own grain at higher ISO; expect a little more scatter.
- Then add the looks (`bw: true`), map `acros`/`monochrome`/`sepia` in `simulationLook` (looks.ts;
  filters aren't distinguished yet: lens.rs `simulation_name` would need the Saturation values
  0x301/0x302/0x303 and 0x501-0x503 named per filter), and add them to the comparisons page.
