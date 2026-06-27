//! Crash-resume checkpoint for `BulkDispatcher`.
//!
//! Every `checkpoint_interval` spins the dispatcher snapshots the
//! aggregate stats to disk via this module. If the process dies mid-run,
//! the next invocation can pass `--bulk-resume <path>` and the
//! dispatcher reads the snapshot, advances `completed_spins`, and
//! continues from there.
//!
//! Wire format is JSON (small, human-auditable, easy to inspect with
//! `jq`). The snapshot is written atomically: temp file + rename, so a
//! crash mid-write leaves the old checkpoint intact.

use serde::{Deserialize, Serialize};
use std::fs::{rename, File};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::Ordering;

use crate::stats::{AtomicStats, HdrHistogram};

/// On-disk snapshot. `schema_version` is bumped when fields change.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BulkCheckpoint {
    pub schema_version: String,
    pub run_id: String,
    pub config_hash: String,

    pub total_spins_target: u64,
    pub completed_spins: u64,
    pub base_seed: u64,
    pub chunk_spins: u64,
    pub chunks_completed: u64,

    pub elapsed_ms: u64,
    pub started_at_epoch_ms: u64,
    pub last_checkpoint_epoch_ms: u64,

    /// Atomic counters merged so far.
    pub stats: AtomicStatsSnapshot,
    /// HDR bucket counts (32 u64s — fixed shape).
    pub hdr_buckets: Vec<u64>,
}

pub const CHECKPOINT_SCHEMA_VERSION: &str = "1.0.0";

/// Plain-data mirror of `AtomicStats` — only the integer counters,
/// since locks / histograms come from neighbouring snapshots.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct AtomicStatsSnapshot {
    pub total_spins: u64,
    pub total_wagered: i64,
    pub total_won: i64,
    pub total_base_won: i64,
    pub total_fs_won: i64,
    pub total_hnw_won: i64,
    pub total_cascade_won: i64,
    pub total_jackpot_won: i64,
    pub total_lightning_uplift: i64,

    pub winning_spins: u64,
    pub fs_triggers: u64,
    pub hnw_triggers: u64,
    pub lightning_triggers: u64,
    pub cascade_triggers: u64,

    pub max_win: i64,
    pub max_mult_seen: u64,

    pub total_fs_spins: u64,
    pub total_hnw_respins: u64,
    pub fs_retriggers: u64,
    pub hnw_full_grids: u64,

    pub jackpots_mini: u64,
    pub jackpots_minor: u64,
    pub jackpots_major: u64,
    pub jackpots_grand: u64,
}

impl AtomicStatsSnapshot {
    /// Read all atomic counters out of `AtomicStats` into a plain
    /// struct safe to serialize.
    pub fn from_atomic(stats: &AtomicStats) -> Self {
        let load_u = |a: &std::sync::atomic::AtomicU64| a.load(Ordering::Relaxed);
        let load_i = |a: &std::sync::atomic::AtomicI64| a.load(Ordering::Relaxed);
        Self {
            total_spins: load_u(&stats.total_spins),
            total_wagered: load_i(&stats.total_wagered),
            total_won: load_i(&stats.total_won),
            total_base_won: load_i(&stats.total_base_won),
            total_fs_won: load_i(&stats.total_fs_won),
            total_hnw_won: load_i(&stats.total_hnw_won),
            total_cascade_won: load_i(&stats.total_cascade_won),
            total_jackpot_won: load_i(&stats.total_jackpot_won),
            total_lightning_uplift: load_i(&stats.total_lightning_uplift),
            winning_spins: load_u(&stats.winning_spins),
            fs_triggers: load_u(&stats.fs_triggers),
            hnw_triggers: load_u(&stats.hnw_triggers),
            lightning_triggers: load_u(&stats.lightning_triggers),
            cascade_triggers: load_u(&stats.cascade_triggers),
            max_win: load_i(&stats.max_win),
            max_mult_seen: load_u(&stats.max_mult_seen),
            total_fs_spins: load_u(&stats.total_fs_spins),
            total_hnw_respins: load_u(&stats.total_hnw_respins),
            fs_retriggers: load_u(&stats.fs_retriggers),
            hnw_full_grids: load_u(&stats.hnw_full_grids),
            jackpots_mini: load_u(&stats.jackpots_mini),
            jackpots_minor: load_u(&stats.jackpots_minor),
            jackpots_major: load_u(&stats.jackpots_major),
            jackpots_grand: load_u(&stats.jackpots_grand),
        }
    }

