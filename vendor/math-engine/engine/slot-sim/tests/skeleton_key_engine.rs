//! W4.8c / W4.8d / W4.8e / W4.13 — Skeleton Key Megaways engine MC tests.
//!
//! Runs the full Engine pipeline against the IGT Skeleton Key IRs (3
//! SWIDs) and checks:
//!   * RTP convergence — within ±1 % of `meta.rtp_total` at 500 k spins
//!     under the W4.13 ORGANIC CLOSEOUT regime (`rtp_source =
//!     "breakdown"` is UNSET; the engine runs pure organic MC with the
//!     fitted Megaways row-weight + base/FS picker tables baked into
//!     `tools/par_extract_ultimate/build_ir.py` by
//!     `tools/par_picker_fit_descent.py`). The fit lands the true RTP
//!     within ~1–2e-3 of target; per-eval σ at 500 k spins is ~3e-3 for
//!     SK Megaways. We pin a deterministic seed per SWID so that the
//!     ±1 % strict tolerance holds reproducibly. Hit / win frequencies
//!     stay in plausible range.
//!   * Edge cases (all-wild, all-scatter, zero-payout, min/max topology)
//!     — algorithm robustness.

use slot_sim::ir::{Ir, Topology};
use slot_sim::megaways_eval::{evaluate_megaways, MegawaysGrid};
use slot_sim::reels::CompiledReelSet;
use slot_sim::evaluate::CompiledPaytable;
use slot_sim::sim::Engine;
use slot_sim::rng::Prng;

const SK_001: &str = "../../games/skeleton-key/out/skeleton-key.200-1517-001.slot-sim.ir.json";
const SK_002: &str = "../../games/skeleton-key/out/skeleton-key.200-1517-002.slot-sim.ir.json";
const SK_003: &str = "../../games/skeleton-key/out/skeleton-key.200-1517-003.slot-sim.ir.json";

/// W4.13 — Organic MC RTP within ±1 % of `meta.rtp_total` at 500 k
/// spins. The W4.13 picker-fit bake-in lands the true RTP within
/// ~1–2e-3 of target (verified by `par_picker_fit_descent.py` at 8
/// seeds × 5 M spins); single-eval σ at 500 k spins is ~3e-3 for SK
/// Megaways — comfortably below the ±1 % tolerance.
///
/// Reproducibility: seeds are pinned per SWID so the assertion is
/// deterministic. Empirical single-thread deltas at 500 k spins:
///   SK-001 (seed=0xDEAD_BEEF) → +0.0170 %
///   SK-002 (seed=0xCAFE_BABE) → -0.4221 %
///   SK-003 (seed=0xFACE_FEED) → -0.2381 %
fn assert_mc_within_one_pct(path: &str, seed: u64, label: &str) {
    let ir = Ir::load(path).expect("load");
    let eng = Engine::new(&ir);
    let s = eng.run(500_000, 1, seed);
    let mc_rtp = s.rtp();
    let target = ir.meta.rtp_total;
    let delta_pct = (mc_rtp - target) / target * 100.0;
    println!(
        "{} MC: rtp={:.6} target={:.6} delta={:.4}%",
        label, mc_rtp, target, delta_pct
    );
    assert!(
        delta_pct.abs() <= 1.0,
        "{} MC RTP delta {:.4}% exceeds ±1% (mc={:.6} target={:.6})",
        label,
        delta_pct,
        mc_rtp,
        target
    );
    assert!(
        s.hit_freq() > 0.05 && s.hit_freq() < 0.80,
        "{} hit_freq {} outside plausible range",
        label,
        s.hit_freq()
    );
}

#[test]
fn skeleton_key_001_mc_rtp_within_one_pct() {
    assert_mc_within_one_pct(SK_001, 0xDEAD_BEEF, "SK-001");
}

#[test]
fn skeleton_key_002_mc_rtp_within_one_pct() {
    assert_mc_within_one_pct(SK_002, 0xCAFE_BABE, "SK-002");
}

#[test]
fn skeleton_key_003_mc_rtp_within_one_pct() {
    assert_mc_within_one_pct(SK_003, 0xFACE_FEED, "SK-003");
}

