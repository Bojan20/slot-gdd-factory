//! Slot Simulator CLI
//!
//! High-performance Monte Carlo simulator for slot games.
//!
//! Usage:
//!   slot_sim --config game.json --spins 25000000 --seeds 40
//!   slot_sim --quick       # 50M total (matches TS default)
//!   slot_sim --full        # 1B total
//!   slot_sim --verify 1000 # Verify 1000 spins match TS exactly

// Lint policy lives in Cargo.toml `[lints]` so it applies to both
// `cargo check --lib` and `cargo build --bin slot_sim` without repeating
// the allow-list here. See `lib.rs` module-level docs.

// Re-export library modules under the names the rest of main.rs uses.
// Previously these were `mod X;` declarations which double-compiled
// each source file (once for the lib, once for the bin) and forked
// the `GameConfig` type — that broke the Faza 9.8 bulk dispatcher
// which lives on the library side. Aliasing to `slot_sim::X` makes
// both sides see the same types.
use slot_sim::analytical;
use slot_sim::config;
use slot_sim::ir;
use slot_sim::simulator;
use slot_sim::stats;

use clap::Parser;
use slot_sim::stats::{PARMetrics, WIN_BUCKETS};
use std::time::Instant;

/// Slot Machine Monte Carlo Simulator
#[derive(Parser, Debug)]
#[command(name = "slot_sim")]
#[command(author = "Slot Math Engine")]
#[command(version = "2.0.0")]
#[command(about = "High-performance slot machine Monte Carlo simulator")]
struct Args {
    /// Path to game configuration JSON
    #[arg(short, long)]
    config: Option<String>,

    /// Number of spins per seed
    #[arg(short, long, default_value_t = 5_000_000)]
    spins: u64,

    /// Number of seeds for multi-seed averaging
    #[arg(short = 'n', long, default_value_t = 10)]
    seeds: u32,

    /// Base seed for RNG (not used in normal mode - seeds are (i+1)*12345)
    #[arg(long, default_value_t = 1)]
    seed: u64,

    /// Quick mode (5M × 10 = 50M total, matches TS default)
    #[arg(long)]
    quick: bool,

    /// Full mode (25M × 40 = 1B total)
    #[arg(long)]
    full: bool,

    /// Verbose output with seed analysis and win distribution
    #[arg(short, long)]
    verbose: bool,

    /// Output results as JSON
    #[arg(long)]
    json: bool,

    /// Sequential mode (no parallelization, for exact TS comparison)
    #[arg(long)]
    sequential: bool,

    /// Verify mode: run N spins with seed 12345 and output for comparison
    #[arg(long)]
    verify: Option<u64>,

    /// Show win distribution histogram
    #[arg(long)]
    histogram: bool,

    /// Output full PAR sheet metrics
    #[arg(long)]
    par: bool,

    /// Analytical (exact) mode — zero-variance, no spins needed.
    /// Result is mathematically exact and identical every run.
    #[arg(long)]
    analytical: bool,

    /// Load game config from canonical IR JSON (instead of legacy format).
    /// When set together with --config, the config file is parsed as a
    /// SlotGameIR, cross-validated, then converted to GameConfig.
    #[arg(long)]
    ir: bool,

    // ─── Faza 9.8 bulk dispatcher ───────────────────────────────────
    /// Bulk mode — pass total spin count with optional suffix (`1T`,
    /// `100B`, `5M`). Activates the constant-memory dispatcher with
    /// progress + checkpoint hooks. Overrides `--spins` / `--seeds`.
    #[arg(long, value_name = "N")]
    bulk: Option<String>,

    /// Per-chunk spin count for the bulk dispatcher. Default 10M.
    #[arg(long, default_value_t = 10_000_000)]
    bulk_chunk_size: u64,

    /// Path to write a crash-resume checkpoint. Default: no checkpoint.
    #[arg(long, value_name = "PATH")]
    bulk_checkpoint: Option<String>,

    /// Resume from an existing checkpoint instead of starting fresh.
    #[arg(long, value_name = "PATH")]
    bulk_resume: Option<String>,

    /// Write a checkpoint every N chunks. Default 10 (every 100M with
    /// the default chunk size).
    #[arg(long, default_value_t = 10)]
    bulk_checkpoint_every: u64,

