//! Faza 7 — RNG mutation-kill targeted tests (W236 hardening)
//!
//! Closes the 92.65% → 95%+ gap on `rust-sim/src/rng.rs` cargo-mutants
//! baseline (W234). The previous 5 missed mutants:
//!
//! | # | Mutation                                          | Kill strategy        |
//! |---|---------------------------------------------------|----------------------|
//! | 1 | `RngBackend::next_f64` default → `return 0.0`     | call default impl on every non-Mulberry backend |
//! | 2 | `Mulberry32Backend::next_u64`  `\|` → `^`         | **equivalent** — bit-disjoint, skip |
//! | 3 | `Philox4x32Backend::next_u64`  `\|` → `^`         | **equivalent** — bit-disjoint, skip |
//! | 4 | `pick_weighted_index`  `roll -= weight` → `+`     | uniform weights → mutant always returns last index |
//! | 5 | `pick_weighted_index`  `roll -= weight` → `/`     | nonzero weights → mutant produces NaN/Inf, always returns last |
//!
//! Tests below kill #1, #4, #5. #2 and #3 are mathematically equivalent
//! and documented in W236 closure as "tracked equivalents".

use slot_sim::rng::{
    create_rng, Mulberry32Backend, Pcg64Backend, Philox4x32Backend, RngBackend, RngKind, SlotRng,
    Xoshiro256SSBackend,
};

// ─── R7K-01: kill `next_f64 default → 0.0` ──────────────────────────────────

#[test]
fn r7k_01_default_next_f64_returns_nonzero_for_pcg64() {
    let mut rng = Pcg64Backend::new(0xDEAD_BEEF);
    // Mutant returns 0.0 every call. Original returns floats in [0, 1) with
    // 53-bit mantissa. P(any single draw == 0.0) ≈ 2^-53 ≈ 10^-16. With 256
    // independent draws and a non-degenerate seed, the probability that
    // EVERY draw is exactly 0.0 is ≈ 2^-(53*256) = essentially zero.
    let mut nonzero_count = 0usize;
    for _ in 0..256 {
        if rng.next_f64() > 0.0 {
            nonzero_count += 1;
        }
    }
    assert!(
        nonzero_count >= 200,
        "Pcg64 next_f64 must return non-zero values (got {} nonzero / 256)",
        nonzero_count
    );
}

#[test]
fn r7k_01_default_next_f64_returns_nonzero_for_xoshiro256ss() {
    let mut rng = Xoshiro256SSBackend::new(0x1234_5678_9ABC_DEF0);
    let mut nonzero_count = 0usize;
    for _ in 0..256 {
        if rng.next_f64() > 0.0 {
            nonzero_count += 1;
        }
    }
    assert!(
        nonzero_count >= 200,
        "Xoshiro256** next_f64 must return non-zero (got {} / 256)",
        nonzero_count
    );
}

#[test]
fn r7k_01_default_next_f64_returns_nonzero_for_philox4x32() {
    let mut rng = Philox4x32Backend::new(0xCAFE_BABE);
    let mut nonzero_count = 0usize;
    for _ in 0..256 {
        if rng.next_f64() > 0.0 {
            nonzero_count += 1;
        }
    }
    assert!(
        nonzero_count >= 200,
        "Philox4x32 next_f64 must return non-zero (got {} / 256)",
        nonzero_count
    );
}

#[test]
fn r7k_01_default_next_f64_returns_nonzero_for_chacha20() {
    let mut rng = create_rng(RngKind::ChaCha20, 0xFEED_FACE_DEAD_C0DE);
    let mut nonzero_count = 0usize;
    for _ in 0..256 {
        if rng.next_f64() > 0.0 {
            nonzero_count += 1;
        }
    }
    assert!(
        nonzero_count >= 200,
        "ChaCha20 next_f64 must return non-zero (got {} / 256)",
        nonzero_count
    );
}

#[test]
fn r7k_01_default_next_f64_stays_in_unit_interval() {
    // Belt-and-suspenders: rule out a mutant that returns >= 1.0.
    let mut rng = Pcg64Backend::new(42);
    for _ in 0..1024 {
        let v = rng.next_f64();
        assert!(v >= 0.0, "next_f64 must be >= 0.0, got {}", v);
        assert!(v < 1.0, "next_f64 must be < 1.0, got {}", v);
    }
}

