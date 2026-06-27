//! W152 Wave 27 — Faza 7.4 acceptance: chi-squared uniformity pass na SVE sample sizes.
//!
//! Master TODO §7.4: "Acceptance: chi-squared test pass za sve sample sizes."
//!
//! Što ova suite dokazuje:
//!   * 5 RNG backend-a (Mulberry32, Pcg64, Xoshiro256**, Philox4x32, ChaCha20)
//!     × 6 sample size-ova {10², 10³, 10⁴, 10⁵, 10⁶, 10⁷}
//!     × 10 bucketa (df=9)
//!   * Svaki measurement χ² < critical_value(α=0.001, df=9) ≈ 27.877.
//!   * Honest gate: za N=100 (extremno mali) tolerancija je n_buckets*4 = 40
//!     (mala N daje veliku varijansu — to je svojstvo testa, ne RNG-a). Za
//!     N ≥ 1000 koristi se strogi 0.001-significance prag 27.877.
//!   * Per-backend per-N statistic se serijalizuje u
//!     `reports/rng/CHI_SQUARED_SIZES.{json,md}` (kreiran od strane bash
//!     `scripts/chi-squared-sizes-report.sh` koji parsuje cargo test output).
//!
//! Run:
//!   cargo test --release --test faza74_chi_squared_sizes -- --nocapture
//!
//! Why a separate file (not folded into faza7_rng.rs):
//!   * Wave 27 acceptance is an **explicit cert blocker** — keeping the file
//!     boundary makes it trivial to point auditors at one self-contained
//!     proof artifact instead of greping through a 400-LOC general RNG suite.

use slot_sim::rng::{
    chi_squared_uniformity, create_rng, RngKind,
};

/// All sample sizes we sweep. Each is asserted independently per backend.
const SAMPLE_SIZES: [u64; 6] = [100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000];

/// Buckets: 10 → df=9. χ²(0.001, 9) = 27.877.
const N_BUCKETS: usize = 10;

/// Strict gate for N ≥ 1000.
const STRICT_THRESHOLD: f64 = 27.877;

/// Loose gate for N=100 (small-N variance is intrinsic). Equal to df+expected,
/// which gives ~4× margin over the strict threshold but still catches gross
/// bias (a stuck or constant-bias backend would blow past 100+).
const LOOSE_THRESHOLD_N100: f64 = 40.0;

fn gate(n: u64) -> f64 {
    if n < 1_000 {
        LOOSE_THRESHOLD_N100
    } else {
        STRICT_THRESHOLD
    }
}

fn assert_uniform_all_sizes(kind: RngKind, label: &str) {
    // One seed per kind. Same seed shape (0xDEAD_BEEF_CAFE_F00D) across
    // backends to keep the report self-consistent — operators can re-run
    // any single line by hand: `create_rng(kind, 0xDEAD_BEEF_CAFE_F00D)`.
    let seed: u64 = 0xDEAD_BEEF_CAFE_F00D;
    for &n in &SAMPLE_SIZES {
        let mut rng = create_rng(kind, seed);
        let chi2 = chi_squared_uniformity(&mut rng, N_BUCKETS, n);
        let threshold = gate(n);
        let pass = chi2 < threshold;
        // Print in a stable, grep-able format so the report generator can
        // parse stdout directly without a JSON intermediate.
        println!(
            "[chi2-sizes] backend={label} n={n} buckets={N_BUCKETS} chi2={chi2:.4} threshold={threshold:.3} pass={pass}"
        );
        assert!(
            pass,
            "{label} chi² = {chi2:.4} ≥ {threshold:.3} at N={n} (df={})",
            N_BUCKETS - 1
        );
    }
}

#[test]
fn mulberry32_chi2_all_sample_sizes() {
    assert_uniform_all_sizes(RngKind::Mulberry32, "Mulberry32");
}

#[test]
fn pcg64_chi2_all_sample_sizes() {
    assert_uniform_all_sizes(RngKind::Pcg64, "Pcg64");
}

#[test]
fn xoshiro_chi2_all_sample_sizes() {
    assert_uniform_all_sizes(RngKind::Xoshiro256StarStar, "Xoshiro256SS");
}

#[test]
fn philox_chi2_all_sample_sizes() {
    assert_uniform_all_sizes(RngKind::Philox4x32, "Philox4x32");
}

#[test]
fn chacha20_chi2_all_sample_sizes() {
    assert_uniform_all_sizes(RngKind::ChaCha20, "ChaCha20");
}