    /// Restore atomic counters from snapshot. Used on resume so the
    /// dispatcher continues with the right running totals.
    pub fn apply_to(&self, stats: &AtomicStats) {
        let store_u = |a: &std::sync::atomic::AtomicU64, v: u64| a.store(v, Ordering::Relaxed);
        let store_i = |a: &std::sync::atomic::AtomicI64, v: i64| a.store(v, Ordering::Relaxed);
        store_u(&stats.total_spins, self.total_spins);
        store_i(&stats.total_wagered, self.total_wagered);
        store_i(&stats.total_won, self.total_won);
        store_i(&stats.total_base_won, self.total_base_won);
        store_i(&stats.total_fs_won, self.total_fs_won);
        store_i(&stats.total_hnw_won, self.total_hnw_won);
        store_i(&stats.total_cascade_won, self.total_cascade_won);
        store_i(&stats.total_jackpot_won, self.total_jackpot_won);
        store_i(&stats.total_lightning_uplift, self.total_lightning_uplift);
        store_u(&stats.winning_spins, self.winning_spins);
        store_u(&stats.fs_triggers, self.fs_triggers);
        store_u(&stats.hnw_triggers, self.hnw_triggers);
        store_u(&stats.lightning_triggers, self.lightning_triggers);
        store_u(&stats.cascade_triggers, self.cascade_triggers);
        store_i(&stats.max_win, self.max_win);
        store_u(&stats.max_mult_seen, self.max_mult_seen);
        store_u(&stats.total_fs_spins, self.total_fs_spins);
        store_u(&stats.total_hnw_respins, self.total_hnw_respins);
        store_u(&stats.fs_retriggers, self.fs_retriggers);
        store_u(&stats.hnw_full_grids, self.hnw_full_grids);
        store_u(&stats.jackpots_mini, self.jackpots_mini);
        store_u(&stats.jackpots_minor, self.jackpots_minor);
        store_u(&stats.jackpots_major, self.jackpots_major);
        store_u(&stats.jackpots_grand, self.jackpots_grand);
    }
}

/// Snapshot HDR bucket counts. Returns a `Vec<u64>` (BTreeMap-stable
/// when serialized by serde_json, no extra ordering work).
pub fn snapshot_hdr_buckets(hdr: &HdrHistogram) -> Vec<u64> {
    hdr.snapshot().to_vec()
}

/// Restore HDR bucket counts from a saved snapshot. Delegates to the
/// public `HdrHistogram::add_buckets` API so we touch private fields
/// only inside `stats.rs`.
pub fn apply_hdr_buckets(hdr: &HdrHistogram, buckets: &[u64]) {
    hdr.add_buckets(buckets);
}

/// Atomic checkpoint write: temp file → fsync → rename.
pub fn save_checkpoint(path: &Path, chk: &BulkCheckpoint) -> Result<(), String> {
    let tmp = path.with_extension("ckpt.tmp");
    let json = serde_json::to_string_pretty(chk).map_err(|e| format!("serialize: {e}"))?;
    {
        let mut f = File::create(&tmp).map_err(|e| format!("create {tmp:?}: {e}"))?;
        f.write_all(json.as_bytes())
            .map_err(|e| format!("write: {e}"))?;
        f.sync_all().map_err(|e| format!("sync: {e}"))?;
    }
    rename(&tmp, path).map_err(|e| format!("rename {tmp:?} → {path:?}: {e}"))?;
    Ok(())
}

