//! SLOT-MATH W244 MC Runtime — Rust port for 100× speedup.
//!
//! Native Rust mirror of `tools/par_kernels/mc_runtime.py`. Samples
//! per-spin payouts from closed-form kernel parameters and converges
//! to the published CF RTP within Wilson 99% CI.
//!
//! Strategy: identical algorithms, native math, rayon-friendly worker
//! shape (currently single-threaded loop; rayon parallel-tier follow-up).
//!
//! Pure-Python reference: ~1.18M spins/sec.
//! This binary target: ≥ 100M spins/sec on M-series.
//!
//! ## Wire format (CLI args via JSON-on-stdin)
//!
//! ```bash
//! echo '{
//!   "spins": 10000000,
//!   "seed": 42,
//!   "cf_target_rtp": 0.96136,
//!   "executor": {
//!     "base_rtp_per_spin": 0.36346,
//!     "base_hit_freq": 0.207,
//!     "fs_trigger_p": 0.008501,
//!     "fs_session_e": 23.6362,
//!     "fs_session_std": 26.6119,
//!     "hnw_trigger_p": 0.009010,
//!     "hnw_session_e": 44.0585,
//!     "hnw_session_std": 78.0,
//!     "max_win_cap_x": 5000.0
//!   }
//! }' | ./mc_runtime_real
//! ```
//!
//! Output JSON to stdout:
//!
//! ```json
//! {
//!   "spins": 10000000,
//!   "rtp": 0.960484,
//!   "std_error": 0.000060,
//!   "wilson_99_halfwidth": 0.000154,
//!   "hit_rate": 0.207,
//!   "fs_trigger_rate": 0.0085,
//!   "hnw_trigger_rate": 0.00901,
//!   "max_win_x": 1734.0,
//!   "delta_bps": 0.4,
//!   "convergence_pass": true,
//!   "wallclock_seconds": 0.082,
//!   "spins_per_sec": 122439024
//! }
//! ```

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::io::{self, Read};
use std::time::Instant;

// ─── CLI input ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct McInput {
    spins: u64,
    #[serde(default = "default_seed")]
    seed: u64,
    cf_target_rtp: Option<f64>,
    #[serde(default = "default_threads")]
    threads: usize,
    executor: ExecutorParams,
}

fn default_threads() -> usize {
    // 0 = use rayon's default (= num_cpus)
    0
}

#[derive(Debug, Deserialize)]
struct ExecutorParams {
    base_rtp_per_spin: f64,
    #[serde(default = "default_hit_freq")]
    base_hit_freq: f64,
    fs_trigger_p: f64,
    fs_session_e: f64,
    fs_session_std: f64,
    hnw_trigger_p: f64,
    hnw_session_e: f64,
    hnw_session_std: f64,
    #[serde(default = "default_max_cap")]
    max_win_cap_x: f64,
    #[serde(default = "default_lognorm_sigma")]
    base_lognorm_sigma: f64,
}

fn default_seed() -> u64 {
    42
}
fn default_hit_freq() -> f64 {
    0.207
}
fn default_max_cap() -> f64 {
    5000.0
}
fn default_lognorm_sigma() -> f64 {
    1.4
}

// ─── RNG: Xoshiro256++ (fast, high quality, ergonomic) ───────────────

struct Xoshiro256pp {
    s: [u64; 4],
}

