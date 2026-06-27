//! Monte Carlo Simulator
//!
//! High-performance parallel simulation using Rayon.

use crate::config::GameConfig;
use crate::evaluator::Evaluator;
use crate::features::FeatureSim;
use crate::grid::GridGenerator;
use crate::rng::SlotRng;
use crate::stats::{AtomicStats, MultiSeedStats, SeedStats};

use rayon::prelude::*;
use std::sync::atomic::Ordering;
use std::time::Instant;

/// Simulation result
#[derive(Debug)]
pub struct SimResult {
    pub total_spins: u64,
    pub duration_ms: u64,
    pub spins_per_sec: f64,

    pub rtp: f64,
    pub hit_rate: f64,
    pub fs_freq: f64,
    pub hnw_freq: f64,
    pub max_win_x: f64,

    pub base_rtp: f64,
    pub fs_rtp: f64,
    pub hnw_rtp: f64,
    pub lightning_rtp: f64,

    pub seed_stats: MultiSeedStats,
}

/// Simulator configuration
pub struct SimConfig {
    pub spins_per_seed: u64,
    pub num_seeds: u32,
    pub base_seed: u64,
    pub total_bet_mc: i64,
    pub verbose: bool,
    pub sequential: bool, // For exact TypeScript comparison (deterministic order)
}

impl Default for SimConfig {
    fn default() -> Self {
        SimConfig {
            spins_per_seed: 5_000_000, // Match TypeScript default
            num_seeds: 10,             // Match TypeScript default
            base_seed: 1,              // Not used - seeds are (i+1)*12345
            total_bet_mc: 1_000,       // 1.0 credit = 1000 millicredits (match TS TOTAL_BET=1.0)
            verbose: false,
            sequential: false,
        }
    }
}

/// Run simulation on a single seed
fn simulate_seed(config: &GameConfig, seed: u64, spins: u64, total_bet_mc: i64) -> SeedStats {
    let grid_gen = GridGenerator::new(config);
    let evaluator = Evaluator::new(config, &grid_gen);
    let feature_sim = FeatureSim::new(config, &grid_gen, &evaluator);

    let mut rng = SlotRng::new(seed);
    let mut wagered: i64 = 0;
    let mut won: i64 = 0;

    for _ in 0..spins {
        wagered += total_bet_mc;

        // PAR-14-E (Boki 2026-06-27): Bonus Buy mode — skip base game
        // and route every spin straight to FS simulation as if the
        // player bought in. The elevated bet (total_bet_mc) is
        // already configured at request time; we just redirect flow.
        if config.bonus_buy_mode {
            // Simulate a 3-scatter trigger directly. `scatter_count`
            // can be lifted to use weighted bonus tier selection in
            // future (e.g. Sweet Bonanza Bonus Buy with 4-scatter
            // premium tier). Default 3 = standard award schedule.
            let fs = feature_sim.simulate_free_spins(&mut rng, 3, total_bet_mc);
            won += fs.total_payout;
            continue;
        }

        // Generate base game grid
        let grid = grid_gen.generate_base(&mut rng);

        // Evaluate spin
        let result = evaluator.evaluate_spin(&grid, &mut rng, total_bet_mc, false, false);

        // Add base win
        won += result.final_win;

        // Handle features
        if result.hnw_triggered {
            let hnw = feature_sim.simulate_hnw(&mut rng, &grid, total_bet_mc);
            won += hnw.total_payout;
        } else if result.fs_triggered {
            let fs = feature_sim.simulate_free_spins(&mut rng, result.scatter_count, total_bet_mc);
            won += fs.total_payout;
        }
    }

    let rtp = if wagered > 0 {
        (won as f64 / wagered as f64) * 100.0
    } else {
        0.0
    };

    SeedStats {
        spins,
        wagered,
        won,
        rtp,
    }
}

