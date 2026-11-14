## What and why

<!-- What changes for someone using Emulsion, and why. Link the issue it fixes: "Fixes #12". -->

## Ported from

<!-- For image processing: the upstream project, file and commit, and the NOTICE.md entry.
     Any deviation from upstream, and why (agreed with Oli first). Delete if nothing is ported. -->

## Checks

<!-- Tick what ran and give the numbers. Delete lines that don't apply. -->

- [ ] `npm run check` passes locally (typecheck, tests, build, `cargo test`)
- [ ] Engine stage: TypeScript reference and its tests updated
- [ ] Engine stage: GLSL matches the reference on the GPU (probe result)
- [ ] Controls: in-app timing (`tools/perf/inapp.mjs`), fps and latency against the bars
- [ ] Site: built and looked at in a browser

## To try by hand

<!-- What can't be checked headlessly (mouse, trackpad, keyboard, menus, real photos)
     and what to try. -->
