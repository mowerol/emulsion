# Backups

**Status (2026-11-02): built.** Oli's choices: sidecar history inside the sidecar, 15 daily snapshots, and the resolved profile recorded as a fallback. Items 1–5 below are implemented; see docs/ARCHITECTURE.md (Sidecars, App data and backups).

Researched 2026-11-02. What Emulsion keeps where, what an ordinary photo backup already covers, how darktable and Lightroom Classic handle backups, and what we could build.

## Where Emulsion's data lives today

| Data | Where | Covered by backing up the photo folders? |
|---|---|---|
| Edits, ratings, labels, hearts, tags, virtual copies, masks | `<photo>.emulsion.json` beside each photo (`src-tauri/src/sidecar.rs`) | Yes |
| Custom looks and their LUTs | `~/Library/Application Support/app.emulsion.desktop/looks/` | No |
| Saved presets | `…/app.emulsion.desktop/presets/` | No |
| Imported camera profiles (DCP) | `…/app.emulsion.desktop/camera-profiles/` | No |
| Default camera profile per camera | WebView `localStorage` (`emulsion.cameraProfiles`) | No |
| Preset favourites and collections, look browser favourites and layout, folder imports, interface preferences | WebView `localStorage` (`emulsion.*` keys) | No |
| Thumbnails, denoise cache | App cache dir | Not needed (rebuilt) |

The sidecars follow darktable's XMP approach, so whoever backs up their photos (Time Machine, a NAS, a cloud drive) already backs up their edits. There is no catalog to lose. Three gaps remain:

1. **A sidecar has no history.** Each save replaces the file with an atomic rename. Reset photo deletes it, and so does removing the last virtual copy when nothing else is set. Undo only lasts for the session. A bad batch "Apply to all", or a reset, is permanent once the app is closed, unless the user's own backup ran first.
2. **A photo can render differently on another Mac, or after a reinstall.** The recipe stores the Look as a snapshot (`lookSnapshot`), so Looks are safe. But `profile: 'auto'` goes through the per-camera default in `localStorage`, and a `dcp:` profile needs its file in `camera-profiles/`. If either is missing, the photo shows "Missing profile" or falls back to another profile.
3. **App data isn't in one place, and part of it is in WebKit's storage.** `localStorage` sits under `~/Library/WebKit/app.emulsion.desktop/`. Users can't find it, it can't be exported, and it is lost if the webview's data is cleared.

## How the community tools do it

- **darktable** keeps the edit history in each XMP sidecar, so edits travel with the files. It also takes automatic snapshots of its two databases, `library.db` and `data.db` (the second holds styles, presets and tags). It keeps 15 daily snapshots of each, plus one made before a version upgrade (`data.db-pre-5.4.1`). The manual says to back up settings by copying the configuration directory, which is also how you move them between installs. ([manual 5.6: backup settings & edits](https://docs.darktable.org/usermanual/5.6/en/preferences-settings/backups/); [pixls.us thread on the snapshot names](https://discuss.pixls.us/t/archive-using-data-db-library-db/55182))
- **Lightroom Classic** backs up its catalog when it exits (each time, next time, or never). The backup holds only the catalog. Photos, previews and presets are not in it, unless "Store presets with this catalog" is on, in which case they go in a folder beside the catalog. ([Adobe: back up a catalog](https://helpx.adobe.com/lightroom-classic/help/back-catalog.html); [Lightroom Queen](https://www.lightroomqueen.com/world-backup-day/))

Both tools leave the photos to the user's own backup and protect only their own data: darktable with rolling snapshots, Lightroom with copies made on exit. Emulsion's edits already travel with the photos, so what we need is darktable's model for the app's own data, plus some history for sidecars.

## Proposal (roadmap)

1. **Move what affects rendering out of `localStorage`.** Store the per-camera profile defaults as a file in the app data folder, as looks and presets already are. Interface preferences can stay where they are.
2. **One settings folder, snapshotted.** Like darktable: on launch, at most once a day, copy `looks/`, `presets/`, `camera-profiles/` and a settings file into `…/app.emulsion.desktop/backups/<date>/`. Keep the last N (darktable keeps 15), plus a copy made before a version upgrade or a settings migration. LUT and DCP files are content-addressed and small, so hard links or a manifest keep this cheap.
3. **Export and import settings.** One `.emulsion-settings` archive with the looks, presets, profiles and preferences, for moving to a new Mac or recovering. This uses the import path presets already have (`read_preset_files`, fresh ids on conflict).
4. **Sidecar history.** Before a save replaces or deletes a sidecar, keep the previous version, either beside the photo (`.emulsion/` per folder) or in the app data folder, keyed by source path. Keep a few per photo for a limited time, and offer "Restore previous edit" in the photo menu. Darktable's equivalent is the history stack inside each XMP. Decide whether these files should sit next to the photos (they travel with them, but clutter shared folders) or in app data (out of sight, but not in the user's photo backup).
5. **Self-contained photos (optional).** When `profile` is `auto`, write the resolved camera profile id into the sidecar, so a sidecar renders the same without the other Mac's defaults. Check this against how profiles are meant to behave (a sidecar says `auto` so that changing the default updates the photo) before changing it.

Open questions for Oli: where sidecar history should live (beside the photo or in app data), how many snapshots to keep, and whether item 5 is wanted.
