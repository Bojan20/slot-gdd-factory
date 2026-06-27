//! W152 P1-7 — Persistent-Grid Hold & Win solver (Money Train 4 class).
//!
//! Extends the canonical H&W Markov chain (`markov.rs`) with **multi-class
//! cell occupancy**. Each cell that lands during the feature carries a class
//! drawn i.i.d. from a categorical distribution:
//!
//! * `Cash`              — contributes its value to the terminal cash sum
//! * `Multiplier`        — multiplies the final cash sum (global mult)
//! * `Collector`         — at terminal pays `value × cash_cell_count`
//! * `Inert`             — occupies a cell without paying (lockout / decor)
//!
//! Terminal payout (in bet multiples):
//!
//! ```text
//!   payout = (Σ cash_values) × (Π mult_values)
//!          + (Σ collector_values) × cash_cell_count
//!          + grid_full_award · 1{occupancy = total}
//! ```
//!
//! The expectation is computable in closed form because, conditional on the
//! terminal occupancy `k`, classes are assigned i.i.d. per cell, so for the
//! two non-linear interactions (`Σcash·Πmult`, `Σcol·#cash`) we have:
//!
//! ```text
//!   E[Σcash · Πmult | k] = μ_v · k · p_c · (1 − p_m + p_m·μ_u)^(k−1)
//!   E[Σcol  · #cash | k] = μ_col · k(k−1) · p_col · p_c · μ_v
//! ```
//!
//! Derivation: each cell is independently `Cash` (p_c), `Mult` (p_m),
//! `Collector` (p_col), or `Inert` (1 − …). The product/sum cross terms split
//! along disjoint cells (same cell can hold only one class) and the i.i.d.
//! values factorize. See README §6 of the solver module for the algebra.
//!
//! Coupled directly to the existing `(occupied, respins_left)` Markov chain
//! for `P(k_terminal = i)` — we reuse the binomial-landing forward pass from
//! `markov.rs` rather than re-implementing it.

use serde::{Deserialize, Serialize};

use crate::markov::{solve_hold_and_win, HoldAndWinConfig};

// ─── Class distribution ───────────────────────────────────────────────────────

/// Categorical distribution over cell classes at landing time.
///
/// Probabilities are normalised internally — pass any non-negative values.
/// `μ` parameters are the per-class expected values in bet multiples.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CellClassDistribution {
    /// P(cell is Cash | landing event) before normalisation.
    pub p_cash: f64,
    /// E[Cash value] in bet multiples.
    pub mu_cash: f64,
    /// P(cell is Multiplier | landing event) before normalisation.
    pub p_mult: f64,
    /// E[Multiplier value] (×). For 1× equivalence pass `1.0`.
    pub mu_mult: f64,
    /// P(cell is Collector | landing event) before normalisation.
    pub p_collector: f64,
    /// E[Collector value] in bet multiples (per cash cell it harvests).
    pub mu_collector: f64,
    /// P(cell is Inert | landing event) before normalisation.
    pub p_inert: f64,
}

impl Default for CellClassDistribution {
    fn default() -> Self {
        // Money Train-ish default: 75% cash, 15% mult (avg 2×), 5% collector (×3), 5% inert.
        Self {
            p_cash: 0.75,
            mu_cash: 1.5,
            p_mult: 0.15,
            mu_mult: 2.0,
            p_collector: 0.05,
            mu_collector: 3.0,
            p_inert: 0.05,
        }
    }
}

impl CellClassDistribution {
    /// Normalised probabilities `(p_c, p_m, p_col, p_inert)`.
    fn normalised(&self) -> (f64, f64, f64, f64) {
        let raw = [
            self.p_cash.max(0.0),
            self.p_mult.max(0.0),
            self.p_collector.max(0.0),
            self.p_inert.max(0.0),
        ];
        let sum: f64 = raw.iter().sum();
        if sum <= 0.0 {
            // Degenerate input — treat as 100 % cash so the solver is well-defined.
            return (1.0, 0.0, 0.0, 0.0);
        }
        (raw[0] / sum, raw[1] / sum, raw[2] / sum, raw[3] / sum)
    }
}

