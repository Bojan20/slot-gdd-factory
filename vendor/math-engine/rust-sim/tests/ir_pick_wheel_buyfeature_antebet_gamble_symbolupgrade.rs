//! W152 P0-3 round 2 — IR adapter Pick / Wheel / BuyFeature / AnteBet /
//! Gamble / SymbolUpgrade integration.
//!
//! Reads the same fixture as the TS counterpart
//! (`tests/ir_pick_wheel_buyfeature_antebet_gamble_symbolupgrade.test.ts`)
//! so the TS↔Rust parity gate extends to all six new feature kinds. Any
//! drift in either adapter's mapping shows up here as a failed equality
//! assertion.

use slot_sim::config::{GambleTieResolution, GambleType, GameConfig};
use slot_sim::ir::{ir_to_game_config, SlotGameIR};
use std::path::PathBuf;

fn fixture_path() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("..");
    p.push("tests");
    p.push("fixtures");
    p.push("pick-wheel-buyfeature-antebet-gamble-symbolupgrade.json");
    p
}

fn load() -> SlotGameIR {
    let raw = std::fs::read_to_string(fixture_path())
        .expect("pick-wheel-...-symbolupgrade.json fixture must exist");
    SlotGameIR::from_json(&raw).expect("fixture must parse")
}

fn convert() -> GameConfig {
    ir_to_game_config(&load()).expect("conversion must succeed")
}

// ─── Pick ────────────────────────────────────────────────────────────────

#[test]
fn pick_config_extracted_with_weighted_pool() {
    let cfg = convert();
    let pick = cfg.pick.as_ref().expect("pick config must be set");
    assert_eq!(pick.prize_pool.len(), 4);

    // First entry — MINI
    assert_eq!(pick.prize_pool[0].id, "MINI");
    assert!((pick.prize_pool[0].weight - 50.0).abs() < f64::EPSILON);
    assert!((pick.prize_pool[0].pay_multiplier - 10.0).abs() < f64::EPSILON);

    // Last entry — GRAND (large pay)
    assert_eq!(pick.prize_pool[3].id, "GRAND");
    assert!((pick.prize_pool[3].weight - 5.0).abs() < f64::EPSILON);
    assert!((pick.prize_pool[3].pay_multiplier - 1000.0).abs() < f64::EPSILON);

    // Weights sum to 100 — verifies fidelity.
    let total: f64 = pick.prize_pool.iter().map(|p| p.weight).sum();
    assert!((total - 100.0).abs() < f64::EPSILON);
}

// ─── Wheel ───────────────────────────────────────────────────────────────

#[test]
fn wheel_config_extracted_with_segments() {
    let cfg = convert();
    let wheel = cfg.wheel.as_ref().expect("wheel config must be set");
    assert_eq!(wheel.segments.len(), 5);
    assert_eq!(wheel.segments[0].id, "x1");
    assert_eq!(wheel.segments[4].id, "x50");
    assert!((wheel.segments[4].pay_multiplier - 50.0).abs() < f64::EPSILON);
}

// ─── BuyFeature ──────────────────────────────────────────────────────────

#[test]
fn buy_feature_config_extracted_with_offers() {
    let cfg = convert();
    let bf = cfg.buy_feature.as_ref().expect("buy_feature must be set");
    assert_eq!(bf.offers.len(), 2);
    assert_eq!(bf.offers[0].id, "FS");
    assert!((bf.offers[0].cost_x - 100.0).abs() < f64::EPSILON);
    assert_eq!(bf.offers[0].guaranteed, "free_spins");
    assert_eq!(bf.offers[1].id, "SUPER_FS");
    assert!((bf.offers[1].cost_x - 250.0).abs() < f64::EPSILON);
    assert_eq!(bf.offers[1].guaranteed, "super_free_spins");
}

// ─── AnteBet ─────────────────────────────────────────────────────────────

#[test]
fn ante_bet_config_extracted_with_default_disabled() {
    let cfg = convert();
    let ante = cfg.ante_bet.as_ref().expect("ante_bet must be set");
    assert!((ante.extra_multiplier - 1.25).abs() < f64::EPSILON);
    assert!(!ante.enabled_by_default);
}

// ─── Gamble ──────────────────────────────────────────────────────────────

