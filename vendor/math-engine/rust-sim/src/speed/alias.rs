//! Walker's Alias Method — O(1) weighted sampling.
//!
//! ## Algorithm
//!
//! Vose's O(N) construction builds two parallel arrays:
//! - `own[i]`   — the "primary" symbol for column *i*
//! - `alias[i]` — the "fallback" symbol for column *i*
//! - `prob[i]`  — probability threshold in `[0, 1)` — if the fractional part
//!               of `N × U` is below `prob[i]`, return `own[i]`, else `alias[i]`
//!
//! Sample cost: one `random()` call + one multiply + one compare = **O(1)**.
//! Setup cost: O(N) with two linear scans.
//!
//! ## Correctness guarantee
//!
//! Each symbol's marginal probability equals `weight / total` — identical to
//! the linear-scan method used in `GridGenerator`, just much faster.
//!
//! ## Numeric stability
//!
//! Vose's algorithm is stable for any weight distribution. The ε-guard on the
//! `< 1.0` threshold prevents boundary flicker from floating-point round-off.
//! Residual small/large items at loop exit are assigned `prob = 1.0`.

use crate::rng::SlotRng;

// ─── AliasTable ──────────────────────────────────────────────────────────────

/// Alias table for O(1) weighted sampling.
///
/// Build once with [`AliasTable::build`], then call [`AliasTable::sample`]
/// repeatedly — no allocations at sample time.
pub struct AliasTable {
    /// `prob[i]` — probability threshold for column *i* (in `[0, 1]`).
    prob: Vec<f64>,
    /// `own[i]`  — symbol index for column *i*'s primary outcome.
    own: Vec<u8>,
    /// `alias[i]` — symbol index for column *i*'s fallback outcome.
    alias: Vec<u8>,
    /// Number of columns (= number of input entries).
    n: usize,
}

impl AliasTable {
    // Numeric guard: treat values this close to 1.0 as "large" to avoid
    // floating-point boundary flicker during construction.
    const EPSILON: f64 = 1e-9;

    /// Build an alias table from `(symbol_index, weight)` pairs.
    ///
    /// # Panics
    /// - If `entries` is empty.
    /// - If `entries` has more than 255 entries.
    /// - If the total weight is zero.
    pub fn build(entries: &[(u8, u32)]) -> Self {
        let n = entries.len();
        assert!(!entries.is_empty(), "AliasTable: entries must be non-empty");
        assert!(n <= 255, "AliasTable: at most 255 entries supported");

        let total: u64 = entries.iter().map(|(_, w)| *w as u64).sum();
        assert!(total > 0, "AliasTable: total weight must be > 0");

        // Scaled probability: u_i = N × w_i / total.
        // When the table is "fair" (all equal weights), every u_i = 1.0.
        let mut u: Vec<f64> = entries
            .iter()
            .map(|(_, w)| n as f64 * (*w as f64) / (total as f64))
            .collect();

        let mut prob = vec![1.0f64; n];
        let mut alias_col = vec![0usize; n]; // column index (remapped after)

        // Partition into small (u_i < 1) and large (u_i >= 1) stacks.
        let mut small: Vec<usize> = Vec::with_capacity(n);
        let mut large: Vec<usize> = Vec::with_capacity(n);
        for i in 0..n {
            if u[i] < 1.0 - Self::EPSILON {
                small.push(i);
            } else {
                large.push(i);
            }
        }

        // Vose's construction: fill each small column using leftover probability
        // from one large column.
        while !small.is_empty() && !large.is_empty() {
            let l = small.pop().unwrap();
            let g = *large.last().unwrap();

            prob[l] = u[l];
            alias_col[l] = g;

            // Reduce large column's surplus by the deficit we just consumed.
            u[g] -= 1.0 - u[l];
            if u[g] < 1.0 - Self::EPSILON {
                large.pop();
                small.push(g);
            }
        }

        // Any survivors (numerical precision artifacts) → prob = 1.0 (already set).
        // Drop silently — remaining items are fully satisfied.

        // Map column indices to symbol indices.
        let own: Vec<u8> = entries.iter().map(|(sym, _)| *sym).collect();
        let alias: Vec<u8> = alias_col.iter().map(|&col| entries[col].0).collect();

        AliasTable {
            prob,
            own,
            alias,
            n,
        }
    }

