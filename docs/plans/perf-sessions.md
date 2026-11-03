# Performance: the next three sessions

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

## Session 3: first-drag freezes

The first Dehaze drag on each photo freezes once for 90–190 ms; the first Texture drag for 70–110 ms. The ambient light is already measured ahead of time (`Engine.measureAhead`), and a GPU pipeline warm-up was tried and didn't help. Reproduce with `node tools/perf/inapp.mjs <photo> sliders,again`; the second pass shows what the one-time cost is. Find out whether the rest is allocating Dehaze's and Texture's float targets or their first build. Pre-allocating at idle could cost about 240 MB of GPU memory per photo, so bring Oli that trade-off before doing it.

## Next candidates (from the 2026-11-03 sliders-at-100% session)

- **Full resolution takes 11–18 s to appear after Z** (`fullResMs` in the `zoom100` loop). Time it by stage first: LibRaw's X-Trans decode, the half-float transfer over IPC (~200 MB for 26 MP), the upload. Likely what Oli feels most at 100% now.
- **Clarity at 100% (42 ms):** options A/B/C in HANDOFF.md (top section); B (darktable's bilateral-grid local contrast mode) needs side-by-sides and Oli's approval of the look.

