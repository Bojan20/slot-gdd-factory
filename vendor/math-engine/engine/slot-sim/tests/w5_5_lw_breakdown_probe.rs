//! W5.5 probe — granular L&W RTP breakdown to find the residual 0.5 % gap.
//!
//! Print FS line wins separately from CE-from-FS contributions so we
//! can localise the missing RTP.

use slot_sim::ir::Ir;
use slot_sim::sim::Engine;

const LW_PAR_001: &str =
    "../../games/ce-copy-test/out/lw.200-1637-001.slot-sim.ir.json";

#[test]
fn lw_granular_breakdown() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    let engine = Engine::new(&ir);
    let stats = engine.run(10_000_000, 1, 0xCAFED00D);

    println!("\n=== L&W 10M-spin granular breakdown ===");
    println!("RTP total: {:.5}", stats.rtp());
    for (kind, x) in &stats.feature_x {
        let rtp_part = x / stats.spins as f64;
        println!("  {:30} {:.5}", kind, rtp_part);
    }

    let fs_trig: u64 = stats
        .event_count
        .iter()
        .filter(|(k, _)| k.starts_with("fs_trigger"))
        .map(|(_, v)| v)
        .sum();
    let fs_retrig: u64 = stats
        .event_count
        .iter()
        .filter(|(k, _)| k.starts_with("fs_retrigger"))
        .map(|(_, v)| v)
        .sum();
    let fs_total: u64 = stats
        .event_count
        .iter()
        .filter(|(k, _)| k.starts_with("fs_total"))
        .map(|(_, v)| v)
        .sum();
    // fs_total values are formatted "fs_total:N" so we need to sum the N
    let fs_total_spins: u64 = stats
        .event_count
        .iter()
        .filter(|(k, _)| k.starts_with("fs_total:"))
        .map(|(k, v)| {
            let n: u64 = k.strip_prefix("fs_total:").unwrap_or("0").parse().unwrap_or(0);
            n * v
        })
        .sum();
    let ce_base: u64 = stats
        .event_count
        .iter()
        .filter(|(k, _)| k.starts_with("hold_and_win:triggered"))
        .map(|(_, v)| v)
        .sum();
    let ce_fs: u64 = stats
        .event_count
        .iter()
        .filter(|(k, _)| k.starts_with("hold_and_win:fs_triggered"))
        .map(|(_, v)| v)
        .sum();
    let we: u64 = stats
        .event_count
        .iter()
        .filter(|(k, _)| k.starts_with("wild_expand"))
        .map(|(_, v)| v)
        .sum();
    println!("\nEvents:");
    println!("  FS triggers:        {}  (rate 1 in {})", fs_trig,
        if fs_trig > 0 { stats.spins / fs_trig } else { 0 });
    println!("  FS retriggers:      {}", fs_retrig);
    println!("  FS total trigger events: {}", fs_total);
    println!("  FS total spins:     {}  (avg {:.2}/trigger)", fs_total_spins,
        if fs_trig > 0 { fs_total_spins as f64 / fs_trig as f64 } else { 0.0 });
    println!("  CE-from-base:       {}  (rate 1 in {})", ce_base,
        if ce_base > 0 { stats.spins / ce_base } else { 0 });
    println!("  CE-from-FS:         {}", ce_fs);
    println!("  Wild expansions:    {}  (rate 1 in {})", we,
        if we > 0 { stats.spins / we } else { 0 });
}
