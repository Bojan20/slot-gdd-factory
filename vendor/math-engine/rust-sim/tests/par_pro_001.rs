//! PAR-001 — Tier-1 PAR Sheet sections (sign-off, reel config, paytable + per-pay-rule audit trail).
//!
//! Covers the five atoms (A1–A5) of master TODO §2:
//!   A1 — `SignOffSection` + `Signature` serde roundtrip & rendering
//!   A2 — `ReelConfigSection::from_ir` for both Weighted and Strips ReelSets,
//!         total-cycle computation and overflow guard
//!   A3 — `PaytableSection::from_ir` n-of-a-kind matrix extraction
//!         (kind, substitutes, payouts) ordered by symbol id
//!   A4 — `PARGenerator::generate_with_context` accepts a `PARBuildContext`
//!         and the legacy 14-arg shim still produces a Faza-8-compatible PARSheet
//!         (no new sections when `ir = None`)
//!   A5 — `PaytableSection.pay_rule_rtp` is populated with one key per
//!         `{symbol}_{n}oak` pair from the IR paytable (MLAgent gap N)
//!
//! No section is allowed to break the JSON roundtrip — old readers must
//! still parse new sheets (sections are `Option`).

use slot_sim::ir::SlotGameIR;
use slot_sim::par::{
    PARBuildContext, PARGenerator, PARSheet, ReelConfigSection, ReelMode, Signature,
    SignOffSection,
};
use slot_sim::stats::{AtomicStats, MultiSeedStats, PARMetrics, SeedStats};
use std::path::PathBuf;
use std::sync::atomic::Ordering;

// ─── Shared fixtures ─────────────────────────────────────────────────────────

fn fixture_path(name: &str) -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("..");
    p.push("tests");
    p.push("fixtures");
    p.push(name);
    p
}

fn load_parity_base_only_ir() -> SlotGameIR {
    let raw = std::fs::read_to_string(fixture_path("parity-base-only.json"))
        .expect("parity-base-only.json fixture must exist");
    SlotGameIR::from_json(&raw).expect("parity fixture must parse")
}

fn make_stats() -> AtomicStats {
    let s = AtomicStats::new();
    s.total_spins.store(1_000_000, Ordering::Relaxed);
    s.total_wagered.store(1_000_000, Ordering::Relaxed);
    s.total_won.store(960_000, Ordering::Relaxed);
    s.total_base_won.store(600_000, Ordering::Relaxed);
    s.total_fs_won.store(360_000, Ordering::Relaxed);
    s.winning_spins.store(330_000, Ordering::Relaxed);
    s
}

fn make_par_metrics(stats: &AtomicStats) -> PARMetrics {
    let rtps: [f64; 20] = [
        96.00, 96.02, 95.98, 96.01, 95.99, 96.03, 95.97, 96.00, 96.01, 95.99, 96.00, 95.98, 96.02,
        96.01, 95.99, 96.00, 96.02, 95.98, 96.01, 95.99,
    ];
    let multi = MultiSeedStats::from_seeds(
        rtps.iter()
            .map(|&rtp| SeedStats {
                spins: 50_000,
                wagered: 50_000,
                won: (50_000.0 * rtp / 100.0) as i64,
                rtp,
            })
            .collect(),
    );
    PARMetrics::from_stats(stats, &multi, 1)
}

fn make_context<'a>(
    stats: &'a AtomicStats,
    par_m: &'a PARMetrics,
    ir: Option<&'a SlotGameIR>,
    sign_off: Option<SignOffSection>,
) -> PARBuildContext<'a> {
    PARBuildContext {
        stats,
        par: par_m,
        jackpots: vec![],
        game_id: "par-001-test".to_string(),
        game_version: "1.0.0".to_string(),
        target_rtp: 96.0,
        rtp_tolerance: 0.5,
        max_win_cap: 5000.0,
        jurisdictions: vec!["MGA".to_string(), "UKGC".to_string()],
        rtp_range_required: [85.0, 99.0],
        near_miss_rule: "must_be_random".to_string(),
        ldw_disclosure: true,
        session_time_display: true,
        seeds_used: 20,
        ir,
        sign_off,
    }
}

fn make_par_sheet_with_ir(ir: &SlotGameIR, sign_off: Option<SignOffSection>) -> PARSheet {
    let stats = make_stats();
    let par_m = make_par_metrics(&stats);
    let ctx = make_context(&stats, &par_m, Some(ir), sign_off);
    PARGenerator::generate_with_context(ctx)
}

// ─── A1 — SignOffSection roundtrip ───────────────────────────────────────────

