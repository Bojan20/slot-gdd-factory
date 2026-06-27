//! P0 #3 — RNG certification harness.
//!
//! Two-mode binary that is the entry point for every regulator-grade RNG
//! quality test we ship evidence for:
//!
//! 1. **`--mode stream`** — write `--bytes` raw bytes to stdout. Used as the
//!    `--filein` source for TestU01 / PractRand / NIST STS via pipe or file.
//!
//!         cargo run --release --bin rng-cert -- --mode stream \
//!             --rng pcg64 --seed 12345 --bytes 1073741824 > pcg64-1GB.bin
//!
//!         RNG_test stdin64 < pcg64-1GB.bin                # PractRand
//!         testu01 SmallCrush pcg64-1GB.bin                # custom wrapper
//!         assess 1000000 < pcg64-1GB.bin                   # NIST STS
//!
//! 2. **`--mode internal`** — run a built-in statistical battery (subset of
//!    NIST SP 800-22) over a fresh stream of `--bytes` and emit a JSON
//!    report. Designed to be fast (≤ 5s per backend at 16 MiB) so it can
//!    run on every CI commit. NOT a substitute for BigCrush, but catches
//!    obvious regressions (a single-line edit that breaks Pcg64) before
//!    they ever ship.
//!
//!         cargo run --release --bin rng-cert -- --mode internal \
//!             --rng pcg64 --seed 12345 --bytes 16777216 \
//!             --out reports/rng-cert/pcg64-internal.json
//!
//! Internal tests run (all from NIST SP 800-22):
//!   - **Monobit** (frequency)
//!   - **Block-frequency** (M = 1024 bits)
//!   - **Runs**
//!   - **Longest-run** (within M = 10000 bit blocks)
//!   - **Byte-level chi²** (256-bucket uniformity)
//!   - **Serial** (2-bit overlapping pair distribution)
//!   - **Cumulative-sums** (forward random walk)
//!   - **Approximate-entropy** (m = 2)
//!
//! Each test yields a p-value; values < 0.01 fail the standard NIST
//! threshold. Results are written to a JSON file consumable by the
//! `reports/rng-cert/SUMMARY.md` generator.

use clap::{Parser, ValueEnum};
use serde::Serialize;
use slot_sim::rng::{create_rng, RngBackend, RngKind};
use std::io::{self, Write};
use std::path::PathBuf;

// ─── CLI ────────────────────────────────────────────────────────────────────

#[derive(Parser, Debug)]
#[command(name = "rng-cert", about = "RNG certification harness — P0 #3")]
struct Args {
    /// What to emit / measure.
    #[arg(long, value_enum)]
    mode: Mode,

    /// Which RNG backend.
    #[arg(long, value_enum)]
    rng: RngArg,

    /// Seed for the backend.
    #[arg(long, default_value_t = 12345)]
    seed: u64,

    /// Number of bytes to emit / consume.
    #[arg(long, default_value_t = 16 * 1024 * 1024)]
    bytes: usize,

