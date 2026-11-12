# Releasing

Emulsion ships as an **ad-hoc-signed beta for Apple Silicon**: no Apple Developer account,
no notarisation. Testers allow it once in System Settings › Privacy & Security › Open Anyway
(the steps are in `tools/release/INSTALL.txt`, which goes out with every build).

## Cutting a build

1. Set the version in all three places: `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml` (the script refuses if they differ).
2. Write `docs/release-notes/<version>.md`: what testers see in the update dialog and on the
   release page (the script refuses a clean build without it).
3. Commit. The script refuses uncommitted changes (`--dirty` for trial builds only).
4. Either
   - **locally:** `npm run release` → in `release/`: `Emulsion-<version>-arm64.dmg`, `.sha256`,
     `INSTALL.txt`, and the updater's `Emulsion-<version>-arm64.app.tar.gz`, `.sig` and
     `latest.json`; or
   - **on GitHub:** push a tag `v<version>`. `.github/workflows/release.yml` runs the
     checks and the same script on a macOS runner and attaches all of those to a **draft**
     GitHub release. It can also be run from the
     Actions tab (artifact only).
5. Publish the draft (not as a pre-release). From then on, installed copies find it: the
   updater reads `releases/latest/download/latest.json` from this repo.

## Updates

`tauri-plugin-updater`. Emulsion › Check for Updates… (and Settings › Updates › Check Now…)
always asks; released builds also ask about 8 s after launch, at most once a day, unless
Settings › Updates turns that off. The sheet offers Install and Relaunch, Remind Me Later and
Skip This Version (automatic checks then stay quiet about that version). Installing downloads
the tarball, checks its signature against `plugins.updater.pubkey` in `tauri.conf.json`,
replaces the app in place, then saves sidecars, catalog and settings and relaunches
(`saveAndRelaunch`, `relaunch_now`). Logic: `src/library/updates.ts`; sheet: `src/ui/UpdateDialog.tsx`.

### Update signing key

Every update is signed with a minisign key; the app trusts only its public half.
**If the private key or its password is lost, installed copies can never be updated again**:
testers would have to download a new build by hand. Keep both in a password manager.

- Private key: `~/.tauri/emulsion-updater.key` (the script uses it when
  `TAURI_SIGNING_PRIVATE_KEY` isn't set and asks for the password unless
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is set).
- Public key: `plugins.updater.pubkey` in `tauri.conf.json` (the script refuses to build without one).
- GitHub secrets on this repo: `TAURI_SIGNING_PRIVATE_KEY` (the key file's text) and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

### Ad-hoc signing and updates

The updater's download isn't quarantined, so an update doesn't go through Open Anyway again.
An app run from the dmg or from Downloads without being moved (App Translocation) can't replace
itself; the error tells the tester to move Emulsion to Applications. Because each ad-hoc build
has a different code signature, macOS may ask again for access to folders such as Pictures or
Desktop after an update.

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
| `gmic-film` (Pat David / RawTherapee film simulation: B&W and negatives, 121) | CC BY-SA 4.0 | `public/looks/gmic-film/SOURCES.md` |
| `t3mujinpack` (João Almeida, 8) | MIT | `public/looks/t3mujinpack/LICENSE.txt` |

PictureFX and Pat David's slide and instant sets were dropped before the 0.1.0 beta; the
CineStill/SX-70 packs were never bundled. `local-looks/` (Fuji X-Trans III, Fuji GFX tests, spektrafilm) is git-ignored and
served only by the dev server.
