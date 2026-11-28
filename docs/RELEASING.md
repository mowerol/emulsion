# Releasing

Emulsion ships as an **ad-hoc-signed beta for Apple Silicon**: no Apple Developer account,
no notarisation. Testers allow it once in System Settings › Privacy & Security › Open Anyway
(the steps are in `tools/release/INSTALL.txt`, which goes out with every build).

## Release checklist

Every release, in this order. Each step has to pass before the next; the bundle is checked by
hand before the release PR merges, and nothing is tagged or announced before it has.

**Prepare**

1. A `release/<version>` branch from an up-to-date `main`, in its own worktree.
2. The version in all five places: `package.json`, `package-lock.json` (its two `emulsion`
   entries), `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (the
   `emulsion` package). The script checks the first three agree.
3. `docs/release-notes/<version>.md` from `git log v<previous>..main`: one line per change as a
   tester sees it, issue numbers where there are any, then a **Known** line and the report line.
4. A new LUT pack under `public/looks/`? It needs a licence file (the script refuses without one)
   and a row in [Bundled LUTs](#bundled-luts).
5. Commit, push, open the release PR (`.github/pull_request_template.md`).

**Check the bundle**

6. Build it locally in the release worktree, from Terminal (the script asks for the signing key's
   password): `source ~/.cargo/env && npm run release`. A first build in a new worktree compiles
   from scratch (15–20 min); don't point `CARGO_TARGET_DIR` elsewhere, the script reads the bundle
   from `src-tauri/target`. Output in `release/`.
7. Install it as a tester would: open the `.dmg`, drag Emulsion to Applications (replacing the
   installed copy), open it. Then check, in the installed app:
   - it launches, and About shows the new version;
   - a folder opens and thumbnails appear; a RAW and a JPEG open in Develop;
   - a slider drag feels as usual; an export works;
   - each item in the release notes does what it says;
   - no "Emulsion look LUTs" or `local-looks` pack shows in the Look browser or the LUT lists;
   - Help › Show Log in Finder: no new errors from the session.
8. CI is green on the release PR.

**Ship**

9. Merge the release PR (squash) and update `main` locally.
10. Tag the merge commit on `main` and push the tag: `git tag -a v<version> -m "Emulsion <version>"
    <merge commit> && git push origin v<version>`. `.github/workflows/release.yml` builds the
    same bundle on GitHub and attaches it to a **draft** release.
11. Check the draft: the `.dmg`, `.sha256`, `.app.tar.gz`, `.sig`, `latest.json`
    and source maps are attached. The release text includes the installation instructions from
    `INSTALL.txt` followed by the release notes.
12. Check the draft's own `.dmg`, the exact file testers get (the local build in step 6 is built
    from the same commit, but on another machine): download it from the draft, check it against
    its `.sha256` (`shasum -a 256 -c`), install it from the `.dmg` into Applications, open it, see
    About shows the version, open a RAW, and check the log for errors.
13. Publish the draft (not as a pre-release).
14. On a copy still on the previous version: Check for Updates… offers the new one, installs and
    relaunches.

**Tell people**

15. Comment on the issues the release fixes, asking the reporter to try it; close those they
    confirm.
16. Update `HANDOFF.md`.

## Cutting a build

1. Set the version in all five files listed in the release checklist, including both lockfiles
   (the script refuses if the app versions differ).
2. Write `docs/release-notes/<version>.md`: what testers see in the update dialog and on the
   release page (the script refuses a clean build without it).
3. Commit. The script refuses uncommitted changes (`--dirty` for trial builds only).
4. Either
   - **locally:** `npm run release` → in `release/`: `Emulsion-<version>-arm64.dmg`, `.sha256`,
     `INSTALL.txt`, the updater's `Emulsion-<version>-arm64.app.tar.gz`, `.sig` and
     `latest.json`, and `Emulsion-<version>-arm64-sourcemaps.tar.gz`, the interface's source maps
     (not in the app; `tools/diagnostics/symbolicate.mjs` uses them to read stacks in testers'
     logs); or
   - **on GitHub:** push a tag `v<version>`. `.github/workflows/release.yml` runs the
     checks and the same script on a macOS runner and attaches all of those to a **draft**
     GitHub release. It can also be run from the
     Actions tab (artifact only).
5. Publish the draft (not as a pre-release). From then on, installed copies find it: the
   updater reads `releases/latest/download/latest.json` from this repo.

## Updates

`tauri-plugin-updater`. Emulsion › Check for Updates… (and Settings › Updates › Check Now…)
always asks; released builds also ask about 8 s after every launch, unless
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

## Hosting the ONNX Runtime download

ONNX Runtime's MIT licence permits redistribution with its copyright and licence
notice. Mirror the original `onnxruntime-osx-arm64-1.23.2.tgz` unchanged, including
its `LICENSE` and `ThirdPartyNotices.txt`. Its pinned SHA-256 is:

```text
b4d513ab2b26f088c66891dbbc1408166708773d7cc4163de7bdca0e9bbb7856
```

Verify a candidate archive before uploading it:

```sh
printf '%s  %s\n' \
  b4d513ab2b26f088c66891dbbc1408166708773d7cc4163de7bdca0e9bbb7856 \
  onnxruntime-osx-arm64-1.23.2.tgz | shasum -a 256 -c -
