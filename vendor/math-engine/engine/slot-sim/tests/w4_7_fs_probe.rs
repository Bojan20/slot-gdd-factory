//! W4.7 probe — empirical FS trigger / payback breakdown on L&W CE.
//! Not a strict assertion; prints event counts to validate fs_pt routing.

use slot_sim::ir::Ir;
use slot_sim::sim::Engine;

const LW_PAR_001: &str =
    "../../games/ce-copy-test/out/lw.200-1637-001.slot-sim.ir.json";

#[test]
fn fs_paytable_compiled_when_emitted() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    let engine = Engine::new(&ir);
    assert!(
        engine.fs_pt.is_some(),
        "FS-specific paytable must compile when Feature::FreeSpins carries fs_paytable",
    );
}

#[test]
fn fs_events_fire() {
    let ir = Ir::load(LW_PAR_001).expect("load");
    let engine = Engine::new(&ir);
    let stats = engine.run(500_000, 1, 0xABCD);
    let fs_trig: u64 = stats
        .event_count
        .iter()
        .filter(|(k, _)| k.starts_with("fs_trigger"))
        .map(|(_, v)| v)
        .sum();
    // FS trigger rate ~0.7 % → expect ~3500 in 500k spins. Allow 1k..10k.
    assert!(
        fs_trig > 1_000 && fs_trig < 10_000,
        "FS triggers {} outside expected [1000, 10000] band",
        fs_trig,
    );
}
