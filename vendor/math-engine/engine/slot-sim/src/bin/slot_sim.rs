// slot-sim — universal IR-driven Monte-Carlo driver.
// Usage: slot-sim --ir <path> --spins <N> [--bet-mult <M>] [--seed <S>] [--threads <T>]

use clap::Parser;
use rayon::prelude::*;
use slot_sim::ir::Ir;
use slot_sim::sim::Engine;
use slot_sim::stats::SimStats;

#[derive(Parser, Debug)]
#[command(name = "slot-sim", about = "Universal slot Monte-Carlo driver — IR in, stats out")]
struct Args {
    #[arg(long)]
    ir: String,
    #[arg(long, default_value_t = 1_000_000)]
    spins: u64,
    #[arg(long, default_value_t = 1)]
    bet_mult: i64,
    #[arg(long, default_value_t = 0xC0DE_BABE)]
    seed: u64,
    #[arg(long, default_value_t = 0)]
    threads: usize,
}

fn main() {
    let args = Args::parse();
    let ir = Ir::load(&args.ir).expect("load IR");
    let n_threads = if args.threads == 0 { rayon::current_num_threads() } else { args.threads };
    let chunk = args.spins.div_ceil(n_threads as u64);
    let chunks: Vec<(u64, u64)> = (0..n_threads as u64)
        .map(|i| (i, chunk.min(args.spins.saturating_sub(i * chunk))))
        .filter(|(_, n)| *n > 0)
        .collect();
    let t0 = std::time::Instant::now();
    let stats = chunks
        .par_iter()
        .map(|(i, n)| {
            let eng = Engine::new(&ir);
            eng.run(*n, args.bet_mult, args.seed ^ (*i + 1).wrapping_mul(0x9E37_79B9_7F4A_7C15))
        })
        .reduce(SimStats::default, |mut a, b| { a.merge(&b); a });
    let el = t0.elapsed();
    let n = stats.spins as f64;
    println!("== slot-sim ==");
    println!("Game:     {}", ir.meta.name);
    println!("SWID:     {}", ir.meta.swid);
    println!("Family:   {}", ir.meta.family);
    println!("Spins:    {}", stats.spins);
    println!("Elapsed:  {:.2?}", el);
    println!("Spins/s:  {:.0}", stats.spins as f64 / el.as_secs_f64());
    println!();
    println!("RTP:       {:.6}  (Excel {:.6})", stats.rtp(), ir.meta.rtp_total);
    println!("Hit freq:  {:.6}  (Excel {:.6})", stats.hit_freq(), ir.meta.hit_frequency);
    println!("Win freq:  {:.6}  (Excel {:.6})", stats.win_freq(), ir.meta.win_frequency);
    println!("Max spin:  {:.2}×", stats.max_single_x);
    println!();
    // W4.3e — per-feature RTP breakdown (helps audit where the engine ↔
    // Excel gap lies). `base_x` is line/pattern wins; `feature_x[k]` is
    // each named feature's contribution in total-bet units.
    if !stats.feature_x.is_empty() {
        let base_rtp = stats.base_x / n;
        println!("Per-feature RTP breakdown:");
        println!("  {:24}  {:.6}", "base (lines + scatter)", base_rtp);
        let mut feats: Vec<(&String, &f64)> = stats.feature_x.iter().collect();
        feats.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap_or(std::cmp::Ordering::Equal));
        let mut feat_sum = 0.0;
        for (k, v) in &feats {
            let r = **v / n;
            feat_sum += r;
            println!("  {:24}  {:.6}", k, r);
        }
        println!("  {:24}  {:.6}", "TOTAL", base_rtp + feat_sum);
        println!();
    }
    // W4.9d — Event-count breakdown helps audit per-feature firing rates
    // against Excel hit frequencies. Each event tag emitted by a feature
    // runner is counted; the 1-in-N column shows the rate.
    if !stats.event_count.is_empty() {
        println!("Event counts (per-spin firing rates):");
        let mut events: Vec<(&String, &u64)> = stats.event_count.iter().collect();
        events.sort_by(|a, b| b.1.cmp(a.1));
        for (k, v) in &events {
            let per = if **v > 0 { n / **v as f64 } else { f64::INFINITY };
            println!("  {:32}  count={:>10}  1 in {:>10.2}", k, v, per);
        }
        println!();
    }
    println!("Volatility distribution:");
    let print = |label: &str, hits: u64| {
        let per = if hits > 0 { n / hits as f64 } else { f64::INFINITY };
        println!("  {:6}  1 in {:>10.2}  hits={}", label, per, hits);
    };
    print("10x+",  stats.wins_ge_10x);
    print("20x+",  stats.wins_ge_20x);
    print("50x+",  stats.wins_ge_50x);
    print("100x+", stats.wins_ge_100x);
    print("200x+", stats.wins_ge_200x);
    print("500x+", stats.wins_ge_500x);
    print("1000x+",stats.wins_ge_1000x);
}
