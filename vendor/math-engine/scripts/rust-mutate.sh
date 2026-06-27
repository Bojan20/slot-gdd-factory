#!/usr/bin/env bash
#
# P0 #8 — Rust mutation testing wrapper.
#
# Runs `cargo-mutants` outside the parity-pinned toolchain (1.83) by
# forcing `RUSTUP_TOOLCHAIN=stable`. This keeps the parity guarantee
# intact while letting us use cargo-mutants ≥ 24 which requires
# edition2024 / Rust 1.85+.
#
# Usage:
#   ./scripts/rust-mutate.sh                          # rng.rs hot path (default)
#   ./scripts/rust-mutate.sh --file SRC               # mutate a specific file
#   ./scripts/rust-mutate.sh --whole-crate            # full crate (≈6 h)
#   ./scripts/rust-mutate.sh --re "fn1|fn2"           # custom regex
#
# Prereqs:
#   rustup install stable                             # 1.93 or newer
#   cargo +stable install cargo-mutants               # binary in ~/.cargo/bin
#
# Output: reports/mutation/rust/<scope>/mutants.out/
#         (caught.txt, missed.txt, timeout.txt, outcomes.json, log/, diff/)

set -euo pipefail

cd "$(dirname "$0")/.."

# ── Argument parsing ────────────────────────────────────────────────────────
FILE="rust-sim/src/rng.rs"
RE="pick_weighted|random_int|random_bounded|next_f64|next_u64"
SCOPE="rng"
TIMEOUT=60
JOBS=6
WHOLE_CRATE=0

while (( "$#" )); do
  case "$1" in
    --file)
      FILE="$2"
      SCOPE="$(basename "$FILE" .rs)"
      shift 2
      ;;
    --re)
      RE="$2"
      shift 2
      ;;
    --whole-crate)
      WHOLE_CRATE=1
      shift
      ;;
    --timeout)
      TIMEOUT="$2"
      shift 2
      ;;
    --jobs)
      JOBS="$2"
      shift 2
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

# ── Toolchain probe ─────────────────────────────────────────────────────────
if ! rustup toolchain list | grep -q '^stable'; then
  echo "ERROR: stable toolchain not installed. Run: rustup install stable" >&2
  exit 1
fi
if ! command -v cargo-mutants >/dev/null 2>&1; then
  echo "ERROR: cargo-mutants not installed. Run: rustup run stable cargo install cargo-mutants" >&2
  exit 1
fi

OUTPUT_DIR="reports/mutation/rust/${SCOPE}"
mkdir -p "$OUTPUT_DIR"

# Wipe any stale run state but keep summary files for diff-vs-prev compares.
rm -rf "${OUTPUT_DIR}/mutants.out"

echo "▶ Mutating ${FILE} (scope=${SCOPE}, regex=${RE:-<whole-file>})"
echo "  toolchain: stable ($(rustup run stable rustc --version 2>&1))"
echo "  output:    ${OUTPUT_DIR}/mutants.out"
echo "  timeout:   ${TIMEOUT} s, jobs: ${JOBS}"
echo

CARGO_MUTANTS_ARGS=(
  "--manifest-path" "rust-sim/Cargo.toml"
  "--timeout" "${TIMEOUT}"
  "--no-shuffle"
  "--jobs" "${JOBS}"
  "--output" "${OUTPUT_DIR}"
)

if (( WHOLE_CRATE == 0 )); then
  CARGO_MUTANTS_ARGS+=("--file" "${FILE}")
  if [ -n "${RE}" ]; then
    CARGO_MUTANTS_ARGS+=("--re" "${RE}")
  fi
fi

RUSTUP_TOOLCHAIN=stable cargo mutants "${CARGO_MUTANTS_ARGS[@]}"

# ── Summary ─────────────────────────────────────────────────────────────────
if [ -f "${OUTPUT_DIR}/mutants.out/outcomes.json" ]; then
  python3 - <<PY
import json
with open("${OUTPUT_DIR}/mutants.out/outcomes.json") as f:
    d = json.load(f)
caught = d["caught"]
missed = d["missed"]
timeout = d["timeout"]
total_relevant = caught + missed
strict = 100 * caught / total_relevant if total_relevant else 0.0
print()
print(f"📊 Mutation summary for scope='${SCOPE}':")
print(f"   caught:   {caught}")
print(f"   missed:   {missed}")
print(f"   timeout:  {timeout}")
print(f"   unviable: {d['unviable']}")
print(f"   total:    {d['total_mutants']}")
print(f"   strict score: {caught}/{total_relevant} = {strict:.1f}%")
PY
fi
