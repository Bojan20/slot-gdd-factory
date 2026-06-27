// W7.2 — QMC vs MC convergence demonstration binary.
//
// Computes ∫₀¹ f(x) dx via MC (PCG64), Halton, Sobol, and Lattice (Korobov)
// for several integrand families relevant to slot math:
//
//   - Identity                : f(x) = x  (target = 0.5)
//   - Polynomial              : f(x) = x²  (target = 1/3)
//   - Step-tail (rare event)  : f(x) = 1[x > 0.999]  (target = 1e-3 → models GRAND probability)
//   - Exponential CDF tail    : f(x) = e^(-10x)  (target ≈ 0.1)
//
// Output: table per-integrand, per-method, with |error|, time, and QMC speedup.
//
// Usage:
//   qmc-demo                  # default N = 10k, all integrands
//   qmc-demo --n 100000       # 100k samples per method
//   qmc-demo --integrand tail # only rare-event integrand
//   qmc-demo --json           # machine-readable output

use clap::Parser;
use rand::{Rng, SeedableRng};
use rand_pcg::Pcg64;
use slot_sim::qmc::{ConvergenceStats, HaltonSequence, LatticeSequence, SobolSequence};
use std::time::Instant;

#[derive(Parser, Debug)]
#[command(name = "qmc-demo", about = "QMC vs MC convergence comparison")]
struct Args {
    /// Samples per estimator.
    #[arg(long, default_value_t = 10_000)]
    n: u64,
    /// Restrict to one integrand family: identity | poly | tail | exp_cdf | all.
    #[arg(long, default_value = "all")]
    integrand: String,
    /// PRNG seed for MC reference.
    #[arg(long, default_value_t = 0xCEC0_C0FEu64)]
    seed: u64,
    /// JSON output (one row per (integrand, method)).
    #[arg(long, default_value_t = false)]
    json: bool,
}

#[derive(Clone, Copy)]
struct Integrand {
    name: &'static str,
    f: fn(f64) -> f64,
    target: f64,
}

const INTEGRANDS: &[Integrand] = &[
    Integrand {
        name: "identity",
        f: identity,
        target: 0.5,
    },
    Integrand {
        name: "poly",
        f: polynomial,
        target: 1.0 / 3.0,
    },
    Integrand {
        name: "tail",
        f: step_tail,
        target: 1e-3,
    },
    Integrand {
        name: "exp_cdf",
        f: exp_cdf,
        target: EXP_CDF_TARGET,
    },
];

const EXP_CDF_TARGET: f64 = 0.099_995_460_007_2; // 1 - e^-10, divided by 10

fn identity(x: f64) -> f64 {
    x
}
fn polynomial(x: f64) -> f64 {
    x * x
}
fn step_tail(x: f64) -> f64 {
    if x > 0.999 {
        1.0
    } else {
        0.0
    }
}
fn exp_cdf(x: f64) -> f64 {
    (-10.0_f64 * x).exp()
}

fn run_mc(integrand: Integrand, n: u64, seed: u64) -> ConvergenceStats {
    let t0 = Instant::now();
    let mut rng = Pcg64::seed_from_u64(seed);
    let mut sum = 0.0_f64;
    for _ in 0..n {
        let x: f64 = rng.gen();
        sum += (integrand.f)(x);
    }
    let mean = sum / n as f64;
    ConvergenceStats {
        n_samples: n,
        mean,
        abs_error: (mean - integrand.target).abs(),
        elapsed_ms: t0.elapsed().as_millis(),
    }
}

fn run_halton(integrand: Integrand, n: u64) -> ConvergenceStats {
    let t0 = Instant::now();
    let mut h = HaltonSequence::new(1);
    let mut sum = 0.0_f64;
    for _ in 0..n {
        let p = h.next_point();
        sum += (integrand.f)(p[0]);
    }
    let mean = sum / n as f64;
    ConvergenceStats {
        n_samples: n,
        mean,
        abs_error: (mean - integrand.target).abs(),
        elapsed_ms: t0.elapsed().as_millis(),
    }
}

fn run_sobol(integrand: Integrand, n: u64) -> ConvergenceStats {
    let t0 = Instant::now();
    let mut s = SobolSequence::new();
    let mut sum = 0.0_f64;
    for _ in 0..n {
        sum += (integrand.f)(s.next_f64());
    }
    let mean = sum / n as f64;
    ConvergenceStats {
        n_samples: n,
        mean,
        abs_error: (mean - integrand.target).abs(),
        elapsed_ms: t0.elapsed().as_millis(),
    }
}

