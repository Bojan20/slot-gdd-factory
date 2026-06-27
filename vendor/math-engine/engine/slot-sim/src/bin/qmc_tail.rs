// W7.2 — Sobol-stratified tail probability estimator.
//
// CONTEXT
// -------
// Slot engines need to estimate rare-event probabilities like P(GRAND prize)
// or P(payout ≥ 1000×). Classical MC needs ~10⁹ spins to get tight CIs on
// 10⁻⁶ rate events. QMC with stratified input converges ~100× faster on
// smooth CDFs.
//
// HOW IT WORKS
// ------------
// We model a generic "rare event" estimator P(payout ≥ τ) for a synthetic
// payout distribution mirroring a slot's actual tail behavior:
//
//   payout(u) ~ Exp(λ)  for u ∈ [0, 1)    (heavy right tail, λ controls mean)
//
// This is a stand-in for a real PAR-driven payout CDF — once wired into
// `slot-sim`, the same Sobol stratification applies to the slot's RTP bucket
// histogram (∫₀¹ 1[payout(u) ≥ τ] du).
//
// We compare:
//   - MC (PCG64)  : standard PRNG samples
//   - Sobol       : 1D stratification of [0, 1) by binary radical inverse
//   - Halton      : same but base-2 + base-3 mixed (variance reduced further)
//
// OUTPUT
// ------
// Table per method × threshold τ ∈ {0.5, 0.9, 0.99, 0.999, 0.9999} showing
// estimated probability, std error vs analytical exact, and speedup.
//
// USAGE
// -----
//   qmc-tail                       # default N=100k, λ=1.0
//   qmc-tail --n 1000000           # 1M samples per method
//   qmc-tail --lambda 5.0          # heavier tail
//   qmc-tail --json                # machine-readable

use clap::Parser;
use rand::{Rng, SeedableRng};
use rand_pcg::Pcg64;
use slot_sim::qmc::{HaltonSequence, SobolSequence};
use std::time::Instant;

#[derive(Parser, Debug)]
#[command(name = "qmc-tail", about = "Sobol-stratified tail probability estimator")]
struct Args {
    /// Samples per estimator.
    #[arg(long, default_value_t = 100_000)]
    n: u64,
    /// Exponential distribution rate parameter (λ).
    #[arg(long, default_value_t = 1.0)]
    lambda: f64,
    /// PRNG seed for MC.
    #[arg(long, default_value_t = 0xCEC0_C0FEu64)]
    seed: u64,
    /// JSON output.
    #[arg(long, default_value_t = false)]
    json: bool,
}

const THRESHOLDS: &[f64] = &[0.5, 0.9, 0.99, 0.999, 0.9999];

/// Inverse-CDF of Exp(λ): payout = -ln(1-u)/λ. For u ∈ [0, 1) returns [0, ∞).
fn exp_inverse_cdf(u: f64, lambda: f64) -> f64 {
    -(1.0 - u).ln() / lambda
}

/// Analytical exact P(payout ≥ τ) for Exp(λ): P = 1 - F(τ) = exp(-λτ).
fn exact_tail_prob(threshold: f64, lambda: f64) -> f64 {
    (-lambda * threshold).exp()
}

#[derive(Debug, Clone, Copy)]
struct EstResult {
    estimate: f64,
    abs_error: f64,
}

fn estimate_with<F>(thresholds: &[f64], n: u64, lambda: f64, mut next_u: F) -> Vec<EstResult>
where
    F: FnMut() -> f64,
{
    let mut counts = vec![0u64; thresholds.len()];
    for _ in 0..n {
        let u = next_u();
        let payout = exp_inverse_cdf(u, lambda);
        for (i, &t) in thresholds.iter().enumerate() {
            if payout >= t {
                counts[i] += 1;
            }
        }
    }
    thresholds
        .iter()
        .zip(counts.iter())
        .map(|(&t, &c)| {
            let est = c as f64 / n as f64;
            let exact = exact_tail_prob(t, lambda);
            let abs_err = (est - exact).abs();
            EstResult {
                estimate: est,
                abs_error: abs_err,
            }
        })
        .collect()
}