// ─── Config ───────────────────────────────────────────────────────────────────

/// Configuration for the persistent-grid H&W analytical solver.
///
/// Wraps a stock `HoldAndWinConfig` (cell-occupancy dynamics) plus a class
/// distribution (payout dynamics).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PersistentGridHwConfig {
    /// Underlying occupancy chain — uses the same binomial landing process
    /// as the standard solver. `expected_cell_value` here is unused (we
    /// derive cash EV from the class distribution); kept for ergonomics.
    pub occupancy: HoldAndWinConfig,
    /// Per-cell class distribution at landing time.
    pub classes: CellClassDistribution,
    /// Optional flat multiplier applied at terminal *after* class mults
    /// (representing a "final reaper" / persistent collector cell that
    /// always fires). Defaults to 1.0.
    pub terminal_global_multiplier: f64,
}

impl Default for PersistentGridHwConfig {
    fn default() -> Self {
        Self {
            occupancy: HoldAndWinConfig::default(),
            classes: CellClassDistribution::default(),
            terminal_global_multiplier: 1.0,
        }
    }
}

// ─── Result ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistentGridHwResult {
    /// E[total payout per trigger] in bet multiples.
    pub expected_payout: f64,
    /// E[cash-cell count at terminal].
    pub expected_cash_cells: f64,
    /// E[multiplier-cell count at terminal].
    pub expected_mult_cells: f64,
    /// E[collector-cell count at terminal].
    pub expected_collector_cells: f64,
    /// E[product of multiplier values across mult cells] = PGF_{#mult}(μ_mult).
    pub expected_mult_product: f64,
    /// E[Σ cash values × Π mult values] — the "core" cash×mult interaction term.
    pub expected_cash_mult_payout: f64,
    /// E[Σ collector × #cash] — the bilinear collector contribution.
    pub expected_collector_payout: f64,
    /// E[grid-full award contribution] = `grid_full_award × P(grid full)`.
    pub expected_grid_full_payout: f64,
    /// P(grid fills completely).
    pub grid_full_probability: f64,
    /// E[occupancy at terminal] (orb count).
    pub expected_orb_count: f64,
    /// PMF over terminal occupancy `i`: `P(k_terminal = i)` for `i ∈ 0..=total_cells`.
    pub terminal_occupancy_pmf: Vec<f64>,
}

// ─── Solver ───────────────────────────────────────────────────────────────────

