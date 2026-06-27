//! W152 Wave 28 — Faza 14.1 closure: 10⁹ replay u Rust-u single-thread.
//!
//! Wave 27 measured 15.76s na Node (16 ns/spin). JS optimum dostignut;
//! 1s target zahteva native binding. Ovo je Rust closure — preallocated
//! `Vec<f64>` indexed po linearizovanoj reel-position state-i, Mulberry32
//! lookup loop sa zero allocations po spinu.
//!
//! Run:
//!   cargo run --release --example billion_spins_replay
//!
//! Args (positional):
//!   1: spins (default 1_000_000_000)
//!   2: warmup (default 1_000_000)
//!   3: fixture path (default tests/fixtures/reference/5x3-20lines.json
//!      relative to rust-sim/../)
//!
//! Output: stable `[billion-spins-replay] key=value ...` markers, parsed
//! by `scripts/billion-spins-replay.mjs --rust-augment`.

use slot_sim::config::{GameConfig, PayEntry, ReelWeight, SymbolDef};
use slot_sim::evaluator::{EvalMode, Evaluator};
use slot_sim::grid::{DynGrid, GridGenerator};
use slot_sim::rng::SlotRng;
use std::collections::{BTreeMap, HashMap};
use std::env;
use std::fs;
use std::path::PathBuf;
use std::time::Instant;

// ── Minimal IR loader ──────────────────────────────────────────────────
//
// rust-sim's `ir::adapter::ir_to_game_config` requires the full IR schema
// to be in scope; this example only needs a 5×3 lines fixture. We parse
// just the fields we touch — reels (strips or weighted), paytable, paylines.

#[derive(serde::Deserialize)]
struct Topology {
    reels: u32,
    rows: u32,
}

#[derive(serde::Deserialize)]
struct ReelsBlock {
    mode: String,
    base: serde_json::Value, // either [["A","B",…], …] strips or [{…weights…}, …]
}

#[derive(serde::Deserialize)]
struct Symbol {
    id: String,
    #[serde(default)]
    kind: String,
}

#[derive(serde::Deserialize)]
struct EvaluationBlock {
    paylines: Vec<Vec<u8>>,
    #[serde(default)]
    min_match: Option<u8>,
}

#[derive(serde::Deserialize)]
struct PartialIr {
    topology: Topology,
    symbols: Vec<Symbol>,
    reels: ReelsBlock,
    evaluation: EvaluationBlock,
    paytable: BTreeMap<String, BTreeMap<String, f64>>,
}

fn materialise_weighted_reel(map: &serde_json::Map<String, serde_json::Value>) -> Vec<String> {
    // Deterministic alphabetic sort — matches TS `reelsFromIR.ts`.
    let mut entries: Vec<(String, u32)> = map
        .iter()
        .filter_map(|(k, v)| v.as_u64().map(|w| (k.clone(), w as u32)))
        .filter(|(_, w)| *w > 0)
        .collect();
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let mut strip = Vec::new();
    for (sym, w) in entries {
        for _ in 0..w {
            strip.push(sym.clone());
        }
    }
    strip
}

fn load_strips(ir: &PartialIr) -> Vec<Vec<String>> {
    match ir.reels.mode.as_str() {
        "strips" => serde_json::from_value::<Vec<Vec<String>>>(ir.reels.base.clone())
            .expect("reels.base strips parse"),
        "weighted" => {
            let raw: Vec<serde_json::Map<String, serde_json::Value>> =
                serde_json::from_value(ir.reels.base.clone()).expect("reels.base weighted parse");
            raw.iter().map(materialise_weighted_reel).collect()
        }
        other => panic!("unsupported reel mode '{other}'"),
    }
}

// ── Build a minimal GameConfig consistent with the IR ──────────────────

fn pay_entry_from(table: &BTreeMap<String, f64>) -> PayEntry {
    let mut e = PayEntry::default();
    for (n_str, pay) in table {
        match n_str.as_str() {
            "3" => e.pay3 = *pay,
            "4" => e.pay4 = *pay,
            "5" => e.pay5 = *pay,
            _ => {}
        }
    }
    e
}