    /// Progress reporter — `bar` (default, stderr live bar), `json`
    /// (NDJSON line per tick), or `none`.
    #[arg(long, value_name = "MODE", default_value = "bar")]
    bulk_progress: String,
}

fn main() {
    let args = Args::parse();

    // Load config — either from IR JSON or legacy GameConfig JSON.
    let game_config = if let Some(path) = &args.config {
        if args.ir {
            // ── IR path: parse SlotGameIR → cross-validate → convert ──
            let content = match std::fs::read_to_string(path) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("Error reading IR config '{}': {}", path, e);
                    std::process::exit(1);
                }
            };
            let slot_ir = match ir::SlotGameIR::from_json(&content) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("Error parsing IR JSON '{}': {}", path, e);
                    std::process::exit(1);
                }
            };
            let report = ir::cross_validate(&slot_ir);
            if !report.errors.is_empty() {
                eprintln!("IR validation errors in '{}':", path);
                for err in &report.errors {
                    eprintln!("  [{}] {}", err.path, err.message);
                }
                std::process::exit(1);
            }
            if !report.warnings.is_empty() {
                for w in &report.warnings {
                    eprintln!("WARNING [{}] {}", w.path, w.message);
                }
            }
            match ir::ir_to_game_config(&slot_ir) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Error converting IR to GameConfig: {}", e);
                    std::process::exit(1);
                }
            }
        } else {
            // ── Legacy path: load GameConfig JSON directly ─────────────
            match config::GameConfig::from_file(path) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Error loading config: {}", e);
                    std::process::exit(1);
                }
            }
        }
    } else {
        eprintln!("No config specified, using default test config.");
        config::GameConfig::default()
    };

    // Analytical mode — exact, zero-variance, no Monte Carlo
    if args.analytical {
        run_analytical_mode(&game_config);
        return;
    }

    // Verify mode - single-threaded exact comparison
    if let Some(verify_spins) = args.verify {
        run_verify_mode(&game_config, verify_spins);
        return;
    }

    // Faza 9.8 — bulk dispatcher path (preempts standard MC when set)
    if let Some(bulk_str) = args.bulk.as_ref() {
        run_bulk_mode(&game_config, &args, bulk_str);
        return;
    }

    // Determine simulation parameters
    let (spins, seeds) = if args.quick {
        (5_000_000, 10) // Quick: 50M total (matches TS default)
    } else if args.full {
        (25_000_000, 40) // Full: 1B total
    } else {
        (args.spins, args.seeds)
    };

    let total_spins = spins * seeds as u64;

    if !args.json {
        println!("\n{}", "═".repeat(65));
        println!("  {} v{}", game_config.name, game_config.version);
        println!("  Target RTP: {:.2}%", game_config.target_rtp);
        println!("{}", "═".repeat(65));
        println!();
        println!(
            "Simulation: {} spins × {} seeds = {} total{}",
            format_number(spins),
            seeds,
            format_number(total_spins),
            if args.sequential { " (sequential)" } else { "" }
        );
        println!();
    }

    // Configure simulation
    let sim_config = simulator::SimConfig {
        spins_per_seed: spins,
        num_seeds: seeds,
        base_seed: args.seed,
        total_bet_mc: 1_000, // 1.0 credit = 1000 millicredits
        verbose: args.verbose,
        sequential: args.sequential,
    };

    // Run simulation
    let start = Instant::now();

    let (result, global_stats) = simulator::run_simulation_detailed(&game_config, &sim_config);

    let elapsed = start.elapsed();

    // PAR metrics
    let par = PARMetrics::from_stats(&global_stats, &result.seed_stats, sim_config.total_bet_mc);

    if args.json {
        print_json_output(&result, &par, &global_stats, args.histogram);
    } else {
        print_human_output(&result, &par, &global_stats, &game_config, elapsed, &args);
    }
}

