//! W244.12 — must_hit_by Rust port.
//!
//! Mirror of `tools/math_dsl/must_hit_by.py`. Conservation flow:
//!   RTP[pot] = contribution_x  (every contributed bet pays out)
//!   E[strike_value] = natural_prob × E[pot @ natural] + forced_prob × cap

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MustHitByPot {
    pub name: String,
    pub seed_x_bet: f64,
    pub contribution_x: f64,
    pub must_hit_by_x_bet: f64,
    #[serde(default = "default_p_strike")]
    pub p_strike_per_spin: f64,
}

fn default_p_strike() -> f64 {
    1e-6
}

impl MustHitByPot {
    pub fn validate(&self) -> Result<(), String> {
        if self.seed_x_bet < 0.0 {
            return Err(format!("pot {}: seed_x_bet must be ≥ 0", self.name));
        }
        if self.contribution_x <= 0.0 || self.contribution_x >= 1.0 {
            return Err(format!(
                "pot {}: contribution_x must be in (0,1)", self.name
            ));
        }
        if self.must_hit_by_x_bet <= self.seed_x_bet {
            return Err(format!(
                "pot {}: must_hit_by_x_bet must exceed seed_x_bet", self.name
            ));
        }
        if !(0.0..=1.0).contains(&self.p_strike_per_spin) {
            return Err(format!(
                "pot {}: p_strike_per_spin outside [0,1]", self.name
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MustHitByParams {
    pub pots: Vec<MustHitByPot>,
}

impl MustHitByParams {
    pub fn validate(&self) -> Result<(), String> {
        if self.pots.is_empty() {
            return Err("pots must be non-empty".into());
        }
        for p in &self.pots {
            p.validate()?;
        }
        Ok(())
    }
}

pub fn expected_spins_to_cap(pot: &MustHitByPot) -> f64 {
    (pot.must_hit_by_x_bet - pot.seed_x_bet) / pot.contribution_x
}

pub fn probability_forced_strike(pot: &MustHitByPot) -> f64 {
    let n = expected_spins_to_cap(pot);
    let p = pot.p_strike_per_spin;
    if p == 0.0 {
        return 1.0;
    }
    if p >= 1.0 {
        return if n > 0.0 { 0.0 } else { 1.0 };
    }
    // log1p for numerical stability when n is large
    let log_p_no_strike = n * (1.0_f64 - p).ln_1p().max(f64::NEG_INFINITY);
    // Actually: ln(1-p) = ln1p(-p) per math definition. We want
    // (1-p)^n = exp(n * ln(1-p)) = exp(n * ln1p(-p)).
    let _ = log_p_no_strike;
    let log_one_minus_p = (-p).ln_1p();
    (n * log_one_minus_p).exp()
}

pub fn expected_strike_value(pot: &MustHitByPot) -> f64 {
    let p_forced = probability_forced_strike(pot);
    let p_natural = 1.0 - p_forced;

    let e_pot_natural = if p_natural <= 0.0 {
        pot.must_hit_by_x_bet
    } else {
        let spins_cap = expected_spins_to_cap(pot);
        let e_spins_natural = (1.0 / pot.p_strike_per_spin).min(spins_cap);
        pot.seed_x_bet + pot.contribution_x * e_spins_natural
    };

    p_natural * e_pot_natural + p_forced * pot.must_hit_by_x_bet
}

pub fn per_pot_rtp_contribution(pot: &MustHitByPot) -> f64 {
    pot.contribution_x
}

#[derive(Debug, Serialize)]
pub struct PerPot {
    pub name: String,
    pub seed_x_bet: f64,
    pub contribution_x: f64,
    pub must_hit_by_x_bet: f64,
    pub p_strike_per_spin: f64,
    pub expected_spins_to_cap: f64,
    pub probability_forced_strike: f64,
    pub expected_strike_value_x_bet: f64,
    pub per_spin_rtp_contribution: f64,
}

#[derive(Debug, Serialize)]
pub struct MustHitByResult {
    pub rtp_contribution: f64,
    pub pots: Vec<PerPot>,
}

pub fn must_hit_by_rtp(p: &MustHitByParams) -> MustHitByResult {
    let mut pots: Vec<PerPot> = Vec::with_capacity(p.pots.len());
    let mut total = 0.0_f64;
    for pot in &p.pots {
        let rtp = per_pot_rtp_contribution(pot);
        let e_strike = expected_strike_value(pot);
        let spins_cap = expected_spins_to_cap(pot);
        let p_forced = probability_forced_strike(pot);
        pots.push(PerPot {
            name: pot.name.clone(),
            seed_x_bet: pot.seed_x_bet,
            contribution_x: pot.contribution_x,
            must_hit_by_x_bet: pot.must_hit_by_x_bet,
            p_strike_per_spin: pot.p_strike_per_spin,
            expected_spins_to_cap: spins_cap,
            probability_forced_strike: p_forced,
            expected_strike_value_x_bet: e_strike,
            per_spin_rtp_contribution: rtp,
        });
        total += rtp;
    }
    MustHitByResult { rtp_contribution: total, pots }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linear_spins_to_cap() {
        let pot = MustHitByPot {
            name: "grand".into(),
            seed_x_bet: 1000.0,
            contribution_x: 0.001,
            must_hit_by_x_bet: 11000.0,
            p_strike_per_spin: 1e-6,
        };
        assert!((expected_spins_to_cap(&pot) - 10_000_000.0).abs() < 1e-6);
    }

    #[test]
    fn p_strike_zero_always_forced() {
        let pot = MustHitByPot {
            name: "a".into(),
            seed_x_bet: 100.0,
            contribution_x: 0.01,
            must_hit_by_x_bet: 1000.0,
            p_strike_per_spin: 0.0,
        };
        assert!((probability_forced_strike(&pot) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn multi_pot_sum() {
        let params = MustHitByParams {
            pots: vec![
                MustHitByPot { name: "mini".into(), seed_x_bet: 10.0, contribution_x: 0.001, must_hit_by_x_bet: 100.0, p_strike_per_spin: 1e-6 },
                MustHitByPot { name: "minor".into(), seed_x_bet: 50.0, contribution_x: 0.002, must_hit_by_x_bet: 500.0, p_strike_per_spin: 1e-6 },
                MustHitByPot { name: "major".into(), seed_x_bet: 500.0, contribution_x: 0.003, must_hit_by_x_bet: 5_000.0, p_strike_per_spin: 1e-6 },
                MustHitByPot { name: "grand".into(), seed_x_bet: 10_000.0, contribution_x: 0.005, must_hit_by_x_bet: 100_000.0, p_strike_per_spin: 1e-6 },
            ],
        };
        let r = must_hit_by_rtp(&params);
        // 0.001 + 0.002 + 0.003 + 0.005 = 0.011
        assert!((r.rtp_contribution - 0.011).abs() < 1e-12);
    }

    #[test]
    fn validate_rejects_cap_le_seed() {
        let pot = MustHitByPot { name: "a".into(), seed_x_bet: 1000.0, contribution_x: 0.001, must_hit_by_x_bet: 1000.0, p_strike_per_spin: 0.0 };
        assert!(pot.validate().is_err());
    }
}
