// SPDX-License-Identifier: GPL-3.0-or-later
// The few darktable definitions spektra_sim.c and spektra_core.c use, so they compile unmodified
// outside darktable. Single-threaded: the OpenMP pragmas become nothing.
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <glib.h>
#define DT_OMP_FOR(...)
#define DT_OMP_FOR_SIMD(...)
#define DT_OMP_SIMD(...)
#define DT_OMP_PRAGMA(...)
#define DT_DEBUG_PIPE 1
#define DT_DEBUG_DEV 2
#define DT_DEBUG_ALWAYS 4
#define dt_print(kind, ...) fprintf(stderr, __VA_ARGS__)
#define dt_alloc_align_float(n) ((float *)aligned_alloc(64, ((((n) * sizeof(float)) + 63) / 64) * 64))
#define dt_alloc_align(n) aligned_alloc(64, (((n) + 63) / 64) * 64)
#define dt_free_align(p) free(p)
#define dt_calloc_align_float(n) ((float *)calloc((n), sizeof(float)))