/// Compute the analytical expected payout of a persistent-grid H&W feature.
///
/// Algorithm:
///   1. Run the underlying occupancy Markov chain (`solve_hold_and_win`).
///   2. Reconstruct the terminal PMF `P(k_terminal = i)` from the forward pass
///      (we re-derive it locally — `HoldAndWinResult::state_values` carries
///      the value table; the PMF needs a separate forward propagation).
///   3. Apply the closed-form expectations per `k`, weight by the PMF.
///
/// # Panics
/// Panics if `occupancy.total_cells > 100`.
pub fn solve_persistent_grid_hw(cfg: &PersistentGridHwConfig) -> PersistentGridHwResult {
    let occ_cfg = &cfg.occupancy;
    let t = occ_cfg.total_cells;
    assert!(
        t <= 100,
        "total_cells={t} exceeds safety cap of 100 — increase if you really need it"
    );

    // ── Underlying occupancy chain ─────────────────────────────────────────
    // Re-use the standard solver for the orb-count metrics.
    let occ_result = solve_hold_and_win(occ_cfg);

    // ── Terminal occupancy PMF ─────────────────────────────────────────────
    // Forward propagation from `init_locked_cells` to terminal.
    let pmf = terminal_occupancy_pmf(occ_cfg);

    // ── Per-class numbers (linear in k) ────────────────────────────────────
    let (p_c, p_m, p_col, _p_inert) = cfg.classes.normalised();
    let mu_v = cfg.classes.mu_cash.max(0.0);
    let mu_u = cfg.classes.mu_mult.max(0.0);
    let mu_col = cfg.classes.mu_collector.max(0.0);
    let g_mult = cfg.terminal_global_multiplier.max(0.0);

    let e_k = occ_result.expected_orb_count;
    let expected_cash_cells = e_k * p_c;
    let expected_mult_cells = e_k * p_m;
    let expected_collector_cells = e_k * p_col;

    // E[Π mult^M] where M ~ assignment of mult class across k cells.
    // = Σ_k P(k) × (1 − p_m + p_m·μ_u)^k
    let zeta = 1.0 - p_m + p_m * mu_u;
    let expected_mult_product: f64 = pmf
        .iter()
        .enumerate()
        .map(|(k, &p)| p * zeta.powi(k as i32))
        .sum();

    // E[Σcash · Πmult] = μ_v · Σ_k P(k) · k · p_c · ζ^(k−1)
    let expected_cash_mult_payout: f64 = pmf
        .iter()
        .enumerate()
        .map(|(k, &p)| {
            if k == 0 {
                0.0
            } else {
                p * (k as f64) * p_c * mu_v * zeta.powi((k as i32) - 1)
            }
        })
        .sum::<f64>()
        * g_mult;

    // E[Σcollector · #cash] = μ_col · μ_v · Σ_k P(k) · k(k−1) · p_col · p_c
    // (k(k−1) drops the same-cell coincidence — cash and collector are mutually
    // exclusive class assignments.)
    let expected_collector_payout: f64 = pmf
        .iter()
        .enumerate()
        .map(|(k, &p)| {
            if k < 2 {
                0.0
            } else {
                let kk = (k as f64) * ((k - 1) as f64);
                p * kk * p_col * p_c * mu_col * mu_v
            }
        })
        .sum::<f64>()
        * g_mult;

    let grid_full_probability = occ_result.grid_full_probability;
    let expected_grid_full_payout = occ_cfg.grid_full_award * grid_full_probability * g_mult;

    let expected_payout =
        expected_cash_mult_payout + expected_collector_payout + expected_grid_full_payout;

    PersistentGridHwResult {
        expected_payout,
        expected_cash_cells,
        expected_mult_cells,
        expected_collector_cells,
        expected_mult_product,
        expected_cash_mult_payout,
        expected_collector_payout,
        expected_grid_full_payout,
        grid_full_probability,
        expected_orb_count: e_k,
        terminal_occupancy_pmf: pmf,
    }
}

// ─── Terminal occupancy PMF reconstruction ────────────────────────────────────
//
// The standard solver does compute this implicitly (via `p_term_k`) but does
// not expose it through `HoldAndWinResult`. Re-derive locally using the same
// binomial-landing forward pass — kept in this module so the solver remains
// backward-compatible.

fn terminal_occupancy_pmf(cfg: &HoldAndWinConfig) -> Vec<f64> {
    let t = cfg.total_cells;
    let ir = cfg.initial_respins as usize;
    let init_k = cfg.init_locked_cells.min(t);

    let states = (t + 1) * (ir + 1);
    let mut prob = vec![0.0_f64; states];
    let idx = |k: usize, r: usize| k * (ir + 1) + r;
    prob[idx(init_k, ir)] = 1.0;

    let mut p_term_k = vec![0.0_f64; t + 1];

    if cfg.respin_reset_on_new {
        for k_iter in 0..=t {
            for r_iter in (0..=ir).rev() {
                let p_here = prob[idx(k_iter, r_iter)];
                if p_here < 1e-18 {
                    continue;
                }
                if r_iter == 0 || k_iter == t {
                    p_term_k[k_iter] += p_here;
                    continue;
                }
                let n = t - k_iter;
                let p_land = cfg.base_chance + (k_iter as f64 / t as f64) * cfg.fill_bonus_cap;
                let pmf_b = binom_pmf_local(n, p_land);
                prob[idx(k_iter, r_iter - 1)] += p_here * pmf_b[0];
                for j in 1..=n {
                    let new_k = k_iter + j;
                    if new_k <= t {
                        prob[idx(new_k, ir)] += p_here * pmf_b[j];
                    }
                }
            }
        }
    } else {
        for r_iter in (0..=ir).rev() {
            for k_iter in 0..=t {
                let p_here = prob[idx(k_iter, r_iter)];
                if p_here < 1e-18 {
                    continue;
                }
                if r_iter == 0 || k_iter == t {
                    p_term_k[k_iter] += p_here;
                    continue;
                }
                let n = t - k_iter;
                let p_land = cfg.base_chance + (k_iter as f64 / t as f64) * cfg.fill_bonus_cap;
                let pmf_b = binom_pmf_local(n, p_land);
                prob[idx(k_iter, r_iter - 1)] += p_here * pmf_b[0];
                for j in 1..=n {
                    let new_k = k_iter + j;
                    if new_k <= t {
                        prob[idx(new_k, r_iter - 1)] += p_here * pmf_b[j];
                    }
                }
            }
        }
    }

    // Normalise (defensive against floating-point error).
    let sum: f64 = p_term_k.iter().sum();
    if sum > 0.0 && (sum - 1.0).abs() > 1e-12 {
        for v in &mut p_term_k {
            *v /= sum;
        }
    }
    p_term_k
}

