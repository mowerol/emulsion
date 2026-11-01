RawTherapee perspective correction from
https://github.com/RawTherapee/RawTherapee at
b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c, rtengine/.

Original authors and licence notices are preserved in every source:
- ashift_dt.c: GPL-3.0-or-later, Alberto Griggio and Ulrich Pegelow.
- homogeneouscoordinates.{h,cc}: GPL-3.0-or-later, Lawrence Lee.
- ashift_lsd.c: AGPL-3.0-or-later, Rafael Grompone von Gioi, with
  darktable's GPL wrapper. The AGPL text is in COPYING.AGPL-3.0.
- ashift_nmsimplex.c: darktable GPL wrapper, including Michael F. Hutt's
  implementation and its original permission notice.
See ../../../NOTICE.md for attribution; Emulsion's GPL text is ../../../LICENSE.

Local changes do not alter the detector or fitter maths:
- ashift_dt.c: calloc the two Sobel scratch buffers so border taps never
  read uninitialized memory.
- ashift_lsd.c: a zero-initialized static inverse cache replaces an uninitialized
  malloc and GNU constructor/destructor attributes. Zero is the cache-empty
  sentinel. This also compiles on toolchains without GNU attributes.

../../native/perspective.cpp adapts the upstream autocompute setup to bounded,
neutral, already oriented and lens-corrected RGBA8 previews. It provides standard
C++ mutexes instead of GTK types. Fits are serialized and seeded as upstream.
The desktop binary includes AGPL-covered LSD code; its source and licence must
accompany source distributions and the corresponding-source offer for binaries.
