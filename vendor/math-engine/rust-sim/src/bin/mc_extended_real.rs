//! SLOT-MATH W244 MC Runtime (extended shapes) — Rust port for cluster/ways/crash.
//!
//! Native Rust port of:
//!   - `tools/par_kernels/mc_cluster_runtime.py` (cluster_pays + cascade)
//!   - `tools/par_kernels/mc_ways_runtime.py`    (Megaways + cascade)
//!   - `tools/par_kernels/mc_crash_runtime.py`   (Stake Crash / Aviator)
//!
//! Each shape dispatched via the `shape` field in the JSON-on-stdin
//! protocol. Same wire format philosophy as `mc_runtime_real.rs`
//! (lines+FS+HW shape), so the Python wrapper can transparently pick
//! the binary by shape.
//!
//! Target speedup vs pure-Python:
//!   cluster: 200K/s    → ~50M/s   (250×)
//!   ways:    586K/s    → ~80M/s   (135×)
//!   crash:   1.75M/s   → ~200M/s  (115×)
//!
//! Rayon parallel + Chan combine same as `mc_runtime_real.rs`.

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::io::{self, Read};
use std::time::Instant;

// ─── CLI input (per-shape variants via tagged enum) ─────────────────

#[derive(Debug, Deserialize)]
#[serde(tag = "shape", rename_all = "snake_case")]
enum McInput {
    Cluster(ClusterInput),
    Ways(WaysInput),
    Crash(CrashInput),
}

#[derive(Debug, Deserialize)]
struct ClusterInput {
    n_rounds: u64,
    #[serde(default = "default_seed")]
    seed: u64,
    cf_target_rtp: Option<f64>,
    #[serde(default = "default_threads")]
    threads: usize,
    /// JSON object keys are always strings — parse int on read.
    /// {symbol_id: {cluster_size_str: expected_count_per_spin}}
    cluster_distribution: std::collections::BTreeMap<String, std::collections::BTreeMap<String, f64>>,
    /// {symbol_id: {cluster_size_str: pay_x_bet}}
    pay_table: std::collections::BTreeMap<String, std::collections::BTreeMap<String, f64>>,
    #[serde(default = "default_min_cluster")]
    min_cluster_size: i64,
    #[serde(default)]
    cascade_continue_p: f64,
    #[serde(default = "default_cap_high")]
    max_win_cap_x: f64,
}

#[derive(Debug, Deserialize)]
struct WaysInput {
    n_rounds: u64,
    #[serde(default = "default_seed")]
    seed: u64,
    cf_target_rtp: Option<f64>,
    #[serde(default = "default_threads")]
    threads: usize,
    /// Per-reel row distribution: [{row_count_str: prob}, ...]
    row_distribution_per_reel: Vec<std::collections::BTreeMap<String, f64>>,
    per_way_rtp_x_bet: f64,
    #[serde(default = "default_hit_p")]
    hit_probability: f64,
    #[serde(default)]
    cascade_continue_p: f64,
    #[serde(default = "default_cap_high")]
    max_win_cap_x: f64,
}

#[derive(Debug, Deserialize)]
struct CrashInput {
    n_rounds: u64,
    #[serde(default = "default_seed")]
    seed: u64,
    cf_target_rtp: Option<f64>,
    #[serde(default = "default_threads")]
    threads: usize,
    #[serde(default = "default_house_edge")]
    house_edge: f64,
    cashout_multiplier: f64,
    #[serde(default = "default_cap_huge")]
    max_win_cap_x: f64,
}

fn default_seed() -> u64 { 42 }
fn default_threads() -> usize { 0 }
fn default_min_cluster() -> i64 { 5 }
fn default_cap_high() -> f64 { 15_000.0 }
fn default_cap_huge() -> f64 { 1_000_000.0 }
fn default_hit_p() -> f64 { 0.30 }
fn default_house_edge() -> f64 { 0.01 }

// ─── RNG: Xoshiro256++ (same as mc_runtime_real) ────────────────────

struct Xoshiro256pp { s: [u64; 4] }