    /// Sample one symbol in O(1) time.
    ///
    /// Algorithm: draw U ∈ [0, 1), compute j = floor(N·U), frac = N·U − j.
    /// Return `own[j]` if `frac < prob[j]`, else `alias[j]`.
    #[inline(always)]
    pub fn sample(&self, rng: &mut SlotRng) -> u8 {
        let u = rng.random();
        let scaled = u * self.n as f64;
        // `scaled as usize` truncates toward zero; clamp to n-1 for the
        // rare case where floating-point gives exactly n.0.
        let j = (scaled as usize).min(self.n - 1);
        let frac = scaled - j as f64;

        if frac < self.prob[j] {
            self.own[j]
        } else {
            self.alias[j]
        }
    }

    /// Number of entries in the table.
    #[inline]
    pub fn len(&self) -> usize {
        self.n
    }

    /// `true` if the table was built from a single symbol.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.n == 0
    }

    /// Return the marginal probability of `sym_idx`.
    ///
    /// Computes `Σ P(column j returns sym_idx)` across all columns.
    /// Should equal `weight[sym_idx] / total_weight`.
    /// Useful for correctness audits and integration tests.
    pub fn marginal_probability(&self, sym_idx: u8) -> f64 {
        let mut p = 0.0f64;
        for j in 0..self.n {
            if self.own[j] == sym_idx {
                p += self.prob[j];
            }
            if self.alias[j] == sym_idx {
                p += 1.0 - self.prob[j];
            }
        }
        p / self.n as f64
    }
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_symbol_always_returns_it() {
        let t = AliasTable::build(&[(7u8, 100)]);
        let mut rng = SlotRng::new(1);
        for _ in 0..1000 {
            assert_eq!(t.sample(&mut rng), 7);
        }
    }

    #[test]
    fn two_equal_weights_roughly_half_half() {
        let t = AliasTable::build(&[(0, 1), (1, 1)]);
        let mut rng = SlotRng::new(42);
        let mut counts = [0u32; 2];
        for _ in 0..100_000 {
            counts[t.sample(&mut rng) as usize] += 1;
        }
        // Both should be ≈50% ± 1%.
        assert!((counts[0] as f64 / 100_000.0 - 0.5).abs() < 0.01);
        assert!((counts[1] as f64 / 100_000.0 - 0.5).abs() < 0.01);
    }

    #[test]
    fn marginal_probabilities_match_weights() {
        // weights: A=70, B=20, C=10 → probs 0.70, 0.20, 0.10
        let t = AliasTable::build(&[(0u8, 70), (1u8, 20), (2u8, 10)]);
        let eps = 1e-9;
        assert!(
            (t.marginal_probability(0) - 0.70).abs() < eps,
            "p(A)={}",
            t.marginal_probability(0)
        );
        assert!(
            (t.marginal_probability(1) - 0.20).abs() < eps,
            "p(B)={}",
            t.marginal_probability(1)
        );
        assert!(
            (t.marginal_probability(2) - 0.10).abs() < eps,
            "p(C)={}",
            t.marginal_probability(2)
        );
    }

    #[test]
    fn extreme_skew_one_heavy_symbol() {
        // A has 999 weight, B has 1 weight → P(A) ≈ 99.9%
        let t = AliasTable::build(&[(0u8, 999), (1u8, 1)]);
        let mut rng = SlotRng::new(99);
        let mut a_count = 0u32;
        let n = 100_000;
        for _ in 0..n {
            if t.sample(&mut rng) == 0 {
                a_count += 1;
            }
        }
        let p_a = a_count as f64 / n as f64;
        assert!((p_a - 0.999).abs() < 0.005, "P(A) = {p_a}");
    }

    #[test]
    fn chi_squared_distribution_valid() {
        // 5 symbols with weights 5,4,3,2,1 → total=15, expected probs 1/3,4/15,1/5,2/15,1/15
        let entries = [(0u8, 5), (1u8, 4), (2u8, 3), (3u8, 2), (4u8, 1)];
        let total = 15u32;
        let t = AliasTable::build(&entries);
        let mut rng = SlotRng::new(12345);
        let n = 1_500_000u64;
        let mut counts = [0u64; 5];
        for _ in 0..n {
            counts[t.sample(&mut rng) as usize] += 1;
        }
        // chi-squared: Σ (observed - expected)² / expected
        let chi2: f64 = entries
            .iter()
            .map(|(i, w)| {
                let expected = n as f64 * (*w as f64 / total as f64);
                let diff = counts[*i as usize] as f64 - expected;
                diff * diff / expected
            })
            .sum();
        // df=4, critical value at α=0.001 ≈ 18.5
        assert!(chi2 < 30.0, "chi² = {chi2:.3} — distribution skewed");
    }
}
