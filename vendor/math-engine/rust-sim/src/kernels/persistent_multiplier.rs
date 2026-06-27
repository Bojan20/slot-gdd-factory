//! W244.19 — persistent_multiplier Rust port.
//!
//! Mirror of `tools/math_dsl/persistent_multiplier.py`. Closed-form DP over
//! (k_bumps, spin_idx) state space with cap clamping. Each spin contributes
//! E[multiplier × base_pay]; total FS award = Σ E[mult_t × base_pay].
//!
//! Used by Sticky Bandits, Mighty Wild, NetEnt Multiplier FS, JTG persistent
//! multiplier features.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistentMultiplierParams {
    pub fs_trigger_p: f64,
    pub fs_initial_spins: u32,
    pub base_pay_per_spin_x_bet: f64,
    #[serde(default = "default_initial_multiplier")]
    pub initial_multiplier: f64,
    #[serde(default = "default_bump_increment")]
    pub bump_increment: f64,
    #[serde(default = "default_p_bump_per_spin")]
    pub p_bump_per_spin: f64,
    #[serde(default)]
    pub max_multiplier: Option<f64>,
}

fn default_initial_multiplier() -> f64 { 1.0 }
fn default_bump_increment() -> f64 { 1.0 }
fn default_p_bump_per_spin() -> f64 { 0.30 }

impl PersistentMultiplierParams {
    pub fn validate(&self) -> Result<(), String> {
        if !(0.0..=1.0).contains(&self.fs_trigger_p) {
            return Err(format!(
                "fs_trigger_p {} outside [0,1]",
                self.fs_trigger_p
            ));
        }
        if self.fs_initial_spins < 1 {
            return Err("fs_initial_spins must be ≥ 1".into());
        }
        if self.base_pay_per_spin_x_bet < 0.0 {
            return Err("base_pay_per_spin_x_bet must be ≥ 0".into());
        }
        if self.initial_multiplier < 0.0 {
            return Err("initial_multiplier must be ≥ 0".into());
        }
        if self.bump_increment < 0.0 {
            return Err("bump_increment must be ≥ 0".into());
        }
        if !(0.0..=1.0).contains(&self.p_bump_per_spin) {
            return Err(format!(
                "p_bump_per_spin {} outside [0,1]",
                self.p_bump_per_spin
            ));
        }
        if let Some(cap) = self.max_multiplier {
            if cap < self.initial_multiplier {
                return Err(format!(
                    "max_multiplier {} must exceed initial {}",
                    cap, self.initial_multiplier
                ));
            }
        }
        Ok(())
    }
}

/// E[multiplier on FS spin t (1-indexed)] — fast approximation (no cap DP).
pub fn expected_multiplier_at_spin(params: &PersistentMultiplierParams, t: u32) -> f64 {
    let e_m = params.initial_multiplier
        + params.bump_increment * params.p_bump_per_spin * ((t - 1) as f64);
    if let Some(cap) = params.max_multiplier {
        e_m.min(cap)
    } else {
        e_m
    }
}

/// Exact DP: E[multiplier_t] for t=1..T accounting for cap.
fn dp_multiplier_path(params: &PersistentMultiplierParams) -> Vec<f64> {
    let initial = params.initial_multiplier;
    let bump = params.bump_increment;
    let cap = params.max_multiplier;
    let p = params.p_bump_per_spin;
    let t_max = params.fs_initial_spins;

    // Determine grid size K (number of bumps before hitting cap)
    let k_max: usize = if let Some(c) = cap {
        if bump > 0.0 {
            let mut k = ((c - initial) / bump).floor() as i64;
            if initial + (k as f64) * bump > c + 1e-9 {
                k -= 1;
            }
            std::cmp::max(0, k) as usize
        } else {
            t_max as usize
        }
    } else {
        t_max as usize
    };

    // State vector: probs[k] = P(k bumps so far). Initial: 0 bumps before spin 1.
    let mut probs = vec![0.0_f64; k_max + 1];
    probs[0] = 1.0;

    let mut e_per_spin = Vec::with_capacity(t_max as usize);
    for _ in 0..t_max {
        // E[multiplier this spin] = Σ_k probs[k] × m_k (capped)
        let mut e_m = 0.0_f64;
        for (k, pk) in probs.iter().enumerate() {
            let mut m = initial + (k as f64) * bump;
            if let Some(c) = cap {
                m = m.min(c);
            }
            e_m += pk * m;
        }
        e_per_spin.push(e_m);

        // Advance: each k → with prob (1-p) stay, with prob p go k+1
        let mut new_probs = vec![0.0_f64; k_max + 1];
        for k in 0..=k_max {
            let pk = probs[k];
            if k == k_max {
                new_probs[k] += pk; // at cap → stays
            } else {
                new_probs[k] += pk * (1.0 - p);
                new_probs[k + 1] += pk * p;
            }
        }
        probs = new_probs;
    }

    e_per_spin
}

