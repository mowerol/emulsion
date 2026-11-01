# Camera profiles and optional film LUTs

The base rendering and the creative film look are independent. A new photo uses
Auto as its base and no film LUT. Standard uses the decoder's camera matrix and
the existing neutral sigmoid. Auto uses an installed matching standard/neutral
DCP or the user's chosen camera default, falling back to Standard. The same
profile is used by the photo, developed thumbnails, look previews and export.

## Reference choice

RawTherapee's DCP implementation is the reference because it covers the DCP
pipeline directly: dual illuminants, forward matrices, the calibration HSV map,
baseline exposure, look table and hue-preserving Adobe tone curve. darktable's
input-profile module remains the reference for the general distinction between
camera input calibration and creative rendering; its input ICC workflow does
not provide a DCP processor to port.

Primary sources read:

- [RawTherapee DCP implementation at the pinned commit](https://github.com/RawTherapee/RawTherapee/blob/b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c/rtengine/dcp.cc)
- [RawTherapee curve implementation](https://github.com/RawTherapee/RawTherapee/blob/b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c/rtengine/curves.h)
- [RawTherapee D50 colour matrices](https://github.com/RawTherapee/RawTherapee/blob/b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c/rtengine/iccmatrices.h)
- [RawPedia colour management and DCP options](https://rawpedia.pixls.us/Color_Management)
- [darktable input colour profile](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/input-color-profile/)

## Processing contract

Decode still returns as-shot-white-balanced linear Rec.2020. Its independent
camera metadata block includes make/model, the exact matrix used, reciprocal
camera WB multipliers normalized as AsShotNeutral, and the existing exposure
gain. This is available even when no supported lens metadata exists.

The early DCP pass reconstructs camera RGB, takes out the existing exposure
scale, applies the profile's normalized camera-to-D50-XYZ/ProPhoto conversion and
calibration map, then returns to working Rec.2020 and restores that exposure
scale. It runs after capture sharpening and embedded lens correction and before
all scene analysis maps. Matrix and calibration-map interpolation use the
as-shot neutral. Manual white balance remains the existing CAT16 scene edit.

The late pass applies baseline exposure, look table and Adobe tone curve in
ProPhoto, with RawTherapee's clipping/OOG rules. A DCP tone curve supplies the
base tone rendering; the neutral sigmoid is used only when there is no DCP
curve. Whites/positive Blacks can adjust either base through the existing
neutral inverse/target mapping. An optional film LUT then transforms the base
print in the existing sRGB display slot. Amount zero returns that same base.
Compare retains the camera profile and removes the creative edits/LUT.

`dcp.ts` and the GLSL twin use the same upstream matrices, Robertson temperature
table, reciprocal-temperature mixing, Bradford fallback, natural spline,
65536-sample gamma/tone tables and HSV interpolation. Gamma extrapolation uses
`a + (b-a)*diff`, as upstream; a weighted-sum `mix` loses precision in HDR.

## Profile library and limits

Import DCP validates the binary before installation and checks a declared camera
name against the active RAW camera. Profiles are stored by content hash under
the app data directory's `camera-profiles/`; recipes store `dcp:<hash>` rather
than machine-specific paths. A missing or wrong-camera explicit profile is an
error, including during export. Setting a camera default affects Auto; Standard
always bypasses imported profiles. Already-rendered JPEGs use their existing
camera rendering.

No manufacturer camera-matching pack is bundled. The checked RawTherapee
original-profile collection does not supply an exact profile for Oli's OM-3 or
X-T30 II; sibling models are not silently substituted for imported DCPs. The
existing LibRaw matrix fallback for the OM-3 is unchanged. Import a properly
licensed, camera-specific DCP to evaluate camera-matching renderings.

This does not add ICC camera-profile import, DNG reduction matrices for more
than three colour planes, or per-camera measured exposure defaults. The existing
1.8 source gain remains. A camera DCP can contain creative tone/colour intent;
matching the camera name alone does not make its rendering neutral or identical
to the manufacturer's JPEG engine. Film LUT input assumptions still matter.

## Reproducible checks

- `tools/probe/dcp-reference/run.py` extracts the pinned upstream numeric bodies
  into a temporary native executable and regenerates synthetic expected values
  and a binary DCP fixture. See its README for invocation.
- `dcp.test.ts` checks binary parsing, matrix/forward paths, neutral/temperature,
  2.5D/3D HSV interpolation, gamma seams/HDR, baseline exposure and tone/OOG rules.
- `profilestore.test.ts` checks import binding, Auto/defaults, missing profiles,
  initialization failures and recovery, and browser-only initialization.
- Browser probe `?profiles` checks both DCP GPU stages independently against
  the native-validated TypeScript reference.
- Recipe and decoder tests cover base/LUT separation and camera metadata with
  and without lens data. The full app browser check covers import, camera
  defaults, optional LUT selection and removal.

Private Fuji and Spektrafilm test assets remain development-only and are not
added to release builds by the profile work.
