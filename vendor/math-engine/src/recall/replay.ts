/**
 * Replay — verify a journal entry by re-running the engine and
 * matching the produced result against what's stored.
 *
 * Pure verification path: build a fresh RNG from `rng_seed_hex`, advance
 * by `rng_step`, run the engine, compare numeric fields and the
 * feature-trace hash. Any mismatch returns a structured failure.
 *
 * The engine driver is deliberately abstract — `replaySpin` takes a
 * callback that knows how to drive one spin given (state, rng). That
 * keeps this module independent of which evaluator the caller chose
 * and lets tests inject a deterministic stub.
 */

import { canonicalJson, sha256Hex } from './integrity.js';
import type { ReplayResult, SpinJournalEntry, SpinResultSummary } from './types.js';
import { RECALL_SCHEMA_VERSION } from './types.js';

/**
 * Driver contract: caller wires the actual engine evaluation. Returns
 * the canonical `SpinResultSummary` *and* the structured feature trace
 * that hashes into `feature_trace_hash`.
 */
export type ReplayDriver = (entry: SpinJournalEntry) => {
  summary: SpinResultSummary;
  feature_trace: unknown;
};

export interface ReplayOptions {
  /** Caller-supplied current engine version. Mismatch (major.minor) is
   * a hard fail; patch differences are accepted because they're
   * semver-promised to be backward-compatible. */
  engine_version: string;
  /** Pre-computed canonical IR hash. Replay refuses if the journal's
   * `config_hash` differs from the IR the caller is replaying against. */
  expected_config_hash: string;
  /** Tolerance for cross-version replay. Default `false` — major OR
   * minor mismatch refuses to replay (audit-safe). */
  allow_minor_drift?: boolean;
}

export function replaySpin(
  entry: SpinJournalEntry,
  driver: ReplayDriver,
  opts: ReplayOptions,
): ReplayResult {
  if (entry.schema_version !== RECALL_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: 'invalid_entry',
      detail: `schema_version ${entry.schema_version} != ${RECALL_SCHEMA_VERSION}`,
    };
  }
  if (entry.config_hash !== opts.expected_config_hash) {
    return {
      ok: false,
      reason: 'config_hash_mismatch',
      detail: `entry.config_hash=${entry.config_hash} expected=${opts.expected_config_hash}`,
    };
  }
  if (!versionCompatible(entry.engine_version, opts.engine_version, opts.allow_minor_drift ?? false)) {
    return {
      ok: false,
      reason: 'version_mismatch',
      detail: `journal engine_version=${entry.engine_version} runtime=${opts.engine_version}`,
    };
  }

  let actual;
  try {
    actual = driver(entry);
  } catch (err) {
    return {
      ok: false,
      reason: 'engine_error',
      detail: (err as Error).message ?? String(err),
    };
  }

  const trace_hash = sha256Hex(canonicalJson(actual.feature_trace));
  if (trace_hash !== entry.result.feature_trace_hash) {
    return {
      ok: false,
      reason: 'result_mismatch',
      detail: `feature_trace_hash diverged: actual=${trace_hash}, stored=${entry.result.feature_trace_hash}`,
    };
  }

  const mismatches = diffSummary(entry.result, actual.summary);
  if (mismatches.length > 0) {
    return {
      ok: false,
      reason: 'result_mismatch',
      detail: mismatches.join('; '),
    };
  }
  return {
    ok: true,
    entry,
    verified_at_utc: new Date().toISOString(),
  };
}

function versionCompatible(journalVer: string, runtimeVer: string, allowMinorDrift: boolean): boolean {
  if (journalVer === runtimeVer) return true;
  const [jMaj, jMin] = journalVer.split('.').map((n) => parseInt(n, 10));
  const [rMaj, rMin] = runtimeVer.split('.').map((n) => parseInt(n, 10));
  if (!Number.isFinite(jMaj) || !Number.isFinite(rMaj)) return false;
  if (jMaj !== rMaj) return false;
  if (jMin !== rMin && !allowMinorDrift) return false;
  return true;
}

function diffSummary(a: SpinResultSummary, b: SpinResultSummary): string[] {
  const out: string[] = [];
  if (a.total_win_mc !== b.total_win_mc) {
    out.push(`total_win_mc: stored=${a.total_win_mc}, replay=${b.total_win_mc}`);
  }
  if (a.line_wins_count !== b.line_wins_count) {
    out.push(`line_wins_count: stored=${a.line_wins_count}, replay=${b.line_wins_count}`);
  }
  if (a.scatter_count !== b.scatter_count) {
    out.push(`scatter_count: stored=${a.scatter_count}, replay=${b.scatter_count}`);
  }
  if (a.bonus_count !== b.bonus_count) {
    out.push(`bonus_count: stored=${a.bonus_count}, replay=${b.bonus_count}`);
  }
  if (canonicalJson(a.triggered_features) !== canonicalJson(b.triggered_features)) {
    out.push(
      `triggered_features: stored=${JSON.stringify(a.triggered_features)}, replay=${JSON.stringify(b.triggered_features)}`,
    );
  }
  return out;
}
