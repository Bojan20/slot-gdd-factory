//! Faza 6 — Closed-form feature RTP integration tests.
//!
//! Covers:
//! * H&W Markov DP: correctness, monotonicity, grid-full award delta, parity.
//! * FS geometric-series: no-retrigger floor, geometric formula, cap behaviour,
//!   multiplier & ladder effects.
//! * Cascade EV: chain-probability normalisation, multiplier application,
//!   geometric series limiting case.
//! * Cross-solver consistency: all three E[payout] values are non-negative and
//!   finite.
//! * Serialisation round-trip for all three config/result types.

use slot_sim::markov::{
    solve_cascade, solve_free_spins, solve_hold_and_win, CascadeConfig, FreeSpinsConfig,
    HoldAndWinConfig,
};

// ─── H&W Markov DP ────────────────────────────────────────────────────────────

#[test]
fn hnw_integration_zero_cells_immediate_payout() {
    // No cells locked → feature triggered with 0 locked → nothing to pay beyond floor.
    let cfg = HoldAndWinConfig {
        total_cells: 15,
        init_locked_cells: 0,
        initial_respins: 3,
        expected_cell_value: 2.0,
        base_chance: 0.035,
        fill_bonus_cap: 0.025,
        respin_reset_on_new: true,
        grid_full_award: 0.0,
    };
    let res = solve_hold_and_win(&cfg);
    // E[payout | k=0, r=3] must be ≥ 0.
    assert!(
        res.expected_payout >= 0.0,
        "E[payout]={}",
        res.expected_payout
    );
    // Grid cannot already be full.
    assert!(res.grid_full_probability < 1.0);
}

#[test]
fn hnw_integration_already_full_grid() {
    let cfg = HoldAndWinConfig {
        total_cells: 6,
        init_locked_cells: 6,
        initial_respins: 3,
        expected_cell_value: 3.0,
        grid_full_award: 200.0,
        base_chance: 0.035,
        fill_bonus_cap: 0.025,
        respin_reset_on_new: true,
    };
    let res = solve_hold_and_win(&cfg);
    // V[6][3] = 6×3 + 200 = 218.0
    assert!(
        (res.expected_payout - 218.0).abs() < 1e-9,
        "got {}",
        res.expected_payout
    );
    assert!(
        (res.grid_full_probability - 1.0).abs() < 1e-9,
        "must be certainly full: {}",
        res.grid_full_probability
    );
}

#[test]
fn hnw_integration_monotone_in_locked_cells() {
    let base = HoldAndWinConfig {
        total_cells: 12,
        initial_respins: 3,
        expected_cell_value: 1.5,
        base_chance: 0.04,
        fill_bonus_cap: 0.02,
        respin_reset_on_new: true,
        grid_full_award: 50.0,
        init_locked_cells: 0,
    };
    let mut prev = 0.0_f64;
    for k in [0, 3, 6, 9, 12] {
        let res = solve_hold_and_win(&HoldAndWinConfig {
            init_locked_cells: k,
            ..base.clone()
        });
        assert!(
            res.expected_payout >= prev,
            "k={k}: E[payout]={} < prev={prev}",
            res.expected_payout
        );
        prev = res.expected_payout;
    }
}

#[test]
fn hnw_integration_grid_full_award_delta_exact() {
    // P(grid_full) × award should equal the payout delta exactly.
    let base = HoldAndWinConfig {
        total_cells: 4,
        init_locked_cells: 2,
        initial_respins: 4,
        expected_cell_value: 1.0,
        base_chance: 0.25, // relatively high → measurable grid-fill probability
        fill_bonus_cap: 0.10,
        respin_reset_on_new: true,
        grid_full_award: 0.0,
    };
    let without = solve_hold_and_win(&base);
    let award = 75.0_f64;
    let with_award = solve_hold_and_win(&HoldAndWinConfig {
        grid_full_award: award,
        ..base
    });
    let delta = with_award.expected_payout - without.expected_payout;
    let expected_delta = with_award.grid_full_probability * award;
    assert!(
        (delta - expected_delta).abs() < 1e-6,
        "delta={delta} expected_delta={expected_delta}"
    );
}

