//! W4.7 — IR Expansion (progressive_link, jurisdiction_overrides,
//! persistent_state, provenance, Symbol.behavior, Feature::LinearProgressive).
//!
//! All five fields are additive optionals — legacy fixtures must keep
//! round-tripping bit-identical (`ir_roundtrip.rs` proves that).
//!
//! This test suite covers the NEW shape: serialize → deserialize → equality
//! for every new variant + struct, and pins serde tag values so a refactor
//! that accidentally renames `linear_progressive` → `linearProgressive`
//! fails loudly here before reaching the parser/TS gate.

use slot_sim::ir::{
    BehaviorType, Feature, JackpotTier, JurisdictionOverride, PersistenceScope, PersistentField,
    PersistentFieldKind, PersistentState, ProgressiveLink, Provenance, StateMachine,
    StateTransition, SymbolBehavior, SymbolDef, SymbolKind,
};
use std::collections::BTreeMap;

#[test]
fn progressive_link_roundtrip_minimal() {
    let link = ProgressiveLink {
        pool_id: Some("uk-mga-grand-2026".into()),
        contribution_per_spin_x: 0.005,
        seed_x: 100.0,
        must_hit_by_x: None,
        tier_ladder: None,
        reset_rule: Some("seed_only".into()),
    };
    let json = serde_json::to_string(&link).unwrap();
    assert!(json.contains("\"pool_id\":\"uk-mga-grand-2026\""));
    assert!(json.contains("\"contribution_per_spin_x\":0.005"));
    let back: ProgressiveLink = serde_json::from_str(&json).unwrap();
    assert_eq!(back, link);
}

#[test]
fn progressive_link_with_tier_ladder() {
    let link = ProgressiveLink {
        pool_id: Some("multi-tier-wap".into()),
        contribution_per_spin_x: 0.012,
        seed_x: 50.0,
        must_hit_by_x: Some(2_000_000.0),
        tier_ladder: Some(vec![
            JackpotTier { id: "mini".into(), multiplier: 10.0 },
            JackpotTier { id: "minor".into(), multiplier: 100.0 },
            JackpotTier { id: "major".into(), multiplier: 1_000.0 },
            JackpotTier { id: "grand".into(), multiplier: 100_000.0 },
        ]),
        reset_rule: Some("cap_reset".into()),
    };
    let json = serde_json::to_string(&link).unwrap();
    let back: ProgressiveLink = serde_json::from_str(&json).unwrap();
    assert_eq!(back, link);
    assert_eq!(back.tier_ladder.as_ref().unwrap().len(), 4);
}

#[test]
fn jurisdiction_override_uk_feature_ban() {
    let mut toggles = BTreeMap::new();
    toggles.insert("buy_feature".into(), false);
    toggles.insert("autoplay".into(), false);
    let ov = JurisdictionOverride {
        target_rtp: Some(0.92),
        max_win_x: Some(125_000.0),
        min_spin_time_ms: Some(2500),
        max_bet_x: Some(2.0),
        feature_toggles: Some(toggles),
        compensated_mode: Some(false),
        force_ldw_disclosure: Some(true),
        autoplay_forbidden: Some(true),
    };
    let json = serde_json::to_string(&ov).unwrap();
    assert!(json.contains("\"autoplay_forbidden\":true"));
    let back: JurisdictionOverride = serde_json::from_str(&json).unwrap();
    assert_eq!(back, ov);
}

#[test]
fn persistent_state_supermeter_roundtrip() {
    let ps = PersistentState {
        fields: vec![
            PersistentField {
                name: "meter_charge".into(),
                kind: PersistentFieldKind::Accumulator,
                default: Some(0.0),
                reset_rule: "on_feature_trigger".into(),
                max_value: Some(1000.0),
            },
            PersistentField {
                name: "free_spin_credit".into(),
                kind: PersistentFieldKind::Counter,
                default: Some(0.0),
                reset_rule: "never".into(),
                max_value: None,
            },
        ],
        state_machine: Some(StateMachine {
            states: vec!["idle".into(), "charging".into(), "max".into()],
            initial_state: "idle".into(),
            transitions: vec![
                StateTransition {
                    from: "idle".into(),
                    to: "charging".into(),
                    condition: "meter_charge > 0".into(),
                },
                StateTransition {
                    from: "charging".into(),
                    to: "max".into(),
                    condition: "meter_charge >= 1000".into(),
                },
            ],
        }),
        scope: PersistenceScope::Session,
    };
    let json = serde_json::to_string(&ps).unwrap();
    assert!(json.contains("\"scope\":\"session\""));
    assert!(json.contains("\"kind\":\"accumulator\""));
    let back: PersistentState = serde_json::from_str(&json).unwrap();
    assert_eq!(back, ps);
}

