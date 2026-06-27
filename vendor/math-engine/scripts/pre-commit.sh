#!/usr/bin/env bash
# Pre-commit hook — Faza 0.1 acceptance gate.
#
# Wire-up: `git config core.hooksPath scripts/` (or symlink into .git/hooks/).
# Husky is intentionally avoided so the gate works on bare git clients
# (CI runners, fresh checkouts) without an npm install first.
#
# Fast-path: skip when there are no staged TS / Rust changes (commits that
# only touch docs / md should not pay the toolchain tax).
set -euo pipefail

CHANGED_TS=$(git diff --cached --name-only --diff-filter=ACMR -- 'src/**/*.ts' 'tests/**/*.ts' 'scripts/**/*.ts' 'scripts/**/*.mjs' 2>/dev/null || true)
CHANGED_RS=$(git diff --cached --name-only --diff-filter=ACMR -- 'rust-sim/**/*.rs' 'rust-sim/**/*.toml' 2>/dev/null || true)
CHANGED_CFG=$(git diff --cached --name-only --diff-filter=ACMR -- 'package.json' 'tsconfig.json' 'rust-toolchain.toml' 2>/dev/null || true)

if [[ -z "$CHANGED_TS" && -z "$CHANGED_RS" && -z "$CHANGED_CFG" ]]; then
  echo "pre-commit: only docs touched — skipping toolchain checks"
  exit 0
fi

echo "pre-commit: detected source changes — running gate"

# ── TypeScript gate ─────────────────────────────────────────────────────
if [[ -n "$CHANGED_TS$CHANGED_CFG" ]]; then
  echo "→ tsc --noEmit"
  npm run lint --silent
  echo "→ vitest (changed files only via --changed)"
  # Use --run so the watcher does not stay open in interactive shells.
  npx vitest run --changed origin/main --silent || npx vitest run --silent
fi

# ── Rust gate ───────────────────────────────────────────────────────────
if [[ -n "$CHANGED_RS$CHANGED_CFG" ]]; then
  echo "→ cargo fmt --check"
  (cd rust-sim && cargo fmt --all -- --check)
  echo "→ cargo clippy -D warnings"
  (cd rust-sim && cargo clippy --all-targets -- -D warnings)
  echo "→ cargo test"
  (cd rust-sim && cargo test --all-features --quiet)
fi

echo "pre-commit: PASS"
