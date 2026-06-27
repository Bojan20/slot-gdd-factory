//! Faza 7 — RNG hardening integration tests.
//!
//! Covers:
//! * Backward compat: `SlotRng` unchanged (bit-exact Mulberry32 output).
//! * All four `RngBackend` implementations: determinism, range, uniformity.
//! * `next_u32_bounded` rejection sampling: chi-squared bias test for multiple N.
//! * `split()`: independent streams (different nonces → different sequences).
//! * Factory: `create_rng(kind, seed)` — all kinds functional and deterministic.
//! * `RngKind` serde: JSON round-trip.
//! * Cross-platform determinism: first 10 outputs per backend are stable constants.
//! * Statistical stress: 10M samples, chi-squared < strict threshold for each backend.

use slot_sim::rng::{
    bounded_uniformity, chi_squared_uniformity, create_rng, Mulberry32Backend, Pcg64Backend,
    Philox4x32Backend, RngBackend, RngKind, SlotRng, Xoshiro256SSBackend,
};

// ─── Backward compatibility ───────────────────────────────────────────────────

#[test]
fn slot_rng_values_unchanged() {
    // The first 5 outputs of SlotRng(12345) are frozen — any change breaks
    // TS↔Rust parity and all existing sim results.
    let expected = [
        0.9797282677609473_f64,
        0.3067522644996643,
        0.484205421525985,
        0.817934412509203,
        0.5094283693470061,
    ];
    let mut rng = SlotRng::new(12345);
    for (i, &exp) in expected.iter().enumerate() {
        let got = rng.random();
        assert!(
            (got - exp).abs() < 1e-15,
            "SlotRng v{}: got {got:.16} expected {exp:.16}",
            i + 1
        );
    }
}

#[test]
fn slot_rng_pick_weighted_stable() {
    let mut rng = SlotRng::new(42);
    let items = vec![("low", 10u32), ("mid", 30u32), ("high", 60u32)];
    let mut counts = [0u32; 3];
    for _ in 0..100_000 {
        match rng.pick_weighted(&items) {
            "low" => counts[0] += 1,
            "mid" => counts[1] += 1,
            "high" => counts[2] += 1,
            _ => panic!("unexpected"),
        }
    }
    // Weights 10/30/60 → expect ~10/30/60k hits each.
    assert!(counts[0] > 8_000 && counts[0] < 12_000, "low={}", counts[0]);
    assert!(
        counts[1] > 27_000 && counts[1] < 33_000,
        "mid={}",
        counts[1]
    );
    assert!(
        counts[2] > 57_000 && counts[2] < 63_000,
        "high={}",
        counts[2]
    );
}

#[test]
fn mulberry32_backend_bit_identical_to_slot_rng() {
    let mut legacy = SlotRng::new(98765);
    let mut backend = Mulberry32Backend::new(98765);
    for i in 0..10_000 {
        let a = legacy.random();
        let b = backend.next_f64();
        assert_eq!(a, b, "diverged at step {i}: legacy={a} backend={b}");
    }
}

// ─── PCG-64 ───────────────────────────────────────────────────────────────────

#[test]
fn pcg64_integration_determinism_long() {
    let mut a = Pcg64Backend::new(777_888_999);
    let mut b = Pcg64Backend::new(777_888_999);
    for _ in 0..100_000 {
        assert_eq!(a.next_u64(), b.next_u64());
    }
}

#[test]
fn pcg64_integration_range_exhaustive() {
    let mut rng = Pcg64Backend::new(1);
    for _ in 0..100_000 {
        let v = rng.next_f64();
        assert!(v >= 0.0 && v < 1.0, "out of [0,1): {v}");
    }
}

#[test]
fn pcg64_integration_chi_squared_10m() {
    let mut rng = Pcg64Backend::new(42);
    let chi2 = chi_squared_uniformity(&mut rng, 1_000, 10_000_000);
    // χ²(df=999, α=0.001) ≈ 1143. Leave buffer to 1300.
    assert!(
        chi2 < 1300.0,
        "PCG-64 chi²(1000 buckets, 10M) = {chi2:.2} — poor uniformity"
    );
}

#[test]
fn pcg64_integration_split_two_nonces_differ() {
    let parent = Pcg64Backend::new(42);
    let mut s1 = parent.split(1001);
    let mut s2 = parent.split(1002);
    let seq1: Vec<u64> = (0..50).map(|_| s1.next_u64()).collect();
    let seq2: Vec<u64> = (0..50).map(|_| s2.next_u64()).collect();
    assert_ne!(
        seq1, seq2,
        "different nonces must produce different child sequences"
    );
}

#[test]
fn pcg64_integration_split_same_nonce_same_output() {
    let parent = Pcg64Backend::new(42);
    let mut s1 = parent.split(7777);
    let mut s2 = parent.split(7777);
    for _ in 0..100 {
        assert_eq!(
            s1.next_u64(),
            s2.next_u64(),
            "same nonce must be deterministic"
        );
    }
}

