//! PAR-006 — Jurisdiction-gated RTP variants + theoretical-vs-simulated gate.
//!
//! Atoms covered:
//!   A1 — `JurisdictionVariant { code, name, theoretical_rtp, simulated_rtp,
//!         delta_pp, regulatory_min, regulatory_max, pass, within_ci_95, notes }`
//!   A2 — `JurisdictionGatedSection.variants` emits one entry per active code
//!         from `ComplianceSection.jurisdictions`, sorted alphabetically.
//!   A3 — Regulatory bands loaded from `jurisdiction::profiles::get_profile`;
//!         unknown codes fall back to a permissive band with a warn note.
//!   A4 — GLI §8.2 explicit gate: `within_ci_95 = |theoretical − simulated| ≤ 1.96·σ/√N`.

use slot_sim::par::{PARBuildContext, PARGenerator};
use slot_sim::stats::{AtomicStats, MultiSeedStats, PARMetrics, SeedStats};
use std::sync::atomic::Ordering;

fn sheet(target: f64, observed: f64, jurisdictions: Vec<String>) -> slot_sim::par::PARSheet {
    let stats = AtomicStats::new();
    stats.total_spins.store(1_000_000, Ordering::Relaxed);
    stats.total_wagered.store(1_000_000, Ordering::Relaxed);
    stats.total_won.store((1_000_000.0 * observed / 100.0) as i64, Ordering::Relaxed);

    // 20 tightly clustered seeds → tiny std_error so CI95 is informative.
    let multi = MultiSeedStats::from_seeds(
        (0..20)
            .map(|i| {
                let rtp = observed + (((i as f64) - 10.0) * 0.001);
                SeedStats {
                    spins: 50_000,
                    wagered: 50_000,
                    won: (50_000.0 * rtp / 100.0) as i64,
                    rtp,
                }
            })
            .collect(),
    );
    let par_m = PARMetrics::from_stats(&stats, &multi, 1);

    let ctx = PARBuildContext {
        stats: &stats,
        par: &par_m,
        jackpots: vec![],
        game_id: "par-006-test".to_string(),
        game_version: "1.0.0".to_string(),
        target_rtp: target,
        rtp_tolerance: 0.5,
        max_win_cap: 5000.0,
        jurisdictions,
        rtp_range_required: [50.0, 100.0],
        near_miss_rule: "must_be_random".to_string(),
        ldw_disclosure: true,
        session_time_display: true,
        seeds_used: 20,
        ir: None,
        sign_off: None,
    };
    PARGenerator::generate_with_context(ctx)
}

// ─── A1 + A2 — Variant per active code, sorted alphabetically ───────────────

#[test]
fn one_variant_per_jurisdiction_sorted_alphabetical() {
    let par = sheet(
        96.0,
        96.0,
        vec!["UKGC".to_string(), "MGA".to_string(), "DE".to_string()],
    );
    let codes: Vec<&str> = par
        .jurisdiction_gated
        .variants
        .iter()
        .map(|v| v.code.as_str())
        .collect();
    assert_eq!(codes, vec!["DE", "MGA", "UKGC"]);
}

// ─── A3 — Regulatory bands match jurisdiction::profiles for known codes ────

#[test]
fn known_codes_use_profile_regulatory_bands() {
    let par = sheet(96.0, 96.0, vec!["MGA".to_string(), "UKGC".to_string()]);
    let mga = par
        .jurisdiction_gated
        .variants
        .iter()
        .find(|v| v.code == "MGA")
        .unwrap();
    // MGA profile rtp_range = [0.85, 0.99] → 85% .. 99%.
    assert!((mga.regulatory_min - 85.0).abs() < 1e-9);
    assert!((mga.regulatory_max - 99.0).abs() < 1e-9);
    assert!(mga.pass, "96% must be inside [85%, 99%]");

    let ukgc = par
        .jurisdiction_gated
        .variants
        .iter()
        .find(|v| v.code == "UKGC")
        .unwrap();
    assert!((ukgc.regulatory_min - 94.0).abs() < 1e-9);
}

#[test]
fn unknown_code_falls_back_to_permissive_band_with_note() {
    let par = sheet(96.0, 96.0, vec!["MARS_GAMING_BOARD".to_string()]);
    let v = &par.jurisdiction_gated.variants[0];
    assert_eq!(v.code, "MARS_GAMING_BOARD");
    assert!((v.regulatory_min - 50.0).abs() < 1e-9);
    assert!(!v.notes.is_empty(), "unknown jurisdiction must carry a warn note");
}

// ─── A1 — Observed below floor fails the band gate ──────────────────────────

#[test]
fn observed_rtp_below_band_fails_pass_flag() {
    let par = sheet(96.0, 80.0, vec!["UKGC".to_string()]);
    let ukgc = &par.jurisdiction_gated.variants[0];
    // UKGC min RTP is 94% — 80% must fail.
    assert!(!ukgc.pass, "80% must fail UKGC [94%, 99%] band");
}

// ─── A4 — Theoretical-vs-simulated PASS/FAIL gate (GLI §8.2) ────────────────

#[test]
fn theoretical_vs_simulated_within_ci_95_when_close() {
    // Target 96%, observed 96% → delta = 0 → within CI95 (regardless of σ).
    let par = sheet(96.0, 96.0, vec!["MGA".to_string()]);
    let v = &par.jurisdiction_gated.variants[0];
    assert!((v.delta_pp).abs() < 1e-9);
    assert!(v.within_ci_95, "delta=0 must always be within CI95");
}

#[test]
fn theoretical_vs_simulated_outside_ci_95_when_far() {
    // Target 96%, observed 90% → delta = 6pp >> 1.96·σ
    // σ across the 20 tightly-clustered seeds ≈ 0.006pp → CI half ≈ 0.012pp ⇒ fails.
    let par = sheet(96.0, 90.0, vec!["MGA".to_string()]);
    let v = &par.jurisdiction_gated.variants[0];
    assert!((v.delta_pp - 6.0).abs() < 1e-9);
    assert!(
        !v.within_ci_95,
        "delta=6pp with tight σ must FAIL CI95 gate"
    );
}

// ─── JSON roundtrip + print smoke ──────────────────────────────────────────

#[test]
fn jurisdiction_gated_survives_json_and_prints() {
    let par = sheet(96.0, 96.0, vec!["MGA".to_string(), "UKGC".to_string()]);
    let json = serde_json::to_string(&par).unwrap();
    let back: slot_sim::par::PARSheet = serde_json::from_str(&json).unwrap();
    assert_eq!(back.jurisdiction_gated.variants.len(), 2);
    PARGenerator::print(&par);
}
