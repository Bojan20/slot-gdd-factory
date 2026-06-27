//! W4.3c — Feature dispatch integration tests.
//!
//! Validates that `run_features` actually fires the three IGT features
//! (FreeSpins / PickBonus / LinearProgressive) with the right
//! frequencies and that the resulting MC RTP closes the gap from base-
//! eval-only (0.70) toward Excel target (0.96).

use slot_sim::ir::{Feature, Ir};
use slot_sim::sim::Engine;

const IGT_PAR_001: &str =
    "../../games/fort-knox-wolf-run/out/igt.200-1775-001.slot-sim.ir.json";

#[test]
fn fk_pick_bonus_has_bernoulli_trigger() {
    let ir = Ir::load(IGT_PAR_001).expect("load");
    let pb = ir
        .features
        .iter()
        .find_map(|f| match f {
            Feature::PickBonus { trigger_prob, awards, .. } => Some((*trigger_prob, awards.clone())),
            _ => None,
        })
        .expect("PickBonus must exist");
    let (prob, awards) = pb;
    let p = prob.expect("FK uses Bernoulli trigger, not scatter");
    // Trigger prob ≈ 670005/100M = 0.00670005
    assert!(
        (p - 0.00670005).abs() < 1e-6,
        "trigger_prob {p} ≠ published 0.00670005",
    );
    assert!(!awards.is_empty(), "award list must be populated");
    // pays_coins is BM1 avg pay / 40 lines = 1063.67 / 40 ≈ 26.59
    let pays = awards[0].pays_coins;
    assert!(
        (pays - 26.59187).abs() < 1e-3,
        "BM=1 avg award per-line {pays} ≠ expected 26.592",
    );
}

#[test]
fn engine_rtp_within_acceptable_band() {
    let ir = Ir::load(IGT_PAR_001).expect("load");
    let engine = Engine::new(&ir);
    // 1M spins — enough to land within ±1% of true RTP.
    // Current implementation produces ~0.952 (IGT virtual-reel limitation
    // tracked as W4.3d). Acceptance band 0.92..0.99 catches regressions
    // without being so tight that natural MC variance flips it red.
    let stats = engine.run(1_000_000, 1, 0xCAFEBABE);
    let rtp = stats.rtp();
    assert!(
        (0.92..0.99).contains(&rtp),
        "RTP {rtp:.4} outside [0.92,0.99] band — likely feature regression",
    );
}

#[test]
fn features_actually_fire() {
    let ir = Ir::load(IGT_PAR_001).expect("load");
    let engine = Engine::new(&ir);
    // 200k spins → expect ~2k FS triggers and ~1.3k FK triggers.
    let stats = engine.run(200_000, 1, 0xABBA);
    // Free Spins triggers: scatter-based, observed ~1 in 100
    let fs_triggers: u64 = stats
        .event_count
        .iter()
        .filter(|(k, _)| k.starts_with("fs_trigger"))
        .map(|(_, v)| v)
        .sum();
    assert!(
        fs_triggers > 500 && fs_triggers < 5000,
        "FS triggers {} outside reasonable range for 200k spins",
        fs_triggers,
    );
    // Pick bonus triggers: Bernoulli at p=0.0067 → expect ~1340
    let pb_triggers: u64 = stats
        .event_count
        .iter()
        .filter(|(k, _)| k.starts_with("pick_bonus"))
        .map(|(_, v)| v)
        .sum();
    let expected = 200_000.0 * 0.00670005;
    let pb_low = (expected * 0.7) as u64;
    let pb_high = (expected * 1.3) as u64;
    assert!(
        pb_triggers > pb_low && pb_triggers < pb_high,
        "FK triggers {} outside [{}, {}] (expected ~{:.0})",
        pb_triggers, pb_low, pb_high, expected,
    );
}

#[test]
fn hit_freq_matches_excel_within_1pct() {
    let ir = Ir::load(IGT_PAR_001).expect("load");
    let engine = Engine::new(&ir);
    // 5M spins — Hit Freq converges to ±0.0005 statistically.
    let stats = engine.run(5_000_000, 1, 0xFEEDFACE);
    let observed = stats.hit_freq();
    let target = ir.meta.hit_frequency;
    let diff = (observed - target).abs();
    assert!(
        diff < 0.01,
        "Hit freq {observed:.5} vs Excel {target:.5}, diff {diff:.5} > 0.01",
    );
}
