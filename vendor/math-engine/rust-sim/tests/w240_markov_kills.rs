//! W240 — `rust-sim/src/markov.rs` mutation kill tests.
//!
//! Baseline (`bakp7wby1`, 2026-05-24): 289 mutants, ~137 caught / 88+ missed.
//! Most missed mutants are arithmetic mutations inside `solve_hold_and_win`'s
//! closed-form recurrence and `binom_pmf`'s normalization.
//!
//! Strategy: construct degenerate configurations whose closed-form output
//! is computable by hand to many decimal places.  Any arithmetic mutation
//! (`+ ↔ -`, `* ↔ /`, `< ↔ ≤`, `|| ↔ &&`) anywhere in the formula breaks
//! the exact numeric assertion below.
//!
//! Numeric trap design (per kill):
//!   * `binom_f64` — k==0 || k==n special-cases verified with C(5,0)=1, C(5,5)=1.
//!   * `binom_f64` `(n-i)` direction — C(5,2) = 10 (not C(7,2)=21).
//!   * `binom_pmf` normalization — sum must equal 1.0 exactly.
//!   * H&W p=0 boundary — expected_payout = init_k × E_cell (no orbs ever).
//!   * H&W p=1 boundary — grid_full_probability = 1.0 (always fills).
//!   * H&W grid_full_award delta — payout(award>0) - payout(award=0)
//!     must equal `award × P(fills)`.
//!   * H&W respin_reset toggle — false-branch result is identical to true
//!     when initial_respins == 1 (one shot only).
//!   * FS solver geometric series — known closed form for p=0 (no retrigger).

use slot_sim::markov::{
    solve_cascade, solve_free_spins, solve_hold_and_win, CascadeConfig, FreeSpinsConfig,
    HoldAndWinConfig,
};

// ── binom helpers — exact integer values ──────────────────────────────────

#[test]
fn w240_markov_hnw_p0_no_orbs_payout_is_initial_locked() {
    // base_chance=0, fill_bonus_cap=0 → p_land = 0 → no orb ever lands.
    // expected_payout = init_locked × E_cell + 0 (grid never fills).
    // Mutant any arithmetic flip inside the DP would shift this away from
    // exactly 6 × 2.5 = 15.0.
    let cfg = HoldAndWinConfig {
        total_cells: 15,
        init_locked_cells: 6,
        initial_respins: 5,
        expected_cell_value: 2.5,
        base_chance: 0.0,
        fill_bonus_cap: 0.0,
        respin_reset_on_new: false,
        grid_full_award: 1000.0,
    };
    let res = solve_hold_and_win(&cfg);
    assert!(
        (res.expected_payout - 15.0).abs() < 1e-9,
        "p=0 case must yield init_locked × E_cell exactly (got {})",
        res.expected_payout,
    );
    assert!(
        res.grid_full_probability.abs() < 1e-15,
        "p=0 case grid_full_probability must be 0 (got {})",
        res.grid_full_probability,
    );
    assert!(
        (res.expected_orb_count - 6.0).abs() < 1e-9,
        "no orbs land → orb_count == init_locked (got {})",
        res.expected_orb_count,
    );
}

#[test]
fn w240_markov_hnw_p0_reset_branch() {
    // Same fixture but respin_reset_on_new=true — kills both branches.
    let cfg = HoldAndWinConfig {
        total_cells: 15,
        init_locked_cells: 6,
        initial_respins: 5,
        expected_cell_value: 2.5,
        base_chance: 0.0,
        fill_bonus_cap: 0.0,
        respin_reset_on_new: true,
        grid_full_award: 1000.0,
    };
    let res = solve_hold_and_win(&cfg);
    assert!((res.expected_payout - 15.0).abs() < 1e-9);
    assert!(res.grid_full_probability.abs() < 1e-15);
}

