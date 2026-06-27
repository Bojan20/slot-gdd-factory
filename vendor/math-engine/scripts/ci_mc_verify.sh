#!/usr/bin/env bash
# W5.5 — Auto MC verify CI gate (CI orchestrator).
#
# Tier matrix:
#   quick    — PR gate (every push): 1M spins / 5% threshold
#   standard — nightly:              100M spins / 0.5% threshold
#   strict   — weekly cert:          1B spins / 0.05% threshold
#
# Usage:
#   scripts/ci_mc_verify.sh [tier]              # tier defaults to quick
#   scripts/ci_mc_verify.sh standard
#   scripts/ci_mc_verify.sh strict
#
# Env:
#   GAMES_ROOT  — root containing per-game out/ dirs (default: ./games)
#   REPORT      — path to JSON report (default: reports/mc_verify_<tier>.json)
#   SEED        — MC seed override (default: 42)
#
# Exit: 0 on all-pass, 1 on any drift > threshold, 2 on infrastructure error.

set -euo pipefail

TIER="${1:-quick}"
GAMES_ROOT="${GAMES_ROOT:-games}"
REPORT="${REPORT:-reports/mc_verify_${TIER}.json}"
SEED="${SEED:-42}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Ensure slot-sim binary is built (release mode for CI speed)
if [[ ! -x engine/slot-sim/target/release/slot-sim ]]; then
  echo "[ci-mc-verify] building slot-sim binary…"
  (cd engine/slot-sim && cargo build --release --bin slot-sim --quiet)
fi

mkdir -p "$(dirname "$REPORT")"

echo "[ci-mc-verify] tier=$TIER games_root=$GAMES_ROOT seed=$SEED report=$REPORT"

# Find all universal IR files (portable — bash 3 on macOS has no mapfile)
IR_FILES=()
while IFS= read -r f; do
  IR_FILES+=("$f")
done < <(find "$GAMES_ROOT" -name "*.slot-sim.ir.json" -type f | sort)

if [[ ${#IR_FILES[@]} -eq 0 ]]; then
  echo "[ci-mc-verify] no *.slot-sim.ir.json files found under $GAMES_ROOT" >&2
  exit 2
fi

echo "[ci-mc-verify] verifying ${#IR_FILES[@]} game(s)…"

# Delegate to Python verifier
python3 -m tools.slot_build.verify \
  "${IR_FILES[@]}" \
  --tier "$TIER" \
  --seed "$SEED" \
  --report "$REPORT"