#[test]
fn gamble_config_extracted_with_type_and_tie() {
    let cfg = convert();
    let g = cfg.gamble.as_ref().expect("gamble must be set");
    assert_eq!(g.ty, GambleType::RedBlack);
    assert_eq!(g.max_steps, 5);
    assert_eq!(g.tie_resolution, GambleTieResolution::Push);
}

// ─── SymbolUpgrade ───────────────────────────────────────────────────────

#[test]
fn symbol_upgrade_config_extracted() {
    let cfg = convert();
    let u = cfg.symbol_upgrade.as_ref().expect("symbol_upgrade must be set");
    assert_eq!(u.from, "S_LP1");
    assert_eq!(u.to, "S_HP3");
    assert!((u.probability - 0.05).abs() < f64::EPSILON);
}

// ─── Round-trip serialisation parity ─────────────────────────────────────

#[test]
fn extracted_configs_round_trip_to_json_and_back() {
    let cfg = convert();
    let json = serde_json::to_string(&cfg).expect("serialise");
    let cfg2: GameConfig = serde_json::from_str(&json).expect("deserialise");

    // Pick
    let p1 = cfg.pick.as_ref().unwrap();
    let p2 = cfg2.pick.as_ref().unwrap();
    assert_eq!(p1.prize_pool.len(), p2.prize_pool.len());
    for (a, b) in p1.prize_pool.iter().zip(p2.prize_pool.iter()) {
        assert_eq!(a.id, b.id);
        assert!((a.weight - b.weight).abs() < f64::EPSILON);
        assert!((a.pay_multiplier - b.pay_multiplier).abs() < f64::EPSILON);
    }

    // Wheel
    assert_eq!(
        cfg.wheel.as_ref().unwrap().segments.len(),
        cfg2.wheel.as_ref().unwrap().segments.len()
    );

    // BuyFeature
    assert_eq!(
        cfg.buy_feature.as_ref().unwrap().offers.len(),
        cfg2.buy_feature.as_ref().unwrap().offers.len()
    );

    // Ante
    assert_eq!(
        cfg.ante_bet.as_ref().unwrap().extra_multiplier,
        cfg2.ante_bet.as_ref().unwrap().extra_multiplier
    );

    // Gamble
    assert_eq!(
        cfg.gamble.as_ref().unwrap().ty,
        cfg2.gamble.as_ref().unwrap().ty
    );
    assert_eq!(
        cfg.gamble.as_ref().unwrap().tie_resolution,
        cfg2.gamble.as_ref().unwrap().tie_resolution
    );

    // SymbolUpgrade
    assert_eq!(
        cfg.symbol_upgrade.as_ref().unwrap().from,
        cfg2.symbol_upgrade.as_ref().unwrap().from
    );
    assert_eq!(
        cfg.symbol_upgrade.as_ref().unwrap().to,
        cfg2.symbol_upgrade.as_ref().unwrap().to
    );
}

// ─── Wire-format parity check (snake_case enum variants) ─────────────────

#[test]
fn gamble_json_uses_snake_case_for_type_and_tie() {
    let cfg = convert();
    let g = cfg.gamble.as_ref().unwrap();
    let json = serde_json::to_string(g).unwrap();
    // Confirms snake_case rename_all + #[serde(rename = "type")] survive
    // round-trip through the adapter — required for cross-language parity.
    assert!(json.contains(r#""type":"red_black""#));
    assert!(json.contains(r#""tie_resolution":"push""#));
}

// ─── Skip-serialise on absent features ───────────────────────────────────

#[test]
fn absent_features_are_skipped_in_json() {
    // GameConfig::default() has all the new optionals as None; the
    // serialised JSON must therefore omit the keys entirely (matches
    // TS adapter `...(x !== undefined ? { x } : {})` behaviour).
    let cfg = GameConfig::default();
    let json = serde_json::to_string(&cfg).unwrap();
    // None of the keys are present.
    for key in [
        "\"pick\":",
        "\"wheel\":",
        "\"buy_feature\":",
        "\"ante_bet\":",
        "\"gamble\":",
        "\"symbol_upgrade\":",
    ] {
        assert!(
            !json.contains(key),
            "key {key} should be skipped when None, found in JSON: {json}"
        );
    }
}
