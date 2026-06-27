//! W244 wave 73 — hot kernels exposed as WebAssembly for browser-side eval.
//!
//! 5 most-frequently-evaluated W244 closed-form kernels compiled to wasm32
//! via wasm-pack. Designed for vendor browser embedding (e.g. inline RTP
//! preview u math-designer studio UI).
//!
//! Build:
//!   wasm-pack build --target web --release
//!
//! Output (`pkg/`):
//!   - slot_math_wasm.js (ES module wrapper)
//!   - slot_math_wasm_bg.wasm (~ several KB stripped)
//!   - slot_math_wasm.d.ts (TypeScript bindings)
//!
//! Pure-stdlib math, no float intrinsics that drift across platforms.
//! ULP-identical to Python `slot_math_kernels` reference impl.

use wasm_bindgen::prelude::*;

// ── both_ways ─────────────────────────────────────────────────────────────
//
// RTP = ltr_only_rtp × (1 + line_pay_share)
//
/// Compute both-ways RTP contribution.
/// `ltr_only_rtp` ∈ [0, 2], `line_pay_share` ∈ [0, 1].
#[wasm_bindgen]
pub fn both_ways_rtp(ltr_only_rtp: f64, line_pay_share: f64) -> f64 {
    ltr_only_rtp * (1.0 + line_pay_share)
}

// ── charge_meter ──────────────────────────────────────────────────────────
//
// RTP_tier = a_t / (τ_t / λ)  per Wald's identity.
// Multi-tier: sum independently.
//
/// Compute charge-meter RTP contribution for a single tier.
#[wasm_bindgen]
pub fn charge_meter_tier_rtp(
    expected_charge_per_spin: f64,
    tier_threshold: f64,
    tier_award_value_x_bet: f64,
) -> f64 {
    if tier_threshold <= 0.0 || expected_charge_per_spin <= 0.0 {
        return 0.0;
    }
    let spins_to_threshold = tier_threshold / expected_charge_per_spin;
    tier_award_value_x_bet / spins_to_threshold
}

// ── buy_feature ───────────────────────────────────────────────────────────
//
// buy_rtp = E[bonus_pay] / buy_cost
//
/// Compute Buy Feature RTP from average bonus payout + buy cost.
#[wasm_bindgen]
pub fn buy_feature_rtp(
    bonus_average_pay_x_bet: f64,
    buy_cost_x_bet: f64,
) -> f64 {
    if buy_cost_x_bet <= 0.0 {
        return 0.0;
    }
    bonus_average_pay_x_bet / buy_cost_x_bet
}

/// UKGC RTS 13C compliance gate: |buy_rtp - base_rtp| ≤ tolerance_pp.
/// Returns true if compliance gate PASSES.
#[wasm_bindgen]
pub fn buy_feature_ukgc_rts13c_pass(
    bonus_average_pay_x_bet: f64,
    buy_cost_x_bet: f64,
    base_game_rtp: f64,
    tolerance_pp: f64,
) -> bool {
    let buy = buy_feature_rtp(bonus_average_pay_x_bet, buy_cost_x_bet);
    (buy - base_game_rtp).abs() <= tolerance_pp / 100.0
}

/// MGA RG 2021/02 compliance gate: buy_rtp ≤ ceiling.
#[wasm_bindgen]
pub fn buy_feature_mga_pass(
    bonus_average_pay_x_bet: f64,
    buy_cost_x_bet: f64,
    ceiling_rtp: f64,
) -> bool {
    buy_feature_rtp(bonus_average_pay_x_bet, buy_cost_x_bet) <= ceiling_rtp
}

// ── pay_anywhere ─────────────────────────────────────────────────────────
//
// RTP = trigger_p × (Σ_{k≥k_min} C(N,k) p^k (1-p)^{N-k} · v_k)
// (where pay_table maps k → value_x_bet)
//
/// Compute pay-anywhere expected pay per spin from triggers.
///
/// `pay_table_keys[i]` = symbol count threshold, `pay_table_values[i]` = pay × bet.
#[wasm_bindgen]
pub fn pay_anywhere_expected_pay(
    n_cells: u32,
    p_per_cell: f64,
    pay_table_keys: &[u32],
    pay_table_values: &[f64],
) -> f64 {
    if pay_table_keys.len() != pay_table_values.len() {
        return 0.0;
    }
    let mut expected = 0.0;
    for (k, v) in pay_table_keys.iter().zip(pay_table_values.iter()) {
        let pmf = binomial_pmf_ge(n_cells, p_per_cell, *k);
        expected += pmf * v;
    }
    expected
}

// ── stacked_wilds / binomial helpers ─────────────────────────────────────
//
fn binomial_pmf_ge(n: u32, p: f64, k_min: u32) -> f64 {
    // P[X ≥ k_min] = 1 - sum_{k=0}^{k_min-1} C(n,k) p^k (1-p)^{n-k}
    // Computed via iterative product to avoid factorial overflow.
    if k_min == 0 {
        return 1.0;
    }
    if k_min > n {
        return 0.0;
    }
    let mut tail = 0.0;
    let q = 1.0 - p;
    let mut coeff = q.powi(n as i32);
    tail += coeff;
    for k in 1..k_min {
        // C(n, k) = C(n, k-1) × (n-k+1)/k
        coeff = coeff * (n as f64 - k as f64 + 1.0) / (k as f64)
            * p / q;
        tail += coeff;
    }
    1.0 - tail
}

/// Expose binomial PMF P[X ≥ k_min | n, p] for ad-hoc wasm callers.
#[wasm_bindgen(js_name = binomialPmfGe)]
pub fn binomial_pmf_ge_js(n: u32, p: f64, k_min: u32) -> f64 {
    binomial_pmf_ge(n, p, k_min)
}

