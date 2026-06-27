//! W244.24 — stacked_wilds Rust port.
//!
//! Closed-form: Binomial(n_reels, p_stacked_per_reel) × pay_per_stacked_count.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackedWildsParams {
    pub n_reels: u32,
    pub p_stacked_per_reel: f64,
    /// {k_stacked: avg_pay_x_bet}
    pub pay_per_stacked_count: BTreeMap<u32, f64>,
}

impl StackedWildsParams {
    pub fn validate(&self) -> Result<(), String> {
        if self.n_reels < 1 {
            return Err("n_reels must be ≥ 1".into());
        }
        if !(0.0..=1.0).contains(&self.p_stacked_per_reel) {
            return Err(
                format!("p_stacked_per_reel {} outside [0,1]",
                        self.p_stacked_per_reel)
            );
        }
        if self.pay_per_stacked_count.is_empty() {
            return Err("pay_per_stacked_count must be non-empty".into());
        }
        for (&k, &v) in &self.pay_per_stacked_count {
            if v < 0.0 {
                return Err(format!("pay value for k={} must be ≥ 0", k));
            }
        }
        Ok(())
    }
}

pub fn stacked_count_distribution(p: &StackedWildsParams) -> BTreeMap<u32, f64> {
    let n = p.n_reels;
    let prob = p.p_stacked_per_reel;
    let mut dist: BTreeMap<u32, f64> = BTreeMap::new();
    if prob == 0.0 {
        dist.insert(0, 1.0);
        return dist;
    }
    if prob == 1.0 {
        dist.insert(n, 1.0);
        return dist;
    }
    let q = 1.0 - prob;
    let mut pmf = q.powi(n as i32);
    dist.insert(0, pmf);
    for k in 1..=n {
        // PMF(k) / PMF(k-1) = (n-k+1)/k × p/q
        pmf *= ((n - k + 1) as f64) / (k as f64) * (prob / q);
        dist.insert(k, pmf);
    }
    dist
}

pub fn expected_stacked_count(p: &StackedWildsParams) -> f64 {
    (p.n_reels as f64) * p.p_stacked_per_reel
}

#[derive(Debug, Serialize)]
pub struct PerK {
    pub k_stacked: u32,
    pub probability: f64,
    pub pay_x_bet: f64,
    pub contribution_x_bet: f64,
}

#[derive(Debug, Serialize)]
pub struct StackedWildsResult {
    pub rtp_contribution: f64,
    pub n_reels: u32,
    pub p_stacked_per_reel: f64,
    pub expected_stacked_count: f64,
    pub per_k_breakdown: Vec<PerK>,
    pub binomial_check_sum_prob: f64,
}

pub fn stacked_wilds_rtp(p: &StackedWildsParams) -> StackedWildsResult {
    let dist = stacked_count_distribution(p);
    let mut rtp = 0.0_f64;
    let mut per_k: Vec<PerK> = Vec::with_capacity(dist.len());
    let mut prob_sum = 0.0_f64;
    for (&k, &prob) in &dist {
        let pay = p.pay_per_stacked_count.get(&k).copied().unwrap_or(0.0);
        let contrib = prob * pay;
        per_k.push(PerK {
            k_stacked: k,
            probability: prob,
            pay_x_bet: pay,
            contribution_x_bet: contrib,
        });
        rtp += contrib;
        prob_sum += prob;
    }
    StackedWildsResult {
        rtp_contribution: rtp,
        n_reels: p.n_reels,
        p_stacked_per_reel: p.p_stacked_per_reel,
        expected_stacked_count: expected_stacked_count(p),
        per_k_breakdown: per_k,
        binomial_check_sum_prob: prob_sum,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn p_zero_returns_zero() {
        let mut pay = BTreeMap::new();
        pay.insert(0, 0.0);
        pay.insert(5, 10_000.0);
        let p = StackedWildsParams {
            n_reels: 5,
            p_stacked_per_reel: 0.0,
            pay_per_stacked_count: pay,
        };
        let r = stacked_wilds_rtp(&p);
        assert!((r.rtp_contribution - 0.0).abs() < 1e-12);
    }

    #[test]
    fn full_stack_jackpot() {
        let mut pay = BTreeMap::new();
        pay.insert(5, 10_000.0);
        let p = StackedWildsParams {
            n_reels: 5,
            p_stacked_per_reel: 0.05,
            pay_per_stacked_count: pay,
        };
        let r = stacked_wilds_rtp(&p);
        // P(5/5) = 0.05^5; expected = 0.05^5 × 10_000
        let expected = 0.05_f64.powi(5) * 10_000.0;
        assert!((r.rtp_contribution - expected).abs() < 1e-10);
    }

    #[test]
    fn probabilities_sum_to_one() {
        let mut pay = BTreeMap::new();
        for k in 0..=5u32 {
            pay.insert(k, 1.0);
        }
        let p = StackedWildsParams {
            n_reels: 5,
            p_stacked_per_reel: 0.1,
            pay_per_stacked_count: pay,
        };
        let r = stacked_wilds_rtp(&p);
        assert!((r.binomial_check_sum_prob - 1.0).abs() < 1e-10);
    }
}
