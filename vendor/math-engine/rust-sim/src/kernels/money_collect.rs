//! W244.10 — money_collect Rust port.
//!
//! Closed-form: Binomial CDF trigger × Markov DP nad (k_locked, respins_remaining).
//! Mirror of `tools/math_dsl/money_collect.py`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoneyCollectParams {
    pub p_per_cell: f64,
    pub n_cells: u32,
    pub trigger_count_min: u32,
    /// {value_x_bet: weight}
    pub value_table: BTreeMap<String, f64>,
    #[serde(default = "default_respins_reset")]
    pub respins_reset: u32,
    #[serde(default)]
    pub grid_cap: Option<u32>,
}

fn default_respins_reset() -> u32 { 3 }

impl MoneyCollectParams {
    pub fn validate(&self) -> Result<(), String> {
        if !(0.0..=1.0).contains(&self.p_per_cell) {
            return Err(format!("p_per_cell {} outside [0,1]", self.p_per_cell));
        }
        if self.n_cells < 1 {
            return Err("n_cells must be ≥ 1".into());
        }
        if self.trigger_count_min < 1 {
            return Err("trigger_count_min must be ≥ 1".into());
        }
        if self.respins_reset < 1 {
            return Err("respins_reset must be ≥ 1".into());
        }
        if self.value_table.is_empty() {
            return Err("value_table must be non-empty".into());
        }
        for &w in self.value_table.values() {
            if w < 0.0 {
                return Err("value_table weights must be ≥ 0".into());
            }
        }
        Ok(())
    }
}

fn parse_value_table(t: &BTreeMap<String, f64>) -> Vec<(f64, f64)> {
    t.iter()
        .map(|(k, v)| (k.parse::<f64>().unwrap_or(0.0), *v))
        .collect()
}

pub fn expected_money_value(t: &BTreeMap<String, f64>) -> f64 {
    let pairs = parse_value_table(t);
    let total: f64 = pairs.iter().map(|(_, w)| *w).sum();
    if total <= 0.0 {
        return 0.0;
    }
    pairs.iter().map(|(v, w)| v * (w / total)).sum()
}

pub fn initial_trigger_probability(
    p_per_cell: f64, n_cells: u32, trigger_count_min: u32,
) -> f64 {
    if trigger_count_min > n_cells {
        return 0.0;
    }
    let q = 1.0 - p_per_cell;
    if q == 0.0 {
        return if trigger_count_min == 0 { 1.0 } else { 1.0 };
    }
    let n = n_cells;
    let mut pmf = q.powi(n as i32);
    let mut cdf_below = pmf;  // k = 0
    for k in 1..trigger_count_min {
        pmf *= ((n - k + 1) as f64) / (k as f64) * (p_per_cell / q);
        cdf_below += pmf;
    }
    (1.0 - cdf_below).max(0.0)
}