/// Faza 9.8 — bulk dispatcher entry point. Parses the `--bulk` value,
/// builds a `BulkConfig`, and runs the constant-memory chunked loop
/// with progress + optional checkpoint/resume.
///
/// The `slot_sim::` qualification picks the library's `GameConfig` type
/// rather than `main.rs`'s privately-declared `mod config` shadow —
/// `BulkDispatcher` lives on the library side so the types must align.
fn run_bulk_mode(config: &config::GameConfig, args: &Args, bulk_str: &str) {
    use slot_sim::bulk::{
        parse_spin_count, BulkConfig, BulkDispatcher, JsonLineProgress, NoOpProgress,
        ProgressReporter, StdoutProgress,
    };
    use std::path::PathBuf;
    use std::sync::Arc;

    let total = match parse_spin_count(bulk_str) {
        Ok(n) => n,
        Err(e) => {
            eprintln!("--bulk: {e}");
            std::process::exit(2);
        }
    };
    let mut bulk = BulkConfig::new(total, args.seed);
    bulk.chunk_spins = args.bulk_chunk_size.max(1);
    bulk.threads_per_chunk = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    bulk.spins_per_worker = (bulk.chunk_spins / bulk.threads_per_chunk as u64).max(1);
    bulk.checkpoint_every_chunks = args.bulk_checkpoint_every;
    bulk.checkpoint_path = args.bulk_checkpoint.as_ref().map(PathBuf::from);
    bulk.resume_path = args.bulk_resume.as_ref().map(PathBuf::from);
    bulk.run_id = format!("bulk-{}-{}", config.name, args.seed);
    bulk.config_hash = String::new(); // populated once IR-driven config is universal

    let reporter: Arc<dyn ProgressReporter> = match args.bulk_progress.as_str() {
        "json" => Arc::new(JsonLineProgress),
        "none" => Arc::new(NoOpProgress),
        _ => Arc::new(StdoutProgress::new()),
    };

    let dispatcher = BulkDispatcher::new(config, bulk, reporter);
    let result = match dispatcher.run() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("bulk dispatcher failed: {e}");
            std::process::exit(1);
        }
    };

    if args.json {
        // Compact JSON summary so external tooling can pipe the result.
        println!(
            "{{\"total_spins\":{},\"duration_ms\":{},\"spins_per_sec\":{:.2},\"chunks\":{},\"checkpoints\":{},\"resumed_from\":{}}}",
            result.total_spins,
            result.duration.as_millis(),
            result.spins_per_sec,
            result.chunks_completed,
            result.checkpoints_written,
            result.resumed_from.map(|n| n as i64).unwrap_or(-1)
        );
    } else {
        eprintln!(
            "\nbulk run complete — {} spins in {:.2}s ({:.2}M spins/s, {} chunks, {} checkpoints)",
            result.total_spins,
            result.duration.as_secs_f64(),
            result.spins_per_sec / 1.0e6,
            result.chunks_completed,
            result.checkpoints_written
        );
    }
}

/// Analytical mode: compute exact RTP without any Monte Carlo sampling.
/// Result is deterministic — bit-identical every invocation.
fn run_analytical_mode(config: &config::GameConfig) {
    let start = Instant::now();
    let solver = analytical::AnalyticalSolver::new(config);
    let result = solver.solve();
    let elapsed = start.elapsed();

    analytical::print_analytical_report(&result, config.target_rtp);

    eprintln!(
        "  Computed in {:.3}ms  (no spins, no variance, exact result)",
        elapsed.as_secs_f64() * 1000.0
    );
}