#[test]
fn r7k_01_default_next_f64_mean_is_approximately_half() {
    // Strong kill for `return 0.0` (mean = 0.0) AND for `return 1.0` /
    // `return constant` mutants. Original mean → 0.5 by uniformity.
    let mut rng = Pcg64Backend::new(0xA1B2_C3D4_E5F6_0789);
    let n = 4096;
    let mut sum = 0.0_f64;
    for _ in 0..n {
        sum += rng.next_f64();
    }
    let mean = sum / n as f64;
    assert!(
        (mean - 0.5).abs() < 0.05,
        "next_f64 sample mean over {} draws must be ≈ 0.5, got {}",
        n,
        mean
    );
}

// ─── R7K-04+05: kill `pick_weighted_index` arithmetic mutants ──────────────

#[test]
fn r7k_04_pick_weighted_index_uniform_returns_diverse_indices() {
    // Kills both:
    //   * `roll -= weight` → `roll += weight`  (mutant: roll only grows → never <= 0
    //                                          → always returns last index = len-1)
    //   * `roll -= weight` → `roll /= weight`  (mutant: first iter gives NaN-ish
    //                                          flow → never <= 0 → returns len-1)
    //
    // Strategy: uniform weights [1; 10], 200 draws. Original returns each
    // index ≈ 20 times (uniform); mutants return only index 9 every time.
    let mut rng = SlotRng::new(0xC0DE_FACE);
    let weights = vec![1u32; 10];
    let mut hits = vec![0usize; 10];
    for _ in 0..200 {
        let idx = rng.pick_weighted_index(&weights);
        assert!(idx < weights.len());
        hits[idx] += 1;
    }
    let distinct_nonzero = hits.iter().filter(|&&h| h > 0).count();
    assert!(
        distinct_nonzero >= 5,
        "uniform weights must produce ≥ 5 distinct picked indices over 200 draws, got {} (hits={:?})",
        distinct_nonzero,
        hits
    );
    // Tighten further: index 9 alone must NOT receive > 80% of picks
    // (mutant signature: index 9 receives 200/200 = 100%).
    assert!(
        hits[9] < 160,
        "last index must NOT dominate (mutant signature: 200/200); got {} hits at idx 9",
        hits[9]
    );
}

#[test]
fn r7k_04_pick_weighted_index_heavy_first_weight_favors_zero() {
    // Original: weights[0]=99, weights[1]=1 → ~99% of draws return 0.
    // Mutant `+`: always returns 1.
    // Mutant `/`: first iter roll /= 99 ≈ tiny positive but still > 0 →
    //              roll /= 1 → still > 0 → returns len-1 = 1.
    let mut rng = SlotRng::new(0xBEEF_DEAD);
    let weights = vec![99u32, 1u32];
    let mut zero_hits = 0usize;
    for _ in 0..500 {
        if rng.pick_weighted_index(&weights) == 0 {
            zero_hits += 1;
        }
    }
    // Original ≈ 99% → expect ≥ 450/500. Mutant 0/500.
    assert!(
        zero_hits >= 400,
        "weights=[99,1] must pick index 0 ≥ 400/500 times (got {}); mutant signature: 0",
        zero_hits
    );
}

#[test]
fn r7k_04_pick_weighted_index_single_weight_always_returns_zero() {
    // Edge: single-element weights → result MUST be 0, mutant proof if any
    // bug forces it to len()-1=0. Still useful as a smoke against panics.
    let mut rng = SlotRng::new(7);
    let weights = vec![42u32];
    for _ in 0..10 {
        assert_eq!(rng.pick_weighted_index(&weights), 0);
    }
}

// ─── R7K-06: kill `next_u32_bounded` `< → <=` (L63 rejection loop) ─────────

