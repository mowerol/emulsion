# Handoff

**Final app icon and site spacing (2026-11-12, committed and pushed):** Oli supplied the final
icon, `~/Documents/emulsion-brand (1)/emulsion-logo-icon.png` (809×820; new slider shape). It is
now `public/brand/app-icon.png`; `swift tools/generate-icons.swift` regenerated `src-tauri/icons/`
(icns, dev icon, ico, Appx tiles); the 128 px header tile (`public/brand/logo-tile.png` =
`site/public/assets/emulsion-logo.png`) and the site's 512 px favicon are it cropped to its visible
tile. See docs/BRANDING.md. The brand kit's own `logo/icon-app.png` is still the old mark. Recorded
site media (hero loop and poster, masks clip, `emulsion-develop.webp`) still show the old 22 px
header tile; re-record if that matters. Not checked in the app: the Dock icon after relaunch (macOS
may cache the old one). Site, same session: sections are closer (`.sec` padding
`clamp(72px, 9vw, 128px)`, was 96/13vw/176), and the Download banner's image slot is gone (Oli tried
a Look Creator screenshot there and found it too short). The site commit carries the other site
session's Looks switcher, noise-reduction compare and masks card too. Videos are now committed
(`fdfabc3`): `site/.gitignore` ignores only `.mov`; hero-ui.mp4/.webm (2.7/2.4 MB)
and masks.mp4 (1.0 MB) are served by Pages. Posters are WebP (hero 273→107 KB, masks 305→152 KB;
`hero-ui-video.sh` now writes the WebP too) and the favicon is 64 px (184→5 KB). Still open: the
`og:image` is WebP (some link previews want JPEG/PNG).
Not committed (other sessions' work in progress): `src/backend/api.ts` and its test,
`src/library/stillclient.ts`, `src/engine/warm.test.ts`, `src/film/emulsion-looks.json` and
`builtin-looks.test.ts`, the README roadmap link and the RAW highlight recovery plan/research.

**Site Looks switcher (2026-11-12, committed with the icon):** the Looks section's six 4:5 placeholders are
now one 3:2 photo with look chips (`collection` in `site/src/components/Looks.tsx`; images in
`site/public/assets/looks/<id>-1200|2400.webp`, from Oli's full-size exports in
`~/Documents/emulsion-brand (1)/marketing-photos/Emulsion exports`, DSCF8412 and its copies).
Standard (Copy 2, a custom look named Emulsion Standard), Neg (the original), Chrome
(Copy 1) and Gold (Copy 3) are in; B&W Dynamic and B&W Classic (Copies 4–5) still need exporting,
then add their images and `img` ids. Looks without an image are left out.

Known, Oli said not to fix for now: the hero/perf tools leave scratch imports in his catalog
(the "Photos / 2025" RAM-disk import shows 13 Unreadable photos), and Sync can't remove missing
photos once a folder's drive is gone.

**AI Noise Reduction model download (2026-11-12, uncommitted):** beta users had no way to get
the RawNIND model (only `tools/denoise/setup.py`), and ticking AI Noise Reduction without it
dropped the photo to its embedded preview with an error. Now `noise_cache.rs` pins darktable-ai's
`rawdenoise-nind.dtmodel` (release-5.6.0, 57.7 MB, archive and model SHA-256) as an
`ai_models::Package` beside the mask/Remove models, sharing ONNX Runtime; `noise_model_status` /
`noise_model_install` (event `noise-model-progress`) follow the sky/Remove pattern. Lookup
order: `EMULSION_DENOISE_ASSETS`, the download, then the old setup-script folders, so existing
installs keep working. In the panel (`src/ui/NoiseReduction.tsx`, store `src/ui/noisemodel.ts`)
ticking it without the model shows a sized Download button instead of turning it on; after
the download it turns on if the same photo is still shown, and Develop reloads a photo whose
load failed for want of the model (`installs` counter in the load effect's deps). Checked: new
Rust lookup test; the real archive unpacks to the expected layout with the right model hash
(scratch test, removed); the GitHub URL returns 200 and 57,700,134 bytes; store tests; full
`npm run check` passes (879 JS, 131 Rust). Not checked in the app: the panel UI and a real
download. Oli didn't see the offer because his Mac still has setup-script installs, which the
lookup finds first (`~/Library/Application Support/app.emulsion.desktop/denoise` and, in dev
builds, `src-tauri/target/denoise/assets`); move both aside to see it. The Amount now starts at
100 when turned on (Oli, same day); saved edits keep theirs. README, NOTICE, release notes, ARCHITECTURE and tools/denoise/README updated.

**Site content and README (2026-11-12, uncommitted):** Oli asked what the site was missing.
Added `site/src/components/Looks.tsx` (after Why Emulsion: the six Emulsion looks as a strip of
4:5 `<Shot>` placeholders, then cards for Look Creator, the t3mujinpack/Pat David LUT packs, and
halation/glow/grain) and `Library.tsx` (after Local AI: import and cull, XMP interchange with
Lightroom, copies/presets/paste, export); both are in the nav. Download has a small note
(Apple silicon beta, Open Anyway) linking to the FAQ's `#install` answer, which opens itself on
arrival. New FAQ answers: which Macs, the macOS block, coming from Lightroom (XMP; Save
Metadata to File in Classic), data collection (updates and model downloads only), beta gaps,
bug reports. The README no longer leads with "film looks" and no longer names film stocks
(Oli: the app has moved on); the bundled LUT packs keep a trademark line. Site builds and
typechecks; screenshots checked at 1440 px. Not yet checked in a real browser: clicking the
Download note's "here's how" scrolls to and opens the install answer. Still open from the
review, not yet agreed with Oli: Foundations/Built on omit Spektrafilm and the AI
models; the FAQ says algorithms are ported "into its own Rust core" (most run as GLSL);
"Read the source and NOTICE" links to the repo root; the `og:image` is WebP.

**Beta release preparation (2026-11-12):** corrected `docs/release-notes/0.1.0.md` and the
README's built Looks list: Photo Match is removed; Look Creator test-photo previews and saving
copies are available. Committed the pending Chrome revision 20 tuning and original header
spacing adjustment with those corrections. `npm run check` passes (874 frontend tests, 130 Rust
tests, 20 ignored; typecheck and production build). Oli confirmed another session owns the
website; leave its site, Pages workflow, branding and header redesign changes to that session.
No push or release tag created. Next release steps: actual DMG installation/first-use checks,
then push/tag and publish the draft. Both updater signing secret names exist on GitHub; CI
has not yet run, so their values have not been validated by a release build.

**Marketing site in the repo (2026-11-12):** the landing page (React + Vite, from Oli's brand
folder) now lives in `site/` with its own `package.json`, and `.github/workflows/pages.yml` builds
and deploys it to GitHub Pages at mowerol.github.io/emulsion when `site/**` changes on main. Vite
`base` is `/emulsion/`, so paths into `public/` go through `asset()` in `site/src/site.ts`. To do:
set the repo's Pages source to GitHub Actions; upload the hero loop as a Release asset (no video in
git) and set `heroVideo.webm`/`.mp4` to its URLs; switch `downloadUrl` to `/releases/latest` once a release
is published; fill the `<Shot>` screenshot placeholders.

**App header matches the site's brand (2026-11-12):** the top bar shows the app-icon tile
(`public/brand/logo-tile.png`) and "Emulsion" as Geist 600 text, replacing the flat mark and the
wordmark SVG (see `docs/BRANDING.md`). The hero was re-recorded with the new header the same day
(one take; the 13 photos are the Emulsion Faves RAFs DSCF0151–DSCF1554 from 2025/JAPAN plus
2025/DSCF8579.RAF, with their sidecars). The loop files in `site/public/assets/` are git-ignored
and still need hosting as a Release asset before the live site can play them.

**Website hero video (2026-11-12, Oli approved):** the hero shows the real app with a scripted
real cursor (Oli's brief: the whole UI, the cursor working the sliders). On DSCF8579.RAF (Emulsion
Faves) it builds his edit: Choose look › Emulsion Neg, Exposure +0.75, scroll, Shadows +19, Refine,
Halation 13, Grain 31, every value landing exactly, 31 s loop. `node tools/marketing/hero-ui.mjs
<folder> <photo> survey|take <out>` runs a second dev app (port 1430) with its content at 1232 × 770
(16:10; the Dock caps the height on a 1440 × 900 screen); `src/dev/heroui.ts` (`VITE_HERO_UI`) opens
the photo in Develop on the starting edit (his edit on Emulsion Standard with those four at 0), resets
the panel tab and scroll, and streams the controls' layout; `tools/marketing/hero-cursor.swift` posts
real mouse events (eased arcs, scrubs past each value and back) while ffmpeg records ProRes, then
`tools/marketing/hero-ui-video.sh <take-raw.mov> <out>` cuts the loop at 1920 × 1200 and 2464 × 1540,
60 fps, H.264 + AV1. Use a folder on a RAM disk named Photos (`hdiutil attach -nomount
ram://1638400`, `diskutil erasevolume HFS+ Photos <dev>`, folder `2025/`) so the breadcrumb reads
"Photos / 2025"; each run records the folder as a catalog import. Ghostty needs Accessibility and
Screen Recording. Lessons: a background process can't activate an app on macOS 14+, so the cursor
clicks the window's title bar; ffmpeg runs with `-t 90` and is stopped on any failure (an orphaned
recorder once wrote 59 GB). An earlier photo-only loop (stills through each look:
`hero-stills.mjs` + `src/dev/herorun.ts`, `hero-video.sh`) missed the brief but remains for stills.

**Sluggish controls, scrolling and file switching (2026-11-12):** Oli
reported the whole Emulsion interface felt slow, specifically controls/scrolling,
then clicking between files. Do not explain this solely as external-drive latency.
Live measurements: Mac has 16 GB RAM, ~15 GB used and ~18 GB swap in use; Capture
One ~4.9 GB, Lightroom ~4.0 GB, two OM RAW Quick Look processes ~3 GB. Emulsion's
WebContent sample showed **2.6 GB current / 8.7 GB peak** footprint, ~2.1 GB graphics
allocation; native process ~207 MB / 2.1 GB peak. Both sampled idle during capture.
Latest collection trace (22,352 photos) took 8.17 s to refresh, with ~4.9 s of detected
main-thread stalls across the trace. System pressure compounds application work.

Confirmed UI bottleneck: Develop's `Images.tsx` mounted **every** shown tile,
thumbnail subscription and IntersectionObserver, unlike Library and Loupe's rail.
Changing the active file or a recipe also recreated the full collection's JSX.
It now uses existing `useViewport`/`rowWindow`/`scrollNearest` to mount nearby rows
only. Row height is measured, columns resize normally, marks have a reserved track
to keep the row pitch constant, and spacers preserve the full scroll range. Active
navigation reveals the photo; manual scrolling doesn't snap back to the active tile.
Existing tile selection/context-menu indices remain global photo indices.

Regression `src/ui/Images.test.ts` initially failed with 1,200 mounted tiles where
fewer than 80 were expected; it now passes, including far navigation and manual
scrolling at 1/2/3 columns. `images-grid scale` browser check exercises 20,000 photos,
last/first navigation, all three column counts, marked/unmarked row heights and
manual scrolling: **at most 36 mounted tiles**. Screenshot inspected:
`.scratch/images-windowed.png`. Full JS suite passed (872 at that run), followed
by two extra column cases (10 focused Images/virtual tests pass). Typecheck and
production build pass. No native changes for this UI fix. The unrelated preexisting
brand margin in styles.css and ongoing emulsion-looks tuning are preserved.

**Oli confirmed the fix in the app:** “ok immediately seeing speed again.” This is
qualitative confirmation, not a WKWebView FPS measurement or proof that the separate
collection-refresh stalls are eliminated. Read-only profiles:
`.scratch/slowdown-{native,webcontent}.sample`; build/test logs prefixed `slowdown-`.

**First-open preview delay (follow-up, 2026-11-12):** Oli clarified
that “Loading preview” is slow on a photo's first open, with Japan `DSCF2529.RAF`
as the example. Cold external-drive reads are substantial and variable: a normal
sequential read of adjacent `DSCF2530.RAF` (56.4 MB) took 9.98 s; `DSCF0008.RAF`
(59.3 MB) took 23.38 s with macOS F_NOCACHE and 9.07 s with ordinary reads, versus
0.034/0.018 s for the same bytes on the internal disk. 2529's full native decode
took 9.34 s; once cached, its 1536 px preview took 0.36/0.29 s. A separate real
preview test on 2531 took 1.93 s, then 0.59 s. These are diagnostics, not a measured
before/after application speedup; the original intermittent UI delay isn't fully
reproduced by a warmed file.

Confirmed and fixed competing work: `photo-opening` now holds a foreground RAW
read and asks for a ready edited thumbnail. Before the fix its RAW decode starts
against the selected photo's read (FAIL). `ThumbStore.pauseDevelopment` now defers
queued edited-thumbnail jobs during the active preview decode; embedded JPEG fetches
continue, and an already-running native decode cannot be interrupted. Develop releases
the pause on success, failure or navigation; overlapping releases are idempotent.
The test passes in both main and worker modes, including resumption afterward.
No metadata batching or processing algorithm changes were made. Native drive wait
remains; do not describe all first-open delay as solved.

Diagnostics kept: ignored `decode::tests::preview_decode_timing` (set
`EMULSION_RAW_SAMPLE` to a read-only RAW, `cargo test preview_decode_timing -- --ignored
--nocapture`). `tools/perf/inapp.mjs` could not enter Develop since Enter now opens
Loupe, and synthetic Enter targets window (its `closest` call throws); `perfrun.ts`
now sets Develop directly. The scratch RAF then opened successfully in WKWebView;
decoded metadata publication cost ~10 ms there with one active photo. Temporary
`[DEBUG-preview]` logs were removed. Full `npm run check` passes: 871 JS tests,
130 Rust tests, 20 ignored; browser opening, saved Remove and missing-patch rebuild
checks pass. Timing artifacts: `.scratch/japan-2529-{native,preview}.log`,
`.scratch/japan-2531-preview.log`, `.scratch/first-open-baseline-2.log`.

**Photo opening / blank Remove thumbnails (2026-11-12):** Oli reported
photos stuck opening in **Develop** and thumbnails appearing only after other edited
thumbnails caught up; example `PA070671.ORF` in Portugal has a saved Remove spot.
Two reproducible stalls are fixed: `Develop.tsx` now starts the real decode alongside
the embedded-thumbnail request, rather than waiting for the thumbnail fetch queue;
late JPEG decodes cannot replace an already displayed RAW, and canceled RAW loads
do not publish metadata or upload pixels. `ThumbStore.pump` only selects jobs whose
original bytes have arrived, and `original` wakes it on arrival, so one slow embedded
read no longer blocks a ready Remove thumbnail (whose camera original stays hidden).
No processing algorithms or saved edits changed.

Regressions observed failing before their fixes: `node tools/browser-tests/realtime.mjs
photo-opening 15` (RAW decode never started behind four held thumbnail reads), and
`npx vitest run src/library/thumbs-remove.test.ts -t 'restores a ready Remove'`
(ready Remove thumbnail stayed undefined behind an earlier held read). Both pass.
`photo-opening` also tests a late JPEG completion, and passes in main and worker modes.
`remove-first` passes with saved patches and its new `missing` query (one full-resolution
rebuild, then a cached return; no original flash). `npm run check` passes: 871 JS tests,
130 Rust tests, typecheck and build; 19 native tests ignored.

The reported photo was checked read-only: native half/full dimensions agree at
5220×3912, decode succeeds (~0.44–0.55 s for 512/2000 px), and its current Remove
patch key `1840581e8465320d5bf9eec0fec3` exists. A scratch replay of its actual decoded
pixels, recipe, patch and capture metadata displayed both Develop and thumbnail
in main/worker Chrome (~0.6–0.7 s, excluding native reads). Captured debug assets are
in ignored `.scratch/remove-replay/`; temporary native probe and diagnostic test
were removed. The original intermittent delay on this specific photo was not
reproduced. Remaining real-app check: Cmd+R, reopen PA070671.ORF in Develop while a
large folder's thumbnails are loading, and check scrolling to other edited photos.

**Tone curve (2026-11-12, uncommitted):** `src/ui/CurveEditor.tsx`. Delete/Backspace remove the
*selected* point: clicking or adding a point selects it (filled) and focuses the graph, which owns
the keys (arrows move it, Escape lets it go) and stops them reaching the photo shortcuts.
Double-click removes the point under the cursor; it is handled on the graph because pointer
capture sends the double-click there, which is why it never worked on the point. No WebKit focus
ring on a clicked point (`:focus` outline off; keyboard focus still thickens the stroke).
A **curve presets** icon in the section heading, before Reset (`CurvePresetMenu`; `Section` takes
`actions`, shown while open), opens a menu like the Presets panel's: Linear, the built-ins Subtle
S-curve and Subtle S-curve fade (`src/film/curvepresets.ts`, master curve only, points in its
comments), then **My presets** (every saved preset whose only group is Curve), a tick on the match,
and **Save curve as preset…**, which turns the menu into a name field with Back and Save. The folded
section's summary names the match (or Custom, Straight). The Red, Green and Blue graphs are tinted like Lightroom
Classic: channel colour above the diagonal, opposite (cyan, magenta, yellow) below, labelled in the
corners. Tests: `curvepresets.test.ts`; browser `curve-editor` (PASS; `screen=naming`, `screen=saved`).
Same session: the stage tab is now named **Metadata** (was "Keywords and Metadata", whose tooltip
ran off the window), and the first and last stage tabs anchor their tooltips inside the panel.
Not checked in the app: real clicks, double-clicks and Delete in WKWebView, the menu near the
panel's bottom, the built-ins on real photos, the Metadata tab tooltip.
**Selects (same session):** Oli chose to restyle the closed control only (the open list stays the
native macOS popup). One `select:not([multiple])` rule near `select { accent-color }` in styles.css
gives every closed drop-down the buttons' surface (`--ctl`, `--border`, 6 px radius, `--hover`), and a
chevron from `--select-chevron` (one per theme). The ~12 per-place rules now set only size and layout
(the Masks shape select stays compact; the Library source dialog stays taller); the Develop panel's
underlined selects and the preset sheet's are gone. The canvas bar's zoom level keeps its bare
toolbar style. Checked by screenshot in mid, light and dark. Tooltips now take `width: max-content`
(WebKit sized an end-anchored tip to its grid button: the curve presets tip was squeezed) and are
hidden on a button whose menu is open. Not checked in the app: Export, Settings, Library source and
Look Creator selects.

**Folder opening (2026-11-12):** Oli flagged the blocking “Reading photos…” screen
on both first imports and return visits. `openFolder` now displays imported photos from the
catalog immediately and refreshes sidecars behind the grid, preserving selection/range anchor,
Develop/Loupe, undo and edits/version changes made during the scan (including edits when leaving
before the refresh completes). First imports receive complete, naturally sorted photos through
a Tauri Channel: 24 in the first batch, then 256 at a time. Thumbnails and selection work while
the remaining scan runs; Import waits for completion. Cancellation, superseding navigation and
late Channel deliveries are guarded; a failed partial import restores the prior source.
`library.rs` groups XMP ownership checks by folder AND stem instead of comparing every photo
with its whole folder. The 2,000-file synthetic scan went from ~360 ms to ~91 ms total, with its
first batch at ~55 ms (local file/sidecar work, not RAW decoding). A read-only native scan of
the actual Portugal folder on Oli External found 3,006 photos: first batch ~158 ms, complete
~238 ms. Reproduce with `EMULSION_SCAN_FOLDER='<folder>' cargo test library::tests::scan_timing
-- --ignored --nocapture` from src-tauri; without the environment variable it uses the fixture.
`npm run check` passes (863 JS tests, 130 Rust tests at that run; additional opening regressions
also checked). `tools/browser-tests/folder-loading.tsx` holds scan responses and checks both
paths, thumbnail arrival, selection and Import gating; `screen=import` leaves it partially
loaded for screenshots. Browser checks pass at 1200×800 and 960×720. The existing
`library-handoff screen=reopen` scenario still reaches photo 64 (its legacy JSON result makes
realtime.mjs exit 1 despite `passed: true`). Remaining real-app check: first open and return to
a large folder on the external drive; native scan timing excludes thumbnail decoding and
WKWebView rendering.

The flags, Select sky, open-source map, export dialog grid, renamed Emulsion looks and Library
Grid/Loupe with its vertical carousel are committed. Library import/sync, metadata, collection
performance fixes and the Import toolbar removal landed in `19bddf2`. Older "Uncommitted" notes below are out of date.

**Current priority (Oli, 2026-11-11): release essentials.** Done: catalog in SQLite (`eec5545`),
ad-hoc-signed beta pipeline (`cb03cc5`), log file (`6874aed`), the **updater** (committed,
below), and the repo is now **public**. Branding (`02ca26d`, docs/BRANDING.md) and the
built-in look tuning (`637d9c8`) are committed too. Agreed order for the rest:
Oli's in-app checks, then the first-launch pass, then release notes
(`docs/release-notes/<version>.md`, now required by the build) and the version bump last.
Exports remain the feature priority after release work.

**Oli's in-app checks (2026-11-11):** passed: Library grid (second large folder scrolls to the
end), new Dock icon, Check for Updates, the header mark in the Export button's `--accent`, and
the new **Purple** label (fifth Lightroom colour, no key; XMP `Purple`). Both of those small
changes are uncommitted. **XMP sidecars** pass too; a pick doesn't reach Lightroom, as expected
(XMP has no pick field and Lightroom keeps flags in its catalog). Oli kept it that way. All in-app
checks are done.

**First-launch pass (2026-11-11, uncommitted):** `tools/browser-tests/first-launch.tsx` mounts the
whole app on an empty catalog and fresh profile (`SHOT=out.png node tools/browser-tests/realtime.mjs
first-launch 20`). Found: an empty library had no visible way in (the toolbar Import button was
removed; only File › Import…, Cmd+I or Folders ⋯). The empty state now has **Import Photos…**
(`chooseFolder`, as File › Import…) and a hint naming Cmd+I and the Dock. No startup errors.
Install is covered by `tools/release/INSTALL.txt` (Open Anyway) and the translocation message.
Not checked headlessly: Open Anyway from a real dmg, macOS folder-access prompts, AI consent on
first use.

