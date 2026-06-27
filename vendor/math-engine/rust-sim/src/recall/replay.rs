//! Replay — Rust mirror of `src/recall/replay.ts`.

use super::integrity::{canonical_json, sha256_hex};
use super::types::*;
use serde_json::Value;

pub struct ReplayOptions<'a> {
    pub engine_version: &'a str,
    pub expected_config_hash: &'a str,
    pub allow_minor_drift: bool,
}

pub struct DriverOutput {
    pub summary: SpinResultSummary,
    pub feature_trace: Value,
}

/// Driver contract: caller wires the actual engine. Returns the
/// canonical `SpinResultSummary` plus the structured feature trace
/// whose canonical-JSON hash must match `entry.result.feature_trace_hash`.
pub type ReplayDriver<'a> = dyn Fn(&SpinJournalEntry) -> Result<DriverOutput, String> + 'a;

pub fn replay_spin(
    entry: &SpinJournalEntry,
    driver: &ReplayDriver,
    opts: &ReplayOptions,
) -> ReplayResult {
    if entry.schema_version != RECALL_SCHEMA_VERSION {
        return err(ReplayFailure::InvalidEntry {
            detail: format!(
                "schema_version {} != {}",
                entry.schema_version, RECALL_SCHEMA_VERSION
            ),
        });
    }
    if entry.config_hash != opts.expected_config_hash {
        return err(ReplayFailure::ConfigHashMismatch {
            detail: format!(
                "entry.config_hash={} expected={}",
                entry.config_hash, opts.expected_config_hash
            ),
        });
    }
    if !version_compatible(
        &entry.engine_version,
        opts.engine_version,
        opts.allow_minor_drift,
    ) {
        return err(ReplayFailure::VersionMismatch {
            detail: format!(
                "journal engine_version={} runtime={}",
                entry.engine_version, opts.engine_version
            ),
        });
    }

    let actual = match driver(entry) {
        Ok(o) => o,
        Err(msg) => return err(ReplayFailure::EngineError { detail: msg }),
    };

    let trace_hash = sha256_hex(&canonical_json(&actual.feature_trace));
    if trace_hash != entry.result.feature_trace_hash {
        return err(ReplayFailure::ResultMismatch {
            detail: format!(
                "feature_trace_hash diverged: actual={}, stored={}",
                trace_hash, entry.result.feature_trace_hash
            ),
        });
    }
    let mismatches = diff_summary(&entry.result, &actual.summary);
    if !mismatches.is_empty() {
        return err(ReplayFailure::ResultMismatch {
            detail: mismatches.join("; "),
        });
    }
    ReplayResult::Ok {
        ok: true,
        entry: entry.clone(),
        verified_at_utc: timestamp_now(),
    }
}

fn err(failure: ReplayFailure) -> ReplayResult {
    ReplayResult::Err { ok: false, failure }
}

fn version_compatible(journal: &str, runtime: &str, allow_minor_drift: bool) -> bool {
    if journal == runtime {
        return true;
    }
    let parse = |s: &str| -> Option<(u32, u32)> {
        let mut it = s.split('.');
        Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?))
    };
    let (j_maj, j_min) = match parse(journal) {
        Some(v) => v,
        None => return false,
    };
    let (r_maj, r_min) = match parse(runtime) {
        Some(v) => v,
        None => return false,
    };
    if j_maj != r_maj {
        return false;
    }
    if j_min != r_min && !allow_minor_drift {
        return false;
    }
    true
}

fn diff_summary(a: &SpinResultSummary, b: &SpinResultSummary) -> Vec<String> {
    let mut out = Vec::new();
    if a.total_win_mc != b.total_win_mc {
        out.push(format!(
            "total_win_mc: stored={}, replay={}",
            a.total_win_mc, b.total_win_mc
        ));
    }
    if a.line_wins_count != b.line_wins_count {
        out.push(format!(
            "line_wins_count: stored={}, replay={}",
            a.line_wins_count, b.line_wins_count
        ));
    }
    if a.scatter_count != b.scatter_count {
        out.push(format!(
            "scatter_count: stored={}, replay={}",
            a.scatter_count, b.scatter_count
        ));
    }
    if a.bonus_count != b.bonus_count {
        out.push(format!(
            "bonus_count: stored={}, replay={}",
            a.bonus_count, b.bonus_count
        ));
    }
    if a.triggered_features != b.triggered_features {
        out.push(format!(
            "triggered_features: stored={:?}, replay={:?}",
            a.triggered_features, b.triggered_features
        ));
    }
    out
}

fn timestamp_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Coarse ISO8601 to stay parser-compatible with TS — full date math
    // belongs in a dedicated time module if we ever need calendar-aware
    // values in the replay path.
    format!("epoch-{secs}")
}
