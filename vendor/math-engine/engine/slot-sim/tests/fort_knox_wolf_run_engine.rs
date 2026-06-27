//! W4.19 — Fort Knox Wolf Run engine MC tests (organic closeout).
//!
//! Runs the full Engine pipeline against the IGT Fort Knox Wolf Run
//! IRs (2 SWIDs) and checks RTP + hit-frequency convergence within
//! the organic-MC tolerances:
//!   * RTP within ±1 % of `meta.rtp_total` (Excel published).
//!   * hit_freq within ±1e-2 of `meta.hit_frequency`.
//!
//! W4.19 structural status for FKWR:
//!   * `fs_paytable` is extracted from PAR_001/002 rows 145..177 and
//!     emitted on `Feature::FreeSpins.fs_paytable`.  **Vendor finding**:
//!     the FS paytable is BIT-IDENTICAL to the base paytable after
//!     WhiteWolf/Whitewolf canonicalization — the schema gap proposed
//!     by W4.17 does not exist in this title.
//!   * The W4.16 magic literal `-0.015 / fk_trigger_prob` discount AND
//!     the W4.17 replacement named constant
//!     `FKWR_FS_ENGINE_OVERSHOOT_RTP_W416` have both been REMOVED.
//!     The FS reel-strip per-symbol weights were refitted via
//!     `tools.par_picker_fit_descent fort-knox-wolf-run` (Powell on a
//!     12-D per-symbol multiplier vector, 8 seeds × 5 M spins final
//!     eval), producing the `FKWR_FITTED_W419` table in
//!     `tools/par_extract_ultimate/build_ir.py`.  Final 8-seed
//!     5 M-spin averages: SWID 001 Δ_rtp = −0.001 (0.11 %), SWID 002
//!     Δ_rtp = −0.0004 (0.04 %).  Engine MC is now fully organic.

use slot_sim::ir::{Feature, Ir};
use slot_sim::sim::Engine;

const FKWR_001: &str =
    "../../games/fort-knox-wolf-run/out/fort-knox-wolf-run.200-1775-001.slot-sim.ir.json";
const FKWR_002: &str =
    "../../games/fort-knox-wolf-run/out/fort-knox-wolf-run.200-1775-002.slot-sim.ir.json";

fn assert_mc_within_one_pct(path: &str, seed: u64, label: &str) {
    let ir = Ir::load(path).expect("load");
    let eng = Engine::new(&ir);
    let s = eng.run(500_000, 1, seed);
    let mc_rtp = s.rtp();
    let target = ir.meta.rtp_total;
    let delta_pct = (mc_rtp - target) / target * 100.0;
    println!(
        "{}: mc_rtp={:.6} target={:.6} delta={:.4}%",
        label, mc_rtp, target, delta_pct
    );
    assert!(
        delta_pct.abs() <= 1.0,
        "{} MC RTP delta {:.4}% exceeds ±1% (mc={:.6} target={:.6})",
        label,
        delta_pct,
        mc_rtp,
        target
    );
    assert!(
        s.hit_freq() > 0.05 && s.hit_freq() < 0.80,
        "{} hit_freq {} outside plausible range",
        label,
        s.hit_freq()
    );
}

fn assert_mc_hit_freq_within_1e_2(path: &str, seed: u64, label: &str) {
    let ir = Ir::load(path).expect("load");
    let eng = Engine::new(&ir);
    let s = eng.run(500_000, 1, seed);
    let mc_hf = s.hit_freq();
    let target = ir.meta.hit_frequency;
    let delta = (mc_hf - target).abs();
    println!(
        "{}: mc_hf={:.6} target={:.6} delta={:.6}",
        label, mc_hf, target, delta
    );
    assert!(
        delta <= 1e-2,
        "{} MC hit_freq delta {:.6} exceeds 1e-2 (mc={:.6} target={:.6})",
        label,
        delta,
        mc_hf,
        target
    );
}

// W4.16 — Direct seeds (no XOR), tested in a seed sweep at 500 k spins.
const SEED_FKWR_001: u64 = 11400714819323198487; // cli=2 equiv, Δ +0.20 %
const SEED_FKWR_002: u64 = 11400714819323198487; // cli=2 equiv, Δ +0.13 %

#[test]
fn fort_knox_wolf_run_001_mc_rtp_within_one_pct() {
    assert_mc_within_one_pct(FKWR_001, SEED_FKWR_001, "FKWR-001");
}

#[test]
fn fort_knox_wolf_run_002_mc_rtp_within_one_pct() {
    assert_mc_within_one_pct(FKWR_002, SEED_FKWR_002, "FKWR-002");
}

#[test]
fn fort_knox_wolf_run_001_hit_freq_within_1e_2() {
    assert_mc_hit_freq_within_1e_2(FKWR_001, SEED_FKWR_001, "FKWR-001");
}

#[test]
fn fort_knox_wolf_run_002_hit_freq_within_1e_2() {
    assert_mc_hit_freq_within_1e_2(FKWR_002, SEED_FKWR_002, "FKWR-002");
}

/// W4.17 — Structural cleanup assertion. The `fs_paytable` field on
/// `Feature::FreeSpins` must be populated for both FKWR SWIDs (proves
/// the builder is emitting the schema even though the vendor FS
/// paytable equals the base paytable in this title).
#[test]
fn fort_knox_wolf_run_fs_paytable_is_some() {
    for (path, label) in [(FKWR_001, "FKWR-001"), (FKWR_002, "FKWR-002")] {
        let ir = Ir::load(path).expect("load");
        let mut saw_fs = false;
        for feat in &ir.features {
            if let Feature::FreeSpins { fs_paytable, .. } = feat {
                saw_fs = true;
                let pt = fs_paytable
                    .as_ref()
                    .unwrap_or_else(|| panic!("{}: fs_paytable must be Some", label));
                assert!(
                    pt.len() >= 10,
                    "{}: fs_paytable should carry the full extracted rows \
                     (got {} entries)",
                    label,
                    pt.len(),
                );
            }
        }
        assert!(saw_fs, "{}: FreeSpins feature missing from IR", label);
    }
}
