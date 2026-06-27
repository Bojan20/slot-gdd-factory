//! PAR-003 — EVT Pareto tail section in the PAR sheet.
//!
//! Atoms covered:
//!   A1 — `ParetoTailSection { kind, threshold, alpha, ks_p_value, ks_p_seed,
//!         evt_p99999, cap_pressure_pct, reason }` present on every sheet.
//!   A2 — Heavy-tail (synthetic Pareto α=1.5 spins) yields `kind = Fitted`
//!         with finite α̂ and `cap_pressure_pct > 0`.
//!   A3 — Light-tail (bounded uniform spins) either still fits but with
//!         large α (rapid decay), or emits `kind = NotApplicable`; in either
//!         case `cap_pressure_pct ≈ 0` since the cap is far above the bulk.

use slot_sim::par::{PARBuildContext, PARGenerator, ParetoFitKind};
use slot_sim::rng::SlotRng;
use slot_sim::stats::{AtomicStats, MultiSeedStats, PARMetrics, SeedStats};
use std::sync::atomic::Ordering;

fn build_par_with_distribution<F: Fn(&mut SlotRng) -> f64>(
    n_spins: u64,
    max_win_cap: f64,
    sampler: F,
) -> slot_sim::par::PARSheet {
    let stats = AtomicStats::new();
    stats.total_spins.store(n_spins, Ordering::Relaxed);
    stats.total_wagered.store(n_spins as i64, Ordering::Relaxed);

    let mut rng = SlotRng::new(0xDEAD_BEEF);
    let mut total_won = 0i64;
    for i in 0..n_spins {
        let win = sampler(&mut rng);
        stats.record_win_full(win, 1, i);
        total_won += win as i64;
    }
    stats.total_won.store(total_won, Ordering::Relaxed);

    let multi = MultiSeedStats::from_seeds(vec![SeedStats {
        spins: n_spins,
        wagered: n_spins as i64,
        won: total_won,
        rtp: (total_won as f64) / (n_spins as f64) * 100.0,
    }]);
    let par_m = PARMetrics::from_stats(&stats, &multi, 1);

    let ctx = PARBuildContext {
        stats: &stats,
        par: &par_m,
        jackpots: vec![],
        game_id: "par-003-test".to_string(),
        game_version: "1.0.0".to_string(),
        target_rtp: 96.0,
        rtp_tolerance: 5.0,
        max_win_cap,
        jurisdictions: vec!["MGA".to_string()],
        rtp_range_required: [50.0, 200.0],
        near_miss_rule: "must_be_random".to_string(),
        ldw_disclosure: true,
        session_time_display: true,
        seeds_used: 1,
        ir: None,
        sign_off: None,
    };
    PARGenerator::generate_with_context(ctx)
}

// ─── A1: section is always present ───────────────────────────────────────────

#[test]
fn pareto_section_present_on_every_sheet() {
    let par = build_par_with_distribution(50_000, 5_000.0, |rng| {
        // Mixture: 60% zero, 40% small win in [0, 5x].
        if rng.random() < 0.6 {
            0.0
        } else {
            rng.random() * 5.0
        }
    });
    // Section exists either as Fitted or NotApplicable — both serde cases work.
    assert!(par.pareto_tail.ks_p_seed != 0, "deterministic seed set");
}

// ─── A2: heavy-tail Pareto α=1.5 → Fitted + cap_pressure > 0 ────────────────

#[test]
fn heavy_tail_fitted_with_cap_pressure() {
    // Synthetic Pareto(α=1.5, xm=10) — heavy tail by construction.
    let par = build_par_with_distribution(60_000, 1_000.0, |rng| {
        let u = rng.random().clamp(1e-9, 1.0 - 1e-9);
        // Pareto inverse CDF: x = xm * (1 - U)^(-1/α)
        10.0 * (1.0 - u).powf(-1.0 / 1.5)
    });
    assert!(
        matches!(par.pareto_tail.kind, ParetoFitKind::Fitted),
        "heavy tail must fit, got {:?} reason={:?}",
        par.pareto_tail.kind,
        par.pareto_tail.reason
    );
    assert!(
        par.pareto_tail.alpha > 0.0,
        "α̂ must be positive when Fitted, got {}",
        par.pareto_tail.alpha
    );
    assert!(
        par.pareto_tail.evt_p99999 > par.pareto_tail.threshold,
        "EVT P99.999 ({}) must exceed threshold ({})",
        par.pareto_tail.evt_p99999,
        par.pareto_tail.threshold
    );
    assert!(
        par.pareto_tail.cap_pressure_pct > 0.0,
        "heavy tail with cap=1000x must show non-zero cap pressure, got {}%",
        par.pareto_tail.cap_pressure_pct
    );
}

// ─── A3: bounded (light) tail → low cap pressure regardless of fit verdict ──

#[test]
fn light_tail_has_low_cap_pressure() {
    // Bounded uniform [0, 5] — max possible win is 5x, far below cap=10_000x.
    let par = build_par_with_distribution(20_000, 10_000.0, |rng| rng.random() * 5.0);
    // Whether the section fits or not, cap pressure must be effectively zero.
    assert!(
        par.pareto_tail.cap_pressure_pct < 0.01,
        "bounded tail with cap=10_000x must have ~0 cap pressure, got {}%",
        par.pareto_tail.cap_pressure_pct
    );
}

// ─── Bonus: ks_p_seed is reproducible across runs ──────────────────────────

#[test]
fn ks_p_seed_is_deterministic_across_runs() {
    let par1 = build_par_with_distribution(20_000, 1_000.0, |rng| {
        let u = rng.random().clamp(1e-9, 1.0 - 1e-9);
        5.0 * (1.0 - u).powf(-1.0 / 2.0)
    });
    let par2 = build_par_with_distribution(20_000, 1_000.0, |rng| {
        let u = rng.random().clamp(1e-9, 1.0 - 1e-9);
        5.0 * (1.0 - u).powf(-1.0 / 2.0)
    });
    assert_eq!(
        par1.pareto_tail.ks_p_seed, par2.pareto_tail.ks_p_seed,
        "ks_p_seed must be constant — Doc reproducibility requirement"
    );
    // With deterministic SlotRng seed (0xDEAD_BEEF) and same distribution, fits match.
    if matches!(par1.pareto_tail.kind, ParetoFitKind::Fitted)
        && matches!(par2.pareto_tail.kind, ParetoFitKind::Fitted)
    {
        assert!(
            (par1.pareto_tail.alpha - par2.pareto_tail.alpha).abs() < 1e-9,
            "same input must produce same alpha"
        );
    }
}
