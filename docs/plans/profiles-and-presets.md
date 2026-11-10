# LUTs, Looks and Presets — implemented 2026-11-01

This section supersedes the historical decisions below.

- **LUT:** an optional base ingredient inside the Look editor. Base Strength and Normal/Colour blend live there. A photo never selects a LUT directly.
- **Look:** a saved treatment with colour balance, Colour Grading, curve, optional LUT and optional scanner finish. The photo exposes its overall Amount. Its LUT strength/blend are ingredients edited in a dedicated Look editor. Bundled LUTs and former imported-LUT entries are Looks, with their original identities and settings preserved.
- **Scanner finish:** authored in the Look editor and visible inline in the photo’s Look section, beneath Amount. Applying a Look follows its captured finish. The photo can choose None or a concrete scanner as a full replacement, or restore From look. One scanner stage resolves the choice; inherited finishes fade with Look Amount and overrides remain independent. Existing sidecars retain their explicit scanner choice.
- **Tone character:** a photo-owned slider beside Contrast (-100..100, 0 neutral), changing sigmoid slope without affecting grain; included in presets’ Tone group. Replaces the Push/Pull UI. Legacy saved push values retain their grain-only behavior.
- **Preset:** a named set of selected adjustment groups. Applying replaces those groups, including neutral values, without changing excluded groups. Treatment is included by default; Exposure and White balance are opt-in. Camera profile, crop, lens and masks are excluded.
- One Look slot, or None. The compact selector opens a searchable favourites dropdown; the browse button opens the full panel browser. The browser groups Favourites, My looks and Built-in, filters All/Colour/B&W, and offers list/grid views. Favourites and view preference persist in `emulsion.lookBrowser`. Choosing an entry applies it; closing the browser restores the normal controls.
- New look starts fresh, with optional LUT selection/import inside the editor. Edit on a built-in Look opens a duplicate; custom Looks edit their current library definition. Both can be duplicated through the browser menu. It previews the selected photo with camera rendering, lens, WB and exposure, excluding its personal colour/spatial adjustments. Local undo/redo never writes sidecars. Save changes the library; Save and apply also sets the active photo's treatment in one undo step. Cancel requires explicit discard. Photo navigation is blocked while authoring.
- Applying a Look (including a bundled LUT-only Look) embeds its name, revision, kind and settings in `Recipe.lookSnapshot`. Render, curve composition, LUT resolution, thumbnails and export consume that snapshot. Revising/removing an asset preserves existing photo and preset rendering. LUT blobs are retained.
- Old LUT-only custom entries are treated as Looks without rewriting existing photo settings. Legacy applied LUT recipes retain their original strength/blend and render path until explicitly choosing another Look. Before changing/removing an old definition, Rust archives its first definition under `looks/legacy/`; old sidecars hydrate from those definitions, including in folders opened later. Snapshot fields are additive; sidecar envelopes remain compatible.
- Presets live in atomic JSON files in app data `presets/`, with stable ids, concrete recipes and group lists. Save/update never changes the photo. Search, rename, update from current photo and delete are available in both panel layouts. Selected frames share one undoable application.
- Deferred: look creation from photo sliders, look/preset sharing, LUT baking, additional spatial look ingredients, linked updates and automatic asset cleanup.

## Historical decisions (superseded)

# Profiles and presets: decisions so far

**Status:** planned, not started. Collected 2026-10-31 from Oli's opencode planning session
(`ses_e6c076fddffeLGKlKS7PQy3Erm`, 17:58–18:52) and the Claude Code session that followed. The
detailed build plan (Rust storage, store, panel, tests) is `/Users/oli/.opencode/plan/profiles-and-presets.md`;
where this file and that one disagree, **this file wins** (it records later decisions).

## The model

```
camera profile (base)  →  creative profile                  →  preset
per camera, hidden       one creative slot, with Amount        visible slider settings
                         = optional LUT + hidden settings      may name a creative profile
```

Lightroom's terms, as Oli framed them: a **preset** is what a Fuji-style "recipe" is, saved slider
settings; a saved look is a **profile**. "Recipe" stays an internal word (the per-photo sidecar).

## Decided

