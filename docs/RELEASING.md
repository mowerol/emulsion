# Releasing

Emulsion ships as an **ad-hoc-signed beta for Apple Silicon**: no Apple Developer account,
no notarisation. Testers allow it once in System Settings › Privacy & Security › Open Anyway
(the steps are in `tools/release/INSTALL.txt`, which goes out with every build).

## Cutting a build

1. Set the version in all three places: `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml` (the script refuses if they differ).
2. Commit. The script refuses uncommitted changes (`--dirty` for trial builds only).
3. Either
   - **locally:** `npm run release` → `release/Emulsion-<version>-arm64.dmg`, `.sha256`,
     `INSTALL.txt`; or
   - **on GitHub:** push a tag `v<version>`. `.github/workflows/release.yml` runs the
     checks and the same script on a macOS runner and attaches the dmg to a **draft**
     release; publish it by hand. It can also be run from the Actions tab (artifact only).

## What the script checks

`tools/release/build.sh` runs `npm run check`, builds `app` and `dmg` for
`aarch64-apple-darwin`, then refuses the build if:

- the signature doesn't verify, or isn't ad-hoc;
- the executable isn't arm64, or links anything outside `/usr/lib` and `/System`
  (a Homebrew path would crash on testers' Macs);
- LibRaw was built without OpenMP (libomp missing: `brew install libomp`);
- the bundle references the dev-only `local-looks` packs, or a bundled LUT pack has no
  licence file.

## Signing choices

`tauri.conf.json` sets `bundle.macOS.signingIdentity` to `"-"` (ad-hoc) and
`hardenedRuntime` to `false`. The hardened runtime's library validation needs a Team ID; with
an ad-hoc signature it would refuse the ONNX Runtime dylib the app downloads for AI features.
Moving to a Developer ID means: a real identity, the hardened runtime back on with
`com.apple.security.cs.disable-library-validation` (or ONNX Runtime bundled and signed),
and notarisation.

## Bundled LUTs

Only packs with an explicit licence ship (`public/looks`):

| Pack | Licence | Source |
| --- | --- | --- |
| `gmic-film` (Pat David / RawTherapee film simulation, 269) | CC BY-SA 4.0 | `public/looks/gmic-film/SOURCES.md` |
| `picturefx` (Marc Roovers, legacy 19) | CC BY-SA 4.0 | `public/looks/picturefx/SOURCES.md` |
| `t3mujinpack` (João Almeida, 8) | MIT | `public/looks/t3mujinpack/LICENSE.txt` |

The newer PictureFX releases (CC BY-NC by default) and the CineStill/SX-70 packs are not
bundled. `local-looks/` (Fuji X-Trans III, Fuji GFX tests, spektrafilm) is git-ignored and
served only by the dev server.
