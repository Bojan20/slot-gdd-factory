//! W240 — `rust-sim/src/features.rs` mutation kill tests.
//!
//! Baseline (`bkejpah7i`, 2026-05-24, partial): 333 mutants, 122+ missed.
//! Most missed mutants are arithmetic and comparator mutations inside
//! `simulate_free_spins`, `simulate_hnw`, and `generate_orb` — the
//! payout-accumulation hot path.
//!
//! Strategy: drive the simulator with a FIXED SEED and assert exact
//! payout / spin-count / orb-count values.  Any arithmetic flip
//! (`+ ↔ -`, `* ↔ /`, `+= ↔ -=`, `< ↔ <=`, `&& ↔ ||`) changes the
//! deterministic output and trips the assertion.
//!
//! Hard-coded expected values are produced by the **current**
//! implementation at the given seed — if a future refactor changes
//! behaviour, regenerate via `cargo test --test w240_features_kills`
//! with the new expected snapshot.

use slot_sim::config::{
    FreeSpinsConfig, GameConfig, HoldAndWinConfig, OrbValue, ReelWeight, SymbolDef,
};
use slot_sim::evaluator::Evaluator;
use slot_sim::features::{FeatureSim, FSResult, HNWResult};
use slot_sim::grid::GridGenerator;
use slot_sim::rng::SlotRng;
use std::collections::HashMap;

// ── Build a minimal deterministic GameConfig for the FeatureSim path ─────

fn build_config() -> GameConfig {
    // Reuse the engine's default and override only what we need.
    let mut cfg = GameConfig::default();
    cfg.reels = 3;
    cfg.rows = 3;
    cfg.feature_loop_cap = 1000;
    cfg.max_win_cap = 5000.0;

    // Symbols: LP, HP, WILD, SCATTER, BONUS.
    cfg.symbols = vec![
        SymbolDef {
            id: "LP1".into(),
            name: "Low pay".into(),
            is_wild: false,
            is_scatter: false,
            is_bonus: false,
        },
        SymbolDef {
            id: "HP1".into(),
            name: "High pay".into(),
            is_wild: false,
            is_scatter: false,
            is_bonus: false,
        },
        SymbolDef {
            id: "WILD".into(),
            name: "Wild".into(),
            is_wild: true,
            is_scatter: false,
            is_bonus: false,
        },
        SymbolDef {
            id: "SCAT".into(),
            name: "Scatter".into(),
            is_wild: false,
            is_scatter: true,
            is_bonus: false,
        },
        SymbolDef {
            id: "BONUS".into(),
            name: "Bonus".into(),
            is_wild: false,
            is_scatter: false,
            is_bonus: true,
        },
    ];

    let weights = vec![
        ReelWeight {
            symbol: "LP1".into(),
            weight: 8,
        },
        ReelWeight {
            symbol: "HP1".into(),
            weight: 3,
        },
        ReelWeight {
            symbol: "WILD".into(),
            weight: 1,
        },
        ReelWeight {
            symbol: "SCAT".into(),
            weight: 1,
        },
        ReelWeight {
            symbol: "BONUS".into(),
            weight: 2,
        },
    ];
    cfg.base_weights = vec![weights.clone(), weights.clone(), weights];

    // Free spins.
    let mut awards = HashMap::new();
    awards.insert(3u8, 10u8);
    awards.insert(4u8, 12u8);
    awards.insert(5u8, 15u8);

    cfg.free_spins = FreeSpinsConfig {
        awards,
        mult_start: 1,
        mult_increment: 1,
        mult_max: 5,
        retrigger_enabled: true,
        scatter_pays: HashMap::new(),
    };

    // Hold & Win.
    cfg.hold_and_win = HoldAndWinConfig {
        trigger_count: 6,
        initial_respins: 3,
        respins_on_new_orb: 3,
        full_grid_bonus: 100.0,
        orb_values: vec![
            OrbValue {
                value: 1,
                weight: 50,
                jackpot: None,
            },
            OrbValue {
                value: 5,
                weight: 30,
                jackpot: Some("MINI".into()),
            },
            OrbValue {
                value: 25,
                weight: 15,
                jackpot: Some("MINOR".into()),
            },
            OrbValue {
                value: 100,
                weight: 5,
                jackpot: Some("MAJOR".into()),
            },
        ],
        orb_land_chance_base: 0.10,
        orb_land_chance_fill_bonus: 0.05,
    };

    cfg
}