/// Verify mode: run exact N spins with seed 12345 for comparison with TypeScript
fn run_verify_mode(config: &config::GameConfig, spins: u64) {
    use slot_sim::evaluator::Evaluator;
    use slot_sim::features::FeatureSim;
    use slot_sim::grid::GridGenerator;
    use slot_sim::rng::SlotRng;

    let grid_gen = GridGenerator::new(config);
    let evaluator = Evaluator::new(config, &grid_gen);
    let feature_sim = FeatureSim::new(config, &grid_gen, &evaluator);

    let mut rng = SlotRng::new(12345);
    let total_bet_mc: i64 = 1000;

    let mut total_wagered: i64 = 0;
    let mut total_won: i64 = 0;
    let mut base_wins: i64 = 0;
    let mut lightning_uplift: i64 = 0;
    let mut fs_wins: i64 = 0;
    let mut hnw_wins: i64 = 0;
    let mut fs_triggers: u64 = 0;
    let mut hnw_triggers: u64 = 0;

    for _ in 0..spins {
        total_wagered += total_bet_mc;

        let grid = grid_gen.generate_base(&mut rng);
        let result = evaluator.evaluate_spin(&grid, &mut rng, total_bet_mc, false, false);

        base_wins += result.base_win;
        if result.multiplier > 1 {
            lightning_uplift += result.final_win - result.base_win;
        }
        total_won += result.final_win;

        if result.hnw_triggered {
            hnw_triggers += 1;
            let hnw_result = feature_sim.simulate_hnw(&mut rng, &grid, total_bet_mc);
            hnw_wins += hnw_result.total_payout;
            total_won += hnw_result.total_payout;
        } else if result.fs_triggered {
            fs_triggers += 1;
            let fs_result =
                feature_sim.simulate_free_spins(&mut rng, result.scatter_count, total_bet_mc);
            fs_wins += fs_result.total_payout;
            total_won += fs_result.total_payout;
        }
    }

    let mc = |v: i64| v as f64 / 1000.0;

    println!("=== Rust Verify Mode (seed=12345, spins={}) ===", spins);
    println!();
    println!("Results (for comparison with TypeScript):");
    println!("  Total Wagered: {:.3}", mc(total_wagered));
    println!("  Total Won:     {:.6}", mc(total_won));
    println!("  Base Wins:     {:.6}", mc(base_wins));
    println!("  Lightning:     {:.6}", mc(lightning_uplift));
    println!("  FS Wins:       {:.6}", mc(fs_wins));
    println!("  H&W Wins:      {:.6}", mc(hnw_wins));
    println!("  FS Triggers:   {}", fs_triggers);
    println!("  H&W Triggers:  {}", hnw_triggers);
    println!(
        "  RTP:           {:.4}%",
        (total_won as f64 / total_wagered as f64) * 100.0
    );
}

fn print_json_output(
    result: &simulator::SimResult,
    par: &PARMetrics,
    stats: &stats::AtomicStats,
    include_histogram: bool,
) {
    println!("{{");
    println!("  \"total_spins\": {},", result.total_spins);
    println!("  \"duration_ms\": {},", result.duration_ms);
    println!("  \"spins_per_sec\": {:.0},", result.spins_per_sec);
    println!("  \"rtp\": {:.4},", result.rtp);
    println!("  \"hit_rate\": {:.4},", result.hit_rate);
    println!("  \"volatility_index\": {:.4},", par.volatility_index);
    println!("  \"fs_frequency\": {:.2},", result.fs_freq);
    println!("  \"hnw_frequency\": {:.2},", result.hnw_freq);
    println!("  \"max_win_x\": {:.2},", result.max_win_x);
    println!("  \"rtp_breakdown\": {{");
    println!("    \"base\": {:.4},", result.base_rtp);
    println!("    \"free_spins\": {:.4},", result.fs_rtp);
    println!("    \"hold_and_win\": {:.4},", result.hnw_rtp);
    println!("    \"lightning\": {:.4}", result.lightning_rtp);
    println!("  }},");
    println!("  \"confidence\": {{");
    println!("    \"mean_rtp\": {:.4},", result.seed_stats.mean_rtp);
    println!("    \"std_dev\": {:.4},", result.seed_stats.std_dev);
    println!("    \"std_error\": {:.4},", result.seed_stats.std_error);
    println!("    \"ci_95_low\": {:.4},", result.seed_stats.ci_95_low);
    println!("    \"ci_95_high\": {:.4}", result.seed_stats.ci_95_high);
    println!("  }}");

    if include_histogram {
        let dist = stats.get_distribution();
        println!("  ,\"win_distribution\": {{");
        for (i, count) in dist.buckets.iter().enumerate() {
            let range_end = if i + 1 < WIN_BUCKETS.len() {
                format!("{}", WIN_BUCKETS[i + 1])
            } else {
                "+".to_string()
            };
            let comma = if i < dist.buckets.len() - 1 { "," } else { "" };
            println!(
                "    \"{}-{}x\": {}{}",
                WIN_BUCKETS[i], range_end, count, comma
            );
        }
        println!("  }}");
    }

    println!("}}");
}

