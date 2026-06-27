//! W7.10 — Anomaly Self-Play Detector CLI.
//!
//! Sweep a parameter grid over the standard 5×3 / 20-line reference
//! spec and emit a ranked anomaly report. Default sweep is
//! anchor_weight × paylines × bet — designers can override.
//!
//! Example::
//!
//!     cargo run --release --bin anomaly_self_play -- \
//!         --anchor-weights 1,2,4,8,16,32 \
//!         --paylines 10,20,40 \
//!         --seeds-per-probe 5 \
//!         --spins-per-seed 2000 \
//!         --z-threshold 2.0 \
//!         --top-k 10 \
//!         --out reports/acceptance/ANOMALY_SELF_PLAY.json

use clap::Parser;
use slot_sim::anomaly_self_play::{run_self_play_sweep, Knob};
use slot_sim::qmc_estimator::LinesEvalSpec;
use slot_sim::rng::RngKind;
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser, Debug)]
#[command(
    name = "anomaly_self_play",
    about = "Spec-side parameter sweep anomaly detector (W7.10)"
)]
struct Args {
    /// Comma-separated anchor weight values to sweep.
    #[arg(long, default_value = "1,2,4,8,16,32")]
    anchor_weights: String,

    /// Comma-separated payline counts to sweep.
    #[arg(long, default_value = "10,20,40")]
    paylines: String,

    /// Comma-separated bet basis values to sweep.
    #[arg(long, default_value = "1.0,2.0")]
    bets: String,

    /// Seeds per probe (RTP fan width).
    #[arg(long, default_value_t = 5)]
    seeds_per_probe: u32,

    /// Spins per seed.
    #[arg(long, default_value_t = 2_000_u64)]
    spins_per_seed: u64,

    /// Anomaly z-score reject threshold.
    #[arg(long, default_value_t = 2.0)]
    z_threshold: f64,

    /// Cap on the top anomalies surfaced.
    #[arg(long, default_value_t = 10)]
    top_k: usize,

    /// Output JSON path.
    #[arg(long)]
    out: PathBuf,
}

fn parse_csv_f64(s: &str) -> Result<Vec<f64>, String> {
    s.split(',')
        .map(|t| t.trim().parse::<f64>().map_err(|e| format!("bad '{t}': {e}")))
        .collect()
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

fn main() -> ExitCode {
    let args = Args::parse();
    let anchor_values = match parse_csv_f64(&args.anchor_weights) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("anomaly_self_play: {e}");
            return ExitCode::from(2);
        }
    };
    let payline_values = match parse_csv_f64(&args.paylines) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("anomaly_self_play: {e}");
            return ExitCode::from(2);
        }
    };
    let bet_values = match parse_csv_f64(&args.bets) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("anomaly_self_play: {e}");
            return ExitCode::from(2);
        }
    };

    let knobs = vec![
        Knob { name: "anchor_weight".into(), values: anchor_values },
        Knob { name: "paylines".into(), values: payline_values },
        Knob { name: "bet".into(), values: bet_values },
    ];

    let base = standard_spec();
    let report = run_self_play_sweep(
        &base,
        &knobs,
        args.seeds_per_probe,
        args.spins_per_seed,
        RngKind::Pcg64,
        args.z_threshold,
        args.top_k,
    );

    if let Some(parent) = args.out.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(
        &args.out,
        serde_json::to_string_pretty(&report).expect("anomaly report serialisation"),
    )
    .expect("anomaly report write");

    eprintln!(
        "anomaly_self_play: probed {} configs, global Δ mean={:.4} stddev={:.4}, anomalies surfaced={}",
        report.probe_count,
        report.global_delta_mean,
        report.global_delta_stddev,
        report.anomalies.len(),
    );
    println!("| Rank | Δ RTP | z | suspect knob | suggestion |");
    println!("|---:|---:|---:|---|---|");
    for (i, a) in report.anomalies.iter().enumerate() {
        println!(
            "| {} | {:+.4} | {:+.2} | `{}` | {} |",
            i + 1, a.probe.delta, a.z_score, a.suspect_knob, a.suggestion,
        );
    }
    ExitCode::from(0)
}
