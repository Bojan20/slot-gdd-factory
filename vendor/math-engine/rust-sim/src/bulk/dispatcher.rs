//! `BulkDispatcher` — drives N-trillion-spin runs with constant memory,
//! progress callbacks, and crash-resume checkpoints.
//!
//! ## Algorithm
//!
//! 1. Slice `total_spins` into ⌈total / chunk_spins⌉ work units.
//! 2. For each chunk, dispatch parallel workers (Rayon) running the
//!    existing `simulator::simulate_seed_detailed` on a counter-derived
//!    seed. Each chunk uses **disjoint seed counters** so a 1T run is
//!    fully reproducible from `(base_seed, chunk_index, worker_in_chunk)`.
//! 3. Merge the chunk's `AtomicStats` and HDR snapshot into the global
//!    accumulator — chunk-local stats are dropped immediately.
//! 4. After every `checkpoint_every_chunks` chunks (and always on
//!    completion / SIGINT), write a JSON checkpoint via `checkpoint::save`.
//! 5. Emit a `ProgressSnapshot` after every chunk so reporters can paint
//!    a bar / NDJSON line.
//!
//! ## Determinism contract
//!
//! Given the same `(config, BulkConfig { total_spins, chunk_spins,
//! base_seed, threads_per_chunk })`, the dispatcher MUST produce
//! byte-identical merged `AtomicStats` counters across every machine
//! and OS in the build matrix. Counter-based seed derivation is the
//! lever — Rayon thread schedule does not enter the per-spin RNG state.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rayon::prelude::*;

use crate::config::GameConfig;
use crate::simulator::simulate_seed_detailed;
use crate::stats::{AtomicStats, HdrHistogram, HDR_BUCKET_COUNT};

use super::checkpoint::{
    apply_hdr_buckets, load_checkpoint, save_checkpoint, snapshot_hdr_buckets, AtomicStatsSnapshot,
    BulkCheckpoint, CHECKPOINT_SCHEMA_VERSION,
};
use super::progress::{ProgressReporter, ProgressSnapshot};

/// Caller-supplied configuration. Distinct from `simulator::SimConfig`
/// because that one assumed a small fixed N; this one is built around
/// "tell me how many spins, I will figure out the chunking".
#[derive(Debug, Clone)]
pub struct BulkConfig {
    /// Total spins to execute. Pass `1_000_000_000_000` for 1T.
    pub total_spins: u64,
    /// Per-chunk spin count. Smaller = more progress ticks, slightly
    /// higher overhead. Default 10M is the sweet spot for M-series.
    pub chunk_spins: u64,
    /// Base RNG seed. Seeds per worker = `base_seed.wrapping_add(global_index)`
    /// so the chunked schedule is bit-identical to a flat N-seed run
    /// when `total_spins == chunk_spins`.
    pub base_seed: u64,
    /// Total bet in millicredits (integer to avoid f64 drift).
    pub total_bet_mc: i64,
    /// Rayon pool size for the *in-chunk* fan-out. The dispatcher itself
    /// stays single-threaded between chunks — that's where progress /
    /// checkpoint hooks fire.
    pub threads_per_chunk: usize,
    /// Per-worker spin count inside a chunk. Larger = fewer Rayon tasks,
    /// less scheduling overhead. Default `chunk_spins / threads_per_chunk`.
    pub spins_per_worker: u64,
    /// Write a checkpoint after every N chunks. `0` ⇒ never.
    pub checkpoint_every_chunks: u64,
    /// Path the checkpoint is written to. Required if
    /// `checkpoint_every_chunks > 0`.
    pub checkpoint_path: Option<PathBuf>,
    /// Resume from this checkpoint. The dispatcher reads it, sets the
    /// running counters, and skips chunks already done.
    pub resume_path: Option<PathBuf>,
    /// Stable identifier for this run, surfaced into the checkpoint and
    /// any logs. Recommendation: include the config hash + UTC start.
    pub run_id: String,
    /// Hash of the canonical config (used by resume to verify the
    /// resumed run matches the config the operator passed in).
    pub config_hash: String,
}

impl BulkConfig {
    pub fn new(total_spins: u64, base_seed: u64) -> Self {
        let threads = num_cpus_safe();
        let chunk_spins = 10_000_000;
        let spins_per_worker = chunk_spins / threads as u64;
        Self {
            total_spins,
            chunk_spins,
            base_seed,
            total_bet_mc: 1_000,
            threads_per_chunk: threads,
            spins_per_worker,
            checkpoint_every_chunks: 0,
            checkpoint_path: None,
            resume_path: None,
            run_id: format!("bulk-{}", current_epoch_ms()),
            config_hash: String::new(),
        }
    }
}