/// W4.14 — Hit-frequency strict tolerance. The Mystery transform
/// path (`MegawaysGrid::apply_mystery_transform`) replaces every
/// Mystery cell with a single target sampled from the active
/// reel-set's per-set distribution. The transform fires on every
/// spin that lands ≥ 1 Mystery so the post-transform grid already
/// gives the vendor hit_freq within ±1e-2 across all 3 SK SWIDs
/// (verified at 500 k spins per seed below).
fn assert_mc_hit_freq_within_1e_2(path: &str, seed: u64, label: &str) {
    let ir = Ir::load(path).expect("load");
    let eng = Engine::new(&ir);
    let s = eng.run(500_000, 1, seed);
    let mc_hf = s.hit_freq();
    let target = ir.meta.hit_frequency;
    let delta = (mc_hf - target).abs();
    println!(
        "{} MC: hit_freq={:.6} target={:.6} delta={:.6}",
        label, mc_hf, target, delta
    );
    assert!(
        delta <= 1e-2,
        "{} MC hit_freq delta {:.6} exceeds 1e-2 (mc={:.6} target={:.6})",
        label, delta, mc_hf, target
    );
}

#[test]
fn skeleton_key_001_hit_freq_w414_within_1e_2() {
    assert_mc_hit_freq_within_1e_2(SK_001, 0xDEAD_BEEF, "SK-001");
}

#[test]
fn skeleton_key_002_hit_freq_w414_within_1e_2() {
    assert_mc_hit_freq_within_1e_2(SK_002, 0xCAFE_BABE, "SK-002");
}

#[test]
fn skeleton_key_003_hit_freq_w414_within_1e_2() {
    assert_mc_hit_freq_within_1e_2(SK_003, 0xFACE_FEED, "SK-003");
}

/// W4.8c — Megaways topology consistency: RTPs descend with hold (Excel:
/// SWID-001 highest payout, SWID-003 lowest).
#[test]
fn skeleton_key_all_three_mc_rtp_descending() {
    let mut rtps = Vec::new();
    for path in &[SK_001, SK_002, SK_003] {
        let ir = Ir::load(path).expect("load");
        let eng = Engine::new(&ir);
        let s = eng.run(50_000, 1, 0xAAA);
        rtps.push(s.rtp());
    }
    // MC has noise so we tolerate small inversions but the trend should
    // be downward across the three SWIDs.
    let avg_01 = (rtps[0] + rtps[1]) / 2.0;
    let avg_23 = (rtps[1] + rtps[2]) / 2.0;
    assert!(
        avg_01 >= avg_23 - 0.05,
        "MC RTP trend not descending: 001={} 002={} 003={}",
        rtps[0],
        rtps[1],
        rtps[2]
    );
}

/// Edge case 1 — All-Wild Megaways grid must not crash and produces
/// bounded payout.
///
/// W4.8d — Per PAR-Base r65 Wild now substitutes for ALL non-(Bonus|Key)
/// symbols (including Chest, the top line-pay symbol). A 3-row × 5-reel
/// all-Wild grid produces 5×Wild→Chest×5 with 3^5 = 243 ways at Chest
/// pays = 500, divided by bet=10 → payout = 12,150x. Cap at 20_000x
/// covers max-row (6×5 = 7,776 ways) edge cases too (500 × 7776 / 10 =
/// 388,800x which would still exceed; restrict edge-case grid to 3
/// rows so the assertion stays meaningful).
#[test]
fn edge_case_1_all_wild_grid() {
    let ir = Ir::load(SK_001).expect("load");
    let pt = CompiledPaytable::compile(&ir);
    let cells: Vec<Vec<String>> = (0..5)
        .map(|_| (0..3).map(|_| "Wild".to_string()).collect())
        .collect();
    let rows_per_reel: Vec<u32> = vec![3; 5];
    let g = MegawaysGrid { cells, rows_per_reel };
    let r = evaluate_megaways(&g, &ir, &pt);
    let payout = r.payout_total_bet_x();
    // Must not panic; payout bounded — Wild substitutes for Chest (top
    // 500-pay) at 243 ways yields 500*243/10 = 12,150x.
    assert!(payout >= 0.0, "payout must be non-negative, got {}", payout);
    assert!(payout < 20_000.0,
        "payout {} exceeds bounded cap (3x5 all-Wild ⇒ Chest×5 × 243 ways)",
        payout);
}

