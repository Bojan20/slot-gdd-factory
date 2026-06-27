//! Hot/cold struct layout for cache-line-aware simulation.
//!
//! ## Motivation
//!
//! A tight Monte Carlo loop accesses a small set of fields on every iteration
//! (RNG state, current grid, win accumulator) and rarely touches the rest
//! (total spins, current seed, statistics pointers).  When "hot" and "cold"
//! fields share a struct, the CPU loads both into L1 cache — wasting capacity
//! and increasing eviction pressure.
//!
//! Splitting into `SpinHot` (64 bytes, one cache line) and `SpinCold` (rarely
//! touched aggregate counters) ensures the tight loop operates entirely within
//! L1 cache.
//!
//! ## Layout guarantee
//!
//! A compile-time assertion (`const _`) verifies `sizeof(SpinHot) == 64` so
//! we know exactly one cache line is occupied.  The `#[repr(C, align(64))]`
//! attribute guarantees the struct starts on a cache-line boundary.
//!
//! ## Field order
//!
//! Ordered largest → smallest alignment to avoid implicit padding:
//! - `grid: PackedGrid` (u128, align 16)   → bytes  0–15
//! - `rng_state: u64`   (align  8)         → bytes 16–23
//! - `base_win: i64`    (align  8)         → bytes 24–31
//! - `multiplier: u32`  (align  4)         → bytes 32–35
//! - `scatter_count: u8`                   → byte  36
//! - `bonus_count: u8`                     → byte  37
//! - `fs_triggered: bool`                  → byte  38
//! - `hnw_triggered: bool`                 → byte  39
//! - `_pad: [u8; 24]`                      → bytes 40–63
//! Total: 64 bytes ✓

use super::packed_grid::PackedGrid;

// ─── SpinHot ──────────────────────────────────────────────────────────────────

/// Frequently-accessed simulation state — exactly one 64-byte cache line.
///
/// Place in a `Box<SpinHot>` or at the start of a worker struct so it
/// occupies its own cache line and avoids false-sharing.
#[derive(Clone)]
#[repr(C, align(64))]
pub struct SpinHot {
    /// Packed grid for the current spin.
    pub grid: PackedGrid, // u128, align 16 → bytes  0–15
    /// Current RNG state snapshot (for debugging / replay).
    pub rng_state: u64, //       align  8 → bytes 16–23
    /// Current spin base win (millicredits, bet-scaled).
    pub base_win: i64, //       align  8 → bytes 24–31
    /// Active win multiplier (1 = no multiplier applied).
    pub multiplier: u32, //       align  4 → bytes 32–35
    /// Scatter symbol count on the current grid.
    pub scatter_count: u8, //                  byte  36
    /// Bonus symbol count on the current grid.
    pub bonus_count: u8, //                  byte  37
    /// Free-spin feature was triggered this spin.
    pub fs_triggered: bool, //                  byte  38
    /// Hold-and-Win feature was triggered this spin.
    pub hnw_triggered: bool, //                  byte  39
    #[allow(dead_code)]
    _pad: [u8; 24], //                  bytes 40–63
}

// Compile-time layout verification.
const _: () = assert!(
    std::mem::size_of::<SpinHot>() == 64,
    "SpinHot must be exactly 64 bytes (one cache line)"
);

impl SpinHot {
    /// Create a zeroed `SpinHot`.
    #[inline]
    pub const fn new() -> Self {
        SpinHot {
            grid: PackedGrid(0),
            rng_state: 0,
            base_win: 0,
            multiplier: 1,
            scatter_count: 0,
            bonus_count: 0,
            fs_triggered: false,
            hnw_triggered: false,
            _pad: [0u8; 24],
        }
    }

    /// Reset to "start of spin" state — clears win and feature flags.
    #[inline(always)]
    pub fn reset_spin(&mut self) {
        self.base_win = 0;
        self.multiplier = 1;
        self.scatter_count = 0;
        self.bonus_count = 0;
        self.fs_triggered = false;
        self.hnw_triggered = false;
    }

