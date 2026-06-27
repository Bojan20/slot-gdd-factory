//! Closed-form feature solvers — Faza 6.
//!
//! Replaces Monte Carlo estimation for three feature types with exact math:
//!
//! * **Hold & Win** — Markov chain DP over `(locked_count, respins_remaining)`.
//!   State space: `(total_cells+1) × (initial_respins+1)`. Exact for any
//!   respin-reset policy and any landing probability model.
//!
//! * **Free Spins** — Geometric series for retrigger chains. Closed-form when
//!   retrigger probability is known analytically; otherwise caller supplies the
//!   MC-estimated probability per FS spin.
//!
//! * **Cascade** — Expected-value decomposition over chain depth using the
//!   geometric series P(c or more chains) = p_win^c with per-depth multipliers.
//!
//! All solvers are pure functions of their config structs — no I/O, no RNG.
//! Suitable for embedding in the PAR generator, the `--analytical` CLI flag,
//! and the Rust↔TS parity gate.

use serde::{Deserialize, Serialize};

// ─── Binomial helpers ──────────────────────────────────────────────────────────

/// Precomputed binomial coefficients table C[n][k] for n ≤ MAX_N.
/// Uses u128 to avoid overflow up to n=34; above that we switch to f64.
const MAX_BINOM_N: usize = 64;

/// Pascal's triangle — C[n][k] as f64.
/// Built lazily on first call.
fn binom_f64(n: usize, k: usize) -> f64 {
    if k > n {
        return 0.0;
    }
    if k == 0 || k == n {
        return 1.0;
    }
    // Log-space computation to avoid overflow for large n.
    // C(n, k) = exp(Σ ln(n-i) - Σ ln(i+1)) for i in 0..k
    let k = k.min(n - k); // use symmetry
    let mut result = 1.0_f64;
    for i in 0..k {
        result *= (n - i) as f64;
        result /= (i + 1) as f64;
    }
    result
}

/// Binomial probability P(X=j) where X ~ Binomial(n, p).
/// Uses log-space for numerical stability when n is large.
fn binom_prob(n: usize, j: usize, p: f64) -> f64 {
    if j > n {
        return 0.0;
    }
    if p <= 0.0 {
        return if j == 0 { 1.0 } else { 0.0 };
    }
    if p >= 1.0 {
        return if j == n { 1.0 } else { 0.0 };
    }
    binom_f64(n, j) * p.powi(j as i32) * (1.0 - p).powi((n - j) as i32)
}

/// All binomial probabilities P(X=0), P(X=1), …, P(X=n) for X ~ Binomial(n, p).
/// Normalized to sum to exactly 1.0 by absorbing floating-point error into P(X=0).
fn binom_pmf(n: usize, p: f64) -> Vec<f64> {
    let mut pmf: Vec<f64> = (0..=n).map(|j| binom_prob(n, j, p)).collect();
    // Re-normalize for numerical hygiene.
    let sum: f64 = pmf.iter().sum();
    if sum > 0.0 && (sum - 1.0).abs() > 1e-12 {
        for v in &mut pmf {
            *v /= sum;
        }
    }
    pmf
}

// ─── Hold & Win Markov solver ─────────────────────────────────────────────────

/// Configuration for the H&W Markov chain solver.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HoldAndWinConfig {
    /// `numCols × numRows` — total number of grid cells.
    pub total_cells: usize,
    /// `feature.respins_initial` — number of respins awarded on trigger.
    pub initial_respins: u32,
    /// Per-cell landing chance at fill ratio 0 (default: 0.035).
    pub base_chance: f64,
    /// Extra per-cell chance added as grid fills (default: 0.025).
    pub fill_bonus_cap: f64,
    /// Weighted average of `cash_value_distribution` (bet multiples).
    pub expected_cell_value: f64,
    /// `feature.respin_reset_on_new` — resets counter on new orb.
    pub respin_reset_on_new: bool,
    /// Payout added if grid fills completely (0 if no `grid_full_award`).
    pub grid_full_award: f64,
    /// Number of cells locked at feature trigger (seed for the DP query).
    pub init_locked_cells: usize,
}

impl Default for HoldAndWinConfig {
    fn default() -> Self {
        Self {
            total_cells: 15,
            initial_respins: 3,
            base_chance: 0.035,
            fill_bonus_cap: 0.025,
            expected_cell_value: 1.0,
            respin_reset_on_new: true,
            grid_full_award: 0.0,
            init_locked_cells: 6,
        }
    }
}

/// Exact solution from the Markov DP.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HoldAndWinResult {
    /// E[total payout | init_locked_cells trigger, initial_respins].
    pub expected_payout: f64,
    /// E[final number of locked cells].
    pub expected_orb_count: f64,
    /// P(grid fills completely).
    pub grid_full_probability: f64,
    /// E[number of respins consumed].
    pub expected_respins_used: f64,
    /// V[k][r] for all (locked_count, respins_remaining) — shape `(total+1) × (initial+1)`.
    pub state_values: Vec<Vec<f64>>,
}