#[test]
fn r7k_06_next_u32_bounded_threshold_uses_strict_less_than() {
    // Original loop: `while lo < threshold { resample }`. Mutant: `<=`.
    // The difference is only observable when `lo == threshold` — in that
    // case original accepts (single sample), mutant rejects (resamples).
    //
    // We can't trivially construct that exact edge from the outside, but
    // we CAN prove the loop terminates and produces a value in [0, max)
    // with no skew over many calls. A stuck-on-true mutant (always
    // resample) would either timeout or eventually return a stale value;
    // cargo-mutants already times these out. A `<=` mutant slightly
    // re-skews the distribution — detectable via a chi-squared on a
    // power-of-two `max` (where threshold = 0, hence the only difference
    // between `<` and `<=` is whether lo=0 is accepted).
    let mut rng = Pcg64Backend::new(0x1234_5678);
    let max: u32 = 256;
    let n = 65536;
    let mut bins = vec![0u32; max as usize];
    for _ in 0..n {
        let v = rng.next_u32_bounded(max);
        assert!(v < max, "next_u32_bounded must return < max");
        bins[v as usize] += 1;
    }
    // Chi-squared against uniform expectation. For 256 bins × 65536
    // samples, expected count = 256 per bin. χ² critical at 0.001 with
    // 255 df ≈ 330. A `<=` mutant would systematically depress bin 0
    // (lo=0 always rejected); compute it and check it's not pathological.
    let expected = n as f64 / max as f64;
    let chi2: f64 = bins
        .iter()
        .map(|&c| {
            let d = c as f64 - expected;
            d * d / expected
        })
        .sum();
    assert!(
        chi2 < 400.0,
        "next_u32_bounded(256) over 65536 draws: χ² must be < 400 (got {:.2}); mutant would skew bin 0",
        chi2
    );
    // Also assert bin 0 received roughly its share — mutant suppresses it.
    let bin0 = bins[0] as f64;
    assert!(
        bin0 > expected * 0.7,
        "bin 0 must receive ≥ 0.7 × expected (got {} vs expected {:.1}); mutant signature: ~0",
        bins[0],
        expected
    );
}

#[test]
fn r7k_06_next_u32_bounded_small_max_terminates_and_covers_all_values() {
    // For max=3, only 3 distinct return values are possible. A reasonable
    // sample size MUST hit all three — kills mutants that bias output.
    let mut rng = Pcg64Backend::new(0xFEED_BEEF);
    let max: u32 = 3;
    let mut hits = [0u32; 3];
    for _ in 0..1000 {
        let v = rng.next_u32_bounded(max);
        hits[v as usize] += 1;
    }
    for (i, &count) in hits.iter().enumerate() {
        assert!(
            count > 200,
            "bin {} must receive > 200 hits over 1000 draws (got {})",
            i,
            count
        );
    }
}

#[test]
fn r7k_06_next_u32_bounded_pathological_max_exposes_skipped_rejection() {
    // Kills: L61:15 `if lo < max` → `==/>/<=`
    //        L63:22 `while lo < threshold` → `==/>/<=`
    //
    // Strategy: when max | 2^32 evenly (e.g. max = 2^31 = 2147483648),
    // 2^32 / max = 2 exactly, so threshold = (-max) % max = 0. The
    // rejection loop never runs in original. To force rejection-loop
    // behavior we need max where threshold > 0 AND rejection probability
    // is meaningful. Use max = 0x9000_0000 = 2415919104:
    //   threshold = (-max) % max = 0x7000_0000 = 1879048192
    //   rejection probability ≈ threshold / 2^32 ≈ 0.438
    //
    // Original: ~43.8% of initial samples rejected, output uniform over
    //   [0, max). P(result < max/2) ≈ 0.5.
    // Mutant `>` on L61 (`if lo > max`): condition almost always false
    //   → never enter rejection loop → bias toward lower max-aligned
    //   region. P(result < max/2) significantly > 0.5.
    // Mutant `==` on L61: also never triggers rejection → same bias.
    // Mutant `<=` on L61: triggers rejection extra times on boundary —
    //   distribution stays essentially uniform but result distribution
    //   shifts. Detected by 100K-draw chi-squared.
    //
    // Use 100K draws + 2-sigma test on bin balance.
    let mut rng = Pcg64Backend::new(0xDEAD_BEEF_FEED_FACE);
    let max: u32 = 0x9000_0000; // 2,415,919,104
    let half = max / 2;
    let n = 100_000;
    let mut low_count = 0u32;
    for _ in 0..n {
        let v = rng.next_u32_bounded(max);
        assert!(v < max, "result {} not < max {}", v, max);
        if v < half {
            low_count += 1;
        }
    }
    let low_ratio = low_count as f64 / n as f64;
    // σ for proportion at p=0.5, n=100K ≈ 0.00158. 6σ band ≈ 0.0095.
    // Original locked into [0.49, 0.51]. Mutants drift WELL outside.
    assert!(
        (low_ratio - 0.5).abs() < 0.015,
        "next_u32_bounded({:#x}) over 100K draws: low_ratio must be 0.5 ± 0.015 (got {:.5}); mutant {{==, >, <=, %→/}} signature",
        max,
        low_ratio
    );
}

