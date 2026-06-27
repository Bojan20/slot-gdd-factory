#!/usr/bin/env bash
# W152 P0-4 — Build a complete GLI-19 lab submission bundle.
#
# Wraps the `rng_submission` binary, adds the source tarball + git SHA +
# README, and zips the whole thing for upload to BMM / GLI / iTechLabs.
#
# Usage:
#   scripts/cert-bundle.sh                          # defaults → reports/cert-bundle-<sha>/
#   scripts/cert-bundle.sh --out reports/lab-2026   # custom output dir
#   scripts/cert-bundle.sh --quick                  # 1 MiB per backend (smoke)
#   scripts/cert-bundle.sh --bytes-per 33554432     # 32 MiB per backend
#
# Inputs:
#   - cargo (release-built rng_submission binary)
#   - git (HEAD sha for traceability)
#   - shasum (macOS) or sha256sum (linux) — auto-detected
#   - tar (source tarball)
#   - zip (final bundle archive)
#
# Exit codes:
#   0 — bundle written
#   2 — missing tool
#   3 — rng_submission binary failed
#   4 — verification step failed

set -euo pipefail

# ─── Tool detection ──────────────────────────────────────────────────────────

if command -v shasum >/dev/null 2>&1; then
  SHA256_CMD="shasum -a 256"
  SHA256_CHECK="shasum -a 256 -c"
elif command -v sha256sum >/dev/null 2>&1; then
  SHA256_CMD="sha256sum"
  SHA256_CHECK="sha256sum -c"
else
  echo "FATAL: neither shasum nor sha256sum found in PATH." >&2
  exit 2
fi

for tool in cargo git tar zip; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "FATAL: required tool '$tool' not in PATH." >&2
    exit 2
  fi
done

# ─── Args ────────────────────────────────────────────────────────────────────

OUT=""
BYTES_PER=12582912  # 12 MiB = 96 Mbit (GLI minimum)
QUICK=0

while [ $# -gt 0 ]; do
  case "$1" in
    --out)        OUT="$2"; shift 2 ;;
    --bytes-per)  BYTES_PER="$2"; shift 2 ;;
    --quick)      QUICK=1; BYTES_PER=$((1024 * 1024)); shift ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$REPO_ROOT"

GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_FULL_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

if [ -z "$OUT" ]; then
  OUT="reports/cert-bundle-${GIT_SHA}"
fi