```

The verified copy is hosted in the public
[emulsion-assets release](https://github.com/mowerol/emulsion-assets/releases/tag/onnxruntime-1.23.2),
with the checksum and both original notices attached. The app and denoise setup
try Microsoft's original URL first and use this mirror if the download fails:

```text
https://github.com/mowerol/emulsion-assets/releases/download/onnxruntime-1.23.2/onnxruntime-osx-arm64-1.23.2.tgz
```

Both sources must match the same pinned checksum. A checksum mismatch stops
installation. The app reports curl's detailed error, including both attempts if
the primary and mirror fail. Its curl connection timeout is 10 seconds; a
transfer stalled below one byte per second times out after 30 seconds, with the
existing two retries before failover. Both sources use GitHub, so this mirror
helps when the upstream repository is unavailable, but not during a GitHub-wide
outage.

For future mirrors, download the hosted file and verify the pinned checksum
again before updating `RUNTIME.fallback_url` in `src-tauri/src/ai_models.rs` and
`RUNTIME_MIRROR_URL` in `tools/denoise/setup.py`. Keep the checksum, package id
and archive layout unchanged. An app update is needed for installed copies to
use a new URL.

## Bundled LUTs

Only packs with an explicit licence ship (`public/looks`):

| Pack | Licence | Source |
| --- | --- | --- |
| `gmic-film` (Pat David / RawTherapee film simulation: B&W and negatives, 121) | CC BY-SA 4.0 | `public/looks/gmic-film/SOURCES.md` |
| `t3mujinpack` (João Almeida, 8) | MIT | `public/looks/t3mujinpack/LICENSE.txt` |
| `film` (Spectral Film: 22 films baked from darktable's spektrafilm and Andrea Volpato's data pack 0.3.3) | CC BY-SA 4.0 with the spektrafilm preamble | `public/looks/film/README.md`, `LICENSE` |
| `emulsion-luts` (Emulsion's own, used by some of its looks; hidden) | GPL-3.0-or-later | `public/looks/emulsion-luts/LICENSE.txt` |
| `fuji-controls` (Emulsion's own Fuji recipe controls; hidden) | GPL-3.0-or-later | `public/looks/fuji-controls/LICENSE.txt` |

PictureFX and Pat David's slide and instant sets were dropped before the 0.1.0 beta; the
CineStill/SX-70 packs were never bundled. `local-looks/` (Fuji X-Trans III, Fuji GFX tests, spektrafilm) is git-ignored and
served only by the dev server.
