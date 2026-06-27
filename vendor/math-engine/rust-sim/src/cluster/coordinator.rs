//! Coordinator — slices a `BulkConfig` across N workers and merges
//! the slice results into a single `AtomicStats` + HDR.
//!
//! Logic is intentionally transport-agnostic: `partition_run` is pure,
//! `merge_slice_results` is pure, the only thing that touches a socket
//! is the optional `ClusterCoordinator` driver below. Tests exercise
//! everything end-to-end through `InMemoryTransport`.

use crate::bulk::checkpoint::AtomicStatsSnapshot;
use crate::bulk::dispatcher::BulkConfig;
use crate::stats::{AtomicStats, HdrHistogram};

use super::protocol::{WorkSlice, WorkerResult};

/// One slice's worth of output ready to be merged. Kept as a struct so
/// callers can do bookkeeping (which worker, how long it took, did it
/// succeed) without losing the raw numbers.
#[derive(Debug, Clone)]
pub struct SliceResult {
    pub slice_index: u64,
    pub worker_id: String,
    pub completed_spins: u64,
    pub duration_ms: u64,
    pub stats: AtomicStatsSnapshot,
    pub hdr_buckets: Vec<u64>,
}

impl From<WorkerResult> for SliceResult {
    fn from(w: WorkerResult) -> Self {
        Self {
            slice_index: w.slice_index,
            worker_id: w.worker_id,
            completed_spins: w.completed_spins,
            duration_ms: w.duration_ms,
            stats: w.stats_snapshot,
            hdr_buckets: w.hdr_buckets,
        }
    }
}

/// Partition a single-machine `BulkConfig` into `slice_count` disjoint
/// `WorkSlice`s. Slices are equal-length except the last, which absorbs
/// the remainder. Each slice's `slice_index` is unique inside the run so
/// per-spin seed derivation stays deterministic.
pub fn partition_run(bulk: &BulkConfig, slice_count: u64) -> Vec<WorkSlice> {
    if slice_count == 0 {
        return Vec::new();
    }
    let slice_count = slice_count.min(bulk.total_spins.max(1));
    let mut out = Vec::with_capacity(slice_count as usize);
    let base_size = bulk.total_spins / slice_count;
    let remainder = bulk.total_spins % slice_count;
    let mut cursor = 0u64;
    for i in 0..slice_count {
        let extra = if i < remainder { 1 } else { 0 };
        let span = base_size + extra;
        out.push(WorkSlice {
            slice_index: i,
            start_spin: cursor,
            end_spin: cursor + span,
            base_seed: bulk.base_seed,
            chunk_spins: bulk.chunk_spins,
            total_bet_mc: bulk.total_bet_mc,
            config_hash: bulk.config_hash.clone(),
        });
        cursor += span;
    }
    out
}

/// Merge slice results back into a single global `AtomicStats` + HDR.
/// Order-independent — the same set of results in any order produces
/// the same merged counters because the underlying ops are `fetch_add`.
pub fn merge_slice_results(
    results: &[SliceResult],
    global_stats: &AtomicStats,
    global_hdr: &HdrHistogram,
) -> u64 {
    let mut total = 0u64;
    for r in results {
        // Apply counters via additive merge — `apply_to` overwrites, so
        // we go field-by-field with `fetch_add` here instead.
        add_snapshot(global_stats, &r.stats);
        global_hdr.add_buckets(&r.hdr_buckets);
        total += r.completed_spins;
    }
    total
}