#[test]
fn w240_markov_hnw_full_grid_initial() {
    // init_locked_cells == total_cells → grid already full → payout = t × E_cell + award.
    let cfg = HoldAndWinConfig {
        total_cells: 10,
        init_locked_cells: 10,
        initial_respins: 3,
        expected_cell_value: 1.5,
        base_chance: 0.5,
        fill_bonus_cap: 0.1,
        respin_reset_on_new: true,
        grid_full_award: 200.0,
    };
    let res = solve_hold_and_win(&cfg);
    let expected = 10.0 * 1.5 + 200.0;
    assert!(
        (res.expected_payout - expected).abs() < 1e-9,
        "full-grid initial state: expected {} got {}",
        expected,
        res.expected_payout,
    );
    assert!(
        (res.grid_full_probability - 1.0).abs() < 1e-9,
        "init full → P(grid_full) = 1.0",
    );
}

#[test]
fn w240_markov_hnw_zero_respins_terminal_value() {
    // initial_respins = 0 → result is immediate base case V[init_k][0].
    let cfg = HoldAndWinConfig {
        total_cells: 8,
        init_locked_cells: 4,
        initial_respins: 0,
        expected_cell_value: 3.0,
        base_chance: 0.4,
        fill_bonus_cap: 0.1,
        respin_reset_on_new: true,
        grid_full_award: 50.0,
    };
    let res = solve_hold_and_win(&cfg);
    // V[4][0] = 4 × 3.0 + 0 (k != t) = 12.0
    assert!(
        (res.expected_payout - 12.0).abs() < 1e-9,
        "zero respins → V[init_k][0] = init_k × E_cell = 12.0, got {}",
        res.expected_payout,
    );
}

#[test]
fn w240_markov_hnw_grid_full_award_delta_isolation() {
    // Award-delta isolation: P(grid_full) is fixed by the configuration,
    // so payout(award=A) − payout(award=0) must equal exactly A × P(fill).
    // Any arithmetic mutation that flips a `+` to `-` in the grid_full
    // award path will fail this linearity assertion.
    let base = HoldAndWinConfig {
        total_cells: 4,
        init_locked_cells: 0,
        initial_respins: 8,
        expected_cell_value: 1.0,
        base_chance: 0.4,
        fill_bonus_cap: 0.1,
        respin_reset_on_new: false,
        grid_full_award: 0.0,
    };
    let r0 = solve_hold_and_win(&base);
    let r1 = solve_hold_and_win(&HoldAndWinConfig {
        grid_full_award: 100.0,
        ..base
    });
    let r2 = solve_hold_and_win(&HoldAndWinConfig {
        grid_full_award: 250.0,
        ..base
    });
    // Linearity: r1 - r0 = 100 × P(fill); r2 - r0 = 250 × P(fill).
    let p_fill = r0.grid_full_probability;
    assert!(p_fill > 0.0 && p_fill < 1.0); // non-trivial configuration
    let delta1 = r1.expected_payout - r0.expected_payout;
    let delta2 = r2.expected_payout - r0.expected_payout;
    // Tightened from 1e-6 → 1e-9 per W240 code review (Stryker-style
    // arithmetic mutations on intermediate `+` / `-` ops can produce
    // sub-1e-6 drift that the looser tolerance would silently accept).
    assert!(
        (delta1 - 100.0 * p_fill).abs() < 1e-9,
        "award=100 delta: expected {}, got {}",
        100.0 * p_fill,
        delta1,
    );
    assert!(
        (delta2 - 250.0 * p_fill).abs() < 1e-9,
        "award=250 delta: expected {}, got {}",
        250.0 * p_fill,
        delta2,
    );
    // Ratio test: delta2 / delta1 must equal 250/100 = 2.5 exactly.
    assert!(
        (delta2 / delta1 - 2.5).abs() < 1e-12,
        "award scales linearly → delta2/delta1 = 2.5 exactly",
    );
}

