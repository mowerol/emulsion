#!/usr/bin/env bash
# Builds an ad-hoc-signed Emulsion beta for Apple Silicon and checks it before anyone gets it.
#
#   npm run release                  # clean tree, full checks, build, verify
#   npm run release -- --dirty       # allow uncommitted changes (local trial builds only)
#   npm run release -- --skip-checks # skip `npm run check` (CI runs it as its own step)
#
# Output: release/Emulsion-<version>-arm64.dmg, its .sha256, and INSTALL.txt for testers.
# Ad-hoc signing (tauri.conf.json: signingIdentity "-") needs no Apple account. The hardened
# runtime is off: without a Team ID, its library validation would refuse the ONNX Runtime
# dylib that the app downloads for AI features. Revisit both when moving to a Developer ID.
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT=$PWD
DIRTY=0
CHECKS=1
for arg in "$@"; do
  case "$arg" in
    --dirty) DIRTY=1 ;;
    --skip-checks) CHECKS=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

fail() { echo "release: $*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }

# --- Preconditions ---------------------------------------------------------------------------
[[ "$(uname -s)" == Darwin ]] || fail "builds on macOS only"
[[ "$(uname -m)" == arm64 ]] || fail "builds on Apple Silicon only (ONNX Runtime is arm64-only)"
[[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"
command -v cargo >/dev/null || fail "cargo not found"

if [[ $DIRTY == 0 && -n "$(git status --porcelain)" ]]; then
  git status --short >&2
  fail "uncommitted changes; commit them or pass --dirty for a trial build"
fi

VERSION=$(node -p "require('./package.json').version")
CONF_VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
CARGO_VERSION=$(sed -n 's/^version = "\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)
[[ "$VERSION" == "$CONF_VERSION" && "$VERSION" == "$CARGO_VERSION" ]] ||
  fail "versions differ: package.json $VERSION, tauri.conf.json $CONF_VERSION, Cargo.toml $CARGO_VERSION"

# Without libomp LibRaw silently builds single-threaded; a release must not.
LIBOMP=${LIBOMP_PREFIX:-/opt/homebrew/opt/libomp}
[[ -f "$LIBOMP/lib/libomp.a" && -f "$LIBOMP/include/omp.h" ]] ||
  fail "libomp missing at $LIBOMP (brew install libomp) — RAW decoding would be single-threaded"

# --- Checks and build ------------------------------------------------------------------------
if [[ $CHECKS == 1 ]]; then
  step "npm run check"
  npm run check
fi

step "Building Emulsion $VERSION (aarch64, ad-hoc signed)"
npx tauri build --target aarch64-apple-darwin --bundles app,dmg

BUNDLE="src-tauri/target/aarch64-apple-darwin/release/bundle"
APP="$BUNDLE/macos/Emulsion.app"
DMG_BUILT="$BUNDLE/dmg/Emulsion_${VERSION}_aarch64.dmg"
[[ -d "$APP" ]] || fail "no app at $APP"
[[ -f "$DMG_BUILT" ]] || fail "no dmg at $DMG_BUILT"

# --- Verify ----------------------------------------------------------------------------------
step "Verifying"
codesign --verify --deep --strict "$APP" || fail "signature does not verify"
SIG=$(codesign -dv "$APP" 2>&1)
grep -q 'Signature=adhoc' <<<"$SIG" || fail "app is not ad-hoc signed: $SIG"
echo "signature: ad-hoc, verifies"

BIN="$APP/Contents/MacOS/emulsion"
[[ -x "$BIN" ]] || fail "no executable at $BIN"
lipo -archs "$BIN" | grep -qx arm64 || fail "executable is not arm64-only: $(lipo -archs "$BIN")"
# Every linked library must ship with macOS; a Homebrew path would crash on testers' Macs.
FOREIGN=$(otool -L "$BIN" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/usr/lib/|/System/Library/)' || true)
[[ -z "$FOREIGN" ]] || fail "links libraries testers won't have: $FOREIGN"
# The binary is stripped, so look for libomp's own environment variable name instead of symbols.
grep -qa 'OMP_NUM_THREADS' "$BIN" || fail "LibRaw built without OpenMP"
echo "libraries: system only; OpenMP static"

# Only licensed LUT packs ship. The dev-only local-looks packs keep their labels in the code
# (registered only under import.meta.env.DEV), but none of their files or file names may ship.
[[ ! -e dist/local-looks ]] || fail "dist contains local-looks"
if [[ -d local-looks ]]; then
  while IFS= read -r f; do
    name=$(basename "$f")
    if find dist -name "$name" | grep -q .; then fail "local LUT file shipped: $name"; fi
    if grep -rqF "$name" dist/assets; then fail "bundle names local LUT file: $name"; fi
  done < <(find local-looks -type f \( -name '*.cube' -o -name '*.png' \))
fi
for pack in dist/looks/*/; do
  ls "$pack" | grep -qiE '^(LICENSE|README)' || fail "LUT pack without a licence file: $pack"
done
echo "LUTs: $(ls dist/looks | tr '\n' ' ')— each with its licence"

# --- Package ---------------------------------------------------------------------------------
step "Packaging"
mkdir -p release
NAME="Emulsion-$VERSION-arm64"
cp "$DMG_BUILT" "release/$NAME.dmg"
(cd release && shasum -a 256 "$NAME.dmg" > "$NAME.dmg.sha256")
COMMIT=$(git rev-parse --short HEAD)
[[ $DIRTY == 1 && -n "$(git status --porcelain)" ]] && COMMIT="$COMMIT+dirty"
sed -e "s/{{VERSION}}/$VERSION/g" -e "s/{{COMMIT}}/$COMMIT/g" tools/release/INSTALL.txt > release/INSTALL.txt

echo
echo "Built $NAME from $COMMIT"
ls -lh "release/$NAME.dmg" | awk '{print "  " $5 "  " $9}'
cat "release/$NAME.dmg.sha256" | sed 's/^/  /'