/// What the dispatcher returns at the end.
pub struct BulkResult {
    pub total_spins: u64,
    pub duration: Duration,
    pub spins_per_sec: f64,
    pub stats: AtomicStats,
    pub hdr: HdrHistogram,
    pub chunks_completed: u64,
    pub checkpoints_written: u64,
    pub resumed_from: Option<u64>,
}

pub struct BulkDispatcher<'a> {
    config: &'a GameConfig,
    bulk: BulkConfig,
    reporter: Arc<dyn ProgressReporter>,
}

impl<'a> BulkDispatcher<'a> {
    pub fn new(
        config: &'a GameConfig,
        bulk: BulkConfig,
        reporter: Arc<dyn ProgressReporter>,
    ) -> Self {
        Self {
            config,
            bulk,
            reporter,
        }
    }

    pub fn run(self) -> Result<BulkResult, String> {
        let started_at_epoch_ms = current_epoch_ms();
        let started = Instant::now();
        let global_stats = AtomicStats::new();

        // ── Resume (optional) ──────────────────────────────────────────
        let (resumed_completed, resumed_chunks) = if let Some(path) = &self.bulk.resume_path {
            match load_checkpoint(path)? {
                Some(chk) => self.apply_resume(&global_stats, &chk)?,
                None => (0, 0),
            }
        } else {
            (0, 0)
        };

        let total = self.bulk.total_spins;
        if total == 0 {
            // No-op run still emits a finish so reporters wrap up cleanly.
            let snap = ProgressSnapshot {
                completed_spins: 0,
                total_spins: 0,
                elapsed: started.elapsed(),
                spins_per_sec: 0.0,
                eta: Some(Duration::ZERO),
                chunk_index: 0,
                chunks_total: 0,
            };
            self.reporter.finish(&snap);
            return Ok(BulkResult {
                total_spins: 0,
                duration: started.elapsed(),
                spins_per_sec: 0.0,
                stats: global_stats,
                hdr: HdrHistogram::default(),
                chunks_completed: 0,
                checkpoints_written: 0,
                resumed_from: None,
            });
        }

        let chunk_spins = self.bulk.chunk_spins.max(1);
        let chunks_total = total.div_ceil(chunk_spins);
        let mut completed = resumed_completed;
        let mut chunks_completed = resumed_chunks;
        let mut checkpoints_written = 0u64;

        // Local HDR for accumulated chunks (atomic merge into global).
        let global_hdr = HdrHistogram::default();
        if resumed_completed > 0 {
            // The resume path re-populated global_stats counters; the
            // HDR buckets travel inside the same checkpoint so we add
            // them here once.
            if let Some(path) = &self.bulk.resume_path {
                if let Some(chk) = load_checkpoint(path)? {
                    apply_hdr_buckets(&global_hdr, &chk.hdr_buckets);
                }
            }
        }

        // ── Chunk loop ──────────────────────────────────────────────────
        // `chunks_completed` is mutated inside the loop body for the
        // checkpoint accounting; the range bound is snapshotted into
        // `loop_start` so clippy::mutate_range_bound stays satisfied
        // and the loop counter doesn't drift if we touch the field.
        let loop_start = chunks_completed;
        for chunk_idx in loop_start..chunks_total {
            let chunk_start_spin = chunk_idx * chunk_spins;
            let this_chunk = (total - chunk_start_spin).min(chunk_spins);

            self.run_chunk(
                chunk_idx,
                chunk_start_spin,
                this_chunk,
                &global_stats,
                &global_hdr,
            );

            completed = completed.saturating_add(this_chunk).min(total);
            chunks_completed = chunk_idx + 1;

            // Progress tick after every chunk.
            let elapsed = started.elapsed();
            let sps = compute_sps(completed.saturating_sub(resumed_completed), elapsed);
            let eta = compute_eta(completed, total, sps);
            self.reporter.report(&ProgressSnapshot {
                completed_spins: completed,
                total_spins: total,
                elapsed,
                spins_per_sec: sps,
                eta,
                chunk_index: chunk_idx,
                chunks_total,
            });

            // Checkpoint.
            if self.bulk.checkpoint_every_chunks > 0
                && self.bulk.checkpoint_path.is_some()
                && chunks_completed % self.bulk.checkpoint_every_chunks == 0
            {
                self.write_checkpoint(
                    started_at_epoch_ms,
                    elapsed,
                    completed,
                    chunks_completed,
                    &global_stats,
                    &global_hdr,
                )?;
                checkpoints_written += 1;
            }
        }

        // Always write a final checkpoint when one was requested.
        if self.bulk.checkpoint_every_chunks > 0 && self.bulk.checkpoint_path.is_some() {
            let elapsed = started.elapsed();
            self.write_checkpoint(
                started_at_epoch_ms,
                elapsed,
                completed,
                chunks_completed,
                &global_stats,
                &global_hdr,
            )?;
            checkpoints_written += 1;
        }

        let duration = started.elapsed();
        let spins_per_sec = compute_sps(completed.saturating_sub(resumed_completed), duration);
        self.reporter.finish(&ProgressSnapshot {
            completed_spins: completed,
            total_spins: total,
            elapsed: duration,
            spins_per_sec,
            eta: Some(Duration::ZERO),
            chunk_index: chunks_total.saturating_sub(1),
            chunks_total,
        });

        Ok(BulkResult {
            total_spins: completed,
            duration,
            spins_per_sec,
            stats: global_stats,
            hdr: global_hdr,
            chunks_completed,
            checkpoints_written,
            resumed_from: if resumed_completed > 0 {
                Some(resumed_completed)
            } else {
                None
            },
        })
    }

