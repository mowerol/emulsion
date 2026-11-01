# Native perspective reference

This harness calls the vendored RawTherapee homography directly. Regenerate
`src/engine/fixtures/perspective-native.json` from the repository root:

```sh
c++ -std=c++14 -O2 -Isrc-tauri/vendor/rawtherapee-perspective \
  src-tauri/native/perspective.cpp tools/probe/perspective-reference/main.cpp \
  -o /tmp/emulsion-perspective-reference
/tmp/emulsion-perspective-reference > src/engine/fixtures/perspective-native.json
```

The TypeScript reference is compared with these native single-precision matrices.
Rust tests independently project synthetic architecture lines through the native
matrix, detect them with LSD, and recover known camera angles through RANSAC and
Nelder-Mead. Browser checks compare GPU sampling against the TypeScript geometry,
including crop/rotation, plus cached detail maps and the React/IPC/save workflow:

```sh
node tools/browser-tests/treatment-filters.mjs perspective
```