fn build_game_config(ir: &PartialIr, strips: &[Vec<String>]) -> GameConfig {
    let mut cfg = GameConfig::default();
    cfg.reels = ir.topology.reels as u8;
    cfg.rows = ir.topology.rows as u8;
    cfg.paylines = ir.evaluation.paylines.clone();

    // SymbolDef list — paylines + wild_id() needs `symbols` populated.
    cfg.symbols = ir
        .symbols
        .iter()
        .map(|s| SymbolDef {
            id: s.id.clone(),
            name: s.id.clone(),
            is_wild: s.kind == "wild",
            is_scatter: s.kind == "scatter",
            is_bonus: s.kind == "bonus",
        })
        .collect();

    let mut paytable: HashMap<String, PayEntry> = HashMap::new();
    for (sym, t) in &ir.paytable {
        paytable.insert(sym.clone(), pay_entry_from(t));
    }
    cfg.paytable = paytable;

    // Convert per-reel strips into ReelWeight entries (one symbol per slot).
    // The evaluator only consults `paytable`, `paylines`, `wild_id`,
    // `scatter`; for the replay we just need a parseable config.
    let mut base_weights: Vec<Vec<ReelWeight>> = Vec::with_capacity(strips.len());
    for strip in strips {
        let mut counts: HashMap<String, u32> = HashMap::new();
        for s in strip {
            *counts.entry(s.clone()).or_insert(0) += 1;
        }
        let weights = counts
            .into_iter()
            .map(|(symbol, weight)| ReelWeight { symbol, weight })
            .collect();
        base_weights.push(weights);
    }
    cfg.fs_weights = base_weights.clone();
    cfg.base_weights = base_weights;

    cfg
}

// ── Pre-compute flat payouts: enumerate all reel-position states. ──────

fn build_flat_payouts(strips: &[Vec<String>], cfg: &GameConfig) -> Vec<f64> {
    let num_reels = strips.len();
    let rows = cfg.rows as usize;
    let strip_lens: Vec<usize> = strips.iter().map(|s| s.len()).collect();
    let total_states: u64 = strip_lens.iter().map(|&l| l as u64).product();

    let gen = GridGenerator::new(cfg);
    let eval = Evaluator::with_mode(cfg, &gen, EvalMode::Lines);

    // We need a symbol-id → grid-byte map. The Evaluator's symbol_id() maps
    // u8 idx → &str; build the inverse here so we can populate the grid
    // directly from strip strings.
    let mut sym_to_idx: HashMap<String, u8> = HashMap::new();
    for i in 0..=u8::MAX {
        let id = gen.symbol_id(i).to_string();
        if !id.is_empty() && !sym_to_idx.contains_key(&id) {
            sym_to_idx.insert(id, i);
        }
    }

    // Sanity: every strip symbol must be in sym_to_idx (otherwise the
    // strip references something the evaluator doesn't know — fixture bug).
    for (r, strip) in strips.iter().enumerate() {
        for s in strip {
            if !sym_to_idx.contains_key(s) {
                panic!("reel {r}: symbol '{s}' not registered in evaluator");
            }
        }
    }

    let mut payouts = vec![0.0f64; total_states as usize];
    let mut pos = vec![0usize; num_reels];

    // Standalone RNG (unused in pure-line evaluation; passed for API).
    let mut rng = SlotRng::new(0);
    let mut grid = DynGrid::new(num_reels, rows);

    let total_bet_mc: i64 = 100; // 100 minor units = 1.0 bet
    for state_idx in 0..(total_states as usize) {
        // Populate grid for the current odometer position.
        for (r, strip) in strips.iter().enumerate() {
            let p = pos[r];
            let len = strip.len();
            for row_i in 0..rows {
                let sym = &strip[(p + row_i) % len];
                grid.set(r, row_i, sym_to_idx[sym]);
            }
        }
        let res = eval.evaluate_spin(&grid, &mut rng, total_bet_mc, false, true);
        // Convert minor-currency win → unit bet ratio.
        payouts[state_idx] = res.base_win as f64 / total_bet_mc as f64;

        // Advance odometer (least-significant reel first).
        for r in (0..num_reels).rev() {
            pos[r] = (pos[r] + 1) % strip_lens[r];
            if pos[r] != 0 {
                break;
            }
        }
    }
    payouts
}

