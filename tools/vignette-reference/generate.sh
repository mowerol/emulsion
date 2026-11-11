#!/bin/sh
# Builds RawTherapee's post-crop vignette (calcPCVignetteParams and calcPCVignetteFactor, copied
# unmodified from rtengine/iptransform.cc at the pinned commit) with small stand-ins for its helpers,
# and writes the factors src/engine/vignette.test.ts checks against.
# Usage: sh tools/vignette-reference/generate.sh
set -eu
RT=64c2d90a3248c7ad41842d9162368858b61aac6a
DIR="$(mktemp -d)"
OUT="$(cd "$(dirname "$0")/../.." && pwd)/src/engine/fixtures/pcvignette.json"
curl -sf -o "$DIR/iptransform.cc" "https://raw.githubusercontent.com/RawTherapee/RawTherapee/$RT/rtengine/iptransform.cc"
{
cat <<'CPP'
#include <cmath>
#include <cstdio>
#include <algorithm>
#include <utility>
namespace rtengine {
  template<typename T> T norm2(T a, T b) { return std::sqrt(a*a + b*b); }
  constexpr float RT_PI_F_2 = 1.57079632679489661923f;
  template<typename T> T SQR(T x) { return x*x; }
}
using rtengine::SQR;
static inline float pow4(float x) { return x*x*x*x; }
static inline float pow3(float x) { return x*x*x; }
static inline float xcosf(float x) { return std::cos(x); }
static inline float xsinf(float x) { return std::sin(x); }
static inline float normn(float a, float b, int n) { return std::pow(std::pow(a, n) + std::pow(b, n), 1.f / n); }
struct float2 { float x, y; };
struct PCVignetteParams { bool enabled; double strength; int feather; int roundness; };
struct CropParams { bool enabled; int x, y, w, h; };
CPP
sed -n '/^struct pcv_params {/,/^static float calcPCVignetteFactor/p' "$DIR/iptransform.cc" | sed '$d'
sed -n '/^static float calcPCVignetteFactor/,/^}/p' "$DIR/iptransform.cc"
cat <<'CPP'
int main() {
  int sizes[3][2] = {{600, 400}, {400, 600}, {500, 500}};
  double strengths[3] = {0.6, 1.5, 3.0};
  int pts[7][2] = {{0,0},{10,10},{150,100},{300,200},{60,350},{250,30},{499,399}};
  printf("[\n");
  bool first = true;
  for (auto &s : sizes) for (double st : strengths) for (auto &p : pts) {
    PCVignetteParams v{true, st, 50, 50}; CropParams c{false,0,0,0,0};
    pcv_params pcv; calcPCVignetteParams(s[0], s[1], s[0], s[1], v, c, pcv);
    int x = std::min(p[0], s[0]-1), y = std::min(p[1], s[1]-1);
    printf("%s  [%d, %d, %.2f, %d, %d, %.9g]", first ? "" : ",\n", s[0], s[1], st, x, y, calcPCVignetteFactor(pcv, x, y));
    first = false;
  }
  printf("\n]\n");
}
CPP
} > "$DIR/pcv.cc"
c++ -std=c++17 -O1 -o "$DIR/pcv" "$DIR/pcv.cc"
"$DIR/pcv" > "$OUT"
echo "wrote $OUT"
