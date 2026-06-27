#!/usr/bin/env bash
#
# CORTI W206-PERSISTENCE — Postgres backup.
#
# Usage:  bash scripts/db-backup.sh [output-dir]
#
# Reads DATABASE_URL (or PGHOST / PGUSER / PGPASSWORD / PGDATABASE
# component env vars). Writes a timestamped pg_dump file:
#     <out>/sme-<YYYYMMDDHHMMSS>.dump
# Output is `pg_dump -Fc` (custom format) so `pg_restore` can do
# parallel restore later. Encryption / S3 upload are placeholders;
# wire them to your real KMS / object store in production.

set -euo pipefail

OUT_DIR="${1:-backups}"
mkdir -p "${OUT_DIR}"

TS="$(date +%Y%m%d%H%M%S)"
DEST="${OUT_DIR}/sme-${TS}.dump"

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "[db-backup] using DATABASE_URL"
  pg_dump --format=custom --no-owner --no-privileges \
    --file="${DEST}" "${DATABASE_URL}"
else
  echo "[db-backup] using PGHOST/PGUSER/PGDATABASE env vars"
  pg_dump --format=custom --no-owner --no-privileges \
    --host="${PGHOST:-localhost}" \
    --port="${PGPORT:-5432}" \
    --username="${PGUSER:-postgres}" \
    --dbname="${PGDATABASE:-sme}" \
    --file="${DEST}"
fi

# Placeholder: encrypt at rest.
# gpg --symmetric --batch --passphrase "${BACKUP_PASSPHRASE}" "${DEST}"

# Placeholder: upload to S3.
# aws s3 cp "${DEST}.gpg" "s3://${BACKUP_BUCKET}/sme/${TS}.dump.gpg"

BYTES="$(wc -c <"${DEST}" | tr -d ' ')"
echo "[db-backup] ok  ${DEST}  ${BYTES} bytes"
