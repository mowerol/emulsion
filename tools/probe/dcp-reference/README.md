# Native DCP reference

Run with Python 3 and clang++ (or `$CXX`), supplying a RawTherapee checkout at
`b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c`:

```sh
python3 tools/probe/dcp-reference/run.py /path/to/RawTherapee
npx vitest run src/engine/dcp.test.ts
```

The extractor copies RawTherapee's matrix, neutral/illuminant, HSV interpolation,
natural spline, Adobe tone curve and late DCP processing bodies into a temporary
standalone C++ executable. Dependency shells and stdin/JSON wrappers replace the
rest of the application. `step2ApplyTile` calls a pointer to the same extracted
Adobe tone curve, rather than an instance member. No Emulsion reference is used
to generate expected numeric values. Commented-out matrix constants are removed
before extracting the active upstream constants.

`make-fixtures.py` generates synthetic matrices and tables and asks the native
executable for expected results. `make-profile.py` packages that synthetic data
into a small DCP to exercise our binary parser. No camera/vendor profile data is
bundled by this tool. Both fixtures are GPL-3.0-or-later.

The browser probe at `tools/probe/index.html?profiles` checks the GLSL stages
against the independently validated TypeScript implementation. The report
includes relative and absolute errors and the worst relative sample.
