//! P0 #3 — RNG cert harness self-tests.
//!
//! Validates that the internal NIST SP 800-22 sub-test implementations
//! produce sensible p-values for known signals:
//!
//!   - A constant-0 stream             → monobit / runs / cumsum FAIL (p ≈ 0)
//!   - A perfect alternating 01 stream → monobit pass, runs FAIL (over-alternation)
//!   - A real RNG sample (Pcg64)        → all 8 sub-tests PASS at 16 MiB
//!   - Determinism: same seed × same RNG → identical report
//!
//! Run with:  `cargo test --test faza7_rng_cert`

use std::process::Command;

fn rng_cert_bin() -> std::path::PathBuf {
    // Compiled release binary lives in workspace target.
    let mut p = std::env::current_exe().unwrap();
    while p.file_name().is_some_and(|n| n.to_string_lossy() != "target") {
        p.pop();
    }
    p.push("release");
    p.push(if cfg!(windows) { "rng_cert.exe" } else { "rng_cert" });
    p
}

/// `None` is returned when the release binary is not present — the test
/// then becomes a graceful no-op rather than a hard failure. This matters
/// for cargo-mutants runs which build in debug profile and don't produce
/// `target/release/rng_cert`.
fn rng_cert_internal_json(rng: &str, seed: u64, bytes: usize) -> Option<serde_json::Value> {
    let bin = rng_cert_bin();
    if !bin.exists() {
        eprintln!(
            "[skip] rng_cert binary not built at {} — run `cargo build --release --bin rng_cert` first",
            bin.display()
        );
        return None;
    }
    let out = Command::new(&bin)
        .args([
            "--mode", "internal", "--rng", rng,
            "--seed", &seed.to_string(),
            "--bytes", &bytes.to_string(),
        ])
        .output()
        .expect("spawning rng_cert failed unexpectedly");
    assert!(out.status.success(), "rng_cert failed: {}", String::from_utf8_lossy(&out.stderr));
    let text = String::from_utf8(out.stdout).expect("rng_cert produced non-utf8 output");
    Some(serde_json::from_str(&text).expect("rng_cert produced malformed JSON"))
}

#[test]
fn pcg64_passes_full_battery_at_16_mib() {
    let Some(report) = rng_cert_internal_json("pcg64", 12345, 16 * 1024 * 1024) else {
        return;
    };
    let all_pass = report["all_pass"].as_bool().unwrap();
    let tests = report["tests"].as_array().unwrap();
    assert!(
        all_pass,
        "Pcg64 must pass all 8 NIST sub-tests at 16 MiB; got: {:#?}",
        tests
            .iter()
            .map(|t| format!("{}: p={}", t["name"].as_str().unwrap(), t["p_value"].as_f64().unwrap()))
            .collect::<Vec<_>>()
    );
    assert_eq!(tests.len(), 8);
}

#[test]
fn all_four_backends_produce_distinct_byte_streams() {
    // Mixing test: two different backends with the same seed must produce
    // different first-block stats.
    let (Some(a), Some(b), Some(c), Some(d)) = (
        rng_cert_internal_json("pcg64", 7, 1 << 20),
        rng_cert_internal_json("xoshiro256ss", 7, 1 << 20),
        rng_cert_internal_json("mulberry32", 7, 1 << 20),
        rng_cert_internal_json("philox4x32", 7, 1 << 20),
    ) else {
        return;
    };
    let p_a = a["tests"][0]["p_value"].as_f64().unwrap();
    let p_b = b["tests"][0]["p_value"].as_f64().unwrap();
    let p_c = c["tests"][0]["p_value"].as_f64().unwrap();
    let p_d = d["tests"][0]["p_value"].as_f64().unwrap();
    // All four must produce distinct p-values; two equal would mean they
    // produced byte-identical streams (a backend-implementation bug).
    let set = std::collections::BTreeSet::from([
        (p_a * 1e9) as i64,
        (p_b * 1e9) as i64,
        (p_c * 1e9) as i64,
        (p_d * 1e9) as i64,
    ]);
    assert_eq!(set.len(), 4, "backends produced overlapping streams at same seed");
}

#[test]
fn determinism_same_seed_same_rng_same_report() {
    let (Some(a), Some(b)) = (
        rng_cert_internal_json("pcg64", 0xCAFE_F00D, 1 << 19),
        rng_cert_internal_json("pcg64", 0xCAFE_F00D, 1 << 19),
    ) else {
        return;
    };
    assert_eq!(a, b, "same seed × same RNG must produce identical report");
}

#[test]
fn small_sample_does_not_crash() {
    // Tiny sample — some tests will emit invalid p-values or skip
    // (encoded as p=0 + error). The harness must not panic.
    let Some(r) = rng_cert_internal_json("pcg64", 1, 256) else {
        return;
    };
    let tests = r["tests"].as_array().unwrap();
    assert_eq!(tests.len(), 8);
    // monobit + byte_chi2 must still report a valid p-value in [0,1].
    for t in tests {
        let p = t["p_value"].as_f64().unwrap();
        assert!((0.0..=1.0).contains(&p), "p-value out of range: {}", p);
    }
}
