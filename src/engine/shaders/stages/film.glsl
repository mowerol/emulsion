// Copyright (C) 2026 darktable developers.
// Film stage: a spektrafilm stock from scene light, in place of the neutral sigmoid (the lookups
// are in stages/filmcore.glsl). Mirrors src/engine/film.ts.
// SPDX-License-Identifier: GPL-3.0-or-later

// The stock's print, blended by Amount with the camera profile's (as a look's Amount does).
vec3 stageFilmPrint(vec3 x) {
  vec3 film = stageFilm(x);
  return uFilmAmount >= 1.0 ? film : mix(stageToneProfile(x), film, uFilmAmount);
}