#[test]
fn hnw_integration_expected_orb_in_range() {
    let cfg = HoldAndWinConfig {
        total_cells: 15,
        init_locked_cells: 6,
        initial_respins: 3,
        expected_cell_value: 1.0,
        base_chance: 0.035,
        fill_bonus_cap: 0.025,
        respin_reset_on_new: true,
        grid_full_award: 0.0,
    };
    let res = solve_hold_and_win(&cfg);
    assert!(
        res.expected_orb_count >= cfg.init_locked_cells as f64,
        "E[orbs]={} < init={}",
        res.expected_orb_count,
        cfg.init_locked_cells
    );
    assert!(
        res.expected_orb_count <= cfg.total_cells as f64,
        "E[orbs]={} > total={}",
        res.expected_orb_count,
        cfg.total_cells
    );
}

#[test]
fn hnw_integration_state_table_shape() {
    let cfg = HoldAndWinConfig {
        total_cells: 9,
        initial_respins: 5,
        ..Default::default()
    };
    let res = solve_hold_and_win(&cfg);
    assert_eq!(res.state_values.len(), 10, "rows = total_cells+1");
    for row in &res.state_values {
        assert_eq!(row.len(), 6, "cols = initial_respins+1");
    }
}

#[test]
fn hnw_integration_respins_used_leq_initial() {
    let cfg = HoldAndWinConfig::default();
    let res = solve_hold_and_win(&cfg);
    assert!(
        res.expected_respins_used <= cfg.initial_respins as f64 + 1e-9,
        "used={} > initial={}",
        res.expected_respins_used,
        cfg.initial_respins
    );
    assert!(res.expected_respins_used >= 0.0);
}

#[test]
fn hnw_integration_json_roundtrip() {
    let cfg = HoldAndWinConfig::default();
    let json = serde_json::to_string_pretty(&cfg).unwrap();
    let cfg2: HoldAndWinConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(cfg, cfg2);

    let res = solve_hold_and_win(&cfg);
    let rjson = serde_json::to_string_pretty(&res).unwrap();
    let res2: slot_sim::markov::HoldAndWinResult = serde_json::from_str(&rjson).unwrap();
    assert!((res.expected_payout - res2.expected_payout).abs() < 1e-12);
    assert!((res.grid_full_probability - res2.grid_full_probability).abs() < 1e-12);
}

// ─── Free Spins geometric-series ──────────────────────────────────────────────

#[test]
fn fs_integration_no_retrigger_floor() {
    let cfg = FreeSpinsConfig {
        initial_spins: 15.0,
        retrigger_probability_per_spin: 0.0,
        extra_spins_per_retrigger: 10.0,
        base_win_per_spin: 2.5,
        global_multiplier: 1.0,
        max_total: None,
        has_multiplier_ladder: false,
    };
    let res = solve_free_spins(&cfg);
    assert!(
        (res.expected_total_spins - 15.0).abs() < 1e-9,
        "spins={}",
        res.expected_total_spins
    );
    assert!(
        (res.expected_payout - 37.5).abs() < 1e-9,
        "payout={}",
        res.expected_payout
    );
    assert_eq!(res.retrigger_cap_active, false);
}

#[test]
fn fs_integration_geometric_formula_exact() {
    // initial=10, p=0.1/spin, extra=5 → E[spins] = 10/(1-0.5) = 20
    let cfg = FreeSpinsConfig {
        initial_spins: 10.0,
        retrigger_probability_per_spin: 0.1,
        extra_spins_per_retrigger: 5.0,
        base_win_per_spin: 1.0,
        global_multiplier: 1.0,
        max_total: None,
        has_multiplier_ladder: false,
    };
    let res = solve_free_spins(&cfg);
    assert!(
        (res.expected_total_spins - 20.0).abs() < 1e-9,
        "got {}",
        res.expected_total_spins
    );
    assert!(
        (res.expected_payout - 20.0).abs() < 1e-9,
        "payout={}",
        res.expected_payout
    );
}

#[test]
fn fs_integration_cap_binding() {
    // High retrigger → uncapped E[spins] >> cap of 30
    let cfg = FreeSpinsConfig {
        initial_spins: 10.0,
        retrigger_probability_per_spin: 0.6,
        extra_spins_per_retrigger: 10.0,
        base_win_per_spin: 1.0,
        global_multiplier: 1.0,
        max_total: Some(30.0),
        has_multiplier_ladder: false,
    };
    let res = solve_free_spins(&cfg);
    assert!(res.retrigger_cap_active, "cap should be active");
    assert!(
        (res.expected_total_spins - 30.0).abs() < 1e-9,
        "spins={}",
        res.expected_total_spins
    );
}

