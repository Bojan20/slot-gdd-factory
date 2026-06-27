//! W152 P0-5 — TS↔Rust evaluator parity oracle.
//!
//! This binary is the **Rust-side oracle** for the cross-language
//! parity gate. Given an IR JSON file, a u64 seed, and a spin count, it
//! deterministically generates `N` base-game grids using the legacy
//! Mulberry32-equivalent `SlotRng` (the only PRNG that is currently
//! bit-identical between the TS engine and the Rust simulator) and
//! emits a Newline-Delimited JSON stream on stdout describing each
//! spin's evaluation result.
//!
//! The TS side (`tests/evaluator_parity.test.ts`) spawns this binary,
//! parses the NDJSON, then runs the **same** `N` spins through the TS
//! engine and asserts per-spin equality of every emitted field. Any
//! drift in either implementation flags a parity regression.
//!
//! Why per-spin NDJSON instead of an aggregate hash?
//!   * Easier failure triage — the first divergent spin index is the
//!     direct pointer to the bug.
//!   * Stream-friendly: TS can read while Rust is still writing for
//!     large `N`, no peak memory burst.
//!   * Each line is independently parseable, so flaky CI runners that
//!     drop the trailing byte still tell you exactly where they
//!     stopped.
//!
//! Usage:
//! ```bash
//! cargo run --release --bin evaluator_parity -- \
//!     --config tests/fixtures/parity.json \
//!     --seed 42 \
//!     --spins 1000
//! ```
//!
//! Output (one JSON object per line, NDJSON):
//! ```text
//! {"spin":0,"base_win":0,"scatter_count":0,"bonus_count":0,"fs_triggered":false,"hnw_triggered":false,"fs_awarded":0,"multiplier":1,"final_win":0}
//! {"spin":1,"base_win":500,"scatter_count":1,...}
//! ...
//! ```
//!
//! Only base-game (non-free-spin) spins are emitted; the parity oracle
//! does NOT simulate FS sessions because that path uses `lightning`
//! multipliers which carry stochastic RNG calls the TS Mulberry32 path
//! cannot reproduce. We pass `disable_lightning = true` to make the
//! result a pure function of (config, seed, spin_idx).

use clap::Parser;
use serde::Serialize;
use slot_sim::config::GameConfig;
use slot_sim::evaluator::{EvalMode, Evaluator};
use slot_sim::grid::GridGenerator;
use slot_sim::ir::{ir_to_game_config, SlotGameIR};
use slot_sim::rng::SlotRng;
use std::io::{BufWriter, Write};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(
    name = "evaluator_parity",
    about = "W152 P0-5 — emit per-spin evaluation JSON for TS↔Rust parity comparison"
)]
struct Args {
    /// IR JSON config path. Will be parsed via `SlotGameIR::from_json`
    /// and converted via `ir_to_game_config` — the same pipeline the
    /// production simulator uses.
    #[arg(long)]
    config: PathBuf,

    /// u64 seed for the base-game spin grid generator. The same seed
    /// must be passed to the TS side so both implementations consume
    /// the same Mulberry32 stream.
    #[arg(long)]
    seed: u64,

    /// Number of base-game spins to emit. Each emission is a single
    /// NDJSON line on stdout. 1 ≤ spins ≤ 10_000_000_000 (W233 raised
    /// cap from 10M → 10B to unblock cert-tier aggregate-RTP parity
    /// gate; per-spin throughput is ~30M/s so even 10B fits in ~6 min).
    #[arg(long)]
    spins: u64,

    /// Evaluation mode. Defaults to `lines` because that's the only
    /// path the legacy TS engine guarantees bit-match for. Other modes
    /// (`ways`, `cluster`, `pay_anywhere`) are wired through the same
    /// `Evaluator` so they emit identically here; whether the TS side
    /// can match them is tested per-fixture.
    #[arg(long, default_value = "lines")]
    mode: String,
}

