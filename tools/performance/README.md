# App performance audit harnesses

The report and interpretation are in [app-performance.md](../../docs/research/app-performance.md). These tools measure current behavior; they do not optimize the application.

```sh
node tools/performance/run.mjs state chrome
node tools/performance/run.mjs library webkit
node tools/performance/run.mjs memory webkit
```

The runner copies frontend and native source into a temporary `emulsion-audit-*` checkout and prints its path. Pass that path as the third argument on subsequent commands to compare identical source. Dependencies are symlinked from this workspace. Chrome needs the browser configured by `BROWSER_BIN` or Google Chrome at the existing Mac path. WebKit needs macOS and the Swift compiler; it opens a 1200×800 test window using a nonpersistent data store. Nothing runs against the user's Tauri window or library. Each run replaces that mode/backend's result and manifest under `docs/research/app-performance`; copy old results first if retaining multiple repetitions.

Modes:

- `state`: 1k/10k/50k synthetic photos; real edit/history/persistence-scheduling calls without mounted subscribers, mocked IPC; 30 samples after five warmups. Also serializes a valid ~700k-character raster recipe, 100 samples. Explicit edit labels bypass automatic change-description work.
- `library`: real Library at 1k/10k and Filmstrip at 10k. Counts DOM, synchronous mount/filter commits and 12 selection commits. Thumbnail IPC fails deliberately: it measures UI structure, not image I/O. No 50k DOM mount is attempted.
- `memory`: three independent real GPU engine lifecycles at 640×427, with multiple active stages. Accounts for logical texture storage by context/unit/target/mip, including array depth and deletion; excludes driver/CPU memory. Reports GL errors; does not enforce a memory budget or reproduce the historical crash. Render/readback times include initialization and are not latency acceptance metrics.

To benchmark real native scanning and decoding without changing application source, use the printed snapshot:

```sh
source ~/.cargo/env
EMULSION_AUDIT_PHOTOS='/absolute/photo.JPG|/absolute/photo.RAF' \
  python3 tools/performance/native-run.py /path/to/emulsion-audit-...
```

This adds one test module only inside the disposable checkout, then calls actual native scanner/decoder code. It creates 1k/10k/50k JPEG-named placeholders in a temporary directory; scans each size three times; decodes optional real photos twice at edges 512 and 2560. Photos are read only. Output contains `AUDIT_JSON:`. Compilation is excluded from test measurements. The default dev/test profile is **not a release benchmark**; use the report's caveats. Native vendor directories/build scaffolding are reused locally and are not frozen by this helper.

Audit type check (inside the copied checkout):

```sh
npx tsc --ignoreConfig --noEmit --target ES2022 --lib ES2022,DOM \
  --module ESNext --moduleResolution bundler --allowImportingTsExtensions \
  --resolveJsonModule --isolatedModules --jsx react-jsx --strict --skipLibCheck \
  src/vite-env.d.ts tools/performance/audit.tsx
```

Native WKWebView here is a surrogate with mocked IPC. For end-to-end latency, startup, queue contention, inference and exports, an instrumented Tauri build with real photo recipes and request/generation IDs is still required. Do not equate successful harness completion with meeting app-wide latency or memory goals.
