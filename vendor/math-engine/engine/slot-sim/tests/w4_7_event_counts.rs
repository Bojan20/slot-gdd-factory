//! W4.7 — Event count diagnostic (helper, not a strict assertion).

use slot_sim::ir::Ir;
use slot_sim::sim::Engine;

const LW_PAR_001: &str =
    "../../games/ce-copy-test/out/lw.200-1637-001.slot-sim.ir.json";

#[test]
fn dump_event_counts() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    let engine = Engine::new(&ir);
    let stats = engine.run(1_000_000, 1, 0xCAFE_F00D);

    let mut events: Vec<(String, u64)> = stats
        .event_count
        .iter()
        .map(|(k, v)| (k.clone(), *v))
        .collect();
    events.sort_by_key(|x| std::cmp::Reverse(x.1));

    println!("\n=== Event counts (1M spins) ===");
    for (k, v) in events.iter().take(20) {
        println!("  {:35}: {}", k, v);
    }
    println!("RTP: {:.5}", stats.rtp());
    println!("Hit freq: {:.5}", stats.hit_freq());

    let fs_trig: u64 = events
        .iter()
        .filter(|(k, _)| k.starts_with("fs_trigger"))
        .map(|(_, v)| v)
        .sum();
    let fs_retrig: u64 = events
        .iter()
        .filter(|(k, _)| k.starts_with("fs_retrigger"))
        .map(|(_, v)| v)
        .sum();
    let ce_trig: u64 = events
        .iter()
        .filter(|(k, _)| k.starts_with("hold_and_win:triggered"))
        .map(|(_, v)| v)
        .sum();
    let pw_trig: u64 = events
        .iter()
        .filter(|(k, _)| k.starts_with("pattern_win"))
        .map(|(_, v)| v)
        .sum();

    println!("\nFS trigger rate:  1 in {}", if fs_trig > 0 { 1_000_000 / fs_trig } else { 0 });
    println!("FS retrigger total: {}", fs_retrig);
    println!("CE trigger rate:  1 in {}", if ce_trig > 0 { 1_000_000 / ce_trig } else { 0 });
    println!("Pattern win rate: 1 in {}", if pw_trig > 0 { 1_000_000 / pw_trig } else { 0 });
}
