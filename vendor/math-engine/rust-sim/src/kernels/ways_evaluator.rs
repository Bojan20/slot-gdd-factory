//! W244.25 — ways_evaluator Rust port.
//!
//! Closed-form: E[ways] = product(E[row_count_per_reel]) under reel independence.
//! RTP = E[ways] × per_way_rtp_x_bet.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaysEvaluatorParams {
    /// Per-reel row count distribution. Element i is {row_count: probability}.
    pub row_distribution_per_reel: Vec<BTreeMap<u32, f64>>,
    pub per_way_rtp_x_bet: f64,
}

impl WaysEvaluatorParams {
    pub fn validate(&self) -> Result<(), String> {
        if self.row_distribution_per_reel.is_empty() {
            return Err("row_distribution_per_reel must be non-empty".into());
        }
        if self.per_way_rtp_x_bet < 0.0 {
            return Err("per_way_rtp_x_bet must be ≥ 0".into());
        }
        for (i, dist) in self.row_distribution_per_reel.iter().enumerate() {
            if dist.is_empty() {
                return Err(format!("reel {} distribution must be non-empty", i));
            }
            for (&rows, &prob) in dist {
                if rows < 1 {
                    return Err(format!("reel {}: row count {} must be ≥ 1", i, rows));
                }
                if prob < 0.0 {
                    return Err(format!("reel {}: probability {} must be ≥ 0", i, prob));
                }
            }
            let s: f64 = dist.values().sum();
            if (s - 1.0).abs() > 1e-9 {
                return Err(format!(
                    "reel {}: probabilities sum to {}, expected 1.0", i, s
                ));
            }
        }
        Ok(())
    }
}

pub fn expected_rows_per_reel(p: &WaysEvaluatorParams) -> Vec<f64> {
    p.row_distribution_per_reel.iter()
        .map(|dist| dist.iter().map(|(&r, &prob)| (r as f64) * prob).sum())
        .collect()
}

pub fn expected_ways_count(p: &WaysEvaluatorParams) -> f64 {
    expected_rows_per_reel(p).iter().product()
}

#[derive(Debug, Serialize)]
pub struct PerReel {
    pub reel_index: u32,
    pub expected_rows: f64,
    pub row_distribution: BTreeMap<u32, f64>,
}

#[derive(Debug, Serialize)]
pub struct WaysEvaluatorResult {
    pub rtp_contribution: f64,
    pub n_reels: u32,
    pub expected_rows_per_reel: Vec<f64>,
    pub expected_ways_count: f64,
    pub per_way_rtp_x_bet: f64,
    pub per_reel_breakdown: Vec<PerReel>,
}

pub fn ways_evaluator_rtp(p: &WaysEvaluatorParams) -> WaysEvaluatorResult {
    let e_rows = expected_rows_per_reel(p);
    let e_ways: f64 = e_rows.iter().product();
    let rtp = e_ways * p.per_way_rtp_x_bet;

    let per_reel: Vec<PerReel> = p.row_distribution_per_reel.iter()
        .enumerate()
        .zip(e_rows.iter())
        .map(|((i, dist), &e_r)| PerReel {
            reel_index: i as u32,
            expected_rows: e_r,
            row_distribution: dist.clone(),
        })
        .collect();

    WaysEvaluatorResult {
        rtp_contribution: rtp,
        n_reels: p.row_distribution_per_reel.len() as u32,
        expected_rows_per_reel: e_rows,
        expected_ways_count: e_ways,
        per_way_rtp_x_bet: p.per_way_rtp_x_bet,
        per_reel_breakdown: per_reel,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_243_ways() {
        let mut dist = BTreeMap::new();
        dist.insert(3, 1.0);
        let p = WaysEvaluatorParams {
            row_distribution_per_reel: vec![dist.clone(); 5],
            per_way_rtp_x_bet: 0.96 / 243.0,
        };
        let r = ways_evaluator_rtp(&p);
        assert!((r.expected_ways_count - 243.0).abs() < 1e-10);
        assert!((r.rtp_contribution - 0.96).abs() < 1e-10);
    }

    #[test]
    fn megaways_117649() {
        let mut dist = BTreeMap::new();
        dist.insert(7, 1.0);
        let p = WaysEvaluatorParams {
            row_distribution_per_reel: vec![dist; 6],
            per_way_rtp_x_bet: 0.96 / 117649.0,
        };
        let r = ways_evaluator_rtp(&p);
        assert!((r.expected_ways_count - 117649.0).abs() < 1e-6);
    }
}