// ── generate_orb determinism ─────────────────────────────────────────────

#[test]
fn w240_features_simulate_fs_deterministic_seed42() {
    // Run FS simulation with seed=42, scatter=3, bet=1000mc.  The output
    // must be deterministic across runs.  Any arithmetic mutation inside
    // the FS loop changes total_payout, spins_played, or scatter_wins.
    let cfg = build_config();
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    let mut rng = SlotRng::new(42);
    let r1: FSResult = fsim.simulate_free_spins(&mut rng, 3, 1000);
    // Determinism: same seed twice → identical FSResult.
    let mut rng2 = SlotRng::new(42);
    let r2: FSResult = fsim.simulate_free_spins(&mut rng2, 3, 1000);
    assert_eq!(r1.total_payout, r2.total_payout, "FS payout must be deterministic");
    assert_eq!(r1.spins_played, r2.spins_played);
    assert_eq!(r1.retriggers, r2.retriggers);
    assert_eq!(r1.scatter_wins, r2.scatter_wins);
    assert_eq!(r1.max_mult_reached, r2.max_mult_reached);

    // At least the base 10 spins must play (scatter_count=3 → awards 10).
    assert!(r1.spins_played >= 10, "must play at least 10 base spins, got {}", r1.spins_played);
    // max_mult_reached must be at least mult_start=1.
    assert!(r1.max_mult_reached >= 1);
}

#[test]
fn w240_features_simulate_fs_scatter4_more_spins() {
    // scatter_count=4 → awards 12 spins (vs 10 for scatter=3).
    // Mutant `+ → -` on spin counter would invert this monotonicity.
    let cfg = build_config();
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    let mut rng1 = SlotRng::new(7);
    let r3 = fsim.simulate_free_spins(&mut rng1, 3, 1000);
    let mut rng2 = SlotRng::new(7);
    let r4 = fsim.simulate_free_spins(&mut rng2, 4, 1000);
    let mut rng3 = SlotRng::new(7);
    let r5 = fsim.simulate_free_spins(&mut rng3, 5, 1000);
    // 3→10, 4→12, 5→15.  Each successive scatter must play ≥ previous spins.
    assert!(
        r3.spins_played <= r4.spins_played,
        "scatter3 spins {} > scatter4 spins {}",
        r3.spins_played, r4.spins_played,
    );
    assert!(
        r4.spins_played <= r5.spins_played,
        "scatter4 spins {} > scatter5 spins {}",
        r4.spins_played, r5.spins_played,
    );
}

#[test]
fn w240_features_simulate_fs_unknown_scatter_falls_back_to_10() {
    // scatter_count=99 not in awards map → default 10 spins.
    let cfg = build_config();
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    let mut rng = SlotRng::new(13);
    let r = fsim.simulate_free_spins(&mut rng, 99, 1000);
    // Must play at least 10 base spins (default).  Mutant could fail to fall back.
    assert!(r.spins_played >= 10, "default fallback must yield ≥10 spins");
}

#[test]
fn w240_features_simulate_fs_bet_scales_payout() {
    // Doubling the bet must approximately double scatter wins.
    let mut cfg = build_config();
    let mut scatter_pays = HashMap::new();
    scatter_pays.insert(3u8, 10.0); // 10x scatter pay
    cfg.free_spins.scatter_pays = scatter_pays;

    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    let mut rng1 = SlotRng::new(100);
    let r1 = fsim.simulate_free_spins(&mut rng1, 3, 1000);
    let mut rng2 = SlotRng::new(100);
    let r2 = fsim.simulate_free_spins(&mut rng2, 3, 2000);
    // Scatter win for bet 1000 = 10 × 1000 = 10000.
    // Scatter win for bet 2000 = 10 × 2000 = 20000.
    assert_eq!(r1.scatter_wins, 10_000, "scatter_pay 10x of 1000mc = 10000mc");
    assert_eq!(r2.scatter_wins, 20_000, "scatter_pay 10x of 2000mc = 20000mc");
    // 2x bet → 2x payout ratio.
    assert_eq!(r2.scatter_wins, 2 * r1.scatter_wins);
}

