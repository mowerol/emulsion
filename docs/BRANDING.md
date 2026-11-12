# Emulsion branding

The artwork comes from Oli's `emulsion-brand (1)` kit (2026-11-11). Runtime assets live
in `public/brand`; the app does not depend on the original Documents folder.

- `mark.svg`: the supplied `emulsion-icon-color.svg`, with its canvas cropped to
  the artwork for use at small sizes. The paths and orange (`#DF7318`) are unchanged in
  the file, but the header uses it as a CSS mask filled with `--accent` (`#E8913A`), so
  the mark matches the Export button (Oli, 2026-11-11).
- `wordmark.svg`: the supplied `emulsion-wordmark-color.svg`, also cropped. The
  header uses it as a CSS mask: paper (`#FAFAFA`) on mid-grey/dark themes, ink
  (`#36393F`) on the light theme. Its custom lettering stays vector at every scale.
- `app-icon.png`: an exact copy of the supplied `logo/icon-app.png`, including its
  shading and transparent edges. It also serves as the browser favicon.

The header uses a 24px mark and 17px wordmark, with an 8px gap. The photo editor's
neutral theme surfaces remain separate from the logo palette so the surround continues to support colour judgement.

To regenerate desktop icons on macOS after replacing the supplied app icon, run:

```sh
swift tools/generate-icons.swift
```

This copies `app-icon.png` into `src-tauri/icons/source.png`, then generates
the desktop PNGs, Windows ICO/Appx assets and macOS ICNS. The supplied 809×820
canvas is contained within square desktop outputs without stretching. The macOS ICNS and
development icon retain the existing optical size: an 848px tile centered on a
1024px transparent canvas. All generated assets are checked in. Rebuild and
relaunch the native app to see the new Dock/Finder icon.