**Release notes written (2026-11-11):** `docs/release-notes/0.1.0.md`, plain text (the update
dialog shows it raw; CI puts it under INSTALL.txt on the release page). AI Noise Reduction is
left out until it's confirmed to work without manual model setup; reports go to GitHub Issues.
INSTALL.txt no longer says edits are XMP (edits are `.emulsion.json`; XMP carries stars, labels,
keywords). The README feature list is stale (film stocks, scanner profiles). Next: the beta ships
as 0.1.0 (no bump needed); Oli re-enters `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, then tag `v0.1.0`. Committed work is not pushed until
Oli says "push"; CI only runs from a pushed `v*` tag.

**Photo match removed (2026-11-12, uncommitted):** Oli called it "a bit of a disaster" and, after a
measured attempt to rebuild it on the look's controls, parked it for v2 ("perhaps something we do with
spektrafilm"). The Look Creator's left column is now only the base LUT (no LUT/Photo match switch).
Deleted: `PhotoMatchPanel.tsx`, `film/photomatch*.ts` and its worker and tests, `library/photomatch.ts`
and test, `storePhotoMatch`, the `photo-match` browser test, its CSS, and the README/PRODUCT/NOTICE/
OPEN_SOURCE entries. Kept so saved looks render: `photoMatch` on file LUT sources (`creative.ts`,
`looks.ts`, `userlooks.ts`), its label in `LookLutSummary`, and its filter in `TreatmentBrowser`.
`lookEdit.matching` in `store.ts` is now never set (left alone: another agent was editing store.ts);
its guards in `LookCreator.tsx`, `LookTestStrip.tsx` and `moveLookEdit` can go. Findings, numbers and
v2 ideas: [docs/plans/photo-match.md](docs/plans/photo-match.md); the attempt and its ground-truth
harness are in ignored `.scratch/photo-match/v2-controls-attempt/`. Not checked in the app: the Look
Creator's left column (Oli: open Build Look, check the Base LUT column and that a look saved from a
photo match still opens and shows "Photo match").

**Look Creator test photos (2026-11-11, uncommitted):** a strip under the Look Creator's preview
(`src/ui/LookTestStrip.tsx`) shows the draft on the photo being edited plus 5 others: pins first,
then one per other camera, then a spread over capture time (`src/library/testphotos.ts`). The
source is the open photos, any Library folder or a collection; pins and source are in
settings.json (`emulsion.lookTestPhotos`), folding in localStorage. Clicking a tile moves the
draft and its undo history there (`moveLookEdit`).
Since 2026-11-12 every look draft starts **as shot** (Oli): `defaultRecipe('neutral')` plus the look, none of the photo's exposure, WB or tones (`begin` in TreatmentControls, test `src/ui/lookdraft.test.ts`), so the draft is the same recipe on every test photo and moves unchanged. The footer under the preview has a **Preview exposure** slider (−3 to +3 EV): it is the draft's `exposure`, which `settingsFromRecipe` never saves, `lookEditDirty` ignores, the test photos don't show, and `moveLookEdit` resets. The Save menu has **Save as copy and apply** for an already saved look (custom or built-in): a new custom look named "<name> copy" (or the name given this session), applied; the original is untouched. A photo from elsewhere joins `photos` only while the draft is on it, and ending on one returns
to the starting photo. Renders go through the stills worker (`src/ui/photorenders.ts`), wait
180 ms after edits and while any pointer is held. Tests: `testphotos.test.ts`,
`store-testphotos.test.ts`, browser `look-tests` (PASS). Perf: one valid PROD run on 3 ORF + 3
RAF: controls 59.4/60.1 fps, 0 stale, but one 44 ms frame in the Contrast drag (folded: 24 ms);
strip first fill 4.0 s. Photo fps wasn't captured (fixed since: the driver now re-hooks the Look
Creator's engine client, `perfrun.ts` `look` scenario). Later runs failed to open any photo,
even a plain `sliders` run, so they need re-running on an idle Mac:
`PROD=1 node tools/perf/inapp.mjs <3 ORF + 3 RAF> look`. PRODUCT.md (impeccable) is new.

**Release LUT cleanup (2026-11-11, uncommitted):** bundled looks are now Emulsion, t3mujinpack
(8) and Pat David's black & white and negative sets (121: B&W 25, colour negative 13, newer 39,
older 44). PictureFX and Pat David's colour slide and instant sets are deleted (files,
catalogue, `picturefx` PackId, Look browser folders, NOTICE/README/RELEASING/OPEN_SOURCE).
Saved edits that used a removed look fall back like any unknown pack. Same session: Develop's
Images pane defaults to 3 columns (a saved choice is kept), and the Library's RAW+JPEG `×2`
badge is gone (it read as a virtual copy). `npm run check` passes. `tools/browser-tests/library.tsx`
was already failing at HEAD: its invoke mock returns `[]` where `diskChanges` expects a listing
object. The Dock shows "emulsion" only in the dev build (bare binary); the bundle's
CFBundleName is "Emulsion".

## Library grid stopped after ~30 photos (fixed 2026-11-11, uncommitted)

After opening one folder with photos and then another, the grid showed only the first rows and empty
space below. `useViewport` (`src/ui/virtual.ts`) kept its scroll listener on the scroller that the
"Reading photos…" state had unmounted, so the row window never moved. It now follows the element
itself. Regression: `node tools/browser-tests/realtime.mjs library-handoff 60 screen=reopen`
(fails without the fix, 15 of 64 mounted). Oli should check in the app: open one folder, then
another large one, and scroll to the end.

Same session: thumbnails of older (already cached) folders never appeared after scrolling a large
uncached RAW folder. `ThumbStore` fetched in arrival order through 4 slots and never dropped a
request, so hundreds of slow embedded-preview reads (~8/min on the external drive) sat ahead of
disk-cache hits. Now frames register while on screen (`watch`/`unwant` in `useThumb`), a queued
fetch whose frame left the screen is dropped (not marked failed), and the newest is served first.
Direct callers (Develop, photo matching, tile renders) pin their fetch so it is never dropped.
Tests: `src/library/thumbs-queue.test.ts`. Not yet looked at: why RAF previews read so slowly.

## RAW brightness audit — next editing task (Oli, 2026-11-11)

Oli reports that the same creative look gives different **brightness/contrast** on Fuji and OM-3
**RAW files**. The agreed next investigation is the shared RAW input path, before tuning the
creative looks further. This investigation has not started beyond a source/metadata inspection;
no new exposure-normalization algorithm or correction has been implemented.

**Requirement:** this must scale across cameras without Emulsion maintaining hand-tuned exposure
offsets or users calibrating each body. The earlier suggestion to calibrate Fuji and OM-3
individually is superseded. Oli has no matched RAW pair; do not block the general investigation
on taking new photographs. Matched scenes would help validate exact agreement later.

Next steps:

1. Build a repeatable diagnostic using existing RAWs and controlled fixtures. Trace sensor black/
   white-level scaling, white-balance gains, dynamic-range modes and usable exposure/baseline
   metadata through to scene-linear working RGB, immediately before the shared tone curve.
2. Identify missing or incorrect normalization supported by that evidence. Use the file/decoder's
   existing camera data and general rules, with defined fallbacks when metadata is absent. Do not
   assume one fixed gain is the cause or blindly undo intentional exposure compensation.
3. Fix confirmed issues, then validate preview/export agreement and preserve existing saved edits
   (version changed rendering/cache identities if necessary). Assess Standard's tone only after
   establishing the input scale. Unmatched photographs cannot prove an exact cross-camera match.

Start in `src-tauri/native/raw_shim.cpp` and `src-tauri/src/raw.rs`, then the input/tone shader
stages. Currently LibRaw supplies 16-bit linear camera RGB, with as-shot WB, automatic brightening
disabled and highlight clipping enabled; Rust applies the standard camera matrix and a shared
`BASELINE_GAIN = 1.8`. LibRaw has DNG `baseline_exposure` metadata (with an absent-value sentinel),
but the shim's `EmuRawInfo` does not expose it. Check availability and semantics across formats
before treating any metadata field as a general solution. Existing decoder camera support is
allowed; an Emulsion-maintained calibration per camera is not the proposed architecture.

**Auto Exposure is separate:** a camera-independent image-analysis algorithm can adjust a series
toward comparable brightness, but makes a scene-dependent decision. Do not silently add it to
input normalization or force intentionally dark scenes toward middle grey. Its port choice is
still open in the README roadmap.

Completed in this conversation, currently uncommitted:

- **Library sidebar headings** (Recent imports, Collections, Folders) now match Develop's section
  headings: 13px semibold sentence case, 40px rows, 14px muted chevron (were 11px tracked uppercase,
  32px, 12px chevron). Develop's Images header matches them too (40px
  row, not 48px; chevron 14px in; title weight 600, not `<strong>`'s 700). Probe view
  `?sectionheads&theme=<mid|light|dark>` shows all three side by side.
- **Top bar** is the compact 44px Library bar in every view (Develop's was 56px on `--app`); the
  former `.topbar-library` rules now apply to `.topbar`. Only `body:has(.topbar-library)`'s
  960px min-width stays Library-only. The Look Creator's `.look-header` matches it too (44px, panel background,
  12px 30px-tall buttons). Probe:
  `?sectionheads=topbar&view=<library|develop>`.
- **Emulsion Standard** is first in the official Emulsion collection and the default for new edits.
  Its settings (2026-11-12, revision 2) are Oli's own custom "Emulsion Standard" look (revision 15
  in his app data, `looks/6ee77537-….json`): colour balance, an RGB curve and colour equalizer
  moves. Before that it was empty, i.e. the neutral rendering. No new camera normalization. Saved legacy recipes keep their prior look/neutral fallback.
  Photo matching, perspective analysis and look-authoring bases explicitly use Neutral.
- Colour grading: clearer labels, an actual tonal-mask graph, and **independent local range tabs**
  for the wheel and Colour & brightness. The intermediate single-selector design was rejected
  because the lower controls required returning to the wheel tabs. Retain the local tabs.
- Latest checks: `npm run build`; `npm test` (**853 passed, one skipped**);
  `node tools/browser-tests/realtime.mjs treatment-filters 30` (passes, including the Standard
  default and official collection). No native tests were rerun for these frontend changes.
  The grading browser fixture is `grading-tones` (`builtin` query exercises Emulsion Neg);
  its selector, pixel-change and saved-settings checks passed before the Standard addition.
- Preserve concurrent in-app tuning in `src/film/emulsion-looks.json`. Do not restore the whole
  file to undo another change. The general direction is also recorded in
  [the grading plan](docs/plans/colour-grading.md#standard-rendering-direction-oli-2026-11-11).

## New branding (2026-11-11, committed `02ca26d`)

Oli's replacement kit is `/Users/oli/Documents/emulsion-brand (1)` for the header, app icon
and related surfaces. The app includes its own assets in `public/brand`; the external
folder is not needed at runtime or when regenerating icons. See `docs/BRANDING.md`.

- Header: supplied orange photo/E mark and custom vector wordmark, replacing the plain
  text title in Library, Import and Develop. Wordmark uses a CSS mask (including the
  WebKit prefix) for paper lettering on mid/dark and ink lettering on light. Accessible
  name remains Emulsion. Editor neutral surrounds and control accents are unchanged.
- Replacement kit: revised mark/lettering and paper/ink palette (`#FAFAFA`/`#36393F`)
  are in the header. App icon is the actual supplied `logo/icon-app.png`, copied intact
  to `public/brand/app-icon.png` and `src-tauri/icons/source.png` (SHA-256 matches), also
  used as the browser favicon. The earlier constructed `app-icon.svg` was removed.
  All desktop PNG/ICO/ICNS/Appx assets regenerated. `swift tools/generate-icons.swift`
  starts with the supplied PNG, contains its 809×820 canvas within square desktop outputs,
  and retains the 848px macOS tile size on a 1024px transparent canvas.
- Checked before the replacement: `npm run check` passes (852 TS tests, 129 Rust);
  full Library import/sync fixture passes. After replacement: icon generation and
  `npm run build` pass; headless rendered checks of
  Library, Import and Develop headers across all three themes at 1200/1440px show no
  overflow. Screenshots in `.scratch/branding/new-header-*.png`.
- Native Dock/Finder appearance needs a rebuild/relaunch; not checked in the native app.
  This supersedes the previous dark tile icon artwork, including its uncommitted version.

## Updater, and the repo made public (2026-11-11)

Oli decided the whole project goes **public** (GPL: testers must get the source anyway), so
builds live on `mowerol/emulsion`'s own Releases page. The short-lived `emulsion-releases` repo
was deleted; Oli should also delete the fine-grained token he made for it on GitHub. Full write-up in `docs/RELEASING.md` › Updates.

**History rewritten for going public (2026-11-11):** Oli's Gmail replaced by
`19540488+mowerol@users.noreply.github.com` as author and committer on all 122 commits
(filter-branch in a mirror copy; trees identical); repo `user.email` set to the noreply address.
Commit hashes changed (e.g. `bb0f25e` → `6874aed`); own-hash references in docs were updated.
Old history backed up at `~/Documents/Emulsion/emulsion-history-before-email-rewrite.bundle`.
GitHub repo **deleted and recreated public** (https://github.com/mowerol/emulsion) with the
cleaned history, so the old Gmail-stamped commits aren't reachable there; checked all commits
on GitHub show the noreply address and old IDs return "No commit found".

- `tauri-plugin-updater` 2.14 (Rust + JS), `updater:default` permission, endpoint
  `https://github.com/mowerol/emulsion/releases/latest/download/latest.json`,
  `bundle.createUpdaterArtifacts: true`. `plugins.updater.pubkey` is Oli's key (minisign id
  A684A15F696D0836, private half at `~/.tauri/emulsion-updater.key`, regenerated 2026-11-11 after the first one was pasted in chat).
- `src/library/updates.ts` (+ 8 tests): manual check, automatic check in released builds ~8 s
  after launch at most once a day (setting `emulsion.updates`: automatic, skipped, lastCheck),
  Skip This Version silences automatic checks only, friendlier errors (translocated app →
  "move to Applications"). `src/ui/UpdateDialog.tsx`: checking / up to date / available with
  notes / downloading with progress / installed → Relaunch / error.
