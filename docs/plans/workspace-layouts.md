# Workspace layouts

Classic was retired on 2026-11-01 at Oli's request. Workflow is now the only workspace; its selector has been removed. Saved Classic preferences migrate to Workflow while keeping image columns and the selected control stage. The original implementation and validation notes below are historical.

Oli chose prototype A (stage tabs, images left, selected photo centre, controls right) and requested a switch between one and two photo columns. Implemented 2026-10-31; Oli authorised committing and pushing this layout and the fixed photo-info bar.

## Current behavior

- Workflow is the new default Develop workspace. Classic retains the bottom filmstrip, flat controls, crop section and floating zoom bar.
- Workspace selector in the top bar; 1/2 column selector in the Images heading. Layout, columns and selected control stage are remembered as application preferences in `emulsion.workspace`, outside recipes/sidecars.
- Images reuses the existing thumbnails, marks, filters, RAW+JPEG folding and selection operations. Shift selects a range, Cmd/Ctrl toggles, up/down navigates one grid row, and Select All works in Workflow Develop.
- Frame/file information, heart, stars and colour tags live in a fixed bar below the editing photo. The verbose stock/development/scanner sentence was removed at Oli's request. The right pane is reserved for editing controls.
- Crop, Zoom, Before and Split live in a top toolbar. Crop settings open from the Crop tool and share the existing draft, overlay, reset, Done/Cancel and keyboard behavior. The toolbar stays inside Develop's controller and spans the workspace grid; no second zoom/crop state or renderer is introduced.
- The canvas stays mounted when changing layouts; zoom/pan, compare state and crop drafts survive. Edits and history belong to the photo regardless of layout.

## Default control tabs (revised after Oli's feedback)

| Tab | Sections |
| --- | --- |
| Develop | Presets, White Balance, Exposure, High Dynamic Range, Tone curve |
| Colour Grading | HSL, Colour wheels |
| Refine | Detail, Optics (including Fade/vignette), Grain, Lens corrections |

Presets contains the existing film look picker and Amount, with visual browsing and Development/Scanner under disclosures. It starts collapsed to keep White Balance and Exposure in view, and remembers opening/closing. This does not add the future saved recipe-preset system.

Exposure holds Exposure, Contrast, Saturation and Vibrance. HDR holds Highlights, Shadows, Whites and Blacks. The screenshot's separate Brightness control is not implemented in the engine; this revision reuses existing tools rather than adding a new algorithm. Each section resets only its own fields.

`src/ui/workspace.ts` owns stable group/section identifiers and default membership/order. A keyed section registry renders that configuration and keeps other sections mounted so module view state survives tab changes. Presentation groups do not change engine processing order. Saved Prepare/Look/Tone selections migrate to Develop, Finish to Refine, and Colour stays Colour Grading. The old numbered step headings have been removed.

User-defined groups remain later work: named configurations, rename/reorder stages, move sections, hide optional sections and restore defaults. Build on these stable section IDs and preserve newly introduced tools when reading older configurations. No custom-group editor is implemented yet.

## Prototype decision record

- A selected: thumbnail browser plus stage tabs; keep current layout as Classic.
- Added on Oli's feedback: an explicit, persisted 1/2 column switch.
- B (continuous stage headings) was not selected.
- Full throwaway comparison and sample captured locally at `/private/tmp/emulsion-workspace-prototypes-A-B-C.tar.gz`, based on commit `2421a94`. The archive includes source snapshots for reproducing the comparison; it remains a local prototype archive, separate from the shipping implementation. Do not commit Oli's sample photo into main or publish it.
- Prototype components/switcher are removed from the implementation; the selected design uses real app controls.

## Validation

Full project check passes: TypeScript, 232 TypeScript tests, 36 Rust tests (4 optional tests ignored), production and probe builds. Browser checks with the real React app and a stubbed file backend cover one/two columns and persisted choice; switching Classic/Workflow without remounting the canvas or losing 100% zoom; toolbar crop/actual overlay and a crop draft surviving layout changes; real stage visibility and unique control IDs; select keyboard isolation; range/modifier selection and shared photo filtering. The browser tests use local RAW/thumbnail data but never write real sidecars.

Local screenshots: `/private/tmp/emulsion-workspace-live.png` and `/private/tmp/emulsion-workspace-one-column.png`. These contain Oli's photo and are not repository assets. Native Tauri use and drag feel still need Oli's assessment.


The initial Workflow implementation was committed/pushed as `8411ddc`. Oli authorised committing this three-tab revision, including removal of the “Controls” heading; it has not been pushed. 234 tests and the production build pass. Validation adds legacy preference migration and isolated Exposure/HDR/Optics resets, plus browser checks of exact section order, three-tab navigation and Refine's lens/detail/optics visibility.