#[test]
fn fs_integration_global_multiplier_linear() {
    let base = FreeSpinsConfig {
        initial_spins: 10.0,
        base_win_per_spin: 2.0,
        global_multiplier: 1.0,
        ..Default::default()
    };
    let r1 = solve_free_spins(&base);
    let r5 = solve_free_spins(&FreeSpinsConfig {
        global_multiplier: 5.0,
        ..base
    });
    assert!(
        (r5.expected_payout - r1.expected_payout * 5.0).abs() < 1e-9,
        "5× mult failed: {} vs {}",
        r5.expected_payout,
        r1.expected_payout
    );
}

#[test]
fn fs_integration_ladder_multiplier_correct() {
    let cfg = FreeSpinsConfig {
        initial_spins: 10.0,
        base_win_per_spin: 1.0,
        has_multiplier_ladder: true,
        global_multiplier: 1.0,
        ..Default::default()
    };
    let res = solve_free_spins(&cfg);
    // ladder_adjusted_multiplier = (1 + 10) / 2 = 5.5
    assert!(
        (res.ladder_adjusted_multiplier - 5.5).abs() < 1e-9,
        "ladder_mult={}",
        res.ladder_adjusted_multiplier
    );
    // payout = 10 × 1.0 × 1.0 × 5.5 = 55.0
    assert!(
        (res.expected_payout - 55.0).abs() < 1e-9,
        "payout={}",
        res.expected_payout
    );
}

#[test]
fn fs_integration_rtp_equals_payout() {
    let cfg = FreeSpinsConfig {
        initial_spins: 8.0,
        retrigger_probability_per_spin: 0.05,
        extra_spins_per_retrigger: 8.0,
        base_win_per_spin: 3.0,
        global_multiplier: 2.0,
        max_total: None,
        has_multiplier_ladder: false,
    };
    let res = solve_free_spins(&cfg);
    assert!(
        (res.rtp_contribution - res.expected_payout).abs() < 1e-12,
        "rtp != payout"
    );
}

#[test]
fn fs_integration_json_roundtrip() {
    let cfg = FreeSpinsConfig {
        initial_spins: 10.0,
        retrigger_probability_per_spin: 0.1,
        extra_spins_per_retrigger: 5.0,
        base_win_per_spin: 1.0,
        global_multiplier: 2.0,
        max_total: Some(100.0),
        has_multiplier_ladder: true,
    };
    let json = serde_json::to_string_pretty(&cfg).unwrap();
    let cfg2: FreeSpinsConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(cfg, cfg2);

    let res = solve_free_spins(&cfg);
    let rjson = serde_json::to_string_pretty(&res).unwrap();
    let res2: slot_sim::markov::FreeSpinsResult = serde_json::from_str(&rjson).unwrap();
    assert!((res.expected_payout - res2.expected_payout).abs() < 1e-12);
}

// ─── Cascade EV ───────────────────────────────────────────────────────────────

#[test]
fn cascade_integration_chain_probs_sum_to_one() {
    for p in [0.0, 0.15, 0.3, 0.5, 0.75, 0.99, 1.0] {
        let cfg = CascadeConfig {
            base_win_probability: p,
            base_win_per_winning_spin: 1.0,
            multiplier_progression: vec![],
            max_chain: 10,
        };
        let res = solve_cascade(&cfg);
        let sum: f64 = res.chain_probabilities.iter().sum();
        assert!((sum - 1.0).abs() < 1e-9, "p={p}: chain_prob_sum={sum}");
    }
}

#[test]
fn cascade_integration_zero_prob_only_chain0_fires() {
    let cfg = CascadeConfig {
        base_win_probability: 0.0,
        base_win_per_winning_spin: 7.0,
        multiplier_progression: vec![3.0],
        max_chain: 5,
    };
    let res = solve_cascade(&cfg);
    // Chain 0 fires: p^0 = 1, mult m[0]=3.0 → pays 7×3 = 21.
    assert!(
        (res.expected_payout_per_spin - 21.0).abs() < 1e-9,
        "got {}",
        res.expected_payout_per_spin
    );
    assert!(
        (res.expected_cascade_chains - 0.0).abs() < 1e-9,
        "E[chains]={}",
        res.expected_cascade_chains
    );
}