/// Run full simulation with detailed stats
pub fn run_simulation(config: &GameConfig, sim_config: &SimConfig) -> SimResult {
    let start = Instant::now();

    // Create seeds - MUST MATCH TypeScript: seed = (s + 1) * 12345
    let seeds: Vec<u64> = (0..sim_config.num_seeds)
        .map(|i| (i as u64 + 1) * 12345)
        .collect();

    // Run parallel simulation
    let seed_results: Vec<SeedStats> = seeds
        .par_iter()
        .map(|&seed| {
            simulate_seed(
                config,
                seed,
                sim_config.spins_per_seed,
                sim_config.total_bet_mc,
            )
        })
        .collect();

    let duration_ms = start.elapsed().as_millis() as u64;

    // Aggregate results
    let total_spins = seed_results.iter().map(|s| s.spins).sum::<u64>();
    let total_wagered = seed_results.iter().map(|s| s.wagered).sum::<i64>();
    let total_won = seed_results.iter().map(|s| s.won).sum::<i64>();

    let overall_rtp = if total_wagered > 0 {
        (total_won as f64 / total_wagered as f64) * 100.0
    } else {
        0.0
    };

    let spins_per_sec = if duration_ms > 0 {
        (total_spins as f64 / duration_ms as f64) * 1000.0
    } else {
        0.0
    };

    let seed_stats = MultiSeedStats::from_seeds(seed_results);

    SimResult {
        total_spins,
        duration_ms,
        spins_per_sec,
        rtp: overall_rtp,
        hit_rate: 0.0, // Would need detailed tracking
        fs_freq: 0.0,
        hnw_freq: 0.0,
        max_win_x: 0.0,
        base_rtp: 0.0,
        fs_rtp: 0.0,
        hnw_rtp: 0.0,
        lightning_rtp: 0.0,
        seed_stats,
    }
}

/// Run simulation with full statistics tracking
pub fn run_simulation_detailed(
    config: &GameConfig,
    sim_config: &SimConfig,
) -> (SimResult, AtomicStats) {
    let start = Instant::now();
    let global_stats = AtomicStats::new();

    // Create seeds - MUST MATCH TypeScript: seed = (s + 1) * 12345
    let seeds: Vec<u64> = (0..sim_config.num_seeds)
        .map(|i| (i as u64 + 1) * 12345)
        .collect();

    // Run simulation - sequential or parallel based on config
    let seed_results: Vec<(SeedStats, AtomicStats)> = if sim_config.sequential {
        // Sequential mode - for exact TypeScript comparison
        seeds
            .iter()
            .map(|&seed| {
                simulate_seed_detailed(
                    config,
                    seed,
                    sim_config.spins_per_seed,
                    sim_config.total_bet_mc,
                )
            })
            .collect()
    } else {
        // Parallel mode - maximum performance
        seeds
            .par_iter()
            .map(|&seed| {
                simulate_seed_detailed(
                    config,
                    seed,
                    sim_config.spins_per_seed,
                    sim_config.total_bet_mc,
                )
            })
            .collect()
    };

    // Merge stats
    let mut all_seed_stats = Vec::with_capacity(seed_results.len());
    for (seed_stat, local_stats) in seed_results {
        global_stats.merge(&local_stats);
        all_seed_stats.push(seed_stat);
    }

    let duration_ms = start.elapsed().as_millis() as u64;
    let total_spins = global_stats.total_spins.load(Ordering::Relaxed);
    let total_wagered = global_stats.total_wagered.load(Ordering::Relaxed);
    let total_won = global_stats.total_won.load(Ordering::Relaxed);

    let spins_per_sec = if duration_ms > 0 {
        (total_spins as f64 / duration_ms as f64) * 1000.0
    } else {
        0.0
    };

    let seed_stats = MultiSeedStats::from_seeds(all_seed_stats);

    let result = SimResult {
        total_spins,
        duration_ms,
        spins_per_sec,
        rtp: global_stats.rtp(),
        hit_rate: global_stats.hit_rate(),
        fs_freq: global_stats.fs_frequency(),
        hnw_freq: global_stats.hnw_frequency(),
        max_win_x: global_stats.max_win.load(Ordering::Relaxed) as f64
            / sim_config.total_bet_mc as f64,
        base_rtp: (global_stats.total_base_won.load(Ordering::Relaxed) as f64
            / total_wagered as f64)
            * 100.0,
        fs_rtp: (global_stats.total_fs_won.load(Ordering::Relaxed) as f64 / total_wagered as f64)
            * 100.0,
        hnw_rtp: (global_stats.total_hnw_won.load(Ordering::Relaxed) as f64 / total_wagered as f64)
            * 100.0,
        lightning_rtp: (global_stats.total_lightning_uplift.load(Ordering::Relaxed) as f64
            / total_wagered as f64)
            * 100.0,
        seed_stats,
    };

    (result, global_stats)
}

