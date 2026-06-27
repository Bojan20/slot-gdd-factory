//! W152 P1-7 — integration tests for the persistent-grid H&W solver.
//!
//! Drives `solve_persistent_grid_hw` against the shared TS/Rust fixture
//! `tests/fixtures/persistent-hw.json`. Each TS test using the same fixture
//! must produce identical floats (within f64 precision) — the fixture is the
//! cross-language byte-stability gate.

use slot_sim::markov::HoldAndWinConfig;
use slot_sim::markov_persistent::{
    solve_persistent_grid_hw, CellClassDistribution, PersistentGridHwConfig,
};

use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct FixtureOccupancy {
    #[serde(rename = "totalCells")]
    total_cells: usize,
    #[serde(rename = "initialRespins")]
    initial_respins: u32,
    #[serde(rename = "baseChance")]
    base_chance: f64,
    #[serde(rename = "fillBonusCap")]
    fill_bonus_cap: f64,
    #[serde(rename = "respinResetOnNew")]
    respin_reset_on_new: bool,
    #[serde(rename = "gridFullAward")]
    grid_full_award: f64,
    #[serde(rename = "initLockedCells")]
    init_locked_cells: usize,
}

#[derive(Debug, Deserialize)]
struct FixtureClasses {
    #[serde(rename = "pCash")]
    p_cash: f64,
    #[serde(rename = "muCash")]
    mu_cash: f64,
    #[serde(rename = "pMult")]
    p_mult: f64,
    #[serde(rename = "muMult")]
    mu_mult: f64,
    #[serde(rename = "pCollector")]
    p_collector: f64,
    #[serde(rename = "muCollector")]
    mu_collector: f64,
    #[serde(rename = "pInert")]
    p_inert: f64,
}

#[derive(Debug, Deserialize)]
struct FixtureCase {
    name: String,
    occupancy: FixtureOccupancy,
    classes: FixtureClasses,
    #[serde(rename = "terminalGlobalMultiplier")]
    terminal_global_multiplier: f64,
}

#[derive(Debug, Deserialize)]
struct Fixture {
    cases: Vec<FixtureCase>,
}

const FIXTURE: &str =
    include_str!("../../tests/fixtures/persistent-hw.json");

fn to_cfg(case: &FixtureCase) -> PersistentGridHwConfig {
    PersistentGridHwConfig {
        occupancy: HoldAndWinConfig {
            total_cells: case.occupancy.total_cells,
            initial_respins: case.occupancy.initial_respins,
            base_chance: case.occupancy.base_chance,
            fill_bonus_cap: case.occupancy.fill_bonus_cap,
            expected_cell_value: 1.0,
            respin_reset_on_new: case.occupancy.respin_reset_on_new,
            grid_full_award: case.occupancy.grid_full_award,
            init_locked_cells: case.occupancy.init_locked_cells,
        },
        classes: CellClassDistribution {
            p_cash: case.classes.p_cash,
            mu_cash: case.classes.mu_cash,
            p_mult: case.classes.p_mult,
            mu_mult: case.classes.mu_mult,
            p_collector: case.classes.p_collector,
            mu_collector: case.classes.mu_collector,
            p_inert: case.classes.p_inert,
        },
        terminal_global_multiplier: case.terminal_global_multiplier,
    }
}

#[test]
fn fixture_loads() {
    let fx: Fixture = serde_json::from_str(FIXTURE).expect("fixture parses");
    assert_eq!(fx.cases.len(), 3);
    for case in &fx.cases {
        assert!(
            !case.name.is_empty(),
            "every fixture case must carry a name"
        );
        assert!(case.occupancy.total_cells > 0);
        assert!(case.occupancy.total_cells <= 100);
    }
}

#[test]
fn fixture_all_cases_produce_finite_payout() {
    let fx: Fixture = serde_json::from_str(FIXTURE).expect("fixture parses");
    for case in &fx.cases {
        let cfg = to_cfg(case);
        let res = solve_persistent_grid_hw(&cfg);
        assert!(
            res.expected_payout.is_finite(),
            "case {}: expected_payout not finite: {}",
            case.name,
            res.expected_payout
        );
        assert!(
            res.expected_payout >= 0.0,
            "case {}: expected_payout negative: {}",
            case.name,
            res.expected_payout
        );
        let sum: f64 = res.terminal_occupancy_pmf.iter().sum();
        assert!(
            (sum - 1.0).abs() < 1e-9,
            "case {}: PMF must sum to 1, got {sum}",
            case.name
        );
    }
}

