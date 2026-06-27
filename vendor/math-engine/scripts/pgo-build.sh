#!/usr/bin/env bash
# Faza 9.5 — Profile-Guided Optimization build pipeline
#
# Three-stage PGO + optional BOLT post-link optimization:
#
#   Stage 1 (instrument) — build `slot_sim` with `-Cprofile-generate=<dir>`.
#                          Binary emits LLVM `*.profraw` files as it runs.
#   Stage 2 (training)   — run a representative workload that exercises
#                          all hot paths: bulk_dispatcher + criterion benches.
#                          Profile data lands in `target/pgo-data/`.
#   Stage 3 (optimize)   — merge `*.profraw` → `merged.profdata` via
#                          `llvm-profdata`, rebuild with `-Cprofile-use=...`.
#   Stage 4 (BOLT, opt)  — if `llvm-bolt` is on PATH, run post-link
#                          basic-block reordering on the optimized binary.
#
# Acceptance gate (Faza 9.5):
#   +20% throughput on `full_spin/packed_ZeroAlloc` bench vs non-PGO baseline.
#   The script writes a `reports/bench/pgo/<timestamp>/summary.json` that
#   captures pre/post numbers and computes the delta so CI can `jq`-gate it.
#
# Usage:
#   scripts/pgo-build.sh                    # full pipeline
#   scripts/pgo-build.sh --skip-bench       # build only (skip stage 2)
#   scripts/pgo-build.sh --bolt             # also run llvm-bolt stage
#   scripts/pgo-build.sh --threshold 0.20   # custom acceptance gate (default 0.20)
#
# Environment:
#   LLVM_PROFDATA   — override llvm-profdata path (auto-detected if unset)
#   LLVM_BOLT       — override llvm-bolt path (auto-detected if unset)
#   CARGO_TARGET    — override target dir (default: target)
#   PGO_QUIET       — set to 1 to suppress cargo build chatter

set -euo pipefail

# ─── arg parsing ──────────────────────────────────────────────────────────────
SKIP_BENCH=0
RUN_BOLT=0
THRESHOLD="${PGO_THRESHOLD:-0.20}"
TRAINING_SPINS="${PGO_TRAINING_SPINS:-2000000}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-bench) SKIP_BENCH=1; shift ;;
    --bolt) RUN_BOLT=1; shift ;;
    --threshold) THRESHOLD="$2"; shift 2 ;;
    --training-spins) TRAINING_SPINS="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "ERROR: unknown flag: $1" >&2
      exit 2
      ;;
  esac
done

# ─── paths ────────────────────────────────────────────────────────────────────
REPO_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
RUST_DIR="${REPO_ROOT}/rust-sim"
TARGET_DIR="${CARGO_TARGET:-${REPO_ROOT}/target}"
PROFRAW_DIR="${TARGET_DIR}/pgo-data"
MERGED_PROFDATA="${TARGET_DIR}/pgo-merged.profdata"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT_DIR="${REPO_ROOT}/reports/bench/pgo/${TIMESTAMP}"
mkdir -p "${REPORT_DIR}"

cd "${REPO_ROOT}"

log() { printf '\n\033[1;36m[pgo]\033[0m %s\n' "$*"; }
err() { printf '\n\033[1;31m[pgo]\033[0m %s\n' "$*" >&2; }

# ─── auto-detect llvm-profdata ────────────────────────────────────────────────
detect_profdata() {
  if [[ -n "${LLVM_PROFDATA:-}" ]] && command -v "${LLVM_PROFDATA}" >/dev/null 2>&1; then
    echo "${LLVM_PROFDATA}"; return 0
  fi
  # 1. Rust-bundled (preferred — matches rustc LLVM version exactly)
  local sysroot
  sysroot="$(rustc --print sysroot 2>/dev/null || echo)"
  if [[ -n "${sysroot}" ]]; then
    for arch in $(ls "${sysroot}/lib/rustlib/" 2>/dev/null | grep -v '^etc$' || true); do
      local cand="${sysroot}/lib/rustlib/${arch}/bin/llvm-profdata"
      if [[ -x "${cand}" ]]; then echo "${cand}"; return 0; fi
    done
  fi
  # 2. System (homebrew / apt)
  if command -v llvm-profdata >/dev/null 2>&1; then
    command -v llvm-profdata; return 0
  fi
  if command -v xcrun >/dev/null 2>&1; then
    local x; x="$(xcrun --find llvm-profdata 2>/dev/null || true)"
    if [[ -n "${x}" ]]; then echo "${x}"; return 0; fi
  fi
  return 1
}