pub fn load_checkpoint(path: &Path) -> Result<Option<BulkCheckpoint>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let mut f = File::open(path).map_err(|e| format!("open {path:?}: {e}"))?;
    let mut buf = String::new();
    f.read_to_string(&mut buf)
        .map_err(|e| format!("read: {e}"))?;
    let chk: BulkCheckpoint = serde_json::from_str(&buf).map_err(|e| format!("parse: {e}"))?;
    if chk.schema_version != CHECKPOINT_SCHEMA_VERSION {
        return Err(format!(
            "checkpoint schema_version {} != {CHECKPOINT_SCHEMA_VERSION}",
            chk.schema_version
        ));
    }
    Ok(Some(chk))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    #[test]
    fn snapshot_roundtrip_through_atomic() {
        let stats = AtomicStats::new();
        stats.total_spins.store(100, Ordering::Relaxed);
        stats.total_wagered.store(1000, Ordering::Relaxed);
        stats.total_won.store(950, Ordering::Relaxed);
        stats.jackpots_grand.store(1, Ordering::Relaxed);
        let snap = AtomicStatsSnapshot::from_atomic(&stats);

        // Restore to a fresh AtomicStats and verify counters.
        let restored = AtomicStats::new();
        snap.apply_to(&restored);
        assert_eq!(restored.total_spins.load(Ordering::Relaxed), 100);
        assert_eq!(restored.total_wagered.load(Ordering::Relaxed), 1000);
        assert_eq!(restored.total_won.load(Ordering::Relaxed), 950);
        assert_eq!(restored.jackpots_grand.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn save_and_load_checkpoint_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("run.ckpt");
        let chk = BulkCheckpoint {
            schema_version: CHECKPOINT_SCHEMA_VERSION.into(),
            run_id: "test".into(),
            config_hash: "abc".into(),
            total_spins_target: 1_000_000,
            completed_spins: 250_000,
            base_seed: 12345,
            chunk_spins: 50_000,
            chunks_completed: 5,
            elapsed_ms: 1000,
            started_at_epoch_ms: 1_700_000_000_000,
            last_checkpoint_epoch_ms: 1_700_000_010_000,
            stats: AtomicStatsSnapshot::default(),
            hdr_buckets: vec![0; crate::stats::HDR_BUCKET_COUNT],
        };
        save_checkpoint(&path, &chk).unwrap();
        let back = load_checkpoint(&path).unwrap().expect("present");
        assert_eq!(back, chk);
    }

    #[test]
    fn missing_checkpoint_returns_none() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("nope.ckpt");
        assert!(load_checkpoint(&path).unwrap().is_none());
    }

    #[test]
    fn rejects_unknown_schema_version() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("bad.ckpt");
        let mut chk = BulkCheckpoint {
            schema_version: "9.9.9".into(),
            run_id: "x".into(),
            config_hash: "x".into(),
            total_spins_target: 0,
            completed_spins: 0,
            base_seed: 0,
            chunk_spins: 0,
            chunks_completed: 0,
            elapsed_ms: 0,
            started_at_epoch_ms: 0,
            last_checkpoint_epoch_ms: 0,
            stats: AtomicStatsSnapshot::default(),
            hdr_buckets: vec![0; crate::stats::HDR_BUCKET_COUNT],
        };
        std::fs::write(&path, serde_json::to_string_pretty(&chk).unwrap()).unwrap();
        let r = load_checkpoint(&path);
        assert!(r.is_err());
        // Re-save with correct version → loads cleanly.
        chk.schema_version = CHECKPOINT_SCHEMA_VERSION.into();
        std::fs::write(&path, serde_json::to_string_pretty(&chk).unwrap()).unwrap();
        assert!(load_checkpoint(&path).is_ok());
    }
}
