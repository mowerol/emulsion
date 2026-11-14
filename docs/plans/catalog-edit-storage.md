# Catalog edit storage

Implemented 13 November 2026. Local app built; no release published.

Edits, marks, metadata, virtual copies and edit history now save in the catalog. The migration keeps existing photo-folder files intact. Settings → Catalog independently enables portable JSON exports and XMP metadata sharing; both exports default to off. Existing XMP is still read.

## Migration and compatibility

Before upgrading a schema-1 database, Emulsion creates and checks a consistent snapshot at `backups/before-catalog-edits/library.db` in its app data folder. Schema upgrades are serialized; older builds refuse schema 2.

On startup, known available source photos are imported individually. Each transaction archives former cached rows, inserts the complete legacy envelope with the original file bytes and digest, verifies it, and commits. A source is either wholly imported or still pending. Startup shows progress. Disconnected sources resume on later launches or folder scans. Unsupported, unreadable or corrupt edit files remain pending with an explanation in Settings; they are never interpreted as empty edits.

The new `edits` table contains one authoritative envelope per source path. Nested folder listings share that record. The former `photos` rows are an index, overlaid from authoritative edits on load, including added and removed copies. An explicit empty record survives a reset, so a leftover JSON file cannot resurrect discarded edits.

Former cache families are retained for recovery, including their marks, metadata and copy recipes. Earlier edits can restore a complete recovered family with undo. The migration does not delete sidecars or offer a cleanup action.

## Saving, exports and restore

`edit_store.rs` is the common module for saving, scanning, edit history, embedded-metadata eligibility and global keyword changes. The old `write_sidecar` and `sidecar_history` command names remain compatible with existing frontend callers. Legacy file writers/readers used to generate fixtures are excluded from production builds.

A save commits the complete catalog envelope first. Optional JSON/XMP export failures clearly distinguish the committed catalog save from the failed export. A portable file changed elsewhere is archived for recovery and left untouched unless the user restores the matching state. Portable exports provide transport to another catalog; they are not automatic bidirectional synchronization between existing catalogs.

Both frontend queues retain failed writes and retry them in order. Failure remains visible with Retry saving; flushing failures prevents navigation away from the current source, quitting, restarting and taking a misleading backup. Catalog restore freezes old-session saves and disables workspace interaction until reload, so queued edits cannot be applied over the restored database.

Catalog backups include authoritative edits, history, recovery records and storage preferences. Removing a photo from the Library retains its edit record for re-import. Photo identity continues to use the existing source path; this change does not add a new file move/relink workflow.

## Verification

- `npm run check` in the combined working checkout: 958 JavaScript tests and 149 Rust tests pass; 22 Rust tests ignored. Includes type checking and production web build.
- Rust integration tests exercise old envelope/history/copy migration, legacy hearts, interrupted transactions, disconnected sources, corrupt/future sidecars, resets, cache conflicts, optional exports, externally changed portable files, global keywords, duplicate folder roots, failed writes and backup restore.
- Browser `catalog-storage` passes: defaults, separate persisted export preferences, preference failures/retry, migration acknowledgement and failed-save retry. Dark Settings, migration notice and error screenshots inspected under `.scratch/catalog-storage-*.png`.
- `cargo test --lib edit_store::tests::migration_scale -- --ignored --nocapture`: 2,000 synthetic source files and 4,000 cached rows imported in 308 ms on this Mac; rerunning imports none. This uses small files on local storage, not real-photo or external-drive timing.
- Marketing site type check passes after updating metadata-sharing copy.

Production app: `src-tauri/target/release/bundle/macos/Emulsion.app`, bundled locally with updater artifacts disabled. Actual mouse/keyboard use in WKWebView and an end-user upgrade from a distributed build still need trying before publishing.
