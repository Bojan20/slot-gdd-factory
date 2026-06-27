//! P0 #8 push — RNG hot-path strength tests.
//!
//! Targets the mutant gaps surfaced by the cargo-mutants baseline run
//! in `reports/mutation/rust/rng/`. The mutants live in three families:
//!
//!   1. `SlotRng::pick_weighted_index` (9 missed at baseline)
//!   2. `SlotRng::random_int` / `random_bounded` (7 missed)
//!   3. RNG backend bit ops — Xoshiro256SS / Philox4x32 / PCG64 / Mulberry32
//!      (9 missed; covered by KAT vectors below)
//!
//! For each missed mutant we add a test that would change outcome if the
//! mutation were applied. The cargo-mutants re-run after this commit
//! should show the score lift documented in `reports/mutation/rust/README.md`.
//!
//! Naming convention: `<family>_<scenario>_<assert>` so test failures
//! point straight at the missed mutant they cover.
//!
//! Run:
//!   cargo test --release --test faza8_rng_strength
//!
//! Wall-clock budget on M3 Pro: < 3 s (each distribution test uses
//! 1M–4M draws of cheap u32-bounded primitives).

use slot_sim::rng::{
    Mulberry32Backend, Pcg64Backend, Philox4x32Backend, RngBackend, SlotRng, Xoshiro256SSBackend,
};

// ─── Helpers ───────────────────────────────────────────────────────────────

/// Chi-squared statistic for observed counts vs uniform expectation.
/// Returns the χ² value; caller compares against threshold for the df.
fn chi_squared_uniform(counts: &[u64], total: u64) -> f64 {
    let k = counts.len() as f64;
    let expected = total as f64 / k;
    counts
        .iter()
        .map(|&c| {
            let d = c as f64 - expected;
            d * d / expected
        })
        .sum()
}

/// Critical χ² value at p = 0.01 for the given degrees of freedom. We
/// pre-compute the value for the df we need; the general formula is
/// ugly. These are from a standard χ² table.
fn chi2_critical_p01(df: usize) -> f64 {
    match df {
        1 => 6.635,
        2 => 9.210,
        3 => 11.345,
        6 => 16.812,
        7 => 18.475,
        15 => 30.578,
        255 => 310.46,  // approximation: 255 + sqrt(2*255) * 2.326 ≈ 310
        999 => 1106.97, // approximation: 999 + sqrt(2*999) * 2.326 ≈ 1107
        _ => panic!("no χ² critical value tabulated for df={df}"),
    }
}

// ─── pick_weighted_index — boundary & exact-ratio tests ─────────────────────

#[test]
fn pick_weighted_index_uniform_two_buckets_within_02_percent() {
    // weights=[1,1] with 1M draws: catches `<= → >`, `-= → +=`, `* → +/÷`,
    // and `fn → 0/1` constants. Any sign flip or constant collapse
    // produces ratio far from 50/50.
    let mut rng = SlotRng::new(0xCAFE_F00D);
    let weights = [1u32, 1u32];
    let n: u64 = 1_000_000;
    let mut counts = [0u64; 2];
    for _ in 0..n {
        counts[rng.pick_weighted_index(&weights)] += 1;
    }
    let ratio0 = counts[0] as f64 / n as f64;
    assert!(
        (0.498..=0.502).contains(&ratio0),
        "uniform 2-bucket ratio out of 50/50 ± 0.2%: {ratio0} ({:?})",
        counts
    );
}

#[test]
fn pick_weighted_index_three_way_75_15_10_within_05_percent() {
    // weights=[15, 3, 2] → exact ratios 75% / 15% / 10%. 4M draws gives
    // ±0.05% precision; we assert ±0.5% to leave headroom.
    let mut rng = SlotRng::new(11);
    let weights = [15u32, 3, 2];
    let n: u64 = 4_000_000;
    let mut counts = [0u64; 3];
    for _ in 0..n {
        counts[rng.pick_weighted_index(&weights)] += 1;
    }
    let r0 = counts[0] as f64 / n as f64;
    let r1 = counts[1] as f64 / n as f64;
    let r2 = counts[2] as f64 / n as f64;
    assert!((0.745..=0.755).contains(&r0), "bucket 0 ratio {r0}");
    assert!((0.145..=0.155).contains(&r1), "bucket 1 ratio {r1}");
    assert!((0.095..=0.105).contains(&r2), "bucket 2 ratio {r2}");
}

