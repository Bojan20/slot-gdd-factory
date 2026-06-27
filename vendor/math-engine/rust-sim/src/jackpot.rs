//! Jackpot Manager — Fixed, Progressive, Pooled.
//!
//! Three architecturally distinct jackpot types:
//!
//! * **Fixed** — always pays `seed_amount_x` when triggered. Pool never
//!   accumulates. Analytical closed-form: E[RTP] = p × v.
//!
//! * **Progressive** — starts at `seed_amount_x`, grows by
//!   `contribution_rate` × wager per spin, resets to seed on hit.
//!   Average payout (in steady state) depends on hit frequency and
//!   contribution rate — use the Markov solver in Faza 6 for exact math.
//!
//! * **Pooled** — like Progressive but shared across games / sessions.
//!   Modelled with an explicit `pool_id`; caller merges pools externally.
//!
//! All types are fully serialisable so PAR sheets can round-trip them.
//! Thread safety: all mutable state uses `AtomicI64` / `AtomicU64` so
//! the manager can be placed in an `Arc` and shared across Rayon threads.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::Arc;

// ─── Configuration types ─────────────────────────────────────────────────────

/// Which jackpot mechanic this tier uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JackpotKind {
    /// Always pays `seed_amount_x` when triggered. No pool growth.
    Fixed,
    /// Pool grows with contributions; resets to `seed_amount_x` on hit.
    Progressive,
    /// Like Progressive, but shared across a named pool (`pool_id`).
    Pooled,
}

/// Trigger condition that fires a jackpot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum JackpotTrigger {
    /// Hit with a fixed probability per qualifying spin (e.g., 1/50_000).
    RandomPick { probability: f64 },
    /// Granted when the total win multiplier for a spin ≥ threshold.
    WinMultiplierThreshold { min_win_x: f64 },
    /// Fired by the Hold & Win feature reaching a full grid — handled
    /// externally via `JackpotManager::record_hnw_hit()`.
    HoldAndWinFull,
    /// A specific symbol combination (modelled as equivalent to RandomPick).
    SymbolCombo { probability: f64 },
}

/// Full configuration for one jackpot tier.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JackpotTierConfig {
    /// Unique id — matches `JackpotTier.id` in the IR (e.g., "grand").
    pub id: String,
    /// Human-readable label (e.g., "GRAND JACKPOT").
    pub name: String,
    pub kind: JackpotKind,
    pub trigger: JackpotTrigger,
    /// Starting / reset amount in bet multiples.
    pub seed_amount_x: f64,
    /// Fraction of each wager contributed (Progressive / Pooled only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contribution_rate: Option<f64>,
    /// Optional hard cap on the pool (never exceeds this value).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cap_x: Option<f64>,
    /// For Pooled: shared pool identifier (caller manages cross-instance sync).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pool_id: Option<String>,
}

// ─── Runtime state ────────────────────────────────────────────────────────────

/// Micro-units scale factor: 1 bet-multiple = 1_000_000 µ-units.
/// Enables fixed-point atomic arithmetic without float races.
const MICRO: f64 = 1_000_000.0;

/// Thread-safe runtime state for one jackpot tier.
pub struct JackpotTierState {
    /// Current pool value in µ-units (fixed-point, atomic).
    pool_micro: AtomicI64,
    /// Total hits recorded across all spins.
    pub hits: AtomicU64,
    /// Total payout in µ-units across all hits.
    total_paid_micro: AtomicI64,
    /// Total contribution received in µ-units.
    total_contributed_micro: AtomicI64,
}

impl Default for JackpotTierState {
    fn default() -> Self {
        Self {
            pool_micro: AtomicI64::new(0),
            hits: AtomicU64::new(0),
            total_paid_micro: AtomicI64::new(0),
            total_contributed_micro: AtomicI64::new(0),
        }
    }
}

impl JackpotTierState {
    pub fn new(seed_x: f64) -> Self {
        Self {
            pool_micro: AtomicI64::new((seed_x * MICRO) as i64),
            ..Default::default()
        }
    }

    /// Current pool value in bet multiples.
    pub fn pool_value(&self) -> f64 {
        self.pool_micro.load(Ordering::Relaxed) as f64 / MICRO
    }

