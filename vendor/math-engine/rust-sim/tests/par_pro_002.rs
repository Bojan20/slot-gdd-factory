//! PAR-002 — configHash + RNG attestation (+ stale "mulberry32" fix).
//!
//! Atoms covered:
//!   A1 — `PARMeta.config_hash` is the SHA-256 (lowercase hex) over the
//!         canonical JSON serialisation of the IR. Deterministic across runs.
//!   A2 — `RngAttestationSection { kind, period, seed_hex, tests }` +
//!         `TestVerdict { Pass, Fail, NotRun }` serde roundtrip.
//!   A3 — `PARMeta.rng_kind` mirrors the IR's declared RNG family.
//!   A4 — **MLAgent gap L**: legacy stale literal `"mulberry32"` is GONE — the
//!         field now matches the actual RNG declared by the IR (or
//!         `"unknown"` when no IR is passed via the legacy 14-arg shim).

use slot_sim::ir::{RngKind, SlotGameIR};
use slot_sim::par::{
    compute_config_hash, PARBuildContext, PARGenerator, PARSheet, TestVerdict,
};
use slot_sim::stats::{AtomicStats, MultiSeedStats, PARMetrics, SeedStats};
use std::path::PathBuf;
use std::sync::atomic::Ordering;

fn fixture_path(name: &str) -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("..");
    p.push("tests");
    p.push("fixtures");
    p.push(name);
    p
}

fn load_parity_ir() -> SlotGameIR {
    let raw = std::fs::read_to_string(fixture_path("parity-base-only.json"))
        .expect("parity-base-only.json fixture must exist");
    SlotGameIR::from_json(&raw).expect("fixture must parse")
}

fn make_stats() -> AtomicStats {
    let s = AtomicStats::new();
    s.total_spins.store(1_000_000, Ordering::Relaxed);
    s.total_wagered.store(1_000_000, Ordering::Relaxed);
    s.total_won.store(960_000, Ordering::Relaxed);
    s
}

fn make_metrics(stats: &AtomicStats) -> PARMetrics {
    let rtps = [96.0_f64; 5];
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

fn make_sheet_with_ir(ir: Option<&SlotGameIR>) -> PARSheet {
    let stats = make_stats();
    let par_m = make_metrics(&stats);
    let ctx = PARBuildContext {
        stats: &stats,
        par: &par_m,
        jackpots: vec![],
        game_id: "par-002-test".to_string(),
        game_version: "1.0.0".to_string(),
        target_rtp: 96.0,
        rtp_tolerance: 0.5,
        max_win_cap: 5000.0,
        jurisdictions: vec!["MGA".to_string()],
        rtp_range_required: [85.0, 99.0],
        near_miss_rule: "must_be_random".to_string(),
        ldw_disclosure: true,
        session_time_display: true,
        seeds_used: 5,
        ir,
        sign_off: None,
    };
    PARGenerator::generate_with_context(ctx)
}

// ─── A1: config_hash deterministic + sensitive to mutation ──────────────────

#[test]
fn config_hash_deterministic() {
    let ir = load_parity_ir();
    let h1 = compute_config_hash(&ir);
    let h2 = compute_config_hash(&ir);
    assert_eq!(h1, h2, "same IR must produce same hash");
    assert_eq!(h1.len(), 64, "SHA-256 hex digest length must be 64");
    assert!(
        h1.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
        "hash must be lowercase hex only — got {h1}"
    );
}

#[test]
fn config_hash_sensitive_to_single_byte_mutation() {
    let ir1 = load_parity_ir();
    let mut ir2 = ir1.clone();
    ir2.meta.name = format!("{} *", ir2.meta.name);
    let h1 = compute_config_hash(&ir1);
    let h2 = compute_config_hash(&ir2);
    assert_ne!(
        h1, h2,
        "mutating IR.meta.name must change config_hash (saw {h1} == {h2})"
    );
}

#[test]
fn par_sheet_propagates_config_hash() {
    let ir = load_parity_ir();
    let par = make_sheet_with_ir(Some(&ir));
    let h = compute_config_hash(&ir);
    assert_eq!(par.meta.config_hash, h);
}

#[test]
fn par_sheet_legacy_shim_emits_empty_config_hash() {
    let par_no_ir = make_sheet_with_ir(None);
    assert_eq!(par_no_ir.meta.config_hash, "");
    assert!(par_no_ir.rng_attestation.is_none());
}

// ─── A2: RngAttestationSection roundtrip + verdict serde ────────────────────

#[test]
fn rng_attestation_section_roundtrip() {
    let ir = load_parity_ir();
    let par = make_sheet_with_ir(Some(&ir));
    let rng = par
        .rng_attestation
        .as_ref()
        .expect("rng_attestation populated when IR present");
    assert_eq!(rng.kind, "mulberry32"); // fixture declares mulberry32
    assert_eq!(rng.period, "2^32");
    assert_eq!(rng.seed_hex, format!("{:016x}", ir.rng.default_seed));
    assert_eq!(rng.tests.diehard, TestVerdict::NotRun);

    // JSON roundtrip preserves the section.
    let json = serde_json::to_string(&par).unwrap();
    let back: PARSheet = serde_json::from_str(&json).unwrap();
    let back_rng = back.rng_attestation.unwrap();
    assert_eq!(back_rng.kind, "mulberry32");
    assert_eq!(back_rng.seed_hex, rng.seed_hex);
}

// ─── A3: PARMeta.rng_kind matches IR rng family (not stale "mulberry32") ────

#[test]
fn rng_kind_matches_actual_backend_xoshiro() {
    let mut ir = load_parity_ir();
    ir.rng.kind = RngKind::Xoshiro256pp;
    let par = make_sheet_with_ir(Some(&ir));
    assert_eq!(par.meta.rng_kind, "xoshiro256pp");
    assert_eq!(par.rng_attestation.as_ref().unwrap().kind, "xoshiro256pp");
}

#[test]
fn rng_kind_matches_actual_backend_aes_ctr_drbg() {
    let mut ir = load_parity_ir();
    ir.rng.kind = RngKind::AesCtrDrbg;
    let par = make_sheet_with_ir(Some(&ir));
    assert_eq!(par.meta.rng_kind, "aes_ctr_drbg");
    let attestation = par.rng_attestation.as_ref().unwrap();
    assert_eq!(attestation.kind, "aes_ctr_drbg");
    assert!(
        attestation.period.contains("NIST"),
        "AES-CTR-DRBG period must reference NIST standard"
    );
}

// ─── A4: stale "mulberry32" literal eliminated ──────────────────────────────

#[test]
fn no_stale_mulberry32_literal_when_ir_says_pcg64() {
    let mut ir = load_parity_ir();
    ir.rng.kind = RngKind::Pcg64;
    let par = make_sheet_with_ir(Some(&ir));
    // CRITICAL — before PAR-002 this would always say "mulberry32".
    assert_ne!(par.meta.rng_kind, "mulberry32");
    assert_eq!(par.meta.rng_kind, "pcg64");
}

#[test]
fn legacy_shim_falls_back_to_unknown_not_mulberry32() {
    // Path without IR: legacy 14-arg shim must NOT silently claim "mulberry32".
    let par = make_sheet_with_ir(None);
    assert_eq!(
        par.meta.rng_kind, "unknown",
        "legacy shim must not lie about RNG family"
    );
}
