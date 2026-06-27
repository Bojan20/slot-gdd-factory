//! PAR-019 — Multi-tier mystery jackpot (Mini / Minor / Major / Grand).
//!
//! Aristocrat Dragon Link / IGT MegaJackpots style: at the end of every spin,
//! roll a single uniform draw; if it lands inside one of the per-tier
//! trigger windows, award that tier and reset its progressive pool.
//!
//! Math (per spin, independent tiers):
//!   * `p_trigger_i = 1 / expected_hit_interval_i`
//!   * `pool_i(t) = seed_i + contribution_rate_i × cumulative_wager`
//!   * `E[payout per spin from tier i] = p_trigger_i × E[pool_i at trigger]`
//!
//! This module supplies the closed-form tier analytics + a `roll_tiers` helper
//! for Monte-Carlo integration with the main engine.

use serde::{Deserialize, Serialize};

/// One jackpot tier (Mini / Minor / Major / Grand).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JackpotTierSpec {
    pub name: String,
    /// Seed value (currency or bet multiples — caller's convention).
    pub seed: f64,
    /// Fraction of every wager that flows into the pool.
    pub contribution_rate: f64,
    /// Mean number of spins between hits (Geom(1/expected_hit_interval) per spin).
    pub expected_hit_interval: f64,
}

/// Per-tier analytics summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JackpotTierAnalytics {
    pub name: String,
    pub seed: f64,
    pub p_trigger_per_spin: f64,
    pub expected_pool_at_trigger: f64,
    pub rtp_contribution_pct: f64,
}

/// Bundle of all configured tiers + aggregate RTP.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MysteryJackpotSection {
    pub tiers: Vec<JackpotTierAnalytics>,
    pub total_jackpot_rtp_pct: f64,
}

impl MysteryJackpotSection {
    /// Closed-form analytics for the supplied tier specs.
    ///
    /// `bet_per_spin` is used to express RTP-contribution as a percentage of
    /// total wager. `wager_growth_to_trigger` is the cumulative wager that
    /// flows in between consecutive hits = `bet_per_spin × expected_interval`.
    pub fn from_tiers(tiers: &[JackpotTierSpec], bet_per_spin: f64) -> Self {
        let bet = bet_per_spin.max(1e-9);
        let analytics: Vec<JackpotTierAnalytics> = tiers
            .iter()
            .map(|t| {
                let p = if t.expected_hit_interval > 0.0 {
                    1.0 / t.expected_hit_interval
                } else {
                    0.0
                };
                // E[pool at trigger] = seed + contribution_rate × bet × E[interval]
                let growth = t.contribution_rate * bet * t.expected_hit_interval;
                let expected_pool = t.seed + growth;
                // RTP contribution per spin = p × E[pool] / bet × 100
                let rtp_contribution_pct = (p * expected_pool / bet) * 100.0;
                JackpotTierAnalytics {
                    name: t.name.clone(),
                    seed: t.seed,
                    p_trigger_per_spin: p,
                    expected_pool_at_trigger: expected_pool,
                    rtp_contribution_pct,
                }
            })
            .collect();
        let total: f64 = analytics.iter().map(|t| t.rtp_contribution_pct).sum();
        MysteryJackpotSection {
            tiers: analytics,
            total_jackpot_rtp_pct: total,
        }
    }
}

/// Roll a uniform `u` ∈ [0, 1) against the configured tiers. Returns the index
/// of the first tier whose trigger window the roll lands in, or `None`. Used
/// by Monte Carlo engines as a per-spin hook.
pub fn roll_tiers(u: f64, tiers: &[JackpotTierSpec]) -> Option<usize> {
    let mut cumulative = 0.0_f64;
    for (i, t) in tiers.iter().enumerate() {
        if t.expected_hit_interval <= 0.0 {
            continue;
        }
        cumulative += 1.0 / t.expected_hit_interval;
        if u < cumulative {
            return Some(i);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dragon_link_tiers() -> Vec<JackpotTierSpec> {
        // Approximate Dragon Link economics — bet 1.0, intervals scaled.
        vec![
            JackpotTierSpec {
                name: "MINI".to_string(),
                seed: 10.0,
                contribution_rate: 0.001,
                expected_hit_interval: 1_000.0,
            },
            JackpotTierSpec {
                name: "MINOR".to_string(),
                seed: 50.0,
                contribution_rate: 0.002,
                expected_hit_interval: 10_000.0,
            },
            JackpotTierSpec {
                name: "MAJOR".to_string(),
                seed: 1_000.0,
                contribution_rate: 0.003,
                expected_hit_interval: 100_000.0,
            },
            JackpotTierSpec {
                name: "GRAND".to_string(),
                seed: 50_000.0,
                contribution_rate: 0.004,
                expected_hit_interval: 1_000_000.0,
            },
        ]
    }

    #[test]
    fn analytics_per_tier_emit_in_input_order() {
        let m = MysteryJackpotSection::from_tiers(&dragon_link_tiers(), 1.0);
        assert_eq!(m.tiers.len(), 4);
        assert_eq!(m.tiers[0].name, "MINI");
        assert_eq!(m.tiers[3].name, "GRAND");
    }

    #[test]
    fn smaller_interval_gives_higher_trigger_probability() {
        let m = MysteryJackpotSection::from_tiers(&dragon_link_tiers(), 1.0);
        assert!(m.tiers[0].p_trigger_per_spin > m.tiers[3].p_trigger_per_spin);
    }

    #[test]
    fn total_jackpot_rtp_sums_correctly() {
        let m = MysteryJackpotSection::from_tiers(&dragon_link_tiers(), 1.0);
        let expected: f64 = m.tiers.iter().map(|t| t.rtp_contribution_pct).sum();
        assert!((m.total_jackpot_rtp_pct - expected).abs() < 1e-9);
    }

    #[test]
    fn roll_tiers_picks_smallest_when_u_small() {
        let tiers = dragon_link_tiers();
        // p_mini = 1/1000 = 0.001; u=0 must trigger MINI.
        assert_eq!(roll_tiers(0.0, &tiers), Some(0));
        // u=0.9 above all cumulative probabilities → None.
        assert_eq!(roll_tiers(0.9, &tiers), None);
    }
}
