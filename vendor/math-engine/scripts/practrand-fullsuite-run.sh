#!/usr/bin/env bash
# PractRand 2^N-byte audit driver for all 5 RNG backends.
#
# Usage:
#   PRACTRAND_DIR=/tmp/practrand/PractRand BYTES_PER=4294967296 \
#     bash scripts/practrand-fullsuite-run.sh
#
# Defaults (W219-bp safety):
#   BYTES_PER = 4 GiB (2^32)  — small, quick sanity audit
#   PARALLEL  = 0             — sequential (one backend at a time)
#
# Override for full submission:
#   PARALLEL=1 BYTES_PER=68719476736 bash scripts/practrand-fullsuite-run.sh
#   (64 GiB × 5 in parallel — REQUIRES ≥ 100 GiB free disk + 32 GiB RAM)
#
# Output (per backend, in reports/rng/):
#   <backend>-practrand-<bytes>.txt       raw RNG_test transcript
#   <backend>-practrand-<bytes>.verdict   "PASS_CLEAN" / "PASS_WITH_..." / "FAIL_..."
#
# WHY SEQUENTIAL BY DEFAULT — W219-bp postmortem
# ------------------------------------------------
# The earlier default (5 backends paralleled with `&` + `wait`) caused Boki's
# Mac to freeze with a "no space left on device" dialog after starting "option
# 1" of the bulk RNG audit menu. Root cause:
#
#   1. `rng-quality.mjs --dump` produced bytes at ~150 MB/s.
#   2. `RNG_test stdin` consumed at ~20-50 MB/s.
#   3. The Node script DID NOT honour `stdout.write()`'s back-pressure return
#      value — it just allocated a fresh 1 MiB Buffer per chunk regardless of
#      whether the previous one had been flushed to the pipe.
#   4. Over a 64 GiB dump, V8 heap exploded to ~8 GB+ per process.
#   5. With 5 processes paralleled, that's 40 GB of resident RAM on a 36 GB
#      Mac → macOS started swapping to SSD.
#   6. Swap file grew tens of GB before the audit ever finished.
#   7. SSD filled, kernel could no longer allocate, UI froze.
#
# Both layers are now fixed:
#   * `rng-quality.mjs::dumpStream` is async + awaits `drain` (heap stays
#     flat at 1 MiB regardless of dump size).
#   * This wrapper defaults to sequential + 4 GiB; explicit opt-in for the
#     full 64 GiB × 5 parallel audit.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRACTRAND_DIR="${PRACTRAND_DIR:-/tmp/practrand/PractRand}"
BYTES_PER="${BYTES_PER:-4294967296}"   # 2^32 = 4 GiB (W219-bp default)
PARALLEL="${PARALLEL:-0}"              # sequential by default
OUT_DIR="$REPO_ROOT/reports/rng"

# ─── Pre-flight ────────────────────────────────────────────────────────────

if [[ ! -x "$PRACTRAND_DIR/RNG_test" ]]; then
  echo "ERROR: RNG_test binary not found at $PRACTRAND_DIR/RNG_test" >&2
  echo "Build PractRand first: see reports/rng/HOWTO-fullsuite.md" >&2
  exit 1
fi

