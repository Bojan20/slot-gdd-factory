//! PAR-021 — Exact rational arithmetic for regulator pre-certification.
//!
//! When a regulator (Nevada GCB, MGA, AAMS) reviews a math sheet they often
//! want to see the **exact** probability expressed as `p/q` rather than a
//! truncated decimal — particularly for jurisdictions that audit games
//! against deterministic full-cycle math. `f64::powi` and `(1.0 - p)` lose
//! precision at the 15th significant digit, which breaks "I can replay
//! every spin in the cycle and the books balance" expectations.
//!
//! This module wraps `num_rational::BigRational` so callers can:
//!   * convert weight integers (`u32`) to exact probabilities `count / total`
//!   * multiply probabilities across reels for n-of-a-kind exact contribution
//!   * sum contributions across paylines / pay rules
//!
//! Performance is intentionally not the priority — solver only runs once per
//! game-build, on the order of a few hundred multiplications. Sub-second
//! even for a 10×5 paytable.

use num_bigint::BigInt;
use num_rational::BigRational;
use num_traits::{One, Zero};

/// Convert a `u32` count + total into an exact probability fraction.
pub fn exact_probability(count: u32, total: u32) -> BigRational {
    if total == 0 {
        return BigRational::zero();
    }
    BigRational::new(BigInt::from(count), BigInt::from(total))
}

/// Multiply a slice of probabilities into one product fraction (∏ p_i).
pub fn product(probs: &[BigRational]) -> BigRational {
    probs.iter().fold(BigRational::one(), |acc, p| acc * p)
}

/// Sum a slice of contributions into one sum fraction (Σ c_i).
pub fn sum(contribs: &[BigRational]) -> BigRational {
    contribs.iter().fold(BigRational::zero(), |acc, c| acc + c)
}

/// Format a `BigRational` as `p/q` (irreducible) — always shows the slash.
pub fn fmt_pq(r: &BigRational) -> String {
    format!("{}/{}", r.numer(), r.denom())
}

/// Convert to f64 (lossy) for sanity-checking against the simulator.
pub fn to_f64(r: &BigRational) -> f64 {
    let n: f64 = r.numer().to_string().parse().unwrap_or(0.0);
    let d: f64 = r.denom().to_string().parse().unwrap_or(1.0);
    n / d
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_probability_reduces_to_lowest_terms() {
        let p = exact_probability(8, 72);
        // 8/72 = 1/9.
        assert_eq!(fmt_pq(&p), "1/9");
    }

    #[test]
    fn product_of_three_one_over_nine_equals_one_over_729() {
        let p = exact_probability(8, 72);
        let prod = product(&[p.clone(), p.clone(), p]);
        assert_eq!(fmt_pq(&prod), "1/729");
    }

    #[test]
    fn sum_of_fractions_finds_common_denominator() {
        let a = exact_probability(1, 3);
        let b = exact_probability(1, 6);
        let total = sum(&[a, b]);
        // 1/3 + 1/6 = 2/6 + 1/6 = 3/6 = 1/2.
        assert_eq!(fmt_pq(&total), "1/2");
    }

    #[test]
    fn to_f64_matches_simulator_within_epsilon() {
        let p = exact_probability(1, 3);
        let f = to_f64(&p);
        assert!((f - 1.0 / 3.0).abs() < 1e-15);
    }

    #[test]
    fn divide_by_zero_returns_zero_fraction() {
        let p = exact_probability(5, 0);
        assert!(p.is_zero());
    }
}