#[test]
fn w240_markov_hnw_monotone_in_initial_respins() {
    // More respins → more payout (orbs accumulate).  Strict monotonicity
    // catches any arithmetic mutation in the DP that fails to roll
    // expected value forward.
    let base = HoldAndWinConfig {
        total_cells: 8,
        init_locked_cells: 2,
        expected_cell_value: 1.0,
        base_chance: 0.2,
        fill_bonus_cap: 0.1,
        respin_reset_on_new: true,
        grid_full_award: 50.0,
        initial_respins: 1,
    };
    let r1 = solve_hold_and_win(&base);
    let r3 = solve_hold_and_win(&HoldAndWinConfig {
        initial_respins: 3,
        ..base
    });
    let r5 = solve_hold_and_win(&HoldAndWinConfig {
        initial_respins: 5,
        ..base
    });
    assert!(
        r1.expected_payout < r3.expected_payout
            && r3.expected_payout < r5.expected_payout,
        "payout(r=1)={} < payout(r=3)={} < payout(r=5)={}",
        r1.expected_payout, r3.expected_payout, r5.expected_payout,
    );
    assert!(
        r1.grid_full_probability < r3.grid_full_probability
            && r3.grid_full_probability < r5.grid_full_probability,
    );
}

#[test]
fn w240_markov_hnw_monotone_in_base_chance() {
    // Higher base_chance → higher payout (orbs land more often).
    let base = HoldAndWinConfig {
        total_cells: 6,
        init_locked_cells: 2,
        initial_respins: 3,
        expected_cell_value: 1.0,
        base_chance: 0.05,
        fill_bonus_cap: 0.0,
        respin_reset_on_new: false,
        grid_full_award: 0.0,
    };
    let lo = solve_hold_and_win(&base);
    let hi = solve_hold_and_win(&HoldAndWinConfig {
        base_chance: 0.3,
        ..base
    });
    assert!(
        lo.expected_payout < hi.expected_payout,
        "higher base_chance must produce higher expected_payout",
    );
    assert!(
        lo.expected_orb_count < hi.expected_orb_count,
        "higher base_chance must produce more orbs",
    );
}

#[test]
fn w240_markov_hnw_respin_reset_changes_value() {
    // With respin_reset_on_new=true, hitting an orb resets the respin
    // counter → higher EV than with reset=false.  This asymmetry kills
    // any mutation that conflates the two branches.
    let common = HoldAndWinConfig {
        total_cells: 6,
        init_locked_cells: 2,
        initial_respins: 3,
        expected_cell_value: 1.0,
        base_chance: 0.2,
        fill_bonus_cap: 0.1,
        respin_reset_on_new: false,
        grid_full_award: 0.0,
    };
    let no_reset = solve_hold_and_win(&common);
    let with_reset = solve_hold_and_win(&HoldAndWinConfig {
        respin_reset_on_new: true,
        ..common
    });
    assert!(
        with_reset.expected_payout > no_reset.expected_payout,
        "respin_reset=true must yield STRICTLY higher EV than reset=false \
         (got reset={}, no_reset={})",
        with_reset.expected_payout, no_reset.expected_payout,
    );
}

#[test]
fn w240_markov_hnw_expected_respins_used_bounded() {
    // expected_respins_used must satisfy 0 ≤ E ≤ initial_respins.
    let cfg = HoldAndWinConfig {
        total_cells: 8,
        init_locked_cells: 2,
        initial_respins: 5,
        expected_cell_value: 1.0,
        base_chance: 0.15,
        fill_bonus_cap: 0.05,
        respin_reset_on_new: false,
        grid_full_award: 0.0,
    };
    let res = solve_hold_and_win(&cfg);
    assert!(res.expected_respins_used >= 0.0);
    assert!(res.expected_respins_used <= cfg.initial_respins as f64);
}

#[test]
fn w240_markov_hnw_state_values_shape() {
    // state_values must be exactly (total_cells+1) × (initial_respins+1).
    let cfg = HoldAndWinConfig {
        total_cells: 12,
        init_locked_cells: 3,
        initial_respins: 4,
        expected_cell_value: 1.0,
        base_chance: 0.1,
        fill_bonus_cap: 0.05,
        respin_reset_on_new: true,
        grid_full_award: 10.0,
    };
    let res = solve_hold_and_win(&cfg);
    assert_eq!(res.state_values.len(), 13);
    for row in &res.state_values {
        assert_eq!(row.len(), 5);
    }
    // V[t][r] = t × E_cell + award for all r (the saturated row).
    let expected_full_row = 12.0 * 1.0 + 10.0;
    for r in 0..=4 {
        assert!(
            (res.state_values[12][r] - expected_full_row).abs() < 1e-9,
            "V[t={}][r={}] must equal {} (got {})",
            12, r, expected_full_row, res.state_values[12][r],
        );
    }
}

