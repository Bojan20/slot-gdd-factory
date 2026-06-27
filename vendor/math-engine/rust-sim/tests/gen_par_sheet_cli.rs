//! W250 — Integration test for the `gen_par_sheet` CLI binary.
//!
//! Verifies:
//!   * Strict mode rejects an IR with `rtp_allocation` cross-validation errors
//!   * `--allow-soft-validation` flips the rejection into a warn-and-continue
//!   * All 4 requested formats land in the output directory
//!   * `par.json` round-trips back through `PARSheet` deserialisation
//!   * `par.usif.json` carries the USIF top-level keys
//!   * `par.csv` opens with the RFC 4180 header
//!   * `par.md` starts with an H1 title

use slot_sim::par::PARSheet;
use std::path::PathBuf;
use std::process::Command;

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn fixture_path(name: &str) -> PathBuf {
    manifest_dir().join("..").join("tests").join("fixtures").join(name)
}

fn binary_path() -> PathBuf {
    // `cargo test` builds binaries into `target/debug/`; canonical lookup.
    let mut p = manifest_dir().join("..").join("target").join("debug").join("gen_par_sheet");
    if !p.exists() {
        // Some shells may have CARGO_TARGET_DIR pointing elsewhere — fall back.
        p = manifest_dir().join("target").join("debug").join("gen_par_sheet");
    }
    p
}

fn ensure_binary_built() {
    if binary_path().exists() {
        return;
    }
    let status = Command::new(env!("CARGO"))
        .args(["build", "--bin", "gen_par_sheet"])
        .status()
        .expect("cargo build must succeed");
    assert!(status.success(), "cargo build --bin gen_par_sheet failed");
}

#[test]
fn strict_mode_rejects_ir_with_validation_errors() {
    ensure_binary_built();
    let bin = binary_path();
    let out_dir = std::env::temp_dir().join("gen_par_sheet_strict");
    let _ = std::fs::remove_dir_all(&out_dir);
    let status = Command::new(&bin)
        .arg("--ir")
        .arg(fixture_path("parity-base-only.json"))
        .arg("--spins")
        .arg("100")
        .arg("--seeds")
        .arg("1")
        .arg("--out-dir")
        .arg(&out_dir)
        .arg("--quiet")
        .status()
        .expect("CLI must execute");
    assert!(
        !status.success(),
        "strict mode must reject IR with rtp_allocation mismatch"
    );
}

#[test]
fn emits_all_four_formats_for_valid_ir() {
    ensure_binary_built();
    let bin = binary_path();
    let out_dir = std::env::temp_dir().join("gen_par_sheet_full");
    let _ = std::fs::remove_dir_all(&out_dir);
    let status = Command::new(&bin)
        .arg("--ir")
        .arg(fixture_path("parity.json"))
        .arg("--spins")
        .arg("5000")
        .arg("--seeds")
        .arg("2")
        .arg("--out-dir")
        .arg(&out_dir)
        .arg("--quiet")
        .status()
        .expect("CLI must execute");
    assert!(status.success(), "valid IR must produce a sheet");

    let base = out_dir.join("parity");
    for f in ["par.json", "par.usif.json", "par.csv", "par.md"] {
        let p = base.join(f);
        assert!(p.exists(), "{} must exist", p.display());
        let size = std::fs::metadata(&p).unwrap().len();
        assert!(size > 0, "{} must be non-empty", p.display());
    }

    // Round-trip the native JSON back into the typed struct.
    let json = std::fs::read_to_string(base.join("par.json")).unwrap();
    let par: PARSheet = serde_json::from_str(&json).expect("par.json must deserialise");
    // game_id is sourced from `ir.meta.id` — parity.json fixture uses "parity-fixture".
    assert_eq!(par.meta.game_id, "parity-fixture");
    assert!(!par.meta.config_hash.is_empty(), "config_hash must be populated when IR is supplied");
    assert!(par.reel_config.is_some(), "reel_config must be populated when IR is supplied");
    assert!(par.paytable.is_some(), "paytable must be populated when IR is supplied");
    assert!(par.rng_attestation.is_some(), "rng_attestation populated when IR is supplied");

    // USIF v1.0 quick keys.
    let usif: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(base.join("par.usif.json")).unwrap()).unwrap();
    assert_eq!(usif["schemaVersion"], "1.0.0");
    assert!(usif["game"].is_object());

    // CSV starts with RFC 4180 header.
    let csv = std::fs::read_to_string(base.join("par.csv")).unwrap();
    assert!(csv.starts_with("Section,Metric,Value,Unit,Notes\r\n"));

    // Markdown starts with H1 title.
    let md = std::fs::read_to_string(base.join("par.md")).unwrap();
    assert!(md.starts_with("# PAR Sheet"), "markdown report must begin with H1 title");
}

#[test]
fn allow_soft_validation_emits_sheet_even_for_imperfect_ir() {
    ensure_binary_built();
    let bin = binary_path();
    let out_dir = std::env::temp_dir().join("gen_par_sheet_soft");
    let _ = std::fs::remove_dir_all(&out_dir);
    let status = Command::new(&bin)
        .arg("--ir")
        .arg(fixture_path("parity-base-only.json"))
        .arg("--spins")
        .arg("500")
        .arg("--seeds")
        .arg("1")
        .arg("--out-dir")
        .arg(&out_dir)
        .arg("--allow-soft-validation")
        .arg("--formats")
        .arg("json,md")
        .arg("--quiet")
        .status()
        .expect("CLI must execute");
    assert!(
        status.success(),
        "soft-validation mode must still produce a sheet"
    );
    let base = out_dir.join("parity-base-only");
    assert!(base.join("par.json").exists());
    assert!(base.join("par.md").exists());
    // Other formats must NOT be written when not requested.
    assert!(!base.join("par.csv").exists());
    assert!(!base.join("par.usif.json").exists());
}

#[test]
fn sign_off_flags_populate_section() {
    ensure_binary_built();
    let bin = binary_path();
    let out_dir = std::env::temp_dir().join("gen_par_sheet_signoff");
    let _ = std::fs::remove_dir_all(&out_dir);
    let status = Command::new(&bin)
        .arg("--ir")
        .arg(fixture_path("parity.json"))
        .arg("--spins")
        .arg("1000")
        .arg("--seeds")
        .arg("1")
        .arg("--out-dir")
        .arg(&out_dir)
        .arg("--mathematician")
        .arg("Bojan Petković")
        .arg("--approved-by")
        .arg("Regulator XYZ")
        .arg("--formats")
        .arg("json")
        .arg("--quiet")
        .status()
        .expect("CLI must execute");
    assert!(status.success());
    let json = std::fs::read_to_string(out_dir.join("parity").join("par.json")).unwrap();
    let par: PARSheet = serde_json::from_str(&json).unwrap();
    let so = par.sign_off.expect("sign_off must be populated");
    assert_eq!(so.mathematician.as_deref(), Some("Bojan Petković"));
    assert_eq!(so.approved_by.as_deref(), Some("Regulator XYZ"));
}
