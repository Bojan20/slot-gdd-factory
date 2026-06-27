#!/usr/bin/env bash
# Rebuild PractRand 0.95 from source on Apple Silicon.
# Idempotent: skips if /tmp/practrand/PractRand/RNG_test already exists.
set -euo pipefail

BUILD_DIR="${PRACTRAND_BUILD_DIR:-/tmp/practrand}"
BINARY="$BUILD_DIR/PractRand/RNG_test"

if [[ -x "$BINARY" ]] && file "$BINARY" | grep -q "Mach-O 64-bit executable arm64"; then
  echo "PractRand already built: $BINARY"
  exit 0
fi

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

if [[ ! -f PractRand-0.95.zip ]]; then
  echo "▶ Downloading PractRand 0.95 ..."
  curl -sL "https://sourceforge.net/projects/pracrand/files/PractRand-pre0.95.zip/download" \
    -o PractRand-0.95.zip
fi

rm -rf PractRand
unzip -q PractRand-0.95.zip -d PractRand
cd PractRand
mkdir -p obj

echo "▶ Compiling src/*.cpp (warnings suppressed for Apple clang) ..."
for src in src/*.cpp src/RNGs/*.cpp src/RNGs/other/*.cpp; do
  [[ -f "$src" ]] || continue
  obj="obj/$(echo "$src" | sed 's|/|_|g').o"
  clang++ -std=c++14 -O3 -Iinclude -Wno-everything -c "$src" -o "$obj"
done

echo "▶ Linking RNG_test ..."
clang++ -std=c++14 -O3 -Iinclude -Wno-everything \
  tools/RNG_test.cpp obj/*.o -o RNG_test -lpthread

file RNG_test
echo "✓ Built: $BINARY"