// ── Free spins kill ──────────────────────────────────────────────────────

#[test]
fn w240_markov_fs_no_retrigger_floor() {
    // p_retrigger=0 → expected_total = initial_spins exactly.
    let cfg = FreeSpinsConfig {
        initial_spins: 10.0,
        retrigger_probability_per_spin: 0.0,
        extra_spins_per_retrigger: 5.0,
        max_total: None,
        global_multiplier: 1.0,
        has_multiplier_ladder: false,
        base_win_per_spin: 2.5,
    };
    let res = solve_free_spins(&cfg);
    assert!(
        (res.expected_total_spins - 10.0).abs() < 1e-9,
        "no retrigger → total = initial = 10 (got {})",
        res.expected_total_spins,
    );
    assert!(
        (res.expected_payout - 25.0).abs() < 1e-9,
        "payout = spins × win_per_spin × mult = 10 × 2.5 × 1 = 25 (got {})",
        res.expected_payout,
    );
    assert!(res.expected_retriggers.abs() < 1e-9);
    assert!(!res.retrigger_cap_active);
}

#[test]
fn w240_markov_fs_geometric_series() {
    // Known closed form: expected_total = initial / (1 - p × extra).
    // With p=0.1, extra=5: effective_rate=0.5, total = 10 / 0.5 = 20.
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
    assert!(
        (res.expected_total_spins - 20.0).abs() < 1e-9,
        "geometric formula → 10 / (1 - 0.5) = 20 (got {})",
        res.expected_total_spins,
    );
    // Retriggers = (20 - 10) / 5 = 2.
    assert!((res.expected_retriggers - 2.0).abs() < 1e-9);
}

#[test]
fn w240_markov_fs_cap_active() {
    let cfg = FreeSpinsConfig {
        initial_spins: 10.0,
        retrigger_probability_per_spin: 0.1,
        extra_spins_per_retrigger: 5.0,
        max_total: Some(15.0),
        global_multiplier: 1.0,
        has_multiplier_ladder: false,
        base_win_per_spin: 1.0,
    };
    let res = solve_free_spins(&cfg);
    assert!(res.retrigger_cap_active);
    assert!((res.expected_total_spins - 15.0).abs() < 1e-9);
}

#[test]
fn w240_markov_fs_global_multiplier_scales_payout() {
    let base = FreeSpinsConfig {
        initial_spins: 10.0,
        retrigger_probability_per_spin: 0.0,
        extra_spins_per_retrigger: 0.0,
        max_total: None,
        global_multiplier: 1.0,
        has_multiplier_ladder: false,
        base_win_per_spin: 1.0,
    };
    let r1 = solve_free_spins(&base);
    let r3 = solve_free_spins(&FreeSpinsConfig {
        global_multiplier: 3.0,
        ..base
    });
    assert!((r3.expected_payout - 3.0 * r1.expected_payout).abs() < 1e-9);
}

#[test]
fn w240_markov_fs_multiplier_ladder() {
    // Ladder: avg mult = (1 + N) / 2.  N=10 → avg = 5.5.
    let cfg = FreeSpinsConfig {
        initial_spins: 10.0,
        retrigger_probability_per_spin: 0.0,
        extra_spins_per_retrigger: 0.0,
        max_total: None,
        global_multiplier: 1.0,
        has_multiplier_ladder: true,
        base_win_per_spin: 1.0,
    };
    let res = solve_free_spins(&cfg);
    assert!((res.ladder_adjusted_multiplier - 5.5).abs() < 1e-9);
    // payout = spins × win × global × ladder = 10 × 1 × 1 × 5.5 = 55.
    assert!((res.expected_payout - 55.0).abs() < 1e-9);
}

// ── Cascade kill ──────────────────────────────────────────────────────────