#[test]
fn signoff_roundtrip() {
    let ir = load_parity_base_only_ir();
    let so = SignOffSection {
        mathematician: Some("Bojan Petković".to_string()),
        mathematician_signed_at_utc: Some("2026-05-24T20:00:00Z".to_string()),
        approved_by: Some("Regulator XYZ".to_string()),
        approved_at_utc: Some("2026-05-25T09:00:00Z".to_string()),
        signatures: vec![Signature {
            name: "Bojan Petković".to_string(),
            role: "Mathematician".to_string(),
            sha256_signature: "deadbeefcafefood0123456789abcdef0123456789abcdef0123456789abcdef"
                .to_string(),
        }],
    };
    let par = make_par_sheet_with_ir(&ir, Some(so.clone()));

    let stored = par
        .sign_off
        .as_ref()
        .expect("sign_off must be populated when supplied via context");
    assert_eq!(stored.mathematician.as_deref(), Some("Bojan Petković"));
    assert_eq!(stored.approved_by.as_deref(), Some("Regulator XYZ"));
    assert_eq!(stored.signatures.len(), 1);

    // JSON roundtrip preserves the section bit-for-bit.
    let json = serde_json::to_string_pretty(&par).expect("PARSheet → JSON must serialize");
    let back: PARSheet = serde_json::from_str(&json).expect("JSON → PARSheet must deserialize");
    let back_so = back.sign_off.as_ref().expect("sign_off must roundtrip");
    assert_eq!(&back_so.signatures[0].sha256_signature, &so.signatures[0].sha256_signature);

    // Pretty-print must not panic with a populated sign-off block.
    PARGenerator::print(&par);
}

// ─── A2 — Reel config + total cycle ──────────────────────────────────────────

#[test]
fn reel_config_cycle_product() {
    let ir = load_parity_base_only_ir();
    let rc = ReelConfigSection::from_ir(&ir);

    // parity-base-only fixture has 5 reels, weighted, each summing to 8+7+6+2+3+1 = 27 stops.
    assert_eq!(rc.reels.len(), 5, "expected 5 reels from fixture");
    for r in &rc.reels {
        assert_eq!(r.mode, ReelMode::Weighted);
        assert_eq!(r.length, 27, "each reel weights sum to 27");
        assert_eq!(
            r.symbol_counts.get("S_WILD").copied(),
            Some(1),
            "WILD weight 1 must round to 1 stop"
        );
    }
    let expected_cycle: u64 = 27u64.pow(5); // 14_348_907
    assert_eq!(rc.total_cycle, expected_cycle);
    assert!(!rc.total_cycle_overflow);

    let par = make_par_sheet_with_ir(&ir, None);
    let stored = par.reel_config.as_ref().expect("reel_config must be populated");
    assert_eq!(stored.total_cycle, expected_cycle);
}

#[test]
fn reel_config_overflow_guarded() {
    use slot_sim::ir::*;
    use std::collections::BTreeMap;

    // Synthesize an IR with absurdly large strips to trigger u64 overflow on ∏.
    // 6 reels × 100_000 = 1e30 → saturates to u64::MAX with overflow flag.
    let mut ir = load_parity_base_only_ir();
    let mut huge_strips: Vec<Vec<String>> = Vec::new();
    for _ in 0..6 {
        huge_strips.push(vec!["S_LP1".to_string(); 100_000]);
    }
    ir.reels = ReelSet::Strips {
        base: huge_strips,
        free_spins: None,
    };
    // Topology must reflect 6 reels for cross-consistency (not strictly enforced here).
    ir.topology = Topology::Rectangular { reels: 6, rows: 3 };
    let rc = ReelConfigSection::from_ir(&ir);
    assert!(
        rc.total_cycle_overflow,
        "6 × 100_000 strips must overflow u64"
    );
    assert_eq!(rc.total_cycle, u64::MAX);
    // Sanity: symbol_counts populated regardless of overflow.
    for r in &rc.reels {
        assert_eq!(r.length, 100_000);
        assert_eq!(r.symbol_counts.get("S_LP1").copied(), Some(100_000));
    }
    // Silence unused-import warning on BTreeMap in case future edits drop usage.
    let _: BTreeMap<&str, u32> = BTreeMap::new();
}

// ─── A3 — Paytable matrix matches IR ─────────────────────────────────────────

