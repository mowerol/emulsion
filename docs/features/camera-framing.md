# Camera framing

Fuji RAFs open at the camera's as-shot composition: the camera output area, its
digital tele-converter rectangle when active, then the selected aspect centred
inside that rectangle. The decoder retains every visible sensor pixel.

In the crop tool's aspect menu, **As shot** restores this composition and **Full
sensor** reveals the whole decoded image. Reset crop also returns to As shot.
**Shift+F** chooses Full sensor while cropping. The Metadata panel shows the
recorded aspect and recognised 45 / 63 / 80 mm digital tele setting.

A missing recipe crop (`null`) follows the camera frame. An explicit crop always
wins, including the full rectangle. Explicit full rectangles survive catalog and
sidecar normalization. Existing explicit crops retain their full-decode coordinates.
Masks, lens correction, perspective and retouch still work over the full decode;
full-photo analysis explicitly requests the full rectangle.

`src-tauri/src/raf.rs` reads the bounded RAF directory at header offset `0x5c`.
The crop and zoom pairs store top/height before left/width. Zoom origins are
relative to the camera output area, while the output area's origin is in sensor
coordinates. The GFX100RF's nine aspect sizes use the official L dimensions when
the output area is 11648 × 8736. Smaller areas and tele combinations use centred,
even-rounded ratio crops. Unknown aspects retain the base/tele rectangle. Invalid
metadata falls back to the whole decoded frame.

Recorded zoom geometry is authoritative. A missing zoom rectangle can use a
recorded EXIF DigitalZoomRatio matching a nominal tele setting; physical focal
length is never used to guess the tele setting. Without a reliable ratio, the
metadata is ignored. Fuji CropMode 2/4 continues to scale lens profiles by 1.25;
digital tele (8) keeps the profile scale at 1.

Two coordinate spaces are deliberate:

- Scan/catalog `cameraFrame` describes the composition relative to the camera
  output area, in display orientation. Unedited thumbnails apply this to the
  embedded camera JPEG; ordinary 4:3 shots retain the original-thumbnail fast path.
  The culling preview applies the same rectangle, skipping an already aspect-cropped
  preview. A same-aspect tele preview cannot be distinguished from a native preview
  by dimensions alone; the native-preview convention is used.
- Decoded `frame` subtracts LibRaw's visible-area margins, then applies its orientation.
  It travels in payload flag 16, after the lens/camera JSON blocks and before pixel
  data (including both planes for AI noise reduction). Develop, histogram, edited
  thumbnails, look previews and exports resolve explicit crop → decoded frame → FULL.

Synthetic fixtures reproduce the two issue samples: decoded 11648 × 4304 at
(8, 2221), and decoded 6448 × 4836 at (2608, 1955), over a 11662 × 8746 source.
`npm run check` covers metadata bounds, all nine aspects, tele settings, orientation,
normalization, crop lifecycle, thumbnails and export sizing. The GPU/UI regression is:

```sh
node tools/browser-tests/realtime.mjs camera-frame 30
```

The exact issue RAF files were not available during implementation. Tele plus
non-native-aspect captures and bodies that embed already-tele-cropped JPEGs still
need real-file confirmation. Nominal fallback sizes are approximate; RAF zoom
rectangles always take precedence.
