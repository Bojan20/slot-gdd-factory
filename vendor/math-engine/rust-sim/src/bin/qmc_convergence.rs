//! W5.4 — Emit a side-by-side MC vs QMC convergence report.
//!
//! Operator/regulator deliverable: prove the engine's QMC track converges
//! on the analytical RTP target at a similar (or smaller) rate of error
//! per spin compared to pseudorandom MC.
//!
//! Default spec is a classic 5×3 / 20-line slot with a single paying
//! symbol class (anchor weight 0.4 per reel, 3-of=1×, 4-of=4×, 5-of=10×).
//! Closed-form RTP = 4.0448 exact, no MC needed for the target.
//!
//! Usage:
//!     cargo run --release --bin qmc_convergence -- \
//!         --budgets 1000,10000,100000,1000000 \
//!         --sequence halton \
//!         --mc-seed 12345 \
//!         --out reports/acceptance/QMC_CONVERGENCE.json
//!
//! Output (truncated):
//!     {
//!       "spec": { "mc_seed": 12345, "mc_rng_kind": "pcg64",
//!                 "qmc_sequence": "halton", "qmc_skip": 0 },
//!       "closed_form_rtp": 4.0448,
//!       "budgets": [1000, 10000, 100000, 1000000],
//!       "mc":  [ { "track": "mc_pcg64", "n_spins": 1000, "rtp": 4.10, ... }, ... ],
//!       "qmc": [ { "track": "qmc_halton", "n_spins": 1000, "rtp": 4.05, ... }, ... ],
//!       "log10_speedup": [0.31, 0.42, 0.55, 0.71]
//!     }

use clap::Parser;
use slot_sim::qmc_estimator::{
    compare_mc_vs_qmc, LinesEvalSpec, QmcSequence,
};
use slot_sim::rng::RngKind;
use std::fs;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(
    name = "qmc_convergence",
    about = "MC vs QMC convergence report for the standard 5x3/20-line slot"
)]
struct Args {
    /// Comma-separated spin budgets (e.g. "1000,10000,100000,1000000").
    #[arg(long, default_value = "1000,10000,100000,1000000")]
    budgets: String,

    /// Which low-discrepancy sequence to use for the QMC track.
    #[arg(long, default_value = "halton")]
    sequence: String,

    /// MC seed (deterministic). Default 12345.
    #[arg(long, default_value_t = 12345_u64)]
    mc_seed: u64,

    /// QMC index skip (warm-up). Default 0.
    #[arg(long, default_value_t = 0_u64)]
    qmc_skip: u64,

    /// Output JSON path. Parent directory is created.
    #[arg(long)]
    out: PathBuf,

    /// Optional spec JSON. When omitted uses the standard 5x3/20-line
    /// benchmark (anchor weight 0.4, 3-of=1×, 4-of=4×, 5-of=10×).
    #[arg(long)]
    spec: Option<PathBuf>,
}

fn parse_budgets(token: &str) -> Result<Vec<u64>, String> {
    token
        .split(',')
        .map(|s| {
            s.trim()
                .parse::<u64>()
                .map_err(|e| format!("bad budget '{s}': {e}"))
        })
        .collect()
}

fn parse_sequence(s: &str) -> Result<QmcSequence, String> {
    match s.to_lowercase().as_str() {
        "halton" => Ok(QmcSequence::Halton),
        "sobol" => Ok(QmcSequence::Sobol),
        "lattice" => Ok(QmcSequence::Lattice),
        other => Err(format!(
            "unknown sequence '{other}' — pick one of: halton, sobol, lattice"
        )),
    }
}

fn standard_spec() -> LinesEvalSpec {
    LinesEvalSpec {
        reels: vec![vec![4.0_f64, 6.0_f64]; 5],
        paytable: vec![vec![1.0_f64, 4.0_f64, 10.0_f64], vec![]],
        min_match: 3,
        paylines: 20,
        bet: 1.0,
        anchor: 0,
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    let budgets = parse_budgets(&args.budgets)?;
    let sequence = parse_sequence(&args.sequence)?;
    let spec: LinesEvalSpec = if let Some(path) = &args.spec {
        let raw = fs::read_to_string(path)?;
        serde_json::from_str(&raw)?
    } else {
        standard_spec()
    };

    let report = compare_mc_vs_qmc(
        &spec,
        &budgets,
        args.mc_seed,
        RngKind::Pcg64,
        sequence,
        args.qmc_skip,
    );

    if let Some(parent) = args.out.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&args.out, serde_json::to_string_pretty(&report)?.as_bytes())?;
    eprintln!(
        "qmc_convergence: target={:.6}, budgets={:?}, sequence={:?}",
        report.closed_form_rtp, report.budgets, args.sequence,
    );
    eprintln!("→ {}", args.out.display());

    // Also emit a 3-column markdown table to stdout for PR comments.
    println!("| Spins | MC RTP | MC relerr | QMC RTP | QMC relerr | log10(MC/QMC) |");
    println!("|---:|---:|---:|---:|---:|---:|");
    for i in 0..budgets.len() {
        let mc = &report.mc[i];
        let qmc = &report.qmc[i];
        println!(
            "| {} | {:.4} | {:.4e} | {:.4} | {:.4e} | {:+.2} |",
            budgets[i], mc.rtp, mc.rel_error, qmc.rtp, qmc.rel_error, report.log10_speedup[i],
        );
    }
    Ok(())
}