pub fn expected_episode_total_value(
    p: &MoneyCollectParams,
    initial_locked_mean_opt: Option<f64>,
) -> f64 {
    let grid_cap = p.grid_cap.unwrap_or(p.n_cells) as usize;
    let initial_locked_mean = initial_locked_mean_opt
        .unwrap_or(p.trigger_count_min as f64);

    let r_max = p.respins_reset as usize;
    let n = p.n_cells as usize;
    let prob = p.p_per_cell;

    // 2D state matrix: e[k][r] for k in [0, grid_cap], r in [0, R]
    let mut e: Vec<Vec<f64>> = vec![vec![0.0; r_max + 1]; grid_cap + 1];
    // Terminal: e[k][0] = k. e[grid_cap][r] = grid_cap.
    for k in 0..=grid_cap {
        e[k][0] = k as f64;
    }
    for r in 0..=r_max {
        e[grid_cap][r] = grid_cap as f64;
    }

    // Fixed-point iteration
    for _ in 0..50 {
        let mut max_delta = 0.0_f64;
        for r in 1..=r_max {
            for k in 0..grid_cap {
                let cells_open = n.saturating_sub(k);
                if cells_open == 0 {
                    continue;
                }
                // Binomial PMF over m new wilds, m=0..cells_open
                let q = 1.0 - prob;
                let pmf = q.powi(cells_open as i32);
                // m=0: stay at k, r→r-1
                let mut exp_next = pmf * e[k][r - 1];
                let mut pmf_m = pmf;
                for m in 1..=cells_open {
                    if q == 0.0 {
                        pmf_m = if m == cells_open { 1.0 } else { 0.0 };
                    } else {
                        pmf_m *= ((cells_open - m + 1) as f64) / (m as f64)
                            * (prob / q);
                    }
                    let next_k = (k + m).min(grid_cap);
                    let next_r = r_max;  // money landed → reset
                    exp_next += pmf_m * e[next_k][next_r];
                }
                let delta = (exp_next - e[k][r]).abs();
                if delta > max_delta {
                    max_delta = delta;
                }
                e[k][r] = exp_next;
            }
        }
        if max_delta < 1e-12 {
            break;
        }
    }

    // Linear interpolation at initial_locked_mean
    let k_lo = initial_locked_mean as usize;
    let k_hi = (k_lo + 1).min(grid_cap);
    let frac = initial_locked_mean - k_lo as f64;
    let expected_k = (1.0 - frac) * e[k_lo][r_max] + frac * e[k_hi][r_max];

    expected_k * expected_money_value(&p.value_table)
}

#[derive(Debug, Serialize)]
pub struct MoneyCollectResult {
    pub trigger_p: f64,
    pub expected_value_per_money: f64,
    pub expected_total_per_episode: f64,
    pub rtp_contribution: f64,
}

pub fn money_collect_rtp_contribution(p: &MoneyCollectParams) -> MoneyCollectResult {
    let trig = initial_trigger_probability(p.p_per_cell, p.n_cells, p.trigger_count_min);
    let e_v = expected_money_value(&p.value_table);
    let e_total = expected_episode_total_value(p, None);
    let rtp = trig * e_total;
    MoneyCollectResult {
        trigger_p: trig,
        expected_value_per_money: e_v,
        expected_total_per_episode: e_total,
        rtp_contribution: rtp,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ce_like_params() -> MoneyCollectParams {
        let mut vt: BTreeMap<String, f64> = BTreeMap::new();
        vt.insert("1.0".into(), 50.0);
        vt.insert("2.0".into(), 30.0);
        vt.insert("5.0".into(), 15.0);
        vt.insert("10.0".into(), 4.0);
        vt.insert("50.0".into(), 1.0);
        MoneyCollectParams {
            p_per_cell: 0.04,
            n_cells: 15,
            trigger_count_min: 6,
            value_table: vt,
            respins_reset: 3,
            grid_cap: Some(15),
        }
    }

    #[test]
    fn ce_trigger_p_matches_python_within_eps() {
        let p = initial_trigger_probability(0.04, 15, 6);
        // Python reference: 1.499e-5 (from MONEY_COLLECT_KERNEL.json fixture)
        assert!((p - 1.4991e-5).abs() < 1e-7,
                "trigger_p {} not near 1.499e-5", p);
    }

    #[test]
    fn e_v_uniform() {
        let mut t: BTreeMap<String, f64> = BTreeMap::new();
        t.insert("1.0".into(), 1.0);
        t.insert("2.0".into(), 1.0);
        t.insert("4.0".into(), 1.0);
        let e_v = expected_money_value(&t);
        // (1+2+4)/3 = 2.333
        assert!((e_v - 7.0 / 3.0).abs() < 1e-12);
    }

    #[test]
    fn full_kernel_run() {
        let p = ce_like_params();
        let r = money_collect_rtp_contribution(&p);
        assert!(r.trigger_p > 0.0);
        assert!(r.rtp_contribution > 0.0);
        assert!(r.rtp_contribution < 1.0);
    }
}