/// One JSON record per emitted spin. Keep field names snake_case so
/// the TS side can `JSON.parse` directly without renaming.
///
/// W152 Wave 11 — Faza 10.3 extension: the record now also carries
/// `grid_symbols` (per-spin flat list of symbol ids, row-major
/// `reels × rows`) so the TS-side mirror grid generator can verify a
/// **byte-identical per-cell match**, not just aggregate RTP. Symbol
/// strings are emitted instead of u8 indices so the comparison stays
/// stable across config reorderings (the index→symbol mapping isn't
/// promised to be stable, but the IR symbol ids are).
#[derive(Serialize)]
struct SpinRecord {
    spin: u64,
    base_win: i64,
    scatter_count: u8,
    bonus_count: u8,
    fs_triggered: bool,
    hnw_triggered: bool,
    fs_awarded: u8,
    multiplier: u32,
    final_win: i64,
    /// Row-major flat list of symbol ids (length `reels × rows`).
    /// Each entry is the IR symbol id string for that cell.
    grid_symbols: Vec<String>,
}

fn load_config(path: &PathBuf) -> GameConfig {
    let raw = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("could not read config {path:?}: {e}"));
    let ir: SlotGameIR =
        SlotGameIR::from_json(&raw).unwrap_or_else(|e| panic!("IR parse failed: {e}"));
    ir_to_game_config(&ir).unwrap_or_else(|e| panic!("IR adapter failed: {e:?}"))
}

fn parse_mode(s: &str) -> EvalMode {
    match s {
        "lines" => EvalMode::Lines,
        "ways" => EvalMode::Ways,
        "pay_anywhere" => EvalMode::PayAnywhere { min_count: 3 },
        "cluster" => EvalMode::Cluster { min_size: 5 },
        other => panic!("unsupported parity mode: {other}"),
    }
}

fn main() {
    let args = Args::parse();
    assert!(args.spins > 0, "--spins must be > 0");
    assert!(
        args.spins <= 10_000_000_000,
        "--spins capped at 10B (W233 raise); per-spin throughput ~30M/s"
    );

    let cfg = load_config(&args.config);
    let grid_gen = GridGenerator::new(&cfg);
    let evaluator = Evaluator::with_mode(&cfg, &grid_gen, parse_mode(&args.mode));

    let mut rng = SlotRng::new(args.seed);
    let stdout = std::io::stdout();
    let mut out = BufWriter::new(stdout.lock());

    // 1-credit (1000 mc) total bet so payouts equal pay_multiplier ×
    // 1000 mc — matches the legacy TS simulator's default unit bet.
    let total_bet_mc: i64 = 1000;

    let num_reels = cfg.reels as usize;
    let num_rows = cfg.rows as usize;

    for spin_idx in 0u64..args.spins {
        let grid = grid_gen.generate_base(&mut rng);
        // Flatten the grid (row-major: reel-by-reel, top→bottom rows).
        // We must do this BEFORE `evaluate_spin` because the evaluator
        // mutates the grid in place for cascades / respins. Faza 10.3
        // wants the pristine post-spin grid for byte-match.
        let mut grid_symbols: Vec<String> = Vec::with_capacity(num_reels * num_rows);
        for reel in 0..num_reels {
            for row in 0..num_rows {
                let sym_idx = grid.get(reel, row);
                grid_symbols.push(grid_gen.symbol_id(sym_idx).to_string());
            }
        }

        let result =
            evaluator.evaluate_spin(&grid, &mut rng, total_bet_mc, false, /*disable_lightning*/ true);

        let rec = SpinRecord {
            spin: spin_idx,
            base_win: result.base_win,
            scatter_count: result.scatter_count,
            bonus_count: result.bonus_count,
            fs_triggered: result.fs_triggered,
            hnw_triggered: result.hnw_triggered,
            fs_awarded: result.fs_awarded,
            multiplier: result.multiplier,
            final_win: result.final_win,
            grid_symbols,
        };
        // One JSON line per spin (NDJSON). `to_string` + manual `\n`
        // avoids the trailing-comma + bracket overhead of a top-level
        // JSON array while keeping each line independently parseable.
        let line = serde_json::to_string(&rec).expect("serialise SpinRecord");
        writeln!(out, "{line}").expect("write parity ndjson");
    }
    // Ensure the BufWriter flushes before the process exits — otherwise
    // the consumer may see truncated output on small `--spins` runs.
    out.flush().expect("flush parity ndjson");
}