fn add_snapshot(global: &AtomicStats, snap: &AtomicStatsSnapshot) {
    use std::sync::atomic::Ordering::Relaxed;
    let add_u = |a: &std::sync::atomic::AtomicU64, v: u64| {
        a.fetch_add(v, Relaxed);
    };
    let add_i = |a: &std::sync::atomic::AtomicI64, v: i64| {
        a.fetch_add(v, Relaxed);
    };
    let max_i = |a: &std::sync::atomic::AtomicI64, v: i64| {
        let mut current = a.load(Relaxed);
        while v > current {
            match a.compare_exchange_weak(current, v, Relaxed, Relaxed) {
                Ok(_) => return,
                Err(x) => current = x,
            }
        }
    };
    let max_u = |a: &std::sync::atomic::AtomicU64, v: u64| {
        let mut current = a.load(Relaxed);
        while v > current {
            match a.compare_exchange_weak(current, v, Relaxed, Relaxed) {
                Ok(_) => return,
                Err(x) => current = x,
            }
        }
    };

    add_u(&global.total_spins, snap.total_spins);
    add_i(&global.total_wagered, snap.total_wagered);
    add_i(&global.total_won, snap.total_won);
    add_i(&global.total_base_won, snap.total_base_won);
    add_i(&global.total_fs_won, snap.total_fs_won);
    add_i(&global.total_hnw_won, snap.total_hnw_won);
    add_i(&global.total_cascade_won, snap.total_cascade_won);
    add_i(&global.total_jackpot_won, snap.total_jackpot_won);
    add_i(&global.total_lightning_uplift, snap.total_lightning_uplift);
    add_u(&global.winning_spins, snap.winning_spins);
    add_u(&global.fs_triggers, snap.fs_triggers);
    add_u(&global.hnw_triggers, snap.hnw_triggers);
    add_u(&global.lightning_triggers, snap.lightning_triggers);
    add_u(&global.cascade_triggers, snap.cascade_triggers);
    max_i(&global.max_win, snap.max_win);
    max_u(&global.max_mult_seen, snap.max_mult_seen);
    add_u(&global.total_fs_spins, snap.total_fs_spins);
    add_u(&global.total_hnw_respins, snap.total_hnw_respins);
    add_u(&global.fs_retriggers, snap.fs_retriggers);
    add_u(&global.hnw_full_grids, snap.hnw_full_grids);
    add_u(&global.jackpots_mini, snap.jackpots_mini);
    add_u(&global.jackpots_minor, snap.jackpots_minor);
    add_u(&global.jackpots_major, snap.jackpots_major);
    add_u(&global.jackpots_grand, snap.jackpots_grand);
}

/// Transport-agnostic coordinator. Pass it a slice plan + a worker
/// pool driver (which knows how to ship slices to workers and collect
/// results) and it merges what comes back.
pub struct ClusterCoordinator<'a> {
    pub slices: Vec<WorkSlice>,
    pub global_stats: &'a AtomicStats,
    pub global_hdr: &'a HdrHistogram,
}

impl<'a> ClusterCoordinator<'a> {
    pub fn new(
        slices: Vec<WorkSlice>,
        global_stats: &'a AtomicStats,
        global_hdr: &'a HdrHistogram,
    ) -> Self {
        Self {
            slices,
            global_stats,
            global_hdr,
        }
    }