fn run_lattice(integrand: Integrand, n: u64) -> ConvergenceStats {
    let t0 = Instant::now();
    let mut l = LatticeSequence::korobov_1d();
    let mut sum = 0.0_f64;
    for _ in 0..n {
        let p = l.next_point();
        sum += (integrand.f)(p[0]);
    }
    let mean = sum / n as f64;
    ConvergenceStats {
        n_samples: n,
        mean,
        abs_error: (mean - integrand.target).abs(),
        elapsed_ms: t0.elapsed().as_millis(),
    }
}

fn main() {
    let args = Args::parse();
    let n = args.n;

    let selected: Vec<_> = if args.integrand == "all" {
        INTEGRANDS.to_vec()
    } else {
        INTEGRANDS
            .iter()
            .filter(|i| i.name == args.integrand)
            .copied()
            .collect()
    };
    if selected.is_empty() {
        eprintln!(
            "Unknown integrand '{}'. Choose from: identity, poly, tail, exp_cdf, all.",
            args.integrand
        );
        std::process::exit(2);
    }

    if args.json {
        emit_json(&selected, n, args.seed);
        return;
    }

    println!(
        "== W7.2 QMC vs MC convergence demo — N = {n}, MC seed = {:#x} ==",
        args.seed
    );
    println!();
    for &integ in &selected {
        let mc = run_mc(integ, n, args.seed);
        let halton = run_halton(integ, n);
        let sobol = run_sobol(integ, n);
        let lattice = run_lattice(integ, n);

        println!(
            "Integrand: {} (target = {})",
            integ.name,
            fmt_target(integ.target)
        );
        println!("┌──────────┬──────────────┬─────────────┬──────────┬──────────────┐");
        println!("│ Method   │ Mean         │ Abs error   │ ms       │ QMC speedup  │");
        println!("├──────────┼──────────────┼─────────────┼──────────┼──────────────┤");
        let mc_row = format_row("MC (PCG64)", &mc, 1.0);
        let halton_row = format_row("Halton", &halton, halton.speedup_vs(&mc));
        let sobol_row = format_row("Sobol", &sobol, sobol.speedup_vs(&mc));
        let lattice_row = format_row("Lattice", &lattice, lattice.speedup_vs(&mc));
        println!("{mc_row}");
        println!("{halton_row}");
        println!("{sobol_row}");
        println!("{lattice_row}");
        println!("└──────────┴──────────────┴─────────────┴──────────┴──────────────┘");
        println!();
    }
}

fn format_row(name: &str, s: &ConvergenceStats, speedup: f64) -> String {
    let speedup_str = if speedup.is_infinite() {
        "    EXACT   ".to_string()
    } else {
        format!("{speedup:>12.2}×")
    };
    format!(
        "│ {name:<8} │ {:>12.8} │ {:>11.2e} │ {:>8} │ {speedup_str} │",
        s.mean, s.abs_error, s.elapsed_ms
    )
}

fn fmt_target(t: f64) -> String {
    if t.abs() > 0.01 {
        format!("{t:.8}")
    } else {
        format!("{t:.4e}")
    }
}

fn emit_json(selected: &[Integrand], n: u64, seed: u64) {
    print!("[");
    let mut first_outer = true;
    for &integ in selected {
        let mc = run_mc(integ, n, seed);
        let halton = run_halton(integ, n);
        let sobol = run_sobol(integ, n);
        let lattice = run_lattice(integ, n);
        for (method, st) in [
            ("mc", &mc),
            ("halton", &halton),
            ("sobol", &sobol),
            ("lattice", &lattice),
        ] {
            if !first_outer {
                print!(",");
            }
            first_outer = false;
            let speedup = if method == "mc" {
                1.0
            } else {
                st.speedup_vs(&mc)
            };
            print!(
                "{{\"integrand\":\"{}\",\"method\":\"{method}\",\"n\":{n},\"mean\":{:.10},\"abs_error\":{:.10e},\"elapsed_ms\":{},\"qmc_speedup\":{:.4}}}",
                integ.name, st.mean, st.abs_error, st.elapsed_ms, speedup
            );
        }
    }
    println!("]");
}