impl Xoshiro256pp {
    fn from_seed(seed: u64) -> Self {
        // SplitMix64 to expand single u64 → 4 u64 state
        let mut z = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut splitmix = || -> u64 {
            z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut t = z;
            t = (t ^ (t >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            t = (t ^ (t >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            t ^ (t >> 31)
        };
        Self {
            s: [splitmix(), splitmix(), splitmix(), splitmix()],
        }
    }

    #[inline(always)]
    fn next_u64(&mut self) -> u64 {
        let result = self.s[0].wrapping_add(self.s[3]).rotate_left(23).wrapping_add(self.s[0]);
        let t = self.s[1].wrapping_shl(17);
        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = self.s[3].rotate_left(45);
        result
    }

    /// Uniform [0, 1) f64 via 53-bit mantissa
    #[inline(always)]
    fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }

    /// Standard normal via Box-Muller (single output, second discarded)
    #[inline(always)]
    fn next_normal(&mut self) -> f64 {
        let u1 = self.next_f64().max(1e-300);
        let u2 = self.next_f64();
        (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
    }

    /// Gamma(shape=k, scale=θ) via Marsaglia-Tsang for k≥1, simple for k<1
    fn next_gamma(&mut self, k: f64, theta: f64) -> f64 {
        if k < 1.0 {
            // Stuart's identity: G(k) = G(k+1) × U^(1/k)
            let g = self.next_gamma(k + 1.0, 1.0);
            let u = self.next_f64().max(1e-300);
            return g * u.powf(1.0 / k) * theta;
        }
        // Marsaglia-Tsang (k >= 1)
        let d = k - 1.0 / 3.0;
        let c = 1.0 / (9.0 * d).sqrt();
        loop {
            let x = self.next_normal();
            let v = 1.0 + c * x;
            if v <= 0.0 {
                continue;
            }
            let v3 = v * v * v;
            let u = self.next_f64();
            if u < 1.0 - 0.0331 * x * x * x * x {
                return d * v3 * theta;
            }
            if u.ln() < 0.5 * x * x + d * (1.0 - v3 + v3.ln()) {
                return d * v3 * theta;
            }
        }
    }
}

// ─── Per-kernel samplers ──────────────────────────────────────────────

#[inline(always)]
fn sample_base_lines(rng: &mut Xoshiro256pp, base_rtp: f64, hit_freq: f64, sigma: f64) -> f64 {
    if rng.next_f64() > hit_freq {
        return 0.0;
    }
    if base_rtp <= 0.0 || hit_freq <= 0.0 {
        return 0.0;
    }
    let e_pay_given_hit = base_rtp / hit_freq;
    let mu = e_pay_given_hit.max(1e-12).ln() - (sigma * sigma) / 2.0;
    (mu + sigma * rng.next_normal()).exp()
}

#[inline(always)]
fn sample_bernoulli_session(
    rng: &mut Xoshiro256pp,
    trigger_p: f64,
    e: f64,
    std: f64,
) -> (bool, f64) {
    if rng.next_f64() > trigger_p {
        return (false, 0.0);
    }
    if e <= 0.0 {
        return (true, 0.0);
    }
    if std <= 0.0 {
        return (true, e);
    }
    let k = (e * e) / (std * std);
    let theta = (std * std) / e;
    (true, rng.next_gamma(k, theta))
}

// ─── Streaming Welford stats ──────────────────────────────────────────

/// Per-feature streaming accumulator — Welford for (n, mean, M2).
#[derive(Clone, Default)]
struct FeatureStats {
    n: u64,
    mean: f64,
    m2: f64,
}

impl FeatureStats {
    #[inline(always)]
    fn push(&mut self, x: f64) {
        self.n += 1;
        let delta = x - self.mean;
        self.mean += delta / self.n as f64;
        let delta2 = x - self.mean;
        self.m2 += delta * delta2;
    }

    fn merge(&self, other: &Self) -> Self {
        if other.n == 0 { return self.clone(); }
        if self.n == 0 { return other.clone(); }
        let n_total = self.n + other.n;
        let delta = other.mean - self.mean;
        let mean = (self.n as f64 * self.mean + other.n as f64 * other.mean) / n_total as f64;
        let m2 = self.m2 + other.m2
            + delta * delta * (self.n as f64 * other.n as f64) / n_total as f64;
        Self { n: n_total, mean, m2 }
    }

    fn variance(&self) -> f64 {
        self.m2 / (self.n.max(1) - 1).max(1) as f64
    }

    fn std_error(&self) -> f64 {
        (self.variance() / self.n.max(1) as f64).sqrt()
    }
}

#[derive(Clone, Default)]
struct StreamingStats {
    // Total payout per spin
    n: u64,
    mean: f64,
    m2: f64,
    max_observed: f64,
    hits: u64,
    fs_triggers: u64,
    hnw_triggers: u64,
    // Per-feature accumulators (per-spin contribution, so 0 when feature didn't fire)
    base_stats: FeatureStats,
    fs_stats: FeatureStats,
    hnw_stats: FeatureStats,
}

impl StreamingStats {
    fn new() -> Self {
        Self::default()
    }

    #[inline(always)]
    fn push_components(
        &mut self,
        base: f64, fs_pay: f64, hnw_pay: f64,
        capped_total: f64,
        hit: bool, fs_hit: bool, hnw_hit: bool,
    ) {
        // Total payout aggregate
        self.n += 1;
        let delta = capped_total - self.mean;
        self.mean += delta / self.n as f64;
        let delta2 = capped_total - self.mean;
        self.m2 += delta * delta2;
        if capped_total > self.max_observed {
            self.max_observed = capped_total;
        }
        if hit { self.hits += 1; }
        if fs_hit { self.fs_triggers += 1; }
        if hnw_hit { self.hnw_triggers += 1; }
        // Per-feature per-spin contribution (already capped if total > cap;
        // when cap fires the proportional scale is reflected in passed
        // component values from caller)
        self.base_stats.push(base);
        self.fs_stats.push(fs_pay);
        self.hnw_stats.push(hnw_pay);
    }

    /// Chan parallel combine — merge two Welford accumulators numerically stable.
    /// Reference: Chan, Golub, LeVeque (1979), eq (1.5a/b).
    fn merge(&self, other: &Self) -> Self {
        if other.n == 0 {
            return self.clone();
        }
        if self.n == 0 {
            return other.clone();
        }
        let n_total = self.n + other.n;
        let delta = other.mean - self.mean;
        let mean = (self.n as f64 * self.mean + other.n as f64 * other.mean) / n_total as f64;
        let m2 = self.m2 + other.m2
            + delta * delta * (self.n as f64 * other.n as f64) / n_total as f64;
        Self {
            n: n_total,
            mean,
            m2,
            max_observed: self.max_observed.max(other.max_observed),
            hits: self.hits + other.hits,
            fs_triggers: self.fs_triggers + other.fs_triggers,
            hnw_triggers: self.hnw_triggers + other.hnw_triggers,
            base_stats: self.base_stats.merge(&other.base_stats),
            fs_stats: self.fs_stats.merge(&other.fs_stats),
            hnw_stats: self.hnw_stats.merge(&other.hnw_stats),
        }
    }

    fn variance(&self) -> f64 {
        self.m2 / (self.n.max(1) - 1).max(1) as f64
    }

    fn std_error(&self) -> f64 {
        (self.variance() / self.n.max(1) as f64).sqrt()
    }
}

// ─── Output ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct FeatureBreakdown {
    rtp_contribution: f64,
    std_error: f64,
    wilson_99_halfwidth: f64,
}

#[derive(Debug, Serialize)]
struct McResult {
    spins: u64,
    seed: u64,
    rtp: f64,
    std_error: f64,
    wilson_99_halfwidth: f64,
    hit_rate: f64,
    fs_trigger_rate: f64,
    hnw_trigger_rate: f64,
    max_win_x: f64,
    cf_target_rtp: Option<f64>,
    delta_bps: Option<f64>,
    convergence_pass: bool,
    wallclock_seconds: f64,
    spins_per_sec: f64,
    threads_used: usize,
    parallel: bool,
    // Per-feature MC breakdown — regulator-grade transparency.
    // Each entry: per-spin RTP contribution + Wilson 99% CI half-width.
    feature_breakdown: FeatureBreakdownByKind,
}

#[derive(Debug, Serialize)]
struct FeatureBreakdownByKind {
    base_lines: FeatureBreakdown,
    free_spins: FeatureBreakdown,
    hold_and_win: FeatureBreakdown,
}

// ─── Main ─────────────────────────────────────────────────────────────

/// Run one chunk of spinova with its own RNG substream + local Welford.
fn run_chunk(exec: &ExecutorParams, chunk_seed: u64, spins: u64) -> StreamingStats {
    let mut rng = Xoshiro256pp::from_seed(chunk_seed);
    let mut stats = StreamingStats::new();
    for _ in 0..spins {
        let base = sample_base_lines(
            &mut rng,
            exec.base_rtp_per_spin,
            exec.base_hit_freq,
            exec.base_lognorm_sigma,
        );
        let (fs_hit, fs_pay) = sample_bernoulli_session(
            &mut rng, exec.fs_trigger_p, exec.fs_session_e, exec.fs_session_std,
        );
        let (hnw_hit, hnw_pay) = sample_bernoulli_session(
            &mut rng, exec.hnw_trigger_p, exec.hnw_session_e, exec.hnw_session_std,
        );
        let mut total = base + fs_pay + hnw_pay;
        let mut base_capped = base;
        let mut fs_capped = fs_pay;
        let mut hnw_capped = hnw_pay;
        if total > exec.max_win_cap_x {
            let scale = exec.max_win_cap_x / total;
            total = exec.max_win_cap_x;
            base_capped *= scale;
            fs_capped *= scale;
            hnw_capped *= scale;
        }
        stats.push_components(
            base_capped, fs_capped, hnw_capped, total,
            base > 0.0, fs_hit, hnw_hit,
        );
    }
    stats
}

fn run_mc(input: &McInput) -> McResult {
    let exec = &input.executor;

    // Decide thread count + chunk shape
    let want_threads = if input.threads == 0 {
        rayon::current_num_threads().max(1)
    } else {
        input.threads
    };
    // Don't parallelize tiny runs — overhead dominates below ~50K spinova
    let use_parallel = input.spins >= 100_000 && want_threads > 1;
    let n_chunks = if use_parallel { want_threads } else { 1 };
    let base_spins_per_chunk = input.spins / n_chunks as u64;
    let remainder = input.spins % n_chunks as u64;

    // Per-chunk seed = SplitMix64(input.seed XOR chunk_idx)
    // — guarantees independent substreams across threads.
    let chunk_seeds: Vec<u64> = (0..n_chunks)
        .map(|i| {
            let mut z = input.seed.wrapping_add((i as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15));
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            z ^ (z >> 31)
        })
        .collect();

    let start = Instant::now();

    let stats: StreamingStats = if use_parallel {
        // Configure rayon pool if user requested a specific count
        let pool = if input.threads > 0 {
            Some(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(input.threads)
                    .build()
                    .expect("rayon pool"),
            )
        } else {
            None
        };
        let run = || {
            (0..n_chunks)
                .into_par_iter()
                .map(|i| {
                    let extra = if (i as u64) < remainder { 1 } else { 0 };
                    let spins = base_spins_per_chunk + extra;
                    run_chunk(exec, chunk_seeds[i], spins)
                })
                .reduce(StreamingStats::new, |a, b| a.merge(&b))
        };
        match pool {
            Some(p) => p.install(run),
            None => run(),
        }
    } else {
        run_chunk(exec, chunk_seeds[0], input.spins)
    };

    let wallclock = start.elapsed().as_secs_f64();
    let spins_per_sec = if wallclock > 0.0 {
        input.spins as f64 / wallclock
    } else {
        0.0
    };

    let rtp = stats.mean;
    let se = stats.std_error();
    let half = 2.576 * se;
    let (delta_bps, pass) = match input.cf_target_rtp {
        Some(t) => {
            let d = (rtp - t) * 10000.0;
            (Some(d), (rtp - t).abs() <= half)
        }
        None => (None, true),
    };

    // Per-feature breakdown (helper)
    let mk = |fs: &FeatureStats| FeatureBreakdown {
        rtp_contribution: fs.mean,
        std_error: fs.std_error(),
        wilson_99_halfwidth: 2.576 * fs.std_error(),
    };

    McResult {
        spins: input.spins,
        seed: input.seed,
        rtp,
        std_error: se,
        wilson_99_halfwidth: half,
        hit_rate: stats.hits as f64 / stats.n.max(1) as f64,
        fs_trigger_rate: stats.fs_triggers as f64 / stats.n.max(1) as f64,
        hnw_trigger_rate: stats.hnw_triggers as f64 / stats.n.max(1) as f64,
        max_win_x: stats.max_observed,
        cf_target_rtp: input.cf_target_rtp,
        delta_bps,
        convergence_pass: pass,
        wallclock_seconds: wallclock,
        spins_per_sec,
        threads_used: n_chunks,
        parallel: use_parallel,
        feature_breakdown: FeatureBreakdownByKind {
            base_lines: mk(&stats.base_stats),
            free_spins: mk(&stats.fs_stats),
            hold_and_win: mk(&stats.hnw_stats),
        },
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw)?;
    let input: McInput = serde_json::from_str(&raw)?;
    let result = run_mc(&input);
    let json = serde_json::to_string_pretty(&result)?;
    println!("{}", json);
    Ok(())
}