    /// Final win after applying multiplier.
    #[inline(always)]
    pub fn final_win(&self) -> i64 {
        self.base_win * self.multiplier as i64
    }
}

impl Default for SpinHot {
    fn default() -> Self {
        Self::new()
    }
}

// ─── SpinCold ─────────────────────────────────────────────────────────────────

/// Rarely-accessed simulation context — aggregate counters and seed info.
///
/// Kept out of `SpinHot` so it doesn't pollute the L1 hot path.
/// Access patterns: read once at construction, written once at end.
#[derive(Debug, Clone, Default)]
pub struct SpinCold {
    /// Total number of spins to simulate.
    pub total_spins: u64,
    /// Spins already completed.
    pub spins_done: u64,
    /// Total wagered (millicredits).
    pub total_wagered: i64,
    /// Total won (millicredits).
    pub total_won: i64,
    /// Current RNG seed (for reproducibility).
    pub current_seed: u64,
    /// Bet per spin (millicredits).
    pub bet_mc: i64,
    /// Free-spin trigger count.
    pub fs_triggers: u64,
    /// Hold-and-Win trigger count.
    pub hnw_triggers: u64,
}

impl SpinCold {
    /// Update aggregate counters with one spin's result.
    #[inline(always)]
    pub fn record(&mut self, hot: &SpinHot) {
        self.spins_done += 1;
        self.total_wagered = self.total_wagered.saturating_add(self.bet_mc);
        self.total_won = self.total_won.saturating_add(hot.final_win());
        if hot.fs_triggered {
            self.fs_triggers += 1;
        }
        if hot.hnw_triggered {
            self.hnw_triggers += 1;
        }
    }

    /// RTP as percentage.
    #[inline]
    pub fn rtp_pct(&self) -> f64 {
        if self.total_wagered == 0 {
            return 0.0;
        }
        self.total_won as f64 / self.total_wagered as f64 * 100.0
    }
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spin_hot_is_exactly_64_bytes() {
        assert_eq!(std::mem::size_of::<SpinHot>(), 64);
    }

    #[test]
    fn spin_hot_is_cache_line_aligned() {
        assert_eq!(std::mem::align_of::<SpinHot>(), 64);
    }

    #[test]
    fn spin_hot_default_zeroed() {
        let h = SpinHot::new();
        assert_eq!(h.base_win, 0);
        assert_eq!(h.multiplier, 1);
        assert_eq!(h.scatter_count, 0);
        assert!(!h.fs_triggered);
    }

    #[test]
    fn reset_spin_clears_all_per_spin_fields() {
        let mut h = SpinHot::new();
        h.base_win = 50_000;
        h.multiplier = 3;
        h.scatter_count = 3;
        h.fs_triggered = true;
        h.reset_spin();
        assert_eq!(h.base_win, 0);
        assert_eq!(h.multiplier, 1);
        assert_eq!(h.scatter_count, 0);
        assert!(!h.fs_triggered);
    }

    #[test]
    fn final_win_applies_multiplier() {
        let mut h = SpinHot::new();
        h.base_win = 10_000;
        h.multiplier = 5;
        assert_eq!(h.final_win(), 50_000);
    }

    #[test]
    fn spin_cold_record_accumulates() {
        let mut cold = SpinCold {
            bet_mc: 1_000,
            ..Default::default()
        };
        let mut hot = SpinHot::new();
        hot.base_win = 2_000;
        hot.multiplier = 1;
        cold.record(&hot);
        cold.record(&hot);
        assert_eq!(cold.spins_done, 2);
        assert_eq!(cold.total_wagered, 2_000);
        assert_eq!(cold.total_won, 4_000);
    }

    #[test]
    fn spin_cold_rtp_100pct() {
        let mut cold = SpinCold {
            bet_mc: 1_000,
            ..Default::default()
        };
        let mut hot = SpinHot::new();
        hot.base_win = 1_000; // win = bet → 100% RTP
        hot.multiplier = 1;
        for _ in 0..1_000 {
            cold.record(&hot);
        }
        assert!((cold.rtp_pct() - 100.0).abs() < 1e-9);
    }
}