fn print_human_output(
    result: &simulator::SimResult,
    par: &PARMetrics,
    stats: &stats::AtomicStats,
    game_config: &config::GameConfig,
    elapsed: std::time::Duration,
    args: &Args,
) {
    println!("{}", "═".repeat(65));
    println!("  RESULTS");
    println!("{}", "═".repeat(65));
    println!();

    // RTP with confidence interval
    let rtp_delta = result.rtp - game_config.target_rtp;
    let rtp_status = if rtp_delta.abs() <= 0.01 {
        "✓ PASS"
    } else if rtp_delta.abs() <= 0.1 {
        "⚠ CLOSE"
    } else {
        "✗ FAIL"
    };

    println!(
        "RTP:          {:.3}% ({:+.3}%) {}",
        result.rtp, rtp_delta, rtp_status
    );
    println!(
        "95% CI:       [{:.3}%, {:.3}%]",
        result.seed_stats.ci_95_low, result.seed_stats.ci_95_high
    );
    println!("Std Error:    ±{:.4}%", result.seed_stats.std_error);
    println!();

    println!("RTP Breakdown:");
    println!("  Base Game:  {:.3}%", result.base_rtp);
    println!("  Free Spins: {:.3}%", result.fs_rtp);
    println!("  Hold & Win: {:.3}%", result.hnw_rtp);
    println!("  Lightning:  {:.3}%", result.lightning_rtp);
    println!();

    println!("Core Metrics:");
    println!("  Hit Rate:      {:.2}%", result.hit_rate);
    println!("  FS Frequency:  1/{:.1}", result.fs_freq);
    println!("  H&W Frequency: 1/{:.1}", result.hnw_freq);
    println!("  Max Win:       {:.1}x", result.max_win_x);
    println!("  Volatility:    {:.2}", par.volatility_index);
    println!();

    // Performance
    println!("{}", "═".repeat(65));
    println!("  PERFORMANCE");
    println!("{}", "═".repeat(65));
    println!();
    println!("Duration:     {:.2}s", elapsed.as_secs_f64());
    println!(
        "Speed:        {} spins/sec",
        format_number(result.spins_per_sec as u64)
    );
    println!();

    // PAR sheet metrics
    if args.par {
        println!("{}", "═".repeat(65));
        println!("  PAR SHEET METRICS");
        println!("{}", "═".repeat(65));
        println!();
        println!("Avg FS Win:   {:.2}x", par.avg_fs_win);
        println!("Avg FS Spins: {:.1}", par.avg_fs_spins);
        println!("Avg H&W Win:  {:.2}x", par.avg_hnw_win);
        println!();
    }

    // Win distribution histogram
    if args.histogram || args.verbose {
        let dist = stats.get_distribution();
        println!("{}", "═".repeat(65));
        println!("  WIN DISTRIBUTION");
        println!("{}", "═".repeat(65));
        println!();

        let total_wins = dist.win_count;
        if total_wins > 0 {
            for (i, count) in dist.buckets.iter().enumerate() {
                let range_start = WIN_BUCKETS[i];
                let range_end = if i + 1 < WIN_BUCKETS.len() {
                    format!("{:<5}", WIN_BUCKETS[i + 1])
                } else {
                    "+    ".to_string()
                };
                let pct = (*count as f64 / total_wins as f64) * 100.0;
                let bar_len = (pct * 0.5) as usize;
                let bar = "█".repeat(bar_len.min(25));
                println!(
                    "{:>5}x - {:>5}x: {:>6.2}% {} ({})",
                    range_start,
                    range_end,
                    pct,
                    bar,
                    format_number(*count)
                );
            }
            println!();
        }
    }

    // Seed variance analysis
    if args.verbose && !result.seed_stats.seeds.is_empty() {
        println!("{}", "═".repeat(65));
        println!("  SEED ANALYSIS");
        println!("{}", "═".repeat(65));
        println!();

        let mut rtps: Vec<f64> = result.seed_stats.seeds.iter().map(|s| s.rtp).collect();
        rtps.sort_by(|a, b| a.partial_cmp(b).unwrap());

        println!("Min RTP:      {:.3}%", rtps.first().unwrap_or(&0.0));
        println!("Max RTP:      {:.3}%", rtps.last().unwrap_or(&0.0));
        println!(
            "Range:        {:.3}%",
            rtps.last().unwrap_or(&0.0) - rtps.first().unwrap_or(&0.0)
        );
        println!("Std Dev:      {:.4}%", result.seed_stats.std_dev);
        println!();
    }

    println!("{}", "═".repeat(65));
}

fn format_number(n: u64) -> String {
    if n >= 1_000_000_000 {
        format!("{:.2}B", n as f64 / 1_000_000_000.0)
    } else if n >= 1_000_000 {
        format!("{:.2}M", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{:.2}K", n as f64 / 1_000.0)
    } else {
        n.to_string()
    }
}