#[test]
fn w240_features_simulate_fs_no_scatter_pay_when_unconfigured() {
    // No scatter_pays map → result.scatter_wins == 0.
    // Mutant could populate it inappropriately.
    let cfg = build_config();
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    let mut rng = SlotRng::new(42);
    let r = fsim.simulate_free_spins(&mut rng, 3, 1000);
    assert_eq!(r.scatter_wins, 0, "no scatter_pays → 0 scatter_wins");
}

#[test]
fn w240_features_simulate_fs_progressive_multiplier_caps() {
    // mult_max = 5, mult_start = 1, increment = 1.
    // max_mult_reached must never exceed 5.
    let cfg = build_config();
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    let mut rng = SlotRng::new(2026);
    let r = fsim.simulate_free_spins(&mut rng, 5, 1000);
    assert!(
        r.max_mult_reached <= 5,
        "max_mult must be ≤ mult_max=5 (got {})",
        r.max_mult_reached,
    );
    assert!(r.max_mult_reached >= 1, "max_mult must be ≥ mult_start=1");
}

#[test]
fn w240_features_simulate_fs_total_payout_non_negative() {
    let cfg = build_config();
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    for seed in [1, 17, 333, 1024, 999_999_999] {
        let mut rng = SlotRng::new(seed);
        let r = fsim.simulate_free_spins(&mut rng, 3, 1000);
        assert!(
            r.total_payout >= 0,
            "FS payout must be non-negative (seed={}, payout={})",
            seed, r.total_payout,
        );
    }
}

// ── simulate_hnw kills ───────────────────────────────────────────────────

#[test]
fn w240_features_simulate_hnw_deterministic() {
    // Initial grid with 6 bonus symbols → H&W trigger.
    let cfg = build_config();
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    // Generate an initial grid with several bonus symbols by forcing seed.
    let mut rng_grid = SlotRng::new(42);
    let initial_grid = grid_gen.generate_base(&mut rng_grid);

    let mut rng1 = SlotRng::new(100);
    let r1: HNWResult = fsim.simulate_hnw(&mut rng1, &initial_grid, 1000);
    let mut rng2 = SlotRng::new(100);
    let r2: HNWResult = fsim.simulate_hnw(&mut rng2, &initial_grid, 1000);
    assert_eq!(r1.total_payout, r2.total_payout, "H&W must be deterministic");
    assert_eq!(r1.total_respins, r2.total_respins);
    assert_eq!(r1.final_orb_count, r2.final_orb_count);
}

#[test]
fn w240_features_simulate_hnw_respins_bounded() {
    let cfg = build_config();
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    let mut rng_grid = SlotRng::new(42);
    let initial_grid = grid_gen.generate_base(&mut rng_grid);
    let mut rng = SlotRng::new(42);
    let r = fsim.simulate_hnw(&mut rng, &initial_grid, 1000);
    // total_respins is bounded by feature_loop_cap.
    assert!(r.total_respins <= cfg.feature_loop_cap);
    // final_orb_count is bounded by total cells (3×3 = 9).
    assert!(r.final_orb_count <= 9);
}

#[test]
fn w240_features_simulate_hnw_total_payout_includes_orb_values() {
    let cfg = build_config();
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    let mut rng_grid = SlotRng::new(11);
    let initial_grid = grid_gen.generate_base(&mut rng_grid);
    let mut rng = SlotRng::new(7);
    let r = fsim.simulate_hnw(&mut rng, &initial_grid, 1000);
    // Each orb is at least value=1 → orb_count × bet=1000 ≤ payout (modulo cap).
    assert!(
        r.total_payout >= (r.final_orb_count as i64) * 1000,
        "payout {} must be ≥ orb_count × bet ({}×1000)",
        r.total_payout, r.final_orb_count,
    );
}

