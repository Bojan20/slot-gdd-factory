//! W6.3 — Fault injection harness CLI.
//!
//! Run the pre-cert anomaly smoke gate over the standard 5×3 / 20-line
//! reference spec (or a user-supplied spec) and emit a JSON report.
//!
//! Example::
//!
//!     cargo run --release --bin fault_injection -- \
//!         --n-seeds 50 \
//!         --spins-per-seed 5000 \
//!         --base-seed 0xC0FFEE \
//!         --rng pcg64 \
//!         --probe-samples 100000 \
//!         --out reports/acceptance/FAULT_INJECTION.json
//!
//! Exit code 0 if all probes pass, 1 if any fail.

use clap::Parser;
use slot_sim::fault_injection::run_full_harness;
use slot_sim::qmc_estimator::LinesEvalSpec;
use slot_sim::rng::RngKind;
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser, Debug)]
#[command(
    name = "fault_injection",
    about = "Pre-cert RNG/seed anomaly harness (seed sweep + lag-1 + monobit)"
)]
struct Args {
    /// Spec JSON path (LinesEvalSpec). Defaults to classic 5x3 / 20-line.
    #[arg(long)]
    spec: Option<PathBuf>,

    /// Number of seeds in the sweep.
    #[arg(long, default_value_t = 50)]
    n_seeds: u32,

    /// Spins per seed (passed through to estimate_rtp_mc).
    #[arg(long, default_value_t = 5_000_u64)]
    spins_per_seed: u64,

    /// Base seed; sweep walks `base, base+1, ..., base+N-1`.
    #[arg(long, default_value_t = 0x42_u64)]
    base_seed: u64,

    /// RNG backend: mulberry32 / pcg64 / xoshiro / philox / chacha20.
    #[arg(long, default_value = "pcg64")]
    rng: String,

    /// Sample size for lag-1 correlation + monobit probes.
    #[arg(long, default_value_t = 100_000_u64)]
    probe_samples: u64,

    /// Output JSON path; parent dirs are created on demand.
    #[arg(long)]
    out: PathBuf,
}

fn parse_rng(s: &str) -> Result<RngKind, String> {
    match s.to_lowercase().as_str() {
        "mulberry32" | "mulberry" => Ok(RngKind::Mulberry32),
        "pcg64" => Ok(RngKind::Pcg64),
        "xoshiro" | "xoshiro256" | "xoshiro256ss" => Ok(RngKind::Xoshiro256StarStar),
        "philox" | "philox4x32" => Ok(RngKind::Philox4x32),
        "chacha20" | "chacha" => Ok(RngKind::ChaCha20),
        other => Err(format!("unknown RNG kind '{other}'")),
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

fn main() -> ExitCode {
    let args = Args::parse();
    let rng_kind = match parse_rng(&args.rng) {
        Ok(k) => k,
        Err(e) => {
            eprintln!("fault_injection: {e}");
            return ExitCode::from(2);
        }
    };
    let spec: LinesEvalSpec = if let Some(path) = &args.spec {
        match fs::read_to_string(path) {
            Ok(raw) => match serde_json::from_str(&raw) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("fault_injection: bad spec JSON: {e}");
                    return ExitCode::from(2);
                }
            },
            Err(e) => {
                eprintln!("fault_injection: cannot read {}: {}", path.display(), e);
                return ExitCode::from(2);
            }
        }
    } else {
        standard_spec()
    };

    let report = run_full_harness(
        &spec,
        args.n_seeds,
        args.spins_per_seed,
        args.base_seed,
        rng_kind,
        args.probe_samples,
    );

    if let Some(parent) = args.out.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Err(e) = fs::write(
        &args.out,
        serde_json::to_string_pretty(&report).expect("report serialisation"),
    ) {
        eprintln!("fault_injection: failed to write {}: {}", args.out.display(), e);
        return ExitCode::from(3);
    }

    eprintln!(
        "fault_injection: fan_mean={:.6} stddev={:.6} CF={:.6} | outliers(k=3)={} | corr passed={} | monobit passed={} | overall {}",
        report.fan.fan_mean_rtp,
        report.fan.fan_stddev_rtp,
        report.fan.closed_form_rtp,
        report.outliers_k3.len(),
        report.correlation.passed,
        report.monobit.passed,
        if report.overall_pass { "PASS ✓" } else { "FAIL ✗" },
    );

    if report.overall_pass {
        ExitCode::from(0)
    } else {
        ExitCode::from(1)
    }
}