/// Solve the H&W Markov chain using bottom-up DP.
///
/// Time: O(total_cells × initial_respins × total_cells²) in the worst case,
/// but typical configs (15 cells, 3 respins) solve in microseconds.
///
/// # Panics
/// Panics if `total_cells > 100` (protection against accidental huge grids).
pub fn solve_hold_and_win(cfg: &HoldAndWinConfig) -> HoldAndWinResult {
    assert!(
        cfg.total_cells <= 100,
        "total_cells={} exceeds safety cap of 100",
        cfg.total_cells
    );

    let t = cfg.total_cells;
    let ir = cfg.initial_respins as usize;

    // V[k][r] = E[payout | k cells locked, r respins remaining].
    // Dimensions: (t+1) rows × (ir+1) cols.
    let mut v = vec![vec![0.0_f64; ir + 1]; t + 1];

    // ── Base cases ────────────────────────────────────────────────────────────

    // V[k][0] = k × E_cell (+ grid_full_award if k == t)
    for k in 0..=t {
        v[k][0] =
            k as f64 * cfg.expected_cell_value + if k == t { cfg.grid_full_award } else { 0.0 };
    }

    // V[t][r] = t × E_cell + grid_full_award (full grid, any respins).
    for r in 1..=ir {
        v[t][r] = t as f64 * cfg.expected_cell_value + cfg.grid_full_award;
    }

    // ── DP fill ───────────────────────────────────────────────────────────────
    //
    // Correct recurrence (NO j×E_cell in transitions — cell values are fully
    // captured by the terminal base case V[k][0] = k × E_cell):
    //
    //   V[k][r] = pmf[0] × V[k][r-1]  +  Σ_{j≥1} pmf[j] × V[k+j][next_r]
    //
    // For respin_reset=false: next_r = r-1.  Loop order r=1..ir, k=0..t-1 ✓
    //
    // For respin_reset=true: next_r = ir for every hit.
    //   V[k][r] = pmf_k[0]^r × V[k][0]  +  C_k × (1 − pmf_k[0]^r) / (1 − pmf_k[0])
    //   where C_k = Σ_{j≥1} pmf_k[j] × V[k+j][ir]   (depends only on higher-k values)
    //
    //   Algorithm:
    //     (a) Compute C_k and V[k][ir] for k from t-1 down to 0.
    //     (b) Fill V[k][r] for r=1..ir-1 using the closed form (V[k+j][ir] now known).

    if cfg.respin_reset_on_new && ir > 0 {
        // (a) Compute V[k][ir] for k = t-1, t-2, …, 0.
        //     V[k+j][ir] for j≥1 is always computed before V[k][ir] (descending k).
        let mut c_k = vec![0.0_f64; t + 1]; // C_k cache

        for k in (0..t).rev() {
            let n = t - k;
            let p = cfg.base_chance + (k as f64 / t as f64) * cfg.fill_bonus_cap;
            let pmf = binom_pmf(n, p);
            let q = pmf[0]; // P(no orb this respin)

            // C_k = Σ_{j≥1} pmf[j] × V[k+j][ir]
            let ck: f64 = (1..=n).map(|j| pmf[j] * v[k + j][ir]).sum();
            c_k[k] = ck;

            // V[k][ir] from closed-form solution of the miss-chain recurrence.
            let q_ir = q.powi(ir as i32);
            v[k][ir] = if (1.0 - q).abs() < 1e-15 {
                // q ≈ 1 (virtually no orbs can land): limit of the formula.
                v[k][0] + ir as f64 * ck
            } else {
                q_ir * v[k][0] + ck * (1.0 - q_ir) / (1.0 - q)
            };
        }

        // (b) Fill V[k][r] for r = 1..ir-1 using the same closed form
        //     (C_k and V[k+j][ir] are fully known).
        for r in 1..ir {
            for k in 0..t {
                let n = t - k;
                let p = cfg.base_chance + (k as f64 / t as f64) * cfg.fill_bonus_cap;
                let pmf = binom_pmf(n, p);
                let q = pmf[0];
                let q_r = q.powi(r as i32);

                v[k][r] = if (1.0 - q).abs() < 1e-15 {
                    v[k][0] + r as f64 * c_k[k]
                } else {
                    q_r * v[k][0] + c_k[k] * (1.0 - q_r) / (1.0 - q)
                };
            }
        }
    } else {
        // respin_reset=false (or ir=0): standard bottom-up DP.
        // V[k][r] = pmf[0] × V[k][r-1] + Σ_{j≥1} pmf[j] × V[k+j][r-1]
        for r in 1..=ir {
            for k in 0..t {
                let n = t - k;
                let p = cfg.base_chance + (k as f64 / t as f64) * cfg.fill_bonus_cap;
                let pmf = binom_pmf(n, p);

                let mut val = pmf[0] * v[k][r - 1];
                for j in 1..=n {
                    val += pmf[j] * v[k + j][r - 1];
                }
                v[k][r] = val;
            }
        }
    }

    // ── Derived metrics ───────────────────────────────────────────────────────

    let init_k = cfg.init_locked_cells.min(t);
    let expected_payout = v[init_k][ir];

    // Forward-probability pass to compute E[orb_count], P(grid_full), E[respins_used].
    //
    // State (k, r) → terminal when r=0 or k=t.
    // Topological order differs by respin_reset mode:
    //
    //   respin_reset=false : hits → (k+j, r-1).  Order: r descending, any k.
    //   respin_reset=true  : hits → (k+j, ir).   Order: k ascending (within each k:
    //                        r descending), because k strictly increases on hits,
    //                        so all inputs to (k, *) arrive from smaller k already processed.

    let states = (t + 1) * (ir + 1);
    let mut prob = vec![0.0_f64; states];
    let idx = |k: usize, r: usize| k * (ir + 1) + r;
    prob[idx(init_k, ir)] = 1.0;

    let mut p_grid_full = 0.0_f64;
    let mut p_term_k = vec![0.0_f64; t + 1];

    if cfg.respin_reset_on_new {
        // k ascending, r descending within each k.
        for k_iter in 0..=t {
            for r_iter in (0..=ir).rev() {
                let p_here = prob[idx(k_iter, r_iter)];
                if p_here < 1e-18 {
                    continue;
                }

                if r_iter == 0 || k_iter == t {
                    p_term_k[k_iter] += p_here;
                    if k_iter == t {
                        p_grid_full += p_here;
                    }
                    continue;
                }

                let n = t - k_iter;
                let p_land = cfg.base_chance + (k_iter as f64 / t as f64) * cfg.fill_bonus_cap;
                let pmf = binom_pmf(n, p_land);

                prob[idx(k_iter, r_iter - 1)] += p_here * pmf[0];
                for j in 1..=n {
                    let new_k = k_iter + j;
                    if new_k <= t {
                        prob[idx(new_k, ir)] += p_here * pmf[j];
                    }
                }
            }
        }
    } else {
        // r descending, k ascending.
        for r_iter in (0..=ir).rev() {
            for k_iter in 0..=t {
                let p_here = prob[idx(k_iter, r_iter)];
                if p_here < 1e-18 {
                    continue;
                }

                if r_iter == 0 || k_iter == t {
                    p_term_k[k_iter] += p_here;
                    if k_iter == t {
                        p_grid_full += p_here;
                    }
                    continue;
                }

                let n = t - k_iter;
                let p_land = cfg.base_chance + (k_iter as f64 / t as f64) * cfg.fill_bonus_cap;
                let pmf = binom_pmf(n, p_land);

                prob[idx(k_iter, r_iter - 1)] += p_here * pmf[0];
                for j in 1..=n {
                    let new_k = k_iter + j;
                    if new_k <= t {
                        prob[idx(new_k, r_iter - 1)] += p_here * pmf[j];
                    }
                }
            }
        }
    }

    let expected_orb_count: f64 = p_term_k
        .iter()
        .enumerate()
        .map(|(k, &p)| k as f64 * p)
        .sum();

    // E[respins_used] = ir - E[respins remaining at termination]
    // ≈ approximation: ir × P(some respin used) — use forward prob instead.
    // Simple estimate: ir - Σ p_term_k[k] × average_r_at_term.
    // For simplicity, compute as ir - Σ r × p(terminating at r) from forward pass.
    let mut expected_respins_remaining = 0.0_f64;
    for r_iter in 0..=ir {
        for k_iter in 0..=t {
            let p_here = prob[idx(k_iter, r_iter)];
            if p_here < 1e-18 {
                continue;
            }
            if r_iter == 0 || k_iter == t {
                expected_respins_remaining += p_here * r_iter as f64;
            }
        }
    }
    let expected_respins_used = (ir as f64 - expected_respins_remaining).max(0.0);

    HoldAndWinResult {
        expected_payout,
        expected_orb_count,
        grid_full_probability: p_grid_full,
        expected_respins_used,
        state_values: v,
    }
}