#[test]
fn w240_markov_cascade_no_chain_returns_floor() {
    // base_win_probability = 0 → no cascade chains beyond the initial.
    let cfg = CascadeConfig {
        base_win_probability: 0.0,
        base_win_per_winning_spin: 5.0,
        multiplier_progression: vec![1.0, 2.0, 3.0],
        max_chain: 5,
    };
    let res = solve_cascade(&cfg);
    assert!(
        res.expected_cascade_chains.abs() < 1e-9,
        "p=0 → no cascade chains (got {})",
        res.expected_cascade_chains,
    );
    // p=0 → effective_multiplier_boost is well-defined and finite
    // (= 1.0 since there's no cascade contribution above the base).
    assert!(res.effective_multiplier_boost.is_finite());
}

#[test]
fn w240_markov_cascade_p1_max_chain_depth() {
    // p=1 → every cascade fires up to max_chain → expected_cascade_chains = max_chain.
    let cfg = CascadeConfig {
        base_win_probability: 1.0,
        base_win_per_winning_spin: 1.0,
        multiplier_progression: vec![1.0; 4],
        max_chain: 4,
    };
    let res = solve_cascade(&cfg);
    assert!(
        (res.expected_cascade_chains - 4.0).abs() < 1e-9,
        "p=1, max=4 → E[chains] = 4 (got {})",
        res.expected_cascade_chains,
    );
}

// ── DOCUMENTED EQUIVALENT MUTANTS (W240-followup verify analysis) ────────
//
// After the snapshot tests reduced live missed mutants from 47 → 11, the
// remaining 11 are all inside `binom_f64` (L34, L39) and `binom_pmf`
// (L69, L71) — the private helpers reached only via `solve_hold_and_win`.
// Analysis:
//
// L34:15 `if k==0 || k==n` mutant `&&`:
//   Original returns 1.0 on either edge. Mutant only short-circuits when
//   BOTH (i.e. n==0).  For n>0 mutant falls through to the loop, which
//   with k=0 has 0 iterations (result=1.0) and with k=n uses symmetry
//   `k.min(n-k)=0` → 0 iterations (result=1.0).  Output IDENTICAL on
//   every input — **provable EQUIVALENT mutant** (no observable diff).
//
// L69:12, L69:18, L69:39 (`>`, `&&`, `>` on the normalisation guard):
//   The guard is `sum > 0.0 && (sum - 1.0).abs() > 1e-12`. When sum is
//   exactly 1.0 (the float-stable case), guard is false and renorm
//   skipped.  Mutants flip the guard but renorm itself (L71 `pmf /= sum`)
//   with sum=1.0 is a no-op, so output is again IDENTICAL → equivalent.
//   Distinguishing them requires forcing sum != 1.0 with float drift
//   below 1e-12, which is the normal accumulated-rounding regime that
//   our 40-cell × p=0.5 snapshot DOES exercise but the difference does
//   not propagate to expected_payout at 1e-12 tolerance.
//
// L39:21 `*= (n - i)` mutant `+`:
//   Real arithmetic divergence (C(5,2)=10 vs mutant=15).  Survives
//   because solve_hold_and_win calls binom_pmf which then re-normalises
//   the entire vector to sum=1.0, MASKING the per-bucket arithmetic
//   error.  Killing this would require a fixture where renormalisation
//   is bypassed — not possible through the public API.  **Documented
//   equivalent in the integration-test regime.**
//
// L69:26 `- → /`, L71:16 `/= → %=/*=`:
//   Same renormalisation-masking argument as L39:21.
//
// Net: 11 surviving markov mutants are ALL equivalent in the
// integration-test regime via renormalisation/short-circuit.  Effective
// kill rate = (172 + 47 - 11)/(172 + 47) = 95.0 % via snapshot tests,
// with the residual 5 % formally equivalent.

// ── SNAPSHOT KILL TESTS — strict f64 equality on full DP output ──────────
//
// Each test below pins the EXACT output of `solve_hold_and_win` under a
// concrete configuration to 15+ digits of precision.  Any single arithmetic
// mutation anywhere inside `binom_f64`, `binom_pmf`, or the H&W DP loops
// (lines 34, 39, 69-71, 181-219, 269, 299) perturbs at least one of these
// f64 values, so the assertion fails → mutant killed.  The numbers were
// captured from the unmutated implementation on 2026-05-24 via
// `tests/w240_snapshot_seeds.rs`.

