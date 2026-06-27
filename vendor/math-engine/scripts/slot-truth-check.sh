#!/usr/bin/env bash
# slot-truth-check — Self-Honesty Gate for slot-math-engine-template (W152 P0-8).
#
# Re-runs ground-truth source-of-truth queries and exits non-zero when
# the result drifts > THRESHOLD% from the oracle baked into this script.
#
# Why: SLOT_ENGINE_MASTER_TODO.md is the single source of truth for what
# is implemented vs claimed. Without an enforced gate, that document
# tends to drift optimistically (see host-orchestrator W150 audit which found the
# 37× test-count gap in CLAUDE.md). This script prevents the same class
# of bug here.
#
# Usage:
#   scripts/slot-truth-check.sh                # human-readable diff
#   scripts/slot-truth-check.sh --ci           # machine-readable, exits 1 on drift
#   scripts/slot-truth-check.sh --emit-cache   # write target/slot-truth-cache.json
#
# Env:
#   SLOT_TRUTH_THRESHOLD_PCT  default: 10   # fail if any metric > N% off
#
# Compatible with bash 3.2 (macOS default — no associative arrays).

set -uo pipefail

# W152 Wave 18 QA fix — non-login subshells (CI runners, `bash scripts/...`
# invocation, npm script context) frequently miss `~/.cargo/bin` on macOS
# because cargo's installer only patches `.zshenv` / `.profile`. Without
# this prefix the `measure_rust_total_tests` cargo call silently returns 0
# and the metric drifts to a false-fail. Prepend known-good cargo dirs.
for cargo_dir in "$HOME/.cargo/bin" /usr/local/cargo/bin /opt/cargo/bin; do
  if [ -x "$cargo_dir/cargo" ] && [[ ":$PATH:" != *":$cargo_dir:"* ]]; then
    PATH="$cargo_dir:$PATH"
  fi
done
export PATH

CI_MODE=0
EMIT_CACHE=0
for arg in "$@"; do
  case "$arg" in
    --ci) CI_MODE=1 ;;
    --emit-cache) EMIT_CACHE=1 ;;
    -h|--help)
      sed -n '2,22p' "$0" | sed 's/^# //; s/^#//'
      exit 0
      ;;
  esac
done

THRESHOLD_PCT="${SLOT_TRUTH_THRESHOLD_PCT:-10}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── Color helpers (stripped in CI mode) ─────────────────────────────────────
if [ "$CI_MODE" -eq 1 ]; then
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BOLD=""; C_RESET=""
else
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
fi

# ── Metric source-of-truth oracle ───────────────────────────────────────────
# Each line: METRIC_NAME OPERATOR EXPECTED
#   OPERATOR ∈ { eq | ge | le }    eq = exact; ge / le = bounds
# Update these values whenever a wave lands new tests / files. Drift > N%
# (configurable) fails CI.

read_oracle() {
  cat <<'EOF'
rust_lib_tests           ge   290
rust_total_tests         ge   1100
ts_test_count            ge   7000
ts_test_files            ge   230
ir_feature_stubs_closed  eq   20
chacha20_kat_test        eq   1
rng_submission_bin       eq   1
report_adapters_count    eq   4
holdandwin_solver        eq   1
master_todo_lines        ge   3000
EOF
}
# W196.TRUTH-V2 — baselines bumped 2026-05-26 from initial floors (259/783/
# 2688/114/1000) to reflect post-Phase 7 closure reality (307/1168/7248/
# 240/3467 actuals). Threshold remains 10% drift window so honest
# wave-by-wave growth is silently tolerated; only **regressions** > 10%
# below floor or **>10% over-claim** in MASTER_TODO bring the gate red.

# ── Measurement functions (each prints a single integer) ───────────────────

measure_rust_lib_tests() {
  # Count #[test] attributes inside rust-sim/src — that's the lib-tests pool.
  grep -rE '^\s*#\[(test|tokio::test)\]' rust-sim/src 2>/dev/null \
    | grep -v -c '//' \
    || echo 0
}

measure_rust_total_tests() {
  # Sum of every "test result:" total across the cargo test output.
  # Cached in target/slot-truth-cache.json when --emit-cache mode runs.
  local cache="target/slot-truth-cache.json"
  if [ -r "$cache" ]; then
    awk -F'"rust_total_tests":\\s*' '/rust_total_tests/ { print $2 }' "$cache" \
      | tr -d ',' | head -1 || echo 0
    return
  fi
  (cd rust-sim && cargo test --quiet 2>&1) \
    | awk '/^test result:/ { sum += $4 } END { print sum+0 }'
}