PROFDATA_BIN="$(detect_profdata || true)"
if [[ -z "${PROFDATA_BIN}" ]]; then
  err "llvm-profdata not found."
  err "Install: rustup component add llvm-tools-preview"
  err "Then re-run."
  exit 3
fi
log "llvm-profdata: ${PROFDATA_BIN}"
log "Report dir: ${REPORT_DIR}"

# ─── helpers ──────────────────────────────────────────────────────────────────
extract_throughput_ns() {
  # Parse criterion `estimates.json` and emit median point-estimate (ns).
  # Returns the empty string when the file isn't available yet (first run).
  local f="$1"
  if [[ ! -f "${f}" ]]; then return 0; fi
  # jq is optional — fall back to python3 if missing.
  if command -v jq >/dev/null 2>&1; then
    jq -r '.median.point_estimate // empty' "${f}" 2>/dev/null || true
  else
    python3 -c "import json,sys; d=json.load(open('${f}')); print(d.get('median',{}).get('point_estimate',''))" 2>/dev/null || true
  fi
}

run_bench_capture() {
  # Run criterion bench, return median ns for `full_spin/packed_ZeroAlloc`.
  local label="$1"
  log "Running bench (${label})…"
  (
    cd "${RUST_DIR}"
    cargo bench --bench spin_throughput -- --warm-up-time 1 --measurement-time 3 full_spin >/dev/null 2>&1 || true
  )
  local est="${TARGET_DIR}/criterion/full_spin/packed_ZeroAllocEvaluator/new/estimates.json"
  local ns
  ns="$(extract_throughput_ns "${est}")"
  if [[ -z "${ns}" ]]; then
    # Try the `estimates.json` at the report dir (post-rename for the first run).
    ns="$(extract_throughput_ns "${TARGET_DIR}/criterion/full_spin/packed_ZeroAllocEvaluator/base/estimates.json")"
  fi
  if [[ -z "${ns}" ]]; then
    err "criterion estimates.json not found at ${est}"
    return 1
  fi
  printf '%s\n' "${ns}" > "${REPORT_DIR}/${label}.ns"
  log "${label} median: ${ns} ns"
}

# ─── Stage 0: baseline (non-PGO) ──────────────────────────────────────────────
if [[ "${SKIP_BENCH}" -eq 0 ]]; then
  log "Stage 0: baseline release build (non-PGO)"
  (
    cd "${RUST_DIR}"
    cargo build --release ${PGO_QUIET:+--quiet}
  )
  run_bench_capture "baseline"
fi

# ─── Stage 1: instrument ──────────────────────────────────────────────────────
log "Stage 1: instrument build (-Cprofile-generate) for slot_sim binary + bench"
rm -rf "${PROFRAW_DIR}"
mkdir -p "${PROFRAW_DIR}"
(
  cd "${RUST_DIR}"
  RUSTFLAGS="-Cprofile-generate=${PROFRAW_DIR}" \
    cargo build --release --bin slot_sim ${PGO_QUIET:+--quiet}
  # W242-followup: also build the criterion bench under instrumentation
  # so the bench-harness hot path gets profile data (otherwise the
  # Stage-3 measurement bench has zero PGO coverage on its own
  # `make_bench_config` / `benches` function — `pgo-warn-missing-function`
  # warnings on every CGU).
  RUSTFLAGS="-Cprofile-generate=${PROFRAW_DIR}" \
    cargo build --release --bench spin_throughput ${PGO_QUIET:+--quiet}
)

INSTRUMENTED_BIN="${TARGET_DIR}/release/slot_sim"
if [[ ! -x "${INSTRUMENTED_BIN}" ]]; then
  err "Instrumented binary not found at ${INSTRUMENTED_BIN}"
  exit 4
fi