    /// Where to write the JSON report (mode=internal). Default: stdout.
    #[arg(long)]
    out: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum Mode {
    Stream,
    Internal,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum RngArg {
    Mulberry32,
    Pcg64,
    Xoshiro256ss,
    Philox4x32,
    Chacha20,
}

impl RngArg {
    fn to_kind(self) -> RngKind {
        match self {
            RngArg::Mulberry32 => RngKind::Mulberry32,
            RngArg::Pcg64 => RngKind::Pcg64,
            RngArg::Xoshiro256ss => RngKind::Xoshiro256StarStar,
            RngArg::Philox4x32 => RngKind::Philox4x32,
            RngArg::Chacha20 => RngKind::ChaCha20,
        }
    }
    fn name(self) -> &'static str {
        match self {
            RngArg::Mulberry32 => "mulberry32",
            RngArg::Pcg64 => "pcg64",
            RngArg::Xoshiro256ss => "xoshiro256ss",
            RngArg::Philox4x32 => "philox4x32",
            RngArg::Chacha20 => "chacha20",
        }
    }
}

// ─── main ───────────────────────────────────────────────────────────────────

fn main() -> io::Result<()> {
    let args = Args::parse();
    let kind = args.rng.to_kind();
    let mut rng = create_rng(kind, args.seed);

    match args.mode {
        Mode::Stream => emit_stream(&mut *rng, args.bytes),
        Mode::Internal => {
            let report = run_internal_battery(args.rng.name(), args.seed, &mut *rng, args.bytes);
            let json = serde_json::to_string_pretty(&report)
                .map_err(|e| io::Error::other(format!("json serialize: {e}")))?;
            match args.out {
                Some(path) => {
                    if let Some(parent) = path.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    std::fs::write(path, json + "\n")?;
                }
                None => {
                    io::stdout().write_all(json.as_bytes())?;
                    io::stdout().write_all(b"\n")?;
                }
            }
            Ok(())
        }
    }
}

// ─── Stream mode ────────────────────────────────────────────────────────────

fn emit_stream(rng: &mut dyn RngBackend, bytes: usize) -> io::Result<()> {
    // 64 KiB stdout chunks for throughput. Each u64 yields 8 bytes (LE).
    let stdout = io::stdout();
    let mut out = stdout.lock();
    let chunk_words = 64 * 1024 / 8;
    let mut buf = vec![0u8; chunk_words * 8];
    let mut written = 0usize;
    while written < bytes {
        for w in 0..chunk_words {
            let v = rng.next_u64();
            buf[w * 8..w * 8 + 8].copy_from_slice(&v.to_le_bytes());
        }
        let remaining = bytes - written;
        let n = chunk_words * 8;
        let take = n.min(remaining);
        out.write_all(&buf[..take])?;
        written += take;
    }
    Ok(())
}

// ─── Internal battery ──────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct InternalReport {
    backend: String,
    seed: u64,
    bytes_consumed: usize,
    bit_count: usize,
    tests: Vec<TestResult>,
    /// All p-values ≥ 0.01 (NIST threshold).
    all_pass: bool,
}

#[derive(Debug, Serialize)]
pub struct TestResult {
    name: String,
    /// p-value of the test statistic.
    p_value: f64,
    /// True if `p_value >= 0.01` (NIST SP 800-22 threshold).
    pass: bool,
    /// Test-specific scalars for human inspection.
    detail: serde_json::Value,
}

fn run_internal_battery(
    backend: &str,
    seed: u64,
    rng: &mut dyn RngBackend,
    bytes: usize,
) -> InternalReport {
    // Materialize the stream once — most tests consume the bits multiple
    // ways but on the same sample.
    let mut bytes_buf = vec![0u8; bytes];
    fill_with_rng(rng, &mut bytes_buf);
    let bits = bytes_buf.len() * 8;

    let tests = vec![
        monobit(&bytes_buf),
        block_frequency(&bytes_buf, 1024),
        runs(&bytes_buf),
        longest_run(&bytes_buf, 10_000),
        byte_chi2(&bytes_buf),
        serial_2bit(&bytes_buf),
        cumulative_sums(&bytes_buf),
        approximate_entropy(&bytes_buf, 2),
    ];

    let all_pass = tests.iter().all(|t| t.pass);
    InternalReport {
        backend: backend.to_string(),
        seed,
        bytes_consumed: bytes,
        bit_count: bits,
        tests,
        all_pass,
    }
}

fn fill_with_rng(rng: &mut dyn RngBackend, buf: &mut [u8]) {
    let mut i = 0usize;
    while i + 8 <= buf.len() {
        let v = rng.next_u64();
        buf[i..i + 8].copy_from_slice(&v.to_le_bytes());
        i += 8;
    }
    if i < buf.len() {
        let v = rng.next_u64().to_le_bytes();
        let remaining = buf.len() - i;
        buf[i..].copy_from_slice(&v[..remaining]);
    }
}

// ─── NIST SP 800-22 sub-tests (pure-Rust implementations) ────────────────────
//
// These are correctness-checked against published reference vectors in
// `tests/faza7_rng_cert.rs`. They are deliberately simple — direct
// implementations of the SP 800-22 algorithm pseudocode — not optimized.

