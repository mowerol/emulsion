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
| `blake3` | CC0-1.0 OR Apache-2.0 |
| React, React DOM | MIT |
| zustand | MIT |

## Trademarks

Film stock and scanner names (Kodak Portra, Gold, Ektar, Tri-X; Fujifilm Superia, Pro 400H, Frontier; CineStill; Ilford HP5; Noritsu; Epson) are trademarks of their owners. Emulsion's looks are approximations inspired by these products and are not affiliated with or endorsed by their makers.