    /// Total contributed in bet multiples (for testing).
    pub fn total_contributed(&self) -> f64 {
        self.total_contributed_micro.load(Ordering::Relaxed) as f64 / MICRO
    }

    /// Add progressive contribution from one wager.
    pub fn contribute(&self, wager: f64, rate: f64, cap_x: Option<f64>) {
        let delta = (wager * rate * MICRO) as i64;
        let new = self.pool_micro.fetch_add(delta, Ordering::Relaxed) + delta;
        self.total_contributed_micro
            .fetch_add(delta, Ordering::Relaxed);

        // Enforce cap via saturating clamp (best-effort; may overshoot by one delta).
        if let Some(cap) = cap_x {
            let cap_micro = (cap * MICRO) as i64;
            if new > cap_micro {
                // Try to clamp — race-tolerant, conservative (never below cap).
                let _ = self.pool_micro.compare_exchange(
                    new,
                    cap_micro,
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                );
            }
        }
    }

    /// Evaluate trigger and, if fired, record the hit and return payout.
    ///
    /// * `rng_val` — a pre-drawn uniform `[0, 1)` value for this tier.
    /// * `win_mult` — total win multiplier for the current spin.
    pub fn try_hit(&self, config: &JackpotTierConfig, rng_val: f64, win_mult: f64) -> Option<f64> {
        let triggered = match &config.trigger {
            JackpotTrigger::RandomPick { probability } => rng_val < *probability,
            JackpotTrigger::SymbolCombo { probability } => rng_val < *probability,
            JackpotTrigger::WinMultiplierThreshold { min_win_x } => win_mult >= *min_win_x,
            JackpotTrigger::HoldAndWinFull => false, // handled via record_hnw_hit
        };

        if !triggered {
            return None;
        }

        Some(self.do_hit(config))
    }

    /// Force-record a hit (used by H&W full-grid path and tests).
    pub fn record_hit(&self, config: &JackpotTierConfig) -> f64 {
        self.do_hit(config)
    }

    fn do_hit(&self, config: &JackpotTierConfig) -> f64 {
        let payout = match config.kind {
            JackpotKind::Fixed => config.seed_amount_x,
            JackpotKind::Progressive | JackpotKind::Pooled => {
                let current = self.pool_micro.load(Ordering::Relaxed);
                // Reset to seed.
                self.pool_micro
                    .store((config.seed_amount_x * MICRO) as i64, Ordering::Relaxed);
                current as f64 / MICRO
            }
        };

        self.hits.fetch_add(1, Ordering::Relaxed);
        self.total_paid_micro
            .fetch_add((payout * MICRO) as i64, Ordering::Relaxed);

        payout
    }
}

// ─── Manager ──────────────────────────────────────────────────────────────────

/// Full jackpot system managing all configured tiers.
///
/// Wrap in `Arc` for use across Rayon threads.
pub struct JackpotManager {
    pub configs: Vec<JackpotTierConfig>,
    pub states: Vec<Arc<JackpotTierState>>,
}

impl JackpotManager {
    pub fn new(configs: Vec<JackpotTierConfig>) -> Self {
        let states = configs
            .iter()
            .map(|c| Arc::new(JackpotTierState::new(c.seed_amount_x)))
            .collect();
        JackpotManager { configs, states }
    }

    /// Evaluate triggers for all tiers on one spin.
    ///
    /// `rng_vals[i]` — pre-drawn uniform `[0, 1)` for tier `i`.
    /// Returns `(tier_id, payout_x)` for each triggered tier.
    pub fn on_spin(&self, rng_vals: &[f64], win_mult: f64) -> Vec<(String, f64)> {
        let mut hits = Vec::new();
        for (i, (cfg, state)) in self.configs.iter().zip(self.states.iter()).enumerate() {
            let rv = rng_vals.get(i).copied().unwrap_or(1.0);
            if let Some(payout) = state.try_hit(cfg, rv, win_mult) {
                hits.push((cfg.id.clone(), payout));
            }
        }
        hits
    }

    /// Contribute to all progressive/pooled tiers for one wager unit.
    pub fn contribute_all(&self, wager: f64) {
        for (cfg, state) in self.configs.iter().zip(self.states.iter()) {
            if let Some(rate) = cfg.contribution_rate {
                state.contribute(wager, rate, cfg.cap_x);
            }
        }
    }

