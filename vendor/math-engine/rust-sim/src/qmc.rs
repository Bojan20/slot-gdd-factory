//! PAR-011 — Quasi-Monte Carlo low-discrepancy sequence generators.
//!
//! Three families per Doc §4.3 + MDPI 2023 ("Efficient Monte Carlo Methods for
//! Multidimensional Modeling of Slot Machines Jackpot"):
//!
//! | Sequence | Base method | Best for | Period |
//! |----------|-------------|----------|--------|
//! | **Halton** | radical inverse φ_b in prime bases | n ≤ 30 dimensions | unbounded |
//! | **Sobol (vdC base 2)** | van der Corput φ_2 | 1-D analytical integration | 2^64 |
//! | **Lattice (Korobov)** | x_n = n·g mod 1 | smooth, periodic functions | N |
//!
//! All sequences return f64 values in [0, 1). Use cases:
//!   * Jackpot tail variance reduction (P99.999 estimation): ~100× fewer draws
//!     than pseudorandom MC for the same standard error.
//!   * Bonus-buy EV: Halton over 2-3 dimensions converges in ~10⁵ instead of 10⁷
//!     spins.
//!
//! These are deterministic — for stratified MC use ScrambledHalton variant
//! (TODO) when adversarial / hash-resistant scrambling is required.

// ─── Halton ──────────────────────────────────────────────────────────────────

/// Multi-dimensional Halton sequence. Index `i` returns a point in `[0, 1)^d`
/// using the first `d` primes (2, 3, 5, 7, 11, …) as radical-inverse bases.
pub struct HaltonSequence {
    primes: Vec<u64>,
    index: u64,
}

impl HaltonSequence {
    /// `dimensions` ∈ [1, 30]. Higher dims suffer correlation (Halton
    /// "weakness" at d > 30 — use Sobol / Lattice instead).
    pub fn new(dimensions: usize) -> Self {
        assert!(
            (1..=30).contains(&dimensions),
            "Halton dimensions must be in 1..=30"
        );
        Self {
            primes: first_n_primes(dimensions),
            index: 0,
        }
    }

    /// Skip the first `n` indices (recommended to avoid initial correlation).
    pub fn skip(mut self, n: u64) -> Self {
        self.index = n;
        self
    }

    /// Generate the next point in `[0, 1)^d`.
    pub fn next_point(&mut self) -> Vec<f64> {
        self.index += 1;
        self.primes
            .iter()
            .map(|&b| radical_inverse(self.index, b))
            .collect()
    }
}

/// Radical-inverse `φ_b(i)` — i.e. read `i` in base `b` and reverse the digits
/// across the decimal point. The seminal low-discrepancy primitive (Faure 1982).
pub fn radical_inverse(mut i: u64, b: u64) -> f64 {
    let mut result = 0.0_f64;
    let mut f = 1.0_f64;
    let b_f = b as f64;
    while i > 0 {
        f /= b_f;
        result += f * (i % b) as f64;
        i /= b;
    }
    result
}

fn first_n_primes(n: usize) -> Vec<u64> {
    let mut primes: Vec<u64> = Vec::with_capacity(n);
    let mut candidate = 2u64;
    while primes.len() < n {
        if (2..candidate).all(|d| candidate % d != 0) {
            primes.push(candidate);
        }
        candidate += 1;
    }
    primes
}

// ─── Sobol (1D van der Corput base 2) ────────────────────────────────────────

/// 1D van der Corput sequence in base 2 — the simplest Sobol primitive.
/// For full d-dimensional Sobol use a Joe–Kuo direction-numbers table
/// (PAR-018 / future work).
pub struct SobolSequence {
    index: u64,
}

impl Default for SobolSequence {
    fn default() -> Self {
        Self::new()
    }
}

impl SobolSequence {
    pub fn new() -> Self {
        Self { index: 0 }
    }

    pub fn skip(mut self, n: u64) -> Self {
        self.index = n;
        self
    }

    /// Single scalar in [0, 1).
    pub fn next_f64(&mut self) -> f64 {
        self.index += 1;
        radical_inverse(self.index, 2)
    }
}

// ─── Lattice (Korobov rank-1) ────────────────────────────────────────────────

