# Lens correction: embedded metadata reference

Researched 2026-10-31 against darktable **20891f6c6fa7be995e5bf9dff9d1ee5062051773**, verified with the local checkout's `git rev-parse HEAD`. This note describes the pinned implementation, including its limitations; it is not a claim that every RAW records usable correction data.

## Source map

- [`lens.cc`, embedded metadata processing](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/lens.cc#L1998): interpolation, `_init_coeffs_md_v2` at line 2183, geometry and vignette processing at line 2728.
- [`exif.cc`, correction metadata extraction](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/common/exif.cc#L934): opcode list discovery, Sony, Fuji and Olympus validation.
- [`dng_opcode.c`, opcode payload decoding](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/common/dng_opcode.c#L115).
- [`image.h`, correction data layouts](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/common/image.h#L153).
- [`iop_order.c`, scene-referred pipeline ordering](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/common/iop_order.c#L179): lens after demosaic, before flip and crop.

## Common v2 processing

All spline arrays have a maximum of **16 knots**. Linear interpolation clamps to the first/last value outside its knot domain. Match v2; v1 has a different scaling convention and exists for old darktable edits. [Source](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/lens.cc#L2004).

For an output pixel `p`, image centre `c=(width/2,height/2)`, half-diagonal `R=length(c)` and user zoom `z=scale_md`:

```
q = (p - c) / z
r = length(q) / R
source_channel = c + q * interpolate(distKnots, channelFactors[channel], r)
```

The three colour channels can have different source coordinates for transverse CA. Image coordinates stay in the full uncropped source frame. Clamp source coordinates to `[0,width-1] × [0,height-1]` when sampling. darktable uses its user-selected warp interpolation kernel, rather than hardcoding bilinear. [Source](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/lens.cc#L2728).

Vignetting corrects the **input image before geometric resampling**. At source position `s`, its radius is `length(s-c)/R` and its RGB is divided by `max(1e-4, interpolate(vigKnots,vigFactors,r))`. A shader that folds this into sampling needs the vignette factor at each channel's **source coordinate**, not at the destination/green coordinate. Applying a gain before bilinear interpolation exactly requires correcting each contributing source texel; multiplying the interpolated sample by the gain evaluated at its fractional coordinate is an approximation. [Source](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/lens.cc#L2756).

The v2 automatic fit is already baked into the distortion spline:

1. Let `rShort=min(width,height)/hypot(width,height)`.
2. Evaluate every channel factor at 200 evenly spaced radii from `rShort` to `1` inclusive.
3. `auto=max(all factors sampled)`.
4. Multiply each distortion knot by `auto`; divide each channel factor by `auto`.

Do **not** divide source coordinates by this auto factor a second time. `scale_md` is a separate user zoom and defaults to one. Vignette knots/factors are not rescaled with the distortion spline. [Source](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/lens.cc#L2421).

## Maker-specific spline construction

Below, `D`, `V`, `CR`, `CB` are fine-tune strengths; one means the embedded correction, zero means no correction. Disabled components must produce identity factors, while auto-fit still accounts for any enabled geometry.

### Sony

The distortion, CA and vignette arrays carry a leading count. Their counts must agree as `nc`, `2*nc`, `nc`, respectively; darktable allows at most 16. An Emulsion reader should additionally require `nc>=2` to avoid the construction's denominator `nc-1` becoming zero. Sony's tags are distortion `0x7037`, CA `0x7035`, vignette `0x7032`; normally in a raw SubIFD. darktable also checks IFD0 copies of these numeric tags for round-tripped DNGs. [Extraction and counts](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/common/exif.cc#L985), [numeric IDs](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/common/exif.cc#L2775).

For sample `i`:

```
knot = (i + 0.5)/(nc-1)
m = 1 + D * distortion[i] * 2^-14
red   = m * (1 + CR * caRed[i]  * 2^-21)
green = m
blue  = m * (1 + CB * caBlue[i] * 2^-21)
vig = 2^(0.5 - 2^(V * vignette[i] * 2^-13 - 1))
```

Turn each disabled component into its identity before combining. [Construction](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/lens.cc#L2194).

### Fujifilm

For newer layouts, distortion/CA/vignette lengths are `19/29/19`: nine shared knots at indices `1..9`, distortion/vignette values at `10..18`, CA red at `10..18`, blue at `19..27`. For older layouts lengths are `23/31/23`: eleven shared knots at `1..11`, distortion/vignette values at `12..22`; CA omits its first knot and correction, so set its first correction to zero and read red `i+10` / blue `i+20` for `i=1..10`. Validate agreement of all stored knot positions. `CropMode` 2 or 4 multiplies radii by 1.25; all other modes use one. [Extraction](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/common/exif.cc#L1013).

The metadata describes **source radius**, which must be converted to destination-radius geometry. Build an input spline at `cropFactor*metadataKnot`, with `m=1+D*distortion/100`, CA values `CR*caRed` / `CB*caBlue`, vignette `1-V*(1-vignette/100)`. Add the centre knot `(r=0,m=1,CA=0,vig=1)` if absent. Then sample source radii `rin=i/15` for `i=0..15`:

```
m = interpolate(inputKnots, m, rin)
distKnot[i] = rin/m
factorGreen[i] = distortionEnabled ? m : 1
factorRed[i]  = factorGreen[i] * (1 + interpolate(inputKnots, caRed, rin))
factorBlue[i] = factorGreen[i] * (1 + interpolate(inputKnots, caBlue, rin))
```

Only multiply in CA when enabled. A subtle source-port detail: the destination knots are derived using the distortion spline even when the distortion switch is off; only the final factors honour that switch. Vignetting retains the original source-space knot positions. Keep its own valid knot count rather than relying on zero-filled trailing entries. [Construction](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/lens.cc#L2231).

### Olympus / OM System

Distortion metadata consists of four floats `(k2,k4,k6,s)` and is meaningful only when one of the first three is nonzero; `(0,0,0,1)` means no correction. CA has six floats `(r0,r2,r4,b0,b2,b4)` and is meaningful if any is nonzero. Either may exist without the other. No Olympus vignetting correction is constructed by this module. [Validation](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/common/exif.cc#L1099).

At the 16 evenly spaced radii `r=i/15`:

```
t = (r*s)^2
m = 1 + D * (s*(1+t*(k2+t*(k4+t*k6))) - 1)
rd = m*r
factorGreen = m
factorRed  = m + CR * rd*(r0+rd^2*(r2+rd^2*r4))/r
factorBlue = m + CB * rd*(b0+rd^2*(b2+rd^2*b4))/r
```

Set `m=1` when distortion is disabled/absent. Apply CA only when enabled and `r>0`; the centre knot remains `m` rather than dividing by zero. [Construction](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/lens.cc#L2368).

### DNG: exact port and limitations

Darktable looks for OpcodeList2/3 in the raw SubIFD, falling back to IFD0. Its lens reader uses **OpcodeList3**, with opcode 1 (WarpRectilinear) and opcode 3 (FixVignetteRadial). List2 is handled separately for GainMap (opcode 9). Opcode list count, headers and doubles are **big endian**, irrespective of TIFF endianness. Each opcode has four u32 header fields (ID, version, flags, payload length), followed by its payload. Validate all sizes, counts and finite coefficients before reading; do not reproduce upstream's unchecked short-payload accesses. [List discovery](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/common/exif.cc#L934), [payload parser](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/common/dng_opcode.c#L115).

WarpRectilinear payload: u32 planes (one or three), six doubles per plane, then two centre doubles. FixVignetteRadial payload: five polynomial doubles, then two centre doubles. The lens module samples 16 radii:

```
factor[c] = 1 + D*(k0[c]+k1[c]*r²+k2[c]*r⁴+k3[c]*r⁶ - 1)
vig = 1/(1+V*(v0*r²+v1*r⁴+v2*r⁶+v3*r⁸+v4*r¹⁰))
```

One warp plane is copied to all three colour channels. Thus the final vignette gain after dividing by `vig` is `1+polynomial`, not its reciprocal. darktable considers DNG geometry enabled when either distortion **or** CA is selected, since the opcode combines both. Its GUI hides independent CA fine tuning for DNG. [Construction](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/lens.cc#L2308), [GUI handling](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/lens.cc#L4280).

**Important limitation:** the parser stores all six warp coefficients and optical centres, but `_init_coeffs_md_v2` uses only the first four (radial) coefficients and assumes the image centre. It ignores the two tangential coefficients and both stored centres. Exact darktable parity therefore does not imply full DNG opcode correctness. For Emulsion's first port, explicitly flag/reject nonzero tangential coefficients or noncentral optical centres rather than applying an unacknowledged approximation. Full DNG handling requires a separate implementation from Adobe's specification/SDK. [Parser versus processor](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/common/dng_opcode.c#L131), [Adobe's specification and SDK entry point](https://www.adobe.com/support/downloads/dng/dng_sdk.html).

## Coordinates, orientation and integration risks

Darktable's lens processing happens before its flip and crop stages, using the rawprepared visible image dimensions rather than the entire sensor with masked borders. Emulsion already orients LibRaw output. For **centred radial** corrections, flipping or rotating 90° commutes with this mapping if radii use the oriented image width/height (not cropped/export dimensions). This is an inference from the equations above; test it explicitly on portrait and landscape files. Off-centre DNG centres would need orientation transformation, another reason not to silently approximate them. [Pipeline order](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/common/iop_order.c#L179).

Correct the full source before user cropping/straightening, with channel coordinates used consistently by the preview, export, thumbnail and analysis maps. Applying source geometry only in the final develop shader while keeping texture/clarity/equalizer analysis maps on unwarped coordinates risks misregistration. A dedicated corrected-source pass makes the downstream geometry consistent; if folding into every sampler instead, every analysis path must use the same mapping. This is an Emulsion integration inference, not a darktable design requirement.

Metadata extraction also needs file bounds, a finite recursion/IFD budget, visited-offset detection, type/count validation, and independent availability for distortion/CA/vignette. No camera name allowlist is needed for a correctly parsed format; absence or invalidity should expose an unavailable correction, not pretend it was applied.

## Public sample validation set

Three CC0 files were downloaded from the raw.pixls.us repository into `/private/tmp/emulsion-lens-samples/`; every download's SHA256 matched the repository's published checksum. They are not checked into the repository. An independent small TIFF walker (`correction_tags.py` beside the files) confirmed these correction tags directly in the downloaded bytes, independently of Emulsion's reader:

| Local file | Repository record | Bytes | SHA256 |
| --- | --- | ---: | --- |
| `sony-ilce7m5.ARW` | [Sony ILCE-7M5, #8849](https://raw.pixls.us/getfile.php/8849/nice/Sony%20-%20ILCE-7M5%20-%2014bit%20%283:2%29.ARW) | 11481088 | `c16cae99d26a2f8ad183d31a23823310a994aa058d55cfe56e4f82ba56865f57` |
| `iphone6splus.DNG` | [Apple iPhone 6s Plus, #915](https://raw.pixls.us/getfile.php/915/nice/Apple%20-%20iPhone%206s%20Plus%20-%2016bit%20%284:3%29.DNG) | 10227467 | `845fee4f09c832af3728778737f5ae9b99124debb821b6e2066b94aed1daa91c` |
| `dji-fc4382.DNG` | [DJI FC4382, #7823](https://raw.pixls.us/getfile.php/7823/nice/DJI%20-%20FC4382%20-%2016bit%20%284:3%29.DNG) | 14884352 | `f33ddaf2a7fa70b395abced251faccea11100d2ab7e54ae0a6adbff043d72027` |

Sony: tags `0x7032`, `0x7035`, `0x7037` are TIFF type **8 (SSHORT)**, with fixed TIFF counts 17/33/17 but leading active counts 11/22/11. Thus validate that sufficient values exist, rather than requiring exact equality between the TIFF array length and the active count. First 11 distortion values: `[-4,-4,-22,-49,-92,-146,-214,-286,-365,-438,-509]`. First 11 vignette values: `[0,64,160,288,448,672,1024,1472,2112,3008,4160]`. The CA red values are six 640s then five 512s; all 11 blue values are -128. [Published correction tags](https://raw.pixls.us/getfile.php/8849/exif/apcs_compressed_hq.ARW.exif.txt).

DNG OpcodeList3 is TIFF tag **51022 (`0xc74e`)**, not the sequential tag after List2 (`51009`). The Apple file has a 76-byte list with one opcode 3, version `0x01030000`, flags zero and payload length 56: vignette coefficients `[1.0049162201,2.0881077679,-4.5230163231,5.6218401971,-2.117678018]`, centre `[0.5,0.5]`. [Published tags](https://raw.pixls.us/getfile.php/915/exif/IMG_0853.DNG.exif.txt).

The DJI file has a 184-byte list with one opcode 1, version `0x01030000`, flags zero and payload length 164. It has three identical warp planes, each `[0.9999207724,-0.00496478829,-0.001534948319,0.001191310131,0,0]`, centre `[0.5,0.5]`. Both DNG files therefore fit the exact radial/centred subset of the pinned darktable port. [Published tags](https://raw.pixls.us/getfile.php/7823/exif/DJI_20250506184749_0011_D.DNG.exif.txt).

Pixel-centre detail for parity tests: darktable's loop uses integer `(x,y)` indices with centre `(width/2,height/2)`, while WebGL pixel-centre UV is `((x+0.5)/width,(y+0.5)/height)`. Literal parity therefore converts `uv*size-0.5` to pixel indices before subtracting the centre, and `(sourceIndex+0.5)/size` back to UV for sampling. Simply using `uv-0.5` differs by half a pixel. Include portrait/flip cases in the reference tests rather than assuming continuous-coordinate commutation handles the integer convention automatically. [Pixel loop](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/lens.cc#L2788).


For end-to-end decode, prefer `/private/tmp/emulsion-lens-samples/sony-fx3.ARW`: [Sony ILME-FX3 #6874](https://raw.pixls.us/getfile.php/6874/nice/Sony%20-%20ILME-FX3%20-%2014bit%20%283:2%29.ARW), 14589952 bytes, SHA256 `394ceb1a356be8b17f18dc013bfd22895ba6ec7195f578b9be1c2fd0d5ea4773`, verified against the CC0 repository entry. The newer ILCE-7M5 sample remains useful for parser tests but is rejected by vendored LibRaw 0.22.3. The FX3 has a colour-matrix entry in the vendored `colordata.cpp`. Its active table counts are 16/32/16, and the distortion begins `[5,-1,-15,-34,-60,-92,-129,-171,-217,-263,-314,-362,-411,-456,-498,-529]`; all three tags were independently read from the downloaded TIFF bytes. [Published metadata](https://raw.pixls.us/getfile.php/6874/exif/DSC00001.ARW.exif.txt).


## Emulsion implementation (2026-10-31)

The first layer is implemented for embedded Fuji RAF (both table generations), Olympus/OM ORF, Sony ARW and centred radial DNG opcodes. Lensfun, manual profile assignment and Adobe LCP remain the next layers; no universal camera/lens coverage is claimed yet.

- Reader: bounded random-access TIFF/IFD/maker-note reads, with visited offsets and directory/count/size limits. RAF EXIF identity/crop mode comes from its embedded JPEG, coefficients from its raw TIFF. Olympus maker notes can be megabytes: only their header and referenced correction entries are read. Identity Olympus profiles are retained as known/no correction needed, rather than falsely reported missing.
- Processing: source-space vignette gain before bilinear resampling, red/green/blue source coordinates, 16-knot v2 splines and upstream autoscale. Camera RGB is reconstructed using the decoder's camera matrix before CA, then converted back to working Rec.2020. Signed working values survive RAW decoding/packing until after correction; this avoids losing the information needed for that reconstruction. The already-oriented pixel centre uses the source's EXIF orientation and full-resolution dimensions.
- UI: Lens section for RAWs, detected camera/lens, embedded profile status, enable switch, available correction switches and 0–200% fine tuning. DNG's warp combines geometry/colour alignment; it uses a combined switch and strength rather than inventing independent DNG CA coefficients. Per-photo recipe `lens`, default null, participates in sidecars, undo, copy/paste and reset.
- The pass uses one cached half-float source target with mipmaps. Lens changes invalidate downstream detail/equalizer maps. Develop, export and WB sampling use corrected coordinates. Edited RAW thumbnails/stock tiles use a cached small RAW decode rather than an already-corrected camera JPEG. Unedited library thumbnails still use that camera preview for speed.
- Validation: TypeScript/production/probe builds, 229 TypeScript tests and 36 Rust tests (4 optional tests ignored); malformed/truncated/cyclic directories, large ORF maker notes, padded signed Sony arrays, both Fuji generations and DNG unsupported models; recipe/payload round-trips. `tools/probe/lens-reference.py <pinned-darktable-checkout>` regenerates 23 C-reference cases from `lens-metadata.json`. The two independent DNG flag combinations unsupported by its combined UI are excluded; a separate test verifies its combined switch turns the warp off.
- Focused `?lensprobe`: CPU/GLSL agreement on five real metadata profiles, normal/portrait centres, switches and nonidentity camera colour matrices; worst absolute error 4.24e-6 on Chrome Metal, GL error 0. Repeated correction changes with detail maps enabled return to identical pixels (no stale-cache reuse).
- Real RAW decode/payload checks: Fuji X-T30 II, OM-3 with OM 12–45mm, Sony ILME-FX3, iPhone DNG and DJI DNG. ILCE-7M5 is metadata-only in the tests because the bundled LibRaw cannot decode that body yet; this is a decoder limitation, not a lens-table parsing failure.
- A before/after board and real Lens panel were rendered from Oli's Fuji RAW locally. The user's photographs and decoded binary are not checked into the repo.

Next: lensfun database matching and models for lenses without supported embedded data, then remembered per-camera/lens assignment and user-loaded LCP files. Return to LUT import/pack selection afterwards.