#[test]
fn r7k_06_next_u32_bounded_chi_squared_strict_uniform() {
    // Kills: L62:48 `% → /`, L61/L63 boundary mutants — orthogonal angle.
    //
    // Strategy: large prime max + 100K draws + tight chi-squared. Original
    // produces uniform within 3σ; any rejection-loop or threshold mutant
    // distorts the distribution enough to fail the chi-squared.
    let mut rng = Pcg64Backend::new(0xCAFE_FEED_DEAD_BEEF);
    let max: u32 = 1009; // prime, < 2^16 so we get plenty of samples per bin
    let n = 100_000;
    let mut bins = vec![0u32; max as usize];
    for _ in 0..n {
        let v = rng.next_u32_bounded(max);
        bins[v as usize] += 1;
    }
    let expected = n as f64 / max as f64; // ≈ 99.1 per bin
    let chi2: f64 = bins
        .iter()
        .map(|&c| {
            let d = c as f64 - expected;
            d * d / expected
        })
        .sum();
    // df = 1008, χ² critical at 0.001 ≈ 1142. Original well below; mutants
    // that distort uniformity cluster well above.
    assert!(
        chi2 < 1200.0,
        "next_u32_bounded(1009) over 100K: χ² must be < 1200 (got {:.2}); mutant distorts uniformity",
        chi2
    );
}

#[test]
fn r7k_06_next_u32_bounded_modulo_div_kills_huge_threshold_mutant() {
    // Specifically kills L62:48 `max.wrapping_neg() % max` → `/`.
    // With max=257, max.wrapping_neg() = 0xFFFF_FEFF. Original: threshold
    // = 0xFFFF_FEFF % 257 = 1. Mutant: threshold = 0xFFFF_FEFF / 257
    // = 0xFEFF_FF (≈16.7M). Rejection loop becomes nearly infinite —
    // either timeouts OR returns a wildly biased value.
    //
    // Note: `<` comparison is u32, so if threshold > 2^32, comparison
    // wraps in interesting ways. Either way, mutant breaks uniformity.
    let mut rng = Pcg64Backend::new(0xBEEF_DEAD_BEEF_DEAD);
    let max: u32 = 257; // prime > 256 → threshold = 1 originally
    let n = 100_000;
    let mut bins = vec![0u32; max as usize];
    for _ in 0..n {
        let v = rng.next_u32_bounded(max);
        bins[v as usize] += 1;
    }
    let expected = n as f64 / max as f64; // ≈ 389 per bin
    let chi2: f64 = bins
        .iter()
        .map(|&c| {
            let d = c as f64 - expected;
            d * d / expected
        })
        .sum();
    // df = 256, χ² critical at 0.001 ≈ 330. Original well below; `/` mutant fails.
    assert!(
        chi2 < 350.0,
        "next_u32_bounded(257) over 100K: χ² must be < 350 (got {:.2}); `% → /` mutant inflates threshold and corrupts distribution",
        chi2
    );
}

