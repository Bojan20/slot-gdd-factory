//! W244.11 — charge_meter Rust port.
//!
//! Mirror of `tools/math_dsl/charge_meter.py`. Closed-form:
//!   RTP[tier]  = (E[charge_per_spin] / threshold) × award_value_x_bet  (Wald)
//!   RTP[total] = sum(RTP[tier])

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChargeTier {
    pub name: String,
    pub threshold: f64,
    pub award_value_x_bet: f64,
    #[serde(default = "default_award_kind")]
    pub award_kind: String,
}

fn default_award_kind() -> String {
    "credit_x_bet".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChargeMeterParams {
    pub expected_charge_per_spin: f64,
    pub tiers: Vec<ChargeTier>,
    #[serde(default)]
    pub persistent_across_sessions: bool,
}

impl ChargeMeterParams {
    pub fn validate(&self) -> Result<(), String> {
        if self.expected_charge_per_spin < 0.0 {
            return Err("expected_charge_per_spin must be ≥ 0".into());
        }
        if self.tiers.is_empty() {
            return Err("tiers must be non-empty".into());
        }
        for t in &self.tiers {
            if t.threshold <= 0.0 {
                return Err(format!("tier {} threshold must be > 0", t.name));
            }
            if t.award_value_x_bet < 0.0 {
                return Err(format!(
                    "tier {} award_value_x_bet must be ≥ 0", t.name
                ));
            }
        }
        // Sorted ascending check (industry standard)
        let mut prev = 0.0_f64;
        for t in &self.tiers {
            if t.threshold < prev {
                return Err(
                    "tiers must be sorted ascending by threshold".into(),
                );
            }
            prev = t.threshold;
        }
        Ok(())
    }
}

pub fn rtp_contribution_per_tier(
    expected_charge_per_spin: f64,
    tier: &ChargeTier,
) -> f64 {
    (expected_charge_per_spin / tier.threshold) * tier.award_value_x_bet
}

#[derive(Debug, Serialize)]
pub struct PerTier {
    pub name: String,
    pub threshold: f64,
    pub award_value_x_bet: f64,
    pub award_kind: String,
    pub rtp_contribution: f64,
    pub expected_charges_per_spin: f64,
}

#[derive(Debug, Serialize)]
pub struct ChargeMeterResult {
    pub rtp_contribution: f64,
    pub expected_charge_per_spin: f64,
    pub tiers: Vec<PerTier>,
    pub persistent_across_sessions: bool,
}

pub fn charge_meter_rtp(p: &ChargeMeterParams) -> ChargeMeterResult {
    let mut tiers: Vec<PerTier> = Vec::with_capacity(p.tiers.len());
    let mut total = 0.0_f64;
    for t in &p.tiers {
        let rtp = rtp_contribution_per_tier(p.expected_charge_per_spin, t);
        tiers.push(PerTier {
            name: t.name.clone(),
            threshold: t.threshold,
            award_value_x_bet: t.award_value_x_bet,
            award_kind: t.award_kind.clone(),
            rtp_contribution: rtp,
            expected_charges_per_spin:
                p.expected_charge_per_spin / t.threshold,
        });
        total += rtp;
    }
    ChargeMeterResult {
        rtp_contribution: total,
        expected_charge_per_spin: p.expected_charge_per_spin,
        tiers,
        persistent_across_sessions: p.persistent_across_sessions,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_tier_starburst_like() {
        let p = ChargeMeterParams {
            expected_charge_per_spin: 0.5,
            tiers: vec![ChargeTier {
                name: "classic".into(),
                threshold: 50.0,
                award_value_x_bet: 10.0,
                award_kind: "credit_x_bet".into(),
            }],
            persistent_across_sessions: false,
        };
        let r = charge_meter_rtp(&p);
        // 0.5 / 50 × 10 = 0.10
        assert!((r.rtp_contribution - 0.10).abs() < 1e-12);
    }

    #[test]
    fn three_tier_multi_meter() {
        let p = ChargeMeterParams {
            expected_charge_per_spin: 1.0,
            tiers: vec![
                ChargeTier { name: "small".into(), threshold: 20.0, award_value_x_bet: 4.0, award_kind: "credit_x_bet".into() },
                ChargeTier { name: "medium".into(), threshold: 100.0, award_value_x_bet: 30.0, award_kind: "credit_x_bet".into() },
                ChargeTier { name: "grand".into(), threshold: 1000.0, award_value_x_bet: 500.0, award_kind: "credit_x_bet".into() },
            ],
            persistent_across_sessions: false,
        };
        let r = charge_meter_rtp(&p);
        // 4/20 + 30/100 + 500/1000 = 0.2 + 0.3 + 0.5 = 1.0
        assert!((r.rtp_contribution - 1.0).abs() < 1e-12);
    }

    #[test]
    fn validate_rejects_empty_tiers() {
        let p = ChargeMeterParams {
            expected_charge_per_spin: 1.0,
            tiers: vec![],
            persistent_across_sessions: false,
        };
        assert!(p.validate().is_err());
    }

    #[test]
    fn validate_rejects_negative_charge() {
        let p = ChargeMeterParams {
            expected_charge_per_spin: -0.1,
            tiers: vec![ChargeTier { name: "a".into(), threshold: 10.0, award_value_x_bet: 1.0, award_kind: "x".into() }],
            persistent_across_sessions: false,
        };
        assert!(p.validate().is_err());
    }
}