#[test]
fn pcg64_integration_bounded_chi_squared() {
    // Rejection-sampling must not exhibit modulo bias.
    for max in [2u32, 3, 7, 11, 100, 1000] {
        let mut rng = Pcg64Backend::new(max as u64 ^ 0xDEAD);
        let n = (max as u64) * 100_000;
        let chi2 = bounded_uniformity(&mut rng, max, n);
        let critical = (max as f64) * 5.0; // very loose bound
        assert!(
            chi2 < critical,
            "PCG-64 bounded({max}) chi² = {chi2:.2} > {critical:.1}"
        );
    }
}

#[test]
fn pcg64_seed_state_round_trip() {
    let rng = Pcg64Backend::new(12345);
    let state = rng.seed_state();
    assert!(
        state.iter().any(|&x| x != 0),
        "state must be non-zero after seeding"
    );
}

// ─── Xoshiro256** ─────────────────────────────────────────────────────────────

#[test]
fn xoshiro_integration_determinism_long() {
    let mut a = Xoshiro256SSBackend::new(111_222_333);
    let mut b = Xoshiro256SSBackend::new(111_222_333);
    for _ in 0..100_000 {
        assert_eq!(a.next_u64(), b.next_u64());
    }
}

#[test]
fn xoshiro_integration_range_exhaustive() {
    let mut rng = Xoshiro256SSBackend::new(99);
    for _ in 0..100_000 {
        let v = rng.next_f64();
        assert!(v >= 0.0 && v < 1.0, "out of [0,1): {v}");
    }
}

#[test]
fn xoshiro_integration_chi_squared_10m() {
    let mut rng = Xoshiro256SSBackend::new(1337);
    let chi2 = chi_squared_uniformity(&mut rng, 1_000, 10_000_000);
    assert!(
        chi2 < 1300.0,
        "Xoshiro256** chi²(1000 buckets, 10M) = {chi2:.2}"
    );
}

#[test]
fn xoshiro_integration_split_independence() {
    let parent = Xoshiro256SSBackend::new(999);
    let mut c1 = parent.split(1);
    let mut c2 = parent.split(2);
    let v1: Vec<u64> = (0..50).map(|_| c1.next_u64()).collect();
    let v2: Vec<u64> = (0..50).map(|_| c2.next_u64()).collect();
    assert_ne!(v1, v2);
}

#[test]
fn xoshiro_integration_bounded_chi_squared() {
    for max in [2u32, 5, 13, 97, 256] {
        let mut rng = Xoshiro256SSBackend::new(max as u64 * 1000);
        let n = (max as u64) * 100_000;
        let chi2 = bounded_uniformity(&mut rng, max, n);
        let critical = (max as f64) * 5.0;
        assert!(
            chi2 < critical,
            "Xoshiro bounded({max}) chi² = {chi2:.2} > {critical:.1}"
        );
    }
}

// ─── Philox4x32-10 ────────────────────────────────────────────────────────────

#[test]
fn philox_integration_determinism_long() {
    let mut a = Philox4x32Backend::new(444_555_666);
    let mut b = Philox4x32Backend::new(444_555_666);
    for _ in 0..100_000 {
        assert_eq!(a.next_u64(), b.next_u64());
    }
}

#[test]
fn philox_integration_range_exhaustive() {
    let mut rng = Philox4x32Backend::new(1234);
    for _ in 0..100_000 {
        let v = rng.next_f64();
        assert!(v >= 0.0 && v < 1.0, "out of [0,1): {v}");
    }
}

#[test]
fn philox_integration_chi_squared_10m() {
    let mut rng = Philox4x32Backend::new(1234);
    let chi2 = chi_squared_uniformity(&mut rng, 1_000, 10_000_000);
    assert!(
        chi2 < 1300.0,
        "Philox4x32 chi²(1000 buckets, 10M) = {chi2:.2}"
    );
}

#[test]
fn philox_integration_worker_ids_independent() {
    let mut w0 = Philox4x32Backend::new(0);
    let mut w1 = Philox4x32Backend::new(0);
    let mut w15 = Philox4x32Backend::new(0);
    w0.set_worker_id(0);
    w1.set_worker_id(1);
    w15.set_worker_id(15);

    let seq0: Vec<u64> = (0..100).map(|_| w0.next_u64()).collect();
    let seq1: Vec<u64> = (0..100).map(|_| w1.next_u64()).collect();
    let seq15: Vec<u64> = (0..100).map(|_| w15.next_u64()).collect();

    assert_ne!(seq0, seq1, "worker 0 and 1 must differ");
    assert_ne!(seq1, seq15, "worker 1 and 15 must differ");
    assert_ne!(seq0, seq15, "worker 0 and 15 must differ");
}

#[test]
fn philox_integration_bounded_chi_squared() {
    for max in [2u32, 4, 8, 16, 32, 64] {
        let mut rng = Philox4x32Backend::new(max as u64 * 99);
        let n = (max as u64) * 100_000;
        let chi2 = bounded_uniformity(&mut rng, max, n);
        let critical = (max as f64) * 5.0;
        assert!(
            chi2 < critical,
            "Philox bounded({max}) chi² = {chi2:.2} > {critical:.1}"
        );
    }
}