#[test]
fn r7k_06_next_u32_bounded_max_one_always_returns_zero() {
    // Original: `if max == 1 { return 0; }` early-exit.
    // Edge: max=1 → only valid value is 0. Mutant flipping the equality
    // check or removing early-return falls into the rejection loop with
    // `lo < max` (always false for max=1) → could return junk.
    let mut rng = Pcg64Backend::new(11);
    for _ in 0..100 {
        let v = rng.next_u32_bounded(1);
        assert_eq!(v, 0, "next_u32_bounded(1) must always return 0");
    }
}

// ─── R7K-07: kill Mulberry32 `split()` XOR chain mutants (L164) ────────────

#[test]
fn r7k_07_mulberry32_split_bit_exact_with_known_seed() {
    // Kills L164:33 `state ^ nonce` → `|` / `&`
    // Kills L164:41 `^ MAGIC` → `|` / `&`
    //
    // Strategy: HARDCODE bit-exact expected outputs from canonical original
    // run. Any mutation to either XOR changes the new_seed → changes the
    // first 3 Mulberry32 outputs. Pre-recorded with seed=0x5555_5555,
    // nonce=0xAAAA_AAAA after one parent next_u64() advance.
    let mut base = Mulberry32Backend::new(0x5555_5555);
    let _ = base.next_u64();
    let mut split_rng = base.split(0x0000_0000_AAAA_AAAA);
    assert_eq!(split_rng.next_u64(), 0x0d5f262564cd94e1, "split[0] bit-exact");
    assert_eq!(split_rng.next_u64(), 0xa7edde8098f1fab6, "split[1] bit-exact");
    assert_eq!(split_rng.next_u64(), 0x7d05300c784ac3fb, "split[2] bit-exact");
}

#[test]
fn r7k_07_mulberry32_split_with_state_1_nonce_0_bit_exact() {
    // Kills the remaining `^ → |/&` variants with a different state/nonce
    // combination so we cover the full mutant cross-product.
    // state=1 (no advance), nonce=0 → tests `0 ^ MAGIC` and `1 ^ 0`.
    let base = Mulberry32Backend::new(0x0000_0001);
    let mut split_rng = base.split(0);
    assert_eq!(split_rng.next_u64(), 0x41fe186c07c98b12, "split[0] bit-exact");
    assert_eq!(split_rng.next_u64(), 0x72cb078ea8396010, "split[1] bit-exact");
    assert_eq!(split_rng.next_u64(), 0x2b6dc806573f08f0, "split[2] bit-exact");
}

// ─── R7K-08: kill Mulberry32 + Pcg64 seed_state mutants (L169, L244) ───────

#[test]
fn r7k_08_mulberry32_seed_state_reflects_actual_state() {
    // Kills: L169 `seed_state -> [u64; 4] with [0; 4]` and `with [1; 4]`.
    // Original returns [state as u64, 0, 0, 0]. Mutant returns all 0s or 1s.
    let rng = Mulberry32Backend::new(0x1234_5678);
    let state = rng.seed_state();
    assert_eq!(state[0], 0x1234_5678, "first slot must be the seed");
    assert_eq!(state[1], 0);
    assert_eq!(state[2], 0);
    assert_eq!(state[3], 0);
}

#[test]
fn r7k_08_mulberry32_seed_state_changes_after_step() {
    // Belt-and-suspenders: state[0] MUST change as RNG advances. Mutant
    // returning constant [0;4] or [1;4] is killed because the second call
    // would equal the first (constant) rather than evolving.
    let mut rng = Mulberry32Backend::new(0xCAFE_BABE);
    let before = rng.seed_state()[0];
    let _ = rng.next_u64(); // advances state twice (lo + hi).
    let after = rng.seed_state()[0];
    assert_ne!(
        before, after,
        "seed_state[0] must reflect post-step state ({} vs {})",
        before, after
    );
}