# Make OUT absolute so commands run from sub-shells still resolve it.
case "$OUT" in
  /*) ABS_OUT="$OUT" ;;
  *)  ABS_OUT="$REPO_ROOT/$OUT" ;;
esac

mkdir -p "$ABS_OUT"

# ─── Build rng_submission (release) ──────────────────────────────────────────

echo "[cert-bundle] building rng_submission (release)..."
(cd rust-sim && cargo build --release --bin rng_submission --quiet) || {
  echo "FATAL: cargo build failed." >&2
  exit 3
}

# Workspace target/ lives at repo root (cargo workspace convention).
BIN="$REPO_ROOT/target/release/rng_submission"
if [ ! -x "$BIN" ]; then
  echo "FATAL: built binary not found at $BIN" >&2
  exit 3
fi

# ─── Run rng_submission ──────────────────────────────────────────────────────

echo "[cert-bundle] generating raw RNG dumps (${BYTES_PER} bytes each)..."
"$BIN" --out "$ABS_OUT" --bytes-per "$BYTES_PER" || {
  echo "FATAL: rng_submission failed" >&2
  exit 3
}

# ─── Verify manifest digest ──────────────────────────────────────────────────

echo "[cert-bundle] verifying manifest sha256..."
(cd "$ABS_OUT" && $SHA256_CHECK manifest.sha256) >/dev/null || {
  echo "FATAL: manifest.json digest mismatch — bundle compromised." >&2
  exit 4
}

# ─── Source tarball ──────────────────────────────────────────────────────────

echo "[cert-bundle] capturing source tarball (git archive)..."
git archive --format=tar.gz --prefix="slot-math-${GIT_SHA}/" \
  --output="$ABS_OUT/source-${GIT_SHA}.tar.gz" HEAD || {
  echo "FATAL: git archive failed" >&2
  exit 3
}

# Digest the tarball too.
TAR_SHA=$($SHA256_CMD "$ABS_OUT/source-${GIT_SHA}.tar.gz" | awk '{print $1}')

# ─── README ──────────────────────────────────────────────────────────────────

cat > "$ABS_OUT/README.md" <<README
# RNG Certification Bundle — W152 P0-4

* **Git SHA**: \`${GIT_FULL_SHA}\`
* **Generated**: $(date -u +%Y-%m-%dT%H:%M:%SZ)
* **Bytes per backend**: ${BYTES_PER}
* **Backends**: mulberry32, pcg64, xoshiro256ss, philox4x32, **chacha20** (CSPRNG)

## Files

| File | Purpose |
|---|---|
| \`manifest.json\` | Per-backend metadata: seed, byte count, sha256, throughput, hardware |
| \`manifest.sha256\` | Tamper-evident digest of \`manifest.json\` |
| \`hardware.json\` | Host OS / arch / CPU / rustc version |
| \`*-${BYTES_PER}-byte dumps\` | Raw entropy streams (one per backend) |
| \`source-${GIT_SHA}.tar.gz\` | Full repo snapshot at HEAD (sha256: \`${TAR_SHA}\`) |

## How the lab consumes this

\`\`\`bash
# 1. Verify the manifest hasn't been tampered with.
$SHA256_CHECK manifest.sha256

# 2. Spot-check each backend's bytes.
$SHA256_CMD pcg64-*.bin
# Compare against the value in manifest.json[].sha256

# 3. Run BigCrush / PractRand / NIST STS on each .bin
RNG_test stdin64 < pcg64-12MiB.bin           # PractRand
testu01 BigCrush pcg64-12MiB.bin             # TestU01 (custom wrapper)
assess 1000000 < pcg64-12MiB.bin             # NIST STS

# 4. Verify deterministic replay from source.
tar xzf source-${GIT_SHA}.tar.gz
cd slot-math-${GIT_SHA}
cargo run --release --bin rng_submission -- --out replica --bytes-per ${BYTES_PER}
diff <(sha256sum replica/*.bin) <(sha256sum ../*.bin)  # must match
\`\`\`

## Jurisdiction mapping

| Backend | UK | MGA | ADM | AGCO | PGCB | NJ DGE |
|---|---|---|---|---|---|---|
| \`chacha20\` | ✅ primary (RTS 7) | ✅ primary (Art. 11) | ✅ secondary | ✅ | ✅ | ✅ |
| \`pcg64\` | ⚠️ non-crypto | ⚠️ non-crypto | ✅ | ⚠️ | ✅ | ✅ |
| \`xoshiro256ss\` | ⚠️ | ⚠️ | ✅ | ⚠️ | ✅ | ✅ |
| \`philox4x32\` | ⚠️ | ⚠️ | ✅ GPU only | ⚠️ | ✅ | ✅ |
| \`mulberry32\` | ❌ legacy | ❌ legacy | ❌ | ❌ | ❌ | ❌ |

\`chacha20\` MUST be used when the jurisdiction profile demands a CSPRNG
(see \`rust-sim/src/jurisdiction/profiles.rs\` for the canonical list).

## Re-run / verify locally

\`\`\`bash
git checkout ${GIT_FULL_SHA}
scripts/cert-bundle.sh --bytes-per ${BYTES_PER} --out /tmp/replica
diff -r /tmp/replica $ABS_OUT  # only README + tarball name differ (timestamps)
\`\`\`
README

# ─── Final ZIP ───────────────────────────────────────────────────────────────

BUNDLE_NAME="slot-math-rng-cert-${GIT_SHA}-${BYTES_PER}bpc.zip"
BUNDLE_PATH="$REPO_ROOT/reports/${BUNDLE_NAME}"

echo "[cert-bundle] zipping → ${BUNDLE_PATH}..."
mkdir -p "$REPO_ROOT/reports"
(cd "$(dirname "$ABS_OUT")" && zip -qr "$BUNDLE_PATH" "$(basename "$ABS_OUT")")

echo "[cert-bundle] ─── DONE ───"
echo "  Output dir : $ABS_OUT"
echo "  Bundle ZIP : $BUNDLE_PATH"
echo "  Git SHA    : $GIT_FULL_SHA"
echo "  Manifest   : $(cat "$ABS_OUT/manifest.sha256" | awk '{print $1}')"
