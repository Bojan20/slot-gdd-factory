#!/usr/bin/env node
/**
 * tools/kernel-audit-logger.mjs
 *
 * N4 (2026-06-23) — Rolling kernel-call observability log.
 *
 * Opt-in JSONL append-only logger called from inside callKernel().
 * Activated by env `KERNEL_AUDIT_LOG=1`. Captures per-call:
 *   - timestamp (ISO)
 *   - kernel name
 *   - params hash (sha256 first 12 chars — privacy + dedup)
 *   - ok (boolean) + engineMode (python-kernel / unavailable / error)
 *   - latencyMs
 *   - errorReason (truncated to 200 chars when failed)
 *
 * ## Why
 * Bridge cache makes individual calls instant, but operators still
 * need visibility into "which kernels are exercised, how often, with
 * what error rate, against which param shapes". Black-box flight
 * recorder is the standard ops pattern.
 *
 * ## Design contract
 *   - NEVER BLOCKS: write is fire-and-forget (fs.appendFile no-await
 *     + error swallowed locally) so a disk hiccup never breaks a
 *     kernel call.
 *   - OPT-IN: zero cost when env not set — no file open, no string
 *     building, no JSON.stringify. Hot-path guard is one env check.
 *   - PRIVACY: params themselves are NEVER logged — only sha256(first
 *     12) hash. Operators can correlate same-input calls without
 *     exposing PII / proprietary math params.
 *   - ROLLING: daily file (`audit-YYYY-MM-DD.jsonl`). Old files are
 *     pruned by `pruneOldAuditFiles(retentionDays)` (called by the
 *     aggregator, not the logger — separation of concerns).
 *
 * ## USAGE (from callKernel)
 *   import { isAuditEnabled, logKernelCall } from './kernel-audit-logger.mjs';
 *   if (isAuditEnabled()) {
 *     logKernelCall({ kernel, params, ok, engineMode, latencyMs, errorReason });
 *   }
 *
 * ## EXPORTS
 *   isAuditEnabled()         → boolean from env flag
 *   logKernelCall(event)     → void, never-throws
 *   hashParams(obj)          → 12-char hex (deterministic)
 *   getAuditDir()            → path to reports/kernel-audit/
 *   currentAuditFilePath()   → today's audit file path
 *   pruneOldAuditFiles(days) → housekeeping (called by aggregator)
 */

import { appendFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const AUDIT_DIR  = join(REPO, 'reports/kernel-audit');

const ENV_FLAG = 'KERNEL_AUDIT_LOG';

export function isAuditEnabled() {
  const v = process.env[ENV_FLAG];
  return v === '1' || v === 'true';
}

export function getAuditDir() {
  return AUDIT_DIR;
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

export function currentAuditFilePath() {
  return join(AUDIT_DIR, `audit-${todayStamp()}.jsonl`);
}

/**
 * Deterministic 12-hex-char hash of arbitrary JSON-serialisable input.
 * Stable across re-runs for the same input shape.
 */
export function hashParams(obj) {
  let serialised;
  try { serialised = JSON.stringify(obj, Object.keys(obj || {}).sort()); }
  catch { serialised = String(obj); }
  return createHash('sha256').update(serialised).digest('hex').slice(0, 12);
}

/**
 * Append one event to today's audit JSONL file. Never-throws,
 * fire-and-forget. Returns the queued promise for test inspection
 * (callers don't need to await).
 */
export function logKernelCall(event = {}) {
  try {
    if (!existsSync(AUDIT_DIR)) mkdirSync(AUDIT_DIR, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      kernel:       event.kernel ?? 'unknown',
      paramsHash:   hashParams(event.params ?? {}),
      ok:           !!event.ok,
      engineMode:   event.engineMode ?? 'unknown',
      latencyMs:    Number.isFinite(event.latencyMs) ? +event.latencyMs.toFixed(2) : null,
      errorReason:  event.errorReason ? String(event.errorReason).slice(0, 200) : null,
    }) + '\n';
    /* Fire-and-forget — swallow EBUSY / EACCES so the caller continues. */
    return appendFile(currentAuditFilePath(), line, 'utf8').catch(() => {});
  } catch {
    /* swallow — observability must never break the hot path */
    return Promise.resolve();
  }
}

/**
 * Delete audit files older than `retentionDays`. Returns the list of
 * files removed (for the aggregator's stdout report).
 */
export async function pruneOldAuditFiles(retentionDays = 14) {
  if (!existsSync(AUDIT_DIR)) return [];
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const removed = [];
  let entries;
  try { entries = await readdir(AUDIT_DIR); }
  catch { return removed; }
  for (const name of entries) {
    const m = name.match(/^audit-(\d{4}-\d{2}-\d{2})\.jsonl$/);
    if (!m) continue;
    const fileMs = Date.parse(m[1] + 'T00:00:00Z');
    if (Number.isFinite(fileMs) && fileMs < cutoffMs) {
      try { await unlink(join(AUDIT_DIR, name)); removed.push(name); }
      catch { /* swallow */ }
    }
  }
  return removed;
}

/* ── CLI (debug helpers) ──────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('kernel-audit-logger.mjs')) {
  const cmd = process.argv[2];
  if (cmd === 'enabled') {
    console.log(JSON.stringify({ enabled: isAuditEnabled(), envFlag: ENV_FLAG,
      file: currentAuditFilePath() }, null, 2));
    process.exit(0);
  }
  if (cmd === 'hash') {
    const raw = process.argv[3] || '{}';
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { console.error('bad JSON:', e.message); process.exit(2); }
    console.log(hashParams(parsed));
    process.exit(0);
  }
  if (cmd === 'prune') {
    const days = parseInt(process.argv[3] || '14', 10);
    pruneOldAuditFiles(days).then(removed => {
      console.log(JSON.stringify({ retentionDays: days, removed }, null, 2));
    });
  } else {
    console.error('Usage: kernel-audit-logger.mjs <enabled|hash JSON|prune [days]>');
    process.exit(2);
  }
}