pub fn expected_fs_total(params: &PersistentMultiplierParams) -> f64 {
    let e_per_spin = dp_multiplier_path(params);
    let sum_e_mult: f64 = e_per_spin.iter().sum();
    params.base_pay_per_spin_x_bet * sum_e_mult
}

#[derive(Debug, Serialize)]
pub struct PersistentMultiplierResult {
    pub rtp_contribution: f64,
    pub fs_trigger_p: f64,
    pub fs_initial_spins: u32,
    pub base_pay_per_spin_x_bet: f64,
    pub initial_multiplier: f64,
    pub bump_increment: f64,
    pub p_bump_per_spin: f64,
    pub max_multiplier: Option<f64>,
    pub expected_multiplier_per_spin: Vec<f64>,
    pub average_multiplier: f64,
    pub expected_fs_total_x_bet: f64,
}

pub fn persistent_multiplier_rtp(params: &PersistentMultiplierParams) -> PersistentMultiplierResult {
    let e_per_spin = dp_multiplier_path(params);
    let sum_e_mult: f64 = e_per_spin.iter().sum();
    let e_total = params.base_pay_per_spin_x_bet * sum_e_mult;
    let rtp = params.fs_trigger_p * e_total;
    let n = e_per_spin.len() as f64;
    PersistentMultiplierResult {
        rtp_contribution: rtp,
        fs_trigger_p: params.fs_trigger_p,
        fs_initial_spins: params.fs_initial_spins,
        base_pay_per_spin_x_bet: params.base_pay_per_spin_x_bet,
        initial_multiplier: params.initial_multiplier,
        bump_increment: params.bump_increment,
        p_bump_per_spin: params.p_bump_per_spin,
        max_multiplier: params.max_multiplier,
        average_multiplier: sum_e_mult / n,
        expected_multiplier_per_spin: e_per_spin,
        expected_fs_total_x_bet: e_total,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sticky_bandits_like() -> PersistentMultiplierParams {
        PersistentMultiplierParams {
            fs_trigger_p: 0.005,
            fs_initial_spins: 10,
            base_pay_per_spin_x_bet: 1.0,
            initial_multiplier: 1.0,
            bump_increment: 1.0,
            p_bump_per_spin: 0.30,
            max_multiplier: None,
        }
    }

    #[test]
    fn expected_multiplier_at_first_spin_equals_initial() {
        let p = sticky_bandits_like();
        let e1 = expected_multiplier_at_spin(&p, 1);
        assert!((e1 - 1.0).abs() < 1e-12);
    }

    #[test]
    fn dp_average_matches_no_cap_linear() {
        // No cap, p=0.3, T=10 → avg multiplier ≈ 1 + 0.3 × (0+1+...+9)/10 = 1 + 0.3 × 4.5 = 2.35
        let p = sticky_bandits_like();
        let r = persistent_multiplier_rtp(&p);
        assert!((r.average_multiplier - 2.35).abs() < 1e-10);
    }

    #[test]
    fn dp_with_cap_clamps_at_max() {
        let p = PersistentMultiplierParams {
            fs_trigger_p: 0.01,
            fs_initial_spins: 100, // many spins, force cap saturation
            base_pay_per_spin_x_bet: 1.0,
            initial_multiplier: 1.0,
            bump_increment: 1.0,
            p_bump_per_spin: 0.50,
            max_multiplier: Some(5.0),
        };
        let r = persistent_multiplier_rtp(&p);
        // After enough spins, average should approach 5 (the cap)
        let last_e_m = *r.expected_multiplier_per_spin.last().unwrap();
        assert!(last_e_m > 4.5);
        assert!(last_e_m <= 5.0 + 1e-12);
    }

    #[test]
    fn rtp_includes_fs_trigger_probability() {
        let p = sticky_bandits_like();
        let r = persistent_multiplier_rtp(&p);
        // 0.005 × 10 × 1 × 2.35 = 0.1175
        assert!((r.rtp_contribution - 0.1175).abs() < 1e-10);
    }

    #[test]
    fn validate_rejects_cap_below_initial() {
        let p = PersistentMultiplierParams {
            fs_trigger_p: 0.01,
            fs_initial_spins: 10,
            base_pay_per_spin_x_bet: 1.0,
            initial_multiplier: 5.0,
            bump_increment: 1.0,
            p_bump_per_spin: 0.3,
            max_multiplier: Some(3.0),
        };
        assert!(p.validate().is_err());
    }
}