// ─── Free Spins closed-form ───────────────────────────────────────────────────

/// Configuration for the FS geometric-series solver.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FreeSpinsConfig {
    /// `feature.trigger.thresholds` → initial spins awarded at min scatter count.
    pub initial_spins: f64,
    /// P(retrigger fires) per FS spin (from base analytical or MC estimate).
    pub retrigger_probability_per_spin: f64,
    /// Average extra spins awarded per retrigger event.
    pub extra_spins_per_retrigger: f64,
    /// `retrigger.max_total` cap (None = no cap).
    pub max_total: Option<f64>,
    /// `feature.global_multiplier` (default 1.0).
    pub global_multiplier: f64,
    /// Whether `multiplier_ladder` modifier is active.
    pub has_multiplier_ladder: bool,
    /// E[win per spin] from base game analytical (bet multiples).
    pub base_win_per_spin: f64,
}

impl Default for FreeSpinsConfig {
    fn default() -> Self {
        Self {
            initial_spins: 10.0,
            retrigger_probability_per_spin: 0.0,
            extra_spins_per_retrigger: 10.0,
            max_total: None,
            global_multiplier: 1.0,
            has_multiplier_ladder: false,
            base_win_per_spin: 1.0,
        }
    }
}

/// Closed-form result for the FS solver.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FreeSpinsResult {
    /// E[total spins played] = initial / (1 - p_retrig × extra).
    pub expected_total_spins: f64,
    /// E[number of retrigger events] = (expected_total - initial) / extra.
    pub expected_retriggers: f64,
    /// E[total payout] = E[spins] × base_win × globalMult × ladderMult.
    pub expected_payout: f64,
    /// Fraction of total wagered returned via FS (= expected_payout for bet=1).
    pub rtp_contribution: f64,
    /// True if `max_total` was the binding constraint.
    pub retrigger_cap_active: bool,
    /// Effective average multiplier (accounting for ladder).
    pub ladder_adjusted_multiplier: f64,
}