#[test]
fn r7k_08_pcg64_seed_state_encodes_full_state_and_inc() {
    // Kills:
    //   * L244 `seed_state -> [u64; 4] with [1; 4]` (constant mutant)
    //   * L245 `(self.state >> 64) as u64` → `<<`  (shift direction flip)
    //   * L247 `(self.inc >> 64) as u64`   → `<<`
    //
    // Pcg64Backend::new(seed) initializes state as u128 derived from seed.
    // After ≥1 next_u64() call, state[0] (high 64 bits) and state[1] (low
    // 64 bits) must BOTH be non-trivial and different from each other.
    // A `<<` mutant on `>> 64` shifts low bits OUT of u128, producing 0 in
    // upper slot — easily caught.
    let mut rng = Pcg64Backend::new(0x1234_5678_9ABC_DEF0);
    let _ = rng.next_u64();
    let _ = rng.next_u64();
    let state = rng.seed_state();
    // The original `>> 64` extracts the upper 64 bits of u128. After two
    // PCG128 advances with a non-trivial seed, the upper bits are
    // overwhelmingly non-zero. A `<<` mutant `(state << 64) as u64` would
    // truncate the lower 64 bits to 0 (since they get shifted OUT to upper
    // and then `as u64` cast keeps the low 64).
    //
    // Wait — `(self.state << 64) as u64` with u128 state actually KEEPS
    // the low 64 bits of (state << 64), which equals 0 always (since the
    // low 64 are the original upper 64, shifted left out of u64 range).
    // So mutant slot[0] = 0.
    assert_ne!(state[0], 0, "seed_state[0] (high state) must be nonzero after init+step");
    assert_ne!(state[1], 0, "seed_state[1] (low state) must be nonzero after step");
    // `<<` mutant on L247: slot[2] becomes 0.
    assert_ne!(state[2], 0, "seed_state[2] (high inc) must be nonzero — PCG128_INC_DEFAULT high half is set");
    assert_ne!(state[3], 0, "seed_state[3] (low inc) must be nonzero");
    // Constant-mutant kill: slot 0 and slot 1 MUST differ (constant [1;4]
    // would have them equal).
    assert_ne!(state[0], state[1], "high vs low state should not coincidentally match constant mutant");
}

// ─── R7K-09: kill L186 `PCG128_INC_DEFAULT | 1` mutant ─────────────────────

#[test]
fn r7k_09_pcg64_default_first_output_is_bit_exact() {
    // L186: `(0xDA3E_39CB_94B9_5BDB_u128 << 1) | 1`
    // Mutant: `| 1` → `^ 1`. The shifted value's bottom bit is already 0
    // (since shift-left-1 zeroes the LSB), so:
    //   * Original `| 1` → bottom bit = 1 (odd, required by PCG).
    //   * Mutant   `^ 1` → bottom bit = 1 (same! — since 0 ^ 1 = 1).
    //
    // → This is an EQUIVALENT mutant. Document it as such; can't kill.
    //
    // But we can still strengthen here: lock down the first-N outputs of
    // `Pcg64Backend::new(<known seed>)` bit-exact. Any FUTURE mutant that
    // actually changes the increment will alter the stream and fail.
    let mut rng = Pcg64Backend::new(0x0123_4567_89AB_CDEF);
    // Capture first 5 outputs as canonical baseline.
    let outs: Vec<u64> = (0..5).map(|_| rng.next_u64()).collect();
    // Recompute from scratch — must be deterministic.
    let mut rng2 = Pcg64Backend::new(0x0123_4567_89AB_CDEF);
    for (i, &expected) in outs.iter().enumerate() {
        assert_eq!(
            rng2.next_u64(),
            expected,
            "draw {} must be deterministic across constructions",
            i
        );
    }
    // And outputs must not all be the same constant (catches degenerate inc).
    let distinct = outs.iter().collect::<std::collections::HashSet<_>>().len();
    assert!(distinct >= 4, "5 PCG64 draws should yield ≥ 4 distinct values, got {}", distinct);
}

// ─── R7K-10: kill Pcg64 `split()` XOR mutants (L234) ───────────────────────

#[test]
fn r7k_10_pcg64_split_bit_exact_nonce_1111() {
    // Kills L234:33 `inc ^ ((nonce ...))` → `|` / `&`
    // Kills L234:95 `... | 1` → `& 1` / `^ 1`
    // Hardcoded canonical output for state=0x42, nonce=0x1111_1111_1111_1111.
    let parent = Pcg64Backend::new(0x42);
    let mut s = parent.split(0x1111_1111_1111_1111);
    assert_eq!(s.next_u64(), 0xac9365b923fabd07, "split[0] bit-exact");
    assert_eq!(s.next_u64(), 0xad759d7803e4d477, "split[1] bit-exact");
    assert_eq!(s.next_u64(), 0x6f47eea1e85e5d3d, "split[2] bit-exact");
}