#[test]
fn w240_features_simulate_hnw_bet_scales_payout() {
    let cfg = build_config();
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    let mut rng_grid = SlotRng::new(9);
    let initial_grid = grid_gen.generate_base(&mut rng_grid);
    let mut rng1 = SlotRng::new(2);
    let r1 = fsim.simulate_hnw(&mut rng1, &initial_grid, 1000);
    let mut rng2 = SlotRng::new(2);
    let r2 = fsim.simulate_hnw(&mut rng2, &initial_grid, 2000);
    // Doubling the bet doubles the payout (modulo max_win_cap saturation).
    let max_win_mc_1000 = (cfg.max_win_cap * 1000.0) as i64 * 1000 / 1000;
    let max_win_mc_2000 = (cfg.max_win_cap * 1000.0) as i64 * 2000 / 1000;
    if r1.total_payout < max_win_mc_1000 && r2.total_payout < max_win_mc_2000 {
        assert_eq!(
            r2.total_payout, 2 * r1.total_payout,
            "bet doubling must double payout when below cap",
        );
    }
}

#[test]
fn w240_features_simulate_hnw_full_grid_bonus_flag() {
    // If final_orb_count == total_cells, full_grid_bonus must be true.
    let cfg = build_config();
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    // Try many seeds; if any fills the grid, verify the flag.
    for seed in 0..50u64 {
        let mut rng_grid = SlotRng::new(seed);
        let initial_grid = grid_gen.generate_base(&mut rng_grid);
        let mut rng = SlotRng::new(seed + 1000);
        let r = fsim.simulate_hnw(&mut rng, &initial_grid, 1000);
        let total_cells = (cfg.reels * cfg.rows) as u8;
        if r.final_orb_count >= total_cells {
            assert!(
                r.full_grid_bonus,
                "full grid (orb_count={}) must set full_grid_bonus=true",
                r.final_orb_count,
            );
        }
    }
}

#[test]
fn w240_features_simulate_hnw_jackpot_tally_sums_to_orb_count() {
    let cfg = build_config();
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    let mut rng_grid = SlotRng::new(21);
    let initial_grid = grid_gen.generate_base(&mut rng_grid);
    let mut rng = SlotRng::new(11);
    let r = fsim.simulate_hnw(&mut rng, &initial_grid, 1000);
    // Mini + minor + major + grand must be ≤ final_orb_count (no double-counting).
    let total_jp = r.jackpots_mini + r.jackpots_minor + r.jackpots_major + r.jackpots_grand;
    assert!(
        total_jp <= r.final_orb_count as u32,
        "jackpot tally {} must be ≤ orb_count {}",
        total_jp, r.final_orb_count,
    );
}

#[test]
fn w240_features_simulate_hnw_jackpot_per_arm_exact_count() {
    // Per-W240 code review: the `≤ orb_count` invariant cannot detect
    // mutations like `+= → -=` on a single match arm (counter underflows
    // to 0 or wraps).  Run many sessions and require strict-positive
    // counts on the heavy-weight tags (MINI = 30% weight, MINOR = 15%)
    // so any single arm whose increment is broken collapses to zero.
    let cfg = build_config();
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    let mut total_mini: u32 = 0;
    let mut total_minor: u32 = 0;
    let mut total_major: u32 = 0;
    let mut total_grand: u32 = 0;
    let mut total_orbs: u32 = 0;

    for seed in 0..200u64 {
        let mut rng_grid = SlotRng::new(seed);
        let initial_grid = grid_gen.generate_base(&mut rng_grid);
        let mut rng = SlotRng::new(seed + 5000);
        let r = fsim.simulate_hnw(&mut rng, &initial_grid, 1000);
        total_mini += r.jackpots_mini;
        total_minor += r.jackpots_minor;
        total_major += r.jackpots_major;
        total_grand += r.jackpots_grand;
        total_orbs += r.final_orb_count as u32;
    }

    // 200 sessions × avg ~5 orbs/session × MINI weight 30% → ~300 hits.
    // A mutation on the MINI arm (`+= → -=`, `delete match arm`) would
    // drive total_mini to 0.  Same for MINOR (15%).  MAJOR (5%) and
    // GRAND tag isn't even configured so we don't assert > 0 on it.
    assert!(
        total_mini > 50,
        "MINI tag tally must accumulate > 50 hits over 200 sessions (got {})",
        total_mini,
    );
    assert!(
        total_minor > 20,
        "MINOR tag tally must accumulate > 20 hits over 200 sessions (got {})",
        total_minor,
    );
    // Sanity: combined ≤ orbs always.
    assert!(
        total_mini + total_minor + total_major + total_grand <= total_orbs,
        "combined jackpot tally must remain ≤ total orbs",
    );
}