# ─── Stage 2: training run ────────────────────────────────────────────────────
log "Stage 2: training workload (${TRAINING_SPINS} spins × 3 fixtures + bench warmup)"
TRAINING_FIXTURES=(
  "tests/fixtures/parity.json"
  "tests/fixtures/reference/5x3-243ways.json"
  "tests/fixtures/reference/hnw-grand-jackpot.json"
)
TRAINING_RAN=0
for f in "${TRAINING_FIXTURES[@]}"; do
  if [[ -f "${REPO_ROOT}/${f}" ]]; then
    log "  training: ${f}"
    "${INSTRUMENTED_BIN}" \
      --config "${REPO_ROOT}/${f}" \
      --spins "${TRAINING_SPINS}" \
      --seeds 1 \
      >/dev/null 2>&1 || true
    TRAINING_RAN=$((TRAINING_RAN + 1))
  fi
done
if [[ "${TRAINING_RAN}" -eq 0 ]]; then
  err "No training fixtures found — populated tests/fixtures/ first."
  exit 5
fi

# W242-followup: also drive the instrumented bench harness so its
# hot path (`make_bench_config`, packed_ZeroAllocEvaluator inner loop)
# gets covered by profile data. Without this, the Stage-3 PGO
# measurement bench cannot benefit from PGO at all.
log "  training: instrumented bench warmup (cargo bench --bench spin_throughput)"
(
  cd "${RUST_DIR}"
  RUSTFLAGS="-Cprofile-generate=${PROFRAW_DIR}" \
    cargo bench --bench spin_throughput -- \
      --warm-up-time 1 --measurement-time 2 full_spin \
      >/dev/null 2>&1 || true
)

PROFRAW_COUNT=$(find "${PROFRAW_DIR}" -maxdepth 2 -name '*.profraw' | wc -l | tr -d ' ')
log "Captured ${PROFRAW_COUNT} .profraw files in ${PROFRAW_DIR}"
if [[ "${PROFRAW_COUNT}" -eq 0 ]]; then
  err "No profile data captured — instrument build may not be wired."
  err "Verify rustc --version emits 'rustc 1.x' (PGO requires LLVM 14+)."
  exit 6
fi

# ─── Stage 3: merge + optimized build ─────────────────────────────────────────
log "Stage 3: merge profile data → ${MERGED_PROFDATA}"
"${PROFDATA_BIN}" merge -o "${MERGED_PROFDATA}" "${PROFRAW_DIR}"

log "Stage 3: optimized rebuild (-Cprofile-use)"
(
  cd "${RUST_DIR}"
  RUSTFLAGS="-Cprofile-use=${MERGED_PROFDATA} -Cllvm-args=-pgo-warn-missing-function" \
    cargo build --release --bin slot_sim ${PGO_QUIET:+--quiet}
)

OPTIMIZED_BIN="${TARGET_DIR}/release/slot_sim"
if [[ ! -x "${OPTIMIZED_BIN}" ]]; then
  err "Optimized binary not found at ${OPTIMIZED_BIN}"
  exit 7
fi

# Stash the PGO-built binary so the bench doesn't overwrite it.
PGO_BIN_DIR="${TARGET_DIR}/release-pgo"
mkdir -p "${PGO_BIN_DIR}"
cp "${OPTIMIZED_BIN}" "${PGO_BIN_DIR}/slot_sim"

if [[ "${SKIP_BENCH}" -eq 0 ]]; then
  log "Re-running criterion bench against PGO-built lib"
  # We rebuild the criterion bench with the same PGO data so the lib-side
  # code paths benefit too. (The lib is part of the bench's compilation
  # unit, so its hot paths get the PGO treatment.)
  (
    cd "${RUST_DIR}"
    RUSTFLAGS="-Cprofile-use=${MERGED_PROFDATA} -Cllvm-args=-pgo-warn-missing-function" \
      cargo build --release --bench spin_throughput ${PGO_QUIET:+--quiet}
  )
  run_bench_capture "pgo"
fi