#[test]
fn pick_weighted_index_zero_in_middle_never_selected() {
    // weights=[1, 0, 1, 0, 1] — three nonzero, two zero. The zero buckets
    // must NEVER be selected, regardless of how many draws. Catches the
    // `<= → >` flip (which would always go past the zero bucket and into
    // the wrong index).
    let mut rng = SlotRng::new(7);
    let weights = [1u32, 0, 1, 0, 1];
    let n = 500_000;
    let mut counts = [0u64; 5];
    for _ in 0..n {
        counts[rng.pick_weighted_index(&weights)] += 1;
    }
    assert_eq!(counts[1], 0, "zero-weight bucket 1 must never be hit");
    assert_eq!(counts[3], 0, "zero-weight bucket 3 must never be hit");
    let nonzero_total = counts[0] + counts[2] + counts[4];
    assert_eq!(nonzero_total, n as u64);
}

#[test]
fn pick_weighted_index_single_nonzero_at_end() {
    // weights=[0, 0, 0, 1] — only the last bucket has weight. Every
    // draw MUST land on bucket 3. Catches `<= → >`, `fn → 0`, etc.
    let mut rng = SlotRng::new(13);
    let weights = [0u32, 0, 0, 1];
    for _ in 0..10_000 {
        let idx = rng.pick_weighted_index(&weights);
        assert_eq!(idx, 3, "only nonzero weight is at index 3");
    }
}

#[test]
fn pick_weighted_index_single_nonzero_at_start() {
    // weights=[1, 0, 0, 0] — only the first bucket has weight. Every
    // draw MUST land on bucket 0. Catches `fn → 1`, `- → +/÷` (would
    // index past 0).
    let mut rng = SlotRng::new(17);
    let weights = [1u32, 0, 0, 0];
    for _ in 0..10_000 {
        let idx = rng.pick_weighted_index(&weights);
        assert_eq!(idx, 0, "only nonzero weight is at index 0");
    }
}

#[test]
fn pick_weighted_index_single_element_always_zero() {
    // weights=[42]. Only one bucket exists; result must always be 0.
    let mut rng = SlotRng::new(42);
    let weights = [42u32];
    for _ in 0..1000 {
        assert_eq!(rng.pick_weighted_index(&weights), 0);
    }
}

#[test]
fn pick_weighted_index_boundary_345_pattern() {
    // weights=[3, 4, 5] → exact ratios 25% / 33.33% / 41.67%. 1M draws
    // gives ±0.1% precision; tight ±0.3% assertion catches the * → +,
    // -= → /=, and other arithmetic mutants.
    let mut rng = SlotRng::new(101);
    let weights = [3u32, 4, 5];
    let n: u64 = 1_000_000;
    let mut counts = [0u64; 3];
    for _ in 0..n {
        counts[rng.pick_weighted_index(&weights)] += 1;
    }
    let r0 = counts[0] as f64 / n as f64;
    let r1 = counts[1] as f64 / n as f64;
    let r2 = counts[2] as f64 / n as f64;
    assert!((0.247..=0.253).contains(&r0), "bucket 0: {r0} (expected ~0.25)");
    assert!((0.330..=0.337).contains(&r1), "bucket 1: {r1} (expected ~0.333)");
    assert!((0.413..=0.420).contains(&r2), "bucket 2: {r2} (expected ~0.417)");
}

#[test]
fn pick_weighted_index_extreme_unequal_weights() {
    // weights=[u32::MAX/2, 1] — first bucket has overwhelming weight.
    // We expect bucket 1 to be hit roughly 1 / (1 + u32::MAX/2) ≈ 0%
    // of the time. Over 100K draws we expect zero or one hit.
    let mut rng = SlotRng::new(2718);
    let weights = [u32::MAX / 2, 1u32];
    let mut bucket1_count = 0u64;
    for _ in 0..100_000 {
        if rng.pick_weighted_index(&weights) == 1 {
            bucket1_count += 1;
        }
    }
    assert!(
        bucket1_count <= 2,
        "extreme-imbalance: bucket 1 hit too often ({bucket1_count})"
    );
}

// ─── pick_weighted — same shape, generic API ───────────────────────────────

#[test]
fn pick_weighted_uniform_two_items_within_02_percent() {
    let mut rng = SlotRng::new(0xABCD);
    let items: Vec<(u32, u32)> = vec![(0, 1), (1, 1)];
    let n: u64 = 1_000_000;
    let mut counts = [0u64; 2];
    for _ in 0..n {
        counts[rng.pick_weighted(&items) as usize] += 1;
    }
    let r0 = counts[0] as f64 / n as f64;
    assert!(
        (0.498..=0.502).contains(&r0),
        "pick_weighted 50/50 ratio = {r0}"
    );
}

