# GPU acceleration: WebGPU, native Metal, MPS and faster local-contrast maths

Researched 2026-11-03, after Oli said he wants more speed and would accept moving away from strict darktable ports to get it. Machine: Apple M2 (10-core GPU), macOS 26.5.1 (25F80), Command Line Tools SDK 26.5. Emulsion at a8c47b2: Tauri 2.12.5, wry 0.57.1 (from `src-tauri/Cargo.lock`). No application code was changed. The scratch probes described below lived in the session scratchpad and are not in the repo.

**What was measured here, and what wasn't.** Three new measurements on this Mac: (1) a plain `WKWebView` (default configuration, as wry builds it) reporting WebGPU availability, its adapter's features and limits, and the same 25-tap kernel timed in WebGL2 and in WebGPU; (2) the same kernel and several Metal Performance Shaders filters timed natively, from `MTLCommandBuffer.gpuStartTime/gpuEndTime`; (3) round trips through a `WKURLSchemeHandler`, the transport Tauri's IPC uses. None of them is the Emulsion app. In-app numbers below are quoted from [HANDOFF.md](../../HANDOFF.md) and come from `tools/perf/inapp.mjs`.

## Summary

1. **WebGPU is on by default in WKWebView on macOS 26, with no preference or entitlement.** Its adapter offers compute, `shader-f16`, `timestamp-query`, `float32-filterable` and 44 sampled textures per stage. On a kernel like ours, though, it ran **1.7–2.2× slower than WebGL2** in the same webview. Porting to it would cost a rewrite and would probably lose time.
2. **WebGL2 through ANGLE-Metal is at native speed for a single pass.** The same kernel in native Metal took 2.01 ms (r32float) and 3.30 ms (rgba32float) against WebGL2's 1.85 and 3.28 ms. A native engine would gain only from what a pass can't show: MPS primitives, command-buffer control, no deferred allocations, no IPC copy of the full resolution. It would cost a full rewrite and two-process compositing.
3. **The biggest gain left is in the maths, and the largest piece is exact.** darktable's local Laplacian is affine in Emulsion's Clarity slider on each side of zero, as Texture's equalizer is in its mix. A Clarity drag can then be a multiply instead of rebuilding ten pyramids, with no deviation from darktable. Beyond that, darktable's own bilateral-grid mode, RawTherapee's fast guided filter for dehaze, and coarser Texture bands are real approximations. They would need Oli's approval.

## Where the time goes now (from HANDOFF.md)

The real-app loop at 100% on 1OKK6432.RAF:

| Drag | Order | ms/frame | Notes |
| --- | --- | ---: | --- |
| Exposure, Texture+Clarity+Dehaze on | darktable | 48–56 | develop taps ~22, Texture à-trous 15 (region) + 12 (preview), Sharpening 5, screen 4, ~10–15 unexplained |
| Exposure, all three on | log (trial) | 15 | PASS |
| Clarity, others on | log | 36 | ten pyramids rebuilt each tick |
| Texture, others on | log | 35 | Texture itself is a fold; it remakes Clarity |
| Dehaze across zero | either | 54 | guided filter rebuilt per sign (option C) |

Per pass, Emulsion's work is small. Its frames are slow because a slider rebuilds whole chains of passes. The "unexplained 10–15 ms" was suspected to be ANGLE render-pass breaks, blits or uploads. That has not been confirmed: the Metal System Trace needs full Xcode.

## 1. WebGPU in WKWebView

