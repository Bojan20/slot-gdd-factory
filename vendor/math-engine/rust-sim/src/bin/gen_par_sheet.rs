//! W250 — End-to-end PAR sheet generator CLI.
//!
//! Loads an IR JSON, runs a Monte Carlo simulation, builds a full Tier-1 PAR
//! sheet (PAR-001..009) plus Ultimate Math sections (PAR-010..021), and writes
//! the result in every supported format: native JSON, USIF v1.0 JSON, CSV
//! (regulator-flat), and Markdown (pandoc → PDF downstream).
//!
//! Example:
//!   gen_par_sheet --ir tests/fixtures/parity-base-only.json \
//!                 --spins 200000 --seeds 4 \
//!                 --out-dir reports/par/parity-base-only
//!
//! Emits:
//!   reports/par/<base>/par.json
//!   reports/par/<base>/par.usif.json
//!   reports/par/<base>/par.csv
//!   reports/par/<base>/par.md

use clap::Parser;
use slot_sim::ir::{ir_to_game_config, SlotGameIR};
use slot_sim::par::{PARBuildContext, PARGenerator, SignOffSection};
use slot_sim::par_export::{to_csv, to_markdown_report, to_usif_v1};
use slot_sim::par_pdf::render_par_pdf;
use slot_sim::simulator::{run_simulation_detailed, SimConfig};
use slot_sim::stats::PARMetrics;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

#[derive(Parser, Debug)]
#[command(name = "gen_par_sheet")]
#[command(version = "1.0.0")]
#[command(about = "End-to-end PAR sheet generator (IR → MC sim → 4-format export)")]
struct Args {
    /// Path to the SlotGameIR JSON.
    #[arg(long)]
    ir: String,

    /// Spins per seed.
    #[arg(long, default_value_t = 200_000)]
    spins: u64,

    /// Number of independent seeds.
    #[arg(long, default_value_t = 4)]
    seeds: u32,

    /// Target RTP for the tolerance check, in percent. Defaults to
    /// `ir.limits.target_rtp × 100` when present.
    #[arg(long)]
    target_rtp: Option<f64>,

    /// RTP tolerance in percentage points. Defaults to `ir.limits.rtp_tolerance × 100`.
    #[arg(long)]
    rtp_tolerance: Option<f64>,

    /// Output directory. Files written: par.json, par.usif.json, par.csv, par.md.
    #[arg(long, default_value = "reports/par")]
    out_dir: String,

    /// Comma-separated formats to emit (json,usif,csv,md). Default: all 4.
    #[arg(long, default_value = "json,usif,csv,md")]
    formats: String,

    /// Optional mathematician name for the SIGN-OFF section.
    #[arg(long)]
    mathematician: Option<String>,

    /// Optional approver name for the SIGN-OFF section.
    #[arg(long)]
    approved_by: Option<String>,

    /// Quiet mode — suppress the pretty-printed summary on stdout.
    #[arg(long)]
    quiet: bool,

    /// Treat IR validation errors as warnings (draft / pre-cert sheet mode).
    /// Strict by default — only allow this for non-cert deliverables.
    #[arg(long)]
    allow_soft_validation: bool,
}

