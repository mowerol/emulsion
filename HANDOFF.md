# Handoff

## Light theme (2026-11-09)

Oli asked for a light grey theme beside Mid grey and Dark, then for it lighter, off-white; it is
now called Light (neutral, no warm cast: panels #f2f2f2, background #ebebeb, controls #fbfbfb). Uncommitted.

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
  `vite.config.d.ts` (tsc output, committed by accident in fc8b8d1, the old config) shadowed
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