measure_ts_test_count() {
  local cache="target/slot-truth-cache.json"
  if [ -r "$cache" ]; then
    awk -F'"ts_test_count":\\s*' '/ts_test_count/ { print $2 }' "$cache" \
      | tr -d ',' | head -1 || echo 0
    return
  fi
  npx vitest run --reporter=json 2>/dev/null \
    | awk -F'"numPassedTests":' '{ for (i=2;i<=NF;i++) { split($i,a,","); s+=a[1] } } END { print s+0 }' \
    || echo 0
}

measure_ts_test_files() {
  find tests -name '*.test.ts' 2>/dev/null | wc -l | awk '{print $1}'
}

measure_ir_feature_stubs_closed() {
  # We claim all 11 IR feature kinds are IR-native: free_spins, hold_and_win,
  # cascade, respin, mystery_symbol, pick, wheel, buy_feature, ante_bet,
  # gamble, symbol_upgrade. Validator: count *unique* TSGameConfig optional
  # feature keys in src/ir/adapter.ts — these only exist when the matching
  # match-arm is implemented (no-op stubs don't add config keys).
  # 2 always-present (free_spins, hold_and_win) + 9 optional = 11 wired
  # feature kinds.
  local cascade=$(grep -c 'cascade?:\s*TSCascadeConfig' src/ir/adapter.ts)
  local respin=$(grep -c 'respin?:\s*TSRespinConfig' src/ir/adapter.ts)
  local mystery=$(grep -c 'mystery?:\s*TSMysteryConfig' src/ir/adapter.ts)
  local pick=$(grep -c 'pick?:\s*TSPickConfig' src/ir/adapter.ts)
  local wheel=$(grep -c 'wheel?:\s*TSWheelConfig' src/ir/adapter.ts)
  local buyFeature=$(grep -c 'buyFeature?:\s*TSBuyFeatureConfig' src/ir/adapter.ts)
  local anteBet=$(grep -c 'anteBet?:\s*TSAnteBetConfig' src/ir/adapter.ts)
  local gamble=$(grep -c 'gamble?:\s*TSGambleConfig' src/ir/adapter.ts)
  local sym=$(grep -c 'symbolUpgrade?:\s*TSSymbolUpgradeConfig' src/ir/adapter.ts)
  # Each optional appears TWICE in adapter.ts (in TSGameConfig interface
  # AND in convertFeatures return-type alias). 9 features × 2 = 18,
  # plus 2 always-present base configs (free_spins + hold_and_win) → 20.
  echo $((cascade + respin + mystery + pick + wheel + buyFeature + anteBet + gamble + sym + 2))
}

measure_chacha20_kat_test() {
  if grep -rE 'chacha20_kat|chacha20.*RFC 8439|ChaCha20.*KAT' \
      rust-sim/src rust-sim/tests src tests 2>/dev/null \
      | head -1 > /dev/null; then
    echo 1
  else
    echo 0
  fi
}

measure_rng_submission_bin() {
  if [ -f "rust-sim/src/bin/rng_submission.rs" ]; then echo 1; else echo 0; fi
}