fn main() -> ExitCode {
    let args = Args::parse();

    // 1. Load IR + cross-validate.
    let ir_text = match fs::read_to_string(&args.ir) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Error reading IR `{}`: {e}", args.ir);
            return ExitCode::from(2);
        }
    };
    let ir = match SlotGameIR::from_json(&ir_text) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Error parsing IR JSON `{}`: {e}", args.ir);
            return ExitCode::from(2);
        }
    };
    let report = slot_sim::ir::cross_validate(&ir);
    if !report.errors.is_empty() {
        for err in &report.errors {
            let label = if args.allow_soft_validation {
                "warning"
            } else {
                "error"
            };
            eprintln!("IR validation {label} [{}]: {}", err.path, err.message);
        }
        if !args.allow_soft_validation {
            return ExitCode::from(2);
        }
    }
    for w in &report.warnings {
        eprintln!("IR WARN [{}]: {}", w.path, w.message);
    }

    // 2. Convert IR → GameConfig + run detailed Monte Carlo simulation.
    let game_config = match ir_to_game_config(&ir) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("IR → GameConfig adapter failed: {e}");
            return ExitCode::from(2);
        }
    };
    let sim_config = SimConfig {
        spins_per_seed: args.spins,
        num_seeds: args.seeds,
        base_seed: 1,
        total_bet_mc: 1_000,
        verbose: false,
        sequential: false,
    };
    if !args.quiet {
        eprintln!(
            "▶ Running sim — {} spins × {} seeds = {} total…",
            args.spins,
            args.seeds,
            args.spins * args.seeds as u64
        );
    }
    let (sim_result, stats) = run_simulation_detailed(&game_config, &sim_config);
    let par_metrics = PARMetrics::from_stats(&stats, &sim_result.seed_stats, 1);

    // 3. Resolve target / tolerance with IR fallbacks.
    let target = args
        .target_rtp
        .unwrap_or(ir.limits.target_rtp * 100.0);
    let tolerance = args
        .rtp_tolerance
        .unwrap_or(ir.limits.rtp_tolerance * 100.0);

    // 4. Build PAR sheet via the unified context.
    let sign_off = if args.mathematician.is_some() || args.approved_by.is_some() {
        Some(SignOffSection {
            mathematician: args.mathematician.clone(),
            mathematician_signed_at_utc: None,
            approved_by: args.approved_by.clone(),
            approved_at_utc: None,
            signatures: Vec::new(),
        })
    } else {
        None
    };
    let ctx = PARBuildContext {
        stats: &stats,
        par: &par_metrics,
        jackpots: Vec::new(),
        game_id: ir.meta.id.clone(),
        game_version: ir.meta.version.clone(),
        target_rtp: target,
        rtp_tolerance: tolerance,
        max_win_cap: ir.limits.max_win_x,
        jurisdictions: ir.compliance.jurisdictions.clone(),
        rtp_range_required: [
            ir.compliance.rtp_range_required[0] * 100.0,
            ir.compliance.rtp_range_required[1] * 100.0,
        ],
        near_miss_rule: format!("{:?}", ir.compliance.near_miss_rule).to_lowercase(),
        ldw_disclosure: ir.compliance.ldw_disclosure,
        session_time_display: ir.compliance.session_time_display,
        seeds_used: args.seeds,
        ir: Some(&ir),
        sign_off,
    };
    let par = PARGenerator::generate_with_context(ctx);

    // 5. Resolve output paths + ensure parent dir exists.
    let base = Path::new(&args.ir)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| ir.meta.id.clone());
    let out_dir: PathBuf = Path::new(&args.out_dir).join(&base);
    if let Err(e) = fs::create_dir_all(&out_dir) {
        eprintln!("Cannot create out dir `{}`: {e}", out_dir.display());
        return ExitCode::from(3);
    }

    let formats: Vec<&str> = args
        .formats
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    let mut written: Vec<PathBuf> = Vec::new();

    if formats.contains(&"json") {
        let p = out_dir.join("par.json");
        let json = serde_json::to_string_pretty(&par).expect("PARSheet serialisation");
        if let Err(e) = fs::write(&p, json) {
            eprintln!("Failed to write `{}`: {e}", p.display());
            return ExitCode::from(3);
        }
        written.push(p);
    }
    if formats.contains(&"usif") {
        let p = out_dir.join("par.usif.json");
        let usif = to_usif_v1(&par);
        let json = serde_json::to_string_pretty(&usif).expect("USIF serialisation");
        if let Err(e) = fs::write(&p, json) {
            eprintln!("Failed to write `{}`: {e}", p.display());
            return ExitCode::from(3);
        }
        written.push(p);
    }
    if formats.contains(&"csv") {
        let p = out_dir.join("par.csv");
        if let Err(e) = fs::write(&p, to_csv(&par)) {
            eprintln!("Failed to write `{}`: {e}", p.display());
            return ExitCode::from(3);
        }
        written.push(p);
    }
    if formats.contains(&"md") {
        let p = out_dir.join("par.md");
        if let Err(e) = fs::write(&p, to_markdown_report(&par)) {
            eprintln!("Failed to write `{}`: {e}", p.display());
            return ExitCode::from(3);
        }
        written.push(p);
    }
    if formats.contains(&"pdf") {
        // W5.6 — native PDF 1.4 emitter, zero-dep. Bytes are deterministic
        // so the file SHA-256 can be pinned in the signed cert bundle.
        let p = out_dir.join("par.pdf");
        if let Err(e) = fs::write(&p, render_par_pdf(&par)) {
            eprintln!("Failed to write `{}`: {e}", p.display());
            return ExitCode::from(3);
        }
        written.push(p);
    }

    if !args.quiet {
        PARGenerator::print(&par);
        eprintln!("\n✔ Wrote {} file(s):", written.len());
        for p in &written {
            eprintln!("   {}", p.display());
        }
    }

    ExitCode::SUCCESS
}