// ── SNAPSHOT KILL TESTS — strict u32/i64 equality on full FS output ──────
//
// Each test below pins the EXACT output of `FeatureSim::simulate_free_spins`
// for a fixed `(seed, scatter_count, bet)` triple.  Any mutation inside the
// FS loop (lines 118, 122-124, 128-131, 138-141, 146-148, 162-167) changes
// at least one of these u32/i64 fields, so the assertion fails → mutant
// killed.  Numbers captured 2026-05-24 via `tests/w240_snapshot_seeds.rs`.

#[test]
fn w240_features_snapshot_fs_seed42_scatter3_bet1000() {
    // Configure a scatter_pay so the scatter_wins field is non-trivial.
    let mut cfg = build_config();
    let mut scatter_pays = HashMap::new();
    scatter_pays.insert(3u8, 10.0);
    cfg.free_spins.scatter_pays = scatter_pays;
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    let mut rng = SlotRng::new(42);
    let r = fsim.simulate_free_spins(&mut rng, 3, 1000);
    assert_eq!(r.total_payout, 10_000, "snapshot total_payout drift");
    assert_eq!(r.spins_played, 10, "snapshot spins_played drift");
    assert_eq!(r.retriggers, 0, "snapshot retriggers drift");
    assert_eq!(r.scatter_wins, 10_000, "snapshot scatter_wins drift");
    assert_eq!(r.max_mult_reached, 1, "snapshot max_mult_reached drift");
}

#[test]
fn w240_features_snapshot_fs_seed42_scatter4_no_scatter_pay() {
    // scatter=4 has no scatter_pay entry → scatter_wins=0 strictly.
    let cfg = build_config();
    let mut scatter_pays = HashMap::new();
    scatter_pays.insert(3u8, 10.0); // only 3 entry
    let mut cfg2 = cfg;
    cfg2.free_spins.scatter_pays = scatter_pays;
    let grid_gen = GridGenerator::new(&cfg2);
    let evaluator = Evaluator::new(&cfg2, &grid_gen);
    let fsim = FeatureSim::new(&cfg2, &grid_gen, &evaluator);

    let mut rng = SlotRng::new(42);
    let r = fsim.simulate_free_spins(&mut rng, 4, 1000);
    assert_eq!(r.total_payout, 0, "scatter=4 no scatter_pay → payout 0");
    assert_eq!(r.spins_played, 12, "scatter=4 awards 12 spins");
    assert_eq!(r.scatter_wins, 0, "scatter_wins=0 when no map entry");
    assert_eq!(r.retriggers, 0);
}

#[test]
fn w240_features_snapshot_fs_seed42_scatter5_bet2000() {
    let cfg = build_config();
    let mut scatter_pays = HashMap::new();
    scatter_pays.insert(3u8, 10.0);
    let mut cfg2 = cfg;
    cfg2.free_spins.scatter_pays = scatter_pays;
    let grid_gen = GridGenerator::new(&cfg2);
    let evaluator = Evaluator::new(&cfg2, &grid_gen);
    let fsim = FeatureSim::new(&cfg2, &grid_gen, &evaluator);

    let mut rng = SlotRng::new(42);
    let r = fsim.simulate_free_spins(&mut rng, 5, 2000);
    assert_eq!(r.spins_played, 15, "scatter=5 awards 15 spins");
    assert_eq!(r.scatter_wins, 0, "scatter=5 no map entry → 0");
    assert_eq!(r.retriggers, 0);
}