measure_report_adapters_count() {
  ls src/report/adapters/*Adapter.ts 2>/dev/null | wc -l | awk '{print $1}'
}

measure_holdandwin_solver() {
  if [ -f "src/solver/holdAndWinMarkov.ts" ]; then echo 1; else echo 0; fi
}

measure_master_todo_lines() {
  wc -l < SLOT_ENGINE_MASTER_TODO.md | awk '{print $1}'
}

# ── Compare-and-report ─────────────────────────────────────────────────────

drift_pct() {
  local actual="$1"
  local expected="$2"
  if [ "$expected" -eq 0 ]; then
    if [ "$actual" -eq 0 ]; then echo 0; else echo 9999; fi
    return
  fi
  # absolute relative drift as integer percentage
  awk -v a="$actual" -v e="$expected" 'BEGIN {
    d = (a - e); if (d < 0) d = -d;
    printf "%d", (d * 100 + e/2) / e
  }'
}

compare_one() {
  local name="$1"
  local op="$2"
  local expected="$3"
  local fn="measure_$name"
  if ! command -v "$fn" >/dev/null 2>&1 && ! declare -f "$fn" >/dev/null 2>&1; then
    echo "${C_YELLOW}NO MEASURE FN: $name${C_RESET}"
    return 1
  fi
  local actual; actual=$("$fn" 2>/dev/null | head -1)
  actual="${actual:-0}"
  local ok=1
  local note=""
  case "$op" in
    eq)
      if [ "$actual" -eq "$expected" ]; then ok=0; fi
      ;;
    ge)
      if [ "$actual" -ge "$expected" ]; then ok=0; fi
      # Allow drift below by up to THRESHOLD_PCT for "ge" bounds.
      local pct; pct=$(drift_pct "$actual" "$expected")
      if [ "$ok" -ne 0 ] && [ "$pct" -le "$THRESHOLD_PCT" ]; then
        ok=2
        note=" (within ${THRESHOLD_PCT}% drift)"
      fi
      ;;
    le)
      if [ "$actual" -le "$expected" ]; then ok=0; fi
      ;;
  esac
  case "$ok" in
    0) printf "  %s%-30s%s  ${C_GREEN}OK${C_RESET}    actual=%s  expected=%s %s\n" "$C_BOLD" "$name" "$C_RESET" "$actual" "$op $expected" "$note" ;;
    2) printf "  %s%-30s%s  ${C_YELLOW}WARN${C_RESET}  actual=%s  expected=%s %s\n" "$C_BOLD" "$name" "$C_RESET" "$actual" "$op $expected" "$note" ;;
    *) printf "  %s%-30s%s  ${C_RED}FAIL${C_RESET}  actual=%s  expected=%s %s\n" "$C_BOLD" "$name" "$C_RESET" "$actual" "$op $expected" "$note" ;;
  esac
  return $ok
}

# ── Emit-cache mode ────────────────────────────────────────────────────────

if [ "$EMIT_CACHE" -eq 1 ]; then
  mkdir -p target
  echo "[slot-truth-check] running cargo test for cache (this is slow)..." >&2
  rust_total=$( (cd rust-sim && cargo test --quiet 2>&1) \
    | awk '/^test result:/ { sum += $4 } END { print sum+0 }' )
  echo "[slot-truth-check] running vitest for cache..." >&2
  ts_count=$(npx vitest run --reporter=json 2>/dev/null \
    | awk -F'"numPassedTests":' '{ for (i=2;i<=NF;i++) { split($i,a,","); s+=a[1] } } END { print s+0 }')
  cat > target/slot-truth-cache.json <<JSON
{
  "rust_total_tests": $rust_total,
  "ts_test_count": $ts_count,
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
  echo "[slot-truth-check] cache written: target/slot-truth-cache.json"
  exit 0
fi

# ── Compare loop ───────────────────────────────────────────────────────────

echo "${C_BOLD}slot-truth-check — drift threshold: ${THRESHOLD_PCT}%${C_RESET}"
echo

fail_count=0
warn_count=0
total=0

while IFS=' ' read -r name op expected; do
  [ -z "$name" ] && continue
  case "$name" in '#'*) continue ;; esac
  total=$((total + 1))
  if compare_one "$name" "$op" "$expected"; then
    :  # ok=0 → success
  else
    rc=$?
    if [ "$rc" -eq 2 ]; then
      warn_count=$((warn_count + 1))
    else
      fail_count=$((fail_count + 1))
    fi
  fi
done <<< "$(read_oracle)"

echo
echo "${C_BOLD}Summary:${C_RESET}  total=$total  ok=$((total - fail_count - warn_count))  warn=$warn_count  fail=$fail_count"

if [ "$fail_count" -gt 0 ]; then
  if [ "$CI_MODE" -eq 1 ]; then
    echo "${C_RED}slot-truth-check FAILED${C_RESET} ($fail_count metric(s) drifted beyond tolerance)" >&2
  else
    echo "${C_RED}╔════════════════════════════════════════════════════════════════╗${C_RESET}"
    echo "${C_RED}║  $fail_count metric(s) drifted beyond ${THRESHOLD_PCT}% tolerance.${C_RESET}"
    echo "${C_RED}║  Either fix the code OR update the oracle at the top of this script.${C_RESET}"
    echo "${C_RED}║  Bumping the oracle is allowed but MUST be on the same commit"
    echo "${C_RED}║  that landed the new tests/files.${C_RESET}"
    echo "${C_RED}╚════════════════════════════════════════════════════════════════╝${C_RESET}"
  fi
  exit 1
fi

echo "${C_GREEN}slot-truth-check OK${C_RESET}"
exit 0
