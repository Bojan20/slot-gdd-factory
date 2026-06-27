//! W244.20 — cascade Rust port.
//!
//! Closed-form: bounded geometric chain × multiplier_ladder per step.
//!   RTP = p_initial_win × sum_{n=1..N}(p^(n-1) × base × mult[n])

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CascadeParams {
    pub p_initial_win: f64,
    pub base_pay_per_cascade_x_bet: f64,
    pub p_win_per_cascade: f64,
    pub multiplier_ladder: Vec<f64>,
    #[serde(default = "default_max_chain")]
    pub max_chain: u32,
}

fn default_max_chain() -> u32 { 16 }

impl CascadeParams {
    pub fn validate(&self) -> Result<(), String> {
        if !(0.0..=1.0).contains(&self.p_initial_win) {
            return Err(format!("p_initial_win {} outside [0,1]", self.p_initial_win));
        }
        if self.base_pay_per_cascade_x_bet < 0.0 {
            return Err("base_pay_per_cascade_x_bet must be ≥ 0".into());
        }
        if !(0.0..=1.0).contains(&self.p_win_per_cascade) {
            return Err(format!("p_win_per_cascade {} outside [0,1]", self.p_win_per_cascade));
        }
        if self.multiplier_ladder.is_empty() {
            return Err("multiplier_ladder must be non-empty".into());
        }
        for &m in &self.multiplier_ladder {
            if m < 0.0 {
                return Err("multiplier_ladder entries must be ≥ 0".into());
            }
        }
        if self.max_chain < 1 {
            return Err("max_chain must be ≥ 1".into());
        }
        Ok(())
    }
}

pub fn expected_chain_length(p: &CascadeParams) -> f64 {
    let pp = p.p_win_per_cascade;
    let n = p.max_chain as i32;
    if pp >= 1.0 {
        return n as f64;
    }
    if pp <= 0.0 {
        return 0.0;
    }
    pp * (1.0 - pp.powi(n)) / (1.0 - pp)
}

pub fn expected_pay_per_trigger(p: &CascadeParams) -> f64 {
    let mut total = 0.0_f64;
    let mut p_chain = 1.0_f64;
    let ladder_len = p.multiplier_ladder.len();
    for step in 1..=p.max_chain {
        let idx = (step as usize - 1).min(ladder_len - 1);
        let mult = p.multiplier_ladder[idx];
        total += p_chain * p.base_pay_per_cascade_x_bet * mult;
        p_chain *= p.p_win_per_cascade;
    }
    total
}

#[derive(Debug, Serialize)]
pub struct PerStep {
    pub step: u32,
    pub p_reach: f64,
    pub multiplier: f64,
    pub contribution_x_bet: f64,
}

#[derive(Debug, Serialize)]
pub struct CascadeResult {
    pub rtp_contribution: f64,
    pub p_initial_win: f64,
    pub base_pay_per_cascade_x_bet: f64,
    pub p_win_per_cascade: f64,
    pub max_chain: u32,
    pub expected_chain_length: f64,
    pub expected_pay_per_trigger_x_bet: f64,
    pub per_step_breakdown: Vec<PerStep>,
}

pub fn cascade_rtp(p: &CascadeParams) -> CascadeResult {
    let e_chain_len = expected_chain_length(p);
    let e_pay = expected_pay_per_trigger(p);
    let rtp = p.p_initial_win * e_pay;

    let mut per_step: Vec<PerStep> = Vec::with_capacity(p.max_chain as usize);
    let mut p_chain = 1.0_f64;
    let ladder_len = p.multiplier_ladder.len();
    for step in 1..=p.max_chain {
        let idx = (step as usize - 1).min(ladder_len - 1);
        let mult = p.multiplier_ladder[idx];
        per_step.push(PerStep {
            step,
            p_reach: p_chain,
            multiplier: mult,
            contribution_x_bet: p_chain * p.base_pay_per_cascade_x_bet * mult,
        });
        p_chain *= p.p_win_per_cascade;
    }

    CascadeResult {
        rtp_contribution: rtp,
        p_initial_win: p.p_initial_win,
        base_pay_per_cascade_x_bet: p.base_pay_per_cascade_x_bet,
        p_win_per_cascade: p.p_win_per_cascade,
        max_chain: p.max_chain,
        expected_chain_length: e_chain_len,
        expected_pay_per_trigger_x_bet: e_pay,
        per_step_breakdown: per_step,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_cascade_first_step_only() {
        let p = CascadeParams {
            p_initial_win: 0.1,
            base_pay_per_cascade_x_bet: 1.0,
            p_win_per_cascade: 0.0,
            multiplier_ladder: vec![1.0],
            max_chain: 5,
        };
        // Step 1: 1.0 × 1.0 × 1.0 = 1.0
        assert!((expected_pay_per_trigger(&p) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn geometric_5_step_doubling() {
        let p = CascadeParams {
            p_initial_win: 0.1,
            base_pay_per_cascade_x_bet: 1.0,
            p_win_per_cascade: 0.5,
            multiplier_ladder: vec![1.0, 2.0, 4.0, 8.0, 16.0],
            max_chain: 5,
        };
        // 1×1 + 0.5×2 + 0.25×4 + 0.125×8 + 0.0625×16 = 5.0
        assert!((expected_pay_per_trigger(&p) - 5.0).abs() < 1e-10);
    }

    #[test]
    fn p_zero_chain_length_zero() {
        let p = CascadeParams {
            p_initial_win: 0.3,
            base_pay_per_cascade_x_bet: 1.0,
            p_win_per_cascade: 0.0,
            multiplier_ladder: vec![1.0],
            max_chain: 5,
        };
        assert_eq!(expected_chain_length(&p), 0.0);
    }
}