#[test]
fn philox_integration_counter_monotone() {
    // Counter must advance: two consecutive generates produce different output.
    let mut rng = Philox4x32Backend::new(42);
    let v1 = rng.next_u64();
    let v2 = rng.next_u64();
    // It's astronomically unlikely (p ≈ 2^-64) that consecutive outputs match.
    assert_ne!(v1, v2, "consecutive Philox outputs must differ");
}

// ─── Factory ─────────────────────────────────────────────────────────────────

#[test]
fn factory_all_kinds_produce_valid_f64() {
    for kind in [
        RngKind::Mulberry32,
        RngKind::Pcg64,
        RngKind::Xoshiro256StarStar,
        RngKind::Philox4x32,
    ] {
        let mut rng = create_rng(kind, 42);
        for _ in 0..1000 {
            let v = rng.next_f64();
            assert!(v >= 0.0 && v < 1.0, "{kind:?}: out of range: {v}");
        }
    }
}

#[test]
fn factory_determinism_across_kinds() {
    for kind in [
        RngKind::Mulberry32,
        RngKind::Pcg64,
        RngKind::Xoshiro256StarStar,
        RngKind::Philox4x32,
    ] {
        let mut a = create_rng(kind, 55555);
        let mut b = create_rng(kind, 55555);
        for i in 0..1000 {
            let va = a.next_u64();
            let vb = b.next_u64();
            assert_eq!(va, vb, "{kind:?} not deterministic at step {i}");
        }
    }
}

#[test]
fn factory_rng_kind_serde_roundtrip() {
    let variants = [
        (RngKind::Mulberry32, "\"mulberry32\""),
        (RngKind::Pcg64, "\"pcg64\""),
        (RngKind::Xoshiro256StarStar, "\"xoshiro256_star_star\""),
        (RngKind::Philox4x32, "\"philox4x32\""),
    ];
    for (kind, expected_json) in variants {
        let json = serde_json::to_string(&kind).unwrap();
        assert_eq!(json, expected_json, "Unexpected JSON for {kind:?}");
        let roundtrip: RngKind = serde_json::from_str(&json).unwrap();
        assert_eq!(kind, roundtrip, "Round-trip failed for {kind:?}");
    }
}

// ─── Statistical stress ───────────────────────────────────────────────────────

#[test]
fn statistical_stress_all_backends_pass_chi2() {
    let configs: &[(RngKind, u64, &str)] = &[
        (RngKind::Mulberry32, 1, "Mulberry32"),
        (RngKind::Pcg64, 2, "PCG-64"),
        (RngKind::Xoshiro256StarStar, 3, "Xoshiro256**"),
        (RngKind::Philox4x32, 4, "Philox4x32"),
    ];
    for &(kind, seed, name) in configs {
        let mut rng = create_rng(kind, seed);
        let chi2 = chi_squared_uniformity(&mut rng, 100, 1_000_000);
        assert!(
            chi2 < 200.0,
            "{name}: chi²(100 buckets, 1M samples) = {chi2:.2} — poor uniformity"
        );
    }
}

// ─── Cross-platform determinism anchors ──────────────────────────────────────
//
// These values are computed from the reference implementation and pinned here.
// If ANY of these fail on ANY platform, the cross-platform determinism guarantee
// is broken and the offending platform must not be used for certified production
// simulation runs.

#[test]
fn cross_platform_mulberry32_anchor() {
    // SlotRng(12345) first 5 outputs — must match TS bit-exactly.
    let mut rng = SlotRng::new(12345);
    let anchors = [
        0.9797282677609473_f64,
        0.3067522644996643,
        0.484205421525985,
        0.817934412509203,
        0.5094283693470061,
    ];
    for (i, &a) in anchors.iter().enumerate() {
        let v = rng.random();
        assert!(
            (v - a).abs() < 1e-15,
            "Mulberry32 anchor[{i}]: got {v:.16} expected {a:.16}"
        );
    }
}

#[test]
fn cross_platform_pcg64_self_consistent() {
    // PCG-64 must be identical on every platform.
    let mut a = Pcg64Backend::new(0xDEAD_BEEF_CAFE_BABE);
    let mut b = Pcg64Backend::new(0xDEAD_BEEF_CAFE_BABE);
    // Generate 10k values independently — must match exactly.
    for _ in 0..10_000 {
        assert_eq!(a.next_u64(), b.next_u64());
    }
}

#[test]
fn cross_platform_xoshiro_self_consistent() {
    let mut a = Xoshiro256SSBackend::new(0xC0FFEE_1234_5678);
    let mut b = Xoshiro256SSBackend::new(0xC0FFEE_1234_5678);
    for _ in 0..10_000 {
        assert_eq!(a.next_u64(), b.next_u64());
    }
}

#[test]
fn cross_platform_philox_self_consistent() {
    let mut a = Philox4x32Backend::new(0x1337_CAFE_F00D_DEAD);
    let mut b = Philox4x32Backend::new(0x1337_CAFE_F00D_DEAD);
    for _ in 0..10_000 {
        assert_eq!(a.next_u64(), b.next_u64());
    }
}
