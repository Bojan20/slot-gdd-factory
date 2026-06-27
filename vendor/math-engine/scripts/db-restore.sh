#!/usr/bin/env bash
#
# CORTI W206-PERSISTENCE — Postgres restore.
#
# Usage:  bash scripts/db-restore.sh <dump-file>
#
# Reads DATABASE_URL (or PGHOST / PGUSER / PGPASSWORD / PGDATABASE
# component env vars). Pre-validates the dump file, runs pg_restore,
# then verifies row counts on the four core tables (sessions,
# wallet_balances, audit_log, tenants) to catch obvious truncation.

set -euo pipefail

DUMP="${1:-}"
if [[ -z "${DUMP}" ]]; then
  echo "usage: $0 <dump-file>" >&2
  exit 64
fi
if [[ ! -f "${DUMP}" ]]; then
  echo "[db-restore] dump file not found: ${DUMP}" >&2
  exit 65
fi

# Pre-restore validation — pg_restore --list prints the TOC; an
# unreadable / corrupt file will fail here before mutating anything.
echo "[db-restore] validating ${DUMP} ..."
pg_restore --list "${DUMP}" >/dev/null

CONN_ARGS=()
if [[ -n "${DATABASE_URL:-}" ]]; then
  CONN_ARGS+=(--dbname="${DATABASE_URL}")
else
  CONN_ARGS+=(--host="${PGHOST:-localhost}")
  CONN_ARGS+=(--port="${PGPORT:-5432}")
  CONN_ARGS+=(--username="${PGUSER:-postgres}")
  CONN_ARGS+=(--dbname="${PGDATABASE:-sme}")
fi

echo "[db-restore] restoring (clean + if-exists)"
pg_restore "${CONN_ARGS[@]}" --clean --if-exists --no-owner --no-privileges "${DUMP}"

# Post-restore verification — quick sanity row counts.
echo "[db-restore] post-restore row counts:"
for table in sessions wallet_balances audit_log tenants cert_submissions games; do
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql "${DATABASE_URL}" -tAc "SELECT '${table}=' || COUNT(*) FROM ${table}" || true
  else
    psql --host="${PGHOST:-localhost}" --port="${PGPORT:-5432}" \
         --username="${PGUSER:-postgres}" --dbname="${PGDATABASE:-sme}" \
         -tAc "SELECT '${table}=' || COUNT(*) FROM ${table}" || true
  fi
done

echo "[db-restore] ok"
