// Universal SimStats — per-game stats schema. Reused for any IR.
//
// Game-specific labels (CE FS trigger, Wolf Run FK bonus etc.) are emitted
// as `events` strings; SimStats aggregates counters by event name so
// downstream `aggregate.py` can diff against any PAR ground truth.

use std::collections::HashMap;

#[derive(Debug, Clone, Default)]
pub struct SimStats {
    pub spins: u64,
    /// Total payout in total-bet units (RTP = total / spins).
    pub total_payout_x: f64,
    /// Sum of base-game payout (line wins + scatter + pattern).
    pub base_x: f64,
    /// Per-feature-name payout sums (e.g. "hold_and_win_base", "free_spins", "pick_bonus").
    pub feature_x: HashMap<String, f64>,
    /// Per-event-name occurrence counters.
    pub event_count: HashMap<String, u64>,
    pub hits: u64,
    pub wins: u64,
    pub max_single_x: f64,
    /// Volatility buckets — N at each threshold.
    pub wins_ge_10x: u64,
    pub wins_ge_20x: u64,
    pub wins_ge_50x: u64,
    pub wins_ge_100x: u64,
    pub wins_ge_200x: u64,
    pub wins_ge_500x: u64,
    pub wins_ge_1000x: u64,
}

impl SimStats {
    pub fn rtp(&self) -> f64 {
        if self.spins == 0 { 0.0 } else { self.total_payout_x / self.spins as f64 }
    }
    pub fn hit_freq(&self) -> f64 {
        if self.spins == 0 { 0.0 } else { self.hits as f64 / self.spins as f64 }
    }
    pub fn win_freq(&self) -> f64 {
        if self.spins == 0 { 0.0 } else { self.wins as f64 / self.spins as f64 }
    }

    pub fn record(&mut self, spin_x: f64) {
        self.total_payout_x += spin_x;
        if spin_x > self.max_single_x { self.max_single_x = spin_x; }
        if spin_x > 0.0 { self.hits += 1; }
        if spin_x > 1.0 { self.wins += 1; }
        if spin_x >= 10.0 { self.wins_ge_10x += 1; }
        if spin_x >= 20.0 { self.wins_ge_20x += 1; }
        if spin_x >= 50.0 { self.wins_ge_50x += 1; }
        if spin_x >= 100.0 { self.wins_ge_100x += 1; }
        if spin_x >= 200.0 { self.wins_ge_200x += 1; }
        if spin_x >= 500.0 { self.wins_ge_500x += 1; }
        if spin_x >= 1000.0 { self.wins_ge_1000x += 1; }
        self.spins += 1;
    }

    pub fn merge(&mut self, other: &SimStats) {
        self.spins += other.spins;
        self.total_payout_x += other.total_payout_x;
        self.base_x += other.base_x;
        for (k, v) in &other.feature_x {
            *self.feature_x.entry(k.clone()).or_insert(0.0) += v;
        }
        for (k, v) in &other.event_count {
            *self.event_count.entry(k.clone()).or_insert(0) += v;
        }
        self.hits += other.hits;
        self.wins += other.wins;
        if other.max_single_x > self.max_single_x { self.max_single_x = other.max_single_x; }
        self.wins_ge_10x += other.wins_ge_10x;
        self.wins_ge_20x += other.wins_ge_20x;
        self.wins_ge_50x += other.wins_ge_50x;
        self.wins_ge_100x += other.wins_ge_100x;
        self.wins_ge_200x += other.wins_ge_200x;
        self.wins_ge_500x += other.wins_ge_500x;
        self.wins_ge_1000x += other.wins_ge_1000x;
    }
}
