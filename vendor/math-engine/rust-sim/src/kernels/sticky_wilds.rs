//! W244.23 — sticky_wilds Rust port.
//!
//! Exact Markov DP over (wild_count, respin_t) state using iterative
//! Binomial PMF construction.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StickyWildsParams {
    pub trigger_p: f64,
    pub n_respins: u32,
    pub n_cells: u32,
    pub p_wild_per_cell_per_respin: f64,
    /// {k_wilds: avg_pay_x_bet}
    pub pay_per_wild_count: BTreeMap<u32, f64>,
    #[serde(default = "default_initial_wilds")]
    pub initial_wilds: u32,
}

fn default_initial_wilds() -> u32 { 1 }

impl StickyWildsParams {
    pub fn validate(&self) -> Result<(), String> {
        if !(0.0..=1.0).contains(&self.trigger_p) {
            return Err(format!("trigger_p {} outside [0,1]", self.trigger_p));
        }
        if self.n_respins < 1 {
            return Err("n_respins must be ≥ 1".into());
        }
        if self.n_cells < 1 {
            return Err("n_cells must be ≥ 1".into());
        }
        if !(0.0..=1.0).contains(&self.p_wild_per_cell_per_respin) {
            return Err(format!(
                "p_wild_per_cell_per_respin {} outside [0,1]",
                self.p_wild_per_cell_per_respin
            ));
        }
        if self.initial_wilds > self.n_cells {
            return Err("initial_wilds > n_cells".into());
        }
        if self.pay_per_wild_count.is_empty() {
            return Err("pay_per_wild_count must be non-empty".into());
        }
        for &v in self.pay_per_wild_count.values() {
            if v < 0.0 {
                return Err("pay value must be ≥ 0".into());
            }
        }
        Ok(())
    }
}

pub fn wild_count_distribution_at_respin(
    p: &StickyWildsParams,
) -> Vec<Vec<f64>> {
    let n = p.n_cells as usize;
    let prob = p.p_wild_per_cell_per_respin;
    let n_respins = p.n_respins as usize;

    let mut initial: Vec<f64> = vec![0.0; n + 1];
    initial[p.initial_wilds as usize] = 1.0;

    let mut distributions: Vec<Vec<f64>> = Vec::with_capacity(n_respins + 1);
    distributions.push(initial.clone());
    let mut current = initial;

    for _ in 0..n_respins {
        let mut new_dist: Vec<f64> = vec![0.0; n + 1];
        for (k, &pk) in current.iter().enumerate() {
            if pk == 0.0 {
                continue;
            }
            let cells_open = n.saturating_sub(k);
            if cells_open == 0 {
                new_dist[k] += pk;
                continue;
            }
            let q = 1.0 - prob;
            let mut pmf = q.powi(cells_open as i32);
            new_dist[k] += pk * pmf;
            for m in 1..=cells_open {
                if q == 0.0 {
                    pmf = if m == cells_open { 1.0 } else { 0.0 };
                } else {
                    pmf *= ((cells_open - m + 1) as f64) / (m as f64) * (prob / q);
                }
                let new_k = (k + m).min(n);
                new_dist[new_k] += pk * pmf;
            }
        }
        distributions.push(new_dist.clone());
        current = new_dist;
    }
    distributions
}

pub fn expected_pay_per_chain(p: &StickyWildsParams) -> f64 {
    let dists = wild_count_distribution_at_respin(p);
    let mut total = 0.0_f64;
    for t in 1..=(p.n_respins as usize) {
        let dist = &dists[t];
        for (k, &prob) in dist.iter().enumerate() {
            if prob == 0.0 {
                continue;
            }
            let pay = p.pay_per_wild_count.get(&(k as u32)).copied().unwrap_or(0.0);
            total += prob * pay;
        }
    }
    total
}

#[derive(Debug, Serialize)]
pub struct StickyWildsResult {
    pub rtp_contribution: f64,
    pub trigger_p: f64,
    pub n_respins: u32,
    pub n_cells: u32,
    pub p_wild_per_cell_per_respin: f64,
    pub initial_wilds: u32,
    pub expected_wilds_per_respin: Vec<f64>,
    pub expected_pay_per_chain_x_bet: f64,
}

pub fn sticky_wilds_rtp(p: &StickyWildsParams) -> StickyWildsResult {
    let e_pay = expected_pay_per_chain(p);
    let rtp = p.trigger_p * e_pay;
    let dists = wild_count_distribution_at_respin(p);
    let e_wilds: Vec<f64> = dists.iter().skip(1)
        .map(|d| d.iter().enumerate().map(|(k, &p_k)| (k as f64) * p_k).sum())
        .collect();
    StickyWildsResult {
        rtp_contribution: rtp,
        trigger_p: p.trigger_p,
        n_respins: p.n_respins,
        n_cells: p.n_cells,
        p_wild_per_cell_per_respin: p.p_wild_per_cell_per_respin,
        initial_wilds: p.initial_wilds,
        expected_wilds_per_respin: e_wilds,
        expected_pay_per_chain_x_bet: e_pay,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distributions_sum_to_one() {
        let mut pay = BTreeMap::new();
        pay.insert(1, 1.0);
        let p = StickyWildsParams {
            trigger_p: 0.01, n_respins: 4, n_cells: 15,
            p_wild_per_cell_per_respin: 0.08,
            pay_per_wild_count: pay,
            initial_wilds: 1,
        };
        let dists = wild_count_distribution_at_respin(&p);
        for d in &dists {
            let s: f64 = d.iter().sum();
            assert!((s - 1.0).abs() < 1e-10);
        }
    }
}
