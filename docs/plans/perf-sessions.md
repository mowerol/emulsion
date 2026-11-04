# Performance: the next three sessions

**Latest bounded session (2026-11-04):** exact masked-Dehaze input/mask reuse is fixed
and validated, but its 63.7% native rerun still fails (48.3 fps / 137 ms gap). Capture
at 50% is much worse (2.6 fps / 403 ms gap); live deconvolution and scratch allocation
are the next performance target. A remaining mask run hit the known LibRaw/OpenMP
metadata crash. Next goal: isolate that crash with the existing serial control, then
address Capture and validate its settled output. Keep each session bounded and hand
off with measured results; do not reopen the entire matrix in one session. See the
latest HANDOFF entry and `boundedMaskedControls20261104` evidence.

**Current priority (2026-11-04):** responsive editing through continuous zoom. Oli reports
all sliders poor at 50%, including Clarity and HSL, and requires a general policy supporting
future zoom steps. The active work supersedes the historical session ordering below. See
HANDOFF.md and `docs/research/continuous-zoom.md` for evidence and remaining failures. The latest
checkpoint restores faithful settled maps and stages individual GPU passes. Final direct-preview
activation timings remain unverified after native LibRaw/OpenMP metadata crashes; start with
the new top section of HANDOFF, not the historical density candidate or Texture anomaly.

**Additional user feedback (2026-11-04):** individual-mask Clarity, Dehaze and Texture
also lag; global Exposure, Dehaze and Capture Sharpening lag seriously, with other
controls potentially affected. Reproduce both masked and global editing, add Capture
Sharpening to the existing slider coverage, and survey the remaining controls. No
zoom restriction or shared cause is established for this report. Keep activation,
held dragging and release/settle inside the same performance budgets.

Planned 2026-11-03, after the real-app loop (`tools/perf/inapp.mjs`) and the screen-sized preview (HANDOFF.md, top section). Each is one `/diagnosing-bugs` session, in this order. Oli starts one with `/diagnosing-bugs session N` (N is 1, 2 or 3). Run the session's brief below, and strike it through here when it's done.

Before any of them: read HANDOFF.md; measure with `node tools/perf/inapp.mjs`, never headless Chrome; get a red loop before reading code to form theories; show Oli ranked hypotheses before fixing; keep the app window visible during runs (macOS throttles hidden webviews).

## Session 1: clicking around feels slow

Clicking around Emulsion feels slow. The loop's `clicks` scenario is too thin: its settle check ends before the preview decode lands. Extend `src/dev/perfrun.ts` to time these in the real app:
- stepping to the next or previous photo, until it's sharp
- switching between Library and Develop
- opening the look browser
- main-thread stalls after an edit settles: the offscreen thumbnail engine re-develops then, including Dehaze's ambient measurement

Report main-thread long tasks, not only paint times. Ask Oli which clicks feel slowest (which screen, which button) and cover those first.

## ~~Session 2: Texture at 100% zoom (31 fps)~~ (done 2026-11-03, run as "sliders at 100%"; see HANDOFF.md)

Texture at 100% is 50 fps / 20 ms (was 12 fps / 65 ms measured on the true full resolution). Left: Clarity 42 ms, Dehaze 26 ms, and an earlier slider (Exposure) with Texture + Dehaze on, 53 ms, all at 100%; and the full resolution taking 11–18 s to arrive after Z.

Original brief:

Texture drags at 100% run at 31 fps (36 ms per frame) in the real app; at fit they run at 57 fps. Read the region section of docs/ARCHITECTURE.md first. Reproduce with `node tools/perf/inapp.mjs <photo> zoom`. Suspect: the whole-photo products (Texture's coarse bands, taken from the preview) are rebuilt at 2560 px every frame, on top of the region. Check which passes run per frame (`perFrame`) before changing anything. The Texture region approximation is recorded in NOTICE.md: ask Oli before changing what it computes.

## ~~Session 3: first-drag freezes~~ (done 2026-11-03; see HANDOFF.md)

Cause: allocating the float targets (not the ambient light, not pipeline creation). They are now made one per idle moment after the photo shows. First drags at fit: Texture freeze 92–106 → 31–53 ms, Dehaze 133–240 → 38–47 ms, all PASS. Left: the same first-drag freeze on the region lane at 100% (Dehaze 450 ms).

Original brief:

The first Dehaze drag on each photo freezes once for 90–190 ms; the first Texture drag for 70–110 ms. The ambient light is already measured ahead of time (`Engine.measureAhead`), and a GPU pipeline warm-up was tried and didn't help. Reproduce with `node tools/perf/inapp.mjs <photo> sliders,again`; the second pass shows what the one-time cost is. Find out whether the rest is allocating Dehaze's and Texture's float targets or their first build. Pre-allocating at idle could cost about 240 MB of GPU memory per photo, so bring Oli that trade-off before doing it.

## Next candidates (from the 2026-11-03 sliders-at-100% session)

- **Full resolution after Z:** diagnosed 2026-11-03; serial `zoomdetail` 12.8 s → **5.9 s** with existing LibRaw OpenMP (four threads, static runtime) and optimized development image resizing. Exact payload preserved. Oli delegated the next mechanism; bounded background preparation is implemented: early zoom **5.7 s**, after six seconds viewing **1.26 s**. Follow-up fixes asynchronous capture arrival, retains the whole-photo threshold and cuts mask conversion 555 → 26–29 ms. Final strict prepared zoom **937 / 894 ms (PASS)**; early zoom **5.24 s (FAIL)**. First-frame freezes remain (555 ms in the prepared run); no p95 claim. See [stage report](../research/zoom-detail.md) and HANDOFF.md. Historical `fullResMs` in `zoom100` was 11–18 s (17.7 s reproduced this session).
- **Clarity at 100% (42 ms):** options A/B/C in HANDOFF.md (top section); B (darktable's bilateral-grid local contrast mode) needs side-by-sides and Oli's approval of the look.

