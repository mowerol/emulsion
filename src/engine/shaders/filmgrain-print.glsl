// SPDX-License-Identifier: GPL-3.0-or-later
// Film grain's negative and print (src/engine/filmgrain.ts coverageFor, shownFor): a shown value
// is the print of a negative whose grains cover c of it, or for a slide (uKind 1) the film itself
// with dark grains. The paper is logistic in density: slope 1.8, maximum density 2.0, its middle
// at negative density 0.95.
uniform int uKind;
const float U_TOP = 255.0 / 255.1;
const float PRINT_DMAX = 2.0;
const float PRINT_MID = 0.95;
const float PRINT_K = 4.0 * 1.8 / 2.0;
const float PRINT_RMIN = 0.01;
float srgbDecode(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
float srgbEncode(float v) { return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055; }
float coverageFor(float v) {
  float lin = srgbDecode(clamp(v, 0.0, 1.0));
  if (uKind == 1) return min(U_TOP, 1.0 - lin);
  float dp = -log(PRINT_RMIN + lin * (1.0 - PRINT_RMIN)) / log(10.0);
  if (dp >= PRINT_DMAX) return 0.0;
  float dn = PRINT_MID + log(PRINT_DMAX / dp - 1.0) / PRINT_K;
  return dn <= 0.0 ? 0.0 : min(U_TOP, 1.0 - pow(10.0, -dn));
}
float shownFor(float c) {
  if (uKind == 1) return srgbEncode(clamp(1.0 - c, 0.0, 1.0));
  float dn = -log(max(1e-7, 1.0 - c)) / log(10.0);
  float dp = PRINT_DMAX / (1.0 + exp(-PRINT_K * (PRINT_MID - dn)));
  return srgbEncode(clamp((pow(10.0, -dp) - PRINT_RMIN) / (1.0 - PRINT_RMIN), 0.0, 1.0));
}
