# Custom control workspace

Status: implemented, 2026-11-13. Oli clarified that existing editing groups should
be the building blocks: add a whole group to a personal tab, move groups across
tabs, and show or hide controls within each group. This supersedes the initial
freeform slider-collection editor. Use one tab for a continuous sidebar or create
several tabs. The standard workspace remains available.

## Interaction

- **Customize…** opens a protected draft. The left library offers existing groups:
  Look, White Balance, Exposure, High Dynamic Range, Tone curve, HSL, Colour
  wheels, Detail, Optics, Grain, Noise reduction, Lens corrections and Transform.
  Searching a slider name finds its containing group.
- Add an entire group with its controls already included. A group already on a
  different tab can **Move here**, preserving its heading, icon and visibility.
  A built-in group occupies one tab at a time.
- Create personal **tabs**, with names and icons. Drag whole groups to reorder
  them or drop them onto another tab; up/down buttons and **Move to tab…** provide
  keyboard-accessible alternatives. Remove unused groups from a tab.
- Expand a group in the editor to change its heading/icon and check which
  controls it shows. **Show all** and **Hide all** work on that group. The editor
  offers neither arbitrary new groups nor individual slider moves between groups.
- **Save workspace** applies the draft. **Cancel** or Escape discards it. **Use
  starter layout** loads a draft containing all existing groups on one tab.
- Hiding controls or groups never changes the photo or disables processing.
  Fully hidden groups disappear from the editing sidebar and remain configurable.
  **Other adjustments** gives access to changed settings outside the visible
  workspace. Group reset resets represented fields and preserves hidden values.

## Existing tools and visual system

This is an Operate extension inside the incumbent world: retain the 300px sidebar,
Geist typography, shared mid/dark/light tokens, Lucide icons and compact rows.
Orange identifies focus, checkbox selection, enabling actions and primary Save.
The histogram and photo action bar keep their existing positions.

HSL keeps its channel selector and colour tracks; Colour wheels keeps its tonal
selectors, wheel and advanced disclosures. Both respect control visibility.
When the wheel is shown without its Hue/Amount slider rows, it retains labeled
numeric value entry so wheel-only editing works with the keyboard and assistive
technology.
White-balance presets, the Look picker, lens switches and automatic perspective
tools remain available within their established groups. Controls with enabling
dependencies keep actionable setup or explanations. Mask-local controls remain
within the mask tool; the standard Masks, Presets and Metadata tabs are retained.

## Persistence and migration

`src/ui/workspacegroups.ts` owns existing-group definitions and their available
controls. `src/ui/controlworkspace.ts` stores version 2 under
`emulsion.control-workspace` in app settings, including existing backups and
settings export/import. The persisted `groups` array contains personal tabs;
each tab's `sections` are editing groups with a stable `source` ID and a list of
visible controls. Names and icons are presentation preferences. Reordering never
changes engine processing order or photo recipes.

The earlier freeform layout migrates into existing groups while retaining tab
names and the selected tab. Previously chosen sliders remain chosen; remaining
controls in their containing groups start hidden. When the old layout split one
editing group across tabs, the first tab containing it owns the reunited group.
Unknown groups and controls survive normalization for forward compatibility.

No dedicated layout sharing format or collections of named workspace layouts
were added. The standard/personal selection stays in `emulsion.workspace`.

## Validation

Model tests cover one/many tabs, default group membership, whole-group moves,
stable identity and visibility, legacy migration, malformed settings and unknown
groups/controls. Recipe-adapter tests retain coverage for isolated resets,
dependencies and truthful omitted-adjustment reporting.

The real Panel/Editor fixture passes in Chromium and WKWebView: existing-group
library/search, creating tabs, moving/reordering whole groups by drag handlers and
accessible actions, checkboxes, Show/Hide all, Save/Cancel, persistence, native
HSL/Colour wheels, resets preserving hidden values, unique IDs and standard
workspace access. It uses a synthetic recipe and never writes real sidecars.

Local `group-*.png` captures in `.impeccable/review/` show editor and one/multiple
tab states at desktop and compact desktop sizes, in mid-grey and light themes.
They use an existing repository sample photo without live histogram data and
represent isolated UI, not the full production app. Physical dragging, VoiceOver
and real-library performance remain manual checks. Final project-check totals
and review disposition are recorded in HANDOFF.md.