    fn run_chunk(
        &self,
        chunk_idx: u64,
        chunk_start_spin: u64,
        chunk_spins: u64,
        global_stats: &AtomicStats,
        global_hdr: &HdrHistogram,
    ) {
        let threads = self.bulk.threads_per_chunk.max(1);
        let spins_per_worker = self.bulk.spins_per_worker.max(1).min(chunk_spins);
        let workers_full = chunk_spins / spins_per_worker;
        let workers_tail = if chunk_spins % spins_per_worker == 0 {
            0
        } else {
            1
        };
        let workers = (workers_full + workers_tail).max(1);

        let chunk_stats = AtomicStats::new();
        let chunk_hdr = HdrHistogram::default();

        // Run workers via Rayon. Each worker computes its own seed from
        // (base_seed, chunk_start_spin, worker_in_chunk) so the per-spin
        // RNG sequence is deterministic regardless of how Rayon schedules.
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .build()
            .expect("BulkDispatcher: rayon pool build");
        pool.install(|| {
            (0..workers).into_par_iter().for_each(|w| {
                let seed = derive_seed(self.bulk.base_seed, chunk_idx, chunk_start_spin, w);
                let start = w * spins_per_worker;
                let end = ((w + 1) * spins_per_worker).min(chunk_spins);
                let count = end.saturating_sub(start);
                if count == 0 {
                    return;
                }
                let (_seed_stats, local) =
                    simulate_seed_detailed(self.config, seed, count, self.bulk.total_bet_mc);
                // Merge local → chunk (lock-free atomic adds).
                chunk_stats.merge(&local);
                chunk_hdr.merge(&local.hdr);
            });
        });

        // Single-thread merge chunk → global.
        global_stats.merge(&chunk_stats);
        global_hdr.merge(&chunk_hdr);
    }

    fn apply_resume(
        &self,
        global_stats: &AtomicStats,
        chk: &BulkCheckpoint,
    ) -> Result<(u64, u64), String> {
        if chk.total_spins_target != self.bulk.total_spins {
            return Err(format!(
                "resume: checkpoint total_spins_target {} != current total_spins {}",
                chk.total_spins_target, self.bulk.total_spins
            ));
        }
        if chk.base_seed != self.bulk.base_seed {
            return Err(format!(
                "resume: checkpoint base_seed {} != current base_seed {}",
                chk.base_seed, self.bulk.base_seed
            ));
        }
        if chk.chunk_spins != self.bulk.chunk_spins {
            return Err(format!(
                "resume: checkpoint chunk_spins {} != current chunk_spins {}",
                chk.chunk_spins, self.bulk.chunk_spins
            ));
        }
        if !self.bulk.config_hash.is_empty() && chk.config_hash != self.bulk.config_hash {
            return Err(format!(
                "resume: checkpoint config_hash {} != current {}",
                chk.config_hash, self.bulk.config_hash
            ));
        }
        chk.stats.apply_to(global_stats);
        Ok((chk.completed_spins, chk.chunks_completed))
    }