1. **A creative profile adapts to the base.** It never stores a camera profile; it sits on whatever
   base the photo has (Oli, 2026-10-31: "it would always point to the base profile of whatever is
   being used"). This supersedes the earlier "references a base profile the user doesn't see" and the
   plan's `base` field. The base is the camera's standard matrix (DCP support was removed on 2026-11-10 to follow
   darktable). Presets leave the base out too.
2. **Legacy rendering is gone** (done 2026-10-31): no `legacy` base, no Emulsion parametric stocks.
   Every built-in look is a LUT on the camera profile's print.
3. **A creative profile is a JSON file with hidden settings plus an optional LUT** (Oli's "hybrid"
   format, Layers B and C). The hidden settings apply without moving the user's sliders, at their real
   place in the pipeline (scene-referred controls stay scene-referred). The built-in packs are profiles
   that are only a LUT; an imported `.cube`/Hald is the same.
4. **One creative slot.** A creative profile can contain a LUT; a LUT cannot be stacked over a
   creative profile. Applying a profile, or a preset's Profile group, replaces the current one, one
   undo step. A second explicit LUT slot is a possible later feature, never a side effect.
5. **The LUT applies to the base print** (display-referred), not before tone mapping. Oli's summary
   put the look before tone mapping; that only suits scene-linear LUTs and would tone-map the shipped
   packs twice. A pack would have to declare a scene-linear LUT to go earlier.
6. **Amount** blends towards no profile (Neutral on the base), never towards the previous profile.
7. **Panel:** one **Saved** section with two lists, Profiles and Presets. The workflow layout's stock
   section stops being called "Presets" (rename to Film stock / Profile; its "Preset" dropdown too).
8. **Presets:** a full normalized recipe plus an `include` list of groups; Geometry (crop, lens) and the
   base off by default; Profile group on by default (it swaps the creative profile, and the apply toast
   says so). A group-completeness test: every recipe key but `v` is in exactly one group.
9. **Export colour grade to .cube / Hald** as a secondary action, for video editors and other apps,
   warning that spatial edits are stripped (Oli's summary). `tools/luts/bake-fuji.mjs` is the precedent.

## Custom looks (decided and built 2026-11-01)

Oli: imported LUTs and saved profiles should be one thing, **custom looks**, in one **Custom looks**
collection; system looks (the bundled packs) can't be edited. A custom look is a name, hidden colour
and tone settings, and optionally a LUT: a system look by reference, or a LUT file of the user's own.
**Never grain** or other spatial effects (Lightroom's model): those stay visible sliders.

- **Made by:** Import LUT (a look holding that file), Duplicate (of a system look, by reference, or a
  custom one), New look from this photo (its LUT at its Amount plus Colour Grading, Contrast, Vibrance,
  Saturation, Shadows, Curve; the photo switches to it with those sliders at zero).
- **Permanent ids** (`lut:custom:<uuid>`), so editing keeps every photo that uses it. LUT files are
  stored once by content hash (`looks/luts/`) and removed when no look uses them. Looks from the
  first two days (`lut:mine:`, `lut:profile:` ids) are migrated, keeping their hash as their id.
- **Edit look:** the look's settings go onto that photo's sliders and its LUT into the Collection/Look
  controls (a file through a hidden "LUT file" collection), as an in-memory draft: no sidecar write, no
  undo step. Done saves the look (updating every photo using it; the banner shows how many in the
  folder) and Cancel discards; moving to another photo cancels. A look without a LUT gains one here.
- **Detach** (Figma's detach component): the look's settings at its Amount onto the photo's own
  sliders and its LUT used directly; the photo stops following the look. Offered only when those
  sliders are at rest (two colour balance instances can't be merged exactly).

## Next ideas (Oli, 2026-11-01), not built

- **Recipes attached to looks:** a look can carry visible slider settings (a preset) applied when the
  look is chosen, editable afterwards like any slider. This is where grain belongs when a look wants
  it. Needs presets first; then a look links one. Decide what happens to those sliders on switching
  looks (proposal: the new look's recipe replaces the old one's groups, one undo step).
- ~~**Colour-only LUT blending.**~~ Built 2026-11-01: Film stock → Blend: Normal / Colour, ported
  from darktable's `_blend_color` (RGB display blending, on the pipe's linear RGB). Stored on the
  photo (`lookBlend`) for a LUT chosen directly, and inside a custom look's LUT (`blend: 'color'`).
- **Apply a look for colour only** (Oli, 2026-11-02): an application-time choice, stored on the
  photo, that keeps a look's colour and removes all of the contrast and tone it adds. For a
  LUT-only look this extends the existing Colour blend from the LUT to the whole look. For a custom
  look it must also skip the look's colour balance `contrast` and `shadows`, its tone curve, the
  tone parameters of Colour Grading and the scanner's `contrast`, while keeping the LUT's hue and
  saturation, the colour balance's vibrance and saturation, the colour parameters of grading and
  the scanner's saturation and gain. Amount then scales only what remains. The recipe needs a new
  optional field (e.g. `lookColourOnly`), read as off for old sidecars, and thumbnails, export,
  presets and copy/paste must use it. Open: a per-application toggle versus a property saved on the
  look; where the control lives (beside Amount, or at apply time); how a colour-only look is shown
  in the look browser; and whether B&W looks offer it at all, since their monochrome LUT has no hue
  or saturation to keep and their channel mix lives in tone.

## Open: Oli to decide

- **Which hidden settings a profile may carry.** Oli's summary includes spatial ones (highlight
  recovery, sharpening, noise reduction). Claude's recommendation: colour and tone only (Colour
  Grading, Contrast/Vibrance/Saturation, Colour, Curve), leaving grain, clarity, sharpening and
  halation to presets, because a hidden spatial effect can't be seen or undone with the photo's own
  sliders. Each hidden control means a second instance of that stage in the pipeline (a second colour
  balance, like the old stock grade).
- **Embed or reference the LUT.** Oli's summary embeds it (self-contained, shareable); the opencode
  plan references an installed pack (small, packs stay updatable, breaks if the recipient lacks the
  pack). Likely answer: reference built-in packs, embed user-imported LUTs.
- **How Amount scales hidden settings** (proposal: each setting scaled towards its neutral value, the
  LUT blended towards none).
- **White balance in presets** (proposal: off by default; it's per shot).
- **Presets and copy/paste sharing one group table** (proposal: yes).
- **Push**: it now only changes grain size. Keep, or fold into Grain?

## Build order (proposed)

1. ~~Rename the stock section and dropdown.~~ Done 2026-10-31: "Film stock" in both layouts, dropdown "Look".
2. ~~Creative profiles as files: import a `.cube`/Hald into the app's data folder, listed as "My looks".~~
   Done 2026-10-31 (LUT only; hidden settings come with step 4). `src-tauri/src/user_looks.rs` keeps
   `app_data_dir()/looks/<blake3>.<ext>` plus a JSON entry; `library/userlooks.ts` imports (the file must
   parse first), lists and removes; recipes name a look `lut:mine:<hash>` in pack `mine`. A recipe whose
   look isn't installed keeps it as "Missing look" and renders without it; importing the same file
   brings it back. Step 4 can grow the JSON entry into the profile format.
3. Presets, per the opencode plan minus `base`; add `dialog:allow-save` to `capabilities/default.json`.
4. ~~Hidden settings in creative profiles ("Save as profile" from the current photo).~~ Done 2026-10-31
   with Oli's go-ahead on the defaults: colour and tone only (Colour Grading, Contrast, Vibrance,
   Saturation, Shadows, Curve); **Colour (the colour equalizer) left out of v1**, since a second
   instance would double its analysis pass. Amount scales the colour balance's amounts towards
   darktable's defaults (hues, weights and fulcrums kept), blends the curve with the straight line and
   the LUT towards none. A profile refers to its LUT (`look: { pack, stock, amount }`, the photo's
   Amount at saving), doesn't copy it. Saving switches the photo to the profile and zeroes those
   sliders (one undo step); it renders within 1/255 of before (probe `savedProfile`). Not yet: saving a
   profile on top of another saved profile (the button explains), editing a profile's settings.
5. Export colour grade to `.cube`.
6. Recipes attached to looks (after presets).
