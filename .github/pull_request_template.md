## Summary

<!-- The smallest view that makes the point (a diff sketch, call tree, file tree or diagram), with a
     line or two of text on what changes for someone using Emulsion and why.
     Link the issue it fixes: "Fixes #12". -->

## Ported from

<!-- For image processing: the upstream project, file and commit, and the NOTICE.md entry.
     Any deviation from upstream, and why (agreed with Oli first). Delete if nothing is ported. -->

## Evidence

<!-- Before and after: screenshots for anything visual, test, probe or timing output otherwise. -->

- **Before:**
  **After:**

<!-- Tick what ran and give the numbers. Delete lines that don't apply. -->

- [ ] `npm run check` passes locally (typecheck, tests, build, `cargo test`)
- [ ] Engine stage: TypeScript reference and its tests updated
- [ ] Engine stage: GLSL matches the reference on the GPU (probe result)
- [ ] Controls: in-app timing (`tools/perf/inapp.mjs`), fps and latency against the bars
- [ ] Site: built and looked at in a browser

## To try by hand

<!-- What can't be checked headlessly (mouse, trackpad, keyboard, menus, real photos) and what to
     try. Delete if nothing. -->

## Merge Danger

**Door:** <!-- two-way (cheap to roll back) or one-way (catalog or sidecar formats, migrations,
  deleting files, anything users can't undo) -->

**Blast Radius:** <!-- one word, then what could break: edits, exports, the catalog, performance,
  a camera's files, the site... -->
