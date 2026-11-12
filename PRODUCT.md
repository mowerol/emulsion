# Product

<!-- impeccable:product-schema 1 -->

## Platform

web (a macOS desktop app: Tauri with a React interface in WKWebView. The design language is the app's own, not native AppKit.)

## Users

- **Primary:** enthusiast RAW shooters: hobbyists and semi-pros with a couple of cameras (for example a Fujifilm and an OM System body) who care about film-like rendering. They know Lightroom and want something more film-minded, built on the open-source photo community's tools.
- **Secondary:** working photographers who deliver volume and need a look to stay consistent across a shoot and across cameras.

## Purpose

Emulsion develops photos (RAW and ordinary) through film looks. Open or import a folder, choose a Look, set its Amount, and refine tone, colour, scanner finish, halation, glow and grain. Edits live in small sidecar files next to each photo; originals are never touched.

## Position

- The processing is ported, with credit, from the tools the photo community rates best (darktable by default, RawTherapee where it is stronger), not invented or tuned by eye.
- Looks are editable settings (an optional base LUT, plus colour balance rgb, tone curve, HSL and scanner finish) with one Amount, not baked LUTs.
- Everything runs locally on the Mac, including the optional AI tools.

## Constraints

- Controls must stay at 58 fps with 25 ms latency in the real app on a Retina screen; the photo aims for 40 fps.
- Halation and grain default to 0. Emulsion Standard is the default look for new edits.
- Dark interface by default, with a light theme.

## Open decisions

- Whether a custom look should be able to carry grain.
- Sharing looks between people (no export or import format yet).
