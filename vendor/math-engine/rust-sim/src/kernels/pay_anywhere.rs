//! W244.26 — pay_anywhere Rust port.
//!
//! Mirror of `tools/math_dsl/pay_anywhere.py`. Closed-form:
//!   P(K landings)  = Binomial(n_cells, p_per_cell)(K)
//!   E[pay × bet]   = Σ_K P(K) × pay_table[K]  (with K < min_pay_count → 0)
//!
//! Used by scatter-pay games (Sweet Bonanza non-cluster, Gonzo's Quest,
//! Wolf Gold scatter mode).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayAnywhereParams {
    pub n_cells: usize,
    pub p_per_cell: f64,
    /// {K landings → pay × bet}
    pub pay_table: BTreeMap<usize, f64>,
    #[serde(default = "default_min_pay_count")]
    pub min_pay_count: usize,
    #[serde(default = "default_symbol_name")]
    pub symbol_name: String,
}

fn default_min_pay_count() -> usize {
    8
}

fn default_symbol_name() -> String {
    "?".to_string()
}

impl PayAnywhereParams {
    pub fn validate(&self) -> Result<(), String> {
        if self.n_cells < 1 {
            return Err("n_cells must be ≥ 1".into());
        }
        if !(0.0..=1.0).contains(&self.p_per_cell) {
            return Err(format!(
                "p_per_cell {} outside [0,1]",
                self.p_per_cell
            ));
        }
        if self.pay_table.is_empty() {
            return Err("pay_table must be non-empty".into());
        }
        if self.min_pay_count < 1 {
            return Err("min_pay_count must be ≥ 1".into());
        }
        for (&k, &v) in &self.pay_table {
            if v < 0.0 {
                return Err(format!("pay_table[{}] = {} must be ≥ 0", k, v));
            }
        }
        Ok(())
    }
}

/// Binomial(n_cells, p_per_cell) PMF — incremental form to avoid factorial
/// blow-up. Mirrors Python landing_count_distribution exactly.
pub fn landing_count_distribution(params: &PayAnywhereParams) -> BTreeMap<usize, f64> {
    let n = params.n_cells;
    let p = params.p_per_cell;
    let mut dist = BTreeMap::new();
    if p == 0.0 {
        dist.insert(0, 1.0);
        return dist;
    }
    if p == 1.0 {
        dist.insert(n, 1.0);
        return dist;
    }
    let q = 1.0 - p;
    let mut pmf = q.powi(n as i32);
    dist.insert(0, pmf);
    for k in 1..=n {
        pmf *= ((n - k + 1) as f64) / (k as f64) * (p / q);
        dist.insert(k, pmf);
    }
    dist
}

pub fn expected_landings(params: &PayAnywhereParams) -> f64 {
    (params.n_cells as f64) * params.p_per_cell
}

#[derive(Debug, Serialize)]
pub struct PerK {
    pub k_landings: usize,
    pub probability: f64,
    pub pay_x_bet: f64,
    pub below_min: bool,
    pub contribution_x_bet: f64,
}

#[derive(Debug, Serialize)]
pub struct PayAnywhereResult {
    pub rtp_contribution: f64,
    pub n_cells: usize,
    pub p_per_cell: f64,
    pub min_pay_count: usize,
    pub expected_landings: f64,
    pub symbol_name: String,
    pub per_k_breakdown: Vec<PerK>,
}

pub fn pay_anywhere_rtp(params: &PayAnywhereParams) -> PayAnywhereResult {
    let dist = landing_count_distribution(params);
    let mut rtp = 0.0_f64;
    let mut per_k = Vec::with_capacity(dist.len());
    for (k, prob) in dist {
        let pay = if k < params.min_pay_count {
            0.0
        } else {
            *params.pay_table.get(&k).unwrap_or(&0.0)
        };
        let contrib = prob * pay;
        rtp += contrib;
        per_k.push(PerK {
            k_landings: k,
            probability: prob,
            pay_x_bet: pay,
            below_min: k < params.min_pay_count,
            contribution_x_bet: contrib,
        });
    }
    PayAnywhereResult {
        rtp_contribution: rtp,
        n_cells: params.n_cells,
        p_per_cell: params.p_per_cell,
        min_pay_count: params.min_pay_count,
        expected_landings: expected_landings(params),
        symbol_name: params.symbol_name.clone(),
        per_k_breakdown: per_k,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sweet_bonanza_like() -> PayAnywhereParams {
        let mut pt = BTreeMap::new();
        pt.insert(8, 0.25);
        pt.insert(9, 0.5);
        pt.insert(10, 1.0);
        pt.insert(11, 2.5);
        pt.insert(12, 5.0);
        PayAnywhereParams {
            n_cells: 30,
            p_per_cell: 0.10,
            pay_table: pt,
            min_pay_count: 8,
            symbol_name: "S_HP1".into(),
        }
    }

    #[test]
    fn binomial_pmf_sums_to_one() {
        let p = sweet_bonanza_like();
        let dist = landing_count_distribution(&p);
        let s: f64 = dist.values().sum();
        assert!((s - 1.0).abs() < 1e-9, "PMF sum {}", s);
    }

    #[test]
    fn expected_landings_matches_np() {
        let p = sweet_bonanza_like();
        assert!((expected_landings(&p) - 3.0).abs() < 1e-12);
    }

    #[test]
    fn rtp_is_below_pay_threshold_when_p_is_low() {
        // p=0.05 → E[K]=1.5, almost no chance of 8+ → RTP ~ 0.
        let mut pt = BTreeMap::new();
        pt.insert(8, 1.0);
        let p = PayAnywhereParams {
            n_cells: 30, p_per_cell: 0.05, pay_table: pt,
            min_pay_count: 8, symbol_name: "x".into(),
        };
        let r = pay_anywhere_rtp(&p);
        assert!(r.rtp_contribution < 0.001);
    }

    #[test]
    fn p_zero_returns_zero_rtp() {
        let mut pt = BTreeMap::new();
        pt.insert(8, 100.0);
        let p = PayAnywhereParams {
            n_cells: 30, p_per_cell: 0.0, pay_table: pt,
            min_pay_count: 8, symbol_name: "x".into(),
        };
        let r = pay_anywhere_rtp(&p);
        assert_eq!(r.rtp_contribution, 0.0);
    }

    #[test]
    fn validate_rejects_p_out_of_range() {
        let mut pt = BTreeMap::new();
        pt.insert(8, 1.0);
        let p = PayAnywhereParams {
            n_cells: 30, p_per_cell: 1.5, pay_table: pt,
            min_pay_count: 8, symbol_name: "x".into(),
        };
        assert!(p.validate().is_err());
    }
}