    fn write_checkpoint(
        &self,
        started_at_epoch_ms: u64,
        elapsed: Duration,
        completed: u64,
        chunks_completed: u64,
        stats: &AtomicStats,
        hdr: &HdrHistogram,
    ) -> Result<(), String> {
        let path = self
            .bulk
            .checkpoint_path
            .as_ref()
            .ok_or_else(|| "write_checkpoint: no path configured".to_string())?;
        let chk = BulkCheckpoint {
            schema_version: CHECKPOINT_SCHEMA_VERSION.into(),
            run_id: self.bulk.run_id.clone(),
            config_hash: self.bulk.config_hash.clone(),
            total_spins_target: self.bulk.total_spins,
            completed_spins: completed,
            base_seed: self.bulk.base_seed,
            chunk_spins: self.bulk.chunk_spins,
            chunks_completed,
            elapsed_ms: elapsed.as_millis() as u64,
            started_at_epoch_ms,
            last_checkpoint_epoch_ms: current_epoch_ms(),
            stats: AtomicStatsSnapshot::from_atomic(stats),
            hdr_buckets: snapshot_hdr_buckets(hdr),
        };
        save_checkpoint(path, &chk)
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────

/// Build a deterministic per-worker seed from the run state. Mixes
/// `base_seed`, the chunk index, the chunk's absolute start spin, and
/// the worker offset inside the chunk so the same `(BulkConfig, ChunkIdx,
/// WorkerIdx)` always reproduces the same RNG stream regardless of which
/// physical thread Rayon dispatches.
fn derive_seed(base_seed: u64, chunk_idx: u64, chunk_start_spin: u64, worker_in_chunk: u64) -> u64 {
    // FNV-1a 64 mix — cheap, well-distributed, no `rand` dep.
    let mut h: u64 = 0xcbf29ce484222325;
    for v in [base_seed, chunk_idx, chunk_start_spin, worker_in_chunk] {
        // 8-byte little-endian mix.
        for byte in v.to_le_bytes() {
            h ^= byte as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
    }
    // Avoid 0 (some RNGs degenerate on a zero seed).
    if h == 0 {
        0x9E37_79B9_7F4A_7C15
    } else {
        h
    }
}

fn compute_sps(completed_this_run: u64, elapsed: Duration) -> f64 {
    let secs = elapsed.as_secs_f64();
    if secs <= 0.0 {
        0.0
    } else {
        completed_this_run as f64 / secs
    }
}

fn compute_eta(completed: u64, total: u64, sps: f64) -> Option<Duration> {
    if sps <= 0.0 || completed >= total {
        return None;
    }
    let remaining = (total - completed) as f64 / sps;
    if !remaining.is_finite() {
        return None;
    }
    Some(Duration::from_secs_f64(remaining))
}

fn current_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn num_cpus_safe() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
        .max(1)
}

// Suppress the unused HDR_BUCKET_COUNT import warning when this module
// is compiled standalone without the rest of the bulk public surface.
#[allow(dead_code)]
const _UNUSED_HDR: usize = HDR_BUCKET_COUNT;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bulk::progress::NoOpProgress;
    use crate::config::GameConfig;
    use std::sync::atomic::Ordering;
    use std::sync::Arc;

    fn test_config() -> GameConfig {
        GameConfig::default()
    }

    #[test]
    fn small_run_produces_expected_spin_count() {
        let cfg = test_config();
        let mut bulk = BulkConfig::new(100_000, 42);
        bulk.chunk_spins = 25_000;
        bulk.spins_per_worker = 5_000;
        bulk.threads_per_chunk = 2;
        let d = BulkDispatcher::new(&cfg, bulk, Arc::new(NoOpProgress));
        let r = d.run().unwrap();
        assert_eq!(r.total_spins, 100_000);
        assert_eq!(r.chunks_completed, 4);
        assert!(r.duration.as_millis() > 0);
        assert!(r.spins_per_sec > 0.0);
        assert_eq!(
            r.stats.total_spins.load(Ordering::Relaxed),
            100_000,
            "all spins recorded"
        );
    }

    #[test]
    fn determinism_same_config_same_seed_same_counters() {
        let cfg = test_config();
        let build = || {
            let mut b = BulkConfig::new(50_000, 9999);
            b.chunk_spins = 10_000;
            b.spins_per_worker = 2_500;
            b.threads_per_chunk = 4;
            b
        };
        let r1 = BulkDispatcher::new(&cfg, build(), Arc::new(NoOpProgress))
            .run()
            .unwrap();
        let r2 = BulkDispatcher::new(&cfg, build(), Arc::new(NoOpProgress))
            .run()
            .unwrap();
        // Determinism contract: byte-identical aggregate counters.
        assert_eq!(
            r1.stats.total_won.load(Ordering::Relaxed),
            r2.stats.total_won.load(Ordering::Relaxed)
        );
        assert_eq!(
            r1.stats.winning_spins.load(Ordering::Relaxed),
            r2.stats.winning_spins.load(Ordering::Relaxed)
        );
        assert_eq!(r1.hdr.snapshot(), r2.hdr.snapshot());
    }

    #[test]
    fn handles_partial_final_chunk() {
        // total_spins not divisible by chunk_spins → last chunk smaller.
        let cfg = test_config();
        let mut bulk = BulkConfig::new(75_000, 7);
        bulk.chunk_spins = 20_000;
        bulk.spins_per_worker = 5_000;
        bulk.threads_per_chunk = 2;
        let d = BulkDispatcher::new(&cfg, bulk, Arc::new(NoOpProgress));
        let r = d.run().unwrap();
        assert_eq!(r.total_spins, 75_000);
        assert_eq!(r.chunks_completed, 4); // 20k + 20k + 20k + 15k
        assert_eq!(r.stats.total_spins.load(Ordering::Relaxed), 75_000);
    }

    #[test]
    fn checkpoint_save_and_resume_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("run.ckpt");
        let cfg = test_config();

        let mut first = BulkConfig::new(40_000, 5);
        first.chunk_spins = 10_000;
        first.spins_per_worker = 5_000;
        first.threads_per_chunk = 2;
        first.checkpoint_every_chunks = 1;
        first.checkpoint_path = Some(path.clone());
        first.run_id = "rt-1".into();
        first.config_hash = "abc".into();

        // Run normally; final checkpoint pins state at 40k.
        let r1 = BulkDispatcher::new(&cfg, first, Arc::new(NoOpProgress))
            .run()
            .unwrap();
        assert_eq!(r1.total_spins, 40_000);
        assert!(r1.checkpoints_written >= 1);

        // Resume from the saved checkpoint — nothing more to do, so
        // dispatcher should return immediately with the same totals.
        let mut second = BulkConfig::new(40_000, 5);
        second.chunk_spins = 10_000;
        second.spins_per_worker = 5_000;
        second.threads_per_chunk = 2;
        second.resume_path = Some(path.clone());
        second.checkpoint_path = Some(path);
        second.run_id = "rt-1".into();
        second.config_hash = "abc".into();
        let r2 = BulkDispatcher::new(&cfg, second, Arc::new(NoOpProgress))
            .run()
            .unwrap();
        assert_eq!(r2.total_spins, 40_000);
        assert_eq!(
            r2.stats.total_spins.load(Ordering::Relaxed),
            40_000,
            "resume preserved running total"
        );
    }