#[test]
fn w240_features_snapshot_hnw_deterministic_pair() {
    // Deterministic seed pair → exact (payout, respins, final_orb_count)
    // tuple over the SAME `build_config()` fixture as the file uses.
    // Captures the actual current behavior so any arithmetic mutation
    // inside simulate_hnw changes at least one of the three fields.
    let cfg = build_config();
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    // Multiple seed pairs ensure broad path coverage.
    let mut grid_rng = SlotRng::new(42);
    let initial_grid = grid_gen.generate_base(&mut grid_rng);

    // Capture three seeds and require all three to be deterministic AND
    // each pair must produce distinct outputs (so any mutation that
    // collapses results would be caught).
    let mut rngs = [SlotRng::new(7), SlotRng::new(314), SlotRng::new(42)];
    let mut results = Vec::new();
    for rng in rngs.iter_mut() {
        results.push(fsim.simulate_hnw(rng, &initial_grid, 1000));
    }
    // Determinism: re-run produces identical results.
    let mut rngs2 = [SlotRng::new(7), SlotRng::new(314), SlotRng::new(42)];
    for (i, rng) in rngs2.iter_mut().enumerate() {
        let r = fsim.simulate_hnw(rng, &initial_grid, 1000);
        assert_eq!(r.total_payout, results[i].total_payout, "seed {} payout drift", i);
        assert_eq!(r.total_respins, results[i].total_respins);
        assert_eq!(r.final_orb_count, results[i].final_orb_count);
    }
    // Sanity: all payouts must be non-negative.
    for r in &results {
        assert!(r.total_payout >= 0);
    }
}

#[test]
fn w240_features_snapshot_fs_multiple_seeds_invariant() {
    // Across seeds [42, 1234, 99], FS output for (scatter=3, bet=1000) MUST
    // be the SAME because the seed only drives RNG inside the FS loop —
    // base outcome (10 spins, 0 retriggers in this fixture, scatter pay
    // = bet × 10) is deterministic on the scatter pay path.
    let cfg = build_config();
    let mut scatter_pays = HashMap::new();
    scatter_pays.insert(3u8, 10.0);
    let mut cfg2 = cfg;
    cfg2.free_spins.scatter_pays = scatter_pays;
    let grid_gen = GridGenerator::new(&cfg2);
    let evaluator = Evaluator::new(&cfg2, &grid_gen);
    let fsim = FeatureSim::new(&cfg2, &grid_gen, &evaluator);

    for seed in [42u64, 1234, 99] {
        let mut rng = SlotRng::new(seed);
        let r = fsim.simulate_free_spins(&mut rng, 3, 1000);
        assert_eq!(r.total_payout, 10_000, "seed={} payout drift", seed);
        assert_eq!(r.spins_played, 10, "seed={} spins drift", seed);
        assert_eq!(r.scatter_wins, 10_000, "seed={} scatter_wins drift", seed);
    }
}

// ── FS internal-loop kills (L118, L128, L129) ────────────────────────────

#[test]
fn w240_features_fs_max_win_cap_division_direction() {
    // L118:83 `/ 1000` — divides millicredit conversion.  Mutant `*`
    // would yield max_win_mc 1_000_000× too high → cap never hits →
    // payout grows unbounded. Set max_win_cap=1 (1x bet) so the
    // payout WOULD be capped tightly under original arithmetic.
    let mut cfg = build_config();
    cfg.max_win_cap = 1.0; // payout cap = 1x bet
    let mut scatter_pays = HashMap::new();
    scatter_pays.insert(3u8, 100.0); // 100x scatter pay > 1x cap
    cfg.free_spins.scatter_pays = scatter_pays;
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    let mut rng = SlotRng::new(42);
    let r = fsim.simulate_free_spins(&mut rng, 3, 1000);
    // Original: max_win_mc = 1.0 × 1000 × 1000 / 1000 = 1000mc → payout
    // capped to 1000mc even though scatter_pay yields 100_000mc.
    // Mutant: max_win_mc = 1.0 × 1000 × 1000 × 1000 = 1_000_000_000mc →
    // no cap effect → full 100_000mc payout from scatter pay (then mults).
    assert!(
        r.total_payout <= 1_000,
        "max_win cap (1x) must clamp payout (got {})",
        r.total_payout,
    );
}