fn main() {
    let args = Args::parse();
    let n = args.n;

    let t0 = Instant::now();
    let mut rng = Pcg64::seed_from_u64(args.seed);
    let mc_rows = estimate_with(THRESHOLDS, n, args.lambda, || rng.gen::<f64>());
    let mc_ms = t0.elapsed().as_millis();

    let t0 = Instant::now();
    let mut sobol = SobolSequence::new();
    let sobol_rows = estimate_with(THRESHOLDS, n, args.lambda, || sobol.next_f64());
    let sobol_ms = t0.elapsed().as_millis();

    let t0 = Instant::now();
    let mut halton = HaltonSequence::new(1);
    let halton_rows = estimate_with(THRESHOLDS, n, args.lambda, || halton.next_point()[0]);
    let halton_ms = t0.elapsed().as_millis();

    if args.json {
        emit_json(
            n,
            args.lambda,
            &mc_rows,
            &sobol_rows,
            &halton_rows,
            mc_ms,
            sobol_ms,
            halton_ms,
        );
        return;
    }

    println!("== W7.2 QMC tail probability estimation — N={n}, λ={} ==", args.lambda);
    println!();
    println!(
        "{:>10}  {:>12}  {:>12}  {:>12}  {:>12}",
        "τ", "exact", "MC", "Sobol", "Halton"
    );
    println!("{}", "─".repeat(70));
    for (i, &t) in THRESHOLDS.iter().enumerate() {
        let exact = exact_tail_prob(t, args.lambda);
        println!(
            "{t:>10.4}  {exact:>12.6e}  {:>12.6e}  {:>12.6e}  {:>12.6e}",
            mc_rows[i].estimate, sobol_rows[i].estimate, halton_rows[i].estimate,
        );
    }
    println!();
    println!("Absolute error vs exact:");
    println!(
        "{:>10}  {:>14}  {:>14}  {:>14}",
        "τ", "MC abs.err", "Sobol abs.err", "Halton abs.err"
    );
    println!("{}", "─".repeat(70));
    for i in 0..THRESHOLDS.len() {
        let t = THRESHOLDS[i];
        println!(
            "{t:>10.4}  {:>14.3e}  {:>14.3e}  {:>14.3e}",
            mc_rows[i].abs_error, sobol_rows[i].abs_error, halton_rows[i].abs_error
        );
    }
    println!();
    println!("Sobol QMC speedup vs MC (per-τ, error ratio):");
    for i in 0..THRESHOLDS.len() {
        let t = THRESHOLDS[i];
        let speedup = if sobol_rows[i].abs_error == 0.0 {
            f64::INFINITY
        } else {
            mc_rows[i].abs_error / sobol_rows[i].abs_error
        };
        let speedup_str = if speedup.is_infinite() {
            "EXACT".to_string()
        } else {
            format!("{speedup:.2}×")
        };
        println!("  τ={t:>7.4}  → {speedup_str}");
    }
    println!();
    println!("Wall time: MC {mc_ms}ms, Sobol {sobol_ms}ms, Halton {halton_ms}ms");
}

#[allow(clippy::too_many_arguments)]
fn emit_json(
    n: u64,
    lambda: f64,
    mc: &[EstResult],
    sobol: &[EstResult],
    halton: &[EstResult],
    mc_ms: u128,
    sobol_ms: u128,
    halton_ms: u128,
) {
    print!("{{\"n\":{n},\"lambda\":{lambda},\"thresholds\":[");
    for (i, &t) in THRESHOLDS.iter().enumerate() {
        let exact = exact_tail_prob(t, lambda);
        if i > 0 {
            print!(",");
        }
        print!(
            "{{\"tau\":{t},\"exact\":{exact:.10e},\"mc\":{{\"estimate\":{:.10e},\"abs_error\":{:.10e}}},\"sobol\":{{\"estimate\":{:.10e},\"abs_error\":{:.10e}}},\"halton\":{{\"estimate\":{:.10e},\"abs_error\":{:.10e}}}}}",
            mc[i].estimate, mc[i].abs_error,
            sobol[i].estimate, sobol[i].abs_error,
            halton[i].estimate, halton[i].abs_error,
        );
    }
    println!("],\"wall_ms\":{{\"mc\":{mc_ms},\"sobol\":{sobol_ms},\"halton\":{halton_ms}}}}}");
}