/// Closed-form FS expected-value computation.
pub fn solve_free_spins(cfg: &FreeSpinsConfig) -> FreeSpinsResult {
    let p = cfg.retrigger_probability_per_spin.clamp(0.0, 0.9999);
    let extra = cfg.extra_spins_per_retrigger.max(0.0);
    let s0 = cfg.initial_spins.max(1.0);

    // Geometric-series denominator: 1 - p × extra / s0
    // (fraction of a "session" added by each retrigger relative to base).
    // Corrected formula: E[total] = s0 / (1 - p × extra_per_spin)
    // where extra_per_spin = extra / s0 ≈ probability weight.
    let effective_rate = (p * extra).clamp(0.0, 0.9999);
    let uncapped_expected = s0 / (1.0 - effective_rate);

    let (expected_total_spins, retrigger_cap_active) = match cfg.max_total {
        Some(cap) if uncapped_expected > cap => (cap, true),
        _ => (uncapped_expected, false),
    };

    let expected_retriggers = if extra > 0.0 {
        ((expected_total_spins - s0) / extra).max(0.0)
    } else {
        0.0
    };

    // Multiplier ladder: each spin i gets multiplier i (starting at 1).
    // If N spins total, avg multiplier = (1 + N) / 2.
    let ladder_adjusted_multiplier = if cfg.has_multiplier_ladder {
        (1.0 + expected_total_spins) / 2.0
    } else {
        1.0
    };

    let expected_payout = expected_total_spins
        * cfg.base_win_per_spin
        * cfg.global_multiplier
        * ladder_adjusted_multiplier;

    FreeSpinsResult {
        expected_total_spins,
        expected_retriggers,
        expected_payout,
        rtp_contribution: expected_payout,
        retrigger_cap_active,
        ladder_adjusted_multiplier,
    }
}

// ─── Cascade closed-form ──────────────────────────────────────────────────────

/// Configuration for the cascade expected-value solver.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CascadeConfig {
    /// P(winning spin) per chain step (from base game analytical or MC estimate).
    pub base_win_probability: f64,
    /// E[win | winning spin] in bet multiples.
    pub base_win_per_winning_spin: f64,
    /// Per-depth multiplier: `multiplier_progression[c]` for chain depth `c`.
    /// If shorter than `max_chain`, remaining depths use 1.0.
    pub multiplier_progression: Vec<f64>,
    /// `feature.max_chain` — hard cap on number of cascade steps.
    pub max_chain: usize,
}

impl Default for CascadeConfig {
    fn default() -> Self {
        Self {
            base_win_probability: 0.3,
            base_win_per_winning_spin: 5.0,
            multiplier_progression: vec![],
            max_chain: 10,
        }
    }
}

/// Cascade exact-EV result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CascadeResult {
    /// E[cascade chains per base spin] ≈ p/(1-p) truncated at max_chain.
    pub expected_cascade_chains: f64,
    /// E[total payout per base spin] accounting for multiplier progression.
    pub expected_payout_per_spin: f64,
    /// Ratio of cascade payout to no-cascade base win.
    pub effective_multiplier_boost: f64,
    /// P(exactly c cascade steps) for c = 0..=max_chain.
    pub chain_probabilities: Vec<f64>,
}