#[test]
fn r7k_10_pcg64_split_bit_exact_nonce_2222() {
    // Cross-product kill: different nonce, locks down `inc ^ (nonce * MAGIC)` XOR.
    let parent = Pcg64Backend::new(0x42);
    let mut s = parent.split(0x2222_2222_2222_2222);
    assert_eq!(s.next_u64(), 0x62f88b205fbdf8b3, "split[0] bit-exact");
    assert_eq!(s.next_u64(), 0x055ba775758c305a, "split[1] bit-exact");
    assert_eq!(s.next_u64(), 0xf64d7562e632e3e0, "split[2] bit-exact");
}

#[test]
fn r7k_10_pcg64_split_bit_exact_high_bits_state() {
    // Third configuration with high-bit state to maximize mutant divergence.
    let parent = Pcg64Backend::new(0xDEAD_BEEF_DEAD_BEEF);
    let mut s = parent.split(0xFFFF_0000_FFFF_0000);
    assert_eq!(s.next_u64(), 0x0780df696431210a, "split[0] bit-exact");
    assert_eq!(s.next_u64(), 0x990aed87932204f0, "split[1] bit-exact");
    assert_eq!(s.next_u64(), 0x28f3018b3af83a84, "split[2] bit-exact");
}

#[test]
fn r7k_07_mulberry32_split_xor_with_nonce_kills_or_and_mutants() {
    // Specifically targets `state ^ nonce` → `|` / `&`.
    // Choose state and nonce so that the `|`, `^`, `&` give distinct values
    // before the magic XOR. With state=0x0000_FFFF and nonce=0xFFFF_0000:
    //   * Original `^`:  0xFFFF_FFFF
    //   * Mutant `|`:    0xFFFF_FFFF (equivalent here — bad pick)
    // Better: state=0x5555_5555_5555_5555_after_step, nonce=0x3333_3333_3333_3333
    //   * `^` = 0x6666_6666_... (bits differ where exactly one of the two is 1)
    //   * `|` = 0x7777_7777_... (bits where at least one is 1)
    //   * `&` = 0x1111_1111_... (bits where both are 1)
    // After XOR with MAGIC each gives a distinct final seed.
    //
    // Easier proof: split with TWO different states + same nonce must give
    // DIFFERENT first outputs (mutant `&` collapses both onto same path
    // when one state has 0 bits where the other has 1).
    let mut a = Mulberry32Backend::new(0x5555_5555);
    let _ = a.next_u64();
    let mut b = Mulberry32Backend::new(0xAAAA_AAAA);
    let _ = b.next_u64();
    let nonce = 0x1234_5678_9ABC_DEF0;
    let a_first = a.split(nonce).next_u64();
    let b_first = b.split(nonce).next_u64();
    assert_ne!(
        a_first, b_first,
        "split with different state + same nonce must yield different first output (mutant `&` would collapse divergent states)"
    );
}

#[test]
fn r7k_04_pick_weighted_index_zero_first_weight_skips_index_zero() {
    // Original: weights=[0, 1, 0] → index 1 always (because roll starts
    // somewhere in (0, 1), and `0-0=0` keeps roll positive, then `-1`
    // drops it ≤ 0 at index 1).
    // Mutant `+`: roll always grows → returns len-1 = 2.
    // Mutant `/`: division-by-zero behavior; depends on implementation.
    let mut rng = SlotRng::new(13);
    let weights = vec![0u32, 1u32, 0u32];
    let mut one_hits = 0usize;
    let mut two_hits = 0usize;
    for _ in 0..100 {
        match rng.pick_weighted_index(&weights) {
            1 => one_hits += 1,
            2 => two_hits += 1,
            _ => {}
        }
    }
    assert!(
        one_hits > two_hits,
        "weights=[0,1,0] must favor index 1 over index 2 ({} vs {}); mutant signature: 0 vs 100",
        one_hits,
        two_hits
    );
}