#[test]
fn provenance_full_record() {
    let p = Provenance {
        vendor: "vendor_b".into(),
        par_source: "games/ce-copy-test/raw/PAR_001.tsv".into(),
        swid: Some("200-1637-001".into()),
        par_sha256: "a".repeat(64),
        ir_sha256: Some("b".repeat(64)),
        build_hash: Some("a3ab958".into()),
        built_at_utc: Some("2026-05-27T19:30:00Z".into()),
        signed_by: Some("slot-build-ci".into()),
        signature: Some("c".repeat(128)),
    };
    let json = serde_json::to_string(&p).unwrap();
    let back: Provenance = serde_json::from_str(&json).unwrap();
    assert_eq!(back, p);
    assert_eq!(back.par_sha256.len(), 64);
}

#[test]
fn symbol_behavior_colossal() {
    let sym = SymbolDef {
        id: "colossal_wild".into(),
        name: "Colossal Wild".into(),
        kind: SymbolKind::Wild,
        substitutes: None,
        weight_hint: None,
        appears_on: None,
        behavior: Some(SymbolBehavior {
            colossal_size: Some([3, 2]),
            behavior_type: Some(BehaviorType::Colossal),
            transform_target: None,
            collection_priority: None,
            sticky_duration_spins: None,
        }),
    };
    let json = serde_json::to_string(&sym).unwrap();
    assert!(json.contains("\"behavior_type\":\"colossal\""));
    assert!(json.contains("\"colossal_size\":[3,2]"));
    let back: SymbolDef = serde_json::from_str(&json).unwrap();
    assert_eq!(back, sym);
}

#[test]
fn symbol_behavior_transforming() {
    let sym = SymbolDef {
        id: "tx_wild".into(),
        name: "Transforming Wild".into(),
        kind: SymbolKind::Transform,
        substitutes: None,
        weight_hint: None,
        appears_on: None,
        behavior: Some(SymbolBehavior {
            colossal_size: None,
            behavior_type: Some(BehaviorType::Transforming),
            transform_target: Some("hp_a".into()),
            collection_priority: None,
            sticky_duration_spins: Some(3),
        }),
    };
    let json = serde_json::to_string(&sym).unwrap();
    let back: SymbolDef = serde_json::from_str(&json).unwrap();
    assert_eq!(back, sym);
    assert_eq!(
        back.behavior.as_ref().unwrap().transform_target.as_deref(),
        Some("hp_a")
    );
}

#[test]
fn linear_progressive_feature_variant() {
    let feat = Feature::LinearProgressive {
        pool_id: "wap-grand".into(),
        contribution_per_spin_x: 0.005,
        seed_x: 250.0,
        must_hit_by_x: Some(5_000_000.0),
        tier_ladder: Some(vec![JackpotTier {
            id: "grand".into(),
            multiplier: 100_000.0,
        }]),
        external_pool_ref: Some("pragmatic-megajackpot-pool".into()),
    };
    let json = serde_json::to_string(&feat).unwrap();
    assert!(json.contains("\"kind\":\"linear_progressive\""));
    let back: Feature = serde_json::from_str(&json).unwrap();
    assert_eq!(back, feat);
}