    /// Force a Hold & Win full-grid jackpot hit for a given tier id.
    pub fn record_hnw_hit(&self, tier_id: &str) -> Option<f64> {
        for (cfg, state) in self.configs.iter().zip(self.states.iter()) {
            if cfg.id == tier_id {
                return Some(state.record_hit(cfg));
            }
        }
        None
    }

    /// Snapshot metrics for PAR sheet generation.
    pub fn metrics(&self, total_spins: u64) -> Vec<JackpotMetrics> {
        self.configs
            .iter()
            .zip(self.states.iter())
            .map(|(cfg, state)| {
                let hits = state.hits.load(Ordering::Relaxed);
                let paid = state.total_paid_micro.load(Ordering::Relaxed) as f64 / MICRO;
                let contributed =
                    state.total_contributed_micro.load(Ordering::Relaxed) as f64 / MICRO;
                JackpotMetrics {
                    id: cfg.id.clone(),
                    name: cfg.name.clone(),
                    kind: cfg.kind,
                    hits,
                    avg_interval: if hits > 0 {
                        total_spins as f64 / hits as f64
                    } else {
                        f64::INFINITY
                    },
                    total_paid_x: paid,
                    total_contributed_x: contributed,
                    current_pool_x: state.pool_value(),
                    contribution_rtp: if total_spins > 0 {
                        paid / total_spins as f64
                    } else {
                        0.0
                    },
                }
            })
            .collect()
    }
}

// ─── Metrics / PAR output ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JackpotMetrics {
    pub id: String,
    pub name: String,
    pub kind: JackpotKind,
    /// Total hits across the simulation.
    pub hits: u64,
    /// Average spins between hits (`Infinity` if never triggered).
    #[serde(serialize_with = "serialize_f64_inf")]
    pub avg_interval: f64,
    /// Total payout in bet multiples across all hits.
    pub total_paid_x: f64,
    /// Total contribution from progressive/pooled wagers.
    pub total_contributed_x: f64,
    /// Current pool value (relevant for Progressive/Pooled).
    pub current_pool_x: f64,
    /// Fraction of total wagered returned via this jackpot tier.
    pub contribution_rtp: f64,
}

fn serialize_f64_inf<S: serde::Serializer>(val: &f64, s: S) -> Result<S::Ok, S::Error> {
    if val.is_infinite() {
        s.serialize_str("Infinity")
    } else {
        s.serialize_f64(*val)
    }
}

// ─── Analytical solver ────────────────────────────────────────────────────────

/// Closed-form prediction for Fixed / RandomPick jackpots.
///
/// For hit probability `p` and payout `v` (bet multiples):
/// - `E[RTP per spin]` = p × v
/// - `E[spins between hits]` = 1 / p
/// - `Var[RTP per spin]` = p × v² × (1 − p) ≈ p × v²
///
/// Returns `None` for `WinMultiplierThreshold` or `HoldAndWinFull` triggers
/// (those require game-specific data to solve analytically).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JackpotAnalytical {
    pub id: String,
    /// Expected contribution to RTP per spin (fraction, not %).
    pub expected_rtp: f64,
    /// Expected spins between consecutive hits.
    pub expected_interval: f64,
    /// Payout in bet multiples.
    pub payout_x: f64,
    /// Per-spin hit probability.
    pub hit_probability: f64,
    /// Standard deviation of per-spin RTP contribution.
    pub rtp_std_dev: f64,
}

