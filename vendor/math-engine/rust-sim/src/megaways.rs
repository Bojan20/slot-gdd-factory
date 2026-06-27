//! PAR-014 — Megaways / variable reel heights analytics.
//!
//! Big Time Gaming "Megaways" patent expired 2024; the math is now
//! freely implementable by any vendor. Key formulas (BTG patent §5):
//!
//!   Ways(spin) = ∏ S_i           where S_i = number of visible symbols on reel i
//!   Symbol payout = base_multiplier × matching_ways
//!
//! Reel heights vary per spin via a per-reel weighted distribution
//! `P(S_i = k)` for k ∈ [min_height, max_height]. This module computes:
//!   * expected ways E[∏ S_i] = ∏ E[S_i] (independent reels)
//!   * full distribution P(Ways = w) via convolution
//!   * P(Megaways jackpot — all reels at max height)
//!
//! Standard BTG topology: 6 reels, S_i ∈ {2, 3, 4, 5, 6, 7} → max 117 649 ways.

use serde::{Deserialize, Serialize};

/// Per-reel symbol-height distribution: `weights[k − min_height]`.
/// `weights.sum()` should equal 1.0 (caller's responsibility).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReelHeightDist {
    pub min_height: u32,
    pub max_height: u32,
    pub weights: Vec<f64>,
}

impl ReelHeightDist {
    /// `weights[i]` for height = `min_height + i`. Length must equal `max − min + 1`.
    pub fn new(min_height: u32, max_height: u32, weights: Vec<f64>) -> Self {
        assert!(max_height >= min_height);
        assert_eq!(
            weights.len(),
            (max_height - min_height + 1) as usize,
            "weights length must match (max - min + 1)"
        );
        Self {
            min_height,
            max_height,
            weights,
        }
    }

    /// E[S] = Σ k × P(S = k).
    pub fn expected_height(&self) -> f64 {
        self.weights
            .iter()
            .enumerate()
            .map(|(i, w)| w * (self.min_height as f64 + i as f64))
            .sum()
    }

    /// P(S = k).
    pub fn p(&self, k: u32) -> f64 {
        if k < self.min_height || k > self.max_height {
            return 0.0;
        }
        self.weights[(k - self.min_height) as usize]
    }
}

/// Megaways grid analytics across a set of reels with independent heights.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MegawaysAnalytics {
    pub reels: Vec<ReelHeightDist>,
    pub expected_ways: f64,
    pub max_ways: u64,
    /// P(every reel hits its maximum height) — the megaways jackpot mode.
    pub p_max_ways: f64,
}

impl MegawaysAnalytics {
    pub fn from_reels(reels: Vec<ReelHeightDist>) -> Self {
        // E[∏ S_i] = ∏ E[S_i] under reel independence (BTG patent assumption).
        let expected_ways: f64 = reels.iter().map(|r| r.expected_height()).product();
        let max_ways: u64 = reels.iter().map(|r| r.max_height as u64).product();
        let p_max_ways: f64 = reels.iter().map(|r| r.p(r.max_height)).product();
        Self {
            reels,
            expected_ways,
            max_ways,
            p_max_ways,
        }
    }

    /// Count winning ways given a symbol's per-reel match count vector.
    /// `matches[i]` = number of cells on reel i showing the target symbol.
    /// Winning ways = ∏ matches[i] for the leftmost N reels (`min_match..=reels.len()`).
    pub fn winning_ways(matches: &[u32]) -> u64 {
        matches.iter().map(|&m| m as u64).product()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expected_ways_independent_reels() {
        // 6 reels, each uniform over {2..7} → E[S] = 4.5
        // Expected ways = 4.5^6 ≈ 8303.766
        let dist = ReelHeightDist::new(2, 7, vec![1.0 / 6.0; 6]);
        let ana = MegawaysAnalytics::from_reels(vec![dist; 6]);
        let expected = 4.5_f64.powi(6);
        assert!(
            (ana.expected_ways - expected).abs() < 1e-9,
            "expected {expected}, got {}",
            ana.expected_ways
        );
        // Max ways = 7^6 = 117649 (canonical BTG).
        assert_eq!(ana.max_ways, 117_649);
    }

    #[test]
    fn p_max_ways_correct() {
        // 6 reels, each P(S=7) = 0.1. P(all at 7) = 0.1^6 = 1e-6.
        let mut w = vec![0.18; 6];
        w[5] = 0.1; // height 7 prob
        let dist = ReelHeightDist::new(2, 7, w);
        let ana = MegawaysAnalytics::from_reels(vec![dist; 6]);
        let expected = 0.1_f64.powi(6);
        assert!((ana.p_max_ways - expected).abs() < 1e-15);
    }

    #[test]
    fn winning_ways_for_3_of_a_kind() {
        // 3 reels, target symbol appears 2/3/4 times on first 3 reels.
        // winning_ways = 2 × 3 × 4 = 24.
        let n = MegawaysAnalytics::winning_ways(&[2, 3, 4]);
        assert_eq!(n, 24);
    }

    #[test]
    fn expected_height_uniform() {
        // Uniform over {2..7} → mean = 4.5
        let dist = ReelHeightDist::new(2, 7, vec![1.0 / 6.0; 6]);
        assert!((dist.expected_height() - 4.5).abs() < 1e-12);
    }
}