/// Monobit (NIST SP 800-22 §2.1). Tests whether #ones ≈ #zeros.
fn monobit(bytes: &[u8]) -> TestResult {
    let mut sum: i64 = 0;
    for &b in bytes {
        sum += (b.count_ones() as i64) * 2 - 8;
    }
    let n = (bytes.len() * 8) as f64;
    let s_obs = (sum as f64).abs() / n.sqrt();
    let p = erfc(s_obs / SQRT2);
    TestResult {
        name: "monobit".to_string(),
        p_value: p,
        pass: p >= 0.01,
        detail: serde_json::json!({ "S_n": sum, "s_obs": s_obs }),
    }
}

/// Block frequency (NIST §2.2). Bits split into M-bit blocks; each block's
/// proportion of ones is compared to 0.5 via chi².
fn block_frequency(bytes: &[u8], m: usize) -> TestResult {
    let bits = bits_iter(bytes).collect::<Vec<u8>>();
    let n = bits.len() / m;
    if n == 0 {
        return TestResult {
            name: "block_frequency".to_string(),
            p_value: 0.0,
            pass: false,
            detail: serde_json::json!({ "error": "too few bits for M" }),
        };
    }
    let mut chi2 = 0.0;
    for i in 0..n {
        let ones = bits[i * m..(i + 1) * m].iter().filter(|&&b| b == 1).count();
        let pi = ones as f64 / m as f64;
        chi2 += (pi - 0.5).powi(2);
    }
    chi2 *= 4.0 * m as f64;
    let p = chi2_p_value_upper(chi2, n as f64 / 2.0);
    TestResult {
        name: "block_frequency".to_string(),
        p_value: p,
        pass: p >= 0.01,
        detail: serde_json::json!({ "blocks": n, "M": m, "chi2": chi2 }),
    }
}

/// Runs test (NIST §2.3). Counts transitions and compares to expected.
fn runs(bytes: &[u8]) -> TestResult {
    let bits = bits_iter(bytes).collect::<Vec<u8>>();
    let n = bits.len() as f64;
    let ones = bits.iter().filter(|&&b| b == 1).count() as f64;
    let pi = ones / n;
    if (pi - 0.5).abs() >= 2.0 / n.sqrt() {
        return TestResult {
            name: "runs".to_string(),
            p_value: 0.0,
            pass: false,
            detail: serde_json::json!({ "error": "monobit precondition failed", "pi": pi }),
        };
    }
    let mut v: f64 = 1.0;
    for i in 0..bits.len() - 1 {
        if bits[i] != bits[i + 1] {
            v += 1.0;
        }
    }
    let numer = (v - 2.0 * n * pi * (1.0 - pi)).abs();
    let denom = 2.0 * (2.0 * n).sqrt() * pi * (1.0 - pi);
    let s_obs = numer / denom;
    let p = erfc(s_obs / SQRT2);
    TestResult {
        name: "runs".to_string(),
        p_value: p,
        pass: p >= 0.01,
        detail: serde_json::json!({ "V_n": v, "pi": pi, "s_obs": s_obs }),
    }
}

/// Longest-run-of-ones in blocks (NIST §2.4). M = 10000 → K = 6 categories
/// per SP 800-22 Table 2-4. Each block contributes 1 to v[k] where k is
/// the longest-run category for that block.
fn longest_run(bytes: &[u8], m: usize) -> TestResult {
    let bits = bits_iter(bytes).collect::<Vec<u8>>();
    let nblocks = bits.len() / m;
    if nblocks < 75 || m != 10_000 {
        return TestResult {
            name: "longest_run".to_string(),
            p_value: 0.0,
            pass: false,
            detail: serde_json::json!({ "error": "needs M=10000 and ≥75 blocks" }),
        };
    }
    // M=10000 categories: v[i] for longest-run-of-ones in {≤10, 11, 12, 13, 14, 15, ≥16}.
    let bounds = [10, 11, 12, 13, 14, 15]; // ≤ each yields its bucket; > 15 → last bucket.
    let mut v = [0u64; 7];
    for blk in 0..nblocks {
        let block = &bits[blk * m..(blk + 1) * m];
        let mut longest = 0usize;
        let mut current = 0usize;
        for &b in block {
            if b == 1 {
                current += 1;
                if current > longest {
                    longest = current;
                }
            } else {
                current = 0;
            }
        }
        let bucket = if longest <= bounds[0] {
            0
        } else if longest <= bounds[1] {
            1
        } else if longest <= bounds[2] {
            2
        } else if longest <= bounds[3] {
            3
        } else if longest <= bounds[4] {
            4
        } else if longest <= bounds[5] {
            5
        } else {
            6
        };
        v[bucket] += 1;
    }
    // Probabilities from SP 800-22 Table 2-5 (M=10000, K=6).
    let pi = [0.0882, 0.2092, 0.2483, 0.1933, 0.1208, 0.0675, 0.0727];
    let mut chi2 = 0.0;
    for i in 0..7 {
        let expected = nblocks as f64 * pi[i];
        chi2 += (v[i] as f64 - expected).powi(2) / expected;
    }
    let p = chi2_p_value_upper(chi2, 3.0); // df = K = 6 → α(K)/2 form gives df=6, but NIST uses 6 directly.
    TestResult {
        name: "longest_run".to_string(),
        p_value: p,
        pass: p >= 0.01,
        detail: serde_json::json!({ "v": v, "chi2": chi2, "M": m, "blocks": nblocks }),
    }
}