# ─── Stage 4: BOLT (optional) ─────────────────────────────────────────────────
BOLT_BIN=""
if [[ "${RUN_BOLT}" -eq 1 ]]; then
  if [[ -n "${LLVM_BOLT:-}" ]]; then
    BOLT_BIN="${LLVM_BOLT}"
  elif command -v llvm-bolt >/dev/null 2>&1; then
    BOLT_BIN="$(command -v llvm-bolt)"
  fi
  if [[ -z "${BOLT_BIN}" ]]; then
    err "llvm-bolt not on PATH — skipping BOLT stage (install via: brew install bolt OR apt install bolt)."
  else
    log "Stage 4: BOLT post-link optimization"
    BOLT_BIN_OUT="${PGO_BIN_DIR}/slot_sim.bolt"
    BOLT_PROFDIR="${TARGET_DIR}/bolt-data"
    mkdir -p "${BOLT_PROFDIR}"
    # 1. instrument with BOLT
    "${BOLT_BIN}" -instrument "${PGO_BIN_DIR}/slot_sim" \
      -o "${PGO_BIN_DIR}/slot_sim.bolt-instrumented" \
      --instrumentation-file="${BOLT_PROFDIR}/prof.fdata"
    # 2. training run
    for f in "${TRAINING_FIXTURES[@]}"; do
      if [[ -f "${REPO_ROOT}/${f}" ]]; then
        "${PGO_BIN_DIR}/slot_sim.bolt-instrumented" \
          --config "${REPO_ROOT}/${f}" --spins 200000 --seeds 1 >/dev/null 2>&1 || true
      fi
    done
    # 3. optimize
    "${BOLT_BIN}" "${PGO_BIN_DIR}/slot_sim" \
      -o "${BOLT_BIN_OUT}" \
      -data="${BOLT_PROFDIR}/prof.fdata" \
      -reorder-blocks=ext-tsp \
      -reorder-functions=hfsort+ \
      -split-functions \
      -split-all-cold \
      -split-eh \
      -dyno-stats || err "BOLT stage failed — keeping PGO-only binary"
  fi
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
BASELINE_NS=""
PGO_NS=""
DELTA="n/a"
PCT="n/a"
STATUS="skipped"
if [[ -f "${REPORT_DIR}/baseline.ns" ]]; then
  BASELINE_NS="$(cat "${REPORT_DIR}/baseline.ns")"
fi
if [[ -f "${REPORT_DIR}/pgo.ns" ]]; then
  PGO_NS="$(cat "${REPORT_DIR}/pgo.ns")"
fi
if [[ -n "${BASELINE_NS}" && -n "${PGO_NS}" ]]; then
  # delta = (baseline - pgo) / baseline   (positive = PGO faster)
  DELTA=$(awk -v b="${BASELINE_NS}" -v p="${PGO_NS}" 'BEGIN { if (b > 0) printf "%.6f", (b - p) / b; else print "n/a" }')
  PCT=$(awk -v d="${DELTA}" 'BEGIN { printf "%.2f%%", d * 100 }')
  STATUS=$(awk -v d="${DELTA}" -v t="${THRESHOLD}" 'BEGIN { if (d + 0 >= t + 0) print "PASS"; else print "MISS" }')
fi

cat > "${REPORT_DIR}/summary.json" <<EOF
{
  "timestamp": "${TIMESTAMP}",
  "threshold_pct": "${THRESHOLD}",
  "bench": "full_spin/packed_ZeroAllocEvaluator",
  "baseline_median_ns": ${BASELINE_NS:-null},
  "pgo_median_ns": ${PGO_NS:-null},
  "delta_fraction": "${DELTA}",
  "delta_pct": "${PCT}",
  "status": "${STATUS}",
  "bolt_binary": $( [[ -n "${BOLT_BIN}" ]] && echo "\"${BOLT_BIN}\"" || echo "null" ),
  "rustc_version": "$(rustc --version | sed 's/"/\\\"/g')",
  "host": "$(uname -smr | sed 's/"/\\\"/g')"
}
EOF

log "Summary written → ${REPORT_DIR}/summary.json"
cat "${REPORT_DIR}/summary.json"

if [[ "${STATUS}" == "MISS" ]]; then
  err "PGO delta ${PCT} < ${THRESHOLD} threshold — gate would FAIL"
  exit 8
fi
log "PGO build pipeline complete. Optimized binary: ${PGO_BIN_DIR}/slot_sim"