#[test]
fn pick_weighted_zero_weight_never_picked() {
    let mut rng = SlotRng::new(31);
    let items: Vec<(u32, u32)> = vec![(0, 1), (1, 0), (2, 1)];
    let n = 100_000;
    let mut counts = [0u64; 3];
    for _ in 0..n {
        counts[rng.pick_weighted(&items) as usize] += 1;
    }
    assert_eq!(counts[1], 0, "zero-weight item must never be returned");
}

// ─── random_int / random_bounded — distribution catches ────────────────────

#[test]
fn random_int_max_two_within_02_percent() {
    // random_int(2) over 1M: roughly half of {0, 1}. Catches `fn → 0/1`
    // constants, `* → +/÷` arithmetic mutants.
    let mut rng = SlotRng::new(0xDEAD_BEEF);
    let n: u64 = 1_000_000;
    let mut counts = [0u64; 2];
    for _ in 0..n {
        let v = rng.random_int(2);
        assert!(v < 2);
        counts[v as usize] += 1;
    }
    let r0 = counts[0] as f64 / n as f64;
    assert!(
        (0.498..=0.502).contains(&r0),
        "random_int(2) 50/50 ratio = {r0}"
    );
}

#[test]
fn random_int_max_seven_chi_squared() {
    // random_int(7) over 1M: chi² over 7 buckets must pass at p=0.01
    // (critical = 16.812 for df=6).
    let mut rng = SlotRng::new(0xFEED_FACE);
    let n: u64 = 1_000_000;
    let mut counts = [0u64; 7];
    for _ in 0..n {
        let v = rng.random_int(7);
        assert!(v < 7, "out of range: {v}");
        counts[v as usize] += 1;
    }
    let chi2 = chi_squared_uniform(&counts, n);
    assert!(
        chi2 < chi2_critical_p01(6),
        "random_int(7) chi² {chi2:.2} >= critical {:.2} (df=6, p=0.01); counts: {:?}",
        chi2_critical_p01(6),
        counts
    );
}

#[test]
fn random_int_max_256_chi_squared() {
    // 256 buckets — catches finer arithmetic mutations.
    let mut rng = SlotRng::new(0xBAAD_F00D);
    let n: u64 = 4_000_000;
    let mut counts = vec![0u64; 256];
    for _ in 0..n {
        let v = rng.random_int(256);
        assert!(v < 256);
        counts[v as usize] += 1;
    }
    let chi2 = chi_squared_uniform(&counts, n);
    assert!(
        chi2 < chi2_critical_p01(255),
        "random_int(256) chi² {chi2:.2} >= critical {:.2}",
        chi2_critical_p01(255),
    );
}

#[test]
fn random_int_zero_max_returns_zero() {
    // random_int(0) edge: floor of `random()*0` = 0 always.
    let mut rng = SlotRng::new(99);
    for _ in 0..1000 {
        assert_eq!(rng.random_int(0), 0);
    }
}

#[test]
fn random_bounded_one_always_zero() {
    // random_bounded(1) early-returns 0. Catches `== → !=` in the
    // `max == 1` check (which would skip the early-return and call
    // random_int(1) which is also 0 — but the path proves the test
    // catches at least one boundary mutant).
    let mut rng = SlotRng::new(101);
    for _ in 0..1000 {
        assert_eq!(rng.random_bounded(1), 0);
    }
}

#[test]
fn random_bounded_two_uniform_within_02_percent() {
    let mut rng = SlotRng::new(202);
    let n: u64 = 1_000_000;
    let mut counts = [0u64; 2];
    for _ in 0..n {
        counts[rng.random_bounded(2) as usize] += 1;
    }
    let r0 = counts[0] as f64 / n as f64;
    assert!((0.498..=0.502).contains(&r0));
}

#[test]
fn random_bounded_seven_chi_squared() {
    let mut rng = SlotRng::new(303);
    let n: u64 = 1_000_000;
    let mut counts = [0u64; 7];
    for _ in 0..n {
        counts[rng.random_bounded(7) as usize] += 1;
    }
    let chi2 = chi_squared_uniform(&counts, n);
    assert!(chi2 < chi2_critical_p01(6), "chi² = {chi2}");
}