#[test]
fn paytable_matches_ir() {
    let ir = load_parity_base_only_ir();
    let par = make_par_sheet_with_ir(&ir, None);
    let pt = par.paytable.as_ref().expect("paytable must be populated");

    // The fixture defines 5 paying symbols (S_LP1..3, S_HP1..2) — Wild has no row in paytable.
    assert_eq!(pt.rows.len(), 5);

    // Rows are sorted alphabetically by symbol id.
    let symbols: Vec<&str> = pt.rows.iter().map(|r| r.symbol.as_str()).collect();
    assert_eq!(symbols, vec!["S_HP1", "S_HP2", "S_LP1", "S_LP2", "S_LP3"]);

    // S_HP1 must have payouts for 3/4/5 of a kind = 3 / 12 / 63 from the fixture.
    let hp1 = pt.rows.iter().find(|r| r.symbol == "S_HP1").unwrap();
    assert_eq!(hp1.kind, "hp");
    assert_eq!(hp1.payouts.get(&3).copied(), Some(3.0));
    assert_eq!(hp1.payouts.get(&4).copied(), Some(12.0));
    assert_eq!(hp1.payouts.get(&5).copied(), Some(63.0));

    // S_LP1 kind = "lp" — symbol kind extraction is wired correctly.
    let lp1 = pt.rows.iter().find(|r| r.symbol == "S_LP1").unwrap();
    assert_eq!(lp1.kind, "lp");

    // JSON roundtrip preserves the matrix.
    let json = serde_json::to_string(&par).unwrap();
    let back: PARSheet = serde_json::from_str(&json).unwrap();
    let back_pt = back.paytable.unwrap();
    assert_eq!(back_pt.rows.len(), 5);
    let back_hp1 = back_pt.rows.iter().find(|r| r.symbol == "S_HP1").unwrap();
    assert_eq!(back_hp1.payouts.get(&5).copied(), Some(63.0));
}

// ─── A4 — Generator accepts PARBuildContext + bekvard-kompat shim ───────────

#[test]
fn generate_with_context_struct() {
    let stats = make_stats();
    let par_m = make_par_metrics(&stats);

    // Path A — new struct-based API.
    let ctx = make_context(&stats, &par_m, None, None);
    let par_new = PARGenerator::generate_with_context(ctx);

    // Path B — legacy 14-arg shim. Must produce the same RTP / meta values.
    let par_legacy = PARGenerator::generate(
        &stats,
        &par_m,
        vec![],
        "par-001-test",
        "1.0.0",
        96.0,
        0.5,
        5000.0,
        vec!["MGA".to_string(), "UKGC".to_string()],
        [85.0, 99.0],
        "must_be_random",
        true,
        true,
        20,
    );

    assert_eq!(par_new.meta.game_id, par_legacy.meta.game_id);
    assert!((par_new.rtp.total_rtp_pct - par_legacy.rtp.total_rtp_pct).abs() < 1e-12);
    assert_eq!(par_new.win_distribution.len(), par_legacy.win_distribution.len());

    // Without IR, neither path emits the Tier-1 sections (Faza-8 JSON shape preserved).
    assert!(par_new.reel_config.is_none());
    assert!(par_new.paytable.is_none());
    assert!(par_new.sign_off.is_none());
    assert!(par_legacy.reel_config.is_none());
    assert!(par_legacy.paytable.is_none());
}

// ─── A5 — Per-pay-rule RTP audit trail covers IR paytable keys ──────────────

#[test]
fn pay_rule_rtp_covers_all_ir_paytable_keys() {
    let ir = load_parity_base_only_ir();
    let par = make_par_sheet_with_ir(&ir, None);
    let pt = par.paytable.as_ref().expect("paytable populated");

    // Each (symbol, n-of-a-kind) pair from the IR paytable must appear exactly
    // once in `pay_rule_rtp` keyed by "{symbol}_{n}oak". Fixture has 5 symbols
    // × 3 n-of-a-kind sizes = 15 entries.
    let mut expected_keys: Vec<String> = Vec::new();
    for (sym, counts) in ir.paytable.iter() {
        for n in counts.keys() {
            expected_keys.push(format!("{sym}_{n}oak"));
        }
    }
    expected_keys.sort();
    assert_eq!(pt.pay_rule_rtp.len(), expected_keys.len());
    for k in &expected_keys {
        assert!(
            pt.pay_rule_rtp.contains_key(k),
            "pay_rule_rtp missing key {k}"
        );
        let v = pt.pay_rule_rtp[k];
        assert!(v.is_finite(), "pay_rule_rtp[{k}] = {v} must be finite");
        assert!(v >= 0.0, "pay_rule_rtp[{k}] = {v} must be non-negative");
    }
}
