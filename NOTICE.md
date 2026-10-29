# Notices

Emulsion is licensed under the GNU General Public License, version 3 or later (GPL-3.0-or-later). See [LICENSE](LICENSE).

## Code ported from other projects

None yet. Every port is listed here with its source, upstream licence, the upstream commit it came from, and what changed. See [docs/PORTING.md](docs/PORTING.md) for the format.

<!--
Template:

### <module>, from <project>
- Upstream: <repository URL>, <path>, commit <hash>
- Licence: <SPDX id>
- Copyright: <upstream copyright lines, verbatim>
- Ported to: <path in Emulsion>
- Changes: <for example, "translated from C to GLSL; parameters mapped to Emulsion's recipe">
-->

## Bundled libraries

### LibRaw 0.22.3
- Upstream: https://www.libraw.org/data/LibRaw-0.22.3.tar.gz (SHA-256 789f3c33466210a1a0907f747a97c715d21bbf4af712f257fcbbd90111b227e4)
- Licence: LGPL-2.1, chosen from LibRaw's LGPL-2.1 or CDDL-1.0 dual licence
- Copyright: Copyright (C) 2008-2025 LibRaw LLC (http://www.libraw.org, info@libraw.org). LibRaw uses code from dcraw.c, copyright 1997-2018 Dave Coffin, and the DCB demosaic and FBDD denoise, Copyright (C) 2010 Jacek Gozdz (BSD-like 3-clause)
- Location: `src-tauri/vendor/libraw`, with its `COPYRIGHT`, `LICENSE.LGPL` and `LICENSE.CDDL`
- Changes: none. Only the library sources (`src`, `libraw`, `internal`) are included; samples, build files and RawSpeed/DNG SDK integrations are left out. It is compiled into Emulsion by `src-tauri/build.rs`
- The OM-3 colour matrix in `src-tauri/src/raw.rs` is LibRaw's OM-1 entry from `src/tables/colordata.cpp`

## Bundled assets

### Archivo typeface
- Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo)
- Licence: SIL Open Font License 1.1, bundled through `@fontsource-variable/archivo`

## Main dependencies

These are used as libraries, not copied, and keep their own licences.

| Dependency | Licence |
| --- | --- |
| Tauri and its plugins | Apache-2.0 OR MIT |
| `image` crate | MIT OR Apache-2.0 |
| `rayon`, `half`, `serde`, `percent-encoding` | MIT OR Apache-2.0 |
| `walkdir` | Unlicense OR MIT |
| `natord` | MIT |
| `cc` (build only) | MIT OR Apache-2.0 |
| `blake3` | CC0-1.0 OR Apache-2.0 |
| React, React DOM | MIT |
| zustand | MIT |

## Trademarks

Film stock and scanner names (Kodak Portra, Gold, Ektar, Tri-X; Fujifilm Superia, Pro 400H, Frontier; CineStill; Ilford HP5; Noritsu; Epson) are trademarks of their owners. Emulsion's looks are approximations inspired by these products and are not affiliated with or endorsed by their makers.