impl Xoshiro256pp {
    fn from_seed(seed: u64) -> Self {
        let mut z = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut splitmix = || -> u64 {
            z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut t = z;
            t = (t ^ (t >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            t = (t ^ (t >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            t ^ (t >> 31)
        };
        Self { s: [splitmix(), splitmix(), splitmix(), splitmix()] }
    }
    #[inline(always)]
    fn next_u64(&mut self) -> u64 {
        let r = self.s[0].wrapping_add(self.s[3]).rotate_left(23).wrapping_add(self.s[0]);
        let t = self.s[1].wrapping_shl(17);
        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = self.s[3].rotate_left(45);
        r
    }
    #[inline(always)]
    fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }
    /// Knuth's Poisson — exact for small λ, used for cluster cluster_count
    fn next_poisson(&mut self, lam: f64) -> u64 {
        if lam <= 0.0 { return 0; }
        if lam > 30.0 {
            // Normal approx
            let z = {
                let u1 = self.next_f64().max(1e-300);
                let u2 = self.next_f64();
                (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
            };
            let n = (lam + lam.sqrt() * z).round() as i64;
            return n.max(0) as u64;
        }
        let cap = (-lam).exp();
        let mut k = 0u64;
        let mut p = 1.0;
        loop {
            k += 1;
            p *= self.next_f64();
            if p <= cap { return k - 1; }
        }
    }
}

// ─── Streaming stats (shared) ───────────────────────────────────────

#[derive(Clone, Default)]
struct StreamingStats {
    n: u64,
    mean: f64,
    m2: f64,
    max_observed: f64,
    hits: u64,
    cascade_hits: u64,
    extra_counter: u64,  // wins (crash), total_clusters (cluster), total_ways (ways)
}

impl StreamingStats {
    #[inline(always)]
    fn push(&mut self, x: f64, hit: bool, cascade: bool, extra: u64) {
        self.n += 1;
        let delta = x - self.mean;
        self.mean += delta / self.n as f64;
        let delta2 = x - self.mean;
        self.m2 += delta * delta2;
        if x > self.max_observed { self.max_observed = x; }
        if hit { self.hits += 1; }
        if cascade { self.cascade_hits += 1; }
        self.extra_counter = self.extra_counter.wrapping_add(extra);
    }
    fn merge(&self, o: &Self) -> Self {
        if o.n == 0 { return self.clone(); }
        if self.n == 0 { return o.clone(); }
        let n_total = self.n + o.n;
        let delta = o.mean - self.mean;
        let mean = (self.n as f64 * self.mean + o.n as f64 * o.mean) / n_total as f64;
        let m2 = self.m2 + o.m2 + delta * delta * (self.n as f64 * o.n as f64) / n_total as f64;
        Self {
            n: n_total, mean, m2,
            max_observed: self.max_observed.max(o.max_observed),
            hits: self.hits + o.hits,
            cascade_hits: self.cascade_hits + o.cascade_hits,
            extra_counter: self.extra_counter.wrapping_add(o.extra_counter),
        }
    }
    fn variance(&self) -> f64 { self.m2 / (self.n.max(1) - 1).max(1) as f64 }
    fn std_error(&self) -> f64 { (self.variance() / self.n.max(1) as f64).sqrt() }
}

// ─── Cascade overlay helper ─────────────────────────────────────────

#[inline]
fn cascade_pay(rng: &mut Xoshiro256pp, base: f64, p_continue: f64) -> f64 {
    if base <= 0.0 || p_continue <= 0.0 { return 0.0; }
    let mut n = 0u32;
    while rng.next_f64() < p_continue && n < 16 { n += 1; }
    if n == 0 { return 0.0; }
    let decay = 0.6;
    let mut cur = base;
    let mut total = 0.0;
    for _ in 0..n { cur *= decay; total += cur; }
    total
}

// ─── Cluster shape ─────────────────────────────────────────────────

/// Pre-parse string-keyed distribution maps once before the hot loop.
fn parse_int_dist<'a>(
    m: &'a std::collections::BTreeMap<String, f64>,
) -> Vec<(i64, f64)> {
    m.iter()
        .filter_map(|(k, &v)| k.parse::<i64>().ok().map(|i| (i, v)))
        .collect()
}

fn run_cluster_chunk(input: &ClusterInput, chunk_seed: u64, rounds: u64) -> StreamingStats {
    let mut rng = Xoshiro256pp::from_seed(chunk_seed);
    let mut stats = StreamingStats::default();
    // Pre-parse string keys to int once
    let parsed: Vec<(String, Vec<(i64, f64)>, std::collections::HashMap<i64, f64>)> =
        input.cluster_distribution.iter().map(|(sym, dist)| {
            let pay_map: std::collections::HashMap<i64, f64> = input.pay_table.get(sym)
                .map(|p| parse_int_dist(p).into_iter().collect())
                .unwrap_or_default();
            (sym.clone(), parse_int_dist(dist), pay_map)
        }).collect();

    for _ in 0..rounds {
        let mut base_pay = 0.0;
        let mut n_clusters = 0u64;
        for (_sym, dist_vec, pay_map) in &parsed {
            for &(size, expected) in dist_vec {
                if size < input.min_cluster_size || expected <= 0.0 { continue; }
                let n = rng.next_poisson(expected);
                if n == 0 { continue; }
                let pay = *pay_map.get(&size).unwrap_or(&0.0);
                if pay <= 0.0 { continue; }
                base_pay += (n as f64) * pay;
                n_clusters = n_clusters.wrapping_add(n);
            }
        }
        let cascade = if base_pay > 0.0 {
            cascade_pay(&mut rng, base_pay, input.cascade_continue_p)
        } else { 0.0 };
        let mut total = base_pay + cascade;
        if total > input.max_win_cap_x { total = input.max_win_cap_x; }
        stats.push(total, base_pay > 0.0, cascade > 0.0, n_clusters);
    }
    stats
}

// ─── Ways shape ────────────────────────────────────────────────────

fn sample_row_count_parsed(rng: &mut Xoshiro256pp, dist: &[(i64, f64)]) -> u64 {
    let u = rng.next_f64();
    let mut cum = 0.0;
    let mut last = 0i64;
    for &(row, p) in dist {
        cum += p;
        last = row;
        if u <= cum { return row as u64; }
    }
    last as u64
}

fn run_ways_chunk(input: &WaysInput, chunk_seed: u64, rounds: u64) -> StreamingStats {
    let mut rng = Xoshiro256pp::from_seed(chunk_seed);
    let mut stats = StreamingStats::default();
    // Pre-parse string keys to int once per reel
    let parsed_reels: Vec<Vec<(i64, f64)>> = input.row_distribution_per_reel
        .iter().map(parse_int_dist).collect();
    for _ in 0..rounds {
        let mut ways = 1u64;
        for dist in &parsed_reels {
            ways = ways.saturating_mul(sample_row_count_parsed(&mut rng, dist));
        }
        let mut base_pay = 0.0;
        if rng.next_f64() < input.hit_probability && input.per_way_rtp_x_bet > 0.0 {
            let mean = (ways as f64) * input.per_way_rtp_x_bet / input.hit_probability;
            let u = rng.next_f64().max(1e-300);
            base_pay = -mean * u.ln();
        }
        let cascade = if base_pay > 0.0 {
            cascade_pay(&mut rng, base_pay, input.cascade_continue_p)
        } else { 0.0 };
        let mut total = base_pay + cascade;
        if total > input.max_win_cap_x { total = input.max_win_cap_x; }
        stats.push(total, base_pay > 0.0, cascade > 0.0, ways);
    }
    stats
}

// ─── Crash shape ───────────────────────────────────────────────────

fn run_crash_chunk(input: &CrashInput, chunk_seed: u64, rounds: u64) -> StreamingStats {
    let mut rng = Xoshiro256pp::from_seed(chunk_seed);
    let mut stats = StreamingStats::default();
    for _ in 0..rounds {
        let u = rng.next_f64();
        let crash_mult = if u < input.house_edge {
            1.0
        } else {
            let t = (u - input.house_edge) / (1.0 - input.house_edge);
            1.0 / (1.0 - t).max(1e-300)
        };
        let payout = if crash_mult >= input.cashout_multiplier {
            input.cashout_multiplier.min(input.max_win_cap_x)
        } else { 0.0 };
        let won = payout > 0.0;
        stats.push(payout, won, false, if won { 1 } else { 0 });
        if crash_mult > stats.max_observed { stats.max_observed = crash_mult; }
    }
    stats
}

// ─── Result output ─────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct McResult {
    shape: String,
    rounds: u64,
    seed: u64,
    rtp: f64,
    std_error: f64,
    wilson_99_halfwidth: f64,
    hit_rate: f64,
    cascade_rate: f64,
    extra_per_round_avg: f64,
    max_observed: f64,
    cf_target_rtp: Option<f64>,
    delta_bps: Option<f64>,
    convergence_pass: bool,
    wallclock_seconds: f64,
    rounds_per_sec: f64,
    threads_used: usize,
    parallel: bool,
}

fn finalize(
    shape: &str,
    stats: StreamingStats,
    seed: u64,
    cf_target: Option<f64>,
    wallclock: f64,
    n_chunks: usize,
    parallel: bool,
) -> McResult {
    let rtp = stats.mean;
    let se = stats.std_error();
    let half = 2.576 * se;
    let (delta_bps, pass) = match cf_target {
        Some(t) => {
            let d = (rtp - t) * 10000.0;
            (Some(d), (rtp - t).abs() <= half)
        }
        None => (None, true),
    };
    let rate = if wallclock > 0.0 { stats.n as f64 / wallclock } else { 0.0 };
    McResult {
        shape: shape.to_string(),
        rounds: stats.n,
        seed, rtp, std_error: se, wilson_99_halfwidth: half,
        hit_rate: stats.hits as f64 / stats.n.max(1) as f64,
        cascade_rate: stats.cascade_hits as f64 / stats.n.max(1) as f64,
        extra_per_round_avg: stats.extra_counter as f64 / stats.n.max(1) as f64,
        max_observed: stats.max_observed,
        cf_target_rtp: cf_target,
        delta_bps,
        convergence_pass: pass,
        wallclock_seconds: wallclock,
        rounds_per_sec: rate,
        threads_used: n_chunks,
        parallel,
    }
}

fn parallel_dispatch<F>(
    rounds: u64, threads: usize, seed: u64,
    chunk_runner: F,
) -> (StreamingStats, usize, bool)
where F: Fn(u64, u64) -> StreamingStats + Send + Sync,
{
    let want_threads = if threads == 0 { rayon::current_num_threads().max(1) } else { threads };
    let use_parallel = rounds >= 100_000 && want_threads > 1;
    let n_chunks = if use_parallel { want_threads } else { 1 };
    let base = rounds / n_chunks as u64;
    let remainder = rounds % n_chunks as u64;

    let chunk_seeds: Vec<u64> = (0..n_chunks).map(|i| {
        let mut z = seed.wrapping_add((i as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15));
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }).collect();

    let stats = if use_parallel {
        let pool = rayon::ThreadPoolBuilder::new().num_threads(n_chunks).build().expect("rayon");
        pool.install(|| {
            (0..n_chunks).into_par_iter().map(|i| {
                let extra = if (i as u64) < remainder { 1 } else { 0 };
                chunk_runner(chunk_seeds[i], base + extra)
            }).reduce(StreamingStats::default, |a, b| a.merge(&b))
        })
    } else {
        chunk_runner(chunk_seeds[0], rounds)
    };
    (stats, n_chunks, use_parallel)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw)?;
    let input: McInput = serde_json::from_str(&raw)?;

    let start = Instant::now();
    let result = match input {
        McInput::Cluster(c) => {
            let (s, nc, par) = parallel_dispatch(c.n_rounds, c.threads, c.seed,
                |seed, n| run_cluster_chunk(&c, seed, n));
            let wc = start.elapsed().as_secs_f64();
            finalize("cluster", s, c.seed, c.cf_target_rtp, wc, nc, par)
        }
        McInput::Ways(w) => {
            let (s, nc, par) = parallel_dispatch(w.n_rounds, w.threads, w.seed,
                |seed, n| run_ways_chunk(&w, seed, n));
            let wc = start.elapsed().as_secs_f64();
            finalize("ways", s, w.seed, w.cf_target_rtp, wc, nc, par)
        }
        McInput::Crash(cr) => {
            let (s, nc, par) = parallel_dispatch(cr.n_rounds, cr.threads, cr.seed,
                |seed, n| run_crash_chunk(&cr, seed, n));
            let wc = start.elapsed().as_secs_f64();
            finalize("crash", s, cr.seed, cr.cf_target_rtp, wc, nc, par)
        }
    };
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
