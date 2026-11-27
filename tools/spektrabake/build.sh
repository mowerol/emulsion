#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Builds the bake tool: darktable's spektrafilm engine, unmodified, plus main.c.
# Needs json-glib and pkgconf (brew install json-glib pkgconf).
set -eu
cd "$(dirname "$0")"
./fetch.sh >/dev/null
cc -O2 -std=gnu11 -Wall -Wno-unused-function -Ishim -I.cache/darktable $(pkg-config --cflags json-glib-1.0) \
  main.c .cache/darktable/spektra_sim.c .cache/darktable/spektra_core.c shim/gaussian.c \
  $(pkg-config --libs json-glib-1.0) -lm -o .cache/spektrabake
echo .cache/spektrabake
