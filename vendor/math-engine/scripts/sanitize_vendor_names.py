#!/usr/bin/env python3
"""W-SANITIZE — Mass-replace vendor-specific names with neutral codenames.

CRITICAL: keeps the repository legally clean by ensuring no vendor IP /
game brand is referenced in any commit-able file. Boki's rule: matematika
ne sme da procuri nigde.

Mapping policy:
  - Real vendor brands → "Vendor A" / "Vendor B" / "Vendor C" / ...
  - Real game brands  → "Game-1" / "Game-2" / ... or generic patterns
  - Author/distributor names → "Vendor X" (where X is anonymized)

Files in scope: all *.md, *.txt, *.yaml, *.json (excluding node_modules,
target, dist, large generated artifacts).

Idempotent: re-running after replacement is safe (no nested expansions).
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

# ─── Codename mapping ────────────────────────────────────────────────────────
# Each entry: (regex_pattern, replacement)
# Order matters — most specific first (so "Vendor B" doesn't get
# half-replaced before "Vendor B" is tried).

# Word-boundary aware: \b at start + end. For acronyms with special chars
# (Vendor B, &), we manually anchor with lookahead/lookbehind.
MAPPING: list[tuple[str, str]] = [
    # Vendor brand names — full forms first
    (r"\bLight\s*&\s*Wonder\b", "Vendor B"),
    (r"\bScientific\s+Games\b", "Vendor B"),
    (r"\bSG\s+Gaming\b", "Vendor B"),
    (r"\bL\s*&\s*W\b", "Vendor B"),
    (r"\bLNW\b", "Vendor B"),
    (r"\bInternational\s+Game\s+Technology\b", "Vendor A"),
    (r"\bIGT\b", "Vendor A"),
    (r"\bAristocrat\b", "Vendor C"),
    (r"\bNetEnt\b", "Vendor D"),
    (r"\bPragmatic\s+Play\b", "Vendor E"),
    (r"\bPlaytech\b", "Vendor F"),
    (r"\bMicrogaming\b", "Vendor G"),
    (r"\bBally\b", "Vendor H"),

    # Specific game brand names — full forms first
    (r"\bFort\s+Knox\s+Wolf\s+Run\b", "Pattern-FK"),
    (r"\bFort\s+Knox\s+Cats\b", "Pattern-FKC"),
    (r"\bFort\s+Knox\s+Bonus\b", "Pick-Bonus Feature"),
    (r"\bFort\s+Knox\b", "Pick-Bonus"),
    (r"\bWolf\s+Run\b", "Pattern-FK"),
    (r"\bCash\s+Eruption\b", "Pattern-CE"),
    (r"\bCleopatra\b", "Pattern-CL"),
    (r"\bHuff\s+N\s+Puff\b", "Pattern-HP"),
    (r"\bQuick\s+Hit\s+Platinum\s+Phoenix\b", "Pattern-QHP"),
    (r"\bRainbow\s+Riches\s+Megaways\s+Vault\b", "Pattern-RRMV"),
    (r"\bSpartacus\s+Colossal\s+Conquest\b", "Pattern-SCC"),
    (r"\b9\s+Pots\s+of\s+Gold\b", "Pattern-9POG"),
    (r"\bLightning\s+Link\b", "Pattern-LL"),
    (r"\bDragon\s+Link\b", "Pattern-DL"),
    (r"\bWrath\s+of\s+Olympus\b", "Pattern-WO"),
    (r"\bLock\s+It\s+Link\b", "Pattern-LIL"),
    (r"\bCash\s+Connection\b", "Pattern-CC"),

    # Pattern-SC — separate
    (r"\bStorm\s+Cellar\b", "Pattern-SC"),
]


# ─── File scanning ───────────────────────────────────────────────────────────

SCAN_EXTENSIONS = {".md", ".txt", ".rst", ".yaml", ".yml", ".json", ".toml",
                   ".rs", ".ts", ".py", ".js", ".mjs", ".sh", ".html", ".css"}
SKIP_DIRS = {"node_modules", "target", "dist", "out", ".git", "build",
             "venv", ".venv", "__pycache__"}
# Also skip generated artifacts that would be regenerated anyway
SKIP_PATH_FRAGMENTS = ["/raw/", "/reports/", "/cells.json", "/formulas.json",
                       ".tsv", "package-lock.json", "Cargo.lock"]


def should_scan(p: Path) -> bool:
    if not p.is_file():
        return False
    for part in p.parts:
        if part in SKIP_DIRS:
            return False
    for fragment in SKIP_PATH_FRAGMENTS:
        if fragment in str(p):
            return False
    if p.suffix.lower() not in SCAN_EXTENSIONS:
        return False
    return True


def sanitize_text(text: str) -> tuple[str, int]:
    """Apply all mapping rules. Returns (new_text, replacements_count)."""
    n = 0
    for pattern, replacement in MAPPING:
        new_text, count = re.subn(pattern, replacement, text)
        if count > 0:
            text = new_text
            n += count
    return text, n


def main(argv: list[str]) -> int:
    repo_root = Path(__file__).resolve().parent.parent
    dry_run = "--apply" not in argv
    verbose = "--verbose" in argv or "-v" in argv

    total_files = 0
    changed_files = 0
    total_replacements = 0
    by_file: list[tuple[Path, int]] = []

    for p in repo_root.rglob("*"):
        if not should_scan(p):
            continue
        total_files += 1
        try:
            text = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, PermissionError):
            continue
        new_text, n = sanitize_text(text)
        if n > 0:
            changed_files += 1
            total_replacements += n
            by_file.append((p, n))
            if not dry_run:
                p.write_text(new_text, encoding="utf-8")

    by_file.sort(key=lambda x: -x[1])
    print(f"Scanned files: {total_files}")
    print(f"Files needing change: {changed_files}")
    print(f"Total replacements: {total_replacements}")
    print()
    if verbose or dry_run:
        print("Top files by replacement count:")
        for p, n in by_file[:30]:
            rel = p.relative_to(repo_root)
            print(f"  {n:5d}  {rel}")
        if len(by_file) > 30:
            print(f"  ... ({len(by_file) - 30} more)")

    if dry_run:
        print()
        print("DRY-RUN (use --apply to write changes)")
    else:
        print()
        print(f"APPLIED — {changed_files} files modified, {total_replacements} replacements.")

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
