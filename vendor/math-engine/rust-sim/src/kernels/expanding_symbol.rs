//! W244.18 — expanding_symbol Rust port.
//!
//! Mirror of `tools/math_dsl/expanding_symbol.py`. Closed-form:
//!   P(≥1 on reel)     = 1 − (1 − p_per_cell) ^ rows
//!   E[reels_expanded] = reels × P(≥1 on reel)
//!   E[pay/FS spin]    = Σ_k Binomial(reels, p_per_reel)(k) × pay_table[k]
//!   E[pay/trigger]    = fs_initial_spins × E[pay/FS spin]
//!   RTP               = fs_trigger_p × E[pay/trigger]
//!
//! Used by Book of Dead, Book of Ra, all "book"-style expanding-symbol
//! Free Spins games.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpandingSymbolParams {
    pub fs_trigger_p: f64,
    pub fs_initial_spins: u32,
    pub reels: u32,
    pub rows: u32,
    pub p_per_cell_in_fs: f64,
    pub pay_table: BTreeMap<u32, f64>,
    #[serde(default = "default_symbol_name")]
    pub symbol_name: String,
}

fn default_symbol_name() -> String {
    "?".to_string()
}

impl ExpandingSymbolParams {
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
        if self.reels < 1 {
            return Err("reels must be ≥ 1".into());
        }
        if self.rows < 1 {
            return Err("rows must be ≥ 1".into());
        }
        if !(0.0..=1.0).contains(&self.p_per_cell_in_fs) {
            return Err(format!(
                "p_per_cell_in_fs {} outside [0,1]",
                self.p_per_cell_in_fs
            ));
        }
        if self.pay_table.is_empty() {
            return Err("pay_table must be non-empty".into());
        }
        for (&k, &v) in &self.pay_table {
            if v < 0.0 {
                return Err(format!("pay_table[{}]={} must be ≥ 0", k, v));
            }
        }
        Ok(())
    }
}

pub fn reel_expansion_probability(p_per_cell: f64, rows: u32) -> f64 {
    if p_per_cell >= 1.0 {
        return 1.0;
    }
    1.0 - (1.0 - p_per_cell).powi(rows as i32)
}

pub fn expected_reels_expanded(p_per_cell: f64, reels: u32, rows: u32) -> f64 {
    (reels as f64) * reel_expansion_probability(p_per_cell, rows)
}

pub fn expected_pay_per_fs_spin(params: &ExpandingSymbolParams) -> f64 {
    let p_per_reel = reel_expansion_probability(params.p_per_cell_in_fs, params.rows);
    let n = params.reels;
    let q = 1.0 - p_per_reel;
    if q == 0.0 {
        return *params.pay_table.get(&n).unwrap_or(&0.0);
    }
    let mut expected = 0.0_f64;
    let mut pmf = q.powi(n as i32);
    expected += pmf * params.pay_table.get(&0).unwrap_or(&0.0);
    for k in 1..=n {
        pmf *= ((n - k + 1) as f64) / (k as f64) * (p_per_reel / q);
        expected += pmf * params.pay_table.get(&k).unwrap_or(&0.0);
    }
    expected
}

pub fn expected_pay_per_trigger(params: &ExpandingSymbolParams) -> f64 {
    (params.fs_initial_spins as f64) * expected_pay_per_fs_spin(params)
}

#[derive(Debug, Serialize)]
pub struct ExpandingSymbolResult {
    pub rtp_contribution: f64,
    pub fs_trigger_p: f64,
    pub fs_initial_spins: u32,
    pub reels: u32,
    pub rows: u32,
    pub p_per_cell_in_fs: f64,
    pub p_per_reel: f64,
    pub expected_reels_expanded_per_spin: f64,
    pub expected_pay_per_fs_spin: f64,
    pub expected_pay_per_trigger: f64,
    pub symbol_name: String,
    pub pay_table: BTreeMap<u32, f64>,
}

pub fn expanding_symbol_rtp(params: &ExpandingSymbolParams) -> ExpandingSymbolResult {
    let p_per_reel = reel_expansion_probability(params.p_per_cell_in_fs, params.rows);
    let e_reels = expected_reels_expanded(params.p_per_cell_in_fs, params.reels, params.rows);
    let e_pay_per_spin = expected_pay_per_fs_spin(params);
    let e_pay_per_trigger = expected_pay_per_trigger(params);
    let rtp = params.fs_trigger_p * e_pay_per_trigger;
    ExpandingSymbolResult {
        rtp_contribution: rtp,
        fs_trigger_p: params.fs_trigger_p,
        fs_initial_spins: params.fs_initial_spins,
        reels: params.reels,
        rows: params.rows,
        p_per_cell_in_fs: params.p_per_cell_in_fs,
        p_per_reel,
        expected_reels_expanded_per_spin: e_reels,
        expected_pay_per_fs_spin: e_pay_per_spin,
        expected_pay_per_trigger: e_pay_per_trigger,
        symbol_name: params.symbol_name.clone(),
        pay_table: params.pay_table.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn book_of_dead_like() -> ExpandingSymbolParams {
        let mut pt = BTreeMap::new();
        pt.insert(0, 0.0);
        pt.insert(1, 0.0);
        pt.insert(2, 0.0);
        pt.insert(3, 1.0);
        pt.insert(4, 5.0);
        pt.insert(5, 100.0);
        ExpandingSymbolParams {
            fs_trigger_p: 0.005,
            fs_initial_spins: 10,
            reels: 5,
            rows: 3,
            p_per_cell_in_fs: 0.10,
            pay_table: pt,
            symbol_name: "S_HP1".into(),
        }
    }

    #[test]
    fn p_per_reel_matches_bernoulli_formula() {
        // P(≥1 in 3 cells, each p=0.1) = 1 − 0.9^3 = 0.271
        let p = reel_expansion_probability(0.10, 3);
        assert!((p - 0.271).abs() < 1e-12);
    }

    #[test]
    fn p_per_cell_one_returns_one_reel_prob() {
        assert_eq!(reel_expansion_probability(1.0, 3), 1.0);
    }

    #[test]
    fn e_reels_expanded_linearity_check() {
        let e = expected_reels_expanded(0.10, 5, 3);
        assert!((e - 5.0 * 0.271).abs() < 1e-12);
    }

    #[test]
    fn rtp_contribution_positive_on_book_pattern() {
        let p = book_of_dead_like();
        let r = expanding_symbol_rtp(&p);
        assert!(r.rtp_contribution > 0.0);
        assert!(r.expected_pay_per_trigger > 0.0);
    }

    #[test]
    fn validate_rejects_zero_spins() {
        let mut pt = BTreeMap::new();
        pt.insert(3, 1.0);
        let p = ExpandingSymbolParams {
            fs_trigger_p: 0.01, fs_initial_spins: 0,
            reels: 5, rows: 3, p_per_cell_in_fs: 0.1,
            pay_table: pt, symbol_name: "x".into(),
        };
        assert!(p.validate().is_err());
    }
}