/// Byte-level chi² (uniformity over 256 buckets). Not in SP 800-22 but a
/// standard practitioner sanity check.
fn byte_chi2(bytes: &[u8]) -> TestResult {
    let mut counts = [0u64; 256];
    for &b in bytes {
        counts[b as usize] += 1;
    }
    let expected = bytes.len() as f64 / 256.0;
    let mut chi2 = 0.0;
    for c in counts.iter() {
        chi2 += (*c as f64 - expected).powi(2) / expected;
    }
    let p = chi2_p_value_upper(chi2, 255.0 / 2.0);
    TestResult {
        name: "byte_chi2".to_string(),
        p_value: p,
        pass: p >= 0.01,
        detail: serde_json::json!({ "chi2": chi2, "df": 255 }),
    }
}

/// Serial (NIST §2.11) with m=2: distribution of overlapping 2-bit patterns.
fn serial_2bit(bytes: &[u8]) -> TestResult {
    // For m=2 we have 4 patterns. Count overlapping pairs (bit i, bit i+1).
    let bits = bits_iter(bytes).collect::<Vec<u8>>();
    let n = bits.len();
    if n < 8 {
        return TestResult {
            name: "serial_2bit".to_string(),
            p_value: 0.0,
            pass: false,
            detail: serde_json::json!({ "error": "too few bits" }),
        };
    }
    let mut psi2_m = 0.0_f64;
    let mut counts2 = [0u64; 4];
    for i in 0..n - 1 {
        let pat = (bits[i] << 1) | bits[(i + 1) % n];
        counts2[pat as usize] += 1;
    }
    for c in counts2.iter() {
        psi2_m += (*c as f64).powi(2);
    }
    psi2_m = psi2_m * 4.0 / n as f64 - n as f64;
    let mut counts1 = [0u64; 2];
    for &b in &bits {
        counts1[b as usize] += 1;
    }
    let mut psi2_m1 = 0.0_f64;
    for c in counts1.iter() {
        psi2_m1 += (*c as f64).powi(2);
    }
    psi2_m1 = psi2_m1 * 2.0 / n as f64 - n as f64;
    let nabla = psi2_m - psi2_m1;
    let p = chi2_p_value_upper(nabla.abs(), 0.5); // df = 2^(m-1) = 2; SP 800-22 uses χ² with df=2^(m-1)=2.
    TestResult {
        name: "serial_2bit".to_string(),
        p_value: p,
        pass: p >= 0.01,
        detail: serde_json::json!({ "psi2_m": psi2_m, "psi2_m1": psi2_m1, "nabla": nabla }),
    }
}