impl JackpotAnalytical {
    pub fn solve(config: &JackpotTierConfig) -> Option<Self> {
        let probability = match &config.trigger {
            JackpotTrigger::RandomPick { probability } => *probability,
            JackpotTrigger::SymbolCombo { probability } => *probability,
            _ => return None,
        };

        let v = config.seed_amount_x;
        let p = probability;
        let expected_rtp = p * v;
        let variance = p * v * v * (1.0 - p);

        Some(JackpotAnalytical {
            id: config.id.clone(),
            expected_rtp,
            expected_interval: if p > 0.0 { 1.0 / p } else { f64::INFINITY },
            payout_x: v,
            hit_probability: p,
            rtp_std_dev: variance.sqrt(),
        })
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed_tier(id: &str, prob: f64, payout: f64) -> JackpotTierConfig {
        JackpotTierConfig {
            id: id.to_string(),
            name: format!("{} jackpot", id),
            kind: JackpotKind::Fixed,
            trigger: JackpotTrigger::RandomPick { probability: prob },
            seed_amount_x: payout,
            contribution_rate: None,
            cap_x: None,
            pool_id: None,
        }
    }

    fn progressive_tier(id: &str, seed: f64, rate: f64) -> JackpotTierConfig {
        JackpotTierConfig {
            id: id.to_string(),
            name: format!("{} jackpot", id),
            kind: JackpotKind::Progressive,
            trigger: JackpotTrigger::RandomPick { probability: 0.001 },
            seed_amount_x: seed,
            contribution_rate: Some(rate),
            cap_x: None,
            pool_id: None,
        }
    }

    #[test]
    fn test_fixed_always_hits() {
        let cfg = fixed_tier("grand", 1.0, 1000.0);
        let mgr = JackpotManager::new(vec![cfg]);
        let hits = mgr.on_spin(&[0.5], 0.0);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].0, "grand");
        assert!((hits[0].1 - 1000.0).abs() < 1e-9);
    }

    #[test]
    fn test_fixed_never_hits() {
        let cfg = fixed_tier("grand", 0.0, 1000.0);
        let mgr = JackpotManager::new(vec![cfg]);
        let hits = mgr.on_spin(&[0.5], 0.0);
        assert!(hits.is_empty());
    }

    #[test]
    fn test_fixed_payout_unchanged_across_hits() {
        let cfg = fixed_tier("mini", 1.0, 10.0);
        let mgr = JackpotManager::new(vec![cfg]);
        // Hit 5 times — payout must be exactly 10 every time.
        for _ in 0..5 {
            let hits = mgr.on_spin(&[0.0], 0.0);
            assert_eq!(hits.len(), 1);
            assert!((hits[0].1 - 10.0).abs() < 1e-9, "hit={}", hits[0].1);
        }
    }

    #[test]
    fn test_progressive_accumulates() {
        let cfg = progressive_tier("major", 100.0, 0.01);
        let mgr = JackpotManager::new(vec![cfg]);
        // 1000 spins × 1 unit wager × 0.01 rate = +10.0
        for _ in 0..1000 {
            mgr.contribute_all(1.0);
        }
        let pool = mgr.states[0].pool_value();
        assert!((pool - 110.0).abs() < 0.5, "pool={pool}");
    }

    #[test]
    fn test_progressive_cap_enforced() {
        let mut cfg = progressive_tier("major", 100.0, 0.1);
        cfg.cap_x = Some(105.0);
        let mgr = JackpotManager::new(vec![cfg]);
        for _ in 0..1000 {
            mgr.contribute_all(1.0);
        }
        let pool = mgr.states[0].pool_value();
        assert!(pool <= 106.0, "pool should be capped, got {pool}");
    }

    #[test]
    fn test_progressive_resets_on_hit() {
        let cfg = progressive_tier("major", 100.0, 0.01);
        let mgr = JackpotManager::new(vec![cfg]);
        // Grow pool.
        for _ in 0..1000 {
            mgr.contribute_all(1.0);
        }
        assert!(mgr.states[0].pool_value() > 100.0);
        // Force hit (probability 0.001, rv=0.0 → hits).
        let payout = mgr.states[0].try_hit(&mgr.configs[0], 0.0, 0.0);
        assert!(payout.is_some());
        assert!(payout.unwrap() > 100.0, "payout should be inflated pool");
        // Pool resets to seed.
        assert!((mgr.states[0].pool_value() - 100.0).abs() < 0.5);
    }

    #[test]
    fn test_hnw_full_trigger() {
        let cfg = JackpotTierConfig {
            id: "grand".to_string(),
            name: "GRAND".to_string(),
            kind: JackpotKind::Fixed,
            trigger: JackpotTrigger::HoldAndWinFull,
            seed_amount_x: 5000.0,
            contribution_rate: None,
            cap_x: None,
            pool_id: None,
        };
        let mgr = JackpotManager::new(vec![cfg]);
        // on_spin must NOT fire (HoldAndWinFull ignores random trigger).
        let hits = mgr.on_spin(&[0.0], 0.0);
        assert!(hits.is_empty());
        // recordHnwHit must fire.
        let payout = mgr.record_hnw_hit("grand");
        assert_eq!(payout, Some(5000.0));
    }

    #[test]
    fn test_win_multiplier_threshold() {
        let cfg = JackpotTierConfig {
            id: "super".to_string(),
            name: "SUPER".to_string(),
            kind: JackpotKind::Fixed,
            trigger: JackpotTrigger::WinMultiplierThreshold { min_win_x: 100.0 },
            seed_amount_x: 500.0,
            contribution_rate: None,
            cap_x: None,
            pool_id: None,
        };
        let mgr = JackpotManager::new(vec![cfg]);
        // Below threshold — no hit.
        assert!(mgr.on_spin(&[0.0], 99.9).is_empty());
        // At threshold — hits.
        let hits = mgr.on_spin(&[0.0], 100.0);
        assert_eq!(hits.len(), 1);
        assert!((hits[0].1 - 500.0).abs() < 1e-9);
    }

    #[test]
    fn test_analytical_fixed() {
        let cfg = fixed_tier("grand", 0.0001, 5000.0);
        let a = JackpotAnalytical::solve(&cfg).unwrap();
        // E[RTP] = 0.0001 × 5000 = 0.5
        assert!(
            (a.expected_rtp - 0.5).abs() < 1e-9,
            "rtp={}",
            a.expected_rtp
        );
        assert!((a.expected_interval - 10_000.0).abs() < 1.0);
    }

    #[test]
    fn test_analytical_none_for_hnw() {
        let cfg = JackpotTierConfig {
            id: "g".to_string(),
            name: "G".to_string(),
            kind: JackpotKind::Fixed,
            trigger: JackpotTrigger::HoldAndWinFull,
            seed_amount_x: 1000.0,
            contribution_rate: None,
            cap_x: None,
            pool_id: None,
        };
        assert!(JackpotAnalytical::solve(&cfg).is_none());
    }

    #[test]
    fn test_hit_frequency_smoke() {
        // 100k spins at p=0.01 → expect ~1000 hits.
        let cfg = fixed_tier("mini", 0.01, 10.0);
        let mgr = JackpotManager::new(vec![cfg]);
        let mut rng = crate::rng::SlotRng::new(42);
        let mut total_hits = 0u64;
        for _ in 0..100_000 {
            let rv = rng.random();
            total_hits += mgr.on_spin(&[rv], 0.0).len() as u64;
        }
        assert!(
            total_hits > 800 && total_hits < 1200,
            "hits={total_hits} — expected ~1000"
        );
        let metrics = mgr.metrics(100_000);
        assert_eq!(metrics[0].hits, total_hits);
    }

    #[test]
    fn test_metrics_contribution_rtp() {
        // All hits, payout=10 → contribution_rtp = 10.0.
        let cfg = fixed_tier("mini", 1.0, 10.0);
        let mgr = JackpotManager::new(vec![cfg]);
        for _ in 0..100 {
            mgr.on_spin(&[0.0], 0.0);
        }
        let m = &mgr.metrics(100)[0];
        assert!(
            (m.contribution_rtp - 10.0).abs() < 1e-6,
            "rtp={}",
            m.contribution_rtp
        );
        assert_eq!(m.hits, 100);
    }

    #[test]
    fn test_multiple_independent_tiers() {
        let mini = fixed_tier("mini", 1.0, 5.0); // always hits
        let grand = fixed_tier("grand", 0.0, 5000.0); // never hits
        let mgr = JackpotManager::new(vec![mini, grand]);
        let hits = mgr.on_spin(&[0.0, 0.5], 0.0);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].0, "mini");
    }

    #[test]
    fn test_json_roundtrip() {
        let cfg = fixed_tier("grand", 0.0001, 5000.0);
        let json = serde_json::to_string(&cfg).unwrap();
        let cfg2: JackpotTierConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(cfg, cfg2);
    }
}
