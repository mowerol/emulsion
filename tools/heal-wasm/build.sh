#!/bin/sh
# Rebuild the checked-in kernel after editing kernel.rs. Requires the Rust wasm target:
# rustup target add wasm32-unknown-unknown
set -eu
TASK_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
rustc "$TASK_DIR/kernel.rs" --crate-type cdylib --target wasm32-unknown-unknown \
  -O -C panic=abort -C strip=symbols -C link-arg=--stack-first -C link-arg=-zstack-size=16384 \
  -o "$TASK_DIR/../../src/engine/heal.wasm"
