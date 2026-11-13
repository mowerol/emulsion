# Remaining slider lag after 0.1.1

Measured on 2026-11-12, starting at `17f1ee2`. This work improves two contributors;
it does **not** resolve all slider lag or explain the development/release discrepancy.

## Changes

- Images measured its first row synchronously on every recipe update, flushing layout
  inside React's commit. Keep its ResizeObserver until the observed row or columns change.
  The mounted Images regression failed before the change (one unwanted measurement),
  then passed, including existing virtual navigation coverage.
- Background full-resolution preparation cloned a 26 MP RAW into the worker during a held
  Exposure drag. The upload alone occupied about 150 ms on the main thread. Defer this
  speculative upload until no pointer is held and edits/release have settled for 360 ms.
  Navigation and effect cleanup cancel the deferred callback. Foreground zoom loads retain
  their existing path. Native decode/IPC delivery can still interrupt a drag.

## Reproduction and measurements

```sh
PACKAGED=debug node tools/perf/inapp.mjs /path/to/photo.RAF controls 120
# Release native binary, embedded interface and release security policy:
PACKAGED=1 node tools/perf/inapp.mjs /path/to/photo.RAF controls 120
```

The runner now uses a separate app identifier/catalog. `PERF_BINARY` can reuse an already
built instrumented binary; its scenarios are fixed by the VITE_PERF value at build time.
Keep the test window foreground. Interrupted runs are invalid.

Valid baseline: production frontend, `tauri://localhost`, worker engine, 6246×4170 RAW,
1552×1036 canvas, DPR 2. The detailed comparable runs used a debug native binary with
embedded production assets and release CSP, not the shipped release executable.

| Run | First drag worst control gap | Subsequent drag worst gaps |
| --- | ---: | ---: |
| Baseline | 318 ms | 44 / 40 ms |
| Images observer fix | 178 ms | 32 / 40 ms |
| Images + deferred background upload (300 ms preliminary delay) | 128 ms | 45 / 37 ms |

Separate red reproduction asserted that a background upload interrupted a held slider:
one upload, 400 ms worst gap. The deferred-upload run recorded zero uploads in all three
drags. Final source uses the existing view settle duration twice (360 ms).
These are individual runs, not p95 estimates. Warmed controls remain around 59 fps with
occasional long frames, and the strict 25 ms gap target still fails.

Skipping repeated input attribute writes, removing CSS `:has` rules, starting with a draft,
and limiting live photo updates to 40 fps were explored. None established a sufficient,
repeatable fix. No such production changes are retained. Profiling categories overlap;
the MessageChannel-based rendering interval includes scheduling/GPU waits and must not
be treated as pure CSS time. The current local release .app has not been rebuilt with
these changes. Detailed session logs are local under `.scratch/slider-controls/`.