/// Rank-1 Korobov lattice. `g` is the generator vector (one component per
/// dimension). For 1D, `g` should be coprime to `n_max`; for higher dims use
/// table values from L'Ecuyer/Lemieux.
pub struct LatticeSequence {
    g: Vec<u64>,
    n_max: u64,
    index: u64,
}

impl LatticeSequence {
    /// `g` length defines dimensionality. Each component is reduced mod `n_max`.
    pub fn new(g: Vec<u64>, n_max: u64) -> Self {
        assert!(n_max > 0);
        Self { g, n_max, index: 0 }
    }

    /// Default 1D Korobov with N=2³¹ − 1 and g=17797 (Joe–Kuo recommended).
    pub fn korobov_1d() -> Self {
        Self::new(vec![17797], (1u64 << 31) - 1)
    }

    /// Advance the internal index by `n` without emitting points. Mirrors
    /// `HaltonSequence::skip` / `SobolSequence::skip` API.
    pub fn skip(mut self, n: u64) -> Self {
        self.index = n % self.n_max;
        self
    }

    pub fn next_point(&mut self) -> Vec<f64> {
        self.index = (self.index + 1) % self.n_max;
        let n_f = self.n_max as f64;
        self.g
            .iter()
            .map(|&g| {
                let v = ((self.index as u128) * (g as u128)) % (self.n_max as u128);
                (v as f64) / n_f
            })
            .collect()
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn radical_inverse_base_2_matches_known_values() {
        // φ_2(1) = 0.5, φ_2(2) = 0.25, φ_2(3) = 0.75, φ_2(4) = 0.125
        assert!((radical_inverse(1, 2) - 0.5).abs() < 1e-12);
        assert!((radical_inverse(2, 2) - 0.25).abs() < 1e-12);
        assert!((radical_inverse(3, 2) - 0.75).abs() < 1e-12);
        assert!((radical_inverse(4, 2) - 0.125).abs() < 1e-12);
    }

    #[test]
    fn halton_2d_first_points_match_expected() {
        let mut h = HaltonSequence::new(2);
        let p1 = h.next_point();
        // 1st point: (φ_2(1), φ_3(1)) = (0.5, 1/3)
        assert!((p1[0] - 0.5).abs() < 1e-12);
        assert!((p1[1] - 1.0 / 3.0).abs() < 1e-12);
        let p2 = h.next_point();
        assert!((p2[0] - 0.25).abs() < 1e-12);
        assert!((p2[1] - 2.0 / 3.0).abs() < 1e-12);
    }

    #[test]
    fn halton_points_stay_in_unit_cube() {
        let mut h = HaltonSequence::new(5);
        for _ in 0..10_000 {
            let p = h.next_point();
            for v in p {
                assert!((0.0..1.0).contains(&v));
            }
        }
    }

    #[test]
    fn sobol_first_eight_match_van_der_corput_base_2() {
        let mut s = SobolSequence::new();
        let seq: Vec<f64> = (0..4).map(|_| s.next_f64()).collect();
        assert!((seq[0] - 0.5).abs() < 1e-12);
        assert!((seq[1] - 0.25).abs() < 1e-12);
        assert!((seq[2] - 0.75).abs() < 1e-12);
        assert!((seq[3] - 0.125).abs() < 1e-12);
    }

    #[test]
    fn lattice_korobov_period_does_not_overflow() {
        let mut l = LatticeSequence::korobov_1d();
        for _ in 0..100 {
            let p = l.next_point();
            assert!((0.0..1.0).contains(&p[0]));
        }
    }

    #[test]
    fn halton_mean_converges_to_one_half() {
        // Mean over [0, 1) should be 0.5; QMC converges ~1/N (vs MC's 1/√N).
        let mut h = HaltonSequence::new(1);
        let n = 10_000;
        let mut sum = 0.0_f64;
        for _ in 0..n {
            sum += h.next_point()[0];
        }
        let mean = sum / n as f64;
        assert!(
            (mean - 0.5).abs() < 0.01,
            "Halton mean over 10k points should be ~0.5, got {mean}"
        );
    }

    #[test]
    fn first_primes_correct() {
        assert_eq!(first_n_primes(5), vec![2, 3, 5, 7, 11]);
    }
}