**Enabled by default.** In WebKit, `WebGPUEnabled` defaults to true under `ENABLE(WEBGPU_BY_DEFAULT)`, has `disableInLockdownMode: true`, and is a WebKit preference rather than a Safari one ([UnifiedWebPreferences.yaml at e369f5b](https://github.com/WebKit/WebKit/blob/e369f5b021315a6faac2cb00caf0f7176d7386c3/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml#L7392-L7403)). `ENABLE_WEBGPU_BY_DEFAULT` is defined for `PLATFORM(MAC) && __MAC_OS_X_VERSION_MIN_REQUIRED >= 260000` ([PlatformEnable.h#L672](https://github.com/WebKit/WebKit/blob/e369f5b021315a6faac2cb00caf0f7176d7386c3/Source/WTF/wtf/PlatformEnable.h#L672-L674)). That is WebKit trunk, not the exact branch macOS 26.5 shipped, so it was checked on the system WebKit (next paragraph). WebKit's Safari 26.0 post says Safari 26.0 "adds support for WebGPU" on macOS, iOS, iPadOS and visionOS and that it "supersedes WebGL" there; it does not mention WKWebView ([WebKit Features in Safari 26.0, 2025-09-15](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).

**Checked on this Mac.** A plain `WKWebView` with a default `WKWebViewConfiguration` exposed `navigator.gpu` from `file://` and from a custom `tauri://localhost` scheme (both `isSecureContext` true), and `requestAdapter()` returned an adapter. Apple's `WKPreferences` documents no WebGPU property ([WKPreferences](https://developer.apple.com/documentation/webkit/wkpreferences)). No preference or entitlement is needed. Lockdown Mode turns it off. Not tested here: the dev server origin `http://localhost:1420`. Localhost should count as a secure context, but that wasn't checked.

**What wry and Tauri expose.** wry 0.57.1 sets only a few `WKPreferences` keys: `allowsPictureInPictureMediaPlayback`, `drawsBackground` when transparent, `elementFullscreenEnabled`, `inactiveSchedulingPolicy`, `tabFocusesLinks`, and `developerExtrasEnabled` in debug. None of them touches WebGPU ([wry 0.57.1 `src/wkwebview/mod.rs`](https://docs.rs/crate/wry/0.57.1/source/src/wkwebview/mod.rs), around lines 386–591). So the Tauri webview gets WebKit's default, WebGPU on. A quick check needs no app change: in the dev app's Web Inspector console, run `navigator.gpu && (await navigator.gpu.requestAdapter()).limits.maxSampledTexturesPerShaderStage`.

**Features and limits** (`adapter.features` and `adapter.limits` in WKWebView, this M2):

- Features: `bgra8unorm-storage`, `core-features-and-limits`, `depth-clip-control`, `depth32float-stencil8`, `float16-renderable`, `float32-blendable`, `float32-filterable`, `float32-renderable`, `indirect-first-instance`, `rg11b10ufloat-renderable`, **`shader-f16`**, the BC/ETC2/ASTC compression features, **`texture-formats-tier1`** and **`timestamp-query`**. `texture-formats-tier2` is absent.
- Limits: `maxSampledTexturesPerShaderStage` 44, `maxSamplersPerShaderStage` 22, `maxStorageTexturesPerShaderStage` 44, `maxBindGroups` 11, `maxColorAttachments` 8, `maxColorAttachmentBytesPerSample` 64, `maxComputeWorkgroupStorageSize` 32768, `maxComputeInvocationsPerWorkgroup` 1024, `maxTextureDimension2D` 16384, `maxBufferSize` and `maxStorageBufferBindingSize` 2147483644.
- The spec's defaults, which a device gets unless it asks for more, are 16 sampled textures per stage, 4 bind groups, 4 storage textures per stage and 16384 bytes of workgroup storage ([WebGPU, W3C CRD 2026-09-15, limits](https://www.w3.org/TR/2026/CRD-webgpu-20260915/#limits)). Emulsion's develop pass uses all 16 WebGL units (CLAUDE.md). Under WebGPU it would ask for 44 and stop juggling units, and texture and sampler bindings are separate there.
- **Storage textures.** Write-only `rgba16float`, `rgba32float` and `r32float` are core. **Read-write is core only for `r32float`.** `rgba16float` and `rgba32float` read-write need `texture-formats-tier2` ([spec §26.1](https://www.w3.org/TR/2026/CRD-webgpu-20260915/#texture-format-caps), feature definitions in §25). WebKit doesn't offer tier2. On this Mac a `texture_storage_2d<rgba32float, read_write>` pipeline was rejected and an `r32float` one accepted. In-place RGBA float compute (e.g. a pyramid collapse in place) is therefore not available; it would need ping-pong textures, as WebGL already uses.
- `timestamp-query` values are "aligned to a lower precision" by the spec ([spec, security considerations](https://www.w3.org/TR/2026/CRD-webgpu-20260915/#security-timing)). In WebKit, compute-pass timestamps matched wall-clock time. Render-pass timestamps came out 10–20× the wall-clock time, so treat them as unreliable on this GPU (unexplained).

**Performance against WebGL2.** WebKit claims WebGPU "maps better to Metal" and that WebGL carried "significant translation overhead"; it gives no benchmark ([Safari 26.0 post](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)). WebKit's WebGL is ANGLE on Metal (`EGL_PLATFORM_ANGLE_TYPE_METAL_ANGLE`, [GraphicsContextGLCocoa.mm#L161](https://github.com/WebKit/WebKit/blob/e369f5b021315a6faac2cb00caf0f7176d7386c3/Source/WebCore/platform/graphics/cocoa/GraphicsContextGLCocoa.mm#L161)) and runs in the GPU process ([`UseGPUProcessForWebGLEnabled`](https://github.com/WebKit/WebKit/blob/e369f5b021315a6faac2cb00caf0f7176d7386c3/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml#L6738-L6749)). I found no first-party comparison of the two, so I measured one.

The kernel was a 5 × 5 edge-weighted gather like one à-trous step: 25 `texelFetch`/`textureLoad` taps, each weighted by exp(−8·|v.x − c.x|), normalised. It ran over 2784 × 2368 (the region size from HANDOFF), ping-pong, 40 passes per measurement, median of 3 repeats, the window visible. Two runs agreed within 5%.

| ms per pass | r32float | rgba16float | rgba32float |
| --- | ---: | ---: | ---: |
| WebGL2 fragment (ANGLE-Metal), WKWebView | **1.83** | **2.2** | **3.26** |
| WebGPU fragment, WKWebView | 3.1 | 4.4 | 5.9–6.1 |
| WebGPU compute 16×16, WKWebView | 3.6–3.7 | 3.8–3.9 | 7.1–7.4 |
| WebGPU compute, 20×20 tile in workgroup memory | 5.35 | 5.5 | 5.55–5.65 |
| Native Metal compute 16×16 (MSL, same maths) | 2.01 | 2.25 | 3.30 |

WebGL times are wall time per pass up to a 1-pixel `readPixels` that depends on the whole chain. WebGPU times are wall time up to `onSubmittedWorkDone`; for compute they matched timestamp queries. Native times are GPU time. Two conclusions:

- WebGL2 here is as fast as native Metal for this kind of pass.
- WebGPU as WebKit compiles it is slower on the same maths, even with workgroup-memory tiling. The cause wasn't isolated (unverified). Candidates are bounds clamping that WGSL-to-MSL inserts for robustness, or stricter float maths around `exp`. A better-tuned WGSL kernel might close some of the gap.

WebGPU's real advantages are elsewhere: compute for reductions, histograms and prefix sums (box filters in O(1) per pixel); explicit command encoding, which would make the "unexplained" per-frame time visible; and 44 textures per stage. None of these is measured here.

## 2. Native Metal from Rust inside Tauri

**How the layers stack.** For a normal Tauri window, wry makes a `WryWebViewParent` view and makes it the window's `contentView` (`ns_window.setContentView(Some(&parent_view))`), with the `WKWebView` as its subview. With `build_as_child` it adds the webview as a subview of the given view ([wry 0.57.1 `mod.rs` ~L720–767](https://docs.rs/crate/wry/0.57.1/source/src/wkwebview/mod.rs)). Tauri hands out the window's `ns_view`/`ns_window` and implements `raw_window_handle::HasWindowHandle` for `Window` and `WebviewWindow` ([tauri 2.12.5 `src/window/mod.rs` L1018, L1729–1760](https://docs.rs/crate/tauri/2.12.5/source/src/window/mod.rs)). A transparent webview needs `drawsBackground = false`. Tauri's `macOSPrivateApi` flag is a "no-op in Tauri 2.12.1+ because the APIs are always enabled now" ([tauri-utils 2.10.2 `config.rs` L3375–3379](https://docs.rs/crate/tauri-utils/2.10.2/source/src/config.rs)).

**wgpu.** `instance.create_surface(window)` on macOS calls `raw_window_metal::Layer::from_ns_view` ([wgpu-hal `metal/mod.rs` at 0c0bca3](https://github.com/gfx-rs/wgpu/blob/0c0bca32c596f9272464d593d48e39f9335b6a7d/wgpu-hal/src/metal/mod.rs#L159-L172)). That function returns the view's own `CAMetalLayer`, or creates one "and inserts it as a sublayer into the view's layer", with "the same bounds and scale factor as the given view". It also warns against changing `bounds`/`contentsScale` on the returned layer ([raw-window-metal 1.1.0](https://docs.rs/raw-window-metal/latest/raw_window_metal/struct.Layer.html)). HiDPI follows the view's scale. Resizing is the app's job: reconfigure the surface on `Resized`, as in wry's own [`examples/wgpu.rs` at 9f351c5](https://github.com/tauri-apps/wry/blob/9f351c5aec4888533812d63d5a003f3b3400210b/examples/wgpu.rs). That example uses a transparent winit window with a wgpu surface, and a transparent child webview on top.

**Existing Tauri examples.** [FabianLars/tauri-v2-wgpu](https://github.com/FabianLars/tauri-v2-wgpu) (last pushed 2024-07) passes the `WebviewWindow` straight to `create_surface`. On macOS the webview draws on top, and a Tauri maintainer called that "the correct one" ([tauri#10155](https://github.com/tauri-apps/tauri/issues/10155)). On Linux the two fight over the surface and flicker ([tauri#9220](https://github.com/tauri-apps/tauri/issues/9220)). [clearlysid/tauri-wgpu-cam](https://github.com/clearlysid/tauri-wgpu-cam) builds on it for camera frames. Tauri has no built-in wgpu view. A maintainer said an embedded element "is not planned yet" and might follow once the `unstable` multi-webview feature stabilises ([tauri#15213](https://github.com/tauri-apps/tauri/issues/15213)). Off-screen webview rendering "is not supported and probably won't ever be" ([tauri#13740](https://github.com/tauri-apps/tauri/issues/13740)). No community plugin was found that solves layout sync or input for a native view under the webview.

**Bindings.** metal-rs says "Use of this crate is deprecated … please use objc2 and objc2-metal" ([gfx-rs/metal-rs README](https://github.com/gfx-rs/metal-rs)), and wgpu-hal now uses `objc2-metal` and `objc2-quartz-core` ([wgpu-hal Cargo.toml at 0c0bca3](https://github.com/gfx-rs/wgpu/blob/0c0bca32c596f9272464d593d48e39f9335b6a7d/wgpu-hal/Cargo.toml)). The choice:

- **wgpu (30.0.1):** portable, WGSL, validation. `Texture::as_hal` gives the underlying Metal texture for MPS ([docs.rs](https://docs.rs/wgpu/latest/wgpu/struct.Texture.html)). It is a second WGSL translation on top of Metal, the same kind of layer as WebKit's.
- **objc2-metal:** direct MSL and MPS, Instruments-friendly, macOS only.

The table in section 1 shows native MSL per pass at par with WebGL2, so the gain would come from structure, not raw shader speed.

**Compositing, input, HiDPI.** A `CAMetalLayer` presents "asynchronously to any Core Animation transactions", and "Core Animation doesn't guarantee that the Metal content arrives in the same frame as other Core Animation content", which matters when UI is drawn over it. `presentsWithTransaction = true` syncs with the current transaction ([Apple: presentsWithTransaction](https://developer.apple.com/documentation/quartzcore/cametallayer/presentswithtransaction)). The webview's layers, however, are committed by WebKit's other processes. My unverified expectation is that a native image under the webview's DOM overlays would drift by a frame during pans and zooms: the crop overlay, mask outlines, brush cursor and the zoom stand-in. Input would stay in the webview (the native view sits underneath and gets no events), with every pan, zoom and slider sent to Rust.

**IPC cost.** Tauri 2's IPC is a `fetch` to `ipc://localhost/<cmd>` ([tauri 2.12.5 `scripts/ipc-protocol.js`, `src/ipc/protocol.rs`](https://docs.rs/crate/tauri/2.12.5/source/scripts/ipc-protocol.js)), served by wry through a `WKURLSchemeHandler`. Measured here, without Tauri's Rust routing or serde: **0.17 ms** per 64-byte round trip, 0.25–0.27 ms per 64 KB, 2.7–2.9 ms per 4 MB, sequential and averaged. Slider updates over IPC would cost about 0.2 ms plus Tauri's dispatch (unmeasured). Latency is not the obstacle. Extrapolated at ~0.7 ms/MB, the ~200 MB full-resolution transfer would be ~140 ms of transport. So the 11–18 s wait after Z is mostly decoding, not IPC (consistent with HANDOFF's open item; unverified by stage).

**Zero-copy display.** Natively: render into the layer's drawable (`framebufferOnly`, the default, lets Core Animation optimise it for display, [Apple](https://developer.apple.com/documentation/quartzcore/cametallayer/framebufferonly)) and let the window server composite it under the transparent webview. No readback, no copy into the webview. Inside the webview, WebGL already renders in the GPU process and hands its surface to the compositor, so there is no CPU copy today either. The native gain is skipping the webview's canvas compositing, about a frame of latency at most (unverified). It is not a throughput gain.

## 3. Metal Performance Shaders for photo editing

All of these are in `MPSImage`, available since macOS 10.13 (guided filter 10.13.4) ([Apple MPS docs](https://developer.apple.com/documentation/metalperformanceshaders/mpsimagegaussianpyramid)). From Rust they are bound by [`objc2-metal-performance-shaders` 0.3.2](https://docs.rs/objc2-metal-performance-shaders/latest/objc2_metal_performance_shaders/), which has `MPSImageGaussianBlur`, `MPSImageGaussianPyramid`, `MPSImageLaplacianPyramid(Add/Subtract)` and `MPSImageGuidedFilter`. MPS works on `MTLTexture`s, so it needs native Metal (or wgpu's `as_hal`). Neither WebGL nor WebGPU can call it. The behaviour notes below are from the SDK 26.5 headers (`MPSImageConvolution.h`, `MPSImageGuidedFilter.h`). Times are GPU time on 2784 × 2368 on this M2.

| Kernel | What it does | r32float | rgba16float | rgba32float |
| --- | --- | ---: | ---: | ---: |
| `MPSImageGaussianBlur` σ 2 / 8 / 32 | "very fast algorithm … approximately 1/2 of copy speeds"; "an approximate gaussian … suitable for … ~10 bits of precision or less" | 1.45 / 1.03 / 0.79 | 2.39 / 1.98 / 1.44 | 4.72 / 4.00 / 2.94 |
| `MPSImageGaussianPyramid` (all mips) | in place into the texture's mip levels, 5-tap kernel w = [1/16, 1/4, 3/8, 1/4, 1/16] (adjustable centre weight); ignores `clipRect` | 0.52 | 1.04 | 2.08 |
| `MPSImageLaplacianPyramidSubtract` / `Add` | L[l] = G[l] − Interpolate(G[l+1]) (Burt & Adelson), and its inverse; not in place; source and destination must match in channels, depth and size; `laplacianBias/Scale` for normalised formats | 0.86 / 0.88 | 1.75 / 1.75 | 3.42 / 3.47 |
| blit `generateMipmaps` (for comparison) | box downsample | 0.46 | 0.84 | 1.62 |
| `MPSImageGuidedFilter`, diameter 9 / 33, at full size | two stages: regression to a 4-channel a·RGB + b coefficient image "(typically at a very low resolution)", then reconstruction with the coefficients upsampled; cites He and Sun's Fast Guided Filter; optional half precision | — | 11.5 / 74.8 | 18.5 / 111.8 |

What this means for Emulsion:

- **Blur:** Gaussian blur at ~10 bits doesn't meet the float-exact references the probe checks against. It is not a drop-in replacement for RawTherapee's `gaussianBlur` in Sharpening.
- **Pyramids:** they are fast, but darktable's local Laplacian uses its own 5-tap reduce and expand with edge handling. MPS's matches the default weights; the boundary rules are unverified.
- **Guided filter:** guidance must be colour and the source one channel, which suits darktable's dehaze transmission. Run at full size with a large window, though, it is far slower than Emulsion's own passes. Its value is the fast low-resolution form, which is itself a deviation from darktable (section 4).
- **Bilateral:** MPS has no bilateral filter (no `MPSImageBilateral*` class in the SDK headers or the objc2 bindings).

MPS would be a convenience in a native engine, not a reason to have one.

## 4. Faster local contrast, clarity, texture and dehaze

### What the papers give

- **Bilateral grid** (Chen, Paris, Durand, "Real-time Edge-Aware Image Processing with the Bilateral Grid", SIGGRAPH 2007, [PDF](https://people.csail.mit.edu/sparis/publi/2007/siggraph/Chen_07_Bilateral_Grid.pdf)). Splat into a grid downsampled in space (s_s) and range (s_r), blur it, slice by trilinear lookup. The bilateral filter was "linear in the image size, ranging from 4.5ms for 1 megapixel to 44.7ms for 10 megapixels" on a GeForce 8800 GTX. Its cost is mostly the splat and slice; the grid is tiny.
- **Fast local Laplacian filters** (Aubry, Paris, Hasinoff, Kautz, Durand, ACM TOG 33(5), 2014, [PDF](https://people.csail.mit.edu/sparis/publi/2014/tog/Aubry_14-Fast_Local_Laplacian_Filters.pdf)). Precompute the Laplacian pyramids of a fixed set of remapped images and interpolate per coefficient. This is "about 50× faster" than Paris et al. 2011, "about 49ms for a one megapixel image and about 116ms for a four megapixel image" on a GTX 480. Accuracy is "above 30dB" when sampling the intensity range "every standard deviation σ". **This is already what darktable and Emulsion run** (six levels; ten on the log trial).
- **Guided filter** (He, Sun, Tang, ECCV 2010; TPAMI 35(6) 2013, [doi:10.1109/TPAMI.2012.213](https://doi.org/10.1109/TPAMI.2012.213)) is O(N) through box filters. The **fast guided filter** (He and Sun, [arXiv:1505.00996](https://arxiv.org/abs/1505.00996), 2015) computes the coefficients on an image subsampled by s, "from O(N) time to O(N/s²) time … a speedup of >10× with almost no visible degradation".

### What darktable implements (at 20891f6, release 5.6.2, the pin Emulsion uses)

- **Local contrast** ([`src/iop/bilat.c`](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/bilat.c)) has two modes: `s_mode_bilateral` ("bilateral grid") and `s_mode_local_laplacian` (the default). The "clarity" preset is local Laplacian mode with `detail` 0.33 and `midtone` 0.5 (L180–186).
  - In bilateral mode the grid is splatted and blurred from the input alone. The **amount enters only at slice**: `dt_bilateral_slice(b, in, out, d->detail)` with `norm = -detail * sigma_r * 0.04` and L_out = L + norm · trilinear(grid) ([`src/common/bilateral.c` ~L401–435](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/common/bilateral.c)). The OpenCL splat uses atomics (`dt_opencl_avoid_atomics`, bilat.c ~L303). WebGL2 has none, so a port would splat by gathering per grid cell.
  - Local Laplacian mode ([`src/common/locallaplacian.c`](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/common/locallaplacian.c)) is Aubry et al.'s scheme with `num_gamma 6`, a remapping `curve_scalar` (L313–343) and a coarse-to-fine collapse that blends two levels' Laplacians by the input's Gaussian pyramid (L540–560).
- **Contrast equalizer** (`atrous.c` with `eaw.c`): edge-avoiding à-trous wavelets, already ported as Texture.
- **Haze removal** ([`src/iop/hazeremoval.c`](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/hazeremoval.c)): He et al.'s dark channel, box min and max with w1 = 2 + ⌈4s⌉, then `guided_filter(img_in, trans_map, …, w2, eps = sqrt(0.025))` at the module's full input size with w2 = 3 + ⌈6s⌉ (L576–672). That is the full-resolution guided filter, not the fast one.

### What RawTherapee and ART implement

- **RawTherapee local contrast** ([`rtengine/iplocalcontrast.cc` at b2ee504](https://github.com/RawTherapee/RawTherapee/blob/b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c/rtengine/iplocalcontrast.cc)), "ported from G'MIC": one Gaussian blur of L, then L + a·(L − blur), with separate dark and light gains. In effect an unsharp mask with a large radius. It is cheap (one blur, one pass), but it is not edge-aware.
- **RawTherapee dehaze** ([`rtengine/ipdehaze.cc`](https://github.com/RawTherapee/RawTherapee/blob/b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c/rtengine/ipdehaze.cc)): He et al.'s dark channel prior with a guided filter for the soft matting. The dark channel is taken over patches (`patchsize = max(max(W,H)/600, 2)`), with guided filter radius `patchsize * 4`. Its `guidedFilter` is "a Fast Guided Filter implementation, derived directly from the pseudo-code of the paper", subsampling by up to 5 (`calculate_subsampling`, 1 under 600 px) ([`rtengine/guidedfilter.cc`](https://github.com/RawTherapee/RawTherapee/blob/b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c/rtengine/guidedfilter.cc)).
- **ART** (at 26d8c0b): local contrast is a wavelet decomposition with per-level contrast curves (`local_contrast_wavelets`, [`src/engine/iplocalcontrast.cc`](https://github.com/artpixls/ART/blob/26d8c0bc5c6833e8483ac6521bb3fd03d9d56a9b/src/engine/iplocalcontrast.cc)). Dehaze keeps RawTherapee's structure with its own guided filter ([`src/engine/ipdehaze.cc`](https://github.com/artpixls/ART/blob/26d8c0bc5c6833e8483ac6521bb3fd03d9d56a9b/src/engine/ipdehaze.cc)). ART now also has a Vulkan compute backend for denoise, Gaussian blur and guided filter passes ([`src/engine/gpu`](https://github.com/artpixls/ART/tree/26d8c0bc5c6833e8483ac6521bb3fd03d9d56a9b/src/engine/gpu)). That is a sign that the RawTherapee family is moving those filters to compute too (no timings published that I found).

### Mapped onto Emulsion

**Clarity: an exact shortcut exists (new finding).** `clarityParams` (`src/engine/locallaplacian.ts`) maps the slider t ∈ [0, 1] to shadows = highlights = 1 − t and clarity = 0.33·t. For t < 0 it is shadows = highlights = 1 and clarity = 0.33·t.

- **The curve is affine in t.** In `curve` (darktable's `curve_scalar`), the branch taken depends only on c = x − g and sigma, and each branch is affine in shadows, highlights and clarity. So for a fixed sign of t, every remapped image r_k(I) is affine in t. At t = 0 the curve is the identity: g + c in the outer branches, g + 2σu(1−u) + 2σu² = g + c in the inner ones.
- **So is the whole filter.** The Laplacian pyramids are linear. The interpolation weights come from the input's Gaussian pyramid, which doesn't depend on t. The collapse is linear. So ΔL(t) = |t| · D₊ for t > 0 and |t| · D₋ for t < 0, where D± = LL(±1) − input. This is exact up to float rounding, like Texture's `amountScales`. It holds in the log trial too, since the input clamp doesn't depend on t.
- **What changes.** A Clarity drag becomes the fold pass (`maskfold` with a scale) plus Sharpening's rebuild. It no longer reruns the develop tap and ten pyramids per tick. Keep one decomposition per sign, as Dehaze does.
- **Expected effect.** The Clarity drag at 100% (36 ms) should fall to roughly the Texture-drag cost of ~20 ms (estimate, not measured). Masked Clarity instances still rebuild, since their input carries the sum so far, as with Texture. The HANDOFF note "non-linear in the amount, no exact shortcut known" should be revisited.

**Clarity rebuilt by earlier sliders** (Texture drag 35 ms in log order; every earlier slider in darktable order).

- **darktable's own bilateral-grid mode** (same module, so the port rule holds) builds a grid from L at about W/σ_s × H/σ_s × 100/σ_r cells (`dt_bilateral_grid_size`, already in `src/engine/bilateral.ts` for retouch) and applies the amount at slice. A rebuild is splat + blur + slice, a few passes over the image and a small grid. That is instead of ten pyramids plus collapse. Expected: Clarity's own rebuild from ~10 passes to ~3, the largest approximation gain per ms (estimate).
- **The cost is the look.** It is a different filter from the "clarity" preset: more halo risk at strong settings (HANDOFF's assessment; Aubry et al. call local Laplacian results cleaner "on a wider range of parameters" than bilateral-grid-speed filters), and its parameters (σ_s, σ_r) aren't given by the preset. Needs side-by-sides and Oli's approval.

**Texture** is already a fold when dragged. When earlier sliders change, its à-trous costs 15 ms (region) + 12 ms (preview) in darktable order, and nothing in log order for Exposure.

- **Keep the structure.** Emulsion's à-trous passes already run at the GPU's speed for that kind of pass (the same kind measured in section 1), so the gains are structural.
- **Option 1 (approximation):** fewer local bands on the region, taking more from the preview (the approved region split at 32 px could move to 16 px).
- **Option 2 (deviation):** compute the coarse bands at half resolution, since the decimated and undecimated wavelet bands agree at large scales only approximately.

Both deviate from darktable and need Oli.

**Dehaze.** Exact today, with drags already cheap except across zero.

- **Exact first:** option C, prebuilding the other sign's guided filter at idle, removes the 54 ms drag with no deviation.
- **Approximation:** the fast guided filter with s = 2–4, which is how RawTherapee does it. The full-size box passes would shrink ~s² (paper), which helps the first build and the 100% first-drag freeze (~450 ms). It deviates from darktable's literal full-size filter, though transmission maps are smooth enough that the paper's "almost no visible degradation" is plausible (unverified on Oli's photos). The MPS guided filter's full-size timings above show this has to be done at low resolution to pay off.

**Where an approximation saves the most GPU time.**

1. The develop taps (~22 ms of the 48–56 ms darktable-order frame) are the biggest single cost. Moving the detail stages before Exposure (the log trial) already removes them for Exposure. No filter approximation touches them.
2. Next is Clarity's rebuild when earlier sliders move: darktable's bilateral-grid mode.
3. Then Texture's preview-lane rebuild.
4. Dehaze's full-size guided filter matters only for first builds.

The Clarity-drag cost itself goes away exactly with the affine shortcut.

## Recommendation

Ranked by expected speed gain against migration cost for this codebase:

1. **Exact algorithmic work first (high gain, low cost, no deviation).**
   - The affine-in-amount Clarity decomposition, per sign: Clarity drag ~36 → ~20 ms estimated.
   - Dehaze's other-sign prebuild at idle (option C): 54 ms → the normal Dehaze drag.

   Each is a reference change with tests, a GLSL twin and a probe check: days, not weeks. Together with the log-order trial these fix every failing drag in HANDOFF except Texture-with-Clarity, at no cost to the port rule.
2. **Approximations from the same tools (medium-high gain, medium cost, needs Oli's approval of the look).**
   - darktable's bilateral-grid local contrast for Clarity: cheap rebuilds when earlier sliders move.
   - RawTherapee's fast guided filter for the dehaze transmission.
   - Coarser Texture bands on the region.

   Each is a contained swap behind a switch, with side-by-sides, as the log trial was done.
3. **Native Metal (uncertain gain, very high cost).** Per pass it is at par with WebGL2 here. The case for it is structural: MPS, explicit command buffers and Instruments, no ANGLE deferred allocations, a full resolution that never crosses IPC, and possibly the "unexplained" 10–15 ms per frame. The costs:
   - rewriting the pass shaders (~1,500 lines of `*.frag.glsl`) and the stage GLSL, plus the engine's lanes, caches and probe, in Rust/MSL;
   - giving up the browser probe as the GPU check;
   - two processes for every interaction;
   - overlay sync through Core Animation, which Apple doesn't guarantee frame-accurate.

   Only worth it if the prototype below shows a large frame-level gap.
4. **WebGPU (likely negative gain, high cost).** Available with no setup and with better limits, but measured 1.7–2.2× slower per pass than WebGL2 in this WKWebView. It would mean translating every shader to WGSL and losing nothing to ANGLE that ANGLE is measurably costing per pass. Revisit only for compute-only jobs (histograms, reductions, box filters by prefix sums), after a tuned kernel beats the WebGL version on this Mac.

A combination is the realistic plan: 1 now, 2 where Oli accepts the look, and 3 only on evidence.

**The single prototype that decides it: replay one real slow frame natively.** Record the pass list of a failing `z100combo` frame (Exposure at 100% with Texture, Clarity and Dehaze on, darktable order) from `perFrame`/`z100passes`: programs, target sizes and formats, scissors. Then replay the same passes with the same shaders, translated to MSL, in a standalone native Metal harness over the same 2784 × 2368 region, and compare GPU ms per frame with the in-app 48–56 ms.

- **Native ≈ in-app minus the screen pass:** ANGLE costs nothing structural. Native Metal and WebGPU are off the table, and the effort goes to 1 and 2.
- **Native well under (say ≤ 60%):** the "unexplained" time is ANGLE's. The replay has then also produced the first stage of a native engine.

It needs no Tauri integration and no app changes. It reuses the probe's shaders and the existing timing loop, and it answers the one question none of the evidence above settles: where the missing 10–15 ms per frame goes.