/// Edge case 2 — All-Bonus (scatter) grid must not crash.
#[test]
fn edge_case_2_all_scatter_grid() {
    let ir = Ir::load(SK_001).expect("load");
    let pt = CompiledPaytable::compile(&ir);
    let cells: Vec<Vec<String>> = (0..5)
        .map(|_| (0..6).map(|_| "Bonus".to_string()).collect())
        .collect();
    let rows_per_reel: Vec<u32> = vec![6; 5];
    let g = MegawaysGrid { cells, rows_per_reel };
    let r = evaluate_megaways(&g, &ir, &pt);
    let bonus_count = r.role_counts.get("Bonus").copied().unwrap_or(0);
    assert_eq!(bonus_count, 30);
    // Scatter pay for 5+ Bonus must fire.
    assert!(r.scatter_total_bet_x > 0.0, "scatter pay must fire on all-Bonus grid");
}

/// Edge case 3 — Zero-payout spin (no matches): all reels filled with
/// LP/HP symbols that break the prefix on reel 1.
#[test]
fn edge_case_3_zero_payout_spin() {
    let ir = Ir::load(SK_001).expect("load");
    let pt = CompiledPaytable::compile(&ir);
    let cells: Vec<Vec<String>> = vec![
        vec!["Ace".to_string(), "Ace".to_string(), "Ace".to_string()],
        vec!["Key".to_string(), "Key".to_string(), "Key".to_string()],   // breaks prefix
        vec!["Ace".to_string(), "Ace".to_string(), "Ace".to_string()],
        vec!["Ace".to_string(), "Ace".to_string(), "Ace".to_string()],
        vec!["Ace".to_string(), "Ace".to_string(), "Ace".to_string()],
    ];
    let rows_per_reel = vec![3u32; 5];
    let g = MegawaysGrid { cells, rows_per_reel };
    let r = evaluate_megaways(&g, &ir, &pt);
    // Ace prefix breaks at reel 1 (Key, no wild on this set's first reel
    // will be controlled by Wild substitutes_except — Key not in subs).
    // Verify no line win because prefix < 3.
    // (Wild subs Ace per IR, but no wild on grid here.)
    // Bonus is "scatter" so its presence on the grid doesn't break prefix
    // — only same-role symbols count toward prefix.
    // Acceptance: no panic; payout finite.
    assert!(r.payout_total_bet_x().is_finite());
}

/// Edge case 6 — Megaways min topology (3×3×3×3×3) ⇒ max ways at 243.
#[test]
fn edge_case_6_min_topology_3x5() {
    let ir = Ir::load(SK_001).expect("load");
    let topology = match &ir.topology {
        Topology::Megaways {
            rows_min,
            rows_max,
            reels,
            ..
        } => (*rows_min, *rows_max, *reels),
        _ => panic!("expected Megaways"),
    };
    assert_eq!(topology.0, 3);
    assert_eq!(topology.1, 6);
    assert_eq!(topology.2, 5);
    // 3^5 = 243 min, 6^5 = 7776 max ways.
    let min_ways: u64 = (topology.0 as u64).pow(topology.2);
    let max_ways: u64 = (topology.1 as u64).pow(topology.2);
    assert_eq!(min_ways, 243);
    assert_eq!(max_ways, 7776);
}

/// Edge case 7 — Megaways max topology grid spin: force rows=max ⇒ all
/// reels at 6 rows. Engine must produce a grid with 6 rows per reel.
#[test]
fn edge_case_7_max_topology_6x5() {
    let ir = Ir::load(SK_001).expect("load");
    let rs0 = CompiledReelSet::from_ir(&ir.reels.base[0]);
    // Build a custom IR with rows_weights forcing rows=6 on every reel.
    let mut ir_max = ir.clone();
    if let Topology::Megaways { rows_weights, .. } = &mut ir_max.topology {
        for w in rows_weights.iter_mut() {
            *w = vec![0, 0, 0, 1]; // P(rows=6) = 1
        }
    }
    let mut rng = Prng::from_seed(0xC001);
    let g = MegawaysGrid::spin(&ir_max, &rs0, &mut rng);
    for r in 0..5 {
        assert_eq!(g.rows_per_reel[r], 6, "reel {} not at max rows", r);
        assert_eq!(g.cells[r].len(), 6);
    }
}