    #[test]
    fn resume_rejects_mismatched_config_hash() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("run.ckpt");
        let cfg = test_config();

        // First run with config_hash "A".
        let mut first = BulkConfig::new(20_000, 1);
        first.chunk_spins = 10_000;
        first.spins_per_worker = 5_000;
        first.threads_per_chunk = 1;
        first.checkpoint_every_chunks = 1;
        first.checkpoint_path = Some(path.clone());
        first.config_hash = "A".into();
        BulkDispatcher::new(&cfg, first, Arc::new(NoOpProgress))
            .run()
            .unwrap();

        // Try to resume with config_hash "B".
        let mut bad = BulkConfig::new(20_000, 1);
        bad.chunk_spins = 10_000;
        bad.spins_per_worker = 5_000;
        bad.threads_per_chunk = 1;
        bad.resume_path = Some(path);
        bad.config_hash = "B".into();
        let r = BulkDispatcher::new(&cfg, bad, Arc::new(NoOpProgress)).run();
        assert!(
            r.is_err(),
            "expected resume to refuse mismatched config_hash"
        );
    }

    #[test]
    fn derive_seed_distinct_across_workers_and_chunks() {
        let a = derive_seed(42, 0, 0, 0);
        let b = derive_seed(42, 0, 0, 1);
        let c = derive_seed(42, 1, 10_000, 0);
        let d = derive_seed(43, 0, 0, 0);
        assert_ne!(a, b);
        assert_ne!(a, c);
        assert_ne!(a, d);
        assert_ne!(b, c);
    }

    #[test]
    fn zero_total_is_noop_finish() {
        let cfg = test_config();
        let bulk = BulkConfig::new(0, 1);
        let d = BulkDispatcher::new(&cfg, bulk, Arc::new(NoOpProgress));
        let r = d.run().unwrap();
        assert_eq!(r.total_spins, 0);
        assert_eq!(r.chunks_completed, 0);
    }
}