// ── Mulberry32 sampling loop ────────────────────────────────────────────
//
// Identical to TS Mulberry32; same seed → bit-for-bit same sequence.

#[inline(always)]
fn mulberry32_next(state: &mut u32) -> u32 {
    *state = state.wrapping_add(0x6d2b_79f5);
    let mut t = *state;
    t = (t ^ (t >> 15)).wrapping_mul(t | 1);
    t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
    t ^ (t >> 14)
}

fn replay_loop(payouts: &[f64], n: u64, seed: u32) -> f64 {
    let len = payouts.len();
    let mut state = seed;
    let mut total = 0.0f64;
    // 4× manual unroll; LLVM does the rest.
    let limit = n - (n % 4);
    let mut i = 0u64;
    while i < limit {
        let u = mulberry32_next(&mut state) as f64 / 4_294_967_296.0;
        total += payouts[(u * len as f64) as usize];
        let u = mulberry32_next(&mut state) as f64 / 4_294_967_296.0;
        total += payouts[(u * len as f64) as usize];
        let u = mulberry32_next(&mut state) as f64 / 4_294_967_296.0;
        total += payouts[(u * len as f64) as usize];
        let u = mulberry32_next(&mut state) as f64 / 4_294_967_296.0;
        total += payouts[(u * len as f64) as usize];
        i += 4;
    }
    while i < n {
        let u = mulberry32_next(&mut state) as f64 / 4_294_967_296.0;
        total += payouts[(u * len as f64) as usize];
        i += 1;
    }
    total
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let n_spins: u64 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(1_000_000_000);
    let n_warmup: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(1_000_000);
    let default_fixture = "tests/fixtures/reference/5x3-20lines.json";
    let fixture_arg = args.get(3).cloned().unwrap_or_else(|| default_fixture.to_string());

    // Resolve fixture path relative to CARGO_MANIFEST_DIR's parent (the repo root).
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.pop(); // off rust-sim/
    path.push(&fixture_arg);
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    let ir: PartialIr = serde_json::from_str(&text).expect("IR parse");
    let strips = load_strips(&ir);
    let total_states: u64 = strips.iter().map(|s| s.len() as u64).product();
    let cfg = build_game_config(&ir, &strips);

    eprintln!(
        "[billion-spins-replay] fixture={} reels={} rows={} states={}",
        fixture_arg, cfg.reels, cfg.rows, total_states
    );

    let t_build = Instant::now();
    let payouts = build_flat_payouts(&strips, &cfg);
    let build_ms = t_build.elapsed().as_secs_f64() * 1000.0;
    let mean_payout: f64 = payouts.iter().sum::<f64>() / payouts.len() as f64;
    eprintln!(
        "[billion-spins-replay] flat_build_ms={:.2} mean_payout={:.6}",
        build_ms, mean_payout
    );

    // Warmup.
    let _warm = replay_loop(&payouts, n_warmup, 0xC0DE_C0DE);

    // Measurement.
    let t_run = Instant::now();
    let total = replay_loop(&payouts, n_spins, 0xFEED_FACE);
    let wall_ns = t_run.elapsed().as_nanos();
    let wall_ms = wall_ns as f64 / 1_000_000.0;
    let ns_per_spin = wall_ns as f64 / n_spins as f64;
    let spins_per_sec = (n_spins as f64 * 1.0e9) / wall_ns as f64;
    let empirical_rtp = total / n_spins as f64;

    // Stable marker line for the JS report harness.
    println!(
        "[billion-spins-replay] lang=rust n_spins={} wall_ms={:.4} ns_per_spin={:.4} spins_per_sec={:.4e} empirical_rtp={:.6} mean_payout={:.6}",
        n_spins, wall_ms, ns_per_spin, spins_per_sec, empirical_rtp, mean_payout
    );
    eprintln!(
        "[billion-spins-replay] DONE rust {} replays in {:.2}ms ({:.2} ns/spin)",
        n_spins, wall_ms, ns_per_spin
    );
}