/// Simulate single seed with detailed statistics.
///
/// `pub` so the Faza 9.8 `BulkDispatcher` can drive it on per-worker
/// shards without duplicating the inner loop. Returns the merged
/// `SeedStats` plus the local `AtomicStats` so the caller can decide
/// whether to keep per-seed records or only roll them up.
pub fn simulate_seed_detailed(
    config: &GameConfig,
    seed: u64,
    spins: u64,
    total_bet_mc: i64,
) -> (SeedStats, AtomicStats) {
    let grid_gen = GridGenerator::new(config);
    let evaluator = Evaluator::new(config, &grid_gen);
    let feature_sim = FeatureSim::new(config, &grid_gen, &evaluator);

    let mut rng = SlotRng::new(seed);
    let stats = AtomicStats::new();

    for _ in 0..spins {
        stats.total_spins.fetch_add(1, Ordering::Relaxed);
        stats
            .total_wagered
            .fetch_add(total_bet_mc, Ordering::Relaxed);

        // Generate base game grid
        let grid = grid_gen.generate_base(&mut rng);

        // Evaluate spin
        let result = evaluator.evaluate_spin(&grid, &mut rng, total_bet_mc, false, false);

        // Track base win
        let base_win = result.base_win;
        let lightning_uplift = result.final_win - result.base_win;

        stats
            .total_base_won
            .fetch_add(result.final_win, Ordering::Relaxed);

        if result.final_win > 0 {
            stats.winning_spins.fetch_add(1, Ordering::Relaxed);
        }

        if result.multiplier > 1 {
            stats.lightning_triggers.fetch_add(1, Ordering::Relaxed);
            stats
                .total_lightning_uplift
                .fetch_add(lightning_uplift, Ordering::Relaxed);
        }

        let mut total_win = result.final_win;

        // Handle features
        if result.hnw_triggered {
            stats.hnw_triggers.fetch_add(1, Ordering::Relaxed);

            let hnw = feature_sim.simulate_hnw(&mut rng, &grid, total_bet_mc);
            total_win += hnw.total_payout;
            stats
                .total_hnw_won
                .fetch_add(hnw.total_payout, Ordering::Relaxed);
            stats
                .total_hnw_respins
                .fetch_add(hnw.total_respins as u64, Ordering::Relaxed);

            if hnw.full_grid_bonus {
                stats.hnw_full_grids.fetch_add(1, Ordering::Relaxed);
            }

            stats
                .jackpots_mini
                .fetch_add(hnw.jackpots_mini as u64, Ordering::Relaxed);
            stats
                .jackpots_minor
                .fetch_add(hnw.jackpots_minor as u64, Ordering::Relaxed);
            stats
                .jackpots_major
                .fetch_add(hnw.jackpots_major as u64, Ordering::Relaxed);
            stats
                .jackpots_grand
                .fetch_add(hnw.jackpots_grand as u64, Ordering::Relaxed);
        } else if result.fs_triggered {
            stats.fs_triggers.fetch_add(1, Ordering::Relaxed);

            let fs = feature_sim.simulate_free_spins(&mut rng, result.scatter_count, total_bet_mc);
            total_win += fs.total_payout;
            stats
                .total_fs_won
                .fetch_add(fs.total_payout, Ordering::Relaxed);
            stats
                .total_fs_spins
                .fetch_add(fs.spins_played as u64, Ordering::Relaxed);
            stats
                .fs_retriggers
                .fetch_add(fs.retriggers as u64, Ordering::Relaxed);

            // Update max mult
            let max_mult = fs.max_mult_reached as u64;
            loop {
                let current = stats.max_mult_seen.load(Ordering::Relaxed);
                if max_mult <= current {
                    break;
                }
                if stats
                    .max_mult_seen
                    .compare_exchange(current, max_mult, Ordering::Relaxed, Ordering::Relaxed)
                    .is_ok()
                {
                    break;
                }
            }
        }

        stats.total_won.fetch_add(total_win, Ordering::Relaxed);

        // Record win for distribution histogram
        if total_win > 0 {
            let win_mult = total_win as f64 / total_bet_mc as f64;
            stats.record_win(win_mult);
        }

        // Track max win
        loop {
            let current = stats.max_win.load(Ordering::Relaxed);
            if total_win <= current {
                break;
            }
            if stats
                .max_win
                .compare_exchange(current, total_win, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
            {
                break;
            }
        }
    }

    let wagered = stats.total_wagered.load(Ordering::Relaxed);
    let won = stats.total_won.load(Ordering::Relaxed);
    let rtp = if wagered > 0 {
        (won as f64 / wagered as f64) * 100.0
    } else {
        0.0
    };

    let seed_stat = SeedStats {
        spins,
        wagered,
        won,
        rtp,
    };

    (seed_stat, stats)
}