// Local copy of binom helpers — keeps this module decoupled from `markov::*`
// private fns.
fn binom_pmf_local(n: usize, p: f64) -> Vec<f64> {
    let mut pmf: Vec<f64> = (0..=n).map(|j| binom_prob_local(n, j, p)).collect();
    let sum: f64 = pmf.iter().sum();
    if sum > 0.0 && (sum - 1.0).abs() > 1e-12 {
        for v in &mut pmf {
            *v /= sum;
        }
    }
    pmf
}

fn binom_prob_local(n: usize, j: usize, p: f64) -> f64 {
    if j > n {
        return 0.0;
    }
    if p <= 0.0 {
        return if j == 0 { 1.0 } else { 0.0 };
    }
    if p >= 1.0 {
        return if j == n { 1.0 } else { 0.0 };
    }
    let k = j.min(n - j);
    let mut binom = 1.0_f64;
    for i in 0..k {
        binom *= (n - i) as f64;
        binom /= (i + 1) as f64;
    }
    binom * p.powi(j as i32) * (1.0 - p).powi((n - j) as i32)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64, tol: f64) -> bool {
        (a - b).abs() < tol
    }

    #[test]
    fn class_dist_normalises() {
        let d = CellClassDistribution {
            p_cash: 3.0,
            mu_cash: 1.0,
            p_mult: 1.0,
            mu_mult: 1.0,
            p_collector: 0.0,
            mu_collector: 0.0,
            p_inert: 0.0,
        };
        let (a, b, c, e) = d.normalised();
        assert!(approx(a, 0.75, 1e-12));
        assert!(approx(b, 0.25, 1e-12));
        assert!(approx(c, 0.0, 1e-12));
        assert!(approx(e, 0.0, 1e-12));
    }

    #[test]
    fn class_dist_degenerate_zero_falls_back_to_cash() {
        let d = CellClassDistribution {
            p_cash: 0.0,
            mu_cash: 0.0,
            p_mult: 0.0,
            mu_mult: 0.0,
            p_collector: 0.0,
            mu_collector: 0.0,
            p_inert: 0.0,
        };
        let (a, b, c, e) = d.normalised();
        assert_eq!(a, 1.0);
        assert_eq!(b, 0.0);
        assert_eq!(c, 0.0);
        assert_eq!(e, 0.0);
    }

    #[test]
    fn pure_cash_matches_standard_solver_payout() {
        // With 100 % cash class and μ_cash = expected_cell_value, the persistent
        // solver must reproduce the same E[payout] as the standard H&W solver.
        let occ = HoldAndWinConfig {
            total_cells: 12,
            initial_respins: 3,
            base_chance: 0.06,
            fill_bonus_cap: 0.02,
            expected_cell_value: 2.0,
            respin_reset_on_new: true,
            grid_full_award: 0.0,
            init_locked_cells: 4,
        };
        let std_res = solve_hold_and_win(&occ);

        let cfg = PersistentGridHwConfig {
            occupancy: occ,
            classes: CellClassDistribution {
                p_cash: 1.0,
                mu_cash: 2.0,
                p_mult: 0.0,
                mu_mult: 1.0,
                p_collector: 0.0,
                mu_collector: 0.0,
                p_inert: 0.0,
            },
            terminal_global_multiplier: 1.0,
        };
        let pers = solve_persistent_grid_hw(&cfg);

        // E[payout] from std == μ_v × E[orb] (since std uses single average cell value).
        let from_std = std_res.expected_orb_count * 2.0;
        assert!(
            approx(pers.expected_payout, from_std, 1e-9),
            "pers={} std={}",
            pers.expected_payout,
            from_std
        );
    }

    #[test]
    fn multiplier_class_amplifies_payout() {
        let occ = HoldAndWinConfig {
            total_cells: 10,
            initial_respins: 3,
            base_chance: 0.08,
            fill_bonus_cap: 0.03,
            expected_cell_value: 1.0,
            respin_reset_on_new: true,
            grid_full_award: 0.0,
            init_locked_cells: 4,
        };

        let no_mult = PersistentGridHwConfig {
            occupancy: occ.clone(),
            classes: CellClassDistribution {
                p_cash: 1.0,
                mu_cash: 1.0,
                p_mult: 0.0,
                mu_mult: 1.0,
                p_collector: 0.0,
                mu_collector: 0.0,
                p_inert: 0.0,
            },
            terminal_global_multiplier: 1.0,
        };
        let with_mult = PersistentGridHwConfig {
            occupancy: occ,
            classes: CellClassDistribution {
                p_cash: 0.7,
                mu_cash: 1.0,
                p_mult: 0.3,
                mu_mult: 3.0, // big mults
                p_collector: 0.0,
                mu_collector: 0.0,
                p_inert: 0.0,
            },
            terminal_global_multiplier: 1.0,
        };

        let a = solve_persistent_grid_hw(&no_mult);
        let b = solve_persistent_grid_hw(&with_mult);
        assert!(
            b.expected_payout > a.expected_payout,
            "with-mult ({}) should exceed no-mult ({})",
            b.expected_payout,
            a.expected_payout
        );
    }

    #[test]
    fn collector_class_amplifies_payout_quadratic_in_k() {
        // With collector mass + cash, payout includes the bilinear k(k−1) term.
        let occ = HoldAndWinConfig {
            total_cells: 12,
            initial_respins: 5,
            base_chance: 0.12,
            fill_bonus_cap: 0.04,
            expected_cell_value: 1.0,
            respin_reset_on_new: true,
            grid_full_award: 0.0,
            init_locked_cells: 5,
        };

        let no_col = PersistentGridHwConfig {
            occupancy: occ.clone(),
            classes: CellClassDistribution {
                p_cash: 1.0,
                mu_cash: 1.0,
                p_mult: 0.0,
                mu_mult: 1.0,
                p_collector: 0.0,
                mu_collector: 0.0,
                p_inert: 0.0,
            },
            terminal_global_multiplier: 1.0,
        };
        let with_col = PersistentGridHwConfig {
            occupancy: occ,
            classes: CellClassDistribution {
                p_cash: 0.8,
                mu_cash: 1.0,
                p_mult: 0.0,
                mu_mult: 1.0,
                p_collector: 0.2,
                mu_collector: 2.0,
                p_inert: 0.0,
            },
            terminal_global_multiplier: 1.0,
        };

        let a = solve_persistent_grid_hw(&no_col);
        let b = solve_persistent_grid_hw(&with_col);
        assert!(b.expected_collector_payout > 0.0);
        assert!(
            b.expected_payout > a.expected_payout,
            "with-collector ({}) should exceed no-collector ({})",
            b.expected_payout,
            a.expected_payout
        );
    }

    #[test]
    fn terminal_pmf_sums_to_one() {
        let cfg = PersistentGridHwConfig::default();
        let res = solve_persistent_grid_hw(&cfg);
        let sum: f64 = res.terminal_occupancy_pmf.iter().sum();
        assert!(
            approx(sum, 1.0, 1e-9),
            "terminal occupancy PMF should sum to 1, got {sum}"
        );
    }

    #[test]
    fn terminal_global_multiplier_scales_payout_linearly() {
        let occ = HoldAndWinConfig {
            total_cells: 8,
            initial_respins: 3,
            base_chance: 0.1,
            fill_bonus_cap: 0.05,
            expected_cell_value: 1.0,
            respin_reset_on_new: true,
            grid_full_award: 0.0,
            init_locked_cells: 3,
        };
        let base = PersistentGridHwConfig {
            occupancy: occ,
            classes: CellClassDistribution {
                p_cash: 0.6,
                mu_cash: 1.0,
                p_mult: 0.2,
                mu_mult: 2.0,
                p_collector: 0.2,
                mu_collector: 2.0,
                p_inert: 0.0,
            },
            terminal_global_multiplier: 1.0,
        };
        let r1 = solve_persistent_grid_hw(&base);
        let r5 = solve_persistent_grid_hw(&PersistentGridHwConfig {
            terminal_global_multiplier: 5.0,
            ..base
        });
        assert!(
            approx(r5.expected_payout, r1.expected_payout * 5.0, 1e-9),
            "5× terminal mult should 5× payout: r1={} r5={}",
            r1.expected_payout,
            r5.expected_payout
        );
    }

    #[test]
    fn empty_grid_zero_respins_pays_only_grid_full() {
        let cfg = PersistentGridHwConfig {
            occupancy: HoldAndWinConfig {
                total_cells: 5,
                initial_respins: 0,
                base_chance: 0.1,
                fill_bonus_cap: 0.0,
                expected_cell_value: 1.0,
                respin_reset_on_new: false,
                grid_full_award: 10.0,
                init_locked_cells: 0,
            },
            classes: CellClassDistribution {
                p_cash: 1.0,
                mu_cash: 1.0,
                p_mult: 0.0,
                mu_mult: 1.0,
                p_collector: 0.0,
                mu_collector: 0.0,
                p_inert: 0.0,
            },
            terminal_global_multiplier: 1.0,
        };
        let res = solve_persistent_grid_hw(&cfg);
        // 0 cells locked, 0 respins, never fills → payout = 0.
        assert!(approx(res.expected_payout, 0.0, 1e-9));
        assert!(approx(res.grid_full_probability, 0.0, 1e-12));
    }

    #[test]
    fn grid_full_award_propagates_through_global_multiplier() {
        let cfg = PersistentGridHwConfig {
            occupancy: HoldAndWinConfig {
                total_cells: 3,
                initial_respins: 4,
                base_chance: 0.5,
                fill_bonus_cap: 0.0,
                expected_cell_value: 1.0,
                respin_reset_on_new: true,
                grid_full_award: 100.0,
                init_locked_cells: 2,
            },
            classes: CellClassDistribution {
                p_cash: 1.0,
                mu_cash: 1.0,
                p_mult: 0.0,
                mu_mult: 1.0,
                p_collector: 0.0,
                mu_collector: 0.0,
                p_inert: 0.0,
            },
            terminal_global_multiplier: 2.0,
        };
        let res = solve_persistent_grid_hw(&cfg);
        // Grid-full contribution = 100 × P_full × g_mult = 200 × P_full.
        let expected_full = 100.0 * res.grid_full_probability * 2.0;
        assert!(
            approx(res.expected_grid_full_payout, expected_full, 1e-9),
            "grid_full_payout={} expected={}",
            res.expected_grid_full_payout,
            expected_full
        );
    }

    #[test]
    fn config_round_trips_through_json() {
        let cfg = PersistentGridHwConfig::default();
        let s = serde_json::to_string(&cfg).expect("ser ok");
        let back: PersistentGridHwConfig = serde_json::from_str(&s).expect("de ok");
        assert_eq!(cfg, back);
    }

    #[test]
    fn pmf_matches_normalised_distribution() {
        // The terminal PMF should reproduce E[k] = sum_i i × P(k=i).
        let cfg = PersistentGridHwConfig::default();
        let res = solve_persistent_grid_hw(&cfg);
        let e_k_from_pmf: f64 = res
            .terminal_occupancy_pmf
            .iter()
            .enumerate()
            .map(|(i, &p)| (i as f64) * p)
            .sum();
        assert!(
            approx(e_k_from_pmf, res.expected_orb_count, 1e-9),
            "E[k] from PMF ({e_k_from_pmf}) should equal expected_orb_count ({})",
            res.expected_orb_count
        );
    }
}
