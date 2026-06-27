//! Statistics Accumulator — Faza 8 extended
//!
//! Thread-safe streaming statistics for 1T+ spin Monte Carlo simulations.
//!
//! ## Component matrix
//!
//! | Component              | Thread-safe   | Strategy                         |
//! |------------------------|---------------|----------------------------------|
//! | `HdrHistogram`         | ✅ lock-free  | 32 atomic U64 buckets            |
//! | `WelfordAccumulator`   | ❌ per-thread | merge via `merge_welford_batch`  |
//! | `AtomicStats::welford` | ✅ Mutex      | updated per-spin or in batch     |
//! | `TopNWins`             | ✅ Mutex      | rare updates (large wins)        |
//! | `BonusDistanceTracker` | ✅ lock-free  | all atomics                      |
//! | `ConvergenceDetector`  | ❌ per-thread | single-thread control loop       |
//! | `SpinCountEstimator`   | stateless     | pure functions                   |

use std::collections::VecDeque;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::Mutex;

// ─── Standalone CAS helpers ───────────────────────────────────────────────────

#[inline]
fn atomic_max_i64(target: &AtomicI64, candidate: i64) {
    loop {
        let cur = target.load(Ordering::Relaxed);
        if candidate <= cur {
            break;
        }
        if target
            .compare_exchange(cur, candidate, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
        {
            break;
        }
    }
}

#[inline]
fn atomic_max_u64(target: &AtomicU64, candidate: u64) {
    loop {
        let cur = target.load(Ordering::Relaxed);
        if candidate <= cur {
            break;
        }
        if target
            .compare_exchange(cur, candidate, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
        {
            break;
        }
    }
}

// ─── Legacy win-distribution (14 flat buckets) ───────────────────────────────

/// Win distribution buckets (in multiples of bet).
/// Kept for backward compatibility with existing tests.
pub const WIN_BUCKETS: &[f64] = &[
    0.0, 0.5, 1.0, 2.0, 3.0, 5.0, 10.0, 20.0, 50.0, 100.0, 200.0, 500.0, 1000.0, 5000.0,
];

/// Win distribution histogram (14 flat buckets, mutex-protected).
#[derive(Default, Clone)]
pub struct WinDistribution {
    pub buckets: [u64; 14],
    pub sum_sq_wins: f64,
    pub win_count: u64,
    pub sum_wins: f64,
}

impl WinDistribution {
    pub fn record(&mut self, win_mult: f64) {
        if win_mult > 0.0 {
            self.win_count += 1;
            self.sum_wins += win_mult;
            self.sum_sq_wins += win_mult * win_mult;
            for (i, &threshold) in WIN_BUCKETS.iter().enumerate() {
                if i + 1 >= WIN_BUCKETS.len() || win_mult < WIN_BUCKETS[i + 1] {
                    self.buckets[i] += 1;
                    break;
                }
            }
        }
    }

    pub fn merge(&mut self, other: &WinDistribution) {
        for i in 0..self.buckets.len() {
            self.buckets[i] += other.buckets[i];
        }
        self.sum_sq_wins += other.sum_sq_wins;
        self.win_count += other.win_count;
        self.sum_wins += other.sum_wins;
    }

    /// Coefficient of variation (σ/μ) from legacy distribution.
    pub fn volatility_index(&self) -> f64 {
        if self.win_count < 2 {
            return 0.0;
        }
        let mean = self.sum_wins / self.win_count as f64;
        let variance = (self.sum_sq_wins - self.sum_wins * mean) / (self.win_count - 1) as f64;
        if mean > 0.0 {
            variance.sqrt() / mean
        } else {
            0.0
        }
    }
}

// ─── HDR Histogram ───────────────────────────────────────────────────────────

pub const HDR_BUCKET_COUNT: usize = 32;

/// One CDF table entry.
#[derive(Debug, Clone)]
pub struct CdfEntry {
    /// Lower bound of this bucket (inclusive) in bet multiples.
    pub from_x: f64,
    /// Upper bound (exclusive). `None` = unbounded top bucket.
    pub to_x: Option<f64>,
    /// P(win falls in this bucket).
    pub probability: f64,
    /// P(win ≤ to_x) — cumulative.
    pub cumulative: f64,
}

/// P-quantile report from HDR snapshot.
#[derive(Debug, Clone, Default)]
pub struct QuantileReport {
    pub p50: f64,
    pub p90: f64,
    pub p99: f64,
    pub p999: f64,
}

/// Constant-memory, log-scale win histogram.
pub struct HdrHistogram {
    counts: [AtomicU64; HDR_BUCKET_COUNT],
}

impl Default for HdrHistogram {
    fn default() -> Self {
        Self {
            counts: std::array::from_fn(|_| AtomicU64::new(0)),
        }
    }
}

impl HdrHistogram {
    /// Threshold boundaries (30 values → 31 intervals + 1 no-win bucket = 32).
    pub const THRESHOLDS: &'static [f64] = &[
        0.1, 0.2, 0.5, 1.0, 2.0, 3.0, 5.0, 8.0, 10.0, 15.0, 20.0, 30.0, 50.0, 75.0, 100.0, 150.0,
        200.0, 300.0, 500.0, 750.0, 1000.0, 1500.0, 2000.0, 3000.0, 5000.0, 7500.0, 10000.0,
        15000.0, 20000.0, 50000.0,
    ];

    #[inline]
    pub fn record(&self, win_x: f64) {
        let bucket = if win_x <= 0.0 {
            0
        } else {
            let mut b = 1usize;
            for &t in Self::THRESHOLDS {
                if win_x < t {
                    break;
                }
                b += 1;
            }
            b.min(HDR_BUCKET_COUNT - 1)
        };
        self.counts[bucket].fetch_add(1, Ordering::Relaxed);
    }

    #[inline]
    pub fn get(&self, bucket: usize) -> u64 {
        self.counts
            .get(bucket)
            .map_or(0, |c| c.load(Ordering::Relaxed))
    }

    pub fn total(&self) -> u64 {
        self.counts.iter().map(|c| c.load(Ordering::Relaxed)).sum()
    }

    pub fn merge(&self, other: &HdrHistogram) {
        for i in 0..HDR_BUCKET_COUNT {
            self.counts[i].fetch_add(other.counts[i].load(Ordering::Relaxed), Ordering::Relaxed);
        }
    }

    pub fn snapshot(&self) -> [u64; HDR_BUCKET_COUNT] {
        std::array::from_fn(|i| self.counts[i].load(Ordering::Relaxed))
    }

    /// Faza 9.8 — restore bucket counts from a checkpoint snapshot.
    /// Adds to whatever's already there (idempotent under double-resume
    /// is the caller's responsibility — typical pattern is to call this
    /// once on a fresh `HdrHistogram` during resume).
    pub fn add_buckets(&self, buckets: &[u64]) {
        let limit = buckets.len().min(HDR_BUCKET_COUNT);
        for (i, &c) in buckets.iter().take(limit).enumerate() {
            self.counts[i].fetch_add(c, Ordering::Relaxed);
        }
    }

    /// Faza 9.8 — coarse midpoint per bucket, used for any consumer that
    /// needs a representative win value (rare; HDR is for percentiles
    /// not points). Returns 0.0 for the no-win bucket.
    pub fn bucket_midpoint(idx: usize) -> f64 {
        if idx == 0 {
            return 0.0;
        }
        let lo = if idx == 1 {
            0.0
        } else {
            Self::THRESHOLDS[idx - 2]
        };
        let hi = if idx <= Self::THRESHOLDS.len() {
            Self::THRESHOLDS[idx - 1]
        } else {
            lo * 2.0
        };
        (lo + hi) * 0.5
    }

    /// Estimate the p-th quantile from the current histogram (0 ≤ p ≤ 1).
    ///
    /// Returns a win value in bet multiples via linear interpolation within the
    /// containing bucket. Returns 0.0 for p=0 or an empty histogram.
    pub fn quantile(&self, p: f64) -> f64 {
        let snap = self.snapshot();
        Self::quantile_from_snapshot(&snap, p)
    }

    pub fn quantile_from_snapshot(snap: &[u64; HDR_BUCKET_COUNT], p: f64) -> f64 {
        let total: u64 = snap.iter().sum();
        if total == 0 {
            return 0.0;
        }
        let target = (p.clamp(0.0, 1.0) * total as f64).floor() as u64;
        let mut cumulative = 0u64;

        // Bucket 0: point mass at 0 (no win).
        cumulative += snap[0];
        if cumulative > target {
            return 0.0;
        }

        // Buckets 1..=30 — each covers a threshold interval.
        for i in 1..=30usize {
            let count = snap[i];
            cumulative += count;
            if cumulative > target {
                // Bucket i covers [lo, hi).
                let lo = if i == 1 { 0.0 } else { Self::THRESHOLDS[i - 2] };
                let hi = Self::THRESHOLDS[i - 1];
                if count == 0 {
                    return lo;
                }
                let prev_cumulative = cumulative - count;
                let within = (target - prev_cumulative) as f64;
                let fraction = within / count as f64;
                return lo + fraction * (hi - lo);
            }
        }

        // Bucket 31: unbounded top — return lower bound as estimate.
        *Self::THRESHOLDS.last().unwrap_or(&50000.0)
    }

    /// Build a complete CDF table from the current histogram.
    pub fn cdf(&self) -> Vec<CdfEntry> {
        let snap = self.snapshot();
        Self::cdf_from_snapshot(&snap)
    }

    pub fn cdf_from_snapshot(snap: &[u64; HDR_BUCKET_COUNT]) -> Vec<CdfEntry> {
        let total: u64 = snap.iter().sum();
        if total == 0 {
            return vec![];
        }
        let total_f = total as f64;
        let mut entries = Vec::with_capacity(HDR_BUCKET_COUNT);
        let mut cumulative = 0.0f64;

        // Bucket 0: no win.
        let prob0 = snap[0] as f64 / total_f;
        cumulative += prob0;
        entries.push(CdfEntry {
            from_x: 0.0,
            to_x: Some(0.0),
            probability: prob0,
            cumulative,
        });

        // Buckets 1..=30.
        for i in 1..=30usize {
            let lo = if i == 1 { 0.0 } else { Self::THRESHOLDS[i - 2] };
            let hi = Self::THRESHOLDS[i - 1];
            let prob = snap[i] as f64 / total_f;
            cumulative += prob;
            entries.push(CdfEntry {
                from_x: lo,
                to_x: Some(hi),
                probability: prob,
                cumulative: cumulative.min(1.0),
            });
        }

        // Bucket 31: unbounded top.
        let top_lo = *Self::THRESHOLDS.last().unwrap_or(&50000.0);
        let prob31 = snap[HDR_BUCKET_COUNT - 1] as f64 / total_f;
        cumulative += prob31;
        entries.push(CdfEntry {
            from_x: top_lo,
            to_x: None,
            probability: prob31,
            cumulative: cumulative.min(1.0),
        });

        entries
    }

    /// Compute P50/P90/P99/P99.9 quantiles in one pass.
    pub fn quantile_report(&self) -> QuantileReport {
        let snap = self.snapshot();
        QuantileReport {
            p50: Self::quantile_from_snapshot(&snap, 0.50),
            p90: Self::quantile_from_snapshot(&snap, 0.90),
            p99: Self::quantile_from_snapshot(&snap, 0.99),
            p999: Self::quantile_from_snapshot(&snap, 0.999),
        }
    }
}

// ─── Welford 4-moment online accumulator ────────────────────────────────────

/// Online accumulator for mean, variance, skewness, and kurtosis.
///
/// Uses Terriberry's extension of Welford's algorithm:
/// * O(1) per sample, O(1) space
/// * Numerically stable for large N (no catastrophic cancellation)
/// * **Not thread-safe** — use per-thread, then `merge` into a shared accumulator.
///
/// ### Parallel merge (Chan et al.)
/// Two accumulators can be combined without loss of precision via `merge`.
/// This is the recommended pattern for multi-threaded MC simulators:
/// each worker thread maintains a local `WelfordAccumulator`, and at the
/// end of its shard calls `AtomicStats::merge_welford_batch`.
#[derive(Debug, Clone, Default)]
pub struct WelfordAccumulator {
    n: u64,
    mean: f64,
    m2: f64, // sum of squared deviations (σ²×n)
    m3: f64, // third central moment × n
    m4: f64, // fourth central moment × n
}

impl WelfordAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add one observation.
    #[inline]
    pub fn push(&mut self, x: f64) {
        let n1 = self.n as f64;
        self.n += 1;
        let n = self.n as f64;

        let delta = x - self.mean;
        let delta_n = delta / n;
        let delta_n2 = delta_n * delta_n;
        let term1 = delta * delta_n * n1; // = delta^2 * n1/n

        // Update M4 first (uses old M2 and M3).
        self.m4 += term1 * delta_n2 * (n * n - 3.0 * n + 3.0) + 6.0 * delta_n2 * self.m2
            - 4.0 * delta_n * self.m3;
        self.m3 += term1 * delta_n * (n - 2.0) - 3.0 * delta_n * self.m2;
        self.m2 += term1;
        self.mean += delta_n;
    }

    /// Parallel combination (Chan et al. algorithm).
    /// Merges `other` into `self` without loss of precision.
    pub fn merge(&mut self, other: &WelfordAccumulator) {
        if other.n == 0 {
            return;
        }
        if self.n == 0 {
            *self = other.clone();
            return;
        }

        let na = self.n as f64;
        let nb = other.n as f64;
        let n = na + nb;
        let delta = other.mean - self.mean;
        let delta2 = delta * delta;
        let delta3 = delta2 * delta;
        let delta4 = delta2 * delta2;

        let new_mean = (na * self.mean + nb * other.mean) / n;
        let new_m2 = self.m2 + other.m2 + delta2 * na * nb / n;
        let new_m3 = self.m3
            + other.m3
            + delta3 * na * nb * (na - nb) / (n * n)
            + 3.0 * delta * (na * other.m2 - nb * self.m2) / n;
        let new_m4 = self.m4
            + other.m4
            + delta4 * na * nb * (na * na - na * nb + nb * nb) / (n * n * n)
            + 6.0 * delta2 * (na * na * other.m2 + nb * nb * self.m2) / (n * n)
            + 4.0 * delta * (na * other.m3 - nb * self.m3) / n;

        self.n += other.n;
        self.mean = new_mean;
        self.m2 = new_m2;
        self.m3 = new_m3;
        self.m4 = new_m4;
    }

    pub fn count(&self) -> u64 {
        self.n
    }

    pub fn mean(&self) -> f64 {
        self.mean
    }

    /// Population variance (divide by n). Use for complete datasets.
    pub fn population_variance(&self) -> f64 {
        if self.n < 1 {
            0.0
        } else {
            self.m2 / self.n as f64
        }
    }

    /// Sample variance (Bessel correction, divide by n-1). Use for MC samples.
    pub fn sample_variance(&self) -> f64 {
        if self.n < 2 {
            0.0
        } else {
            self.m2 / (self.n - 1) as f64
        }
    }

    pub fn std_dev(&self) -> f64 {
        self.sample_variance().sqrt()
    }

    /// Coefficient of variation σ/μ. Returns 0 when mean ≈ 0.
    pub fn cv(&self) -> f64 {
        let mu = self.mean();
        if mu.abs() < 1e-15 {
            0.0
        } else {
            self.std_dev() / mu.abs()
        }
    }

    /// Population skewness (third standardized central moment).
    /// Returns 0 for n < 3 or near-zero variance.
    pub fn skewness(&self) -> f64 {
        if self.n < 3 || self.m2 < 1e-30 {
            return 0.0;
        }
        let n = self.n as f64;
        (self.m3 / n) / (self.m2 / n).powf(1.5)
    }

    /// Excess kurtosis (fourth standardized central moment − 3).
    /// Normal distribution: excess kurtosis = 0. Returns 0 for n < 4.
    pub fn excess_kurtosis(&self) -> f64 {
        if self.n < 4 || self.m2 < 1e-30 {
            return 0.0;
        }
        let n = self.n as f64;
        let var_sq = (self.m2 / n) * (self.m2 / n);
        (self.m4 / n) / var_sq - 3.0
    }

    /// GLI Volatility Index = CV (σ/μ).
    pub fn volatility_index(&self) -> f64 {
        self.cv()
    }

    /// Qualitative volatility category based on CV.
    pub fn volatility_category(&self) -> &'static str {
        let cv = self.cv();
        if cv < 0.5 {
            "VERY_LOW"
        } else if cv < 2.0 {
            "LOW"
        } else if cv < 5.0 {
            "MEDIUM"
        } else if cv < 10.0 {
            "HIGH"
        } else if cv < 20.0 {
            "VERY_HIGH"
        } else {
            "EXTREME"
        }
    }
}