/// Cumulative sums (NIST SP 800-22 §2.13). Forward random walk over the
/// bit stream. The p-value is the proper alternating-Φ series from the
/// NIST spec — not a Kolmogorov upper bound — so signatures of good
/// RNGs (Xoshiro256**, Pcg64) do not falsely fail.
fn cumulative_sums(bytes: &[u8]) -> TestResult {
    let bits = bits_iter(bytes).collect::<Vec<u8>>();
    let n = bits.len() as f64;
    let mut sum: i64 = 0;
    let mut max_abs: i64 = 0;
    for &b in &bits {
        sum += if b == 1 { 1 } else { -1 };
        if sum.abs() > max_abs {
            max_abs = sum.abs();
        }
    }
    let z = max_abs as f64;
    let sqrt_n = n.sqrt();

    // P = 1
    //    − Σ_{k=k_lo..k_hi}   [Φ((4k+1)z/√n) − Φ((4k−1)z/√n)]
    //    + Σ_{k=k2_lo..k_hi}  [Φ((4k+3)z/√n) − Φ((4k+1)z/√n)]
    // Bounds per SP 800-22:
    //   k_lo  = floor((-n/z + 1) / 4)
    //   k_hi  = floor(( n/z - 1) / 4)
    //   k2_lo = floor((-n/z - 3) / 4)
    let n_over_z = n / z;
    let k_lo = ((-n_over_z + 1.0) / 4.0).floor() as i64;
    let k_hi = ((n_over_z - 1.0) / 4.0).floor() as i64;
    let k2_lo = ((-n_over_z - 3.0) / 4.0).floor() as i64;

    let mut sum1 = 0.0_f64;
    for k in k_lo..=k_hi {
        let kk = k as f64;
        sum1 += norm_cdf((4.0 * kk + 1.0) * z / sqrt_n)
            - norm_cdf((4.0 * kk - 1.0) * z / sqrt_n);
    }
    let mut sum2 = 0.0_f64;
    for k in k2_lo..=k_hi {
        let kk = k as f64;
        sum2 += norm_cdf((4.0 * kk + 3.0) * z / sqrt_n)
            - norm_cdf((4.0 * kk + 1.0) * z / sqrt_n);
    }
    let p = (1.0 - sum1 + sum2).clamp(0.0, 1.0);

    TestResult {
        name: "cumulative_sums".to_string(),
        p_value: p,
        pass: p >= 0.01,
        detail: serde_json::json!({
            "max_abs": max_abs,
            "z_over_sqrt_n": z / sqrt_n,
            "k_lo": k_lo,
            "k_hi": k_hi,
        }),
    }
}

/// Standard normal CDF Φ(x) = (1 + erf(x/√2)) / 2.
fn norm_cdf(x: f64) -> f64 {
    0.5 * (1.0 + erf(x / SQRT2))
}

/// erf(x) = 1 − erfc(x). Derived from the same A&S 7.1.26 approximation.
fn erf(x: f64) -> f64 {
    1.0 - erfc(x)
}

/// Approximate entropy (NIST §2.12) for block length m.
fn approximate_entropy(bytes: &[u8], m: usize) -> TestResult {
    let bits = bits_iter(bytes).collect::<Vec<u8>>();
    let n = bits.len();
    if n < 1000 {
        return TestResult {
            name: "approximate_entropy".to_string(),
            p_value: 0.0,
            pass: false,
            detail: serde_json::json!({ "error": "too few bits" }),
        };
    }
    let phi_m = approx_phi(&bits, m);
    let phi_m1 = approx_phi(&bits, m + 1);
    let ap_en = phi_m - phi_m1;
    let chi2 = 2.0 * n as f64 * ((2_f64.ln()) - ap_en);
    let df = (1 << m) as f64 / 2.0;
    let p = chi2_p_value_upper(chi2, df);
    TestResult {
        name: "approximate_entropy".to_string(),
        p_value: p,
        pass: p >= 0.01,
        detail: serde_json::json!({ "ap_en": ap_en, "chi2": chi2, "m": m }),
    }
}

fn approx_phi(bits: &[u8], m: usize) -> f64 {
    let n = bits.len();
    let combos = 1usize << m;
    let mut counts = vec![0u64; combos];
    for i in 0..n {
        let mut idx = 0usize;
        for j in 0..m {
            idx = (idx << 1) | bits[(i + j) % n] as usize;
        }
        counts[idx] += 1;
    }
    let mut sum = 0.0;
    for c in counts {
        if c > 0 {
            let p = c as f64 / n as f64;
            sum += p * p.ln();
        }
    }
    sum
}