# Disk-space guard — refuse if free < 2× projected pipe + transcript footprint.
# Even with the back-pressure fix, macOS unified page cache + Node's V8 reserves
# claim ~512 MiB per process at peak.  Sequential adds those serially; parallel
# multiplies by backend count.
BACKENDS=(mulberry32 pcg64 xoshiro256ss philox4x32 chacha20)
N_BACKENDS=${#BACKENDS[@]}
PEAK_RAM_MIB_PER_PROC=512
if [[ "$PARALLEL" == "1" ]]; then
  PEAK_RAM_MIB=$(( PEAK_RAM_MIB_PER_PROC * N_BACKENDS ))
else
  PEAK_RAM_MIB="$PEAK_RAM_MIB_PER_PROC"
fi
# macOS df -m reports in MiB
FREE_MIB=$(df -m "$REPO_ROOT" | awk 'NR==2 {print $4}')
REQUIRED_MIB=$(( PEAK_RAM_MIB * 4 ))  # 4× safety margin for swap + transcripts
if [[ "$FREE_MIB" -lt "$REQUIRED_MIB" ]]; then
  echo "ERROR: insufficient free disk for safety margin." >&2
  echo "  Free:     ${FREE_MIB} MiB" >&2
  echo "  Required: ${REQUIRED_MIB} MiB (peak RAM × 4 swap headroom)" >&2
  echo "  Lower BYTES_PER, run sequential (PARALLEL=0), or free disk." >&2
  exit 1
fi

# PractRand accepts metric postfixes KB/MB/GB/TB (binary KB = 1024 bytes per
# de facto convention — see RNG_test --help). It does NOT accept 'GiB'.
BYTES_LABEL=$(node -e "
const n = ${BYTES_PER};
if (n >= 1 << 30) console.log((n / (1 << 30)).toFixed(0) + 'GB');
else if (n >= 1 << 20) console.log((n / (1 << 20)).toFixed(0) + 'MB');
else console.log(n + 'B');
")

mkdir -p "$OUT_DIR"

# ─── Per-backend runner ────────────────────────────────────────────────────

run_one() {
  local b="$1"
  local out="$OUT_DIR/${b}-practrand-${BYTES_LABEL}.txt"
  local verdict_path="$OUT_DIR/${b}-practrand-${BYTES_LABEL}.verdict"
  local t0=$(date +%s)

  # Hard memory cap on the Node producer — even with drain-aware writes we
  # cap V8 old-space to 512 MiB so a future regression cannot eat the host.
  NODE_OPTIONS="--max-old-space-size=512" \
    node "$REPO_ROOT/scripts/rng-quality.mjs" --dump "$b" "$BYTES_PER" 2>/dev/null \
    | "$PRACTRAND_DIR/RNG_test" stdin -tlmax "${BYTES_LABEL}" -tlfail \
    > "$out" 2>&1

  local elapsed=$(( $(date +%s) - t0 ))
  local fails=$(grep -c "FAIL" "$out" || true)
  local unusual=$(grep -c "unusual" "$out" || true)
  if [[ "$fails" -eq 0 && "$unusual" -eq 0 ]]; then
    echo "PASS_CLEAN ${elapsed}s" > "$verdict_path"
  elif [[ "$fails" -eq 0 ]]; then
    echo "PASS_WITH_${unusual}_UNUSUAL ${elapsed}s" > "$verdict_path"
  else
    echo "FAIL_${fails}_FAIL_${unusual}_UNUSUAL ${elapsed}s" > "$verdict_path"
  fi
  echo "  $b done in ${elapsed}s — $(cat "$verdict_path")"
}

export -f run_one
export REPO_ROOT PRACTRAND_DIR BYTES_PER OUT_DIR BYTES_LABEL

# ─── Driver ────────────────────────────────────────────────────────────────

if [[ "$PARALLEL" == "1" ]]; then
  echo "▶ PractRand ${BYTES_LABEL} × ${N_BACKENDS} backends in PARALLEL (opt-in) ..."
  for b in "${BACKENDS[@]}"; do
    ( run_one "$b" ) &
  done
  wait
else
  echo "▶ PractRand ${BYTES_LABEL} × ${N_BACKENDS} backends SEQUENTIAL (W219-bp safe default)"
  echo "  Set PARALLEL=1 for parallel mode (requires ≥ ${REQUIRED_MIB} MiB free)"
  for b in "${BACKENDS[@]}"; do
    run_one "$b"
  done
fi

echo "✓ All PractRand runs complete. Artefacts in $OUT_DIR"
for b in "${BACKENDS[@]}"; do
  echo "  $b: $(cat "$OUT_DIR/${b}-practrand-${BYTES_LABEL}.verdict" 2>/dev/null)"
done