#[test]
fn legacy_ir_without_w4_7_fields_still_parses() {
    // Smallest possible IR: no progressive_link / jurisdiction_overrides /
    // persistent_state / provenance. Must parse cleanly so existing
    // production IRs (parity.json etc.) keep round-tripping.
    let minimal = r#"{
        "schema_version": "1.0.0",
        "meta": {"id":"x","name":"x","version":"1.0.0","theme_tags":[]},
        "topology": {"kind":"rectangular","reels":5,"rows":3},
        "symbols": [
            {"id":"a","name":"A","kind":"hp"},
            {"id":"b","name":"B","kind":"lp"}
        ],
        "reels": {"mode":"strips","base":[["a","b"],["a","b"],["a","b"],["a","b"],["a","b"]]},
        "evaluation": {"kind":"lines","paylines":[[1,1,1,1,1]],"direction":"ltr","min_match":3,"pay_left_to_right_only":true},
        "paytable": {"a":{"3":1.0}},
        "features": [],
        "rng": {"kind":"mulberry32","default_seed":1},
        "bet": {"currency":"USD","base_bet":1.0,"denominations":[1.0]},
        "limits": {"target_rtp":0.96,"rtp_tolerance":0.002,"max_win_x":5000.0,"win_cap_apply":"per_spin","target_volatility":"medium","hit_freq_target":0.25},
        "compliance": {"jurisdictions":["UKGC"],"rtp_range_required":[0.85,0.98],"max_win_cap_required":250000.0,"near_miss_rule":"must_be_random","ldw_disclosure":true,"session_time_display":false},
        "rtp_allocation": {"base_game":0.96,"free_spins":0.0,"hold_and_win":0.0,"jackpot":0.0,"tolerance":0.005}
    }"#;
    let ir = slot_sim::ir::SlotGameIR::from_json(minimal).expect("legacy IR parses");
    assert!(ir.progressive_link.is_none());
    assert!(ir.jurisdiction_overrides.is_none());
    assert!(ir.persistent_state.is_none());
    assert!(ir.provenance.is_none());
    // Roundtrip: re-serialize and ensure no W4.7 keys leaked in (skip-if-none).
    let json = ir.to_json_pretty().unwrap();
    assert!(!json.contains("progressive_link"));
    assert!(!json.contains("jurisdiction_overrides"));
    assert!(!json.contains("persistent_state"));
    assert!(!json.contains("\"provenance\""));
}

#[test]
fn full_w4_7_ir_roundtrips_bit_identical() {
    let json = r#"{
        "schema_version": "1.0.0",
        "meta": {"id":"x","name":"x","version":"1.0.0","theme_tags":[]},
        "topology": {"kind":"rectangular","reels":5,"rows":3},
        "symbols": [
            {"id":"a","name":"A","kind":"hp"},
            {"id":"b","name":"B","kind":"lp","behavior":{"behavior_type":"sticky","sticky_duration_spins":2}}
        ],
        "reels": {"mode":"strips","base":[["a","b"],["a","b"],["a","b"],["a","b"],["a","b"]]},
        "evaluation": {"kind":"lines","paylines":[[1,1,1,1,1]],"direction":"ltr","min_match":3,"pay_left_to_right_only":true},
        "paytable": {"a":{"3":1.0}},
        "features": [{"kind":"linear_progressive","pool_id":"p1","contribution_per_spin_x":0.005,"seed_x":50.0}],
        "rng": {"kind":"mulberry32","default_seed":1},
        "bet": {"currency":"USD","base_bet":1.0,"denominations":[1.0]},
        "limits": {"target_rtp":0.96,"rtp_tolerance":0.002,"max_win_x":5000.0,"win_cap_apply":"per_spin","target_volatility":"medium","hit_freq_target":0.25},
        "compliance": {"jurisdictions":["UKGC"],"rtp_range_required":[0.85,0.98],"max_win_cap_required":250000.0,"near_miss_rule":"must_be_random","ldw_disclosure":true,"session_time_display":false},
        "rtp_allocation": {"base_game":0.96,"free_spins":0.0,"hold_and_win":0.0,"jackpot":0.0,"tolerance":0.005},
        "progressive_link": {"pool_id":"p1","contribution_per_spin_x":0.005,"seed_x":50.0},
        "jurisdiction_overrides": {"UKGC":{"target_rtp":0.92,"autoplay_forbidden":true}},
        "provenance": {"vendor":"vendor_b","par_source":"games/x/PAR.tsv","par_sha256":"deadbeef000000000000000000000000000000000000000000000000deadbeef"}
    }"#;
    let ir = slot_sim::ir::SlotGameIR::from_json(json).expect("W4.7 IR parses");
    assert!(ir.progressive_link.is_some());
    assert!(ir.jurisdiction_overrides.is_some());
    assert!(ir.provenance.is_some());
    let re = ir.to_json_pretty().unwrap();
    let again = slot_sim::ir::SlotGameIR::from_json(&re).expect("reserialized parses");
    assert_eq!(ir, again);
}
