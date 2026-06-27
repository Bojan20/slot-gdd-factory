#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  check-reserved-terms.sh — W152 Wave 18 — Faza 15.X.3
#
#  Scans staged-for-commit files (or a given path) for vendor- and
#  product-specific terms that violate the clean-room implementation
#  policy documented in `docs/glossary.md` (RESERVED TERMS section).
#
#  Exit codes:
#    0  — no reserved-term matches found
#    1  — at least one match found (block commit / fail CI)
#    2  — script misuse (bad args)
#
#  Modes:
#    --staged   — scan files staged for the next commit (default).
#    --all      — scan entire working tree (TS + Rust + docs + scripts).
#    --files    — scan only the explicit paths after this flag.
#
#  Whitelist:
#    Files allowed to mention reserved terms (for educational context):
#      * docs/glossary.md   — canonical reference table
#      * docs/IP_REVIEW.md  — per-feature IP review citations
#      * scripts/check-reserved-terms.sh  — itself (the rules live here)
#      * docs/W152/*        — research bundle (legacy, kept for archive)
#      * docs/research.md   — legacy research dump
#
#  Performance:
#    All matches are case-INSENSITIVE for safety. The pattern is built
#    from the canonical reserved-terms list; if `docs/glossary.md`
#    changes, update the `RESERVED_PATTERNS` array below to match.
# ════════════════════════════════════════════════════════════════════════════

set -uo pipefail

MODE="${1:-}"

# Reserved terms — keep in sync with docs/glossary.md "RESERVED TERMS".
# Word-boundary anchored so "GLE" doesn't match "single" or "google".
RESERVED_PATTERNS=(
  '\bGLE\b'
  '\bGLR\b'
  '\bIXF\b'
  '\bMXF\b'
  '\bCEC\b'
  '\bGCM3?4?\b'
  '\bTAF\b'
  '\bPPH\b'
  'Pattern Slider'
  'Cool ?Catch'
  'Pattern-CL'
  'Wheel ?of ?Fortune'
  'Fort ?Knox'
  'MegaJackpots'
  'Cash ?Eruption'
  'Cash ?Link'
  'Spaghetti ?rendering'
  'BigBass'
  'ColossalWin'
  '@foundry/'
  '@igt/'
  'gc_load'
  'load_gc_'
  'BaseGameReelSetSelect'
  'WheelBonus\.wheelPointer'
  'CashLink[0-9]+'
  'JSTAFService'
  '/api/startGame'
  'playadev\.com'
  'gsdev02'
  '\bGameFlow ?FSM\b'
)

WHITELIST=(
  'docs/glossary.md'
  'docs/IP_REVIEW.md'
  'scripts/check-reserved-terms.sh'
  'docs/W152/'
  'docs/research.md'
  'SLOT_ENGINE_MASTER_TODO.md'
)

is_whitelisted() {
  local f="$1"
  for w in "${WHITELIST[@]}"; do
    if [[ "$f" == *"$w"* ]]; then return 0; fi
  done
  return 1
}

# Build the OR pattern once.
JOINED_PATTERN=""
for p in "${RESERVED_PATTERNS[@]}"; do
  if [[ -z "$JOINED_PATTERN" ]]; then
    JOINED_PATTERN="$p"
  else
    JOINED_PATTERN="$JOINED_PATTERN|$p"
  fi
done

# ── Collect target files ─────────────────────────────────────────────────────
TARGETS=()
case "$MODE" in
  '' | --staged)
    while IFS= read -r f; do
      [[ -n "$f" ]] && TARGETS+=("$f")
    done < <(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)
    ;;
  --all)
    while IFS= read -r f; do
      [[ -n "$f" ]] && TARGETS+=("$f")
    done < <(git ls-files 2>/dev/null)
    ;;
  --files)
    shift
    TARGETS=("$@")
    ;;
  *)
    echo "Usage: $0 [--staged | --all | --files <paths...>]" >&2
    exit 2
    ;;
esac

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  echo "check-reserved-terms.sh: no target files (mode=${MODE:---staged}) — skipping."
  exit 0
fi

# ── Scan ────────────────────────────────────────────────────────────────────
HITS=0
MATCHED_FILES=()

for f in "${TARGETS[@]}"; do
  [[ ! -f "$f" ]] && continue
  if is_whitelisted "$f"; then continue; fi
  # Use `grep -E -i -n` for extended regex + case-insensitive + line numbers.
  # Pipe to `head` to limit per-file output flood.
  matches=$(grep -E -i -n -- "$JOINED_PATTERN" "$f" 2>/dev/null | head -10 || true)
  if [[ -n "$matches" ]]; then
    HITS=$((HITS + 1))
    MATCHED_FILES+=("$f")
    echo ""
    echo "❌ $f — reserved term(s) found:"
    echo "$matches" | sed 's/^/   /'
  fi
done

echo ""
if [[ $HITS -eq 0 ]]; then
  echo "✅ check-reserved-terms.sh: 0 matches across ${#TARGETS[@]} file(s)"
  exit 0
fi

echo "❌ check-reserved-terms.sh: ${#MATCHED_FILES[@]} file(s) violate reserved-terms policy."
echo "   See docs/glossary.md (RESERVED TERMS section) for the canonical equivalents."
echo "   See docs/IP_REVIEW.md for the policy rationale."
exit 1