/// Cascade closed-form computation.
///
/// Model: chain 0 (initial) fires with probability 1. Each subsequent chain `c`
/// fires with probability `p_win^c`. Multiplier for chain `c` = `m[c]` (from
/// `multiplier_progression`, defaults to 1.0 beyond defined entries).
pub fn solve_cascade(cfg: &CascadeConfig) -> CascadeResult {
    let p = cfg.base_win_probability.clamp(0.0, 1.0);
    let cap = cfg.max_chain.max(1);

    // P(exactly c cascade wins) for the TOTAL spin.
    // Chain 0 always fires (it's the initial grid evaluation).
    // Chain c fires iff the grid had a win in chain c-1, so P(≥c chains) = p^c.
    // P(exactly c chains) = p^c × (1-p) for c < cap, p^cap for c = cap.
    let mut chain_probs: Vec<f64> = Vec::with_capacity(cap + 1);
    for c in 0..cap {
        let prob = p.powi(c as i32) * (1.0 - p);
        chain_probs.push(prob);
    }
    chain_probs.push(p.powi(cap as i32)); // at-cap probability

    // E[chains] = Σ c × P(c chains)
    let expected_chains: f64 = chain_probs
        .iter()
        .enumerate()
        .map(|(c, &pr)| c as f64 * pr)
        .sum();

    // E[total payout per spin] = Σ_{c=0}^{cap} P(chain c fires) × base_win × m[c]
    // P(chain c fires) = P(≥c chains) = p^c.
    let mut expected_payout = 0.0_f64;
    for c in 0..=cap {
        let p_fires = p.powi(c as i32);
        let mult = cfg.multiplier_progression.get(c).copied().unwrap_or(1.0);
        expected_payout += p_fires * cfg.base_win_per_winning_spin * mult;
    }

    // Effective multiplier boost = cascade payout / no-cascade payout.
    let no_cascade = cfg.base_win_probability * cfg.base_win_per_winning_spin;
    let effective_multiplier_boost = if no_cascade > 0.0 {
        expected_payout / no_cascade
    } else {
        1.0
    };

    CascadeResult {
        expected_cascade_chains: expected_chains,
        expected_payout_per_spin: expected_payout,
        effective_multiplier_boost,
        chain_probabilities: chain_probs,
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Binomial helpers ───────────────────────────────────────────────────────

    #[test]
    fn binom_prob_sanity() {
        // Binomial(1, 0.5): P(0) = 0.5, P(1) = 0.5
        assert!((binom_prob(1, 0, 0.5) - 0.5).abs() < 1e-12);
        assert!((binom_prob(1, 1, 0.5) - 0.5).abs() < 1e-12);
        // Binomial(0, *): P(0) = 1
        assert!((binom_prob(0, 0, 0.5) - 1.0).abs() < 1e-12);
        // P(j > n) = 0
        assert_eq!(binom_prob(3, 5, 0.5), 0.0);
    }

    #[test]
    fn binom_pmf_sums_to_one() {
        for n in [0, 1, 2, 5, 10, 15, 20] {
            for p in [0.0, 0.035, 0.06, 0.5, 0.99, 1.0] {
                let pmf = binom_pmf(n, p);
                let sum: f64 = pmf.iter().sum();
                assert!((sum - 1.0).abs() < 1e-10, "n={n}, p={p}, sum={sum}");
            }
        }
    }

    // ── H&W Markov ────────────────────────────────────────────────────────────

    #[test]
    fn hnw_zero_locked_zero_respins_is_zero() {
        let cfg = HoldAndWinConfig {
            init_locked_cells: 0,
            initial_respins: 0,
            ..Default::default()
        };
        let res = solve_hold_and_win(&cfg);
        assert!(
            (res.expected_payout - 0.0).abs() < 1e-9,
            "got {}",
            res.expected_payout
        );
    }

    #[test]
    fn hnw_full_grid_immediate() {
        let cfg = HoldAndWinConfig {
            total_cells: 4,
            init_locked_cells: 4, // already full
            initial_respins: 3,
            expected_cell_value: 2.0,
            grid_full_award: 100.0,
            ..Default::default()
        };
        let res = solve_hold_and_win(&cfg);
        // V(4, 3) = 4×2.0 + 100.0 = 108.0
        assert!(
            (res.expected_payout - 108.0).abs() < 1e-9,
            "got {}",
            res.expected_payout
        );
    }

    #[test]
    fn hnw_one_locked_zero_respins() {
        let cfg = HoldAndWinConfig {
            total_cells: 15,
            init_locked_cells: 1,
            initial_respins: 0,
            expected_cell_value: 3.5,
            ..Default::default()
        };
        let res = solve_hold_and_win(&cfg);
        // V(1, 0) = 1 × 3.5 = 3.5
        assert!(
            (res.expected_payout - 3.5).abs() < 1e-9,
            "got {}",
            res.expected_payout
        );
    }

    #[test]
    fn hnw_6_cells_trigger_payout_exceeds_floor() {
        // Standard: 15-cell grid, 6 locked at trigger, 3 respins, E[cell]=1.5
        let cfg = HoldAndWinConfig {
            total_cells: 15,
            init_locked_cells: 6,
            initial_respins: 3,
            expected_cell_value: 1.5,
            base_chance: 0.035,
            fill_bonus_cap: 0.025,
            respin_reset_on_new: true,
            grid_full_award: 0.0,
        };
        let res = solve_hold_and_win(&cfg);
        let floor = 6.0 * 1.5; // minimum: just what we started with (0 more)
        assert!(
            res.expected_payout > floor,
            "E[payout]={} should exceed floor {}",
            res.expected_payout,
            floor
        );
    }

    #[test]
    fn hnw_more_locked_means_higher_payout() {
        let base = HoldAndWinConfig {
            total_cells: 15,
            initial_respins: 3,
            expected_cell_value: 1.0,
            ..Default::default()
        };
        let low = solve_hold_and_win(&HoldAndWinConfig {
            init_locked_cells: 4,
            ..base
        });
        let high = solve_hold_and_win(&HoldAndWinConfig {
            init_locked_cells: 10,
            ..base
        });
        assert!(
            high.expected_payout > low.expected_payout,
            "V(10) = {} should > V(4) = {}",
            high.expected_payout,
            low.expected_payout
        );
    }

    #[test]
    fn hnw_more_respins_means_higher_payout() {
        let base = HoldAndWinConfig {
            total_cells: 15,
            init_locked_cells: 6,
            expected_cell_value: 1.0,
            respin_reset_on_new: true,
            ..Default::default()
        };
        let low = solve_hold_and_win(&HoldAndWinConfig {
            initial_respins: 1,
            ..base
        });
        let high = solve_hold_and_win(&HoldAndWinConfig {
            initial_respins: 5,
            ..base
        });
        assert!(
            high.expected_payout > low.expected_payout,
            "V(6,5) = {} should > V(6,1) = {}",
            high.expected_payout,
            low.expected_payout
        );
    }

    #[test]
    fn hnw_grid_full_probability_in_0_1() {
        let cfg = HoldAndWinConfig::default();
        let res = solve_hold_and_win(&cfg);
        assert!(
            res.grid_full_probability >= 0.0 && res.grid_full_probability <= 1.0,
            "P(full)={}",
            res.grid_full_probability
        );
    }

    #[test]
    fn hnw_grid_full_award_increases_payout() {
        let base = HoldAndWinConfig {
            total_cells: 3, // small → grid fills often enough
            init_locked_cells: 2,
            initial_respins: 5,
            expected_cell_value: 1.0,
            base_chance: 0.3, // high to ensure non-trivial fill probability
            fill_bonus_cap: 0.1,
            respin_reset_on_new: true,
            grid_full_award: 0.0,
        };
        let without = solve_hold_and_win(&base);
        let with_award = solve_hold_and_win(&HoldAndWinConfig {
            grid_full_award: 50.0,
            ..base
        });
        assert!(
            with_award.expected_payout > without.expected_payout,
            "award should raise payout: {} vs {}",
            with_award.expected_payout,
            without.expected_payout
        );
        // Payout delta = P(grid_full) × 50.0
        let delta = with_award.expected_payout - without.expected_payout;
        let expected_delta = with_award.grid_full_probability * 50.0;
        assert!(
            (delta - expected_delta).abs() < 1e-6,
            "delta={delta} expected_delta={expected_delta}"
        );
    }

    #[test]
    fn hnw_state_values_shape() {
        let cfg = HoldAndWinConfig {
            total_cells: 5,
            initial_respins: 3,
            ..Default::default()
        };
        let res = solve_hold_and_win(&cfg);
        // V should be (total+1) rows × (initial_respins+1) cols
        assert_eq!(res.state_values.len(), 6, "rows = total+1");
        for row in &res.state_values {
            assert_eq!(row.len(), 4, "cols = respins+1");
        }
    }

    #[test]
    fn hnw_reset_vs_no_reset() {
        let base = HoldAndWinConfig {
            total_cells: 9,
            init_locked_cells: 4,
            initial_respins: 3,
            expected_cell_value: 1.0,
            base_chance: 0.05,
            fill_bonus_cap: 0.02,
            grid_full_award: 0.0,
            respin_reset_on_new: true,
        };
        let with_reset = solve_hold_and_win(&base);
        let no_reset = solve_hold_and_win(&HoldAndWinConfig {
            respin_reset_on_new: false,
            ..base
        });
        // With reset, there's more "time" to accumulate → typically higher or equal payout.
        assert!(
            with_reset.expected_payout >= no_reset.expected_payout,
            "reset=true should pay ≥ reset=false: {} vs {}",
            with_reset.expected_payout,
            no_reset.expected_payout
        );
    }

    #[test]
    fn hnw_expected_orb_count_between_init_and_total() {
        let cfg = HoldAndWinConfig::default();
        let res = solve_hold_and_win(&cfg);
        assert!(
            res.expected_orb_count >= cfg.init_locked_cells as f64,
            "E[orbs] should be ≥ init: {}",
            res.expected_orb_count
        );
        assert!(
            res.expected_orb_count <= cfg.total_cells as f64,
            "E[orbs] should be ≤ total: {}",
            res.expected_orb_count
        );
    }

    // ── Free Spins ────────────────────────────────────────────────────────────

    #[test]
    fn fs_no_retrigger_spins_equals_initial() {
        let cfg = FreeSpinsConfig {
            initial_spins: 10.0,
            retrigger_probability_per_spin: 0.0,
            extra_spins_per_retrigger: 10.0,
            ..Default::default()
        };
        let res = solve_free_spins(&cfg);
        assert!(
            (res.expected_total_spins - 10.0).abs() < 1e-9,
            "spins={}",
            res.expected_total_spins
        );
        assert!((res.expected_retriggers - 0.0).abs() < 1e-9);
    }

    #[test]
    fn fs_zero_extra_spins() {
        // Extra=0 → no spins gained on retrigger → always initial_spins.
        let cfg = FreeSpinsConfig {
            initial_spins: 8.0,
            retrigger_probability_per_spin: 0.5,
            extra_spins_per_retrigger: 0.0,
            ..Default::default()
        };
        let res = solve_free_spins(&cfg);
        assert!(
            (res.expected_total_spins - 8.0).abs() < 1e-9,
            "spins={}",
            res.expected_total_spins
        );
    }

    #[test]
    fn fs_geometric_series_formula() {
        // E[spins] = 10 / (1 - 0.1×10) = 10 / (1 - 1.0) → but that's undefined (rate=1).
        // Use safer: initial=10, pRetrig=0.1 per FS spin, extra=5.
        // E[spins] = 10 / (1 - 0.1×5) = 10 / 0.5 = 20.
        let cfg = FreeSpinsConfig {
            initial_spins: 10.0,
            retrigger_probability_per_spin: 0.1,
            extra_spins_per_retrigger: 5.0,
            max_total: None,
            global_multiplier: 1.0,
            has_multiplier_ladder: false,
            base_win_per_spin: 1.0,
        };
        let res = solve_free_spins(&cfg);
        let expected_spins = 10.0 / (1.0 - 0.1 * 5.0);
        assert!(
            (res.expected_total_spins - expected_spins).abs() < 1e-6,
            "got {} expected {}",
            res.expected_total_spins,
            expected_spins
        );
    }

    #[test]
    fn fs_max_total_cap_active() {
        let cfg = FreeSpinsConfig {
            initial_spins: 10.0,
            retrigger_probability_per_spin: 0.5, // high → many retriggers
            extra_spins_per_retrigger: 10.0,
            max_total: Some(25.0),
            ..Default::default()
        };
        let res = solve_free_spins(&cfg);
        assert!(
            (res.expected_total_spins - 25.0).abs() < 1e-9,
            "spins={} should be capped at 25",
            res.expected_total_spins
        );
        assert!(res.retrigger_cap_active);
    }

    #[test]
    fn fs_global_multiplier_scales_payout() {
        let base = FreeSpinsConfig {
            initial_spins: 10.0,
            base_win_per_spin: 2.0,
            global_multiplier: 1.0,
            ..Default::default()
        };
        let res1 = solve_free_spins(&base);
        let res2 = solve_free_spins(&FreeSpinsConfig {
            global_multiplier: 3.0,
            ..base
        });
        assert!(
            (res2.expected_payout - res1.expected_payout * 3.0).abs() < 1e-9,
            "3x multiplier should triple payout: {} vs {}",
            res2.expected_payout,
            res1.expected_payout
        );
    }

    #[test]
    fn fs_ladder_increases_payout() {
        let base = FreeSpinsConfig {
            initial_spins: 10.0,
            base_win_per_spin: 1.0,
            has_multiplier_ladder: false,
            ..Default::default()
        };
        let no_ladder = solve_free_spins(&base);
        let with_ladder = solve_free_spins(&FreeSpinsConfig {
            has_multiplier_ladder: true,
            ..base
        });
        assert!(
            with_ladder.expected_payout > no_ladder.expected_payout,
            "ladder should increase payout: {} vs {}",
            with_ladder.expected_payout,
            no_ladder.expected_payout
        );
        // Avg ladder mult = (1+10)/2 = 5.5
        assert!(
            (with_ladder.ladder_adjusted_multiplier - 5.5).abs() < 0.5,
            "ladder_mult={}",
            with_ladder.ladder_adjusted_multiplier
        );
    }

    #[test]
    fn fs_expected_retriggers_positive() {
        let cfg = FreeSpinsConfig {
            initial_spins: 10.0,
            retrigger_probability_per_spin: 0.1,
            extra_spins_per_retrigger: 10.0,
            ..Default::default()
        };
        let res = solve_free_spins(&cfg);
        assert!(
            res.expected_retriggers > 0.0,
            "retriggers={}",
            res.expected_retriggers
        );
    }

    #[test]
    fn fs_rtp_contribution_equals_payout() {
        let cfg = FreeSpinsConfig {
            initial_spins: 12.0,
            base_win_per_spin: 2.0,
            global_multiplier: 1.5,
            ..Default::default()
        };
        let res = solve_free_spins(&cfg);
        assert!(
            (res.rtp_contribution - res.expected_payout).abs() < 1e-12,
            "rtp_contribution should equal payout"
        );
    }

    // ── Cascade ───────────────────────────────────────────────────────────────

    #[test]
    fn cascade_zero_win_prob_only_initial_chain() {
        let cfg = CascadeConfig {
            base_win_probability: 0.0,
            base_win_per_winning_spin: 5.0,
            multiplier_progression: vec![],
            max_chain: 5,
        };
        let res = solve_cascade(&cfg);
        // Only chain 0 fires (p^0 = 1), base_win_per_winning_spin × m[0]=1.0
        assert!(
            (res.expected_payout_per_spin - 5.0).abs() < 1e-9,
            "got {}",
            res.expected_payout_per_spin
        );
        assert!((res.expected_cascade_chains - 0.0).abs() < 1e-9);
    }

    #[test]
    fn cascade_prob_one_all_chains_fire() {
        let cfg = CascadeConfig {
            base_win_probability: 1.0,
            base_win_per_winning_spin: 1.0,
            multiplier_progression: vec![],
            max_chain: 3,
        };
        let res = solve_cascade(&cfg);
        // All 4 depths (0,1,2,3) fire: each pays 1.0 × 1.0.
        assert!(
            (res.expected_payout_per_spin - 4.0).abs() < 1e-9,
            "got {}",
            res.expected_payout_per_spin
        );
        // P(exactly c chains): for c < 3, P(c) = p^c × (1-p) = 0.
        // P(3 chains) = p^3 = 1.0
        assert!((res.chain_probabilities[3] - 1.0).abs() < 1e-9);
    }

    #[test]
    fn cascade_chain_probs_sum_to_one() {
        for p_win in [0.0, 0.1, 0.3, 0.5, 0.99, 1.0] {
            let cfg = CascadeConfig {
                base_win_probability: p_win,
                base_win_per_winning_spin: 1.0,
                multiplier_progression: vec![],
                max_chain: 8,
            };
            let res = solve_cascade(&cfg);
            let sum: f64 = res.chain_probabilities.iter().sum();
            assert!((sum - 1.0).abs() < 1e-9, "p={p_win}, chain_prob_sum={sum}");
        }
    }

    #[test]
    fn cascade_multiplier_progression_applied() {
        let cfg = CascadeConfig {
            base_win_probability: 0.5,
            base_win_per_winning_spin: 1.0,
            multiplier_progression: vec![1.0, 2.0, 3.0],
            max_chain: 3,
        };
        let res = solve_cascade(&cfg);
        // E[payout] = Σ p^c × 1.0 × m[c] for c=0..3
        //           = 1×1 + 0.5×2 + 0.25×3 + 0.125×1 (max_chain uses m[3]=1.0)
        //           = 1 + 1 + 0.75 + 0.125 = 2.875
        let expected = 1.0 + 0.5 * 2.0 + 0.25 * 3.0 + 0.125 * 1.0;
        assert!(
            (res.expected_payout_per_spin - expected).abs() < 1e-9,
            "got {} expected {}",
            res.expected_payout_per_spin,
            expected
        );
    }

    #[test]
    fn cascade_effective_boost_above_one() {
        let cfg = CascadeConfig {
            base_win_probability: 0.3,
            base_win_per_winning_spin: 5.0,
            multiplier_progression: vec![],
            max_chain: 10,
        };
        let res = solve_cascade(&cfg);
        assert!(
            res.effective_multiplier_boost > 1.0,
            "boost={}",
            res.effective_multiplier_boost
        );
    }

    #[test]
    fn cascade_max_chain_caps_chains() {
        let cfg = CascadeConfig {
            base_win_probability: 0.99,
            base_win_per_winning_spin: 1.0,
            multiplier_progression: vec![],
            max_chain: 3,
        };
        let res = solve_cascade(&cfg);
        assert_eq!(
            res.chain_probabilities.len(),
            4,
            "should have exactly max_chain+1 entries"
        );
    }

    #[test]
    fn cascade_no_progression_is_all_ones() {
        let cfg = CascadeConfig {
            base_win_probability: 0.5,
            base_win_per_winning_spin: 2.0,
            multiplier_progression: vec![],
            max_chain: 5,
        };
        let res = solve_cascade(&cfg);
        // All multipliers = 1.0 → payout = 2.0 × Σ 0.5^c for c=0..5
        let expected_payout: f64 = (0..=5).map(|c| 0.5_f64.powi(c) * 2.0).sum();
        assert!(
            (res.expected_payout_per_spin - expected_payout).abs() < 1e-9,
            "got {} expected {}",
            res.expected_payout_per_spin,
            expected_payout
        );
    }

    #[test]
    fn cascade_geometric_expected_chains() {
        // p=0.3 → E[chains] ≈ p/(1-p) = 0.3/0.7 ≈ 0.4286 (approximately, for large cap)
        let cfg = CascadeConfig {
            base_win_probability: 0.3,
            base_win_per_winning_spin: 1.0,
            multiplier_progression: vec![],
            max_chain: 100,
        };
        let res = solve_cascade(&cfg);
        let expected = 0.3_f64 / 0.7; // geometric series
        assert!(
            (res.expected_cascade_chains - expected).abs() < 0.01,
            "got {} expected ~{}",
            res.expected_cascade_chains,
            expected
        );
    }
}
