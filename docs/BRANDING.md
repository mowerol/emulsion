# Emulsion branding

The artwork comes from Oli's `emulsion-brand (1)` kit (2026-11-11). Runtime assets live
in `public/brand`; the app does not depend on the original Documents folder.

- `logo-tile.png`: the app-icon tile at 128 px (the same file as the website's
  `site/public/assets/emulsion-logo.png`), shown at 22 px in the header.
- `app-icon.png`: an exact copy of the supplied `logo/icon-app.png`, including its
  shading and transparent edges. It also serves as the browser favicon.

The header matches the website's lockup (Oli, 2026-11-12): the tile, then "Emulsion" as text in
Geist 600 at 15px, coloured by the theme's `--fg`, with an 8px gap. It replaced the flat orange
mark and the custom-lettered wordmark SVG. The photo editor's
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