// ── wheel ─────────────────────────────────────────────────────────────────
//
// E[award] = E[terminal] / (1 - p_again)  — geometric amortisation.
//
/// Compute wheel RTP contribution given trigger probability,
/// terminal expected award × bet, and spin-again probability.
#[wasm_bindgen]
pub fn wheel_rtp(
    trigger_p: f64,
    expected_terminal_award_x_bet: f64,
    p_again: f64,
) -> f64 {
    if p_again >= 1.0 {
        // Degenerate: would loop forever. Clamp to 0.
        return 0.0;
    }
    let e_award = expected_terminal_award_x_bet / (1.0 - p_again);
    trigger_p * e_award
}

// ── ways_evaluator ───────────────────────────────────────────────────────
//
// ways = Π_{r=1}^{R} n_r — product over reels of symbol multiplicity.
//
/// Compute Megaways-style total ways from per-reel symbol counts.
#[wasm_bindgen]
pub fn ways_total(per_reel_symbols: &[u32]) -> u64 {
    per_reel_symbols.iter().map(|&n| n as u64).product()
}

// ── crash_kernel ─────────────────────────────────────────────────────────
//
// P[X < m] = 1 - (1-h)/m  (Pareto with house edge h)
//
/// Crash-game probability that the crash multiplier is below `m`.
#[wasm_bindgen]
pub fn crash_probability_below(house_edge: f64, m: f64) -> f64 {
    if m <= 1.0 || !(0.0..1.0).contains(&house_edge) {
        return 0.0;
    }
    1.0 - (1.0 - house_edge) / m
}

// ── tests ────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_ways_thunderstruck() {
        let r = both_ways_rtp(0.96, 0.7);
        assert!((r - 1.632).abs() < 1e-12);
    }

    #[test]
    fn both_ways_no_share() {
        assert!((both_ways_rtp(0.96, 0.0) - 0.96).abs() < 1e-12);
    }

    #[test]
    fn charge_meter_wald() {
        // 10 / (50 / 0.5) = 0.1
        let r = charge_meter_tier_rtp(0.5, 50.0, 10.0);
        assert!((r - 0.10).abs() < 1e-12);
    }

    #[test]
    fn buy_feature_rtp_basic() {
        let r = buy_feature_rtp(95.0, 100.0);
        assert!((r - 0.95).abs() < 1e-12);
    }

    #[test]
    fn buy_feature_ukgc_fails_at_0p5() {
        // 0.95 vs 0.965 = 1.5pp > 0.5pp → FAIL
        assert!(!buy_feature_ukgc_rts13c_pass(95.0, 100.0, 0.965, 0.5));
    }

    #[test]
    fn buy_feature_ukgc_passes_at_2pp() {
        assert!(buy_feature_ukgc_rts13c_pass(95.0, 100.0, 0.965, 2.0));
    }

    #[test]
    fn buy_feature_mga_compliance() {
        // 0.95 ≤ 0.96 → PASS
        assert!(buy_feature_mga_pass(95.0, 100.0, 0.96));
        // 0.95 ≤ 0.94 → FAIL
        assert!(!buy_feature_mga_pass(95.0, 100.0, 0.94));
    }

    #[test]
    fn binomial_pmf_ge_basic() {
        // P[X ≥ 0 | n=10, p=0.1] = 1
        assert!((binomial_pmf_ge(10, 0.1, 0) - 1.0).abs() < 1e-12);
        // P[X ≥ 1 | n=10, p=0.1] = 1 - 0.9^10 ≈ 0.65132
        let r = binomial_pmf_ge(10, 0.1, 1);
        assert!((r - 0.6513215599).abs() < 1e-9);
        // P[X ≥ 11 | n=10, p=*] = 0
        assert!((binomial_pmf_ge(10, 0.1, 11) - 0.0).abs() < 1e-12);
    }

    #[test]
    fn pay_anywhere_basic() {
        // 6 cells, p=0.5, pay 1.0× when k≥3
        let keys = [3u32];
        let vals = [1.0];
        let r = pay_anywhere_expected_pay(6, 0.5, &keys, &vals);
        // P[X≥3 | n=6, p=0.5] = 0.65625
        assert!((r - 0.65625).abs() < 1e-9);
    }

    #[test]
    fn wheel_geometric_amort() {
        // trigger 0.01, terminal expected 5.0, p_again 0.2
        // E[award] = 5 / 0.8 = 6.25 → RTP = 0.01 × 6.25 = 0.0625
        let r = wheel_rtp(0.01, 5.0, 0.2);
        assert!((r - 0.0625).abs() < 1e-12);
    }

    #[test]
    fn wheel_no_again() {
        assert!((wheel_rtp(0.01, 5.0, 0.0) - 0.05).abs() < 1e-12);
    }

    #[test]
    fn ways_total_megaways() {
        // 6-reel Megaways: 7^6 = 117649
        let r = ways_total(&[7, 7, 7, 7, 7, 7]);
        assert_eq!(r, 117_649);
    }

    #[test]
    fn ways_total_243() {
        // 5-reel 3-rows: 3^5 = 243
        let r = ways_total(&[3, 3, 3, 3, 3]);
        assert_eq!(r, 243);
    }

    #[test]
    fn crash_probability_basic() {
        // h=0.01 (1% house edge), m=2.0
        // P[X<2] = 1 - 0.99/2 = 0.505
        let r = crash_probability_below(0.01, 2.0);
        assert!((r - 0.505).abs() < 1e-12);
    }
}