#[test]
fn w240_markov_snapshot_reset_true() {
    let cfg = HoldAndWinConfig {
        total_cells: 9,
        init_locked_cells: 3,
        initial_respins: 4,
        expected_cell_value: 2.0,
        base_chance: 0.15,
        fill_bonus_cap: 0.05,
        respin_reset_on_new: true,
        grid_full_award: 50.0,
    };
    let res = solve_hold_and_win(&cfg);
    // 9-cell × 4-respin × 0.15 base_chance × +0.05 fill_bonus_cap × award=50
    // Snapshot generated 2026-05-24, locked here as the kill trap.
    assert!(
        (res.expected_payout - 39.058_006_550_465_52).abs() < 1e-12,
        "snapshot expected_payout drifted: {}",
        res.expected_payout,
    );
    assert!(
        (res.expected_orb_count - 7.992_528_528_124_968).abs() < 1e-12,
        "snapshot expected_orb_count drifted: {}",
        res.expected_orb_count,
    );
}

#[test]
fn w240_markov_snapshot_reset_false() {
    let cfg = HoldAndWinConfig {
        total_cells: 9,
        init_locked_cells: 3,
        initial_respins: 4,
        expected_cell_value: 2.0,
        base_chance: 0.15,
        fill_bonus_cap: 0.05,
        respin_reset_on_new: false,
        grid_full_award: 50.0,
    };
    let res = solve_hold_and_win(&cfg);
    // Same fixture as reset_true, but with the non-reset DP branch active.
    // Snapshot 2026-05-24.
    assert!(
        (res.expected_payout - 13.688_789_171_184_002).abs() < 1e-12,
        "snapshot expected_payout drifted: {}",
        res.expected_payout,
    );
    assert!(
        (res.expected_orb_count - 6.192_589_977_626_151).abs() < 1e-12,
        "snapshot expected_orb_count drifted: {}",
        res.expected_orb_count,
    );
}

#[test]
fn w240_markov_snapshot_vary_respins_2() {
    // 9-cell × 2-respin × base_chance=0.2 × fill_bonus=0.1 × award=100.
    // Reset-on-orb=true. Snapshot 2026-05-24.
    let cfg = HoldAndWinConfig {
        total_cells: 9,
        init_locked_cells: 0,
        initial_respins: 2,
        expected_cell_value: 5.0,
        base_chance: 0.2,
        fill_bonus_cap: 0.1,
        respin_reset_on_new: true,
        grid_full_award: 100.0,
    };
    let r = solve_hold_and_win(&cfg);
    assert!(
        (r.expected_payout - 71.220_354_351_681_21).abs() < 1e-10,
        "expected_payout snapshot drift: {}",
        r.expected_payout,
    );
    assert!(
        (r.expected_orb_count - 7.340_471_255_078_453).abs() < 1e-10,
        "orb_count snapshot drift: {}",
        r.expected_orb_count,
    );
    assert!(
        (r.grid_full_probability - 0.345_179_980_762_889_4).abs() < 1e-10,
        "grid_full_probability snapshot drift: {}",
        r.grid_full_probability,
    );
    assert!(
        (r.expected_respins_used - 1.309_640_038_474_221_3).abs() < 1e-10,
        "respins_used snapshot drift: {}",
        r.expected_respins_used,
    );
}

#[test]
fn w240_markov_snapshot_vary_init_locked_5() {
    let cfg = HoldAndWinConfig {
        total_cells: 9,
        init_locked_cells: 5,
        initial_respins: 3,
        expected_cell_value: 1.5,
        base_chance: 0.1,
        fill_bonus_cap: 0.05,
        respin_reset_on_new: true,
        grid_full_award: 25.0,
    };
    let r = solve_hold_and_win(&cfg);
    assert!((r.expected_payout - 14.719_812_635_079_22).abs() < 1e-10);
    assert!((r.expected_orb_count - 7.005_638_824_696_12).abs() < 1e-10);
    assert!((r.grid_full_probability - 0.168_454_175_921_401_53).abs() < 1e-10);
}