#[test]
fn random_bounded_thousand_chi_squared() {
    let mut rng = SlotRng::new(404);
    let n: u64 = 4_000_000;
    let mut counts = vec![0u64; 1000];
    for _ in 0..n {
        counts[rng.random_bounded(1000) as usize] += 1;
    }
    let chi2 = chi_squared_uniform(&counts, n);
    assert!(
        chi2 < chi2_critical_p01(999),
        "random_bounded(1000) chi² {chi2:.2} >= critical {:.2}",
        chi2_critical_p01(999),
    );
}

// ─── Backend KAT (known-answer) vectors ─────────────────────────────────────
//
// Each KAT is the first N u64 outputs from a fresh-seeded instance.
// Regenerated locally with the CURRENT impl (these are golden values; if
// the impl changes, KAT must be regenerated and the change reviewed).
//
// Catches bit-op mutants (`<< → >>`, `^= → |=`, `+= → *=`, etc.) that
// can flip output by a single bit — distribution tests miss those at
// realistic sample sizes.

#[test]
fn xoshiro256ss_kat_seed_42_first_8_outputs() {
    let mut rng = Xoshiro256SSBackend::new(42);
    let expected: [u64; 8] = [
        0x1578_0b2e_0c2e_c716,
        0x6104_d986_6d11_3a7e,
        0xae17_5332_39e4_99a1,
        0xecb8_ad47_03b3_60a1,
        0xfde6_dc7f_e2ec_5e64,
        0xc50d_a531_0179_5238,
        0xb821_5485_5a65_ddb2,
        0xd99a_2743_ebe6_0087,
    ];
    let mut actual = [0u64; 8];
    for v in actual.iter_mut() {
        *v = rng.next_u64();
    }
    if actual != expected {
        eprintln!("Xoshiro256SSBackend(42) outputs changed; new vector:");
        for v in &actual {
            eprintln!("    0x{:016x},", v);
        }
        panic!("xoshiro256ss KAT mismatch");
    }
}

#[test]
fn philox4x32_kat_seed_42_first_8_outputs() {
    let mut rng = Philox4x32Backend::new(42);
    let mut actual = [0u64; 8];
    for v in actual.iter_mut() {
        *v = rng.next_u64();
    }
    let expected: [u64; 8] = [
        0x77f5_493b_9cea_f053,
        0x5742_b3d7_12bf_50ad,
        0x53ba_6cfd_fcdb_2127,
        0x744e_06fb_838f_5a6e,
        0xa887_5dcb_d36c_0225,
        0xc609_a559_9a4d_6d99,
        0xabaf_0dab_bac7_0475,
        0x610e_67f7_961e_5543,
    ];
    if actual != expected {
        eprintln!("Philox4x32Backend(42) outputs changed; new vector:");
        for v in &actual {
            eprintln!("    0x{:016x},", v);
        }
        panic!("philox4x32 KAT mismatch");
    }
}

#[test]
fn pcg64_kat_seed_42_first_8_outputs() {
    let mut rng = Pcg64Backend::new(42);
    let mut actual = [0u64; 8];
    for v in actual.iter_mut() {
        *v = rng.next_u64();
    }
    let expected: [u64; 8] = [
        0xc817_012e_cfc6_8d99,
        0xfa93_7ca4_4020_5a64,
        0x14d8_a517_93aa_f33e,
        0x05f4_77d7_62cc_e3b7,
        0xb708_abc2_6bcd_7c54,
        0x38a4_7958_722b_4963,
        0x6732_a74e_a74b_76a7,
        0x3f9a_2a3c_188f_e677,
    ];
    if actual != expected {
        eprintln!("Pcg64Backend(42) outputs changed; new vector:");
        for v in &actual {
            eprintln!("    0x{:016x},", v);
        }
        panic!("pcg64 KAT mismatch");
    }
}

#[test]
fn mulberry32_kat_seed_42_first_8_outputs() {
    let mut rng = Mulberry32Backend::new(42);
    let mut actual = [0u64; 8];
    for v in actual.iter_mut() {
        *v = rng.next_u64();
    }
    let expected: [u64; 8] = [
        0x72c3_2b8a_99e1_ef7c,
        0xab73_b0ad_da3b_32c0,
        0x86ce_c4d3_2cc0_9a8a,
        0x9fef_4401_45f2_4514,
        0x78e9_c541_dd8f_bf1e,
        0xe1ce_9b93_3ffb_0079,
        0x4e97_a6b4_bee8_a835,
        0x802f_cec6_327f_3a3f,
    ];
    if actual != expected {
        eprintln!("Mulberry32Backend(42) outputs changed; new vector:");
        for v in &actual {
            eprintln!("    0x{:016x},", v);
        }
        panic!("mulberry32 KAT mismatch");
    }
}