#[test]
fn fixture_money_train_default_payout_increases_with_mult_class() {
    // Sanity vs. ablating the multiplier class.
    let fx: Fixture = serde_json::from_str(FIXTURE).expect("fixture parses");
    let case = fx
        .cases
        .iter()
        .find(|c| c.name == "money_train_default_5x3")
        .expect("default case present");

    let with_mult = solve_persistent_grid_hw(&to_cfg(case));

    let ablated_case = case.classes.clone_inert_mult();
    let ablated_cfg = PersistentGridHwConfig {
        occupancy: to_cfg(case).occupancy,
        classes: ablated_case.take_dist(),
        terminal_global_multiplier: case.terminal_global_multiplier,
    };
    let without_mult = solve_persistent_grid_hw(&ablated_cfg);
    assert!(
        with_mult.expected_payout > without_mult.expected_payout,
        "mult-class config ({}) should pay > ablated ({})",
        with_mult.expected_payout,
        without_mult.expected_payout
    );
}

#[test]
fn fixture_tree_of_life_terminal_global_multiplier_amplifies_payout() {
    let fx: Fixture = serde_json::from_str(FIXTURE).expect("fixture parses");
    let case = fx
        .cases
        .iter()
        .find(|c| c.name == "tree_of_life_6x6_with_terminal_reaper")
        .expect("tree-of-life case present");
    let cfg = to_cfg(case);
    let baseline_cfg = PersistentGridHwConfig {
        terminal_global_multiplier: 1.0,
        ..cfg.clone()
    };

    let with_mult = solve_persistent_grid_hw(&cfg);
    let baseline = solve_persistent_grid_hw(&baseline_cfg);

    // 1.5× multiplier should produce roughly 1.5× payout.
    let ratio = with_mult.expected_payout / baseline.expected_payout;
    assert!(
        (ratio - 1.5).abs() < 1e-6,
        "ratio={ratio} expected 1.5"
    );
}

#[test]
fn fixture_pure_cash_payout_equals_orb_count_times_value_no_full() {
    // For pure cash + no full grid bonus realised, payout must equal
    // E[orb_count] × μ_v + P(full) × full_award.
    let fx: Fixture = serde_json::from_str(FIXTURE).expect("fixture parses");
    let case = fx
        .cases
        .iter()
        .find(|c| c.name == "pure_cash_baseline_4x5")
        .expect("pure-cash case present");
    let cfg = to_cfg(case);
    let res = solve_persistent_grid_hw(&cfg);

    let expected =
        res.expected_orb_count * case.classes.mu_cash + res.grid_full_probability * case.occupancy.grid_full_award;
    assert!(
        (res.expected_payout - expected).abs() < 1e-9,
        "pure-cash payout {} != expected {}",
        res.expected_payout,
        expected
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

trait MultAblate {
    fn clone_inert_mult(&self) -> AblatedClasses;
}

struct AblatedClasses(FixtureClasses);

impl MultAblate for FixtureClasses {
    fn clone_inert_mult(&self) -> AblatedClasses {
        AblatedClasses(FixtureClasses {
            p_cash: self.p_cash,
            mu_cash: self.mu_cash,
            p_mult: 0.0,
            mu_mult: 1.0,
            p_collector: self.p_collector,
            mu_collector: self.mu_collector,
            p_inert: self.p_inert + self.p_mult, // mult mass folds into inert
        })
    }
}

impl AblatedClasses {
    fn take_dist(self) -> CellClassDistribution {
        CellClassDistribution {
            p_cash: self.0.p_cash,
            mu_cash: self.0.mu_cash,
            p_mult: self.0.p_mult,
            mu_mult: self.0.mu_mult,
            p_collector: self.0.p_collector,
            mu_collector: self.0.mu_collector,
            p_inert: self.0.p_inert,
        }
    }
}