// ─── Top-N win capture ────────────────────────────────────────────────────────

/// One large-win record (with seed for deterministic replay).
#[derive(Debug, Clone, PartialEq)]
pub struct WinRecord {
    /// Win amount in bet multiples.
    pub win_x: f64,
    /// RNG seed used for this spin.
    pub seed: u64,
    /// Absolute spin index within the simulation run.
    pub spin_index: u64,
}

/// Thread-safe bounded top-N win capture.
///
/// Uses a `Mutex`-protected sorted `Vec`. Lock contention is negligible because
/// `try_record` is only truly competitive for wins larger than the current
/// minimum in the top-N list — rare at 1T spins.
pub struct TopNWins {
    capacity: usize,
    /// Sorted ascending by win_x so index 0 is the smallest (easiest to evict).
    inner: Mutex<Vec<WinRecord>>,
}

impl Default for TopNWins {
    fn default() -> Self {
        Self::new(25)
    }
}

impl TopNWins {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            inner: Mutex::new(Vec::with_capacity(capacity)),
        }
    }

    /// Attempt to insert a win. No-op if ≤ 0 or smaller than the current minimum.
    pub fn try_record(&self, win_x: f64, seed: u64, spin_index: u64) {
        if win_x <= 0.0 {
            return;
        }
        let mut guard = match self.inner.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let should_insert =
            guard.len() < self.capacity || guard.first().map_or(true, |min| win_x > min.win_x);
        if should_insert {
            guard.push(WinRecord {
                win_x,
                seed,
                spin_index,
            });
            // Re-sort ascending so index 0 = smallest.
            guard.sort_unstable_by(|a, b| {
                a.win_x
                    .partial_cmp(&b.win_x)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            if guard.len() > self.capacity {
                guard.remove(0); // evict smallest
            }
        }
    }

    /// Snapshot sorted **descending** (largest first).
    pub fn snapshot(&self) -> Vec<WinRecord> {
        self.inner
            .lock()
            .map(|g| {
                let mut v = g.clone();
                v.sort_unstable_by(|a, b| {
                    b.win_x
                        .partial_cmp(&a.win_x)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
                v
            })
            .unwrap_or_default()
    }

    pub fn len(&self) -> usize {
        self.inner.lock().map(|g| g.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Merge wins from `other` into `self` (keeps overall top-N across both).
    pub fn merge_from(&self, other: &TopNWins) {
        for r in other.snapshot() {
            self.try_record(r.win_x, r.seed, r.spin_index);
        }
    }
}

// ─── Bonus distance tracker ───────────────────────────────────────────────────

/// Distance histogram thresholds (in spins between bonus triggers).
/// Made `pub` in PAR-004 so the PAR generator can build the time-to-trigger CDF.
pub const DISTANCE_THRESHOLDS: [u64; 12] = [
    10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 100_000,
];

/// Thread-safe inter-trigger distance distribution tracker.
///
/// Records the number of spins between consecutive feature triggers.
/// All operations are lock-free (atomic).
pub struct BonusDistanceTracker {
    /// Spin index of the last trigger. `u64::MAX` = never triggered.
    last_trigger_spin: AtomicU64,
    /// Histogram: 13 buckets covering [0, 10), [10, 25) … [100000, ∞).
    dist_counts: [AtomicU64; 13],
    /// Sum of all recorded distances (for mean calculation).
    sum_distances: AtomicU64,
    /// Number of completed intervals (trigger-to-trigger pairs).
    total_intervals: AtomicU64,
    /// Maximum distance seen.
    max_distance: AtomicU64,
}

impl Default for BonusDistanceTracker {
    fn default() -> Self {
        Self {
            last_trigger_spin: AtomicU64::new(u64::MAX),
            dist_counts: std::array::from_fn(|_| AtomicU64::new(0)),
            sum_distances: AtomicU64::new(0),
            total_intervals: AtomicU64::new(0),
            max_distance: AtomicU64::new(0),
        }
    }
}

impl BonusDistanceTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Call once when a bonus feature triggers at `current_spin`.
    ///
    /// Records the distance from the previous trigger. The first trigger
    /// (when `last_trigger_spin == u64::MAX`) does not create an interval.
    pub fn record_trigger(&self, current_spin: u64) {
        let last = self.last_trigger_spin.swap(current_spin, Ordering::Relaxed);
        if last != u64::MAX && current_spin > last {
            let dist = current_spin - last;
            // Find histogram bucket.
            let bucket = DISTANCE_THRESHOLDS
                .iter()
                .position(|&t| dist < t)
                .unwrap_or(12); // overflow bucket
            self.dist_counts[bucket].fetch_add(1, Ordering::Relaxed);
            self.sum_distances.fetch_add(dist, Ordering::Relaxed);
            self.total_intervals.fetch_add(1, Ordering::Relaxed);
            atomic_max_u64(&self.max_distance, dist);
        }
    }

    pub fn mean_distance(&self) -> f64 {
        let total = self.total_intervals.load(Ordering::Relaxed);
        if total == 0 {
            return f64::INFINITY;
        }
        self.sum_distances.load(Ordering::Relaxed) as f64 / total as f64
    }

    pub fn max_distance(&self) -> u64 {
        self.max_distance.load(Ordering::Relaxed)
    }

    pub fn total_intervals(&self) -> u64 {
        self.total_intervals.load(Ordering::Relaxed)
    }

    pub fn snapshot_counts(&self) -> [u64; 13] {
        std::array::from_fn(|i| self.dist_counts[i].load(Ordering::Relaxed))
    }

    /// Merge another tracker into this one (for shard aggregation).
    pub fn merge(&self, other: &BonusDistanceTracker) {
        for i in 0..13 {
            self.dist_counts[i].fetch_add(
                other.dist_counts[i].load(Ordering::Relaxed),
                Ordering::Relaxed,
            );
        }
        self.sum_distances.fetch_add(
            other.sum_distances.load(Ordering::Relaxed),
            Ordering::Relaxed,
        );
        self.total_intervals.fetch_add(
            other.total_intervals.load(Ordering::Relaxed),
            Ordering::Relaxed,
        );
        atomic_max_u64(
            &self.max_distance,
            other.max_distance.load(Ordering::Relaxed),
        );
        // Note: last_trigger_spin not merged (per-thread tracking only).
    }
}

// ─── Convergence detector ─────────────────────────────────────────────────────

/// Sliding-window CI auto-stop detector.
///
/// Maintains a ring buffer of the last `window_size` RTP readings (in percent).
/// `has_converged` returns `true` when the 95/99/99.9% CI half-width falls
/// below the target — i.e., further spins will not move the RTP estimate by
/// more than `target_half_width_pp`.
///
/// **Not thread-safe.** Designed for the MC control loop (main thread) that
/// periodically reads aggregate stats from parallel worker threads.
pub struct ConvergenceDetector {
    target_half_width_pp: f64,
    z_score: f64,
    window: VecDeque<f64>,
    window_size: usize,
}

impl ConvergenceDetector {
    /// Create a new detector.
    ///
    /// * `target_half_width_pp` — target CI half-width in percentage points, e.g. `0.01` for 0.01pp.
    /// * `confidence` — confidence level: 0.95, 0.99, or 0.999.
    /// * `window_size` — number of RTP readings in the sliding window (≥ 2).
    pub fn new(target_half_width_pp: f64, confidence: f64, window_size: usize) -> Self {
        let z_score = if confidence >= 0.999 {
            3.291
        } else if confidence >= 0.99 {
            2.576
        } else {
            1.96
        };
        Self {
            target_half_width_pp,
            z_score,
            window: VecDeque::with_capacity(window_size),
            window_size: window_size.max(2),
        }
    }

    /// Add an RTP reading (in percent).
    pub fn push(&mut self, rtp_pct: f64) {
        if self.window.len() >= self.window_size {
            self.window.pop_front();
        }
        self.window.push_back(rtp_pct);
    }

    /// Current CI half-width in percentage points.
    /// Returns `f64::INFINITY` if fewer than 2 readings.
    pub fn current_half_width_pp(&self) -> f64 {
        if self.window.len() < 2 {
            return f64::INFINITY;
        }
        let n = self.window.len() as f64;
        let mean = self.window.iter().sum::<f64>() / n;
        let var = self.window.iter().map(|&r| (r - mean).powi(2)).sum::<f64>() / (n - 1.0);
        self.z_score * (var / n).sqrt()
    }

    pub fn has_converged(&self) -> bool {
        self.current_half_width_pp() <= self.target_half_width_pp
    }

    pub fn readings(&self) -> usize {
        self.window.len()
    }

    pub fn window_mean(&self) -> f64 {
        if self.window.is_empty() {
            return 0.0;
        }
        self.window.iter().sum::<f64>() / self.window.len() as f64
    }

    pub fn reset(&mut self) {
        self.window.clear();
    }
}

// ─── Required spin count estimator ───────────────────────────────────────────

/// Stateless estimator for sample-size calculations.
pub struct SpinCountEstimator;

impl SpinCountEstimator {
    fn z_score(confidence: f64) -> f64 {
        if confidence >= 0.999 {
            3.291
        } else if confidence >= 0.99 {
            2.576
        } else if confidence >= 0.95 {
            1.96
        } else {
            1.645
        }
    }

    /// Estimate spins needed for RTP CI half-width `target_pp`.
    ///
    /// Formula: `n = (z × σ / ε)²` where `ε = target_pp / 100`.
    ///
    /// `per_spin_variance` — variance of per-spin win (in bet multiples²).
    pub fn required_for_rtp(
        per_spin_variance: f64,
        target_half_width_pp: f64,
        confidence: f64,
    ) -> u64 {
        if per_spin_variance <= 0.0 || target_half_width_pp <= 0.0 {
            return 0;
        }
        let z = Self::z_score(confidence);
        let epsilon = target_half_width_pp / 100.0;
        let sigma = per_spin_variance.sqrt();
        ((z * sigma / epsilon).powi(2)).ceil() as u64
    }

    /// Estimate spins needed for hit-rate CI half-width `target_fraction`.
    ///
    /// Formula: `n = z² × p × (1−p) / ε²` (CLT binomial).
    pub fn required_for_hit_rate(
        hit_rate: f64,
        target_half_width_fraction: f64,
        confidence: f64,
    ) -> u64 {
        if target_half_width_fraction <= 0.0 {
            return 0;
        }
        let z = Self::z_score(confidence);
        let p = hit_rate.clamp(1e-6, 1.0 - 1e-6);
        ((z * z * p * (1.0 - p)) / (target_half_width_fraction * target_half_width_fraction)).ceil()
            as u64
    }
}

// ─── Atomic statistics accumulator ───────────────────────────────────────────

/// Atomic statistics accumulator (thread-safe).
#[derive(Default)]
pub struct AtomicStats {
    pub total_spins: AtomicU64,
    pub total_wagered: AtomicI64,
    pub total_won: AtomicI64,
    pub total_base_won: AtomicI64,
    pub total_fs_won: AtomicI64,
    pub total_hnw_won: AtomicI64,
    pub total_cascade_won: AtomicI64,
    pub total_jackpot_won: AtomicI64,
    pub total_lightning_uplift: AtomicI64,

    pub winning_spins: AtomicU64,
    pub fs_triggers: AtomicU64,
    pub hnw_triggers: AtomicU64,
    pub lightning_triggers: AtomicU64,
    pub cascade_triggers: AtomicU64,

    pub max_win: AtomicI64,
    pub max_mult_seen: AtomicU64,

    pub total_fs_spins: AtomicU64,
    pub total_hnw_respins: AtomicU64,
    pub fs_retriggers: AtomicU64,
    pub hnw_full_grids: AtomicU64,

    // Legacy jackpot counts.
    pub jackpots_mini: AtomicU64,
    pub jackpots_minor: AtomicU64,
    pub jackpots_major: AtomicU64,
    pub jackpots_grand: AtomicU64,

    // Legacy 14-bucket distribution (mutex-protected).
    win_distribution: Mutex<WinDistribution>,

    // Faza 4: lock-free HDR histogram.
    // `pub` so Faza 9.8 BulkDispatcher can merge chunk-local HDRs into
    // the running global without an indirection. Reads only — the
    // mutation path goes through `record_win_*` so the legacy locked
    // `win_distribution` stays in sync.
    pub hdr: HdrHistogram,

    // ── Faza 8 additions ──────────────────────────────────────────────────────
    /// Welford 4-moment accumulator (Mutex; update via `record_win_full` or
    /// batch-merge via `merge_welford_batch` for maximum throughput).
    pub welford: Mutex<WelfordAccumulator>,

    /// Top-25 largest wins with seed + spin index for replay.
    pub top_wins: TopNWins,

    /// Inter-trigger distance distribution for Free Spins.
    pub fs_distance: BonusDistanceTracker,

    /// Inter-trigger distance distribution for Hold & Win.
    pub hnw_distance: BonusDistanceTracker,
}

impl AtomicStats {
    pub fn new() -> Self {
        Self::default()
    }

    // ── Win recording ──────────────────────────────────────────────────────────

    /// Record a win to both the legacy distribution AND the HDR histogram.
    pub fn record_win(&self, win_mult: f64) {
        self.hdr.record(win_mult);
        if let Ok(mut dist) = self.win_distribution.lock() {
            dist.record(win_mult);
        }
    }

    /// Record only to the HDR histogram (hot path, zero allocation).
    #[inline]
    pub fn record_win_hdr(&self, win_mult: f64) {
        self.hdr.record(win_mult);
    }

    /// Full per-spin record: HDR + Welford + top-N capture.
    ///
    /// Use this when per-spin statistical completeness is required and
    /// throughput is not the primary constraint. For max throughput,
    /// use `record_win_hdr` in the hot loop and call `merge_welford_batch`
    /// once per shard.
    pub fn record_win_full(&self, win_x: f64, seed: u64, spin_index: u64) {
        self.hdr.record(win_x);
        if let Ok(mut w) = self.welford.lock() {
            w.push(win_x);
        }
        // Large-win threshold: only lock top_wins for wins > 0.
        // The internal check inside try_record avoids the lock for small wins.
        if win_x > 0.0 {
            self.top_wins.try_record(win_x, seed, spin_index);
        }
    }

    /// Merge a per-thread `WelfordAccumulator` into the shared accumulator.
    ///
    /// Recommended pattern for high-throughput MC:
    /// ```ignore
    /// // Per worker thread:
    /// let mut local = WelfordAccumulator::new();
    /// for spin in shard { local.push(win); }
    /// shared_stats.merge_welford_batch(&local);
    /// ```
    pub fn merge_welford_batch(&self, acc: &WelfordAccumulator) {
        if let Ok(mut w) = self.welford.lock() {
            w.merge(acc);
        }
    }

    // ── Bonus distance recording ───────────────────────────────────────────────

    /// Record a Free Spins trigger at `spin_index`.
    pub fn record_fs_trigger(&self, spin_index: u64) {
        self.fs_distance.record_trigger(spin_index);
    }

    /// Record a Hold & Win trigger at `spin_index`.
    pub fn record_hnw_trigger(&self, spin_index: u64) {
        self.hnw_distance.record_trigger(spin_index);
    }

    // ── Snapshot helpers ───────────────────────────────────────────────────────

    pub fn get_hdr_histogram(&self) -> [u64; HDR_BUCKET_COUNT] {
        self.hdr.snapshot()
    }

    pub fn get_distribution(&self) -> WinDistribution {
        self.win_distribution
            .lock()
            .map(|d| d.clone())
            .unwrap_or_default()
    }

    /// Snapshot of the Welford accumulator.
    pub fn get_welford(&self) -> WelfordAccumulator {
        self.welford.lock().map(|w| w.clone()).unwrap_or_default()
    }

    /// P50/P90/P99/P99.9 quantiles from the HDR histogram.
    pub fn get_quantiles(&self) -> QuantileReport {
        self.hdr.quantile_report()
    }

    /// Full CDF table from the HDR histogram.
    pub fn get_cdf(&self) -> Vec<CdfEntry> {
        self.hdr.cdf()
    }

    // ── Merge ──────────────────────────────────────────────────────────────────

    pub fn merge(&self, other: &AtomicStats) {
        macro_rules! add {
            ($field:ident) => {
                self.$field
                    .fetch_add(other.$field.load(Ordering::Relaxed), Ordering::Relaxed);
            };
        }

        add!(total_spins);
        add!(total_wagered);
        add!(total_won);
        add!(total_base_won);
        add!(total_fs_won);
        add!(total_hnw_won);
        add!(total_cascade_won);
        add!(total_jackpot_won);
        add!(total_lightning_uplift);
        add!(winning_spins);
        add!(fs_triggers);
        add!(hnw_triggers);
        add!(lightning_triggers);
        add!(cascade_triggers);
        add!(total_fs_spins);
        add!(total_hnw_respins);
        add!(fs_retriggers);
        add!(hnw_full_grids);
        add!(jackpots_mini);
        add!(jackpots_minor);
        add!(jackpots_major);
        add!(jackpots_grand);

        // Max values — CAS loop.
        atomic_max_i64(&self.max_win, other.max_win.load(Ordering::Relaxed));
        atomic_max_u64(
            &self.max_mult_seen,
            other.max_mult_seen.load(Ordering::Relaxed),
        );

        // HDR merge (lock-free).
        self.hdr.merge(&other.hdr);

        // Legacy distribution merge.
        if let (Ok(mut s), Ok(o)) = (self.win_distribution.lock(), other.win_distribution.lock()) {
            s.merge(&o);
        }

        // Faza 8: Welford merge.
        let other_welford = other.get_welford();
        self.merge_welford_batch(&other_welford);

        // Faza 8: top-wins merge.
        self.top_wins.merge_from(&other.top_wins);

        // Faza 8: bonus distance merge.
        self.fs_distance.merge(&other.fs_distance);
        self.hnw_distance.merge(&other.hnw_distance);
    }

    // ── Derived metrics ───────────────────────────────────────────────────────

    pub fn rtp(&self) -> f64 {
        let wagered = self.total_wagered.load(Ordering::Relaxed);
        let won = self.total_won.load(Ordering::Relaxed);
        if wagered == 0 {
            0.0
        } else {
            (won as f64 / wagered as f64) * 100.0
        }
    }

    pub fn hit_rate(&self) -> f64 {
        let spins = self.total_spins.load(Ordering::Relaxed);
        let wins = self.winning_spins.load(Ordering::Relaxed);
        if spins == 0 {
            0.0
        } else {
            (wins as f64 / spins as f64) * 100.0
        }
    }

    pub fn fs_frequency(&self) -> f64 {
        let spins = self.total_spins.load(Ordering::Relaxed);
        let triggers = self.fs_triggers.load(Ordering::Relaxed);
        if triggers == 0 {
            0.0
        } else {
            spins as f64 / triggers as f64
        }
    }

    pub fn hnw_frequency(&self) -> f64 {
        let spins = self.total_spins.load(Ordering::Relaxed);
        let triggers = self.hnw_triggers.load(Ordering::Relaxed);
        if triggers == 0 {
            0.0
        } else {
            spins as f64 / triggers as f64
        }
    }

    /// Legacy CV-based volatility index (from mutex-protected WinDistribution).
    pub fn volatility_index(&self) -> f64 {
        self.get_distribution().volatility_index()
    }

    /// Welford-based volatility index (CV = σ/μ). Preferred over legacy.
    pub fn welford_volatility_index(&self) -> f64 {
        self.get_welford().volatility_index()
    }
}

// ─── Per-seed / multi-seed statistics ────────────────────────────────────────

#[derive(Debug, Clone, Default)]
pub struct SeedStats {
    pub spins: u64,
    pub wagered: i64,
    pub won: i64,
    pub rtp: f64,
}

#[derive(Debug, Default)]
pub struct MultiSeedStats {
    pub seeds: Vec<SeedStats>,
    pub mean_rtp: f64,
    pub std_dev: f64,
    pub std_error: f64,
    // CI 95%
    pub ci_95_low: f64,
    pub ci_95_high: f64,
    // CI 99% — Faza 8
    pub ci_99_low: f64,
    pub ci_99_high: f64,
    // CI 99.9% — Faza 8
    pub ci_999_low: f64,
    pub ci_999_high: f64,
    // Required spin counts — Faza 8
    /// Spins needed for 0.1pp half-width CI at 95%.
    pub required_spins_01pp_95: u64,
    /// Spins needed for 0.01pp half-width CI at 95%.
    pub required_spins_001pp_95: u64,
    /// Spins needed for 0.1pp half-width CI at 99%.
    pub required_spins_01pp_99: u64,
}

impl MultiSeedStats {
    pub fn from_seeds(seeds: Vec<SeedStats>) -> Self {
        if seeds.is_empty() {
            return Self::default();
        }

        let n = seeds.len() as f64;
        let mean = seeds.iter().map(|s| s.rtp).sum::<f64>() / n;
        let variance =
            seeds.iter().map(|s| (s.rtp - mean).powi(2)).sum::<f64>() / (n - 1.0).max(1.0);
        let std_dev = variance.sqrt();
        let std_error = std_dev / n.sqrt();

        // Per-spin variance estimate: use std_error of individual seed RTPs
        // as proxy for σ_spin (approximate: σ_seed ≈ σ_spin / sqrt(spins_per_seed)).
        let avg_spins_per_seed = seeds.iter().map(|s| s.spins).sum::<u64>() as f64 / n;
        let per_spin_variance_est = if avg_spins_per_seed > 0.0 {
            (variance * avg_spins_per_seed).max(0.001)
        } else {
            1.0
        };

        MultiSeedStats {
            ci_95_low: mean - 1.96 * std_error,
            ci_95_high: mean + 1.96 * std_error,
            ci_99_low: mean - 2.576 * std_error,
            ci_99_high: mean + 2.576 * std_error,
            ci_999_low: mean - 3.291 * std_error,
            ci_999_high: mean + 3.291 * std_error,
            required_spins_01pp_95: SpinCountEstimator::required_for_rtp(
                per_spin_variance_est,
                0.1,
                0.95,
            ),
            required_spins_001pp_95: SpinCountEstimator::required_for_rtp(
                per_spin_variance_est,
                0.01,
                0.95,
            ),
            required_spins_01pp_99: SpinCountEstimator::required_for_rtp(
                per_spin_variance_est,
                0.1,
                0.99,
            ),
            mean_rtp: mean,
            std_dev,
            std_error,
            seeds,
        }
    }
}

// ─── PAR Metrics ─────────────────────────────────────────────────────────────

/// Per-metric summary for PAR sheet generation.
#[derive(Debug, Clone, Default)]
pub struct PARMetrics {
    // ── Existing (Faza 4) fields ──────────────────────────────────────────────
    pub total_rtp: f64,
    pub base_rtp: f64,
    pub fs_rtp: f64,
    pub hnw_rtp: f64,
    pub cascade_rtp: f64,
    pub jackpot_rtp: f64,
    pub lightning_rtp: f64,

    pub hit_rate: f64,
    pub fs_frequency: f64,
    pub hnw_frequency: f64,

    pub avg_fs_win: f64,
    pub avg_hnw_win: f64,
    pub avg_fs_spins: f64,
    pub avg_hnw_orbs: f64,

    pub max_win: f64,
    pub volatility_index: f64,

    pub ci_95_low: f64,
    pub ci_95_high: f64,
    pub std_error: f64,

    // ── Faza 8 additions ──────────────────────────────────────────────────────
    /// Welford streaming moments.
    pub welford_mean: f64,
    pub welford_variance: f64,
    pub welford_std_dev: f64,
    pub welford_cv: f64,
    pub welford_skewness: f64,
    pub welford_excess_kurtosis: f64,
    pub welford_sample_count: u64,

    /// HDR-derived quantiles.
    pub p50: f64,
    pub p90: f64,
    pub p99: f64,
    pub p999: f64,

    /// CI 99% / 99.9%.
    pub ci_99_low: f64,
    pub ci_99_high: f64,
    pub ci_999_low: f64,
    pub ci_999_high: f64,

    /// Required spin counts for precision targets.
    pub required_spins_01pp_95: u64,
    pub required_spins_001pp_95: u64,
    pub required_spins_01pp_99: u64,

    /// Bonus inter-trigger distance statistics.
    pub fs_mean_distance: f64,
    pub fs_max_distance: u64,
    pub hnw_mean_distance: f64,
    pub hnw_max_distance: u64,
}

impl PARMetrics {
    pub fn from_stats(stats: &AtomicStats, multi_seed: &MultiSeedStats, total_bet_mc: i64) -> Self {
        let total_wagered = stats.total_wagered.load(Ordering::Relaxed) as f64;
        let to_pct = |v: i64| {
            if total_wagered > 0.0 {
                (v as f64 / total_wagered) * 100.0
            } else {
                0.0
            }
        };

        let fs_triggers = stats.fs_triggers.load(Ordering::Relaxed);
        let hnw_triggers = stats.hnw_triggers.load(Ordering::Relaxed);
        let fs_won = stats.total_fs_won.load(Ordering::Relaxed);
        let hnw_won = stats.total_hnw_won.load(Ordering::Relaxed);
        let cascade_won = stats.total_cascade_won.load(Ordering::Relaxed);
        let jackpot_won = stats.total_jackpot_won.load(Ordering::Relaxed);

        // Faza 8: Welford snapshot.
        let welford = stats.get_welford();
        let welford_variance = welford.sample_variance();

        // Faza 8: HDR quantiles.
        let q = stats.get_quantiles();

        PARMetrics {
            total_rtp: stats.rtp(),
            base_rtp: to_pct(stats.total_base_won.load(Ordering::Relaxed)),
            fs_rtp: to_pct(fs_won),
            hnw_rtp: to_pct(hnw_won),
            cascade_rtp: to_pct(cascade_won),
            jackpot_rtp: to_pct(jackpot_won),
            lightning_rtp: to_pct(stats.total_lightning_uplift.load(Ordering::Relaxed)),

            hit_rate: stats.hit_rate(),
            fs_frequency: stats.fs_frequency(),
            hnw_frequency: stats.hnw_frequency(),

            avg_fs_win: if fs_triggers > 0 {
                (fs_won as f64 / fs_triggers as f64) / total_bet_mc as f64
            } else {
                0.0
            },
            avg_hnw_win: if hnw_triggers > 0 {
                (hnw_won as f64 / hnw_triggers as f64) / total_bet_mc as f64
            } else {
                0.0
            },
            avg_fs_spins: if fs_triggers > 0 {
                stats.total_fs_spins.load(Ordering::Relaxed) as f64 / fs_triggers as f64
            } else {
                0.0
            },
            avg_hnw_orbs: if hnw_triggers > 0 {
                stats.total_hnw_respins.load(Ordering::Relaxed) as f64 / hnw_triggers as f64
            } else {
                0.0
            },

            max_win: stats.max_win.load(Ordering::Relaxed) as f64 / total_bet_mc as f64,
            volatility_index: welford.volatility_index(), // Faza 8: use Welford-based CV

            ci_95_low: multi_seed.ci_95_low,
            ci_95_high: multi_seed.ci_95_high,
            std_error: multi_seed.std_error,

            // Faza 8 fields.
            welford_mean: welford.mean(),
            welford_variance,
            welford_std_dev: welford.std_dev(),
            welford_cv: welford.cv(),
            welford_skewness: welford.skewness(),
            welford_excess_kurtosis: welford.excess_kurtosis(),
            welford_sample_count: welford.count(),

            p50: q.p50,
            p90: q.p90,
            p99: q.p99,
            p999: q.p999,

            ci_99_low: multi_seed.ci_99_low,
            ci_99_high: multi_seed.ci_99_high,
            ci_999_low: multi_seed.ci_999_low,
            ci_999_high: multi_seed.ci_999_high,

            required_spins_01pp_95: multi_seed.required_spins_01pp_95,
            required_spins_001pp_95: multi_seed.required_spins_001pp_95,
            required_spins_01pp_99: multi_seed.required_spins_01pp_99,

            // Convert f64::INFINITY (no trigger yet) to 0.0 for JSON safety.
            fs_mean_distance: {
                let d = stats.fs_distance.mean_distance();
                if d.is_infinite() || d.is_nan() {
                    0.0
                } else {
                    d
                }
            },
            fs_max_distance: stats.fs_distance.max_distance(),
            hnw_mean_distance: {
                let d = stats.hnw_distance.mean_distance();
                if d.is_infinite() || d.is_nan() {
                    0.0
                } else {
                    d
                }
            },
            hnw_max_distance: stats.hnw_distance.max_distance(),
        }
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── HDR histogram ──────────────────────────────────────────────────────────

    #[test]
    fn test_hdr_no_win_bucket() {
        let h = HdrHistogram::default();
        h.record(0.0);
        h.record(0.0);
        assert_eq!(h.get(0), 2);
        for i in 1..HDR_BUCKET_COUNT {
            assert_eq!(h.get(i), 0, "bucket {i} should be empty");
        }
    }

    #[test]
    fn test_hdr_boundary_values() {
        let h = HdrHistogram::default();
        h.record(0.1);
        assert_eq!(h.get(2), 1, "0.1 → bucket 2");
        h.record(0.05);
        assert_eq!(h.get(1), 1, "0.05 → bucket 1");
        h.record(50000.0);
        assert_eq!(h.get(31), 1, "50000 → bucket 31");
        h.record(99999.0);
        assert_eq!(h.get(31), 2, "99999 → bucket 31");
    }

    #[test]
    fn test_hdr_total_matches_records() {
        let h = HdrHistogram::default();
        for win in [0.0, 1.5, 10.0, 100.0, 1000.0, 0.0, 5.0] {
            h.record(win);
        }
        assert_eq!(h.total(), 7);
    }

    #[test]
    fn test_hdr_merge() {
        let h1 = HdrHistogram::default();
        let h2 = HdrHistogram::default();
        h1.record(1.0); // bucket 5 (≥1.0, <2.0 → crosses 4 thresholds → b=5)
        h2.record(1.0);
        h1.merge(&h2);
        assert_eq!(h1.get(5), 2);
    }

    #[test]
    fn test_hdr_snapshot_matches_get() {
        let h = HdrHistogram::default();
        for i in 0..HDR_BUCKET_COUNT {
            for _ in 0..i {
                h.counts[i].fetch_add(1, Ordering::Relaxed);
            }
        }
        let snap = h.snapshot();
        for i in 0..HDR_BUCKET_COUNT {
            assert_eq!(snap[i], h.get(i));
        }
    }

    #[test]
    fn test_hdr_1m_spins_no_panic() {
        let stats = AtomicStats::new();
        let mut rng = crate::rng::SlotRng::new(777);
        for _ in 0..1_000_000 {
            let win = rng.random() * 200.0;
            stats.record_win_hdr(win);
        }
        assert_eq!(stats.hdr.total(), 1_000_000);
    }

    // ── HDR quantile ──────────────────────────────────────────────────────────

    #[test]
    fn test_hdr_quantile_empty() {
        let h = HdrHistogram::default();
        assert_eq!(h.quantile(0.5), 0.0, "empty histogram → 0");
    }

    #[test]
    fn test_hdr_quantile_all_no_win() {
        let h = HdrHistogram::default();
        for _ in 0..1000 {
            h.record(0.0);
        }
        assert_eq!(h.quantile(0.5), 0.0, "all no-win → median is 0");
        assert_eq!(h.quantile(0.99), 0.0);
    }

    #[test]
    fn test_hdr_quantile_known_distribution() {
        // Record 1000 values uniformly across [0, 10). Median should be ~5.
        let h = HdrHistogram::default();
        // Put 500 in bucket covering 0, 500 in bucket covering 10.0.
        for _ in 0..500 {
            h.record(0.0); // no-win bucket
        }
        for _ in 0..500 {
            h.record(10.0); // bucket covering [10, 15)
        }
        // P50 = 0.5 * 1000 = 500th element → falls on boundary between 0 and 10+.
        // After 500 no-wins, cumulative = 500 = target → we return 0.0.
        // P51+ would return something in the 10.0 bucket.
        let p50 = h.quantile(0.50);
        assert!(p50 <= 10.0, "p50={p50}");
        let p75 = h.quantile(0.75);
        assert!(p75 >= 10.0, "p75={p75} should be in the 10+ range");
    }

    #[test]
    fn test_hdr_quantile_monotone() {
        let h = HdrHistogram::default();
        let mut rng = crate::rng::SlotRng::new(42);
        for _ in 0..100_000 {
            let w = if rng.random() < 0.3 {
                0.0
            } else {
                rng.random() * 500.0
            };
            h.record(w);
        }
        let q = [0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 0.999];
        let mut prev = 0.0f64;
        for &p in &q {
            let v = h.quantile(p);
            assert!(v >= prev, "quantile not monotone at p={p}: {prev} → {v}");
            prev = v;
        }
    }

    // ── HDR CDF ────────────────────────────────────────────────────────────────

    #[test]
    fn test_hdr_cdf_empty() {
        let h = HdrHistogram::default();
        assert!(h.cdf().is_empty());
    }

    #[test]
    fn test_hdr_cdf_monotone() {
        let h = HdrHistogram::default();
        let mut rng = crate::rng::SlotRng::new(999);
        for _ in 0..100_000 {
            h.record(rng.random() * 200.0);
        }
        let cdf = h.cdf();
        assert_eq!(cdf.len(), HDR_BUCKET_COUNT);
        let mut prev_cum = 0.0f64;
        for entry in &cdf {
            assert!(
                entry.cumulative >= prev_cum - 1e-9,
                "CDF not monotone: {prev_cum} → {}",
                entry.cumulative
            );
            prev_cum = entry.cumulative;
        }
        assert!(
            (prev_cum - 1.0).abs() < 1e-9,
            "Final CDF cumulative = {prev_cum}, expected ~1.0"
        );
    }

    // ── AtomicStats HDR merge ─────────────────────────────────────────────────

    #[test]
    fn test_atomic_stats_merge_hdr() {
        let a = AtomicStats::new();
        let b = AtomicStats::new();
        a.record_win_hdr(5.0);
        b.record_win_hdr(5.0);
        a.merge(&b);
        assert_eq!(a.hdr.get(8), 2);
    }

    // ── PARMetrics from_stats ─────────────────────────────────────────────────

    #[test]
    fn test_par_metrics_rtp() {
        let stats = AtomicStats::new();
        stats.total_wagered.store(1_000_000, Ordering::Relaxed);
        stats.total_won.store(960_000, Ordering::Relaxed);
        stats.total_base_won.store(600_000, Ordering::Relaxed);
        stats.total_fs_won.store(360_000, Ordering::Relaxed);
        stats.winning_spins.store(330_000, Ordering::Relaxed);
        stats.total_spins.store(1_000_000, Ordering::Relaxed);

        let multi = MultiSeedStats::default();
        let par = PARMetrics::from_stats(&stats, &multi, 1);

        assert!(
            (par.total_rtp - 96.0).abs() < 1e-6,
            "total_rtp={}",
            par.total_rtp
        );
        assert!(
            (par.base_rtp - 60.0).abs() < 1e-6,
            "base_rtp={}",
            par.base_rtp
        );
        assert!((par.fs_rtp - 36.0).abs() < 1e-6, "fs_rtp={}", par.fs_rtp);
        assert!(
            (par.hit_rate - 33.0).abs() < 1e-4,
            "hit_rate={}",
            par.hit_rate
        );
    }

    // ── WelfordAccumulator ────────────────────────────────────────────────────

    #[test]
    fn welford_empty_safe() {
        let w = WelfordAccumulator::new();
        assert_eq!(w.count(), 0);
        assert_eq!(w.mean(), 0.0);
        assert_eq!(w.sample_variance(), 0.0);
        assert_eq!(w.skewness(), 0.0);
        assert_eq!(w.excess_kurtosis(), 0.0);
    }

    #[test]
    fn welford_single_value() {
        let mut w = WelfordAccumulator::new();
        w.push(42.0);
        assert_eq!(w.count(), 1);
        assert!((w.mean() - 42.0).abs() < 1e-12);
        assert_eq!(w.sample_variance(), 0.0, "variance of 1 sample = 0");
    }

    #[test]
    fn welford_two_values() {
        let mut w = WelfordAccumulator::new();
        w.push(2.0);
        w.push(4.0);
        assert!((w.mean() - 3.0).abs() < 1e-12);
        // sample var = ((2-3)^2 + (4-3)^2) / (2-1) = 2/1 = 2
        assert!((w.sample_variance() - 2.0).abs() < 1e-12);
    }

    #[test]
    fn welford_uniform_1m_samples() {
        // Uniform[0,1]: mean=0.5, var=1/12≈0.0833, skewness=0, excess_kurtosis=-1.2.
        let mut w = WelfordAccumulator::new();
        let mut rng = crate::rng::SlotRng::new(12345);
        for _ in 0..1_000_000 {
            w.push(rng.random());
        }
        assert!((w.mean() - 0.5).abs() < 0.002, "mean={}", w.mean());
        assert!(
            (w.population_variance() - 1.0 / 12.0).abs() < 0.001,
            "var={}",
            w.population_variance()
        );
        assert!(w.skewness().abs() < 0.02, "skew={}", w.skewness());
        assert!(
            (w.excess_kurtosis() - (-1.2)).abs() < 0.05,
            "excess_kurt={}",
            w.excess_kurtosis()
        );
    }

    #[test]
    fn welford_merge_equivalence() {
        // Split 100k values 50/50 across two accumulators, merge, compare to single-pass.
        let mut rng = crate::rng::SlotRng::new(7);
        let values: Vec<f64> = (0..100_000).map(|_| rng.random() * 100.0).collect();

        let mut single = WelfordAccumulator::new();
        for &v in &values {
            single.push(v);
        }

        let mut half1 = WelfordAccumulator::new();
        let mut half2 = WelfordAccumulator::new();
        for &v in &values[..50_000] {
            half1.push(v);
        }
        for &v in &values[50_000..] {
            half2.push(v);
        }
        half1.merge(&half2);

        assert!((half1.mean() - single.mean()).abs() < 1e-8, "mean mismatch");
        assert!(
            (half1.population_variance() - single.population_variance()).abs() < 1e-6,
            "variance mismatch"
        );
        assert!(
            (half1.skewness() - single.skewness()).abs() < 1e-4,
            "skewness mismatch"
        );
    }

    #[test]
    fn welford_volatility_category_correct() {
        let mut w = WelfordAccumulator::new();
        // All same value → CV=0 → VERY_LOW.
        for _ in 0..100 {
            w.push(5.0);
        }
        assert_eq!(w.volatility_category(), "VERY_LOW");
    }

    // ── TopNWins ───────────────────────────────────────────────────────────────

    #[test]
    fn top_wins_empty() {
        let t = TopNWins::new(5);
        assert!(t.snapshot().is_empty());
        assert!(t.is_empty());
    }

    #[test]
    fn top_wins_skips_zero_and_negative() {
        let t = TopNWins::new(5);
        t.try_record(0.0, 1, 1);
        t.try_record(-1.0, 2, 2);
        assert!(t.is_empty());
    }

    #[test]
    fn top_wins_keeps_largest() {
        let t = TopNWins::new(3);
        for i in 1u64..=10 {
            t.try_record(i as f64, i, i);
        }
        let snap = t.snapshot();
        assert_eq!(snap.len(), 3);
        // Should be [10, 9, 8] sorted descending.
        assert!((snap[0].win_x - 10.0).abs() < 1e-9);
        assert!((snap[1].win_x - 9.0).abs() < 1e-9);
        assert!((snap[2].win_x - 8.0).abs() < 1e-9);
    }

    #[test]
    fn top_wins_merge() {
        let t1 = TopNWins::new(3);
        let t2 = TopNWins::new(3);
        t1.try_record(5.0, 1, 1);
        t1.try_record(3.0, 2, 2);
        t2.try_record(10.0, 3, 3);
        t2.try_record(1.0, 4, 4);
        t1.merge_from(&t2);
        let snap = t1.snapshot();
        assert_eq!(snap.len(), 3);
        assert!((snap[0].win_x - 10.0).abs() < 1e-9);
    }

    // ── BonusDistanceTracker ──────────────────────────────────────────────────

    #[test]
    fn bonus_distance_first_trigger_no_interval() {
        let t = BonusDistanceTracker::new();
        t.record_trigger(100);
        assert_eq!(
            t.total_intervals(),
            0,
            "first trigger should not record an interval"
        );
    }

    #[test]
    fn bonus_distance_two_triggers() {
        let t = BonusDistanceTracker::new();
        t.record_trigger(100);
        t.record_trigger(200);
        assert_eq!(t.total_intervals(), 1);
        assert!((t.mean_distance() - 100.0).abs() < 1e-9);
        assert_eq!(t.max_distance(), 100);
    }

    #[test]
    fn bonus_distance_multiple_triggers() {
        let t = BonusDistanceTracker::new();
        t.record_trigger(0);
        t.record_trigger(50); // dist=50
        t.record_trigger(150); // dist=100
        t.record_trigger(400); // dist=250
        assert_eq!(t.total_intervals(), 3);
        // mean = (50+100+250)/3 = 400/3 ≈ 133.3
        assert!((t.mean_distance() - 400.0 / 3.0).abs() < 0.01);
        assert_eq!(t.max_distance(), 250);
    }

    // ── ConvergenceDetector ───────────────────────────────────────────────────

    #[test]
    fn convergence_not_enough_readings() {
        let mut d = ConvergenceDetector::new(0.01, 0.95, 10);
        assert!(!d.has_converged());
        d.push(96.0);
        assert!(!d.has_converged(), "single reading → not converged");
    }

    #[test]
    fn convergence_constant_readings() {
        let mut d = ConvergenceDetector::new(0.01, 0.95, 10);
        for _ in 0..10 {
            d.push(96.0); // all same → variance=0 → half_width=0 → converged
        }
        assert!(d.has_converged(), "constant readings must converge");
        assert_eq!(d.current_half_width_pp(), 0.0);
    }

    #[test]
    fn convergence_noisy_does_not_converge() {
        let mut d = ConvergenceDetector::new(0.001, 0.95, 20);
        let mut rng = crate::rng::SlotRng::new(55);
        for _ in 0..20 {
            d.push(95.0 + rng.random() * 2.0); // ±1pp noise
        }
        assert!(
            !d.has_converged(),
            "noisy readings should not converge for 0.001pp target"
        );
    }

    #[test]
    fn convergence_ring_buffer_size() {
        let mut d = ConvergenceDetector::new(0.01, 0.95, 5);
        for i in 0..10 {
            d.push(96.0 + i as f64 * 0.001);
        }
        assert_eq!(d.readings(), 5, "ring buffer must not exceed window_size");
    }

    #[test]
    fn convergence_reset() {
        let mut d = ConvergenceDetector::new(0.01, 0.95, 5);
        for _ in 0..5 {
            d.push(96.0);
        }
        assert!(d.has_converged());
        d.reset();
        assert_eq!(d.readings(), 0);
        assert!(!d.has_converged());
    }

    // ── SpinCountEstimator ────────────────────────────────────────────────────

    #[test]
    fn spin_count_estimator_larger_variance_more_spins() {
        let n_low = SpinCountEstimator::required_for_rtp(1.0, 0.1, 0.95);
        let n_high = SpinCountEstimator::required_for_rtp(10.0, 0.1, 0.95);
        assert!(n_high > n_low, "higher variance → more spins required");
    }

    #[test]
    fn spin_count_estimator_tighter_target_more_spins() {
        let n_loose = SpinCountEstimator::required_for_rtp(1.0, 0.5, 0.95);
        let n_tight = SpinCountEstimator::required_for_rtp(1.0, 0.01, 0.95);
        assert!(n_tight > n_loose, "tighter target → more spins required");
    }

    #[test]
    fn spin_count_estimator_99_more_than_95() {
        let n95 = SpinCountEstimator::required_for_rtp(1.0, 0.1, 0.95);
        let n99 = SpinCountEstimator::required_for_rtp(1.0, 0.1, 0.99);
        assert!(n99 > n95, "higher confidence → more spins");
    }

    #[test]
    fn spin_count_estimator_hit_rate() {
        // p=0.5 (max variance) should need more spins than p=0.1.
        let n_p05 = SpinCountEstimator::required_for_hit_rate(0.5, 0.001, 0.95);
        let n_p01 = SpinCountEstimator::required_for_hit_rate(0.1, 0.001, 0.95);
        assert!(
            n_p05 > n_p01,
            "max-variance p=0.5 needs more spins than p=0.1"
        );
    }

    // ── MultiSeedStats CI ─────────────────────────────────────────────────────

    #[test]
    fn multi_seed_ci_99_wider_than_ci_95() {
        let seeds: Vec<SeedStats> = (0..20)
            .map(|i| SeedStats {
                spins: 100_000,
                wagered: 100_000,
                won: 96_000 + i * 10,
                rtp: 96.0 + i as f64 * 0.01,
            })
            .collect();
        let m = MultiSeedStats::from_seeds(seeds);
        let width_95 = m.ci_95_high - m.ci_95_low;
        let width_99 = m.ci_99_high - m.ci_99_low;
        let width_999 = m.ci_999_high - m.ci_999_low;
        assert!(
            width_99 > width_95,
            "CI99 must be wider than CI95: {} vs {}",
            width_99,
            width_95
        );
        assert!(
            width_999 > width_99,
            "CI99.9 must be wider than CI99: {} vs {}",
            width_999,
            width_99
        );
    }

    #[test]
    fn multi_seed_ci_straddles_mean() {
        let rtps = [96.0f64; 10];
        let seeds: Vec<SeedStats> = rtps
            .iter()
            .map(|&r| SeedStats {
                spins: 100_000,
                wagered: 100_000,
                won: 96_000,
                rtp: r,
            })
            .collect();
        let m = MultiSeedStats::from_seeds(seeds);
        // All RTPs identical → CI collapses to mean.
        assert!((m.ci_95_low - 96.0).abs() < 1e-6);
        assert!((m.ci_95_high - 96.0).abs() < 1e-6);
    }

    // ── record_win_full + Welford integration ─────────────────────────────────

    #[test]
    fn record_win_full_updates_welford() {
        let stats = AtomicStats::new();
        for i in 1..=100u64 {
            stats.record_win_full(i as f64, 0, i);
        }
        let w = stats.get_welford();
        assert_eq!(w.count(), 100);
        // Mean of 1..=100 = 50.5.
        assert!((w.mean() - 50.5).abs() < 1e-6, "mean={}", w.mean());
    }

    #[test]
    fn record_win_full_updates_top_wins() {
        let stats = AtomicStats::new();
        for i in 1..=100u64 {
            stats.record_win_full(i as f64, i, i);
        }
        let snap = stats.top_wins.snapshot();
        assert_eq!(snap.len(), 25, "TopNWins default capacity = 25");
        assert!((snap[0].win_x - 100.0).abs() < 1e-9, "largest = 100");
    }

    #[test]
    fn merge_welford_batch_equivalent_to_record_win_full() {
        let stats_full = AtomicStats::new();
        let stats_batch = AtomicStats::new();
        let mut rng = crate::rng::SlotRng::new(99);
        let mut local = WelfordAccumulator::new();

        for i in 0..10_000u64 {
            let w = rng.random() * 100.0;
            stats_full.record_win_full(w, 0, i);
            local.push(w);
        }
        stats_batch.merge_welford_batch(&local);

        let wf = stats_full.get_welford();
        let wb = stats_batch.get_welford();
        assert!((wf.mean() - wb.mean()).abs() < 1e-8, "mean mismatch");
        assert!(
            (wf.population_variance() - wb.population_variance()).abs() < 1e-6,
            "variance mismatch"
        );
    }

    // ── Bonus distance integration ─────────────────────────────────────────────

    #[test]
    fn bonus_distance_via_atomic_stats() {
        let stats = AtomicStats::new();
        for i in 0..10u64 {
            stats.record_fs_trigger(i * 100);
        }
        // 9 intervals of length 100.
        assert_eq!(stats.fs_distance.total_intervals(), 9);
        assert!((stats.fs_distance.mean_distance() - 100.0).abs() < 1e-6);
    }
}
