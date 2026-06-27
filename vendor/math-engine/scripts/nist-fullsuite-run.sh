#!/usr/bin/env bash
# NIST SP 800-22 full-battery driver for all 5 RNG backends.
#
# Prereqs:
#   - STS_DIR points at a built NIST sts-2.1.2 tree (./assess binary)
#   - `npm run build` has been run (dist/ populated for --dump)
#   - 12.5 MB × 5 ≈ 63 MB free disk for the binary streams
#
# Output (per backend):
#   reports/rng/<backend>-nist-full.json   (parsed canonical artefact)
#   reports/rng/<backend>-nist-full.txt    (raw NIST finalAnalysisReport)
#
# This script is idempotent: rerunning overwrites all artefacts in place.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STS_DIR="${STS_DIR:-/tmp/nist-sts/sts-2.1.2/sts-2.1.2}"
STREAM_DIR="${STREAM_DIR:-/tmp/nist-streams}"
OUT_DIR="$REPO_ROOT/reports/rng"
BITSTREAM_LEN="${BITSTREAM_LEN:-1000000}"
NUM_BITSTREAMS="${NUM_BITSTREAMS:-100}"
BYTES_PER_BACKEND=$(( BITSTREAM_LEN * NUM_BITSTREAMS / 8 ))

BACKENDS=(mulberry32 pcg64 xoshiro256ss philox4x32 chacha20)

if [[ ! -x "$STS_DIR/assess" ]]; then
  echo "ERROR: NIST assess binary not found at $STS_DIR/assess" >&2
  echo "Build NIST STS first: see reports/rng/HOWTO-fullsuite.md" >&2
  exit 1
fi

mkdir -p "$STREAM_DIR" "$OUT_DIR"

# ─── 1. Generate raw byte streams for all backends ─────────────────────────
echo "▶ Generating ${BYTES_PER_BACKEND} bytes × ${#BACKENDS[@]} backends ..."
for b in "${BACKENDS[@]}"; do
  if [[ ! -s "$STREAM_DIR/$b.bin" || $(wc -c < "$STREAM_DIR/$b.bin") -ne "$BYTES_PER_BACKEND" ]]; then
    echo -n "  $b ... "
    t0=$(date +%s)
    node "$REPO_ROOT/scripts/rng-quality.mjs" --dump "$b" "$BYTES_PER_BACKEND" > "$STREAM_DIR/$b.bin"
    echo "$(( $(date +%s) - t0 ))s"
  else
    echo "  $b ... cached"
  fi
done

# ─── 2. Run assess on each backend ────────────────────────────────────────
for b in "${BACKENDS[@]}"; do
  echo "▶ NIST assess on $b ..."
  # Reset experiment dir between runs — NIST appends, doesn't truncate.
  rm -rf "$STS_DIR/experiments/AlgorithmTesting"/*/ \
         "$STS_DIR/experiments/AlgorithmTesting"/*.txt
  mkdir -p \
    "$STS_DIR/experiments/AlgorithmTesting/ApproximateEntropy" \
    "$STS_DIR/experiments/AlgorithmTesting/BlockFrequency" \
    "$STS_DIR/experiments/AlgorithmTesting/CumulativeSums" \
    "$STS_DIR/experiments/AlgorithmTesting/FFT" \
    "$STS_DIR/experiments/AlgorithmTesting/Frequency" \
    "$STS_DIR/experiments/AlgorithmTesting/LinearComplexity" \
    "$STS_DIR/experiments/AlgorithmTesting/LongestRun" \
    "$STS_DIR/experiments/AlgorithmTesting/NonOverlappingTemplate" \
    "$STS_DIR/experiments/AlgorithmTesting/OverlappingTemplate" \
    "$STS_DIR/experiments/AlgorithmTesting/RandomExcursions" \
    "$STS_DIR/experiments/AlgorithmTesting/RandomExcursionsVariant" \
    "$STS_DIR/experiments/AlgorithmTesting/Rank" \
    "$STS_DIR/experiments/AlgorithmTesting/Runs" \
    "$STS_DIR/experiments/AlgorithmTesting/Serial" \
    "$STS_DIR/experiments/AlgorithmTesting/Universal"

  # Prompt sequence (matches src/assess.c interactive flow):
  #   0                      → generator: input file
  #   <path>                 → file path
  #   1                      → apply all 15 tests
  #   0                      → exit parameter adjustments
  #   <numOfBitStreams>      → bitstream count
  #   1                      → input mode: binary
  t0=$(date +%s)
  (
    cd "$STS_DIR" &&
    printf "0\n%s\n1\n0\n%s\n1\n" "$STREAM_DIR/$b.bin" "$NUM_BITSTREAMS" \
      | ./assess "$BITSTREAM_LEN" > /dev/null
  )
  elapsed=$(( $(date +%s) - t0 ))
  echo "  assess complete (${elapsed}s)"

  # Copy + parse
  cp "$STS_DIR/experiments/AlgorithmTesting/finalAnalysisReport.txt" \
     "$OUT_DIR/$b-nist-full.txt"
  node "$REPO_ROOT/scripts/nist-to-json.mjs" \
       "$OUT_DIR/$b-nist-full.txt" \
       "$b" > "$OUT_DIR/$b-nist-full.json"

  # Quick verdict line
  pass=$(node -e "const r=require('$OUT_DIR/$b-nist-full.json'); process.stdout.write(r.counts.pass+'/'+r.counts.total)")
  echo "  → $b: $pass tests pass"
done

echo "✓ All backends processed. Artefacts in $OUT_DIR"
