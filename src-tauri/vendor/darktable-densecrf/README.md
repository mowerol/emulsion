# darktable DenseCRF

From darktable at `e58544408dc9396dde06d564aadc64bcccf65327` (GPL-3.0-or-later), unchanged:

- `common/densecrf.cc`, `common/densecrf.h`: binary mean-field DenseCRF (Krähenbühl & Koltun, NIPS 2011), which darktable's AI object masks use to snap a SAM mask to the photo's edges.
- `iop/Permutohedral.h`: the permutohedral lattice (Adams, Baek & Davis), from ImageStack (BSD), as adjusted by darktable.

`common/darktable.h` is Emulsion's: the few darktable macros and helpers the two files use, without OpenMP. `native/densecrf_shim.cpp` builds them.