    /// Apply already-collected slice results. The driver (TCP / in-memory
    /// / gRPC) is responsible for pumping the protocol; we only handle
    /// the merge.
    pub fn finish(&self, results: Vec<SliceResult>) -> u64 {
        merge_slice_results(&results, self.global_stats, self.global_hdr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    fn make_bulk(total: u64) -> BulkConfig {
        let mut b = BulkConfig::new(total, 12345);
        b.config_hash = "test".into();
        b
    }

    #[test]
    fn partition_evenly_when_divisible() {
        let bulk = make_bulk(100);
        let slices = partition_run(&bulk, 4);
        assert_eq!(slices.len(), 4);
        for s in &slices {
            assert_eq!(s.span(), 25);
        }
        assert_eq!(slices[0].start_spin, 0);
        assert_eq!(slices[3].end_spin, 100);
    }

    #[test]
    fn partition_remainder_lands_on_early_slices() {
        // 100 / 3 = 33 r 1 → slices [34, 33, 33]
        let bulk = make_bulk(100);
        let slices = partition_run(&bulk, 3);
        assert_eq!(slices.len(), 3);
        assert_eq!(slices[0].span(), 34);
        assert_eq!(slices[1].span(), 33);
        assert_eq!(slices[2].span(), 33);
        assert_eq!(
            slices[0].start_spin + slices[0].span(),
            slices[1].start_spin
        );
        assert_eq!(slices.last().unwrap().end_spin, 100);
    }

    #[test]
    fn partition_zero_slices_returns_empty() {
        let bulk = make_bulk(100);
        assert!(partition_run(&bulk, 0).is_empty());
    }

    #[test]
    fn partition_more_slices_than_spins_clamps() {
        let bulk = make_bulk(3);
        let slices = partition_run(&bulk, 100);
        assert_eq!(slices.len(), 3);
        for s in &slices {
            assert_eq!(s.span(), 1);
        }
    }

    #[test]
    fn slice_indices_are_unique_and_sequential() {
        let bulk = make_bulk(1_000_000);
        let slices = partition_run(&bulk, 7);
        let ids: Vec<u64> = slices.iter().map(|s| s.slice_index).collect();
        assert_eq!(ids, vec![0, 1, 2, 3, 4, 5, 6]);
    }

    #[test]
    fn merge_results_sums_counters() {
        let global = AtomicStats::new();
        let hdr = HdrHistogram::default();
        let r1 = SliceResult {
            slice_index: 0,
            worker_id: "a".into(),
            completed_spins: 50,
            duration_ms: 5,
            stats: AtomicStatsSnapshot {
                total_spins: 50,
                total_wagered: 5_000,
                total_won: 4_700,
                winning_spins: 12,
                ..Default::default()
            },
            hdr_buckets: {
                let mut v = vec![0u64; 32];
                v[0] = 38;
                v[1] = 10;
                v[2] = 2;
                v
            },
        };
        let r2 = SliceResult {
            slice_index: 1,
            worker_id: "b".into(),
            completed_spins: 50,
            duration_ms: 5,
            stats: AtomicStatsSnapshot {
                total_spins: 50,
                total_wagered: 5_000,
                total_won: 5_300,
                winning_spins: 15,
                max_win: 1234,
                ..Default::default()
            },
            hdr_buckets: {
                let mut v = vec![0u64; 32];
                v[0] = 35;
                v[1] = 13;
                v[2] = 2;
                v
            },
        };
        let total = merge_slice_results(&[r1, r2], &global, &hdr);
        assert_eq!(total, 100);
        assert_eq!(global.total_spins.load(Ordering::Relaxed), 100);
        assert_eq!(global.total_wagered.load(Ordering::Relaxed), 10_000);
        assert_eq!(global.total_won.load(Ordering::Relaxed), 10_000);
        assert_eq!(global.winning_spins.load(Ordering::Relaxed), 27);
        assert_eq!(global.max_win.load(Ordering::Relaxed), 1234);
        let snap = hdr.snapshot();
        assert_eq!(snap[0], 73);
        assert_eq!(snap[1], 23);
        assert_eq!(snap[2], 4);
    }

    #[test]
    fn merge_max_win_takes_maximum_not_sum() {
        let global = AtomicStats::new();
        let hdr = HdrHistogram::default();
        let r1 = SliceResult {
            slice_index: 0,
            worker_id: "a".into(),
            completed_spins: 50,
            duration_ms: 5,
            stats: AtomicStatsSnapshot {
                max_win: 500,
                ..Default::default()
            },
            hdr_buckets: vec![0; 32],
        };
        let r2 = SliceResult {
            slice_index: 1,
            worker_id: "b".into(),
            completed_spins: 50,
            duration_ms: 5,
            stats: AtomicStatsSnapshot {
                max_win: 2000,
                ..Default::default()
            },
            hdr_buckets: vec![0; 32],
        };
        merge_slice_results(&[r1, r2], &global, &hdr);
        assert_eq!(global.max_win.load(Ordering::Relaxed), 2000);
    }
}
