//! PAR-007 + PAR-008 — USIF v1.0 JSON + CSV exporters.

use slot_sim::par::{PARBuildContext, PARGenerator, PARSheet};
use slot_sim::par_export::{to_csv, to_markdown_report, to_usif_v1};
use slot_sim::stats::{AtomicStats, MultiSeedStats, PARMetrics, SeedStats};
use std::sync::atomic::Ordering;

fn make_sheet() -> PARSheet {
    let stats = AtomicStats::new();
    stats.total_spins.store(100_000, Ordering::Relaxed);
    stats.total_wagered.store(100_000, Ordering::Relaxed);
    stats.total_won.store(96_000, Ordering::Relaxed);
    let multi = MultiSeedStats::from_seeds(vec![SeedStats {
        spins: 100_000,
        wagered: 100_000,
        won: 96_000,
        rtp: 96.0,
    }]);
    let par_m = PARMetrics::from_stats(&stats, &multi, 1);
    PARGenerator::generate_with_context(PARBuildContext {
        stats: &stats,
        par: &par_m,
        jackpots: vec![],
        game_id: "x-game".to_string(),
        game_version: "1".to_string(),
        target_rtp: 96.0,
        rtp_tolerance: 0.5,
        max_win_cap: 5000.0,
        jurisdictions: vec!["MGA".to_string(), "UKGC".to_string()],
        rtp_range_required: [85.0, 99.0],
        near_miss_rule: "must_be_random".to_string(),
        ldw_disclosure: true,
        session_time_display: true,
        seeds_used: 1,
        ir: None,
        sign_off: None,
    })
}

// ─── PAR-007 — USIF v1.0 JSON ───────────────────────────────────────────────

#[test]
fn usif_has_required_top_level_keys() {
    let sheet = make_sheet();
    let v = to_usif_v1(&sheet);
    for k in [
        "schemaVersion",
        "generatedAt",
        "configHash",
        "game",
        "results",
        "volatility",
        "markov",
        "ciBands",
        "varianceDecomposition",
        "jurisdictionGated",
        "hitFrequency",
        "moments",
    ] {
        assert!(v.get(k).is_some(), "USIF v1.0 must expose `{k}`");
    }
}

#[test]
fn usif_schema_version_pinned() {
    let sheet = make_sheet();
    let v = to_usif_v1(&sheet);
    assert_eq!(v["schemaVersion"], "1.0.0");
}

#[test]
fn usif_jurisdiction_gated_is_array_of_variants() {
    let sheet = make_sheet();
    let v = to_usif_v1(&sheet);
    let jg = v["jurisdictionGated"].as_array().expect("must be array");
    assert_eq!(jg.len(), 2);
    let codes: Vec<&str> = jg.iter().map(|j| j["code"].as_str().unwrap()).collect();
    assert!(codes.contains(&"MGA"));
    assert!(codes.contains(&"UKGC"));
}

// ─── PAR-008 — CSV ──────────────────────────────────────────────────────────

#[test]
fn csv_starts_with_rfc4180_header_and_uses_crlf() {
    let sheet = make_sheet();
    let csv = to_csv(&sheet);
    assert!(csv.starts_with("Section,Metric,Value,Unit,Notes\r\n"));
    assert!(csv.contains("\r\n"), "must use CRLF line endings");
}

#[test]
fn csv_covers_core_sections() {
    let sheet = make_sheet();
    let csv = to_csv(&sheet);
    for section in ["Meta", "RTP", "HitFreq", "Volatility", "Quantiles", "EvtPareto", "Statistics"] {
        assert!(
            csv.contains(&format!("{section},")),
            "CSV missing section {section}"
        );
    }
}

#[test]
fn csv_emits_per_jurisdiction_rows() {
    let sheet = make_sheet();
    let csv = to_csv(&sheet);
    assert!(csv.contains("MGA_pass"));
    assert!(csv.contains("UKGC_pass"));
}

// ─── PAR-009 — Markdown PDF-ready report ────────────────────────────────────

#[test]
fn markdown_report_has_required_sections() {
    let sheet = make_sheet();
    let md = to_markdown_report(&sheet);
    assert!(md.starts_with("# PAR Sheet"), "must start with H1 title");
    for h in [
        "## RTP",
        "## Volatility & Tails",
        "## Jurisdiction gating",
        "## Markov state model",
        "## Statistical confidence",
    ] {
        assert!(md.contains(h), "Markdown missing heading `{h}`");
    }
}

#[test]
fn markdown_jurisdiction_rows_use_pipe_table() {
    let sheet = make_sheet();
    let md = to_markdown_report(&sheet);
    assert!(md.contains("| MGA |"));
    assert!(md.contains("| UKGC |"));
}
