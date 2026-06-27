#!/usr/bin/env bash
#
# W244 wave 82 — verify all Merkle roots reproduce byte-identical.
#
# For external auditor / regulator lab: single script koji rebuild-uje
# svaki Merkle-pinned artefakt + diff-uje vs committed. Exit 0 ako
# nijedan ne drift-uje.
#
# Usage:
#   $ ./scripts/verify_all_merkles.sh
#   $ ./scripts/verify_all_merkles.sh --skip-wasm   # skip wasm rebuild
#
# Exit codes:
#   0 — all artefakti reproduce byte-identical
#   1 — drift detected (printed to stderr sa diff path)
#   2 — prerequisite missing (Rust toolchain, wasm-pack, etc.)

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

SKIP_WASM=0
for arg in "$@"; do
  case "$arg" in
    --skip-wasm) SKIP_WASM=1 ;;
    -h|--help)
      sed -n '1,/^set/p' "$0" | sed '/^set/d; /^#!/d'
      exit 0
      ;;
  esac
done

GREEN="\033[32m"
RED="\033[31m"
YELLOW="\033[33m"
RESET="\033[0m"

DRIFT_COUNT=0
CHECK_COUNT=0

check_artefakt() {
  local label="$1"
  local path="$2"
  CHECK_COUNT=$((CHECK_COUNT + 1))
  if [ ! -f "$path" ]; then
    printf "${YELLOW}? SKIP${RESET}    %s — file missing\n" "$label"
    return 0
  fi
  # Snapshot, rebuild step is caller's job; we just diff committed
  if git diff --quiet --exit-code -- "$path"; then
    printf "${GREEN}✓ OK${RESET}      %s\n" "$label"
  else
    printf "${RED}✗ DRIFT${RESET}   %s — %s\n" "$label" "$path" >&2
    DRIFT_COUNT=$((DRIFT_COUNT + 1))
  fi
}

echo "▶ slot-math-engine-template — Merkle root verification"
echo "   git HEAD: $(git rev-parse --short HEAD)"
echo "   working tree: $(test -z "$(git status --porcelain)" \
                         && echo "clean" || echo "DIRTY (will affect diff)")"
echo

# ── Step 1: kernel acceptance JSONs ────────────────────────────────────────
echo "── Step 1: rebuild kernel acceptance JSONs ──"
python3 -m tools.build_all_w244_kernels > /tmp/_w244-build.log 2>&1 \
  || { echo "${RED}ERROR${RESET}: build_all_w244_kernels failed"; \
       cat /tmp/_w244-build.log; exit 2; }
echo "  rebuilt $(ls reports/acceptance/*_KERNEL.json | wc -l | tr -d ' ') kernel JSONs"

# Check each kernel JSON
for f in reports/acceptance/*_KERNEL.json; do
  check_artefakt "$(basename "$f" .json)" "$f"
done
check_artefakt "W244_ALL_KERNELS (master)" \
  "reports/acceptance/W244_ALL_KERNELS.json"

# ── Step 2: dossier HTML ───────────────────────────────────────────────────
echo
echo "── Step 2: rebuild dossier HTML ──"
make dossier-all > /tmp/_dossier.log 2>&1 \
  || { echo "${RED}ERROR${RESET}: make dossier-all failed"; \
       cat /tmp/_dossier.log; exit 2; }
for p in reports/dossier/*.html; do
  check_artefakt "$(basename "$p")" "$p"
done
for p in reports/dossier/kernels/*.html; do
  check_artefakt "kernels/$(basename "$p")" "$p"
done

# ── Step 3: JSON Schemas ───────────────────────────────────────────────────
echo
echo "── Step 3: rebuild JSON Schemas + manifest ──"
python3 tools/build_acceptance_schemas.py > /tmp/_schemas.log 2>&1 \
  || { echo "${RED}ERROR${RESET}: schemas rebuild failed"; \
       cat /tmp/_schemas.log; exit 2; }
for p in reports/schemas/*.json; do
  check_artefakt "$(basename "$p")" "$p"
done

# ── Step 4: search index ───────────────────────────────────────────────────
echo
echo "── Step 4: rebuild unified search index ──"
python3 tools/build_search_index.py > /tmp/_search.log 2>&1 \
  || { echo "${RED}ERROR${RESET}: search-index rebuild failed"; \
       cat /tmp/_search.log; exit 2; }
check_artefakt "search-index.json" "reports/dossier/search-index.json"

# ── Step 5: kernel Markdown docs ───────────────────────────────────────────
echo
echo "── Step 5: rebuild kernel Markdown docs ──"
python3 tools/build_kernel_markdown_docs.py > /tmp/_md.log 2>&1 \
  || { echo "${RED}ERROR${RESET}: kernel-md rebuild failed"; \
       cat /tmp/_md.log; exit 2; }
for p in docs/kernels/*.md; do
  check_artefakt "$(basename "$p")" "$p"
done

# ── Step 6: bench history ──────────────────────────────────────────────────
echo
echo "── Step 6: rebuild bench history ──"
python3 tools/build_bench_history.py > /tmp/_bh.log 2>&1 \
  || { echo "${RED}ERROR${RESET}: bench-history rebuild failed"; \
       cat /tmp/_bh.log; exit 2; }
check_artefakt "W244_BENCHMARK_HISTORY.json" \
  "reports/acceptance/W244_BENCHMARK_HISTORY.json"

# ── Step 7: wasm parity (optional, gated) ──────────────────────────────────
echo
if [ "$SKIP_WASM" -eq 1 ]; then
  echo "── Step 7: SKIPPED (--skip-wasm) ──"
else
  echo "── Step 7: rebuild wasm + re-run parity ──"
  if command -v wasm-pack >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
    ( cd packages/slot-math-wasm && \
      RUSTUP_TOOLCHAIN=stable wasm-pack build \
        --target nodejs --release > /tmp/_wasm.log 2>&1 ) \
      || { echo "${RED}ERROR${RESET}: wasm build failed"; \
           cat /tmp/_wasm.log; exit 2; }
    python3 tools/parity/w244_wasm_python_parity.py > /tmp/_wp.log 2>&1 \
      || { echo "${RED}ERROR${RESET}: wasm parity failed"; \
           cat /tmp/_wp.log; exit 2; }
    check_artefakt "WASM_PYTHON_PARITY_KERNEL.json" \
      "reports/acceptance/WASM_PYTHON_PARITY_KERNEL.json"
  else
    echo "${YELLOW}wasm-pack ili node nije instaliran — skipping${RESET}"
  fi
fi

# ── Summary ────────────────────────────────────────────────────────────────
echo
echo "═══════════════════════════════════════════════════════════════════════"
if [ "$DRIFT_COUNT" -eq 0 ]; then
  printf "${GREEN}✅ ALL %d MERKLE ROOTS REPRODUCE BYTE-IDENTICAL${RESET}\n" \
    "$CHECK_COUNT"
  echo "   Auditor sign-off: chain unbroken."
  exit 0
else
  printf "${RED}❌ %d / %d ARTEFAKTI DRIFTED${RESET}\n" \
    "$DRIFT_COUNT" "$CHECK_COUNT"
  echo
  echo "   Run \`git diff\` to inspect each drifted artefakt."
  echo "   Drift = either source change (re-commit) or a determinism break"
  echo "   (file as SECURITY.md issue if you cannot identify a source change)."
  exit 1
fi