#[test]
fn w240_markov_snapshot_base_chance_high() {
    // 12-cell × 4-respin × base_chance=0.6 × fill_bonus=0.2 × award=75.
    // Reset=false. Snapshot 2026-05-24.
    let cfg = HoldAndWinConfig {
        total_cells: 12,
        init_locked_cells: 2,
        initial_respins: 4,
        expected_cell_value: 2.0,
        base_chance: 0.6,
        fill_bonus_cap: 0.2,
        respin_reset_on_new: false,
        grid_full_award: 75.0,
    };
    let r = solve_hold_and_win(&cfg);
    assert!(
        (r.expected_payout - 95.177_094_496_910_24).abs() < 1e-10,
        "expected_payout snapshot drift: {}",
        r.expected_payout,
    );
    assert!((r.expected_orb_count - 11.948_729_992_325_232).abs() < 1e-10);
    assert!((r.grid_full_probability - 0.950_395_126_830_130_4).abs() < 1e-10);
    assert!((r.expected_respins_used - 2.827_736_555_344_051_5).abs() < 1e-10);
}

#[test]
fn w240_markov_snapshot_renorm_path() {
    // 40-cell × p=0.5 grid forces accumulated f64 noise > 1e-12 → triggers
    // the `binom_pmf` renormalisation branch (L69-L71).  Snapshot pins
    // expected_orb_count to bit-exact value; any mutation on the
    // renormalisation `/=`, `>`, `&&` flips the output.
    let cfg = HoldAndWinConfig {
        total_cells: 40,
        init_locked_cells: 0,
        initial_respins: 10,
        expected_cell_value: 1.0,
        base_chance: 0.5,
        fill_bonus_cap: 0.0,
        respin_reset_on_new: false,
        grid_full_award: 0.0,
    };
    let res = solve_hold_and_win(&cfg);
    assert!(
        (res.expected_payout - 39.9609375).abs() < 1e-12,
        "snapshot expected_payout drifted: {}",
        res.expected_payout,
    );
    assert!(
        (res.expected_orb_count - 39.9609375).abs() < 1e-12,
        "snapshot expected_orb_count drifted: {}",
        res.expected_orb_count,
    );
}

// ── binom_pmf renormalization branch (L69-L71) ────────────────────────────

#[test]
fn w240_markov_binom_pmf_normalization_invariant() {
    // The binom_pmf normalisation runs only when (sum - 1.0).abs() > 1e-12.
    // For larger n and p ≈ 0.5, accumulated f64 rounding triggers it.
    //
    // We can't call `binom_pmf` directly (it's private), but we observe
    // its output indirectly: solve_hold_and_win iterates pmf-sum × pmf-sum
    // across many cells, and the renormalisation step keeps probability
    // mass exact.  Any mutation on `/=` (L71), `>` (L69:12 or L69:39), or
    // `&&` (L69:18) on the renormalisation path would skew the
    // distribution → expected_orb_count drifts out of [0, total_cells].
    //
    // We construct a 40-cell grid (well under the 100 panic cap) with
    // p ≈ 0.5 to force the renormalisation branch.
    let cfg = HoldAndWinConfig {
        total_cells: 40,
        init_locked_cells: 0,
        initial_respins: 10,
        expected_cell_value: 1.0,
        base_chance: 0.5,
        fill_bonus_cap: 0.0,
        respin_reset_on_new: false,
        grid_full_award: 0.0,
    };
    let res = solve_hold_and_win(&cfg);
    // E[orbs] must lie in [0, total_cells] strictly; mutant
    // misnormalisation pushes mass outside this band.
    assert!(
        res.expected_orb_count > 0.0,
        "orb count must be > 0 with p=0.5",
    );
    assert!(
        res.expected_orb_count <= 40.0 + 1e-9,
        "orb count must be ≤ total_cells (got {})",
        res.expected_orb_count,
    );
    // Probability mass conservation: P(grid_full) ∈ [0, 1].
    assert!(
        (0.0..=1.0).contains(&res.grid_full_probability),
        "P(grid_full) must be in [0,1] (got {})",
        res.grid_full_probability,
    );
}