- Relaunch: `saveAndRelaunch` (CatalogBackupDialog.tsx) flushes sidecars, catalog, settings, no
  backup prompt (the new version's upgrade snapshot covers library.db), then `relaunch_now`
  (quit.rs: approves the quit, `request_restart`).
- Menu: Emulsion › Check for Updates…; Settings › Updates (toggle + Check Now…).
- `build.sh`: needs the pubkey, signing key (`TAURI_SIGNING_PRIVATE_KEY` or
  `~/.tauri/emulsion-updater.key`, password from env or a prompt) and release notes (clean
  builds); writes `.app.tar.gz`, `.sig`, `latest.json` (`tools/release/latest-json.mjs`).
  `TAURI_CONFIG` can supply a trial pubkey. CI drafts the release on this repo; publishing the
  draft makes it live.
- **Checked:** `npm run check` passes (852 TS, 129 Rust). Trial `npm run release -- --dirty` with a
  throwaway key (via `TAURI_CONFIG`): builds, verifies, writes dmg, 31 MB `.app.tar.gz`, `.sig`,
  `latest.json` (URL and signature right); the app embeds the endpoint and key; the `.sig`
  verifies with `minisign-verify` (the updater's crate) and a one-bit change is rejected.
  Trial files and key deleted.
- **Set up (2026-11-11):** secret `TAURI_SIGNING_PRIVATE_KEY` re-added on the recreated repo;
  **`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` must be re-entered by Oli** (CI uses `github.token` for the release). CI not yet run.
  **Not testable headlessly:** a real update needs two published versions; first try
  Emulsion › Check for Updates… in the dev app (expect "Couldn't reach the update server" until
  a release is published), and the Settings › Updates section.

## Library catalog in SQLite, with backups on quit (2026-11-11)

Why: the folder index (3,774 photos, 4.73 M characters) sat in localStorage at WebKit's ~5 MB
quota, behind `catch {}` that would silently stop saving; which files were imported
(`emulsion.folderImports`) lived only there, outside settings.json and the daily backups; every
edit rewrote the whole index (the dev origin's WAL was 63 MB).

- **`library.db`** in the app data folder (rusqlite 0.42, SQLite bundled; `src-tauri/src/catalog.rs`).
  Tables `roots`, `photos` (one row per photo per folder: folder, path, copy id, position,
  the `Photo` JSON), `folder_imports`, `kv` (imports, collections, target). Schema in
  `user_version` (1); a newer catalog is refused. `library/catalogdb.ts` loads it in `main.tsx`
  and, the first time, moves localStorage's index and import choices and settings.json's
  `emulsion.libraryCatalog` into it, then deletes those. `CatalogDiff` sends only changed rows.
  If the catalog can't be opened, a native message says so and nothing is written. Outside the
  app, everything is unchanged (localStorage), so existing tests run as before.
- **Measured** (`EMULSION_CATALOG_INDEX=<json> EMULSION_CATALOG_SCALE=n cargo test --release
  catalog_scale -- --ignored --nocapture`, Oli's real index): 3,774 photos: first write 32 ms,
  load 14 ms, one edit 0.05 ms, backup with integrity test 68 ms, 7 MB db. ×14 (52,836): first
  write 0.42 s, load 0.2 s (66 MB of JSON to the page), one edit 0.08 ms, backup 0.9 s, 97 MB db.
  The page still holds the whole catalog in memory and parses it at launch: the next scale step.
- **Backups (Lightroom Classic's model):** every quit (⌘Q, Dock, logout, the close button)
  runs `requestQuit` in `ui/CatalogBackupDialog.tsx`: save sidecars and catalog, offer a
  backup when due (Every time / daily / **weekly default** / monthly / Never), then `quit_now`.
  `src-tauri/src/quit.rs` adds `applicationShouldTerminate:` to tao's delegate class (tao has
  none, so ⌘Q used to end the app at once): it cancels and emits `quit-requested` until the page
  approves; no acknowledgement in 4 s quits anyway. A logout gets cancelled once (repeat it).
  Backups are `Emulsion Catalog YYYY-MM-DD HHMM.zip` (`VACUUM INTO`, zipped) in
  `~/Pictures/Emulsion/Backups` by default; newest 10 kept; optional integrity test before and
  optimise after (both on, like Lightroom). Restore checks the zip, keeps the current catalog in
  `<data>/backups/catalog/`, swaps and reloads. Menu: Emulsion › Back Up Catalog…, Restore
  Catalog from Backup…, Show Catalog Backups in Finder; Settings › Catalog. Daily/upgrade
  snapshots now include `library.db`.
- **Checks:** `npm run check` passes (844 frontend, 125 Rust). New tests: `catalog.rs` (7:
  order, upsert/delete/copies, bad JSON rolls back, newer refused, backup/restore/prune,
  restore refuses junk, snapshot) and `catalogdb.test.ts` (8: migration, freeze on failure,
  diff). Probe `?backupdialog&theme=` screenshots the quit dialog (dark and light checked).
- **In-app check (Oli, 2026-11-11):** Back Up on quit completes and the app closes. Verified
  `Emulsion Catalog 2026-11-11 1515.zip` in Pictures/Emulsion/Backups: ZIP and SQLite integrity
  checks pass. The quick exit is expected: this backs up the catalog, not the photo files.
- **Remaining checks (needs the app; Oli should try):** first launch migrates his library: the
  Library should show the same folders, imports, collections and counts as before (the dev
  origin's localStorage is the one with the index). Also try the red close button, Dock › Quit,
  Skip this time, Return to back up, a look draft open
  (quitting is refused with a toast), Restore Catalog from Backup… (reloads, same library), and
  the Settings › Catalog section.
- **Notes:** `tools/perf/inapp.mjs` ends its app with SIGTERM, so the prompt never blocks it,
  but its second app now writes into the same `library.db` (it shared settings.json before,
  not localStorage). The production build and the dev app share the database too.

## What remains before a release (Oli asked, 2026-11-11)

Oli chose an **ad-hoc-signed beta** (no Developer ID, no notarisation) and asked to ship only
LUTs with explicit licences.

1. ~~Signing~~: ad-hoc, done (below). 2. Updater: built (above), needs Oli's key and
   the releases repo. 3. ~~Build pipeline~~ (below); release notes still to write, version
   still 0.1.0. 4. Apple Silicon only (ONNX Runtime is arm64-only); the testers' note says so.
5. ~~LUT licences~~: every bundled pack has an explicit licence (gmic-film CC BY-SA 4.0,
   picturefx legacy CC BY-SA 4.0, t3mujinpack MIT), so nothing was removed; local-looks
   never ship (checked by the script). 6. ~~Catalog~~. 7. In-app checks of the recent
   "Oli should try" items, XMP sidecars first. 8. ~~Crash/error log file~~ (below).
   9. First-launch pass.

## Log file for testers (2026-11-11, committed `6874aed`)

- **`src-tauri/src/applog.rs`**, installed first thing in setup: `~/Library/Logs/app.emulsion.desktop/Emulsion.log`
  (Tauri's `app_log_dir`). fd 2 is redirected into a pipe; a thread stamps each line with local
  time, appends it to the file and passes it on to the original stderr, so `tauri dev` and
  `tools/perf` (which parse `PERF` lines) see the same output as before. So every existing
  `eprintln!`, the webview's errors (`main.tsx` error/unhandledrejection → `log_message`) and
  native stderr (LibRaw, ONNX Runtime) are logged without changing call sites. Each launch
  writes a header (version, dev/release, macOS version, arch, pid).
- **Panics:** the hook writes the message, place, thread and a backtrace straight to the file
  in one write (release is `panic = "abort"`, so the copying thread wouldn't get the chance).
  Native crashes (signals) aren't caught; macOS writes those to `~/Library/Logs/DiagnosticReports`.
- **Size:** moved to `Emulsion.old.log` past 8 MB, at launch or mid-session.
- **Help › Show Log in Finder** (`show-log` in `photoMenuAction`, command `show_log`) reveals it.
- **Tested:** `applog` tests, including one that runs `install` in a child test process and
  checks an `eprintln!`, a raw `write(2)` and a panic all land stamped in the file and still
  reach the terminal. `npm run check` passes (844 TS, 129 Rust).
- **Oli should try:** Help › Show Log in Finder in the dev app (Finder opens with Emulsion.log
  selected; it should hold a `=== Emulsion 0.1.0 (dev) started…` line and the session's
  `[backups]`/`[webview:…]` lines); terminal output in `tauri dev` should look unchanged apart
  from arriving through the pipe. The perf tool and the dev app both append to the same file.
- **Not done:** console.error/console.warn aren't forwarded (React warnings would be noisy);
  no log level filtering; no in-app "send report".

## Release pipeline: ad-hoc-signed beta (2026-11-11)

- `tauri.conf.json`: targets `app`, `dmg`; `macOS.signingIdentity "-"`, `hardenedRuntime
  false` (library validation needs a Team ID and would refuse the downloaded ONNX Runtime).
- `npm run release` (`tools/release/build.sh`): refuses a dirty tree (`--dirty` for trials),
  mismatched versions (package.json/tauri.conf.json/Cargo.toml) or missing libomp; runs
  `npm run check` (`--skip-checks`); builds aarch64; then verifies ad-hoc signature,
  arm64-only, system-only linked libraries, static OpenMP, no local-looks file in dist, a licence
  file in each LUT pack. Writes `release/Emulsion-<v>-arm64.dmg`, `.sha256`, `INSTALL.txt`
  (from `tools/release/INSTALL.txt`: Open Anyway steps, `xattr` fallback). `/release/` is ignored.
- `.github/workflows/release.yml`: on a `v*` tag (or by hand), macos-15 runner, checks + the same
  script, draft GitHub release with the dmg. **Not yet run** (needs a push); private repo, so
  macOS minutes count 10×.
- `docs/RELEASING.md`: how to cut a build, the checks, signing choices, LUT licence table.
- **Verified locally** (`--dirty`, uncommitted icons/looks): checks pass (844 frontend, 125
  Rust), 31 MB dmg, mounts with Emulsion.app + Applications link, signature verifies from
  the dmg, `spctl` rejects as expected for ad-hoc (testers use Open Anyway). The built app was
  not launched (it shares `library.db` with the dev app).
- **Oli should try:** open `release/Emulsion-0.1.0-arm64.dmg` on another Mac or user account
  (or after downloading it, so it is quarantined) and go through Open Anyway; open a RAW;
  try an AI feature (ONNX Runtime loads without the hardened runtime).

## Smart collections at 0 were not a bug (2026-11-11)

Oli saw smart collections at 0. Checked against his real catalog with the app's own counting
code: OM-3 3,064, while Xt (5★ X-T30) and Hi (3★ + Picked) really match nothing among the 3,768 imported
photos. The 5★ X-T30 frames are in `2025/JAPAN`, which was never imported. Smart collections and
the Folders sidebar (`importedTree`, since `19bddf2`) both cover imported photos only, Lightroom-style;
Oli confirmed he likes that model. No code changed.

## Export: embedded sRGB ICC profile (2026-11-11)

Committed on Oli's request (`src-tauri/src/export.rs`, `src-tauri/data/sRGB2014.icc`, notices and docs).
Oli requested automatic sRGB ICC tagging; no export-dialog setting is needed.

- Every JPEG, PNG and TIFF embeds ICC's unmodified sRGB2014 v2 profile (February 2015
  revision), including 8/16-bit PNG/TIFF and uncompressed/LZW/ZIP TIFF. Bundled with
  `include_bytes!`; no runtime download or new dependency. Source, licence and SHA-256
  are in `NOTICE.md`. The profile identifies the GPU's existing sRGB output; pixels are
  not converted again and the original's profile is not copied.
- ICC embedding happens in the encoder before the existing metadata write and atomic
  placement. It is independent of Include and person/location removal, so copyright-only
  exports still carry their colour profile.
- Validation: `npm run check` passed (836 frontend tests, 118 Rust; 1 skipped/17 ignored).
  After replacing the initially generated profile with the published ICC binary, the full
  Rust suite passed again. The new regression writes and reads 45 combinations (nine
  format/depth/compression choices × no metadata plus all four Include choices), starting
  with a Display P3-tagged source. It verifies the exact embedded profile, parses it with
  moxcms and checks lossless pixels/bit depth after metadata writing.
- Profile choice: macOS `sips --verify` flagged a non-D50 header white point in the initially
  generated moxcms profile, so the final implementation uses ICC's published asset unchanged.
  `sips --verify` reports only non-null header padding on that upstream v2 asset (its profile
  ID occupies bytes 84–99); it has the standard D50 header white point.
- Readback note: the test reads TIFF's profile directly with the `tiff` crate. The `image`
  wrapper returned None for the initial tiny TIFF fixture despite the direct decoder and
  macOS recognising its profile. That input-reader discrepancy was not changed here.
- Optional app check: export a photo and open it in Preview's inspector; its profile should
  read **sRGB2014**. There are no new native keyboard/menu interactions in this change.
- Remaining exports: output sharpening, wider-gamut output, watermark and AVIF/HEIF.

## Export: filename templates and saved presets (2026-11-11)

- **Naming:** File naming in the existing Export dialog; original names by default, or custom
  text with `{filename}`, `{sequence}` (at least three digits) and `{date}` (YYYYMMDD capture
  date, file modification date if missing). Start number and a live filename example. Unknown
  tokens/unmatched braces/empty templates block export with an inline error. File extensions
  come from the chosen format. A filename token retains the virtual-copy-specific suffix.
- **Batch safety:** `library/exportnames.ts` plans stems before directory creation or rendering.
  Sequence positions include skipped/failed frames, so a rerun with Skip keeps the same names.
  Distinct frames sharing a destination receive unique stems, including case/Unicode collisions,
  before Skip/Replace is applied. Paths/control characters and reserved Windows names are
  cleaned; names leave byte space for collision suffixes and extensions. Custom templates
  cannot Replace another original in the batch; that frame fails before rendering or writing.
- **Presets:** Export's left rail saves named settings snapshots, applies without changing frame
  scope, marks modified settings, updates explicitly and confirms deletion inline. Duplicate
  names are rejected. Escape cancels naming a preset before closing Export; focus returns to
  Save as preset. `library/exportpresets.ts` follows the metadata-preset store pattern.
- **Persistence:** both `emulsion.export` and `emulsion.exportPresets` use `appsettings.ts`,
  migrating old export defaults from localStorage into settings.json once, so settings backups
  and restore include them. Outside Tauri, the probe/browser fixtures still use localStorage.
- **Validation:** `npm run check` passes (836 frontend, 117 Rust; 1 skipped/17 ignored).
  Naming tests cover invalid templates before I/O, Unicode byte limits, virtual copies,
  same-name collisions and sequence stability through Skip/failure. Preset tests cover
  snapshots, update/delete, malformed data and migration into native settings storage.
  `node tools/browser-tests/cdp-timing.mjs export-settings` covers the real dialog's naming,
  save/apply/update/delete, scope retention, persistence, validation and responsive bounds.
  Desktop/mid, 600px/light and 1200px/dark pass; captures inspected under
  `.scratch/export-settings-{desktop,compact,dark}.png`.
- **Oli should try:** Export → File naming → Rename with template, e.g.
  `Lisbon-{date}-{sequence}`; export a few frames and rerun with Skip. Save as preset, change
  the format/size, apply the preset, then relaunch to confirm it remains. Native WKWebView
  keyboard/menu interaction and real-file exports with these names remain app checks.
- **Next exports:** wider output colour spaces, output sharpening, watermark and
  AVIF/HEIF. Wider-gamut preservation through the pipeline needs its own implementation.

## Import removed from the top-right toolbar (2026-11-11)

Committed in `19bddf2` on Oli's request (`TopBar.tsx`). Import duplicated the route into the current
folder's importer in the Import/Sync redesign. The normal toolbar button is removed; File → Import…
and Cmd+I remain. Sync and Export stay in the Library header, and the import screen keeps its
Import all / Import selected actions. The existing browser fixture now enters the
importer through the same `chooseFolder` action as the File menu.
Checks: `npm run check` passes in the working tree (824 frontend, 117 Rust). The isolated staged
tree builds and passes 796 frontend tests. The full `library-handoff` browser flow passes;
desktop and 1200px headers inspected.
**Oli should try:** File → Import… / Cmd+I in the native app (the browser fixture calls its handler).

## Develop header shows the folder (2026-11-11)

Uncommitted (`TopBar.tsx`, `LibrarySources.tsx`, `styles.css`, `library-handoff.tsx`). Oli wanted to see
which folder he is in while developing. Develop's header now shows the same source identity as Library
(folder breadcrumb with clickable ancestors, or the collection/import name, plus the count) after a
divider; the More menu stays in Library (`SourceHeader` without `onOpen`). Below 1200px only the
current folder shows. Check: `node tools/browser-tests/cdp-timing.mjs library-handoff screen=develop`.
**Oli should try:** in Develop, read the folder name; click an ancestor in the breadcrumb (it opens that
folder); open a collection and switch to Develop (its name shows).

## Large smart collections no longer stall the app (2026-11-11)

Uncommitted (`store.ts`, new `src/library/background-reads.test.ts`, timing tools below). Oli: clicking
a large smart collection nearly crashed the app; after the first fix, still "extremely slow".

- **Real cause (measured on Oli's 3,755 photos, `/Volumes/Oli External`):** every click rescanned
  the folders (0.9 s) and then re-read *every* file in the background: white points (LibRaw opens
  each RAW, 9.7 s) and embedded metadata (20.2 s), on all cores, competing with the thumbnails.
  Neither result was remembered, so this repeated on every click and on every folder open.
- **Fix 1, remember the reads:** `Photo.read` (`white`, `embedded`) is stored in the catalog with the
  photo and carried by `withCachedMetadata` while size and modified time match. `loadWhitePoints`
  reads only RAWs not read before; `loadEmbedded` reapplies remembered results without IPC.
  Oli's existing catalog has no `read` yet, so the first open of each folder reads once more.
- **Fix 2, fewer updates:** the background reads apply results every 1,024 photos (`FLUSH_EVERY`)
  through `updateOpenPhotos`, which skips no-op updates; capture metadata rewrites only its photos.
  Store work for 20,000 photos: 10.1 s -> 0.4 s.
- **Tests/tools:** `background-reads.test.ts` (updates bounded; reopen makes no white point or
  embedded IPC calls; a changed file is read again). `tools/browser-tests/smart-collection.tsx` +
  `cdp-timing.mjs` (wall-clock, via DevTools protocol) mount the real Library on a catalog fixture
  at `.scratch/smart/fixture.json` (Oli's settings and webview library index, local only) and
  report long tasks: one ~290 ms task per click in Chrome. `npm run check` passes.
- **Not done:** the first read of a new large folder still runs at full parallelism beside the
  thumbnails (could wait for visible thumbnails first); each click still rescans every library
  root (22 in settings, including stale `emulsion-perf-*` temp folders, Downloads, Documents);
  Library subscribes to the whole store; the webview's localStorage WAL is 61 MB (the 4.4 MB
  index is rewritten on catalog changes, debounced 150 ms).
- **Opening shows at once** (Oli: the delay "shows on the prior folder screen which feels more like
  a crash than a loading"): `State.opening` is set on click by `openFolder`/`selectSource`
  (`beginOpening`), cleared when the read ends. Header, sidebar highlight (`shownSource`, folder tree
  `highlighted`) and a "Reading photos…" pane switch immediately; the previous photos stay in
  `photos` (deselected, Develop/Loupe blocked) and come back if the read fails. Refreshing the open
  folder keeps it on screen. Tests: `src/library/opening.test.ts`. Screenshot via
  `SHOT=.scratch/smart/opening.png node tools/browser-tests/cdp-timing.mjs smart-collection hold`.
- **Collections and imports show from the catalog** (Oli: a second click went back to "Reading
  photos…"): `selectSource` displays `catalogPhotos()` at once, rescans the folders behind the grid,
  then refreshes keeping the active photo, selection, view and undo; photos marked or edited during
  the rescan keep their changes (`changed` → `cacheEdits`). Only an empty catalog shows the opening
  pane. The header says "Reading photos…" only for folders. Fixture with your catalog and 1.5 s
  scans: first thumbnails 132 ms after the click (`cdp-timing.mjs smart-collection scanDelay=1500`).
  Folders still rescan before showing (one folder is quick).
- **Next task (on the README roadmap, Speed):** Oli still feels a pause when clicking the smart
  collection. Measure it in the real app first, then the items below.
- **Catalog storage.** The webview's localStorage WAL grew 61 → 163 MB in an hour: every
  catalog change rewrites the whole 4.6 MB `emulsion.libraryIndex` (8.6 MB as UTF-16), twice per
  collection open. Move the index out of localStorage (a Rust-side file or IndexedDB, written per
  folder) before the library grows.
- **Oli should try (app only):** click the smart collection once (slow, last time), then click
  another source and back: thumbnails should appear at once and the Mac stay responsive. Click a
  big folder from another folder, and from Develop: the new name and "Reading photos…" should show
  at once. Click a folder on an unplugged drive: a toast, and the previous folder returns.

## Loupe artboard space: vertical image carousel (2026-11-11)

Committed with the Library Grid/Loupe work below. Oli found the photo too
small and chose a vertical carousel consistent with Develop.

- **Layout:** `LibraryImageRail.tsx` replaces Loupe's bottom filmstrip with a 184px
  single-column Images rail beside the artboard. Reuses Develop's `ImageFrame` tiles;
  optional original thumbnails and preserved selection leave Develop's defaults intact.
  Source context is one compact breadcrumb/count row; photo details and Fit/100% share
  the photo toolbar. The photo gets equal 12px insets (8px in narrow containers), with
  no reserved zoom row. Folder navigation, filters, marks and optional fullscreen remain.
- **Scale/scroll:** rail mounts only nearby rows, reserves a consistent marks row and
  measures fractional row heights. Virtual padding belongs to an inner list so it cannot
  expand the flex scroll viewport. Active navigation reveals the tile; manual scrolling
  leaves active selection alone; restoring fullscreen reveals any photo selected there.
- **Checks:** all 806 frontend tests pass (1 skipped), typecheck and production build pass.
  Browser fixture covers 2,000 photos, bounded mounted tiles/scroll viewport, End/Home/Down,
  manual scrolling, F → End → Escape restoration, partial selection, marks/undo/copies,
  camera-only previews, retry/no-match, Grid/Loupe/Develop routing and physical pixel zoom.
  Develop's three-column Images fixture also passes. Visual captures inspected under
  `.scratch/loupe-vertical-{desktop,compact,fullscreen-narrow,error,zoom,scale}.png`;
  normal desktop DPR2, 1200px light and narrow fullscreen. Grid capture retained separately.
- **App check remaining:** real WKWebView trackpad scrolling/pinch, camera-preview latency
  and native fullscreen transitions; browser IPC is mocked. No backend/pipeline changes.

## Metadata finished: IPTC set, keyword hierarchy, presets, export metadata (2026-11-11)

Uncommitted. Roadmap priority 3, done (Oli: speed is OK for now). Built in the same tree as the
cull loupe above (shared files: `store.ts`, `styles.css`, `api.ts`, `commands.rs`, `lib.rs`, docs;
stage apart). Oli chose Lightroom's model for all four parts.

- **IPTC fields:** Lightroom's IPTC set, 31 fields in Content / Image / Copyright / Contact / Status
  folds (Contact and Status folded by default), label-left grid. Rust `Meta` is now `keywords` +
  a flattened `fields` map driven by `FIELDS` in `xmp.rs` (Text, LangAlt, List, `CreatorContactInfo`
  struct, `xmpRights:Marked`); old sidecars read unchanged. Webview twin: `META_FIELDS` in `meta.ts`.
- **Keyword hierarchy:** a keyword is a `|` path. Typed `Places > UK > Kent` or `Kent < UK < Places`;
  a unique name resolves to its path. XMP: `dc:subject` = names + parents, `lr:hierarchicalSubject`
  = paths when any keyword has a parent; Lightroom's trees are read back. **Keyword List** section
  (`KeywordList.tsx`, `library/keywords.ts`): library-wide tree with counts, box assigns to the
  selection (✓ all, – some), arrow filters, double-click renames, drag onto another moves inside,
  right-click menu (new inside, rename, move to top, Person, delete with confirm). Renames reach
  photos outside the open folder through `retag_keywords` (`keywords.rs`, newer XMP wins first).
  **Filter bar** keyword menu (`Filter.keyword`, a path: matches it and what is inside).
- **Presets:** `library/metapresets.ts`; Presets fold atop Metadata (Apply = one undo step, Save as
  preset… picks which shared values to keep, New photos = auto preset). Auto preset fills only empty
  fields of photos the catalog hadn't seen, after `loadEmbedded`, without undo (`fillNewPhotos`).
- **Export metadata:** `export_meta.rs`. Lightroom's Include (copyright / + contact / all except
  camera / all, default all), Remove person info (Person keywords) and location info (GPS + place
  fields), Write keywords as Lightroom hierarchy. One XMP packet embedded with `XmpFile` in the
  temporary file (now `.partial.<ext>`) before rename; the toolkit writes EXIF/TIFF tags and
  IPTC-IIM too. Camera data: the original through the toolkit, else a RAW's embedded JPEG (RAF,
  CR3), else LibRaw (`raw::camera_info`). Orientation 1, ColorSpace sRGB, original's pixel sizes
  dropped. Sent as the `x-emulsion-meta` header (percent-encoded JSON).
- **Checks:** `npm run check` passes (806 frontend, 116 Rust; 17 ignored). New Rust tests: IPTC set
  round trip, keyword paths, retag (incl. XMP-only photo), export in JPEG/16-bit TIFF/PNG read back
  with kamadak-exif and the toolkit, every Include choice, GPS removal from EXIF, person removal,
  hierarchy. Ignored `raf_camera_data_from_its_preview` passes on `~/Pictures/1OKK6432.RAF`
  (model and lens found). Probe screenshots `?metapanel`, `?metapanel&presets&theme=light`,
  `?exportdialog={}` checked (captures in `.scratch/meta/`).
- **Not done:** keyword synonyms and per-keyword Include on Export / Export Containing Keywords
  (all levels are always written), IPTC Extension (PersonInImage, events), Lightroom keyword file
  import/export, undo for retags outside the open folder, a timed check of the Keyword List with
  thousands of keywords. Copyright and contact exports carry no rating or keywords (as Lightroom).
- **Oli should try (app only):** type `Places > UK > Kent` in Keywords; type `kent` on another
  photo (should become the same keyword); in the Keyword List drag Kent onto another keyword, rename
  one by double-click, delete one used by photos in another folder, then open that folder (gone, and
  its `.xmp` updated); tick boxes with several photos selected; filter bar keyword menu; Save as
  preset… then Apply on other photos and Cmd+Z; set New photos to a preset and open a folder new to
  the library; export a RAF and a JPEG with All, then check Preview's Inspector / `exiftool` for
  camera, lens, GPS, copyright, keywords; again with Remove location and Copyright only; open an
  export in Lightroom with Write as Lightroom hierarchy on.

## Library Grid/Loupe with optional fullscreen (2026-11-11)

Committed. Oli challenged the separate fullscreen Cull mode and approved integrating
Loupe into Library. This supersedes the initial fullscreen-only implementation.

- **Structure:** Library toolbar Grid/Loupe switch; folders, collections, source header
  and filters stay available. Loupe has a compact source header and a virtualized
  original-preview filmstrip. The top-bar Cull action and separate `cull` View are gone.
  `View` is Library/Develop; `libraryView` is Grid/Loupe with independent
  `loupeFullscreen`. Hidden mounted Grid retains scroll/layout state.
- **Keys/actions:** E or Enter opens Loupe; double-click a Grid tile opens Develop (restored 2026-11-11); G returns to Grid,
  D opens Develop. Enter on Loupe's photo stage opens Develop, while focused controls
  keep native activation. F/fullscreen button optionally expands the photo; F/Escape
  restores the SAME embedded Loupe (same preview DOM, zoom/pan and source), Escape again
  returns to Grid. Workspace/source changes clear explicit fullscreen. Native transition
  serialization preserves a window that was already fullscreen.
- **Marks/selection:** Grid has shared flag/stars/labels and Auto Advance controls for
  its selection. Loupe's `targets` is the shown active frame only; navigation/Home/End
  and ordinary filmstrip clicks preserve partial grid selections. Shift/Cmd filmstrip
  clicks explicitly change them. Filters, undo, virtual-copy identity, marks and saves
  stay in the existing store. A no-match filter hides the prior image AND its marks,
  with Clear filters to recover.
- **Photo:** `LibraryLoupe.tsx` reuses the original-preview loader and zoom/pan from the
  first implementation. Fit, click/Z → physical-pixel-correct 100% preview, drag/scroll
  pan and pinch/Ctrl-scroll zoom. Original camera rendering, no Develop edits/crop.
  Virtual copies share source bytes, keep independent marks. `Filmstrip` gains opt-in
  original thumbnails, no duplicate filters, preserved selection; Develop defaults stay
  unchanged. `Thumb`'s original option prevents edited-neighbour RAW development.
- **Native/queue unchanged:** `cull_preview` uses only the oriented embedded JPEG for
  RAWs and the tagged-image/sRGB decoder for rasters. JPEG quality95, no upscale, 8192px
  ceiling, no RAW-development fallback. One native read at a time, active/next/previous
  queue replaced on navigation; three entries and ~96MiB estimated retained decoded
  pixels, allowing one oversized active image; file size/mtime keys, URL eviction,
  stale-completion and exit cleanup. No persistent full-size preview cache.
- **Checks:** `npm run check` passes (806 frontend/1skipped;116 Rust/17ignored;
  typecheck/build). Final CSS refinements checked in the browser; subsequent typecheck
  and production build also pass.
  Focused culling/cache/menu suites:22 pass. Browser fixture `culling` now mounts real
  Library, TopBar, filmstrip and global shortcuts in StrictMode with native IPC mocked.
  Covers normal open without fullscreen; folder/filter/strip retention; explicit
  fullscreen hides chrome without remount; Escape restoration; pixel100%; keyboard
  marks/undo/retry/copies; partial-selection strip click; G/E/Enter/D/menu routes;
  no-match filter and Clear; edited-neighbour filmstrip makes no RAW decode.
  Captures `.scratch/library-grid.png`, `library-loupe-{retina,compact,error,zoom,
  fullscreen,fullscreen-narrow}.png`:1440×1000 DPR2,1200×800 light,1440×900 fullscreen
  and520×740 fullscreen. Independent finish review: **ship** at the scope of the
  inspected UI and supplied automated behavior evidence; no material findings.
- **Oli should try:** double-click/E from real Library; folders/collections/filters while
  in Loupe, click the filmstrip, G back to Grid (selection/scroll intact), D to Develop;
  P/X/U,Shift+3,Auto Advance,Cmd+Z; click/Z and trackpad pan/pinch; F then Escape back
  to the same Library Loupe, including when the app window was already fullscreen.
  Native WKWebView fullscreen/trackpad behavior, real RAF/ORF preview latency and process
  memory are still unmeasured. Browser fixture proves routing, not native OS behavior.
- **Next:** Compare/Survey belong beside Grid/Loupe in Library; then stacks/bursts,
  search/richer smart rules, batch rename/capture-time offsets and catalog scale.
  Overall performance acceptance remains open; Oli explicitly chose this Library step.

## Open-source feature map (2026-11-11)

Added `docs/OPEN_SOURCE.md` at Oli's request: feature-to-project attribution,
implementation links, AI model installation status, bundled assets, supporting
libraries, local experiments and historical ports. README now introduces the
main contributors and links the guide; NOTICE remains the detailed licence,
commit and copyright record and links back. Corrected README's stale grain and
Shadows attribution and NOTICE's outdated development-only LaMa download wording.
Documentation only; local links, LUT counts and diff whitespace checked.

## Pick and reject flags replace hearts (2026-11-11)

Committed (0cf3a82). Roadmap priority 4, first step.
Oli's choice: the heart goes; 5 stars and Pick take its place. Auto Advance is an option, off by
default (Lightroom's); the full-screen cull loupe comes later.

- **Model:** `Marks.flag: 'pick' | 'reject' | null` (`library/marks.ts`, `FLAGS`), independent of
  stars and tags; stars are kept while rejected. P picks, X rejects, U unflags; flags are set, not
  toggled (P on a pick stays a pick); clicking an active flag button clears it. `markPhotos(mark,
  advance)` steps to the next shown photo when one photo was marked (Shift with any mark key, or
  **Photo › Auto Advance**, `prefs.autoAdvance`); Shift+digit is read from `e.code`. X still turns
  the crop frame while cropping.
- **Migration:** a `heart: true` in a sidecar (original or copy), the catalog cache, a saved filter
  (`heart` → Picked) or a smart rule (Favourite → Flag is Picked, Not a favourite → Unflagged) reads
  as a pick; sidecars are rewritten with `flag` and never `heart`.
- **XMP:** a reject is `xmp:Rating` -1 (Bridge/darktable; Lightroom reads it), `Interchange.reject`.
  The stars stay in `.emulsion.json` and go back into the XMP when un-rejected. On scan a newer XMP
  with -1 rejects and keeps the stars; a newer one without -1 un-rejects. A pick has no XMP field.
  (Lightroom Classic itself keeps flags in its catalog only.)
- **UI:** flag badges (filled white flag = pick, red struck flag = reject) on grid cells, filmstrip
  and Images frames; rejected pictures dimmed to 40%; Pick/Reject buttons before the stars in the
  photo bar; three flag toggles in the filter bar (Picked, Unflagged, Rejected; any combination);
  **Photo › Flag** submenu and Auto Advance; shortcuts sheet updated; `--heart` removed.
- **Checks:** `cargo test` 109 pass (new: heart migration, reject ↔ Rating -1 with stars kept, scan
  reject/un-reject from another app). Vitest all pass except `builtin-looks.test.ts` (the uncommitted
  `emulsion-looks.json`, not this work). Typecheck and build pass. Probe screenshots (`?library`,
  `?workflow&flags`) checked: badges, filter toggles, photo-bar buttons.
- **Oli should try (keys and menus can't be checked headlessly):** P / X / U in Library and Develop;
  Shift+P and Shift+3 move on; Photo › Auto Advance then plain keys move on; X in Crop still turns the
  frame and does not reject; select several and press X → one undo step "Reject on N photos", no
  advance; filter Picked + Unflagged hides rejects; a folder with old hearts shows them as picks;
  reject a RAW → Lightroom/Bridge shows it rejected, un-reject → its stars come back in the XMP.
- **Next (roadmap 4):** full-screen cull loupe on embedded previews (fast stepping, zoom to check
  focus), then Compare/Survey, stacks/burst auto-stacking, search and more smart rules, catalog scale.

## XMP sidecars, keywords and IPTC fields (2026-11-11)

Committed. Built while Codex built Select sky in the same tree (uncommitted; the two share
`lib.rs`, `api.ts`, `styles.css` and the docs, staged apart). Roadmap priority 3.
Oli's choices: Lightroom-style `<stem>.xmp`; written automatically; the newer file wins on scan;
first pass covers stars and labels, keywords, IPTC fields and reading embedded XMP.

- **Library:** Adobe's XMP Toolkit SDK through the `xmp_toolkit` crate (what Lightroom and
  exiv2 build on; it builds in ~20 s), not a hand-written XML reader, so other tools' fields
  round-trip exactly. NOTICE updated.
- **Rust:** `xmp.rs` (ownership of a stem's XMP: RAW > DNG > other, a tie is nobody; read, darktable's
  `<name>.<ext>.xmp` as a read-only fallback, embedded reads, merge-writes touching only changed fields
  plus `xmp:MetadataDate`, never replacing a file that isn't XMP). `sidecar.rs` gains `meta` and an
  `xmp` record (the XMP's mtime after our write) and writes the XMP when the stars/label/meta change;
  an XMP failure still saves the edits and returns the error (shown as the usual save toast).
  `library::scan` takes a newer XMP's values without writing. `embedded_metadata` command.
- **Webview:** `library/meta.ts` (model, tidy, shared values for a selection); `Photo.meta` (optional,
  same on every frame of a source); `editMeta` in the store with a `meta` history change per source;
  `loadEmbedded` after a folder opens, beside the white points; `MetadataControls.tsx` in a new
  **Keywords and Metadata** tab (Tags icon); smart-collection **Keyword is** rule; a JPEG with
  keywords is never folded under its RAW. Probe: `?metapanel` (or `?metapanel=one`) mounts it.
- **Not done (README roadmap):** metadata presets, keyword hierarchy/list, keyword filter in the
  filter bar, more IPTC fields, metadata in exports, pick/reject mapping. Virtual copies' stars
  aren't in XMP (Lightroom doesn't write them either). A custom label (Lightroom label sets) reads as none
  and stays in the file.
- **Checks:** `cargo test` 106 pass (xmp, sidecar and scan tests: Lightroom fixture with `crs:`,
  hierarchy, Purple and reject kept; RAW+JPEG ownership; newer-wins both ways; broken XMP).
  Vitest: all pass except `builtin-looks.test.ts`, which fails on the uncommitted
  `src/film/emulsion-looks.json` (look names changed; not this work). Build passes. Panel screenshots
  checked in dark and light.
- **Oli should try (can't be checked headlessly):** rate and label a RAW → `<stem>.xmp` appears and
  Lightroom/Bridge show them; edit a rating in Lightroom (Save Metadata to File), reopen the folder
  in Emulsion → it shows Lightroom's; type keywords with commas and Enter, remove a chip, Cmd+Z;
  select two photos and edit City (shows Mixed first); a Fuji RAF rated in camera shows its stars
  after opening the folder; typing digits in the fields must not rate the photo.

## AI Select sky (2026-11-11)

Committed. Oli clarified that "AI sky removal" means automatically selecting the sky for
local adjustments. Implemented **Masks → Select sky**, and **Add/Subtract → Sky**, within
the existing panel (impeccable, incumbent design). It needs no click on the image. New masks
are named Sky; each successful selection is one undo step. Brush, ranges, Feather and Blur
work on it as on other shapes. The optional first-use prompt shows the missing download's
size; downloading and selecting have status, failures have Try again. Continue in background
keeps an already consented download running without selecting the old frame.

- **Native:** `sky.rs` follows xiongzhu666's U²-Net `onnx_interence.py` at
  `1f7811b32b64ddc957269defff84bc87a3f0b74f`: 320² RGB, ImageNet normalization, CHW,
  first output, min/max normalization, uint8 truncation. Bilinear resizing is expressed
  directly in Rust (rounding can differ from OpenCV by one input byte). `sky_commands.rs`
  registers status/install/inference, validates RGBA dimensions and length, keeps a CPU
  session with four intra-op threads, and releases it on exit.
- **Model:** optional 88,084,505-byte FP16 ONNX from `voyagerfromeast/skyseg`, revision
  `d76f97cf68f049654f087d78d071dfd7505b2561`, SHA-256
  `74d87f4a69378a610a6be662f859c38cfbdfdd75ff74bbfc54842965ed6fc9f7`. Pinned and
  verified with the existing installer, in `ai-models/mask-sky-u2net-fp16`. Shares ONNX
  Runtime with SAM but downloads no SAM weights. MIT licence retained in
  `src-tauri/licenses/skyseg.txt` and installed next to the model; NOTICE updated.
- **Storage/rendering:** `SkyShape` (`kind: 'sky'`, raster, no SAM prompts), source
  coordinates, existing RLE sidecar. `ObjectGpu` and `packShapes` share the existing eight
  raster slots between objects and skies; no new shader or texture unit. The input is the
  existing whole-frame 1536 px object render. No inference when editing, reopening, making
  thumbnails or exporting a saved mask. `skyselect.ts` captures frame/virtual-copy identity,
  destination mask and render geometry; navigation (even away and back), leaving Develop,
  cancellation, changed lens geometry and deleted destinations discard pending results.
- **Checked:** typecheck and production build; 95 Rust tests pass (16 ignored), plus the
  ignored real-model `sky_on_photo` run explicitly. Frontend: 775 pass, 1 skipped; the sole
  failure was `builtin-looks.test.ts` expecting the old Film names; fixed when the renamed
  Emulsion looks were committed, and `npm run check` now passes.
  New `skyselect.test.ts` covers consent/download retry/joining a background download,
  undo/redo, Add/Subtract, navigation/virtual copies, cancellation, geometry, deleted
  destinations, capacity and unsupported machines. `objectmask.test.ts` covers sidecar,
  shared raster packing and brush subtraction. `sky-mask` GPU browser test passes in main
  and worker modes: same pixels as the object raster path, crop/brush/refinement and saved
  export match exactly (max diff 0). UI inspected at 280 and 340 px, plus the download prompt;
  captures in `.scratch/sky/`. `git diff --check` clean.
- **Real model:** upstream `eval/233129.jpg` (tree, buildings, cloudy night sky), 4032×3024:
  load 0.118 s, inference/resizing 0.676 s. Compared with the author's Python/OpenCV path:
  mean mask difference 0.157/255, p99 2/255, max 14/255; threshold agreement 99.956%.
  The small differences start with uint8 resize rounding. Visually the tree and buildings
  stay out while sky, including gaps through branches, is selected. Reproduction assets,
  Python environment, model and diagnostic masks are ignored under `.scratch/sky/`;
  no user-facing model installation was performed.
- **Limits:** the model predicts at 320²; fine foliage/building edges may need Feather and
  brush touchups. It uses upstream's per-image min/max normalization, not a calibrated
  "no sky" classifier. A constant output becomes empty (avoids division by zero).
  No dedicated matting, automatic DenseCRF or native in-app timing/interaction check.
- **Oli should try:** reload the app, Masks → Select sky, accept the sized download once;
  Exposure should affect the sky alone. Check trees/buildings/clouds, Add/Subtract Sky,
  brush correction, Feather, Undo/Redo, crop/rotate, reopening and export. Switch photos or
  virtual copies during selection: the old result must not be applied to the new frame.

## Fade removed; Vignette is RawTherapee's post-crop vignette (2026-11-10)

Uncommitted. Oli asked to remove Fade and to see whether Vignette could be better or based on an
upstream tool. His choices: RawTherapee over darktable, one Amount slider, saved edits just
change (no legacy versions), fitted to the crop as upstream.

- **Fade:** gone from `Recipe`, `SLIDERS`, the Optics section, copy settings, presets and
  `finish.glsl` (Finish is now dither only). `normalizeRecipe` drops a saved `fade`, so old edits
  lose their lift.
- **Vignette:** the old one was our own (`1 − 0.72·amount·smoothstep(0.2, 1.05, r)` on the
  uncropped frame). It is now RawTherapee's `calcPCVignetteParams`/`calcPCVignetteFactor`
  (`rtengine/iptransform.cc` at 64c2d90a): scene-linear, falloff along cos⁴ to 2^-strength at the
  ellipse through the crop's corners. Why RawTherapee: darktable's vignetting module is
  display-referred (by its own label), while RawTherapee's works in linear light in stops, which is
  where ours sits (before the film). Amount 0–100 → 0–3 EV (20 = RawTherapee's default 0.6 EV);
  feather and roundness stay at RawTherapee's 50. Not ported: roundness ≠ 50 and the fade-out
  outside the crop box. `engine/vignette.ts` (a line-by-line port, plus `vignetteAt`, the simpler
  form the shader uses: at roundness 50 it is √2·|c − ½| in crop coordinates), `stages/lens.glsl`
  (`uVigScale`, `uVigInner`, `uVigGeoU/V/W` = the inverse frame map, set by `Engine.render` only
  while the vignette is on, so a crop doesn't remake Clarity's map without one). The `aspect` key
  term is gone (the lens uniforms are in `BEFORE_CLARITY`). NOTICE and ARCHITECTURE updated.
- **Checked:** vitest against factors from RawTherapee's own C (`tools/vignette-reference/
  generate.sh` builds the two functions unmodified → `fixtures/pcvignette.json`), plus the shader
  form against the port at four aspects. Probe `?vignette`: lens stage vs reference ≤ 1.6e-6 on a
  plain crop and a straightened crop with perspective; whole engine on flat grey with a crop at
  Amount 100: all four crop corners 154 → 53, centre 155 → 155. Typecheck, `vite build`, `cargo
  test` pass; vitest fails only `builtin-looks.test.ts` (the look rename, already failing).
- **Behaviour change:** while the crop tool is open the canvas shows the whole frame, so the
  vignette fits that, then moves to the crop when cropping ends (RawTherapee fits its crop
  parameters the same way).
- **Oli should try** (Cmd+R): Optics has no Fade; drag Vignette (corners darken smoothly, centre
  untouched); crop tight and see the vignette follow the crop; straighten/perspective; portrait
  frames; export matches the screen.

## Fit developed at the size shown, with darktable's Lanczos3 (2026-11-10)

Uncommitted. Oli noticed Fit looked soft (on the laptop screen). Measured, then fixed.

- **Cause:** at Fit the develop pass sampled the larger preview (rounded up to 128 px, kept
  until 33% too big, at least 1536) through trilinear mipmaps. Even at 1.01× that kept only
  40–47% of the finest detail (bilinear at a ratio near 1 averages neighbouring pixels).
- **Fix:** `Engine.fitSource` shrinks the whole source, after capture sharpening, denoise, lens
  correction and retouch, to the size the whole photo is shown at with darktable's Lanczos3
  (`interpolation.c` at 20891f6c, its default scaling interpolator): `engine/resample.ts`
  (reference, tests against numbers from darktable's own C compiled locally) and
  `shaders/resample.frag.glsl` (two passes, 32-bit float between). The render develops that, so
  every map is made at the shown size and the develop pass reads it pixel for pixel. Only with
  the whole frame in view; zoomed in, the preview is developed as before. The histogram, read
  backs and a zoomed region's whole-photo products reuse it; `measureAhead`/`prepareSteps` plan
  at its size. `Engine.fitResample` = 'screen' (default) / 'all' / 'off'. NOTICE and
  ARCHITECTURE updated.
- **Kept from upstream:** its pixel mapping (output x = input x / scale), which sits the image
  0.5·(1 − scale) px right and down of centre alignment (≤ 0.17 px at 1.54×). Where upstream's
  tap count lands on a whole number the GPU may take one more tap than the CPU (probe: ≤ 1.2%
  on a one-pixel stripe, ~5e-4 elsewhere).
- **Checked:** `tools/browser-tests/fit-sharpness.ts` (new): finest-detail energy against the
  scene decoded at the shown size, before → after: 1.01× 46 → 89%, 1.07× 45 → 90%, 1.31× 43 →
  94%, 1.54× 41 → 97% (texture 64–74 → 108–117%: Lanczos keeps some aliasing the soft
  supersampled reference lacks). Probe `resample`; vitest; `vite build`; `cargo test`;
  `prepare-ahead` (updated: it was already failing on its count of 18, as `prepareSteps` now also
  plans 20 colour/live targets; it now checks at the shown size), `capture-cache`, `histogram`,
  `dehaze`, `export-worker`, and `region-detail` default + capture, profiled, colorpreview,
  density, fidelity, gesture, hsl, maskdehaze, motion, readback all pass.
- **Not done:** the 2560 cap still upscales on displays wider than that (not Oli's case); a crop
  with a fractional offset, rotation or perspective still resample in the develop pass;
  thumbnails and exports at reduced size still use trilinear (`fitResample` is screen-only).
  Untimed in the app: shrinking costs a pass per new input (edits to capture, denoise, lens or
  retouch, resizes) and maps are now smaller (cheaper); entering and leaving a zoom between
  Fit and the preview's size now remakes the whole photo's maps once each way.
- **Oli should try** (Cmd+R): a RAW and a JPEG at Fit (sharper fine detail, no shimmer or
  ringing on high-contrast edges); narrow and widen the side panel; zoom in and out (no hitch);
  drag Texture, Clarity and Dehaze at Fit (still smooth); the histogram still updates.
  Worth a timing run with the Mac idle: `node tools/perf/inapp.mjs <photo> sliders,zoom`.

## Scanner dropdown removed from Develop (2026-11-10)

Uncommitted. Oli asked to take the scanner out of the main Develop section. The compact
"Scanner" select under the look chooser is gone (`LookChooser`, `TreatmentControls`,
`ScannerFinish`'s `compact` branch, `.look-scanner` CSS). A photo's scanner finish now always
comes from its look; the look editor keeps its Scanner finish section. Copy/paste settings and
presets can still carry `scanner`, so a photo overridden before this change keeps its override
with no control to undo it in Develop.

- **Checked:** typecheck; vitest (only `builtin-looks.test.ts` fails, the look rename below);
  `realtime.mjs scanner-finish` passes up to authoring a finish in the editor, then fails on a
  stale step: it looks for a "Base LUT collection" select that no longer exists in `src`.
- **Oli should try:** Cmd+R, apply a look with a scanner finish (no Scanner row under the look);
  Edit… still shows Scanner finish.

## Export: TIFF and PNG at 8/16-bit, Location like Lightroom Classic (2026-11-10)

Committed. Oli asked for more file types and a subfolder to export into, modelled on LRC.
His choices: JPEG + TIFF + PNG at 8/16-bit now (AVIF/HEIF/JXL later); LRC-style location;
existing files New name / Overwrite / Skip (no Ask); a sectioned dialog, presets later.

- **Dialog** (`ui/ExportDialog.tsx`, designed with /impeccable in the app's settings-dialog
  vocabulary): left rail **Frames** (saved presets go above it later), right **Location**
  (Export to: A folder / Next to original; Folder + Choose… with New Folder; Put in subfolder +
  name; If a file has the same name: Add a number / Replace it / Skip the frame; a line saying
  where files land and what the rule does), **File** (JPEG/TIFF/PNG; Quality; Bit depth;
  TIFF Compression None/LZW/ZIP; "sRGB, without metadata"), **Size**. Footer summary. Settings
  persist in localStorage (`library/exportsettings.ts`, key `emulsion.export`); the defaults
  match the old behaviour (`Emulsion exports` in the open folder, JPEG 92, add a number).
- **Engine:** `Engine.readPixels16Async` renders into RGBA32F and reads back 16-bit RGB in
  ≤48 MB strips; Finish's dither is now `uDither` (1/255, or 1/65535 for 16-bit). The still
  worker's `render` takes `bits: 16` (`StillClient.pixels16`).
- **Rust** (`export.rs`): `Format` (jpeg/png/tiff), `Existing`, `encode`, `place`,
  `write_frame`; TIFF through the `tiff` crate directly (LZW and ZIP with the horizontal
  predictor; `image`'s TIFF encoder is uncompressed only). Overwrite renames the finished file
  over the old one and refuses to replace the photo being exported. Skip is checked before
  developing (`export_exists`) and again at write time. `write_export` returns `{ path, skipped }`.
- **Checked:** `cargo test` (92, incl. 16-bit PNG/TIFF round trips in every compression,
  rules, protect); vitest export and settings tests; `export-worker` GPU test in worker and main
  modes now also exports a 16-bit TIFF (max diff 1.0 8-bit step against the JPEG frame, 1200 vs
  154 levels on a ramp; a 400 × 9000 frame across two strips matches); `remove-export` both
  modes; screenshots in mid, light and at 600 px wide (probe `?exportdialog=<settings JSON>`).
- **`npm run check` fails on one test outside this work:** `builtin-looks.test.ts` expects
  "Film Neg"…, but `src/film/emulsion-looks.json` was changed during this session (now
  "Emulsion Neg"…), likely by the dev-only look editor. Not touched here; Oli to say whether
  the rename is intended (then update the test) or revert it.
- **Not done:** colour spaces and embedded ICC (files are untagged sRGB), metadata, file-name
  templates, presets, AVIF/HEIF/JPEG XL, output sharpening, watermark. Exports into a subfolder
  other than `Emulsion exports`, or next to originals, show up in the library on the next scan
  (the scanner skips only that name). A full-size 16-bit export of a 26 MP RAW in the app (memory:
  ~156 MB of RGB16 plus a 48 MB strip; time) is untimed.
- **Oli should try** (needs the app): Cmd+R, open Export; switch formats and depths; Choose… and
  make a new folder in the picker; Next to original with a subfolder on photos from two folders;
  export twice with each rule (Add a number gives -2; Replace overwrites; Skip says "skipped:
  already there" and is fast); Replace on JPEG originals exported next to themselves without a
  subfolder (must refuse, naming the original); open a 16-bit TIFF and PNG in Preview or
  Photoshop (16 bits per channel, colours as the JPEG); type an empty subfolder name (Export
  disables and says why); close and reopen (choices kept).

## Export robustness and Selected frames by default (2026-11-10)

Committed. `npm run check` passes (743 frontend, 86 Rust); `export-worker` and
`remove-export` GPU tests pass in worker and main modes.

- **Default scope:** the Export dialog opens on **Selected frames** whenever anything is
  selected (it used to need two or more); otherwise Developed, This frame, then Every frame.
- **Destination checked first:** new `check_export_dir` command (creates the folder, writes and
  deletes a probe file) runs before any photo is developed, so a read-only, missing or
  unwritable folder fails at once with its reason.
- **No half files, no overwrite race:** `export::write_new` writes the whole JPEG to a hidden
  `.<stem>.emulsion-<pid>-<n>.partial` and `sync_all`s it, claims the final name with an
  exclusive create (`create_new`, retrying the next `-N` if taken), then renames over its own
  claim. A failure removes the temp and our empty claim, never another file.
- **Destination failures stop the batch:** write errors come back as `WriteError { message,
  stop }` (`ExportWriteError` in `api.ts`). Full disk, quota, read-only, permission denied or
  folder gone set `stop`, and the export ends there (`ExportResult.stopped`) instead of
  developing every remaining photo to fail the same way.
- **Engine crashes recover:** the still-render client used to only log a worker error, so a
  crash left export (and thumbnails) waiting forever. Now a worker error or a lost WebGL
  context (`webglcontextlost`, or a failed render with `isContextLost()`) rejects everything
  pending with `StillsLost`, terminates the worker, and the next `stillEngine()` starts a new
  one. Export retries that photo once on the new engine. Source keys are global, so a stale
  `release` from a caller of the old engine can't free a new engine's source. A failed upload
  now says why instead of the later "source released".
- **Messages:** failures read without stacked "Error: " prefixes (`errorText`); the toast
  gives the first failure's reason and up to three names, and stays 6 s when something failed.
- **Not checked:** a real lost GPU context or worker crash (only unit-tested with a mock), a
  real full disk, an exFAT/SMB destination (rename over an existing file there), the 15 s
  readback timeout in `readPixelsAsync` against a slow full-size 26 MP export.
- **Oli should try:** open Export with one photo selected (should pick Selected frames); export
  to a folder you can't write (e.g. a locked folder or a read-only card) and see the immediate
  message; export twice to the same folder (names get -2) and check no `.partial` files are
  left; export a few full-size RAWs to an external drive.

## Speed session 6: export moved to the still-render worker (2026-11-10)

Committed (26b385a). Finishes session 5 (below): nothing renders on the page's thread any more.

- **What:** `exportPhotos` uses `stillEngine()` instead of `offscreenEngine()` (removed from
  `thumbs.ts`). The decode is transferred to the worker, not copied (`upload(img, origin, true)`);
  the client waits on `ready` for the worker's `maxTextureSize`; after each photo it releases the
  source and sends `drop` (`Engine.dropBuffers`). Pixels come back by `pixels(..., removal)`.
- **Remove in export:** `prepareRemovals` (`library/removal.ts`) still plans the spots and calls
  native inference from the page, but asks the engine for each crop's model input through
  `removeInput` (an interface, so tests and the probe can supply their own). In the worker,
  `StillRenderer.removeInput` runs `Engine.prepareRemove` in its render queue, with the removal
  context set only for each pass, yields between passes, and stops on `cancel` (the client polls
  the export's cancel flag every 50 ms). It returns the context; export passes it to the render
  instead of setting `engine.removeContext`. Consent to export an unfilled spot works as before.
- **Checked:** `npm run check` passes (740 frontend, 84 Rust). New GPU test
  `VITE_ENGINE=worker node tools/browser-tests/realtime.mjs export-worker 60`: a 1200 × 800 export
  with two overlapping Remove spots in the worker against the old page-engine path: Remove
  inputs and written pixels identical (max diff 0), also in main mode. `remove-export` (consent
  flow) passes in both modes. New unit test in `stills.test.ts` (per-pass context, cancel).
- **Not done:** a full-resolution export of a real 26 MP RAW in the app (memory, time, and that
  the page stays responsive meanwhile); in-app timing.
- **Oli should try:** export a few RAWs at full size and at 2048 while scrolling the filmstrip
  and dragging a slider (both should stay smooth); export one with Remove spots, and cancel one
  mid-export; export a photo whose Remove model is missing (the warning still names it).

## Halation and Glow: spektrafilm optics (2026-11-10)

Committed (d0d7508). Started by another agent (Codex), finished here. `npm run check` passes (739
frontend, 84 Rust); `node tools/browser-tests/realtime.mjs optics 60` passes on the GPU.

- **What:** darktable's spektrafilm optics, per [docs/research/optics.md](docs/research/optics.md).
  Halation is the three film-base bounces with the still/strong preset (0–100 → upstream 0–8);
  Glow is the Black Pro-Mist diffusion bank (0–100 → strength 0–2). New **Halation size** and
  **Glow size** sliders (20–400%, upstream's spatial scale on a 36 mm frame). Both apply in
  scene light after the tone equalizer (`stageOpticsScene`), Glow before Halation as upstream.
  Approved deviations (Oli): working RGB instead of film-layer exposures; a Gaussian pyramid
  instead of upstream's blurs. Recorded in file headers and NOTICE.
- **Files:** `engine/optics.ts` (reference: plans, strength curve, mixes; `optics.test.ts`
  checks it against `fixtures/optics.json`, made from the pinned upstream C by
  `tools/optics-reference/generate.py`), `engine/opticsgpu.ts` + `shaders/opticsmap.frag.glsl`
  (fields ≤2048 px, cached; Amount drags only re-mix), the extract pass's `uOpticsSource` mode.
- **Saved edits:** `halationVersion`/`glowVersion` (2 = new). A sidecar with an active effect
  and no version keeps the original renderer until the effect goes to 0 or its Size moves
  (`withSlider` in recipe.ts); copy/paste and presets carry size and version.
- **Measured** against upstream C (impulse/step, 20 µm and 6 µm pixels): halo within 3.2% of
  its peak everywhere, impulse energy within 1%, step tails 3–7% short (3σ truncation).
  Headless build cost at 2048 × 1365: both 1.6 ms, Halation 0.6, Glow 1.1, cached 0.3.
- **Looked at** on two of Oli's photos (1OKK6432, 1OKK6440) against the old models: Glow is a
  soft veil with no hot blobs; Halation is a tight warm fringe, subtle even at 100 (still/strong
  is strong anti-halation film). **For Oli to decide:** whether the slider should reach a
  stronger upstream preset (still/weak .08/.02/0, or no anti-halation .30/.10/.015), rather
  than retuning anything ourselves.
- **Not done:** the in-app timing (`inapp.mjs`, needs an idle Mac and Oli's screen); fit vs
  100% vs export comparison on a real RAW (at 100% and in a full export the fields come from
  ≤2048 px maps, so Glow's finest core component is softer than upstream there); monochrome
  handling (research note's open question); retiring Fade (separate task).
- **Oli should try:** Halation and Glow at a few amounts and sizes on a backlit photo; drag
  Amount (should stay smooth) and Size; open an older edit that had Halation/Glow on (it
  should look as before until set to 0 or its Size is touched); copy/paste Halation alone;
  zoom to 100% and export one.

## Optics direction and possible Matte control (2026-11-10)

Documentation only; no processing or controls changed. Oli agreed to keep Halation and Glow as
distinct effects, improve them using established upstream processing, and retire the separate
Fade control. The README roadmap records this follow-up, including preserving saved edits.
Matte is listed under Later as a **maybe**: a convenient lift of the deepest blacks, tapering out
through the midtones, only if it earns its place alongside the tone curve. No upstream choice or
implementation is settled, and the ordered roadmap priorities remain unchanged.

## Speed session 5: still renders moved to their own worker (2026-11-10)

Committed. Fixes the post-release stall diagnosed in session 4 (below).

- **New:** `engine/stills.ts` (`StillRenderer`: upload, release, capture, assets, render →
  RGBA pixels or a JPEG encoded in the worker; renders queued one at a time, the removal context
  set only while a draw is submitted), `engine/stills.worker.ts`, and `library/stillclient.ts`
  (`stillEngine()`, started on first use; loads the look's LUT on the main thread and sends new
  assets before each render; runs in-process where `engineMode()` is `main`).
  `engine/assetsync.ts` is the LUT/look sync taken out of `DevelopClient`, now shared.
- **Moved to it:** developed thumbnails (`thumbs.ts` `developBlob`, `sourceForPreview`,
  `sourceFromBlob`), look tiles (`ui/tilerenders.ts`: only `putImageData` stays here),
  photo match's target, perspective analysis. **Export still uses `offscreenEngine()`** on the
  main thread: its `prepareRemovals` steps the engine pass by pass, so moving it means running
  Remove preparation in the worker. Done in session 6 (above).
- **Timed** (production, worktree of HEAD plus this change, 50%): main thread blocked after
  release 0–17 ms (was 17–74 ms); second run all PASS, controls worst frame 16–23 ms, photo
  worst freeze 16–23 ms. Unit tests 732 pass (new `stills.test.ts`; the thumbnail tests mock the
  client). **Not run:** the full `npm run check` (build, `cargo test`) on this change.
- **Oli should try:** the Looks panel tiles redraw after an edit (and sliders feel smoother with
  it open); a filmstrip thumbnail updates after a pause; a thumbnail with Remove spots still shows
  them removed; photo match and auto perspective once each.

## Speed session 4: the "Exposure stall" is the thumbnail engine on the main thread (2026-11-10)

Diagnosis; fixed in session 5 above.

- **Not Exposure.** Run first or later, Exposure's drag passed the controls bar in 6 production
  runs (worst frame 15–23 ms); the 81 ms block did not come back during a drag.
- **The real block lands ~400 ms after release** (every drag, `ui.release.worst`, all `other`):
  60–74 ms after the session's first Exposure drag, 17–48 ms after later ones. Temporary
  logging (in a worktree, not kept) matched it to the thumbnail redevelop
  (`thumbs.ts` `SETTLE_MS` 400 → `developBlob`), which runs on **`offscreenEngine()`, a second
  WebGL engine on the main thread**:
  - first use: `new Engine` **88 ms** synchronous; then the 512 px decode (808 ms, async in Rust);
  - each redevelop: the synchronous draw (`renderToCanvasAsync` up to its readback) **43–57 ms**
    when the recipe needs a new shader variant (its context compiles separately from the
    worker's), 15 ms otherwise; readback 12 ms and JPEG 2–3 ms are async.
  - The 88 ms creation plus a draw ~1.3 s after the first edit is the likeliest source of the
    81 ms block last session's first drag caught. The sidecar save (also 400 ms) costs the main
    thread nothing.
- **Fix direction (not started, Oli to choose):** develop thumbnails (and stock tiles, photo
  match, perspective; all `offscreenEngine()` users) in the engine worker, returning a JPEG via
  `OffscreenCanvas.convertToBlob`, so the main thread only shows the result. A cheaper partial fix
  (warm the offscreen engine at idle) leaves the 15–57 ms draws.
- **Driver changes (`perfrun.ts`):** `VITE_PERF_SLIDER` sets the order and may repeat
  (`exposure,exposure` → `exposure`, `exposure2`); the app's timer callbacks are timed ('timer');
  worst blocks carry `atMs`; `ui.release` splits main-thread time from release to settle. Tauri's
  `__TAURI_INTERNALS__` is locked, so IPC replies can't be hooked from the page.
- **Note:** the uncommitted optics work's `'uStore' : redefinition` compile error is fixed
  (see the Halation and Glow section above). These runs used a
  clean worktree of HEAD plus `perfrun.ts`, at the scratchpad path `…/scratchpad/wt` (its
  `src-tauri/target` is an APFS clone).
- Harness detail: `inapp.mjs` prints only `[webview:error]` lines, so log at error level when
  debugging through it.

## Speed session 3: sliders restyled every frame by `[type]` selectors (2026-11-10)

Uncommitted. `npm run check` passes (730 frontend, 84 Rust).

- **Production timing in the app:** `PROD=1 node tools/perf/inapp.mjs …` builds the interface
  (`vite build` to a temp dir, served by `vite preview`) into the same dev shell. Checked: the
  bundle is production React.
- **Main-thread split per drag** (`perfrun.ts` `watchMainThread`, in each drag's `ui.mainThread`):
  store updates up to React's flush, rAF callbacks, worker messages, inputs, and WebKit's
  rendering step ('render': last rAF callback → a MessageChannel message), credited to the
  blocked stretches the 2 ms timer chain finds; `renderMsPerFrame`; an idle second before each
  drag (`ui.idle`); `mutations` (DOM changes per frame by region). Experiment switches:
  `VITE_PERF_HIDE=<sel>|…` (visibility hidden) and `VITE_PERF_DROP_CSS=<text>|…` (deletes
  matching rules).
- **Finding:** in WKWebView our JS was ~20 ms/s of the blocked time; WebKit's rendering step was
  7–12 ms a frame during drags (0 idle), and Oli's Web Inspector recording showed it was style
  recalculation (4.3 ms/frame average, up to 17 ms). Cause: React 19 rewrites `name` and `type`
  on every controlled input it re-renders, and any selector reading `[type]` makes WebKit restyle
  the input (range inputs with their track and thumb). Dropping the `[type` rules took the render
  step 9 → 2 ms and blocking to 0–45 ms/s. A GPU-contention theory from the first recording was
  wrong: Web Inspector's screenshots instrument paces frames at ~28 ms even idle.
- **Fix:** no stylesheet selector reads `[type]`: sliders are `input.range` (LiveRange,
  ExportDialog, Library), colour-grading numbers `input.number`, dialog text fields `input.text`
  / `.preset-search`. Keep it that way (comment in styles.css and LiveRange.tsx).
- **Fix:** a photo's first edit no longer develops its thumbnail mid-drag (`thumbs.want`: frames
  last seen unedited settle like edited ones; test in `thumbs-copies.test.ts`). Side effect: a
  one-off first edit (paste, preset) shows its thumbnail 400 ms later.
- **After** (production, 50%): Texture render 3 ms/frame, worst 14 ms, blocked 0; Dehaze 3 ms,
  worst 19 ms. Exposure, always the run's first drag, still had an 81 ms block of untimed work
  (start-up work landing?); Sharpen invalid (focus lost). The display ran above 60 Hz in that run
  (controls ~75 fps), so read worst frames, not fps.
- **Next:** find Exposure's untimed block (run it later in the order, or time timers/GC); a clean
  full `PROD=1 … interaction 600` with the Mac idle; then `maskinteraction` and photo switching.
- **Oli should try:** every slider still looks right (track, thumb, colour tracks on HSL and
  white balance, disabled sliders dimmed) in all three themes; Export's JPEG quality and
  Library's thumbnail size sliders; colour-grading number fields; preset search, preset name and
  collection name fields; Library source dialog fields (rule value, date, name). Drag sliders:
  they should feel steadier.

## Speed session 2: drag re-render fan-out cut (2026-11-10)

Committed in 0dec42f with session 1. Oli decided: the **controls bar is judged on a production build** (not dev React), and the
**histogram may update at ~10 Hz during a drag** (exact once the photo settles);
`npm run check` passes (729 frontend, 84 Rust).

- **Measuring:** `PROD=1` in `realtime.mjs` serves production React (`mode: production`, cache
  `node_modules/.vite-prod`). `ui-latency` reports `react`, `pageFps`, `worstFrameMs`, `framesOver25`,
  per store update `flushMs`/`flushP90`/`flushMaxMs`/`flushTotalMs` (setState until React's microtask
  render), `listenersMs` (zustand listeners alone), and `renders`: components re-rendered per update
  and the `roots` where re-renders start (a DevTools-style `onCommitFiberRoot` hook in
  `ui-latency.html`). `store.ts` `set` is late-bound so the test can wrap it. The flush timer swings
  ±0.5 ms between runs; the component counts are exact and the better guide.
- **Fixes:**
  - `useShown` subscribed to the whole store (every histogram update re-rendered the grid): now
    `useShallow(shown)`.
  - Every edit rewrites the catalogue's folder cache (`cacheEdits`), and `useCatalog()` callers
    (TopBar, FilterBar, ExportDialog, `useShown`) re-rendered on it: new `useSourceDefinitions()`
    (imports + collections, all `sourceMatcher` reads).
  - `useActivePhotoFacts()` (store): the active photo kept as the same object while only its
    recipe changes (its `recipe` may be stale). Used by PhotoInfo, Histogram's ExposureInfo,
    PresetControls (live photo only while its sheet is open).
  - Narrow selectors: TopBar (view, count), FilterBar (counts), Histogram/CurveEditor (photo id;
    curve backdrop memoised on the data), PhotoTools (has a photo), TransformControls (id),
    ExportDialog (no photos/selection while closed; its form state still persists).
  - `memo`: PhotoTools (Develop passes stable zoom handlers via a ref), PhotoInfo, Histogram,
    FullResolutionStatus, ImageViewOptions, FilterBar; Panel's tab bar (`ControlStages`) and
    Workflow action bar (`ActionBar`, primitives only). Section's icons are made once.
  - Histogram store updates at most every 100 ms with a trailing update (`showHistogram` in
    Develop.tsx); a new photo's first histogram shows at once.
  - Panel's section Reset (`sectionChanged`) is worked out only for visible sections.
- **Result** (headless, production React, 600-input Exposure drag): components re-rendered per
  update **140 → 43**; JS in the drag 680 → 577 ms (React 335 → 279, icons 55 → 12; zustand
  18 → 57 from the extra selectors). Dev React flush 4.1 → 3.1 ms median. Worst page frame 17 ms in
  every drag (Dehaze, Exposure, two brush strokes). What's left re-renders for a reason: the edited
  slider row, the visible sections, the edited photo's frame, Develop (it renders through the recipe).
  Native time (style/layout/paint/IPC, ~505 ms) is now the larger share and unchanged.
- **Next:** time it where it counts. `tools/perf/inapp.mjs` runs the **dev** app; Oli judges a
  production build, so it needs a production mode (a `vite build` served to the Tauri dev shell, or
  `tauri build --debug`) before the bar can be checked in WKWebView. Then the clean idle-Mac run
  below. Further cuts if needed: TreatmentControls/LookChooser re-render on every edit (photo prop;
  their callbacks read `photo.recipe`, so memo needs them to read `activePhoto()` instead); Images
  re-renders for the edited frame (could subscribe per frame).
- **Oli should try** (not checkable headlessly): drag sliders, the curve, colour wheels; the histogram
  should still follow a drag (a little steppier) and land exact; Undo/Redo/Paste buttons and their
  tooltips; Presets hover preview and "Update from this photo"; Export dialog opens with the right
  scope and remembers size/quality; filter counts in the Images pane after editing (Edited filter);
  photo info bar marks (stars/heart) after editing; zoom buttons and Cmd +/-.

## Roadmap set; speed session 1: endless re-render fixed (2026-11-10)

Oli asked what keeps Emulsion from competing with Lightroom Classic; the answer became the
README's Roadmap, now **ordered**: speed, export, XMP/keywords, culling/library scale, editing
parity. Speed is current. Committed in 0dec42f.

- **Bug 1 fixed: a zoomed-in RAW never settled.** With profiled denoise on (default for RAWs) and
  the region path (zoomed in), Develop re-rendered every `VIEW_SETTLE_MS` for ever (~5 fps of
  full frames, worker busy, GPU and battery). Cause: `regionRenderSteps` ran the whole-photo
  products with `prepare: undefined` (from 2026-11-02, so a stage prepare would not stop it
  early); the profiled denoise (76fa95a) reads `prepare !== 'frame'` as "interactive screen
  render, defer", so even `prepareFrame` deferred the preview's denoise and `profiledOwed`
  never cleared. Fix: pass `'frame'` through (products return before the frame's own stop).
  Regression: `GPU=1 node tools/browser-tests/realtime.mjs region-detail 120 profiled` (red
  before, green after).
- **Diagnostics kept:** `Engine.inexactParts`; each worker frame stat carries `pending` (live,
  moving, draft, inexact parts); `perfrun.ts` `settle` timeouts now say what kept it busy.
- **Fresh baseline**, `VITE_PERF_SCALE=0.5 node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF interaction 600`
  (26 MP RAF, WKWebView, DPR 2, one run; now fits in 600 s):

  | Slider | Photo fps | GPU ms/frame | Controls fps / worst frame | Main-thread long tasks |
  | --- | ---: | ---: | --- | ---: |
  | Exposure | 52.5 | 18 | 58.3 / 37 ms | 253 ms/s |
  | Texture | 50.1 | 18 | 60.2 / 29 ms (1 stale) | 384 ms/s |
  | Dehaze | 54.7 | 15 | 58.9 / 46 ms | 159 ms/s |
  | Clarity | 45.7 | 16 | 58.9 / 35 ms | 163 ms/s |
  | HSL | **9.8** | **192** | 57.1 / 39 ms | 322 ms/s |
  | Sharpen | **10.4** | **186** | 57.9 / 43 ms | 284 ms/s |
  | Capture | 5.6 | 47 | 59.7 / 31 ms | 97 ms/s |

  HSL and Sharpen were not slow sliders: after a few drags, whenever the background
  whole-photo capture sharpening had finished, **every frame rebuilt the region** (below).
- **Bug 2 fixed: region rebuilt every frame once capture was cached.** `regionSteps` stores
  `regionMade.input` as the cached capture result (`fullCapture.csOut`) once it is ready;
  `regionHolds` compared that, but `regionPlan`'s `prev` compared the raw `src.tex`, found no
  previous region and returned a new rectangle object each frame, and `regionSteps` reuses only
  `made.rect === rect`. So ~63 ms CPU + ~190 ms GPU per frame, timing-dependent (it began when
  the background capture landed). Fix: `regionPlan` uses the same input as `regionHolds`.
  Regression in `capture-cache` (red before, green after); `region-detail` main, capture,
  density, fidelity, motion and profiled all pass. Each drag's summary now carries `regions`
  (admission, reach, share, `kept`), `pending` counts and denoise builds.
- **After both fixes** (only three drags valid; the window kept losing focus, so rerun with
  nobody using the Mac): Clarity photo 57.2 fps, Sharpen **10.4 → 53.4** (GPU 186 → 16 ms),
  Capture **5.6 → 50.4**. An invalid run showed every slider at 0–2 ms CPU with `kept: true`.
- **Bars (Oli, 2026-11-10):** controls must pass (58 fps, no frame over 25 ms, no stale);
  the photo aims for **40 fps** (`inapp.mjs` default `PERF_FPS` now 40). Controls still fail
  on worst frame (28–47 ms), with 270–364 ms/s of main-thread long tasks during drags: that is
  the next target.
- **What blocks the page thread during a drag (diagnosed, not fixed).** Loop: `VITE_ENGINE=worker
  DPR=2 WINDOW=1440,900 PROFILE=<f>.cpuprofile node tools/browser-tests/realtime.mjs ui-latency 200 slider`
  (whole App, 600-input Exposure drag; `TRACE=<f>.json` now records a timeline trace; the drag is
  marked `gesture-start`/`gesture-end`). Headless Chrome, so magnitudes understate WKWebView.
  - Inputs are cheap (0.1 ms; LiveRange). The cost is the once-per-frame flush: store update
    (`editActive`) then a synchronous React re-render of ~20 components that read `photos` or the
    active photo, most of which show nothing that changed: Images (200 memoised frames), FilterBar,
    TopBar, PhotoTools, LookChooser, TransformControls, a closed ExportDialog (subscribes to
    `photos` and builds its lists while closed), CurveEditor (rebuilds its histogram path each
    histogram update, i.e. every frame), Histogram.
  - Dev React (what `tauri dev` and `inapp.mjs` run) costs ~1.75× production: busy 1891 → 1351 ms
    of 4.8 s, JS ~1360 → ~770 ms, longest stretch 23 → 19 ms. Layout+paint are small (~170 ms).
    Production headless has no task over 12 ms; WKWebView + dev React reaches 30–45 ms.
  - Fix plan (proposed to Oli): cut the re-render fan-out (narrow selectors / memo; ExportDialog
    renders nothing until open), and decide histogram cadence during drags. Open question for
    Oli: is the controls bar judged on the dev app or a production build?
- **Oli (2026-11-10):** "it's been good", meaning the sliders feel fine to him. He has not yet
  answered the two decisions (dev vs production build for the controls bar; histogram at ~10 Hz
  during drags), so don't build the fan-out fix until he does.
- **Next session starts with:** a clean full in-app run, with Oli keeping the Mac idle:
  `VITE_PERF_SCALE=0.5 node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF interaction 600`
  (any `INVALID ... blur` line means focus was lost; rerun that slider with `VITE_PERF_SLIDER`).
  Compare with the before/after numbers above, then `maskinteraction`, then photo switching.
- **Oli should try:** open a RAW, zoom to 50% and 100%, wait 10 s: "Loading full resolution"
  should clear and the fans stay quiet. `npm run check` passes (729 frontend, 84 Rust).

## DCP removed; camera colour follows darktable (2026-11-10)

Oli found the Camera Profile panel misleading ("Standard" plus a camera name implied a profile), then
chose to follow darktable: camera matrices only, no DCP (ICC input and darktable's enhanced matrices
maybe later). No DCPs had ever been installed. Uncommitted.

- **Camera Profile section removed:** nothing in it could change, so the panel says nothing about
  camera colour unless a RAW's camera has no matrix; then `CameraColourWarning` (`src/ui/CameraProfile.tsx`)
  shows "No colour data for the … yet, so colours are approximate." at the top. Probe view: `?profilerow`.
- **OM-3 fix (after 476f2c1, uncommitted):** LibRaw reports OM System cameras' make as "Olympus" but
  `cameras.xml` files them as "OM Digital Solutions", so a real OM-3 ORF found no darktable matrix and
  rendered uncalibrated (the unit test had assumed the wrong make). `darktable_camera` now lets an
  Olympus make match those entries (no model overlaps); checked on `PA040028.ORF` (source Darktable).
  Denoise cache key → `darktable2` so cached OM-3 entries re-decode.

- **Removed:** the RawTherapee DCP port (`dcp.ts`, `profilegpu.ts`, `profilestore.ts`, `dcp.glsl`,
  `dcp.frag.glsl`, the Adobe curve, fixtures, `tools/probe/dcp-reference/`, the probe's `?profiles`,
  `histogram-profile` browser test), `camera_profiles.rs` and its four commands, `camera-profiles/` in
  backups/archives, the `emulsion.cameraProfiles` setting, the "Camera profile" copy group, and
  `recipe.profile`/`autoProfile` (`normalizeRecipe` drops them from old sidecars). The neutral sigmoid
  always renders the base; texture units 13-15 are free. `preRetouchKey` keeps `'auto', null` in place
  of the old fields so existing retouch caches stay valid. The two Rec.2020↔D50 matrices retouch used
  moved into `retouch.ts` (NOTICE updated). Unedited photos' look label is now "Neutral" (was "Auto").
- **Panel:** `raw.rs` `ColourSource` (`camera` / `darktable` / `none`) rides on
  `CameraMetadata.colour` (`noise_cache.rs` fills it for older cache entries). The section shows a
  "Colour" row: "Standard matrix" (LibRaw's or darktable's, said in the detail line) or an orange
  "None" warning; summary `Standard matrix` / `Uncalibrated`.
- **Checked:** `npm run check` passes; probe (no errors, tone/roundTrip ~1e-7); `treatment-filters.mjs
  dehaze` PASS; panel states rendered from `.scratch/profile-panel/` and inspected. Not yet in WKWebView.
- **darktable camera data (done, same session):** `tools/rawspeed/generate.py` turns rawspeed's
  `cameras.xml` (develop 62052260182413a6ccd834efad81fda10153d760, CC-BY-SA 3.0) into
  `src-tauri/src/rawspeed_cameras.rs` (crop + matrix for ~590 cameras). Regenerate when rawspeed
  updates; never hand-add cameras (Oli). Matrix order follows darktable: DNG's own, then
  `cameras.xml` exact model, then LibRaw's table. This replaced the hand-written OM-3 → OM-1
  `SAME_SENSOR` entry: the OM-3 now uses darktable's own OM-3 matrix, so **OM-3 colours change**.
  The ILCE-7RM6 had been coloured with the 2013 ILCE-7R's matrix (LibRaw prefix match); it now
  uses darktable's. Where LibRaw kept a Sony's whole readout, `emu_open` crops as rawspeed does:
  lossless ARWs to SonyRawImageSize (the 7RM6 file: 10240 × 7168 → 10008 × 6672; darktable's
  `applyCrop = false` skips the cameras.xml trim there), other ARWs by cameras.xml. Verified on
  `~/Documents/1613056030.arw` (`EMULSION_SONY_ARW=… cargo test --release crops_unknown_sony --
  --ignored`): edges carry picture, colour source darktable. The noise cache key gained
  `darktable1`, so AI denoise reruns once per photo. Licence note for Oli: cameras.xml is
  CC-BY-SA 3.0 (darktable ships it as a separate data file); it's compiled in here.
- Not yet: rawspeed crops for non-Sony cameras LibRaw doesn't size (needs each decoder's base
  size, as `ArwDecoder`'s SonyRawImageSize); black/white levels from cameras.xml.

## App icon (2026-11-10)

Oli supplied `~/Documents/emulsion-logo.png` and asked to use it as the app icon.

- On 2026-11-11, replaced the artwork again from `~/Documents/new-icon.png` (latest supplied
  version), regenerating all desktop assets at the existing optical size. Every ICNS size and
  the dev PNG pass size/centering checks; the dev build passes and embeds the exact new ICNS.
- Replaced all 17 desktop assets in `src-tauri/icons` using Tauri's icon generator,
  including macOS ICNS, Windows ICO/AppX and the PNG sizes used by the app.
- Oli then supplied a new 852 × 852 version with a beveled dark background and orange
  gradient E; it replaces the original flat logo across all desktop assets.
- Preserved that supplied PNG as `src-tauri/icons/source.png`. Regenerate with
  `swift tools/generate-icons.swift` from the repository root; mobile assets are not used here.
- The generator measures the visible tile (alpha ≥ 128), excluding the source's transparent
  border and shadow. It scales and centers that tile inside a transparent 1024 × 1024 canvas.
  The original fixed inset shrank the tile to 797 px and put it 10.5 px above center.
- Reference ICNS files for WhatsApp, Proton VPN, Notes and Calculator have 824 px visible tiles
  on the normalized 1024 px canvas. After matching that size, Oli still wanted it a touch bigger:
  the final tile is **848 × 848**, centered at (512, 512), about 3% larger for this dark artwork.
  Both `icon.icns` and `icon.png` use that layout; other desktop assets use the unpadded source.
- References: [Apple app icon guidance](https://developer.apple.com/design/human-interface-guidelines/app-icons/),
  [Icon Composer workflow](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer),
  [Tauri icon packaging](https://v2.tauri.app/develop/icons/). This app still uses Tauri's ICNS
  packaging, not an Xcode Icon Composer asset.
- Verified PNG dimensions/RGBA, ICNS/ICO headers, configured asset paths and source fidelity.
- The screenshot still showed the original full-size flat icon because the running dev
  executable embedded old ICNS data; `cargo build` considered it fresh after icon changes.
  `build.rs` now declares `cargo:rerun-if-changed=icons`, so assets invalidate code generation.
  The active Tauri watcher rebuilds/relaunches after this build-script change.
- `npm run tauri -- build --bundles app` passes; the rebuilt
  `src-tauri/target/release/bundle/macos/Emulsion.app` contains the new ICNS (byte-checked).
  The dev build also passes; its executable embeds the exact new ICNS (byte-checked),
  and the Tauri watcher relaunched it automatically. Generated artwork was visually checked;
  capturing the live Dock was unavailable (`screencapture` could not capture the rectangle).
- `/tmp/emulsion-check-layout.swift` initially failed against the undersized/off-center ICNS;
  all ten final ICNS representations pass size and centering checks (16 through 1024 px).
  `/tmp/emulsion-icon-comparison.png` shows the actual ICNS beside native icons on equal
  canvases at 112 and 80 px; inspected visually. This is a generated preview, not a live Dock capture.

## Heal and Clone: match Remove’s overlay (2026-11-10)

Oli asked to improve Heal and Clone in the same way as Remove. Uncommitted, extending the
existing Remove work below.

- All retouch tools now share the hollow union boundary renderer, white saved outlines with a
  black keyline, and red boundaries while painting. No brush centre line or filled band.
- Unselected spots use 24 px selection pins: bandage for Heal, stamp for Clone, eraser for
  Remove (and appropriate icons for legacy Fill/Blur). Click/keyboard selection and pin dragging
  use the same interaction. Only the selected spot exposes its area hit target and handles.
- Heal/Clone keep a draggable source: a static dashed boundary, dashed link and source cross.
  Moving a target keeps its source fixed; source dragging changes only the source; both save
  once on release. Remove’s processing animation and completion/error colours are preserved.
- Shared styles/classes now use `retouch-*` names instead of `remove-*`; processing classes
  remain Remove-specific. The earlier `.scratch/removal-outline/check.mjs` uses the old names;
  `.scratch/retouch-outline/check.mjs` covers the shared renderer and all its Remove regressions.
- `RetouchOverlay.test.ts`: 19 interaction cases across Remove, Heal and Clone, including source
  dragging and ellipse handles. `tools/browser-tests/heal.tsx` now checks hollow painting and
  counts spots instead of invisible hit areas; its stale resize check now uses Option-scroll.
- Verified: `npm test` (739 passed, 1 skipped), `npm run build`, `git diff --check`, `heal` browser
  fixture in both main/worker engine modes, and `remove-switch`. The focused browser check passes
  all three themes, pin selection, red painting, source outlines, circles/ellipses/handles,
  bounded filters, Remove animation/reduced motion and transparent interiors without seams.
  Screenshots inspected: `/tmp/emulsion-heal-cross.png`, `/tmp/emulsion-clone-pins-light.png`,
  `/tmp/emulsion-heal-ellipse.png`. Native WKWebView appearance still needs a human look.

## DNG and TIFF support (2026-11-10)

Oli asked to fix DNG and TIFF support. Uncommitted; `npm run check` passes.

- **JPEG XL DNGs decode** (iPhone 17 Pro 48 MP ProRAW on iOS 26, DxO PureRAW 6): previously
  refused (and the message blamed DxO). LibRaw's `jxl_dng_load_raw_placeholder`
  (`vendor/libraw/src/decoders/dng.cpp`) is filled in after `lossy_dng_load_raw`/`adobe_copy_pixel`
  and calls `emu_jxl_decode_tile` in the new `src-tauri/src/jxl.rs` (jxl-oxide 0.12, pure Rust).
  Apple codes 10-bit samples in 16-bit JPEG XL, so the codestream's bit depth sets the integer range.
  48 MP full decode about 0.8 s. NOTICE records the LibRaw edit; CLAUDE.md/ARCHITECTURE say to keep it on update.
- **DNG colour from the file:** LibRaw leaves `color.cam_xyz` at its camera table, so iPhone ProRAW
  (any size) was decoded with an identity matrix ("no colour data"). `raw_shim.cpp` `dng_cam_xyz`
  now builds it from the DNG (D65 ColorMatrix × CameraCalibration × AnalogBalance) as LibRaw's
  identify does. Also changes X-T5 Pixel Shift DNGs slightly (file matrix instead of LibRaw's table).
- **Float resize no longer clamps:** `image`'s resize clamped Rgb32F to 0..1, so every downscaled
  RAW preview clipped highlights at 1.0 (clipping is 1.8) and lost negative values. New
  `resize_rgb32f` (same triangle filter, unit-tested against the crate).
- **ICC profiles:** rasters (TIFF, JPEG, PNG, WebP) were all read as sRGB; Adobe RGB/ProPhoto TIFFs and
  Display P3 JPEGs looked desaturated. `decode::to_srgb` converts with moxcms after the resize
  (engine) or thumbnail. CMYK stays the decoder's naive conversion; float images untouched; display
  input still clips to Rec.2020 0..1 in `input.glsl`, so gamut beyond sRGB is clipped (follow-up: keep
  negatives for mode 0).
- **JPEG-compressed (YCbCr) TIFFs** still can't be read (tiff crate); the error now says so plainly.
- Not done: Apple's ProfileGainTableMap (local tone map) is ignored, as LibRaw does, so ProRAW looks
  flatter than the camera JPEG. The 160 MP X-T5 Pixel Shift DNG takes ~10 s even for a preview
  (linear DNG, no half-size path).
- **For Oli to try:** open `~/Downloads/IMG_4299.DNG` (48 MP JPEG XL) and `NO_FUSION_0624_018/IMG_4370.dng`
  in the app, check colour against the thumbnails, and an Adobe RGB/ProPhoto TIFF.

## Remove: area outline and completion colour (2026-11-10)

Oli asked for an LRC-style boundary instead of the brush's centre line: red after drawing,
then translucent white once removal finishes. Uncommitted.

- `RetouchOverlay.tsx`: Remove brushes now show a hollow boundary of the union of their strokes.
  An SVG erosion/subtraction removes the interior, including seams where strokes overlap;
  there is no centre line or filled band. Explicit filter bounds cover dots and straight strokes
  and stay within the viewport during zoom/pan. Heal keeps its previous rendering.
- `styles.css`: painting, waiting for Apply, pending processing and failed removals are red;
  completed spots are white at .5 opacity, .75 when selected. Selection no longer leaves Remove
  orange. Circles/ellipses use the same completion colours; their processing dashes remain.
  A crisp black keyline keeps the boundary visible on bright and dark areas. Oli confirmed the
  first outline refinement works well, then asked for this black/white treatment, processing
  animation, and an on-photo Remove icon. The toolbar change was a misunderstanding and is
  now fully reverted.
- Processing brushes have travelling white highlights on the red boundary, with a steady black
  keyline. Waiting/failed strokes stay still; completed spots settle to white. Reduced motion
  uses static highlights. The on-photo brush cursor is unchanged.
- **Selection pins:** unselected saved removals show a 24 px dark circular pin with the white
  Lucide eraser and a white/red rim at their anchor, replacing the outline and full-area hit
  target. Only the selected removal shows its area boundary. Click a pin to select, drag to move,
  or Tab then Enter/Space to select. Processing pins have marching red rims (static under Reduce
  Motion), and failed pins retain their warning marker. Pending strokes before Apply still show
  their red area outline. `RetouchOverlay.test.ts` covers mouse/keyboard selection swapping and
  the absence of invisible full-area hit targets on unselected removals, and dragging a pin through
  its switch to an outline (the move reaches the recipe only on release).
- Oli found Undo did not remove strokes waiting for Apply: only saved edits reached history.
  `History` now supports scoped in-memory steps; `retouchui.ts` records each pending stroke and
  last-stroke deletion. Native menu, keyboard and panel Undo/Redo all use the existing store
  actions. Apply drops the draft history and makes one saved edit; Cancel and photo/copy changes
  drop both draft undo and redo. No sidecar write or inference for a waiting stroke.
- Regression `src/App-retouch-undo.test.ts` first failed for both keyboard and menu; now covers
  those paths, key/menu duplicate suppression, redo order across photo edits, Apply, Cancel,
  new-stroke redo invalidation, deletion, and switching virtual copies after undoing all strokes.
- Verified: `npm test` (724 passed, 1 skipped), the additional pin-drag regression (five overlay
  interaction cases pass), `npm run build`, `git diff --check`, and
  `remove-switch` in main and worker modes. `.scratch/removal-outline/check.mjs` confirms transparent
  interiors, no crossing seams, colours/selection and the restored toolbar in all themes, changing
  processing frames and identical frames under reduced motion, dots, loops and clipped boundaries.
  Real browser clicks also verify a pin becomes the selected outline and the old selection
  becomes a pin. Screenshots inspected: `/tmp/emulsion-outline-*.png`, including `pin-selection`.
- The existing `heal` browser fixture stops before reaching Remove because it still expects
  plain scroll to resize a spot, despite the Nov 9 change to pan. Left that unrelated fixture
  unchanged. The focused overlay check and `remove-switch` pass.
- Oli to try in the desktop WKWebView: turn off After each stroke, paint two strokes, ⌘Z removes
  the last, ⌘⇧Z restores it; Apply shows travelling highlights before white. Paint another removal
  and switch selection with the on-photo pins; drag a pin to move its removal. Native WKWebView
  motion and pin interaction still need a human look.
  No PRODUCT.md/DESIGN.md yet; `/impeccable init` can capture that context separately.

## Drop photos on the Dock icon (2026-11-10)

Oli asked to import by dropping one or several photos (or a folder) on the app icon. Oli tried it
in the built app and it works.

- `src-tauri/Info.plist` (merged by Tauri into the bundle) declares the document types: images,
  camera RAWs and folders, as Editor/Viewer at Alternate rank, so Emulsion accepts them on the Dock
  and in Open With without becoming anyone's default app. Checked in a built `Emulsion.app`.
- macOS delivers them as `RunEvent::Opened` (`lib.rs`): the paths go into a `PendingOpen` queue
  and an `open-paths` event wakes the page, which drains it with `take_open_paths`. At launch the
  page listens first and then drains, so a launch by drop opens what was dropped, not the last
  folder.
- `openPaths` (store.ts) is also what drops on the window use now (it used only the first path
  before). A folder opens as Import Folder does. Photos open their folder (the first photo's) and
  are imported without the chooser, added to that folder's `selected` import (a `sync` folder
  already has them), then selected. Photos from other folders are left out, with a toast. Tests
  in `store-folders.test.ts`; `npm run check` passes.
- Dock drops only reach a real bundle: the dev binary (`target/debug/emulsion`) has no bundle id
  or document types, so the Dock refuses drops on it. Test with `npx tauri build --bundles app`
  and `src-tauri/target/release/bundle/macos/Emulsion.app` (it shares the dev app's data; run one
  at a time). `open -a <app> <files>` sends the same Apple Event as a drop, for headless checks.
- Possible next step: a script that runs the dev build inside a small .app so Dock drops work in
  development.

## Light theme (2026-11-09)

Oli asked for a light grey theme beside Mid grey and Dark, then for it lighter, off-white; it is
now called Light (neutral, no warm cast: panels #f2f2f2, background #ebebeb, controls #fbfbfb).

- `Theme` is now `'light' | 'mid' | 'dark'`; THEMES lists Light, Mid grey, Dark, so it shows in
  View › Theme, the photo menu's Interface list and Settings. Choosing it keeps the 18% mid grey
  round the photo (`setTheme`), so the brighter interface doesn't sway judgement of the photo.
- Tokens in `:root[data-theme='light']` (styles.css), `color-scheme: light` for native controls.
  The histogram stays dark. New tokens in every theme: `--tint` (the white washes in the look
  browser were `#ffffffNN`, invisible on light; now `rgb(var(--tint) / a)`, black in light),
  `--on-text` (text on a `--text` fill: the lit tool button, crop's Done) and `--tip-bg` /
  `--tip-fg` (tooltips go dark on light). Overlays drawn on the photo stay white.
- `tools/browser-tests/themes.tsx` (realtime.mjs `themes`, query `theme=light|mid|dark`) mounts
  the whole app in Develop and checks the theme applies and text tokens keep AA contrast (7:1
  for main text). Passes in all three. `npm run check` passes.
- Not looked at in light yet: the Library grid, the look browser and its menus, the Look Creator,
  the mask and retouch panels, the export sheet. Oli to look through them in the app.

## Tone curve thumb focus (2026-11-09)

Removed the blue accent stroke from `.curve-point:focus-visible` in `src/styles.css`.
Keyboard focus keeps the thicker stroke in the curve's own colour. Verified the focused SVG
thumb in headless Chrome: no outline, matching curve colour, 3 px stroke; screenshot checked.

## Menu bar: Photo and Help (2026-11-09)

Next stage of the menu bar after File, Edit and View. Uncommitted.

- **Photo** (between View and Window): Rating ▸ No Rating (0) … 5 Stars (5); Heart (H); Colour
  Label ▸ Red (6) … Blue (9); Add to <target collection name> (B) (the label follows the target,
  greyed when there is none); then the tools Select (V), Crop (C), Transform (T), Mask (M), Heal
  (Q), Remove (E), Pick neutral (W). Marks act on the selection as their keys do (`markPhotos`) and
  are ticked only when every selected photo has them; labels and the heart toggle like the keys.
  Tools run `chooseTool`, are ticked with the held tool (`activeTool`), and are greyed outside
  Develop; Crop, Transform, Heal and Remove also wait for the photo's size, like the toolbar.
  Pan is left out (it is Space held). Virtual Copy stays in File only. No Reset Settings item: the
  app has no reset-all action to hook up yet.
- **Help:** Keyboard Shortcuts ⌘/ opens `ShortcutsDialog.tsx` (opened through `openShortcuts` in
  `menubridge.ts`), a sheet listing every key by section; Esc, Done or a click outside closes it.
  On macOS the Help menu is set as NSApp's help menu, so it gets the system search field.
- `photoMenuAction` in `appmenu.ts` beside `viewMenuAction`; the menu now also follows the catalog,
  the tools and the retouch UI. Tests in `appmenu.test.ts`; `tools/browser-tests/shortcuts.tsx`
  (realtime.mjs `shortcuts`, query `look` for a screenshot) checks the sheet opens, fits at
  1200 × 800 and 700 × 700, and closes on Esc. `npm run check` passes.
- **Settings… ⌘,** (Emulsion menu, after About; Oli said yes): `SettingsDialog.tsx`, an in-app
  sheet rather than a separate window, so it shares the stores live. Appearance (theme, workspace
  colour), Library (fold JPEGs, capture settings under thumbnails, photo columns), Tools (crop
  overlay, Remove after each stroke), and the backup actions (Export…, Import…, Restore from
  Backup…, Show Backups; the sheet closes first since they open native dialogs or reload). Each
  control writes the same store its menu or in-place control does. The Emulsion menu keeps its four
  backup items too. `tools/browser-tests/settings.tsx` (realtime.mjs `settings`) checks it opens,
  fits at 1200 × 800 and 600 × 600, writes each store, and closes on Esc. Not in it yet: AI model
  setup (Remove's model lives in its row), export defaults, histogram size.
- The shortcut list in the sheet is hand-kept: change it when a key changes.
- Oli to try (not checkable headlessly): every Photo item with one photo and with several selected
  (ticks for mixed selections stay off); the tool items tick and untick as you pick tools from the
  toolbar or keys; ⌘/ opens the sheet once; Help's search field finds menu items; the target item
  renames when you set a target collection; ⌘, opens Settings, each control changes the app at
  once and the View menu ticks follow; the four backup buttons.

## Menu bar: File, Edit, View (2026-11-09)

Oli asked for actions and settings in the menu bar, built in stages: File and Edit, then View.
Uncommitted.

- **The menu moved from Rust to `src/ui/appmenu.ts`** (Tauri's JS menu API) so items grey out and
  tick with the app's state: `menuState(app, prefs, workspace)` gives enabled and checked per id
  (tested), and `sync()` pushes only changes. `app_menu` / `on_menu_event` are gone from `lib.rs`.
  File and Edit ids go to `menuAction` in `App.tsx`; View ids run in `viewMenuAction`.
- **File:** Import Folder… ⌘O, Open Recent ▸ (last 10 folders, Clear Menu; list in
  `library/folders.ts`, seeded from the last folder), Create Virtual Copy ⌘', Show in Finder,
  Export… ⌘⇧E.
- **Edit:** Undo, Redo, Cut, Copy, Paste, Select All as before (Codex's ⌘C/⌘V routing kept), plus
  Copy Settings… and Paste Settings (greyed until something is copied).
- **View:** Library (G) / Develop (D) ticked; Show Original (ticked, toggles; \ still holds),
  Before and After Split (Y), Show Clipping (J); Zoom In ⌘=, Out ⌘-, to Fit ⌘0, to 100% (Z);
  Crop Overlay ▸, Photo Columns ▸, Fold JPEGs into RAWs; Workspace Colour ▸, Theme ▸; Enter Full
  Screen (moved from Window). Classic layout is retired, so no Layout item.
- Plain-letter keys are only named in labels, never accelerators (they'd take the key from text
  fields). Zoom and split are Develop's local state: `menubridge.ts` `viewCommand` reaches them.
- **Double fire:** in WKWebView a ⌘ shortcut can hit both the page's keydown and the menu item.
  `firstOf(id, 'key' | 'menu')` in `menubridge.ts` lets the first act and drops the other within
  400 ms; used for ⌘O, ⌘', ⌘⇧E and the zoom keys. Codex's copy/paste/undo guards left as they were.
- Photo and Help followed (section above).
- Oli to try (not checkable headlessly): every item; ⌘O / ⌘' / ⌘⇧E / ⌘= / ⌘- / ⌘0 act once;
  ⌘C / ⌘V in a text field vs on a photo; ⌘Z in the Look Creator; ticks follow when changed
  elsewhere (theme from the photo menu, columns from the Images View ▾); greyed items with no
  folder, in Library (zoom), and while editing a look; Open Recent and Clear Menu.

## Toolbar tools evenly spaced, no groups (2026-11-09)

Oli found the wider gaps between the tool groups confusing and didn't want groups. Uncommitted.

- The pill's eight tools (select, pan, crop, transform, mask, heal, remove, pick) are one row, 2 px
  apart, same order; `TOOL_GROUPS` became `TOOL_ORDER` in `PhotoTools.tsx`, `.tool-pill-group` CSS gone.
- Raised but not done (Oli to decide): the pill sits ~25 px left of the bar's centre (grid
  `auto 1fr auto`; `1fr auto 1fr` would centre it); zoom has no pill and 26 px buttons vs 32 × 30
  elsewhere; `.photo-tools > .tool-seg button` (styles.css, 620 px query) is dead.
- bars and perspective PASS; typecheck clean.

## Options rows one height; Transform's row reworked (2026-11-09)

Oli: the tools' options rows should be one height so the photo doesn't jump; the Transform sliders
were too small; focal length too prominent; show the angle values. Uncommitted.

- **Every options row is 40 px from an 800 px column up** (Crop, Transform, Heal, Remove, in every
  state); `tools/browser-tests/bars.tsx` now fails any other height. Below 800 px rows may still
  wrap to two lines (Heal/Remove from ~720, Crop from ~640): not yet addressed.
- **Transform row, one line:** Auto as three drawn icons (two verticals, two horizontals, both
  `#`, aria-labelled); the three angle sliders share the rest (up to 200 px each), each value
  always beside its slider, left-aligned (hidden under 720 px); then an options button
  (SlidersHorizontal ▾) holding **Constrain crop** and **Focal length** (its tooltip states both),
  then Reset. Constrain crop moved off the row to make room: Oli to say if he wants it back inline.
- **Crop no longer shrinks the photo:** it fitted inside an extra 24 px `CROP_MARGIN` on top of the
  stage's 24 px padding; removed, so crop shows the photo at the same size as every tool. The stage
  padding holds the corner handles (12 px out) and `.crop-zone` (inset −100vmax) still catches the
  drag-outside-to-turn there. A cropped photo still shows its whole uncropped frame while cropping.
- **Crop's Cancel / Done moved into its options row's right end** (`.crop-end`), as Remove's
  Cancel / Apply sit, out of the top toolbar. The top bar no longer swaps compare for a "Crop"
  label while cropping: the compare buttons stay, disabled, so the bar keeps its shape. Crop's row
  tightens under a 900 px column to stay one line at 800. The angle readout is left-aligned beside
  its slider, as Transform's are.
- Transform's fields take only their own width (sliders 180 px, shrinking when short), 10 px apart;
  the slack goes before Reset instead of between the fields.
- `perspective.tsx` finds the Auto buttons by aria-label now. bars and perspective PASS.
- Oli to check in the app: no jump switching Crop / Transform / Heal / Remove (corner handles and
  turning by dragging outside still easy to grab at the photo's edge); drag the angles;
  open the options popover (not screenshotted headlessly) and toggle Constrain crop, edit focal length.

## Heal/Remove: scroll pans again, [ ] size the spot (2026-11-09)

Oli: sizing the spot on plain scroll got in the way of zooming in to work. Uncommitted.

- With Heal or Remove held, plain scroll now pans and pinch or ⌘/Ctrl+scroll zooms, the same as
  every other tool. **[ / ]** size the spot (the selected one, else the next), **⇧[ / ⇧]** its
  feather (a brush's hardness), matched by `e.code` so ⇧ and other layouts work; one press is 5 of
  darktable's 3% scroll steps (≈ the mask brush's 1.15×). **⌥+scroll** sizes smoothly,
  **⌥⇧+scroll** turns an ellipse. Feather by scroll is gone (keys only).
- `scrollSpot(…, steps)` in `retouchui.ts`; tool hints (`tools.ts`) and the row's tooltips updated.
- Oli to try (not checkable headlessly): zoomed in with Heal and Remove, two-finger scroll pans,
  pinch zooms; [ ] and ⇧[ ] change the outline and a selected spot; ⌥-scroll sizes, ⌥⇧-scroll turns
  an ellipse.

## Three photo columns, a pencil for edited photos (2026-11-09)

Oli asked for three images per row in the Images pane, then to drop the look name and RAW+JPG
under each frame for an edit pencil. Uncommitted.

- **Three columns:** View ▾ › Photo columns now offers 3 (`workspace.imageColumns` 1 | 2 | 3);
  ↑/↓ already step by the column count. Three columns tighten the frame padding and badges.
- **Frames:** the look / RAW+JPG line is gone (in every column count). An edited photo (one with a
  recipe, as the Edited filter means) shows a Lucide pencil chip at the picture's top right; the
  frame's tooltip now names the look and RAW+JPG.
- **Navigator (Lightroom-style, over the Images pane) was built, then removed at Oli's request:**
  he wants to try working without one. If it comes back: Develop publishing its view and a
  `centre(cx, cy)` setter through a small zustand store worked well; don't name the store file
  `navigator.ts` beside `Navigator.tsx` (case-insensitive disk).
- Tests: `tools/browser-tests/images-grid.tsx` (realtime.mjs `images-grid`) checks three tracks,
  one pencil per edited photo, no look line. `npm run check` passes.
- Left as is: at three columns names cut off before the extension; offered hiding the extension.

## Built-in Emulsion looks, with a dev-only edit in place (2026-11-09)

Oli asked to make his Film Neg, Film Chrome and Film Gold custom looks default looks, editable
later, and for a couple of B&W looks. Uncommitted.

- New collection **Emulsion** (pack id `emulsion-looks`; `emulsion` was the retired legacy
  renderer's id and old sidecars may still name it). Looks live in `src/film/emulsion-looks.json`:
  hidden settings only, no LUT, each registered as a stock (`emulsion-film-neg`, `-film-chrome`,
  `-film-gold`, `-bw-dynamic`, `-bw-soft`). Film Neg/Chrome/Gold were copied from Oli's custom
  look files (their `_kind`/`_revision` dropped). It is the first system folder in the browser.
- **B&W Dynamic**: HSL brightness as a red/orange filter (reds +20, oranges +15, blues −45, cyans
  −30), colour balance chroma −100% (grey), contrast +0.30, shadows −0.15, brilliance highlights
  +0.12 / shadows −0.08, an S curve. A first draft, untuned on real photos.
- **B&W Classic** (`emulsion-bw-classic`): Pat David's Ilford HP5 Plus 400 LUT (`gmic-film`
  `hp5`), unchanged, no settings of its own (already credited in NOTICE.md). It replaced a first
  "B&W Soft" (invented warm/matte settings) that Oli didn't like. Possible follow-up offered, not yet
  agreed: put B&W Dynamic on the Tri-X LUT too, once Classic is judged.
- **Admin edit (development only):** with an Emulsion look applied, Edit… opens the Look Creator on
  the look itself (header badge "Built-in · dev") and Save writes the JSON through the dev server
  (`tools/vite/builtin-looks.ts`, POST `/__emulsion/builtin-look`, bumps `revision`), updating the
  look in memory without a reload (`library/builtinlooks.ts`). Release builds copy it as before.
  Photos already using a look keep their snapshot of its old settings.
- **Saving gave "Couldn't save the built-in look:" (blank).** A stale `vite.config.js` and
  `vite.config.d.ts` (tsc output, committed by accident in 4e00142, the old config) shadowed
  `vite.config.ts`, so the plugin never loaded and the route 404'd. Both deleted; a fresh server
  now saves (tested: 200, only `revision` changed, file restored). The dev server must be restarted
  to pick it up. A 404 now says to restart `npm run tauri dev`.
- `lookFile` now follows a settings look's LUT for any pack (not just user packs); `lutSourceOf`
  treats any settings look as custom looks were treated.
- Tests: `src/film/builtin-looks.test.ts` (canonical settings, snapshot and reload, B&W listed as
  B&W, B&W Dynamic grey through the colour balance reference, B&W Classic is the HP5 LUT). `npm run check` passes.
- **Look editor undo fixed:** the draft's history pushed a step per frame of a slider drag (the
  photo history merges them; the draft ignored `grouping`), so ⌘Z/Undo went back one invisible
  frame. `editRecipes` now merges draft steps by History.record's rule (same key, continuous or
  within `MERGE_MS`); an undo or redo starts a fresh step; no-op edits record nothing. Tested in
  `copies.test.ts` ("undoes a slider drag in a look draft as one step").
- **⌘Z in the Look Creator:** Oli: the header's Undo worked but ⌘Z/⇧⌘Z did nothing there, after
  a drag or anything else. Root cause not found (the menu listener is mounted, no keydown handler
  prevents ⌘Z). Workaround in `App.tsx`: while a look is edited the page's keydown runs undo/redo
  itself (preventDefault), and `menuAction` ignores an undo/redo within 500 ms of that, so one press
  can't undo twice. Elsewhere the macOS menu still owns the keys. Unverified in the app: Oli to try.
- Oli to try (not checkable headlessly): open the browser and see the Emulsion folder; apply B&W
  Dynamic and B&W Classic on a few photos; Edit… one, change a slider, Save, and confirm the JSON
  changed and the look updated without a reload. His custom copies of the three Film looks are still
  in My looks, and his favourites still point at them.

## Remove is its own tool; option rows never overflow (2026-11-09)

Oli asked to break Remove out of Heal, then to make sure none of the bars overflow. Uncommitted.

- **Remove tool** (toolbar, key **E**, Lucide Eraser, after Heal). Heal's row keeps Heal and Clone
  (Fill/Blur stay hidden); Remove's row has no algorithm picker. Both still share `useRetouchUi`:
  `retouchMode(ui)` is Remove when `settings.tool === 'remove'`. `holdRetouch(mode)` picks one up
  and remembers the other's algorithm, shape and scale (`kept`), so Q brings Heal back as left.
  Each tool shows, selects and clears only its own spots (`spotMode`); Clear all leaves the
  other's. Remove's model setup row shows only with Remove held. ⌘-click can no longer turn a heal
  spot into a Remove spot (Remove isn't in Heal's picker any more); `setRetouchTool` no longer
  takes 'remove'.
- **Overflow:** every options row (`.crop-bar`, so Crop, Heal, Remove, Transform) now wraps
  instead of clipping (Crop's used to hide its last buttons) or spilling (Transform's and
  Remove's Cancel/Apply ran past the edge). `.photo-tools-host` is a size container: below 620 px
  the zoom −/+ hide (menu and keys remain) and the compare buttons tighten; below 500 px the tool
  icons narrow. Heal/Remove hide readouts at ≤1000 px (was 900), Transform at ≤1040 px, and
  Transform tightens below 900 px.
- New `tools/browser-tests/bars.tsx`: mounts the toolbar at 480–1100 px in every state (select,
  crop, transform, heal, heal with a spot selected, remove, remove with strokes waiting) and fails
  on clipping, spill past the edge, overlap, or wrapping (one line from 800 px, two below).
  `?mode=<state>` stops there for `SHOT=` screenshots. Passes.
- Tests: `heal.tsx` covers E/Q switching, own-spot display and Clear all; `remove-switch` uses
  the Remove button. heal, remove-switch, perspective, bars and `npm run check` pass.
- **Pre-existing failure:** `realtime.mjs retouch-sliders` fails with "Empty retouch triggered a
  full decode". It fails the same way with the old Heal pick-up restored, so it predates this
  work; likely from the Remove first-frame changes below. Not investigated.
- Oli to try: E then Q and back (each keeps its own shape and spots), Clear all in each, and
  narrow the image column (drag the panel or use one image column) with each tool held.
- Left as is: a separator can end a wrapped line in very narrow columns.

## Transform moved to the toolbar (2026-11-09)

Oli asked to move Transform into the top toolbar beside Crop and Heal. Uncommitted.

- Transform's focal length now sits behind a "28 mm ▾" button (popover with the field and its
  explanation), so the row fits; see the overflow section below.
- Toolbar: a **Transform** tool (key **T**, keystone icon drawn on Lucide's grid since Lucide has
  none) in the geometry group after Crop. Held, its options dock under the bar like Crop's and
  Heal's (`TransformBar` in `TransformControls.tsx`, reusing the heal row's styles): Auto
  Vertical / Horizontal / Both, the Vertical / Horizontal / Rotate sliders with signed readouts
  (double-click resets), Constrain crop, the focal length (35mm equivalent, typed, Enter or blur
  commits, Esc reverts), the status while it is finding lines, and Reset on the right.
- `useTools.transform` holds it; every other tool puts it down, and pressing it again, T or Esc
  does too. Picking it while cropping finishes the crop first. Disabled until the photo's size is
  known, like Crop and Heal.
- Removed from the Refine tab (`workspace.ts`). The panel section stays for Classic and shares
  the same hook (`useTransform`).
- Tests: `typed.test.ts` covers the active tool; `tools/browser-tests/perspective.tsx` now drives
  the toolbar and bar (opens, crop puts it down, auto/undo/redo/stale results, press again puts it
  down). `realtime.mjs` takes `SHOT=out.png` to save a screenshot; `perspective` with query `look`
  stops after opening the bar. `npm run check` passes (675 TS, 81 Rust).
- Oli to try: press T, use Auto Vertical on a building, drag the sliders, type a focal length,
  then press C (Transform should close and Crop open), and Esc/T to put it down.
- Not done: a grid over the photo while the tool is held (Lightroom shows one) — worth adding.

## Remove: "After each stroke" option, with Apply/Cancel (2026-11-09)

Oli asked whether Remove should wait for Apply instead of running on every stroke. He chose the
Photoshop-style option only (not a delay before running). Uncommitted.

- Bar (Remove tool): an **After each stroke** checkbox, on by default and kept in localStorage
  (`emulsion.removeEachStroke`). Off: brush strokes wait in `useRetouchUi.pending` (per photo,
  with its full size), drawn in the accent with one flat band. Cancel / Apply (crop's Done style)
  sit before Clear all. Keys: Enter applies, Esc lets them go (the tool stays up), ⌫ drops the last
  stroke (when no spot is selected). Turning the option back on, switching to Heal/Clone or putting
  the tool down applies them. Moving to another photo lets them go. Circles and ellipses, and
  edits to existing spots, still run at once.
- Apply (`applyPending`) makes one undoable edit: `removeGroups` (engine/remove.ts) splits the
  strokes into the 8-connected areas of their mask within the photo, as IOPaint's
  `boxes_from_mask` does, and makes one Remove spot per area, the last selected. Touching strokes
  are one mask, filled once. Separate areas get their own box and run, as in IOPaint.
  Recorded in remove.ts's header: a stroke wholly inside a ring's hole becomes its own spot, where
  RETR_EXTERNAL would keep it in the ring's box.
- Recipe: `RetouchBrush.more?: BrushNode[][]` (further strokes in the spot). It is written only
  when present, so single-stroke spots, old sidecars and their patch keys are unchanged (tested).
  `brushStrokes`/`mapBrushNodes` (film/retouch.ts) are used by the mask (union of all strokes'
  segments), ROI, move, size/hardness edits and scroll. The overlay draws each stroke and puts all
  of them in the hit area. Sidecar normalising keeps at most 5000 nodes across strokes.
- Tests: 7 new unit tests in `remove.test.ts` (grouping, bridging, off-photo, union mask, saved
  form and key, sidecar round trip, move). The `heal.tsx` fixture covers off/on and persistence,
  waiting, ⌫, Apply (2 spots, `more` on the joined one, one undo step), Esc and Enter, and has a
  `waiting` visual pause. `realtime.mjs heal`, `remove-switch` and `npm run check` pass (675 TS, 81 Rust).
- Oli to try: untick After each stroke, paint an object in 2–3 overlapping strokes plus one apart,
  then Apply. You should get two spots, each filled once, and ⌘Z should undo both. Try Esc, ⌫ and
  Enter, and switching to Heal with strokes waiting. Reopen the app: the option should stay off.

## Remove first frame and thumbnails: display completed patches (2026-11-09)

Oli still saw the object in the first image and thumbnail; then the thumbnail
would load without updating. The earlier restore tests waited until `ready`, so
they missed the first screen draw and the separate thumbnail pipeline.

Implemented, uncommitted:

- Develop skips the embedded camera JPEG for a photo with active Remove spots,
  waits for its saved patches before its first screen draw, and reveals the canvas
  only on a photo-scoped `presented` message. Normal interactive new strokes stay
  responsive. Missing patches can prepare/infer while the first frame waits;
  failures retain the existing explicit failure behavior.
- Histogram work could have cached an unfilled retouch result before restoration.
  The retouch worker's stand-in now records its patch identities; changed completed
  patches are applied synchronously rather than showing that unfilled stand-in.
  Obsolete worker results are rejected after the synchronous replacement.
- Thumbnails restore cached patches with the same source dimensions/domain, origin,
  file size/mtime and recipe key as Develop, and composite them before publishing.
  `useThumb` forwards file-version information from `Thumb`; omitting it caused the
  cache miss/blank thumbnail during implementation. Ordinary thumbnail renders do
  not start inference. Shared-engine contexts are restored after draw submission.
- A new Remove invalidates stale thumbnails; completion retries waiting thumbnails,
  including completion arriving during an in-flight miss. Stale in-flight jobs
  cannot overwrite newer requests or repopulate a cleared thumbnail store.

Regressions went red on both the initial screen draw and original thumbnail fallback.
`remove-first` drives actual Develop + Thumb, holds cache reads while supplying an
embedded original, and compares the **first** screen pixel and JPEG thumbnail to
an independently prepared patched render. Main and worker pass, repeated after
engine disposal and thumbnail clear, with exact cache-key/source-version agreement
and no inference. Unit tests cover updating an already loaded thumbnail and the
completion/cache-miss race. Existing `ai-remove` integration passes; its interactive
stroke case now starts with a displayed unedited photo, distinct from reopening.

Native exact `1OKK6534` scratch replay produced a valid updated 31,158-byte JPEG
thumbnail, then reopened with one cache read and no source/capture/inference work;
first paint 1868 ms. Original RAW and sidecar untouched. Diagnostic log:
`/tmp/emulsion-remove-first-native.log`. Temporary production perf hooks removed.
The large mask's wall-time assertion was flaky under parallel GPU/test load and is
now a deterministic falloff-work bound; pixel-equivalence coverage is retained.
Final validation logs: `/tmp/emulsion-remove-first-final-check.log`,
`/tmp/emulsion-remove-first-{browser,worker,existing,switch,heal}.log`.
No commit or push requested.

## Selected spot in the accent; Remove's pending no longer blinks it (2026-11-09)

Oli found that adding a spot made the selected one flash, and asked for a colour cue for the
selection. Uncommitted, done with the impeccable polish pass (no PRODUCT.md/DESIGN.md: the
incumbent CSS is the authority; offer `/impeccable init` some time).

- Likely cause of the flash: a new Remove spot is selected and pending at once, and the pending
  state pulsed the outline's opacity from .3 to 1, the same channel selection uses (.85 vs .45).
  Pending now marches the solid outline's dashes (`remove-march`, static under reduced motion)
  and leaves opacity and colour to selection. Not confirmed in the app: if the flash also
  happens with Heal/Clone spots, it is something else (perhaps a render), so ask.
- Selected spot (`.retouch-overlay [data-spot].active`): accent outline at full opacity, feather
  ring in accent, brush band in accent at .24. Its heal/clone source stays white, so the target
  and source read apart. The ellipse handles were already accent.
- `RetouchOverlay.tsx` draws the selected spot last, so it sits above the others and takes the pointer first.
- Checked: headless screenshots at the heal fixture's `pending` and `failed` pauses (DPR 2);
  `realtime.mjs heal` and `remove-switch` pass; `npm run check` passes.
- Oli to try: paint a Remove stroke with another spot selected (the old one dims to white, the new
  one is orange with travelling dashes, no blink). Click between spots, then add heal spots.

## Heal tool buttons no longer convert the selected spot (2026-11-09)

Oli found that with a Remove spot selected, clicking Clone turned that spot into a clone.
Fixed, uncommitted. This follows darktable retouch: a click on an algorithm button sets the
algorithm for the next shape, and ctrl+click changes the selected shape.

- `retouchui.ts` `setRetouchTool(tool, spots, toSelected = false)`: unless `toSelected`, it
  commits any draft, deselects, then sets the next spot's tool (Remove still switches to Brush on Photo).
- `RetouchBar.tsx`: a plain click sets the next spot's tool and deselects; ⌘/Ctrl-click changes
  the selected spot. It reads the selection from the store, not from the render. With a spot
  selected, the tooltip mentions ⌘-click.
- `heal.tsx` fixture: checks that a plain Clone click leaves the spot alone and that ⌘-click
  converts it. Remove conversion now uses ⌘-click. `realtime.mjs heal` and `remove-switch` pass,
  and so does `npm run check` (668 TS, 81 Rust).
- Oli to try: select a Remove spot, click Clone (the spot stays, nothing is selected, the next
  click adds a clone). ⌘-click Clone on a selected heal spot (it converts).

## Heal bar: one row, Fill and Blur hidden (2026-11-09)

Oli found the Heal options row cluttered (it wrapped to 2–4 rows); he chose "one row +
options popover" and asked to hide Fill and Blur for now. Uncommitted.

- `RetouchBar.tsx`: the row has the tool (Heal, Clone, Remove), the shape, Size, Feather/Hardness,
  one options button, then **only with a spot selected** its Opacity and delete, then Clear all
  (shown only when there are spots, with the count in its tooltip; the "N spots" text is gone).
- Options button (`ToolOptions`, keyed by tool so it closes on a tool change): for Heal/Clone it
  is the old Detail scales popover (layers icon only while scales are off, else the scale name).
  For a Fill/Blur spot it summarises ("Colour +0.10 · Scale 2", "Gaussian 10 px") and its popover
  holds that tool's settings above the scales. Remove has no options button.
- Fill and Blur are left out of the picker (`HIDDEN_TOOLS`). A spot that already uses one still
  shows its button and options when selected, so old edits stay editable. No recipe change.
- `RemoveControls.tsx`: the setup/recovery row now sits under the bar (inside `.retouch-host`) and
  appears only for download, declined, error/unsupported or failed spots. "Checking…" and the
  idle "Paint over an object…" line are gone (the status bar already says it). Pending shows
  inline as "Removing…" (`RemoveStatus`, count in its label/tooltip).
- CSS: the bar is `nowrap` with shrinking sliders. Container queries on `.retouch-host` hide the
  numeric readouts and tighten spacing at ≤ 900 px, and allow wrapping only at ≤ 640 px.
  The popover opens right-aligned under its button.
- Checked: screenshots at image-column widths 400/800/1200 px in Heal, a selected spot, Fill/Blur
  spots with the popover open, and Remove pending. One row at ≥ 800 px in every state
  (Blur + a selection is ~2 px into the padding). `realtime.mjs heal 60` (main and worker; the
  fixture now asserts Fill/Blur are hidden and opens the options popover) and `remove-switch`
  pass. `npm run check` passes (668 TS, one skipped; 81 Rust). The virtual-clock
  `treatment-filters.mjs heal` still fails on its worker assertion, as noted below.
- Oli to try in the app: click the options button and click away to close it. Drag sliders in a
  narrow window (no readouts). Select and deselect a spot (Opacity/delete appear and leave
  without the row jumping). Download/decline Remove's model.

## Saved Remove patches: restore before preparation on reopening (2026-11-09)

Oli clarified that the removed object reappears when returning to a photo, then
disappears after a long wait. This was the completed patch restoring late, not
an outline/save delay. Fix implemented, uncommitted.

**Cause and regressions:** the frontend always prepared the model's crop before
`remove_inpaint` checked the existing native disk cache. Returning to a photo
therefore repeated source/capture/GPU preparation even on a cache hit. The queue
also waited behind obsolete inference for another photo. Queue regressions failed
with `pending` instead of `ready` while crop preparation / obsolete inference was
held, despite a valid completed patch being available.

**Fix:** `remove_cached_patch(key)` reads and validates the existing binary patch
record without entering the model-worker mutex. The main/worker bridge forwards
this cache-only request. Each newly active Remove context restores matching
patches before generating missing ones; restoration proceeds independently of
obsolete inference. Cache misses, read errors and invalid records regenerate by
the existing path. Navigation/disposal still reject stale results, and patch keys,
model identity, cache format/limits and sidecars are unchanged.

A fresh worker also rebuilt the saved brush mask with the expensive pixel × segment
loop. Rasterization now rejects segments outside conservative per-row/per-pixel
bounds and stops once coverage reaches the union's maximum density. The existing
segment sampler, falloff, full mask bounds and float pixel values are preserved.
An exhaustive per-pixel comparison against the old union covers curved, varying
width/hardness/density, overlapping, faint, single-dab, empty and off-image brushes.
The large-mask regression measured 4.89 s before optimization; it now passes a
2-second ceiling with shared-runner headroom. No quality/density reduction.

**Native exact-file replay:** copied `1OKK6534.RAF` and saved recipe, visible/focused
WKWebView, DPR 2, leave Develop for Library, dispose/recreate the engine, reopen.
Main: disk read 58 ms, ready 695 ms, first paint 695 ms. Default worker initially
still took 4.76 s with cache restoration alone; after mask optimization, disk read
22 ms, patch ready 1004 ms, first/final paint **1378 ms**. Both logged exactly one
`removeCached` and zero `removeInfer`, `removeSource` or `removeCapture` requests
on reopening, with the same saved patch key. These are individual runs, not p95.
Original RAW/sidecar untouched. Temporary perf hooks removed; diagnostic snapshots
are in ignored `.scratch/ai-remove/debug/`. Logs:
`/tmp/emulsion-remove-restore-native{,-worker,-worker-fast}.log`.

Validation: `npm run check` passes (663 frontend tests, one skipped; 81 Rust tests,
12 ignored). The expanded `ai-remove` fixture passes actual pixel comparisons
through main and worker engines across engine restarts, with cold full-source,
capture and inference requests made fatal on cache hits. It also covers cache misses,
regeneration, colour domains and stale results. Fixture typecheck passes. Existing
`remove-switch` checks pass in main and worker modes (held-GPU canvas preservation,
tool changes and repeated zoom). Full check log:
`/tmp/emulsion-remove-restore-check.log`. No commit or push requested.

## Remove tool/zoom latency: stop rasterizing brush masks for bounds (2026-11-09)

The minute-long delay from the blackout investigation is fixed, uncommitted. This
supersedes the **Separate latency remains** observation in the entry below.

**Cause:** `retouch.ts`'s `spotArea` generated a full-resolution brush mask just to
read its rectangle. `retouchInputs` calls it repeatedly while closing regional
source dependencies, and `reducedRegion` calls it even when the completed retouch
pixels are cached. The saved five-node brush on `1OKK6534` made one CPU-only
`retouchInputs` call take 9.99 s. A synthetic three-node brush reproduced it without
a photo, inference, WebGL or other adjustments: the permanent
regression failed at 14.95 s (500 ms ceiling).

**Fix:** share the existing sampled-segment bounds calculation between `spotMask`
and `spotArea`; region planning now visits the stroke segments without allocating
or evaluating a per-pixel mask. The actual mask generation, bounds/rounding, retouch
pixels, filter maths, source density and settled quality are unchanged. No new
cache or invalidation policy. `retouch.test.ts` covers full-resolution dependency
planning and reduced preview bounds for a Remove brush.

**Exact saved-recipe replay**, focused/visible native WKWebView, DPR 2, copied RAW
and sidecar (originals untouched), main mode before/after:

| Action | Before | After | Repeat |
| --- | ---: | ---: | ---: |
| Select first GPU-complete paint | 7321 ms | 63 ms | 65 ms |
| Zoom first GPU-complete paint | 10517 ms | 62 ms | 72 ms |
| Zoom final GPU-complete frame | 65674 ms | 4615 ms | 4820 ms |

The default **worker** engine also completed exact 6246 px-source detail in
4728 ms, first zoom paint 73 ms, Select first paint 90 ms. These are individual
runs, not p95/input-to-photon claims. The remaining ~4.7 s of refinement and ~5 GiB
logical textures are real costs; this change removes the repeated CPU stalls,
not the remaining GPU work/memory. Existing blackout preservation remains in place.
Raw logs: `/tmp/emulsion-latency-{baseline,bounds,repeat,worker}.log`; failing
regression: `/tmp/emulsion-latency-regression-red.log`. The native scratch helper
adds a five-second final-frame assertion. All temporary production diagnostics were
removed, and the throwaway CPU repro was deleted. No commit or push requested.

Validation: `npm run check` passes (653 frontend tests, one skipped; 81 Rust tests,
12 ignored). `remove-switch` passes in main and worker modes, including the held-GPU
blackout regression, tool changes and repeated zoom. `ai-remove` passes its CPU/GPU,
colour-domain, source-selection and main/worker native-bridge integration checks.
Full log: `/tmp/emulsion-latency-check.log`; browser logs:
`/tmp/emulsion-latency-browser-{main,worker,remove}.log`.

## Remove tool/zoom blackout: preserve the canvas until redraw (2026-11-09)

Oli reported RAW `1OKK6534` going black after Remove finished, when switching tools or
zooming. Returning to Remove and Cmd+R do not prevent it; the image eventually returns
about a minute later. The file and saved recipe were located on his external volume.

**Blackout fix implemented, uncommitted:** `DevelopLoop.setState` resized the WebGL
canvas immediately when new view dimensions arrived. That clears its buffer, before
the GPU is idle or staged preparation finishes. Resize now belongs to `Gpu.draw` for a screen target only, immediately before
the final draw. It happens after waits, staged preparation and synchronous offscreen
work too (the real-file trace found long work inside `Engine.render` itself). The last
photo remains on screen during that interval. Both engine modes use the same loop.
No processing maths or quality/source-density policy changed.

- Regression at the loop seam failed before the fix with `expected 'black' to be
  'photo'`; it models real canvas-clear semantics while the GPU is busy. Both toolbar
  and zoom size changes now pass. A queue test also confirms preview-scale changes
  reuse the completed Remove patch without another inference call.
- `tools/browser-tests/remove-switch` exercises the actual Develop view, native IPC
  fixtures, completed brush Remove, pointer press/release, a held GPU during a tool
  resize, Select/Pan/Pick/Mask, and repeated zoom. Chrome/Metal main+worker pass;
  preview/full, lens, capture and profiled-denoise cases included. The fixture also
  asserts that offscreen processing never changes the displayed buffer size. Fixture typecheck
  passes. Existing `ai-remove` integration fixture also remains part of verification.
- Earlier fresh synthetic/default-edit runs did not catch the *interval before* a new
  frame. The new regression explicitly tests that interval. Diagnostic prototypes,
  native runner patch and standalone WK snapshot helper are in ignored
  `.scratch/ai-remove/debug/`. All temporary production debug hooks were removed.

**Separate latency remains:** an exact native scratch replay copied both
`1OKK6534.RAF` and its sidecar, including Portra look, HSL, haze, clarity, object mask
and Remove. In a focused/visible diagnostic native run (before moving the final resize into
`Gpu.draw`), Select took 7.7 s to its next
frame; first zoom paint 10.7 s, exact settle 63.6 s. Zoom prepared 79 steps (21.4 s CPU)
and retained ~4.9 GiB of logical 2D textures; source width 6246, preview 1664. Settled
pixel samples remain nonblack with GL error 0. This is **not a fix for the minute-long
refinement cost**. Do not claim that performance is resolved or reduce settled image
quality to mask it. Logs: `/tmp/emulsion-remove-6534-profile.log`,
`/tmp/emulsion-remove-6534-native-fixed.log`; the longer sweep timed out after recording
several 58–65 s zoom settles. Default-edit control RAW `1OKK6432` stayed visible too.

Validation: `npm run check` passes (652 frontend tests, one skipped; 81 Rust tests,
12 ignored), `remove-switch` passes main+worker, `ai-remove` passes, and the browser
fixture typecheck passes. `capture-cache` passes and the complete GPU probe reports
no GL errors (Remove CPU/GPU max error 2.44e-4, round-trip relative error 3.61e-7).
Probe JSON: `/tmp/emulsion-remove-black-probe.json`. Full log:
`/tmp/emulsion-remove-black-check.log`. Manual follow-up:
Cmd+R, reopen `1OKK6534`, let Remove finish, switch tools and zoom; verify the prior
photo stays visible while replacement/detail processing continues. Original RAW and
sidecar were not modified. No commit or push requested.

## AI Remove: controls, consent, recovery and export warning (2026-11-09)

Issue 05 is implemented, uncommitted. This supersedes the pending-interface notes below.
No model has been installed and no download has been started. LaMa's measured native
speed remains just over the 2-second target; this interface work does not change it.

- **Retouch:** Remove follows Blur. Heal remains the initial default. Choosing Remove
  prepares Brush on Photo (scale 0), permits circles/ellipses, hides Scales and source
  placement, and preserves the selected spot's shape when converting it. Size,
  Hardness/Feather, Opacity, move, delete, clear and undo/redo use the existing edits.
  Source placement reserved for a later Heal is not consumed by a Remove stroke.
- **Setup:** `ui/removemodel.ts` checks native availability without downloading. The
  inline row quotes the actual missing-package size, offers Download / Not now, shows
  native byte progress, and handles unsupported platforms and download/status errors.
  Installation is only called by Download. Completion retries the current photo's
  failed spots. Declined spots remain saved; Set up Remove reopens the choice.
- **Feedback:** worker state messages carry frame identity; the overlay ignores other
  frames. Pending outlines pulse (static with reduced motion), failed spots carry a
  warning marker, and the bar shows errors and Retry Remove. Retry checks installation
  again and sends a photo-scoped queue retry without modifying the recipe or patch key.
  The footer's Remove hint omits source-placement instructions.
- **Export:** it still waits for inference. If filling fails, the dialog names that
  frame and asks Stop export / Export this frame anyway. Stop is focused, Tab stays
  within the choice, Escape stops, and closing/unmounting releases the pending answer.
  Only explicit continue permits rendering an incomplete patch context; completed
  earlier patches remain, later dependent removals stay unfilled. Programmatic exports
  without the callback retain the strict failure/no-write behavior.
- **Validation:** `npm run check` passes: 649 frontend tests, one skipped; 81 Rust tests,
  12 ignored. Four model lifecycle tests cover consent, single installation, install
  failure/recovery and unsupported/listener errors. Queue/export tests cover unchanged-key
  retry, consent, stop and retaining earlier patches. Real-time Chrome/Metal browser
  checks: `heal` in both main and default worker modes, `remove-export`, and the
  existing `ai-remove` integration fixture.
  The heal fixture now uses the actual Workflow grid and covers download/decline,
  progress, pending/failure/retry, brush default, move/resize/delete and undo/redo.
  Fixture typechecks pass. The virtual-clock `treatment-filters.mjs heal` attempt
  outran the retouch worker; use `realtime.mjs heal 60` for this GPU/worker fixture.
  Full check log: `/tmp/emulsion-remove-controls-check.log`.
- **Visuals:** setup, pending, failure and export confirmation inspected; setup checked
  at 1200 and 1440px. No toolbar horizontal overflow. Captures:
  `/tmp/emulsion-remove-{setup,pending,failed}-1200.png`,
  `/tmp/emulsion-remove-setup-1440.png`, `/tmp/emulsion-remove-export-1200.png`.
  Reproduce with `.scratch/ai-remove/visual-check.mjs` (ignored development helper).

Manual try-list: Heal → Remove → Download, paint an actual object at Fit and at 100%;
judge the seam and brush/trackpad feel, move and scroll-size it, test native Cmd+Z/redo,
change WB while regenerating, overlap two removals, switch frames during inference,
and export with the model unavailable. The browser uses deterministic fake inference;
real-photo quality and large-export memory remain unmeasured here.

**Next:** issue 07's conditional fast-model work: produce a verified installable MI-GAN
artifact, native adapter/benchmark, then explicit model choice preserving saved LaMa
identities. SAM click-to-select (issue 06) is explicitly later/out of the first release;
its shape conversion/dilation still needs detailing. Preserve the unrelated uncommitted
noise-reduction, photo-match and look work. No commit or push requested.

## AI Remove: develop worker and export integration (2026-11-05)

Issue 04 is implemented, uncommitted. The model/backend milestone below remains valid;
LaMa still misses the 2-second target, and the app model has not been installed.

- `engine/removequeue.ts` plans and serializes patches for the active photo. Earlier Remove
  spots finish before later crops are prepared. Last patches remain while regenerating;
  source/recipe changes and navigation reject stale native results. Exposure, tones, look
  and a spot's own opacity do not change its patch key. File size/mtime, decode domain,
  pre-retouch edits, model identity and relevant earlier spots do. Deleted patch references
  are pruned. Virtual copies share native cache keys.
- `DevelopLoop`/`DevelopClient` bridge inference, full decode and capture metadata to native
  IPC on the page. Crop processing and readback happen in the engine worker. Main mode
  uses the same loop; crop preparation yields to foreground renders and held pointers.
  This verifies continued rendering, not a native-app 60 fps or end-to-end latency bound.
- `Engine.prepareRemove` runs exact early stages and reads the whole crop plus earlier
  spot dependencies at the selected source's own scale (no reduced retouch). Its separate
  lane restores the foreground lane/clip after each step, bypasses retained capture
  preparation, and frees its targets after encoding. Patches respect RAW Rec.2020,
  linear sRGB JPEG and encoded sRGB thumbnail domains. No shader/texture-unit additions.
- Export decodes full detail for photos with Remove, prepares patches in spot order,
  awaits native completion, and only then renders/writes. A failed removal reports the
  photo in `failed` and writes nothing for that photo. Cancellation discards late results.
  The warning/continue flow is implemented in issue 05 above.
- `ClientEvents.removals` carries per-spot pending/ready/failed states for issue 05.
  The Remove button, consent prompt, overlay and retry/install flow are now wired above.
  No automatic install or consent was added. Native inference itself was previously
  verified; this milestone uses deterministic native fixtures to test integration.

Validation: `npm run check` passes (641 frontend tests, one skipped; 81 Rust tests,
12 ignored). `node tools/browser-tests/realtime.mjs ai-remove 60` passes real Metal GPU
checks: fixed-patch CPU/reference agreement, all three input domains, whole crop/full
source loading, clip restoration, main and worker IPC, continued renders during
inference, downstream edits, WB regeneration and stale-result rejection. The probe's
retouch case also reports fixed-patch error. Browser fixture and probe typechecks pass.
Full check log: `/tmp/emulsion-remove-integration-check.log`.

Try-list now that issue 05 exposes the tool: paint a small removal at Fit (requires full
decode), then a large removal (preview eligible); drag Exposure/look while it works;
change WB and confirm the prior patch stays visible; overlap two Removes and add Heal
after them; zoom/pan, switch photos and undo/delete during inference; export immediately;
then remove/disable the model and check the named export failure. Real trackpad feel,
actual-photo seam quality and export memory at 20+ MP remain manual/unmeasured.

## Refine: separate Noise reduction section (2026-11-05)

Noise reduction now has its own persistent collapsible section after Grain and before
Lens corrections. Both Luminance/Colour and AI controls moved out of Detail; the duplicate
inner heading is removed. Noise reduction resets its two methods independently, and Detail
reset now affects only Detail sliders. This supersedes the Detail-reset description below;
Detail preset membership is unchanged. No processing changes.

Validation: production build/typecheck, 32 focused recipe/noise/workspace tests, and the existing
real-time noise-reduction browser/GPU fixture pass. Additional browser checks confirm section
order, independent collapse and persisted folding; renders inspected at 1200 and 1440px with
the established 320px control panel. Screenshots: `/tmp/emulsion-refine-1200.png` and
`/tmp/emulsion-refine-1440.png`. No commit or push requested.

## Noise reduction (profiled), phase 1: built, Colour on by default for RAWs (2026-11-09)

Phase 1 of [docs/plans/noise-reduction.md](docs/plans/noise-reduction.md): darktable's
denoise (profiled), wavelets/Y0U0V0. Nothing is committed yet.

- **Native:** `src-tauri/src/noiseprofiles.rs` bundles darktable's `noiseprofiles.json` and ports
  its matching. The match goes in `CameraMetadata.noise`; older AI-denoise disk entries fill it in
  from `raw::noise_profile`. LibRaw's "Olympus" is aliased to darktable's "OM System". Matches checked:
  OM-3 ISO 4000, X-T30 II ISO 1600, ZV-1 ISO 500 (`cargo test --lib sample_raws_match -- --ignored`
  with `EMULSION_RAW_SAMPLES`).
- **Reference:** `src/engine/denoiseprofile.ts`. `tools/denoise-reference/` compiles upstream's own
  `process_wavelets` + `eaw.c`; six fixtures, including the "wavelets: chroma only" preset, within 2e-4.
- **GPU:** `shaders/eawdn.frag.glsl` + `engine/denoisegpu.ts`, stepped (yields per pass), with
  working images pooled for 4 s. Images over 4.5 MP are tiled (2048 px cores grown by
  `1 << scales`, per-tile statistics, as darktable tiles). Probe `index.html?profiled`: GPU within
  4e-5 of darktable, tiles within 3e-6 of per-tile reference, engine, Compare/split, JPEG path, defer.
- **Defaults (Oli, 2026-11-05):** like Lightroom/Capture One, RAWs start with colour noise removed.
  `Recipe.profiledDenoise` is a setting, `null` (off) or `'auto'` (`defaultRecipe`): RAW → upstream's
  chroma-only preset (strength 1.2, Y0 0, U0V0 0.5, shadows 0, bias 0), other images off. Sidecars
  from before have no field, load as `null` and render as before (Oli chose "new and unedited only").
  Detail reset returns to `'auto'`. `preRetouchKey` appends it only when present.
- **UI:** Detail → "Noise reduction" heading (`.color-all-title`), Luminance and Colour sliders
  (the flat Y0 and U0V0 forces, 0–100), a sentence naming the matched profile, then the AI option.
  Both at 0 = off. No Strength or Chroma-only controls any more; strength stays at the preset's 1.2.
- **Speed tricks:** (1) a screen render of a source with no result yet (photo just opened, new
  region) shows it undenoised and sets `Engine.inexact`; the refine builds it in steps. (2) While a
  pointer is held, a denoise rebuild skips capture sharpening (20 RL steps after it); the settle
  sharpens. (3) Held, with display density < 0.75 of the source, it is made on a 1/2 or 1/4 copy
  (its own in_scale) and enlarged; the settle makes it exact. (4) The full-resolution capture cache
  builds it in steps.
- **Measured in the app** (`node tools/perf/inapp.mjs <ORF> denoise`, OM-3 at Fit, 1664 px
  preview): Colour drag 22 fps photo / 54–58 fps controls (was 5 / 60), Luminance 24 fps,
  settle ~0.4 s; Exposure with it on 45 fps vs 47 off (that baseline also misses 55). Still FAIL
  against the bar. Main-thread long tasks are higher during noise drags (~500 ms/s vs ~250):
  not yet looked at.
- **Open:** profile scale on real photos unverified (flat-patch variance vs `a·mean + b`, plan
  1.7); no comparison with a darktable export yet; things for Oli to try listed in the session
  summary (open/zoom/drag/release, Compare, split, a JPEG, AI + profiled together).

## Fuji X-Trans III local look pack (2026-11-05)

Oli asked to add the Fifteen X-Trans III LUTs from the G'MIC Film LUTs collection
(`Film-Luts-main/luts/fujixtransiii`) as looks. They are installed unchanged in the
ignored `local-looks/fuji-xtrans-iii/` folder and appear as **Fuji X-Trans III (local test)**
in Develop → Presets → Looks (`lut:fuji-xtrans-iii:*`). Unlike the earlier fuji-test and
spektrafilm local packs it is not marked hidden: `localPack` now takes a visibility flag,
so the browser offers this collection instead of filtering it out. Each 13-point Cube is covered by
its SHA-256 in `catalogue.json`/`manifest.json`; a README records that provenance and
input encoding remain unverified. Dev-only, no pipeline/shader changes, no custom looks
written to app data. All 613 frontend tests pass (one opt-in skipped); the existing
`tsc --noEmit` failure in `src/engine/denoiseprofile.ts` is unrelated and was already
present. No commit or push requested. Restart the dev server (or Cmd+R) if the new
catalogue is not discovered.

## Build Look: LUT matching restored, hue transfer added (2026-11-04–05)

Oli asked to remove Same photo. He clarified that the other mode accepts any photo,
but overall the controls fitter still looked poor; the original LUT version looked
better despite not shifting hues. He explicitly chose **Restore LUT matching and
improve hues**. This supersedes the rejected controls-fitting direction.

- **One flow:** Build Look → Photo match → choose a finished JPEG/PNG/TIFF/WebP →
  Match this photo. Same photo/Different photo selection and its production API,
  fitter and worker are removed. The controls experiment is archived under ignored
  `.scratch/photo-match/controls-iteration/` and `curve-experiment/`.
- **Generated LUT:** `film/photomatch.ts` again fits tone quantiles, per-hue chroma
  and neutral tint and bakes a 33³ display-sRGB LUT in `photomatch.worker.ts`.
  `library/photomatch.ts` renders the current camera/WB/exposure/lens baseline through
  the existing offscreen engine, excluding authored look controls. Matching replaces
  the optional base LUT while preserving those authored controls. Use a fresh draft
  when comparing against the rejected controls fit, so old fitted controls don't compound.
- **Hue transfer:** local circular hue-histogram alignment over ±45°, normalized
  correlation, minimum support and confidence/improvement gates. Hue fitting uses
  residual differences after the base tone/chroma/tint transform to avoid applying
  a tint-induced hue change twice. Original neutral colours retain their fitted tint.
  Unsupported hues
  retain identity. The shift field is smoothed across the red seam and constrained
  so neighbouring hues cannot fold backwards. The explicit **Match hues** checkbox
  defaults on; off recovers tone/chroma/tint matching without hue alignment. **Keep
  my photo's brightness** is optional and defaults off.
- **Persistence/UI:** existing content-addressed `.cube` storage, parsed LUT cache and
  worker mirroring are restored. Settings retain file hash and reference display name,
  never the reference path or pixels. Intensity/blend/remove appear on the right.
  Generated matches stay out of the Imported LUT grid. Saved looks reopen without
  the reference. Save guarding, cancel/unmount, session/recipe identity checks and
  single-step undo/redo remain. The failed controls fitter no longer runs in the app.
- **Sampling:** the area-average regression fix is retained. Target/reference statistics
  use `MATCH_ANALYSIS_EDGE` (192px); a 768px checkerboard averages to the same purple
  as its small fitting preview. Tone quantiles still merge repeated anchors to avoid
  artificial contrast in clipped images. A monochrome reference can remove chroma.
- **Evidence:** unit tests include actual 20° hue-palette transfer across the red seam,
  compared with hue transfer disabled, with lower angular error. A separate test
  locks down neutral-tint preservation while coloured regions shift. Existing LUT identity,
  tone/exposure, saturation/cast, monochrome, flat/clipped, transparency and `.cube`
  round-trip checks pass. The native-file/GPU browser fixture covers removal of the
  photo-type selector, LUT generation/replacement, GPU/CPU interpolation, save/reopen,
  undo/redo, pending Save guard, cancellation and stale results.
- The opt-in real sample is not Oli's exact failing pair. On the local bridge/Fuji
  test, RGB MAE is ~1.13% with hue transfer and ~1.11% without, versus 3.20% ungraded;
  enabling hue transfer is not a universal improvement on all measures. It must be
  judged visually for each reference. No claim that the actual user pair is solved.
  Reproduce with `EMULSION_MATCH_SAMPLE=/tmp/pm-target.bmp` and
  `EMULSION_MATCH_LUT=local-looks/fuji-test/Emulsion_Fuji_CLASSIC-Neg_sRGB_65_r2_bcd6063a.cube`
  then `npx vitest run src/film/photomatch-quality.test.ts` (normal suites skip it).
- Validation: `npm run check`; `node tools/browser-tests/realtime.mjs photo-match 60`;
  browser fixture typecheck. Final checks pass: 613 frontend tests, one opt-in
  skipped; 76 Rust tests, 11 ignored. Real-time GPU/CPU LUT and save/reopen checks
  pass. Independent scoped interface/integration review returned ship, including
  the residual-hue/neutral-axis delta. Visual acceptance on Oli’s own pair remains manual.
- Interface preserves the established neutral colours and controls. The builder respects
  the native 960px minimum width; other workspaces retain the existing 1200px body minimum.
  Manual follow-up: try a fresh look with an actual reference, compare Match hues on/off,
  intensity and Colour blend, save and reopen. Native picker/trackpad feel remains manual.

Other uncommitted AI Remove work below is preserved. No commit or push was requested.

## AI Remove: model verified and native backend built (2026-11-04)

Oli asked to continue Remove. Issues 01 and 02 are implemented, uncommitted.
Read [native contract and benchmark](docs/research/lama-native.md),
[LaMa fidelity](docs/research/lama-onnx-fidelity.md) and
[the conditional MI-GAN experiment](docs/research/migan-fidelity.md) before continuing.
The agreed spec and tickets remain in `.scratch/ai-remove/` (untracked).

- **LaMa fidelity passes:** six private crops, original unmodified PyTorch generator
  versus pinned Carve FP32 ONNX. Worst masked p99 0.00177/255 (limit 2/255), no
  visible conversion differences. A bottle substitutes for the unavailable person
  sample. `tools/inpaint/` reproduces downloads, crop preparation and comparison;
  photos/weights/PNG results stay outside tracked files.
- **Native backend:** `inpaint.rs`, `inpaint_cache.rs`, `inpaint_commands.rs`,
  `inpaint-probe` and typed wrappers in `backend/api.ts`. Installer/runtime code
  was extracted from `ai_masks.rs` into shared `ai_models.rs`. Install is explicit,
  downloads are pinned/verified, inference is serialized off-thread, and patches
  persist in app data with a 512 MiB LRU bound and integrity checks. Cache hits
  skip model/runtime loading. App exit releases the retained session. The app's
  LaMa model has **not** been installed; only ignored development assets exist.
- **Speed target missed:** final native CPU load 1.423 s, first patch 2.178 s,
  warm patches 2.154 / 2.143 / 2.110 s on the M2. CPU is selected. Static-batch
  CoreML errors on a required Fourier Gather feature; symbolic-batch CoreML was
  slower and is not evidence of Neural Engine execution. Raw JSON reports live
  under `docs/research/`. SHA-256 is optimized
  in dev to avoid an unrelated ~9-second model-verification delay.
- **Conditional fast option investigated:** original MI-GAN static 512 core exported
  locally, fidelity passes on the same six crops, Python ORT mostly ~0.25 s (one
  0.69 s sample). It remains a candidate, with no native adapter or installable app
  artifact. Published MI-GAN ONNX files are uint8 pipelines with their own extra
  crop/blend, not this pure core. Preserve LaMa's identity for existing spots.
- **Validation:** final `npm run check` passes: 605 frontend / 76 Rust tests,
  11 ignored, recorded in `/private/tmp/emulsion-remove-check-verified.log`.
  Three new binary IPC tests and three Python gate tests pass. The frontend count
  includes concurrent photo-matching tests. The ignored real-LaMa inference test was run successfully;
  native PNGs match the reference within one 8-bit step. No engine/shader/UI changes
  were made for this milestone, so no new GPU/UI test was needed.

**Issues 04 and 05 are now implemented above.** The next model milestone is issue 07's
verified installable MI-GAN artifact and native integration.
The old continuous-zoom blocker has landed; use `DevelopLoop`/`DevelopClient`, not
the archived pre-worker effects. In particular, generate full crop context at the
selected preview/full source's own scale: ordinary `retouched` reads only the
spots' bounding region and may use `retouchReduced`, so simply forwarding its
requests can leave `PatchRequest.input` absent. Preserve spot order, last-patch
stand-ins, source/recipe identity and stale-result rejection. Recheck display-input
colour conversion when wiring JPEGs; `encodeModelInput` expects scene-linear
Rec.2020. Export must await patches and explicitly handle unfilled spots. Benchmark
failure is documented, not waived; the fast-model ticket still needs native work.

Controls remain paused as described below. Other preset/look work was concurrently
committed by another session; preserve it. No commit or push was requested here.

## Capture preparation survives zoom and pan (2026-11-04)

The next task from the previous handoff is implemented. `DevelopLoop` retains one capture
preparation generator keyed by the full source, capture metadata, noise input/amount and
capture iterations. Viewport changes and downstream edits pause it for foreground work or
interaction, then resume the same passes. Actual input changes, disabling capture, navigation,
source release and disposal cancel it and free scratch. Foreground regional and whole-source
fallbacks never consume or replace its partial output. The MessageChannel scheduler now keeps
independently cancellable continuations for foreground and background work. Completed jobs are
reused while their result is valid, and can restart if foreground work replaced that result.
No filter maths, source density or GPU batch/submission limits changed. Controls remain paused.

Read [zoom-detail.md, Preserving unfinished capture preparation](docs/research/zoom-detail.md#preserving-unfinished-capture-preparation-2026-11-04)
and `captureJobPreservation20261104` in its raw JSON for commands and measurements.

- **Lifecycle verified in the real app:** early 50% pinch retained generation 1, with progress
  26 → 66 passes at sharp detail → 95 ready. It became ready 117 ms after the harness's
  post-gesture settling period. Changing capture 100 → 25 invalidated immediately and built
  generation 2 (1836 ms until ready in this sample).
- **First zoom is still slow:** early pinch 1399 ms versus 1300 ms before this change; both
  exceed 1000 ms. Preserving background progress does not accelerate the foreground regional
  fallback. Confirmed-ready 50% pinch was 768 ms and Z was 391 ms. Individual samples, not p95;
  one ready-pinch run lost focus and is discarded.
- **Memory trade-off:** early pinch logical texture peak 1832 → 2595 MiB because unfinished
  full-source output/scratch remain allocated alongside the foreground region. Ready Z peaked
  at 1664 MiB; ready pinch/settings later reached 3731 MiB including other buffers/spares.
  The completed capture result remains 264.9 MiB. CPU/driver/RSS are excluded.
- **Checks:** `npm run check` passes (597 frontend, 70 Rust, ten ignored); 21 loop tests cover
  preservation, foreground priority, interaction/GPU waits, independent queued continuations,
  completed-result replacement and cancellation. GPU capture-cache also covers suspended work
  interleaved with foreground renders, validation, exact pixels, noise and scratch release.
  The resumed 26 MP RAW whole result and nine regional copies at three scales/positions
  match the whole-source reference with zero differing RGBA float values. GPU region-detail
  (full, capture, fidelity), real-time zoom-full-res and both browser-test typechecks pass.
  Zoom-full-res now allows the already-removed preparation delay: Fit stays stable while
  preparation starts immediately, and foreground zoom must share that in-flight decode.

Remaining performance work: full decode/upload when not ready, full-source contrast readback
(330–515 ms in these samples), foreground regional capture and working-image allocation.
Broader texture memory and real trackpad feel with normal edits remain open. Oli requested
committing and pushing this follow-up; local `.codex/` and `.scratch/` files remain outside it.

## One "Loading full resolution" status for the whole wait (2026-11-04)

`src/ui/FullResolutionStatus.tsx` (styles `.stage-status.loading-full`) is the stage's bottom-left
chip, on the scrim like the zoom bar, for both waits for full detail: the full decode
(`loadingFull`) and, zoomed in and not cropping, the engine preparing exact detail while the soft
stand-in shows. Oli asked for the second wait to say "Loading full resolution" and share one status
with the first. `DevelopLoop` posts `{ type: 'sharpening', pending }` on change only (true when
`prepareFrame` starts, false after the next screen render or an error); `ClientEvents.sharpening`
carries it to Develop.tsx. The chip appears after 280 ms, fades in 220 ms / out 180 ms, and its dot
pulls from blurred to crisp; reduced motion makes it static. Two loop tests cover the message.
Oli should try in the app: open a RAW (decode wait), Z to 100%, pan and release, drag a slider
while zoomed; the chip should cover the soft-to-sharp wait and never flicker at Fit.

## Capture sharpening cache: implemented and measured (2026-11-04)

**Follow-up:** Oli requested removal of the 750 ms pause. Preparation now starts on the
next event-loop turn once the preview is available. Only the focused image-cache tests
were rerun for this small change; the measurements below predate removing the delay.

One bounded whole-photo capture result now belongs to the active full-resolution source,
independently of preview/histogram lanes. Eligible RAWs (base payload ≤256 MiB) prepare it
while idle after immediate background decoding; Fit stays on the preview. Background
and foreground loads share the decode, upload and capture metadata. A ready result supplies
exact sharpened region pixels across zoom, pan and downstream edits. Source/metadata, noise
input/amount and capture iterations invalidate it. Navigation/new input/disposal cancel
unfinished GPU passes and free scratch; early zoom keeps the regional fallback.

Read [zoom-detail.md, Whole-photo capture cache](docs/research/zoom-detail.md#whole-photo-capture-cache-2026-11-04)
and `captureCache20261104` in its raw JSON for measurements, commands and limits.

- **Warm benefit, real 26 MP RAF / WKWebView / DPR 2:** Z 1164 → 392 ms; pinch stops
  50% 1783 → 766 ms, 63.7% 901 → 483 ms, 100% 550 → 383 ms. Repeat warm pinch:
  883/501/384 ms on the final tree. Individual samples, not p95; capture on, Texture/Clarity/Dehaze off.
- **Not instant cold detail:** whole-photo capture took 1.79–1.91 s after decode/upload.
  A six-second viewing pause did not always finish it. An early pinch during deconvolution
  cancelled the partial cache and took 1384 ms via regional capture (still fails 1000 ms).
  Changing capture 100 → 25 invalidated immediately; ready again after 1251–1349 ms.
- **Memory:** result 198.7 MiB base / 264.9 MiB including mipmaps, plus input and scratch.
  Worker logical texture peaks: warm Z 1664 MiB vs disabled 899; three-stop pinch 3110
  vs 3000. Includes other caches/spares; excludes CPU/driver/RSS. Broader memory remains open.
- **Faithfulness:** unchanged capture maths. Real RAW whole output and nine cached-region
  copies at three scales/positions match the exact whole-source capture reference, all RGBA
  float values exactly. Synthetic GPU regression also covers stopped/active tiles, edges,
  ownership, edits, noise, cancellation and release.
- **Checks:** `npm run check` passes (585 frontend, 70 Rust, ten ignored), standalone browser
  test typecheck, GPU `capture-cache`, `region-detail` (full, `capture`, `fidelity`), and
  real-time `zoom-full-res`. The zoom test allows the shared status's 280 ms appearance delay.
- **Comparison switch:** `VITE_CAPTURE_CACHE=0` restores decode-only preparation/regional
  capture. `VITE_PERF_WAIT_CAPTURE=ready|building` makes perf readiness explicit; memory and
  capture-only counters are available in worker stats. GPU checks run separately from timing.

**Manual check:** Oli should try real pinch, Z and pan at 50%, 100% and an intermediate scale,
including zooming immediately after opening a RAW and changing capture sharpening. Confirm
its feel with usual edits. Controls work remains paused. The scheduling fix, capture cache
and loading-status UI are included together; preserve them while addressing the next task
above. Do not push without Oli's instruction.

## Zoom detail: worker scheduling improved (2026-11-04)

Oli reported a slower soft-to-sharp transition after zooming and asked whether capture
sharpening can be baked in. The scheduling fix is implemented, validated and included
with the capture cache.
Read [zoom-detail.md, Worker preparation scheduling](docs/research/zoom-detail.md#worker-preparation-scheduling-2026-11-04)
and `workerScheduling20261104` in its linked raw JSON for evidence and limits.

- **Cause reproduced:** current worker prepared Z took 1593 ms; instrumented repeat 1523 ms,
  with 107 preparation advances and 709 ms between them (GPU waits plus scheduling).
  A cached final screen draw alone hid that cost.
- **Fix:** `DevelopLoop` advances at most four passes or 4 ms per turn via cancellable
  MessageChannel tasks, waiting for GPU idle between batches. Busy polling remains a timer.
  Existing per-draw flushing/bands, processing maths, precision and source density remain.
  New inputs cancel queued work; dispose closes the ports.
- **Measurements, 26 MP RAF / WKWebView / DPR 2:** prepared Z 1593 → 994 ms (another trial
  1051 ms). Fresh pinch sequence: 50% 2150 → 1700 ms, 63.7% 1483 → 843 ms, 100% 1100 → 566 ms.
  First stop includes upload/capture-threshold measurement; later stops reuse them. These
  are individual samples, not p95. First 50% still fails 1000 ms and had a 124 ms screen gap.
- **Harness:** `node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomsettle` times a pinch to
  .5/.637/1, validates final scale and focus/visibility, rejects older state sequences and
  inexact/stand-in/draft frames. `VITE_PERF_STOPS` overrides stops; `VITE_PERF_ZOOM_EFFECTS=1`
  enables Texture/Clarity/Dehaze (not timed this session). Frame stats now include preparation
  elapsed/submission/resume time in worker mode. Draw counts/texture MB remain main-mode only.
- **Capture caching:** whole-photo sharpened pixels could be reused across zoom/pan and
  downstream edits, invalidated by source/capture metadata, noise input or capture iterations.
  This adds ~199 MiB retained for this photo plus large temporary buffers/up-front GPU work.
  No whole-photo sharpening cache or speculative GPU allocation was added. The existing cache
  is regional; source upload, the ~260–290 ms full-source threshold measurement and large-region
  deconvolution remain candidates. Cold RAW decoding and effect-heavy latency remain open.
- **Checks:** `npm run check` passes (577 frontend, 70 Rust, ten ignored); GPU
  `region-detail` (full, `capture`, `fidelity`) and real-time `zoom-full-res` pass. Five new loop tests cover progress,
  cancellation, batching, GPU waiting and disposal; restoring old scheduling fails four.
  Timing runs were sequential; an early harness overshoot/overlapping GPU check was discarded.
- **Review:** scheduling preserves generator order and cancellation; existing exact-output,
  capture and release regressions pass. No filter/shader changes. No commits or pushes.

Controls work remains paused at Oli's request. Keep settled output faithful. Performance
samples above do not establish smoothness for every gesture; Oli should try real trackpad
pinch/zoom and pan at 50%, 100% and an intermediate scale with his usual edits.

## Controls work: paused (2026-11-04)

The engine-worker migration and LiveRange are done and Oli felt them ("everything is feeling way
quicker from a slider perspective"). Left open, for when this resumes:

- **Mask Texture's controls** run at 44.8 fps because its live frame keeps the GPU full (33 ms per
  frame, back to back). Oli has not chosen yet: make the masked live frame cheaper, cap the GPU's
  duty while a control is held (trades photo fps), or both (recommended). Evidence in
  [docs/research/engine-worker.md](docs/research/engine-worker.md), "LiveRange".
- Global sliders' controls are at 58–59.5 fps, mostly missing the bar (58 fps, no frame over
  25 ms) by one to four frames per drag; HSL has an 83 ms frame.
- Clarity and Dehaze change "quite drastically" on release (Oli, deferred; see below).
- The shared offscreen engine (`library/thumbs.ts`: thumbnails, tile renders, export,
  perspective) is still on the main thread. It doesn't compete during a drag (thumbnails wait
  400 ms), but it is the remaining main-thread WebGL user.
- Oli has not yet tried: curves and the grading wheel (same once-per-frame delivery), and the
  list under "Oli should try" below.

## Engine worker: the develop engine is off the main thread (2026-11-04)

Oli wants every control (sliders, knobs, curves, wheels) at 60 fps or better while dragging,
even when the photo drops to 30. He asked to start the migration; **the develop view's engine
now runs in a worker.** Read [docs/research/engine-worker.md](docs/research/engine-worker.md)
and ARCHITECTURE.md "The develop engine's thread" first. No commits.

- **Built:** `engine/developloop.ts` (render loop, sources by key, idle preparation, warming,
  histogram: ported from Develop's effects with the same rules), `engine/develop.worker.ts`,
  `ui/developclient.ts`. `Develop.tsx` talks only to the client; pickers and the object
  encoder's pixels are promises. Profiles/LUTs are mirrored into the worker's stores
  (`profileSnapshot`/`adoptProfileSnapshot`, `provideLut`/`mirrorLuts`). `Gpu.flushEach` +
  scissored 1 MP bands keep GPU submissions short in the worker (WebKit paints the page through
  the same GPU; a long submission blocked the controls). `emulsion.engine=main` /
  `VITE_ENGINE=main` runs the loop on the main thread.
- **Result:** Capture Sharpening at 50%: controls **2.7 → 60.3 fps**, worst freeze 437 → 33 ms,
  photo still ~4 fps. Global Texture/Dehaze/Exposure at 50%: 58–60 fps, worst 35–47 ms.
  Masked Texture at 50%: **40.7 fps, 25 stale frames**: main-thread React work (4–5 ms per
  mask input), not the engine (0 ms on the main thread).
- **Oli, after trying it (2026-11-04):** "everything is very quick". He noticed Clarity and
  Dehaze change "quite drastically" once the new value is applied (the settle after release).
  Deferred at his request until the rest is done. Unconfirmed lead: below 1:1 the live drag
  samples the preview's Clarity/Dehaze maps (the direct-preview-sampling candidate below), and
  the exact settle differs from it.
- **Started step (1), not yet timed:** `ui/LiveRange.tsx`, a drop-in range input: thumb from
  its own state at once, the value sent to the app at most once per display frame, flushed on
  pointer-up/cancel/blur/key-up before the row's own handler (keeps the drag's undo step).
  Replaces every photo-affecting range input: Panel rows and HSL, mask sliders, white balance,
  colour grading sliders, lens, noise, transform, crop/straighten, retouch bar, look amount,
  Look Creator. Readouts now update once per frame (by design); the perf driver's stale-frame
  check allows one frame of lag. `npm run check` passes. **Not measured**: the
  `maskinteraction` run was stopped when Oli asked for a new session. Oli should feel the
  sliders once (drag, double-click reset, typed values, undo after a drag, arrow keys).
- **LiveRange timed (2026-11-04, later session).** Controls fps / worst frame at 50%: Exposure
  58.3 / 45 ms, Texture 59.2 / 33, Dehaze 59.5 / 25 (passes), Clarity 59.4 / 38, HSL 55.8 / 83,
  Sharpen 58.4 / 44, Capture 58.7 / 35 (photo 0.8 fps), Mask Exposure 58.4 / 30, Mask Texture
  44.8 / 61 with 6 stale (was 40.7 / 58, 25 stale). Most drags miss only by one or two frames.
  Mask Texture: GPU-bound, not React (about 4.5 ms of React a frame; capping live frames to one per
  50 ms took its controls to 53.8 fps / 37 ms, photo 15 fps; smaller bands did nothing).
  The full `interaction` set no longer fits in 600 s; run it in two parts (see the report).
  `build.rs` fix: the copied `libomp.a` is read-only (Homebrew's mode), so a rebuild failed with
  PermissionDenied; it is now removed before copying.
- **Next, in order (was):** (1) time LiveRange (done, above) (the LibRaw crash that stopped runs is fixed): `VITE_PERF_SCALE=0.5 VITE_PERF_SLIDER=exposure,texture
  node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF maskinteraction 600`, then `interaction`;
  curves and the grading wheel now go through the same latest-wins hook (`useFrameLatest` in
  `LiveRange.tsx`: shown at once, sent once per frame, flushed on pointer-up/cancel), done
  2026-11-04, `npm run check` passes, not yet felt by Oli;
  (2) move the shared offscreen engine (`library/thumbs.ts`: thumbnails, tile renders, export,
  perspective) into a worker too; (3) the perf driver's draw counts/texture MB in worker mode
  (now main-mode only); (4) re-run `interaction` and `maskinteraction` (capture, clarity, HSL,
  sharpen too) for the `controls` line; the bar is 58 fps, no frame over 25 ms, no stale frames.
- **Oli should try (not checkable headlessly):** open several photos (RAW and JPEG), drag
  sliders at Fit/50%/100%, pinch and Ctrl+scroll zoom, pan, crop and straighten, brush and
  ellipse masks, the mask range picker, object select, Heal (Q), white-balance picker (W),
  before/after (\) and split (Y), clipping (J), change look and camera profile, histogram
  updates, export. If anything misbehaves, `localStorage.setItem('emulsion.engine','main')` in
  the dev console and Cmd+R brings back the old main-thread path for comparison.
- **Tests:** `npm run check` passes (572 frontend, 70 Rust, 9 ignored). Browser runners default
  to main mode. `zoom-full-res`, `heal`, `retouch-sliders` fail in virtual time **also on the
  pre-change code** (rAF stalls); they pass with `realtime.mjs`. Probe not rerun (engine maths
  unchanged; banding only in the worker).
- **LibRaw/OpenMP crash: fixed (2026-11-04), needs app runs to confirm.** Cause, reproduced
  outside the app: the app's *static* libomp shuts its runtime down when the last thread that
  used OpenMP exits, and tokio's blocking threads exit when idle; the next LibRaw call (its
  allocator's `#pragma omp critical`) took a dangling lock. No concurrency needed: two
  short-lived threads in a row crash it every time. Fix: `raw::openmp_root()` parks one
  thread for the app's life as an OpenMP root (`emu_omp_root` in `raw_shim.cpp`), called
  before every LibRaw entry (`raw.rs`, `capture.rs`). `build.rs` now links the static
  archive for test binaries too (they had silently picked Homebrew's dylib, which hid the
  crash). Regression: `EMULSION_RAW_SAMPLES=~/Pictures/1OKK6432.RAF cargo test --lib
  libraw_survives -- --ignored` crashes with SIGSEGV without the fix, passes with it.
- Files this session: `src/engine/{developloop,develop.worker}.ts` (new),
  `src/ui/developclient.ts` (new), `src/dev/gpuload.worker.ts` (new), `src/ui/Develop.tsx`,
  `src/engine/{gpu,engine,profilestore,lutstore}.ts`, `src/library/thumbs.ts`,
  `src/ui/objectselect.ts`, `src/dev/perfrun.ts`, `tools/perf/inapp.mjs`, `src/ui/LiveRange.tsx`
  (new) and the range inputs in `src/ui/{Panel,MaskControls,WhiteBalanceControls,ColourGrading,
  LensControls,NoiseReduction,TransformControls,CropControls,CropBar,RetouchBar,LookChooser,
  LookCreator}.tsx`,
  `tools/browser-tests/{realtime,treatment-filters}.mjs`, docs. Committed 2026-11-04. Backup of the tree before the
  migration: `/private/tmp/claude-502/-Users-oli-Dev-emulsion/ae95bf8e-3a47-4127-9902-f2f6e8ce1036/scratchpad/before-worker.diff`
  (stash object `32bab16`).

## Performance paused: move the engine off the main thread (2026-11-04, earlier)

*History: the engine is now in the worker, so zoom work can resume (top section).*
**Oli paused continuous-zoom/performance optimization for the UI/engine split.**
This handoff replaces the old performance resume instructions in the research reports
and `docs/plans/perf-sessions.md`. No commit or push was requested or made.

The performance agent has stopped changing these files and left their current
implementation intact for the worker migration:

- `src/engine/engine.ts`
- `src/engine/gpu.ts`
- `src/ui/Develop.tsx`
- `tools/perf/inapp.mjs`

No performance runner or browser-test runner remained active when this pause began.
The checkpoint is the last tested implementation, with known performance failures;
it is not a claim that the entire dirty worktree is ready to commit. Only handoff
and archival documentation were changed for this pause. Oli decides what to commit.

## New priority and acceptance criteria

Oli's requirement is **60 fps or better for every control while dragging**, including
sliders, knobs, curves and wheels, even if the photo renders at 30 fps. The old photo
benchmark target (55 fps, no screen gap above 50 ms) does not certify control smoothness.
No independent UI frame-rate result exists yet.

The requested sequence, not implemented by this performance agent:

1. Extend `tools/perf/inapp.mjs` and its driver to measure thumb updates per second
   and main-thread long tasks separately from photo rendering fps and GPU latency.
2. Give controls immediate local drag state/readouts. Send the current value to a
   latest-wins slot consumed by the engine each frame, without queueing every input.
3. Move the engine into a Web Worker using OffscreenCanvas/WebGL2, targeting macOS
   14+. Convert histogram, pickers, export, thumbnails, mask overlays and object
   selector requests/results into async messages.
4. Keep GPU submissions short enough that window compositing stays responsive.

Current coupling: `Develop.tsx` around line 550 drives rendering and preparation on
React's thread; `Panel.tsx` around line 80 derives controlled slider values from the
recipe. Pass construction, allocations, shader compilation and remaining synchronous
reads compete with input handling and React updates. Moving just the final draw or
adding more timers does not establish the requested separation.

Histogram and developed thumbnails already use pixel-pack buffers/fences through
`readPixelsAsync` / `renderToCanvasAsync`. Those helpers still call synchronous
`render` before their first await. They are useful pieces to preserve, not an
existing worker boundary. Dehaze ambient and capture-threshold reads still block.

## Finished mechanisms to keep and carry into the worker

| Work | Current state and evidence |
| --- | --- |
| Faithful settled effects | Full source-density maps and filter support are restored at every zoom, including Sharpening. Settled output does not use the rejected smaller effect maps. The first faithful candidate matched the real RAF reference exactly at 50%, 63.7%, 75% and 100%, both combined and per effect. The final refactor still needs the real-photo comparison repeated. |
| Cancellable preparation and pass staging | `renderSteps` yields between allocations/passes, including region copies, capture deconvolution, Dehaze, Texture, Colour, Clarity and USM. `prepareFrame` is a generator advanced between GPU fences. Cancellation releases scratch and invalidates partly overwritten maps. Synchronous `render` drains the same algorithm. Carry this engine mechanism into the worker; replace the main-thread scheduler. |
| Correct release/settle handling | The final value after pointer-up is prepared even when the previous live frame used no held maps. Held inputs wait; pointer-up, blur and cancellation resume preparation and show the final frame. Preserve these lifecycle semantics across messages. |
| Exact masked-Dehaze reuse | An amount-only edit reuses the instance's unchanged input and mask. Input, geometry, refinement and transmission-scratch changes invalidate the caches. GPU regression was red before the fix, then green on whole and regional paths; cached results equal fresh renders through sign, shape, upstream and refinement changes. No filter maths or density changed. |
| Capture metadata correctness | Late/replaced capture data invalidates copied regions and cached results, including noise-reduced inputs. Regions retain the full source's measured contrast threshold. The 26 MP clip-mask expansion uses an indexed loop: 555 ms became 26–29 ms in the recorded session. |
| Exact decode preparation | Bounded background preparation coalesces with foreground loads in the existing 512 MiB cache, admits payloads up to 256 MiB, cancels pending work on navigation/edit/unmount and does no speculative noise reduction or GPU preparation at Fit. Preserve the cache/admission correctness. The native OpenMP optimization has an unresolved crash, detailed below. |
| Async output readback and benchmark honesty | Preserve buffer/fence readback cleanup and concurrent-output checks. The harness includes activation, zero crossings, release and all preparation; rejects interrupted/focus-lost samples; and requires capture metadata, no stand-in/draft, GPU completion and two rAFs for strict zoom detail. Adapt instrumentation to the worker protocol. |

These are tested mechanisms to retain as the migration baseline, not a completed
responsiveness fix. Individual GPU passes, CPU reads and whole-source work can still
exceed the budget. Export/settled port maths and existing quality tolerances stay faithful.

## Half-done candidates and remaining failures

- **Live direct preview sampling:** below 1:1, held regional drags sample preview
  Dehaze/Texture/Clarity/USM maps at whole-photo coordinates while retaining the
  sharp source. Colour adds a bounded signed RGB delta. This avoids regional map
  copying/allocation on activation, but final native timing and temporary-look
  acceptance are incomplete. Live preview USM uses a display-derived radius so the
  slider remains visible; settled USM retains the original sensor-pixel radius.
  Keep these as isolated candidates, not settled-quality policy or a proven fix.
- **Motion:** cached faithful regions or the preview stand in during zoom/pan;
  construction waits until rest. The final candidate has not passed the complete
  arbitrary-stop/pan, cold-source and memory matrix. Cursor anchoring and retained
  small-pan correctness passed earlier tests.
- **Memory and time to finished detail:** remain failures/unknowns independently of
  fps. The latest masked-Dehaze sample took 2045 ms to settle and reached 6626 MiB
  logical textures (not a resident-memory measurement). No memory ceiling is proven.
- **Reported controls:** masked Clarity/Dehaze/Texture and global Exposure/Dehaze/
  Capture lag; others may too. The report is not limited to 50%. Masked Texture/
  Clarity and the broader control survey still lack completed focused native results.

Last valid native samples on the 26 MP RAF, 1552×1036 canvas, DPR 2, WKWebView:

| Scenario | Photo fps | Worst screen gap | Interpretation |
| --- | ---: | ---: | --- |
| Global Dehaze, 63.7% | 56.9 | 63 ms | Throughput passes the old bar; gap fails. |
| Masked Dehaze before exact reuse, 63.7% | 49.1; repeat 46.4 | 172; repeat 214 ms | Both fail. |
| Masked Dehaze after exact reuse, 63.7% | 48.3 | 137 ms | Redundant passes removed; still fails. |
| Capture Sharpening, 50%, 30-input sweep | 2.6 | 403 ms | Median input-to-GPU latency 514 ms. Live capture deconvolution runs over 4352×3520 and reallocates scratch when the iteration count changes; 1587 MiB allocated across the gesture. Measured, not fixed. |

These are individual samples, not p95 claims or UI-thumb frame-rate measurements.
Unfocused Exposure/Capture attempts are invalid and must not support conclusions.

Earlier numbers that must not be presented as final-candidate results:

- Pass staging reduced one 63.7% zoom-stop gap from 362 to 56 ms, but settling took
  2955 ms and the first small pan froze for 622 ms while constructing a reduced
  interaction lane; logical textures reached 6591 MiB. That intermediate attempt
  motivated direct preview sampling. The 56 ms value is not a final pass.
- The rejected settled-density candidate had a loaded sweep at 59.6 fps / 29 ms,
  cold sweep gap 151 ms, arbitrary-stop gaps 231–425 ms and prepared detail at
  736 ms with a 452 ms screen gap. Those do not certify the faithful replacement.
- Before continuous-zoom refactoring, strict prepared detail was 937 / 894 ms after
  six seconds viewing; early zoom was 5244 ms. Final-candidate sharpness latency
  still needs remeasurement. A full-size source without capture data is not finished.

## Revert and cleanup guidance

**No code was reverted during this pause. Do not wholesale-reset the dirty files:**
correctness fixes, staging, candidates and unrelated concurrent work are interleaved.

- **Keep:** faithful full-density settled processing, cancellable preparation/pass
  staging, release semantics, exact cache fixes, capture metadata/threshold fixes,
  bounded decode-cache behavior, async readback primitives and meaningful regressions.
- **Rejected; stay reverted:** the 0.8 Exposure whole-source draft. It was already
  removed before this session and produced worse activation freezes. Do not revive it.
- **Rejected; do not restore:** reducing settled effect-map density below 1:1.
  Real-photo combined p99 error was 22/255 at 50%, 19/255 at 63.7%, 14/255 at 75%;
  fine stone/foliage softened and edges changed. The faithful replacement is in place.
- **Remove rather than carry forward by default:** leftover reduced-interaction-source
  machinery (`viewSource` / `freeViewSource`, the `display` lane / `viewMade`,
  `viewsource.frag.glsl` and its registration, and the `workingScale` fallback) after
  checking their remaining references during migration. The intermediate first-pan
  allocation regression came from that approach. Keep any independently needed
  display-density calculation; do not delete `viewscale.ts` blindly.
- **Candidate rollback boundary:** if direct preview sampling or its live-USM radius
  cannot be justified in the worker, selectively remove that interaction path and its
  `previewmap.glsl`/stage wiring together. Preserve faithful settled processing and
  exact fixes. No final real-photo review authorizes calling that temporary look equivalent.
- **Native OpenMP:** preserve demosaic/reference behavior, but do not treat the current
  parallel build as stable. Serial LibRaw is an existing isolation/fallback control;
  choose any permanent native change in a separate diagnosed task, not by reverting
  the entire zoom/capture work. No serial crash-fix claim has been established.

## Native blocker: LibRaw/OpenMP metadata crash (fixed, see the top section)

Diagnosed and fixed 2026-11-04 (`raw::openmp_root`). The reports under
`~/Library/Logs/DiagnosticReports/emulsion-2026-11-04-*.ips` all show the same stack
(`__kmp_acquire_ticket_lock` from LibRaw's allocator on a tokio blocking thread).
`EMULSION_LIBRAW_SERIAL=1` remains a serial build for comparison.

## Last validation checkpoint and evidence

Last completed checks before this pause (not rerun for this documentation change):

- `npm run check`: **568 frontend tests, 70 Rust tests passed; nine Rust ignored**.
  The total includes concurrent Remove work; it is not all attributable to performance.
- Strict browser TypeScript check passed.
- GPU `region-detail` full suite, new `maskdehaze`, textured `fidelity` (including
  cancelled preparation) and `zoom-full-res` release regression passed.
- Earlier faithful checkpoint also passed density, colorpreview, hsl, capture,
  motion and async readback checks. These were not all rerun in the bounded follow-up.
- Final refactor's complete real-photo fidelity loop, native stop/pan/cold matrix,
  memory validation and strict prepared-zoom measurement remain outstanding.

Primary references:

- [Continuous-zoom report](docs/research/continuous-zoom.md).
- [Continuous-zoom raw evidence](docs/research/app-performance/continuous-zoom.json):
  `faithfulPreparationCheckpoint` and `boundedMaskedControls20261104` are the latest
  relevant groups; earlier `resume*` runs describe the rejected density candidate.
- [Zoom-detail report](docs/research/zoom-detail.md) and
  [raw evidence](docs/research/app-performance/zoom-detail.json), including capture fixes.
- Photo comparison artifacts are outside the repo: `/tmp/emulsion-faithful-fidelity`
  and `/tmp/emulsion-resume-fidelity-final`; exact returned paths are in the JSON.
  Do not substitute the rejected earlier JPEGs for the faithful comparison.
- Backups: `/tmp/emulsion-next-backup`, `/tmp/emulsion-resume-backup`, and
  `/tmp/emulsion-scope-backup-20261104` (initial performance files plus diff).

## Worker handover and later zoom resumption

Migrate the validated engine mechanisms first. Preserve latest-value and final-release
semantics, cancellation cleanup, cache validity and result/source identity across
messages; async results must not overwrite a newer photo or edit. Replace the
main-thread preparation scheduler with the worker's scheduler rather than carrying
its timers over as an architectural requirement. Offscreen rendering still shares
the GPU with window compositing: retain pass staging and measure job duration.

After the engine is in the worker, establish separate UI and photo budgets, repeat
real-photo settled/live comparisons, and resume focused activation/release, arbitrary
zoom-stop/pan, cold-source, memory and prepared-detail checks. Keep sessions bounded
by one concrete goal and hand off with measured evidence. No immediate benchmark
command or performance implementation is queued by this handoff.

## Other work and historical context

Remove (AI inpainting spots): issue 03, the retouch step's reference behaviour
(`engine/remove.ts`, the Remove branch of `engine/retouch.ts`, IOPaint crop planning), is
committed on its own (2026-11-04). Issues 01 and 02 are now built as described above.
The spec and remaining integration/UI issues are in `.scratch/ai-remove/`, which is
not committed; issue 05 above now exposes Remove in the UI.

The previous handoff, including unrelated features and roadmap, is preserved in
[the pre-worker archive](docs/research/handoff-before-engine-worker-2026-11-04.md).
Its active/resume instructions are superseded by this document. The performance
agent has handed over the current files for Oli's commit decision; nothing was committed.