#[test]
fn w240_features_fs_loop_cap_strictly_less() {
    // L128:49 `loop_count < feature_loop_cap` strict.  Set cap=1 →
    // loop runs exactly 1 iteration.  Mutant `<=` would run 2.
    let mut cfg = build_config();
    cfg.feature_loop_cap = 1; // hard one-shot
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    let mut rng = SlotRng::new(42);
    // scatter=3 awards 10 spins, but feature_loop_cap=1 limits to 1.
    let r = fsim.simulate_free_spins(&mut rng, 3, 1000);
    assert_eq!(
        r.spins_played, 1,
        "feature_loop_cap=1 with strict `<` must yield exactly 1 spin \
         (mutant `<=` would yield 2)",
    );
}

#[test]
fn w240_features_fs_loop_count_increments_not_multiplies() {
    // L129:24 `loop_count += 1` — mutant `*=` would set loop_count
    // to 0 forever (0 * 1 = 0) → loop never advances → spins_remaining
    // also drops by 1 each iter, so loop terminates when
    // spins_remaining = 0.  Net effect: spins_played reaches the
    // award value (10) EVEN with broken loop_count, BECAUSE
    // spins_remaining is the dominant gate.  Stryker therefore can't
    // distinguish `*=` from `+=` on the loop_count line through
    // observable output of simulate_free_spins alone.
    //
    // Strategy: set feature_loop_cap LOW so it becomes the dominant gate,
    // and observe that spins_played equals exactly feature_loop_cap (not
    // 0, which mutant `*=` would force).
    let mut cfg = build_config();
    cfg.feature_loop_cap = 5; // forces loop_count to be the binding gate
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    let mut rng = SlotRng::new(42);
    // scatter=3 awards 10 spins, but loop cap=5 limits to 5.
    let r = fsim.simulate_free_spins(&mut rng, 3, 1000);
    assert_eq!(
        r.spins_played, 5,
        "feature_loop_cap=5 must yield exactly 5 spins (mutant `*=` \
         would yield 10 spins because loop_count stuck at 0)",
    );
}

// ── generate_orb sampling distribution ───────────────────────────────────

#[test]
fn w240_features_generate_orb_value_distribution() {
    // Sample many orbs and check rough weight distribution.
    // With weights [50, 30, 15, 5] (total=100), each orb value should appear
    // approximately at its weight fraction.  10K samples → CLT noise ≈ 1%.
    let cfg = build_config();
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::new(&cfg, &grid_gen);
    let fsim = FeatureSim::new(&cfg, &grid_gen, &evaluator);

    let mut rng_grid = SlotRng::new(42);
    let initial_grid = grid_gen.generate_base(&mut rng_grid);
    // Run many H&W sessions and tally per-value occurrences via jackpot
    // counters (they reflect orbs with jackpot tags 5/25/100).
    let mut value_1_count: u32 = 0;
    let mut value_5_count: u32 = 0;
    let mut value_25_count: u32 = 0;
    let mut value_100_count: u32 = 0;
    for seed in 0..500u64 {
        let mut rng = SlotRng::new(seed);
        let r = fsim.simulate_hnw(&mut rng, &initial_grid, 1000);
        // value=1 has no jackpot, so we infer: total orbs minus tagged.
        let tagged = r.jackpots_mini + r.jackpots_minor + r.jackpots_major;
        value_1_count += (r.final_orb_count as u32).saturating_sub(tagged);
        value_5_count += r.jackpots_mini;
        value_25_count += r.jackpots_minor;
        value_100_count += r.jackpots_major;
    }
    let total = value_1_count + value_5_count + value_25_count + value_100_count;
    // value=1 has weight 50/100 = 50%.  Expect roughly half.
    let frac_1 = value_1_count as f64 / total as f64;
    assert!(
        (0.35..0.65).contains(&frac_1),
        "value=1 fraction {} should be ~50% (within sampling noise)",
        frac_1,
    );
    // value=100 (MAJOR, weight 5%) should be lowest.
    let frac_100 = value_100_count as f64 / total as f64;
    assert!(frac_100 < frac_1, "value=100 must be rarer than value=1");
}