#[test]
fn cascade_integration_multiplier_progression_exact() {
    // p=0.5, multipliers [2,3,4], max_chain=3
    // E[payout] = 1×1×2 + 0.5×1×3 + 0.25×1×4 + 0.125×1×1 (fallback mult=1 for c=3)
    //           = 2 + 1.5 + 1.0 + 0.125 = 4.625
    let cfg = CascadeConfig {
        base_win_probability: 0.5,
        base_win_per_winning_spin: 1.0,
        multiplier_progression: vec![2.0, 3.0, 4.0],
        max_chain: 3,
    };
    let res = solve_cascade(&cfg);
    let expected = 2.0 + 1.5 + 1.0 + 0.125;
    assert!(
        (res.expected_payout_per_spin - expected).abs() < 1e-9,
        "got {} expected {}",
        res.expected_payout_per_spin,
        expected
    );
}

#[test]
fn cascade_integration_geometric_chain_limiting() {
    // Large cap → E[chains] → p/(1-p) for p=0.4.
    let cfg = CascadeConfig {
        base_win_probability: 0.4,
        base_win_per_winning_spin: 1.0,
        multiplier_progression: vec![],
        max_chain: 200,
    };
    let res = solve_cascade(&cfg);
    let expected = 0.4_f64 / 0.6_f64;
    assert!(
        (res.expected_cascade_chains - expected).abs() < 0.01,
        "got {} expected ~{}",
        res.expected_cascade_chains,
        expected
    );
}

#[test]
fn cascade_integration_effective_boost_gte_one() {
    for p in [0.01, 0.1, 0.3, 0.5, 0.9] {
        let cfg = CascadeConfig {
            base_win_probability: p,
            base_win_per_winning_spin: 5.0,
            multiplier_progression: vec![],
            max_chain: 20,
        };
        let res = solve_cascade(&cfg);
        assert!(
            res.effective_multiplier_boost >= 1.0,
            "p={p}: boost={}",
            res.effective_multiplier_boost
        );
    }
}

#[test]
fn cascade_integration_json_roundtrip() {
    let cfg = CascadeConfig {
        base_win_probability: 0.35,
        base_win_per_winning_spin: 4.0,
        multiplier_progression: vec![1.0, 2.0, 3.0, 5.0],
        max_chain: 8,
    };
    let json = serde_json::to_string_pretty(&cfg).unwrap();
    let cfg2: CascadeConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(cfg, cfg2);

    let res = solve_cascade(&cfg);
    let rjson = serde_json::to_string_pretty(&res).unwrap();
    let res2: slot_sim::markov::CascadeResult = serde_json::from_str(&rjson).unwrap();
    assert!((res.expected_payout_per_spin - res2.expected_payout_per_spin).abs() < 1e-12);
    assert_eq!(
        res.chain_probabilities.len(),
        res2.chain_probabilities.len()
    );
}

// ─── Cross-solver sanity ──────────────────────────────────────────────────────

#[test]
fn all_solvers_finite_non_negative() {
    let hnw = solve_hold_and_win(&HoldAndWinConfig::default());
    let fs = solve_free_spins(&FreeSpinsConfig::default());
    let casc = solve_cascade(&CascadeConfig::default());

    assert!(hnw.expected_payout.is_finite() && hnw.expected_payout >= 0.0);
    assert!(hnw.grid_full_probability.is_finite());
    assert!(hnw.expected_orb_count.is_finite());

    assert!(fs.expected_payout.is_finite() && fs.expected_payout >= 0.0);
    assert!(fs.expected_total_spins.is_finite());

    assert!(casc.expected_payout_per_spin.is_finite() && casc.expected_payout_per_spin >= 0.0);
    assert!(casc.effective_multiplier_boost.is_finite());
}

#[test]
fn hnw_rtp_contribution_sensible_range() {
    // For a typical H&W with 15 cells, 6 locked, E[cell]=1.0:
    // Minimum payout = 6×1.0 = 6.0
    // Maximum payout = 15×E[cell] + grid_full_award.
    let cfg = HoldAndWinConfig {
        total_cells: 15,
        init_locked_cells: 6,
        initial_respins: 3,
        expected_cell_value: 1.0,
        base_chance: 0.035,
        fill_bonus_cap: 0.025,
        respin_reset_on_new: true,
        grid_full_award: 0.0,
    };
    let res = solve_hold_and_win(&cfg);
    assert!(
        res.expected_payout >= 6.0,
        "E[payout]={} < floor=6",
        res.expected_payout
    );
    assert!(
        res.expected_payout <= 15.0,
        "E[payout]={} > ceil=15",
        res.expected_payout
    );
}