// ─── Stats helpers ──────────────────────────────────────────────────────────

const SQRT2: f64 = std::f64::consts::SQRT_2;

/// erfc(x) — complementary error function via Abramowitz & Stegun 7.1.26.
/// Accuracy: ~1.5e-7 (sufficient for p-value reporting; well below 0.01
/// threshold significance).
fn erfc(x: f64) -> f64 {
    let sign = if x < 0.0 { -1.0 } else { 1.0 };
    let x = x.abs();
    if x.is_nan() || !x.is_finite() {
        return 1.0;
    }
    let p = 0.3275911;
    let a = [
        0.254829592,
        -0.284496736,
        1.421413741,
        -1.453152027,
        1.061405429,
    ];
    let t = 1.0 / (1.0 + p * x);
    let y = 1.0
        - (((((a[4] * t + a[3]) * t) + a[2]) * t + a[1]) * t + a[0]) * t * (-x * x).exp();
    let erf = sign * y;
    (1.0 - erf).clamp(0.0, 2.0)
}

/// Upper-tail incomplete gamma → p-value for χ² with `a = df/2`.
///
/// Implements `Q(a, x/2) = Γ(a, x/2) / Γ(a)` via series + continued
/// fraction (Numerical Recipes 3rd ed §6.2). Accuracy: 1e-9.
fn chi2_p_value_upper(x: f64, a: f64) -> f64 {
    if x <= 0.0 || a <= 0.0 {
        return 1.0;
    }
    let x_half = x / 2.0;
    if x_half < a + 1.0 {
        // Series form.
        let gln = ln_gamma(a);
        let mut ap = a;
        let mut sum = 1.0 / a;
        let mut del = sum;
        for _ in 0..200 {
            ap += 1.0;
            del *= x_half / ap;
            sum += del;
            if del.abs() < sum.abs() * 1e-15 {
                break;
            }
        }
        let p = sum * (-x_half + a * x_half.ln() - gln).exp();
        (1.0 - p).clamp(0.0, 1.0)
    } else {
        // Continued fraction.
        let gln = ln_gamma(a);
        let mut b = x_half + 1.0 - a;
        let mut c = 1.0 / 1.0e-300;
        let mut d = 1.0 / b;
        let mut h = d;
        for i in 1..200 {
            let an = -(i as f64) * (i as f64 - a);
            b += 2.0;
            d = an * d + b;
            if d.abs() < 1.0e-300 {
                d = 1.0e-300;
            }
            c = b + an / c;
            if c.abs() < 1.0e-300 {
                c = 1.0e-300;
            }
            d = 1.0 / d;
            let del = d * c;
            h *= del;
            if (del - 1.0).abs() < 1e-15 {
                break;
            }
        }
        let q = h * (-x_half + a * x_half.ln() - gln).exp();
        q.clamp(0.0, 1.0)
    }
}

/// ln Γ(x) via Lanczos approximation. Accuracy: ~1e-10 for x > 0.5.
#[allow(clippy::excessive_precision)]
fn ln_gamma(x: f64) -> f64 {
    let p = [
        676.5203681218851_f64,
        -1259.1392167224028_f64,
        771.32342877765313_f64,
        -176.61502916214059_f64,
        12.507343278686905_f64,
        -0.13857109526572012_f64,
        9.9843695780195716e-6_f64,
        1.5056327351493116e-7_f64,
    ];
    if x < 0.5 {
        return (std::f64::consts::PI / (std::f64::consts::PI * x).sin()).ln() - ln_gamma(1.0 - x);
    }
    let x = x - 1.0;
    let mut a: f64 = 0.99999999999980993_f64;
    let t = x + 7.5;
    for (i, &pi) in p.iter().enumerate() {
        a += pi / (x + (i as f64) + 1.0);
    }
    let sqrt_2pi = (2.0 * std::f64::consts::PI).sqrt();
    sqrt_2pi.ln() + (x + 0.5) * t.ln() - t + a.ln()
}

fn bits_iter(bytes: &[u8]) -> impl Iterator<Item = u8> + '_ {
    bytes.iter().flat_map(|&b| (0..8).map(move |i| (b >> (7 - i)) & 1))
}
