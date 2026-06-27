//! Wire types for the cluster coordinator ↔ worker protocol.
//!
//! All envelopes are JSON discriminated by `kind`. New variants are
//! additive — older workers ignore unknown kinds. Breaking changes bump
//! `CLUSTER_PROTOCOL_VERSION` (semver, exchanged on handshake so the
//! coordinator can refuse incompatible workers loudly).

use serde::{Deserialize, Serialize};

pub const CLUSTER_PROTOCOL_VERSION: &str = "1.0.0";

/// One disjoint chunk of the total run, handed to a worker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkSlice {
    /// 0-based slice index. Used as a seed mix-in so each slice's
    /// per-spin RNG sequence is deterministic.
    pub slice_index: u64,
    /// Spin offset where this slice starts (inclusive).
    pub start_spin: u64,
    /// Spin offset where this slice ends (exclusive).
    pub end_spin: u64,
    /// Run-wide base seed; combined with `slice_index` and worker
    /// offsets to derive the per-spin RNG seed.
    pub base_seed: u64,
    /// Bulk dispatcher chunk size — pinned by coordinator so all slices
    /// agree on internal chunking.
    pub chunk_spins: u64,
    /// Total bet in millicredits.
    pub total_bet_mc: i64,
    /// Config hash the worker must match before accepting work.
    pub config_hash: String,
}

impl WorkSlice {
    pub fn span(&self) -> u64 {
        self.end_spin.saturating_sub(self.start_spin)
    }
}

/// Sent by the worker on connect.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkerHello {
    pub protocol_version: String,
    pub worker_id: String,
    /// Reported max throughput (spins/sec) from the worker's last
    /// benchmark — coordinator uses this for proportional partitioning.
    pub benchmark_spins_per_sec: f64,
    /// Hardware notes for the audit trail (e.g. "M3 Pro 11/14",
    /// "EPYC 9654 96c"). Free-form; not parsed.
    pub hardware_notes: String,
}

/// Progress tick — workers emit one per chunk. Coordinator aggregates
/// for the global progress bar.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProgressFrame {
    pub worker_id: String,
    pub slice_index: u64,
    pub completed_spins: u64,
    pub spins_per_sec: f64,
}

/// Final result sent by a worker when its slice finishes. The
/// `stats_snapshot` mirrors `bulk::checkpoint::AtomicStatsSnapshot` —
/// identical shape so the coordinator can merge slices directly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkerResult {
    pub worker_id: String,
    pub slice_index: u64,
    pub completed_spins: u64,
    pub duration_ms: u64,
    pub stats_snapshot: crate::bulk::checkpoint::AtomicStatsSnapshot,
    pub hdr_buckets: Vec<u64>,
}

/// Wire envelope. Every message belongs to one of these variants.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ClusterEnvelope {
    Hello(WorkerHello),
    Assign { slice: WorkSlice },
    Progress(ProgressFrame),
    Done(WorkerResult),
    Abort { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ClusterError {
    ProtocolMismatch { worker: String, runtime: String },
    ConfigHashMismatch { worker: String, runtime: String },
    AbortedByWorker { reason: String },
    Transport { detail: String },
}

impl std::fmt::Display for ClusterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ProtocolMismatch { worker, runtime } => {
                write!(f, "protocol mismatch: worker={worker} runtime={runtime}")
            }
            Self::ConfigHashMismatch { worker, runtime } => {
                write!(f, "config_hash mismatch: worker={worker} runtime={runtime}")
            }
            Self::AbortedByWorker { reason } => write!(f, "worker aborted: {reason}"),
            Self::Transport { detail } => write!(f, "transport: {detail}"),
        }
    }
}

impl std::error::Error for ClusterError {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bulk::checkpoint::AtomicStatsSnapshot;

    #[test]
    fn envelope_roundtrip_hello() {
        let env = ClusterEnvelope::Hello(WorkerHello {
            protocol_version: CLUSTER_PROTOCOL_VERSION.into(),
            worker_id: "w-1".into(),
            benchmark_spins_per_sec: 1.2e9,
            hardware_notes: "M3 Pro 11/14".into(),
        });
        let s = serde_json::to_string(&env).unwrap();
        let back: ClusterEnvelope = serde_json::from_str(&s).unwrap();
        assert_eq!(env, back);
        // Discriminator on the wire is snake_case.
        assert!(s.contains("\"kind\":\"hello\""));
    }

    #[test]
    fn envelope_roundtrip_assign() {
        let env = ClusterEnvelope::Assign {
            slice: WorkSlice {
                slice_index: 7,
                start_spin: 70_000_000_000,
                end_spin: 80_000_000_000,
                base_seed: 12345,
                chunk_spins: 10_000_000,
                total_bet_mc: 1000,
                config_hash: "abc".into(),
            },
        };
        let s = serde_json::to_string(&env).unwrap();
        let back: ClusterEnvelope = serde_json::from_str(&s).unwrap();
        assert_eq!(env, back);
    }

    #[test]
    fn envelope_roundtrip_done() {
        let env = ClusterEnvelope::Done(WorkerResult {
            worker_id: "w-1".into(),
            slice_index: 0,
            completed_spins: 100,
            duration_ms: 50,
            stats_snapshot: AtomicStatsSnapshot::default(),
            hdr_buckets: vec![0; 32],
        });
        let s = serde_json::to_string(&env).unwrap();
        let back: ClusterEnvelope = serde_json::from_str(&s).unwrap();
        assert_eq!(env, back);
    }
}
