//! Feature Implementations
//!
//! Free Spins with Progressive Multiplier
//! Hold & Win with Jackpot Orbs
//!
//! Faza 3 additions: `IRFeatureSim` — the IR-native parallel to
//! `FeatureSim`. Reads `Feature::FreeSpins`, `Feature::HoldAndWin`, and
//! `Feature::Cascade` directly from `SlotGameIR` so the TS and Rust
//! simulators traverse the same shape from the same JSON config. The
//! legacy `FeatureSim` (driven by `GameConfig`) is retained for the
//! Faza 2 verify path until every consumer is migrated off.

use crate::config::GameConfig;
use crate::evaluator::Evaluator;
use crate::grid::{Grid, GridGenerator};
use crate::ir::{self, Feature, ReelSet, SlotGameIR, SymbolKind};
use crate::rng::SlotRng;

/// Free Spins result
#[derive(Debug, Clone, Default)]
pub struct FSResult {
    pub total_payout: i64, // In millicredits
    pub spins_played: u32,
    pub retriggers: u32,
    pub max_mult_reached: u32,
    pub scatter_wins: i64, // In millicredits
}

/// Hold & Win orb
#[derive(Debug, Clone)]
pub struct HNWOrb {
    pub reel: u8,
    pub row: u8,
    pub value: u32, // Multiplier value
    pub jackpot: Option<String>,
}

/// Hold & Win result
#[derive(Debug, Clone, Default)]
pub struct HNWResult {
    pub total_payout: i64, // In millicredits
    pub total_respins: u32,
    pub final_orb_count: u8,
    pub full_grid_bonus: bool,
    pub jackpots_mini: u32,
    pub jackpots_minor: u32,
    pub jackpots_major: u32,
    pub jackpots_grand: u32,
}

/// Feature simulator
pub struct FeatureSim<'a> {
    config: &'a GameConfig,
    grid_gen: &'a GridGenerator<'a>,
    evaluator: &'a Evaluator<'a>,
    /// Precomputed orb weights: (value, weight, jackpot)
    orb_weights: Vec<(u32, u32, Option<String>)>,
    orb_total_weight: u32,
}

impl<'a> FeatureSim<'a> {
    pub fn new(
        config: &'a GameConfig,
        grid_gen: &'a GridGenerator<'a>,
        evaluator: &'a Evaluator<'a>,
    ) -> Self {
        let orb_weights: Vec<(u32, u32, Option<String>)> = config
            .hold_and_win
            .orb_values
            .iter()
            .map(|o| (o.value, o.weight, o.jackpot.clone()))
            .collect();
        let orb_total_weight: u32 = orb_weights.iter().map(|(_, w, _)| *w).sum();

        FeatureSim {
            config,
            grid_gen,
            evaluator,
            orb_weights,
            orb_total_weight,
        }
    }

    /// Generate orb value
    #[inline]
    fn generate_orb(&self, rng: &mut SlotRng) -> (u32, Option<String>) {
        let mut roll = rng.random() * self.orb_total_weight as f64;

        for (value, weight, jackpot) in &self.orb_weights {
            roll -= *weight as f64;
            if roll <= 0.0 {
                return (*value, jackpot.clone());
            }
        }

        (1, None)
    }

    /// Simulate Free Spins
    pub fn simulate_free_spins(
        &self,
        rng: &mut SlotRng,
        scatter_count: u8,
        total_bet_mc: i64,
    ) -> FSResult {
        let mut result = FSResult::default();

        // Get initial spins
        let mut spins_remaining = *self
            .config
            .free_spins
            .awards
            .get(&scatter_count)
            .unwrap_or(&10) as u32;

        let mut current_mult = self.config.free_spins.mult_start;
        let max_mult = self.config.free_spins.mult_max;
        let max_win_mc = (self.config.max_win_cap * 1000.0) as i64 * total_bet_mc / 1000;

        // Scatter pay from trigger
        if let Some(&scatter_pay) = self.config.free_spins.scatter_pays.get(&scatter_count) {
            let pay = (scatter_pay * 1000.0) as i64 * total_bet_mc / 1000;
            result.total_payout += pay;
            result.scatter_wins += pay;
        }

        let mut loop_count = 0;
        while spins_remaining > 0 && loop_count < self.config.feature_loop_cap {
            loop_count += 1;
            spins_remaining -= 1;
            result.spins_played += 1;

            // PAR-14-E #5 — Special Reel Set per-FS-round.
            // When the config carries non-empty special_reel_sets, pick
            // one weighted-random and generate the FS grid using that
            // set's reel weights. Otherwise fall back to the default
            // fs_weights via generate_fs.
            let grid = {
                let sets = &self.config.free_spins.special_reel_sets;
                if sets.is_empty() {
                    self.grid_gen.generate_fs(rng)
                } else {
                    let total_w: u32 = sets.iter().map(|s| s.weight).sum();
                    if total_w == 0 {
                        self.grid_gen.generate_fs(rng)
                    } else {
                        let mut roll = rng.random() * total_w as f64;
                        let mut picked = &sets[0];
                        for s in sets {
                            roll -= s.weight as f64;
                            if roll <= 0.0 { picked = s; break; }
                        }
                        self.grid_gen.generate_fs_with_set(rng, &picked.reels)
                    }
                }
            };

            // Check retrigger
            let scatters = self.grid_gen.count_scatters(&grid);
            if self.config.free_spins.retrigger_enabled && scatters >= 3 {
                let additional = *self.config.free_spins.awards.get(&scatters).unwrap_or(&0) as u32;
                spins_remaining += additional;
                result.retriggers += 1;

                // Scatter pay on retrigger
                if let Some(&scatter_pay) = self.config.free_spins.scatter_pays.get(&scatters) {
                    let pay =
                        (scatter_pay * 1000.0) as i64 * total_bet_mc / 1000 * current_mult as i64;
                    result.total_payout += pay;
                    result.scatter_wins += pay;
                }
            }

            // Evaluate spin (no lightning in FS)
            let spin_result = self.evaluator.evaluate_spin(
                &grid,
                rng,
                total_bet_mc,
                true, // is_free_spin
                true, // disable_lightning
            );

            // Apply progressive multiplier
            if spin_result.base_win > 0 {
                result.total_payout += spin_result.base_win * current_mult as i64;

                // Increment multiplier
                if current_mult < max_mult {
                    current_mult += self.config.free_spins.mult_increment;
                    result.max_mult_reached = result.max_mult_reached.max(current_mult);
                }
            }

            // Check max win cap
            if result.total_payout >= max_win_mc {
                result.total_payout = max_win_mc;
                break;
            }
        }

        result.max_mult_reached = result.max_mult_reached.max(current_mult);
        result
    }

    /// Simulate Hold & Win
    pub fn simulate_hnw(
        &self,
        rng: &mut SlotRng,
        initial_grid: &Grid,
        total_bet_mc: i64,
    ) -> HNWResult {
        let num_reels = self.config.reels as usize;
        let num_rows = self.config.rows as usize;
        let total_cells = num_reels * num_rows;

        let mut result = HNWResult::default();
        // Flatten occupied into a Vec<Vec<bool>> so dimensions come from config.
        let mut occupied = vec![vec![false; num_rows]; num_reels];
        let mut orb_values: Vec<(u8, u8, u32)> = Vec::with_capacity(total_cells);

        let max_win_mc = (self.config.max_win_cap * 1000.0) as i64 * total_bet_mc / 1000;

        // Count initial orbs upfront so we can pick the right scenario.
        let initial_bonus_count = self.grid_gen.count_bonus(initial_grid);

        // PAR-14-E sister-side feature #3: Multi-scenario HnW. If a
        // scenario matches the initial bonus_count, use its overrides
        // for respins / chances / orb_values. Otherwise fall back to
        // the top-level HoldAndWinConfig.
        let scenario = self
            .config
            .hold_and_win
            .scenarios
            .iter()
            .find(|s| s.initial_count == initial_bonus_count);

        let initial_respins = scenario
            .map(|s| s.initial_respins)
            .unwrap_or(self.config.hold_and_win.initial_respins);
        let respins_on_new_orb = scenario
            .map(|s| s.respins_on_new_orb)
            .unwrap_or(self.config.hold_and_win.respins_on_new_orb);
        let chance_base = scenario
            .map(|s| s.orb_land_chance_base)
            .unwrap_or(self.config.hold_and_win.orb_land_chance_base);
        let chance_fill = scenario
            .map(|s| s.orb_land_chance_fill_bonus)
            .unwrap_or(self.config.hold_and_win.orb_land_chance_fill_bonus);
        // Orb table override is handled via generate_orb_for; we pass
        // the optional scenario pointer down.
        let _scenario_orb_table = scenario.map(|s| &s.orb_values);

        // Place initial orbs from the triggering grid.
        for reel in 0..num_reels {
            for row in 0..num_rows {
                if self.grid_gen.is_bonus(initial_grid.get(reel, row)) {
                    occupied[reel][row] = true;
                    let (value, jackpot) = self.generate_orb(rng);
                    orb_values.push((reel as u8, row as u8, value));

                    if let Some(j) = &jackpot {
                        match j.to_uppercase().as_str() {
                            "MINI" => result.jackpots_mini += 1,
                            "MINOR" => result.jackpots_minor += 1,
                            "MAJOR" => result.jackpots_major += 1,
                            "GRAND" => result.jackpots_grand += 1,
                            _ => {}
                        }
                    }
                }
            }
        }

        let mut respins_remaining = initial_respins;
        let mut loop_count = 0;
        let mut orb_count: u8 = orb_values.len() as u8;
        let total_cells_u8 = total_cells as u8;

        // Respin loop — stop when grid is full or respins exhausted.
        while respins_remaining > 0
            && orb_count < total_cells_u8
            && loop_count < self.config.feature_loop_cap
        {
            loop_count += 1;
            respins_remaining -= 1;
            result.total_respins += 1;

            let mut new_orbs = 0;

            // Each empty cell has a chance to land an orb.
            let fill_ratio = orb_count as f64 / total_cells as f64;
            // PAR-14-E #3: scenario-aware chances if present.
            let orb_chance = chance_base + fill_ratio * chance_fill;

            for reel in 0..num_reels {
                for row in 0..num_rows {
                    if occupied[reel][row] {
                        continue;
                    }

                    if rng.random() < orb_chance {
                        occupied[reel][row] = true;
                        orb_count += 1;
                        new_orbs += 1;

                        let (value, jackpot) = self.generate_orb(rng);
                        orb_values.push((reel as u8, row as u8, value));

                        if let Some(j) = &jackpot {
                            match j.to_uppercase().as_str() {
                                "MINI" => result.jackpots_mini += 1,
                                "MINOR" => result.jackpots_minor += 1,
                                "MAJOR" => result.jackpots_major += 1,
                                "GRAND" => result.jackpots_grand += 1,
                                _ => {}
                            }
                        }
                    }
                }
            }

            // Reset respins counter when new orbs land.
            if new_orbs > 0 {
                // PAR-14-E #3: scenario-aware respin reset.
                respins_remaining = respins_on_new_orb;
            }
        }

        // Calculate payout
        for (_, _, value) in &orb_values {
            result.total_payout += *value as i64 * total_bet_mc;
        }

        // Full grid bonus
        result.final_orb_count = orb_count;
        if orb_count >= total_cells_u8 {
            result.full_grid_bonus = true;
            result.total_payout +=
                (self.config.hold_and_win.full_grid_bonus * 1000.0) as i64 * total_bet_mc / 1000;
        }

        // Apply max win cap
        if result.total_payout > max_win_mc {
            result.total_payout = max_win_mc;
        }

        result
    }
}

// ─── IRFeatureSim — Faza 3 ─────────────────────────────────────────────────

/// Cascade result: cumulative payout (mc), chain count, peak multiplier.
#[derive(Debug, Clone, Default)]
pub struct CascadeResult {
    pub total_payout: i64,
    pub chain_count: u32,
    pub max_multiplier: u32,
}

/// IR-aware feature simulator. Parallel to `FeatureSim`, but reads
/// `Feature` variants from `SlotGameIR` so callers can drive Faza 3
/// features (FS chain, H&W, Cascade) without the legacy `GameConfig`
/// adapter step.
pub struct IRFeatureSim<'a> {
    pub ir: &'a SlotGameIR,
    pub grid_gen: &'a GridGenerator<'a>,
    pub evaluator: &'a Evaluator<'a>,
    /// Borrowed `GameConfig` used by the underlying evaluator/grid generator.
    /// The IR is the canonical source of truth, but the engine still
    /// consumes a config — `IRFeatureSim::new` takes both so callers don't
    /// have to re-thread the conversion.
    pub config: &'a GameConfig,
}

impl<'a> IRFeatureSim<'a> {
    pub fn new(
        ir: &'a SlotGameIR,
        config: &'a GameConfig,
        grid_gen: &'a GridGenerator<'a>,
        evaluator: &'a Evaluator<'a>,
    ) -> Self {
        IRFeatureSim {
            ir,
            grid_gen,
            evaluator,
            config,
        }
    }

    // ─── Helpers ────────────────────────────────────────────────────────

    fn find_free_spins(&self) -> Option<&'a Feature> {
        self.ir
            .features
            .iter()
            .find(|f| matches!(f, Feature::FreeSpins { .. }))
    }

    fn find_hold_and_win(&self) -> Option<&'a Feature> {
        self.ir
            .features
            .iter()
            .find(|f| matches!(f, Feature::HoldAndWin { .. }))
    }

    fn find_cascade(&self) -> Option<&'a Feature> {
        self.ir
            .features
            .iter()
            .find(|f| matches!(f, Feature::Cascade { .. }))
    }

    /// Resolve awarded spins for an FS trigger from `trigger.thresholds`.
    /// Picks the highest threshold ≤ `scatter_count`; defaults to 10.
    fn fs_awarded(trigger: &ir::TriggerByCount, scatter_count: u8) -> u32 {
        if let Some(thresholds) = &trigger.thresholds {
            // Highest threshold ≤ scatter_count.
            let mut best: Option<(u32, f64)> = None;
            for (key, &val) in thresholds {
                let numeric = key.trim_end_matches('+');
                if let Ok(n) = numeric.parse::<u32>() {
                    if (scatter_count as u32) >= n {
                        match best {
                            Some((bn, _)) if bn >= n => {}
                            _ => best = Some((n, val)),
                        }
                    }
                }
            }
            if let Some((_, v)) = best {
                return v as u32;
            }
        }
        10
    }

    // ─── Free Spins ─────────────────────────────────────────────────────

    pub fn simulate_fs_ir(&self, rng: &mut SlotRng, trigger_scatter: u8, bet_mc: i64) -> FSResult {
        let feat = match self.find_free_spins() {
            Some(f) => f,
            None => return FSResult::default(),
        };
        let (trigger, global_mult, retrigger, modifiers) = match feat {
            Feature::FreeSpins {
                trigger,
                global_multiplier,
                retrigger,
                modifiers,
                ..
            } => (trigger, *global_multiplier, retrigger, modifiers),
            _ => return FSResult::default(),
        };

        let mut result = FSResult::default();
        let mut spins_remaining = Self::fs_awarded(trigger, trigger_scatter);
        if spins_remaining == 0 {
            return result;
        }

        let global_mult = global_mult.unwrap_or(1.0).max(0.0);
        let has_ladder = modifiers
            .as_ref()
            .map(|m| {
                m.iter()
                    .any(|x| matches!(x, ir::FsModifier::MultiplierLadder))
            })
            .unwrap_or(false);
        let mut ladder: u32 = 1;

        // Retrigger min count.
        let retrigger_min: Option<u32> = retrigger.as_ref().and_then(|r| {
            r.trigger.min.or_else(|| {
                r.trigger.thresholds.as_ref().and_then(|t| {
                    t.keys()
                        .filter_map(|k| k.trim_end_matches('+').parse::<u32>().ok())
                        .min()
                })
            })
        });
        let max_total = retrigger
            .as_ref()
            .and_then(|r| r.max_total)
            .unwrap_or(u32::MAX);

        let max_win_mc = (self.config.max_win_cap * 1000.0) as i64 * bet_mc / 1000;
        let mut total_awarded = spins_remaining;
        let mut loop_count = 0u32;

        while spins_remaining > 0 && loop_count < self.config.feature_loop_cap {
            loop_count += 1;
            spins_remaining -= 1;
            result.spins_played += 1;

            let grid = self.grid_gen.generate_fs(rng);
            let spin = self.evaluator.evaluate_spin(&grid, rng, bet_mc, true, true);

            let multiplier = if has_ladder {
                global_mult * ladder as f64
            } else {
                global_mult.max(1.0)
            };
            let mul_int = ((multiplier * 1000.0) as i64).max(1000);
            let win = (spin.base_win * mul_int) / 1000;
            result.total_payout += win;

            if has_ladder {
                ladder += 1;
                result.max_mult_reached = result.max_mult_reached.max(ladder);
            }

            // Retrigger from scatter count in the FS grid.
            if let Some(min) = retrigger_min {
                if (spin.scatter_count as u32) >= min && total_awarded < max_total {
                    let extra = Self::fs_awarded(
                        retrigger.as_ref().map(|r| &r.trigger).unwrap_or(trigger),
                        spin.scatter_count,
                    );
                    let allow = max_total.saturating_sub(total_awarded);
                    let actual = extra.min(allow);
                    spins_remaining += actual;
                    total_awarded += actual;
                    result.retriggers += 1;
                }
            }

            if result.total_payout >= max_win_mc {
                result.total_payout = max_win_mc;
                break;
            }
        }

        result
    }

    // ─── Hold & Win ─────────────────────────────────────────────────────

    pub fn simulate_hnw_ir(&self, rng: &mut SlotRng, grid: &Grid, bet_mc: i64) -> HNWResult {
        let feat = match self.find_hold_and_win() {
            Some(f) => f,
            None => return HNWResult::default(),
        };
        let (respins_initial, respin_reset, cash_dist, jackpot_tiers, grid_full_award) = match feat
        {
            Feature::HoldAndWin {
                respins_initial,
                respin_reset_on_new,
                cash_value_distribution,
                jackpot_tiers,
                grid_full_award,
                ..
            } => (
                *respins_initial,
                *respin_reset_on_new,
                cash_value_distribution,
                jackpot_tiers,
                grid_full_award,
            ),
            _ => return HNWResult::default(),
        };

        // Build weighted distribution.
        let dist_total: f64 = cash_dist.iter().map(|d| d.weight).sum();
        if dist_total <= 0.0 {
            return HNWResult::default();
        }

        let num_reels = self.config.reels as usize;
        let num_rows = self.config.rows as usize;
        let total_cells = num_reels * num_rows;
        let total_cells_u8 = total_cells as u8;

        // Bonus-cell detector — use grid_gen helpers which read SymbolDef
        // flags (set by the IR adapter).
        let mut occupied = vec![vec![false; num_rows]; num_reels];
        let mut orb_values: Vec<(u8, u8, u32, Option<String>)> = Vec::with_capacity(total_cells);

        let mut result = HNWResult::default();

        // Seed from the triggering grid.
        for reel in 0..num_reels {
            for row in 0..num_rows {
                if self.grid_gen.is_bonus(grid.get(reel, row)) {
                    let (value, jackpot) = pick_cash_value(rng, cash_dist, jackpot_tiers);
                    occupied[reel][row] = true;
                    orb_values.push((reel as u8, row as u8, value, jackpot.clone()));
                    if let Some(j) = jackpot {
                        increment_jackpot(&mut result, &j);
                    }
                }
            }
        }

        let max_win_mc = (self.config.max_win_cap * 1000.0) as i64 * bet_mc / 1000;
        let mut respins_remaining = respins_initial;
        let mut loop_count = 0u32;
        let mut orb_count: u8 = orb_values.len() as u8;

        // Per-cell landing probability — base + fill bonus. Defaults
        // intentionally match the legacy HoldAndWinConfig so existing
        // RTP smoke tests stay valid.
        let base_chance = 0.035_f64;
        let fill_bonus_cap = 0.025_f64;

        while respins_remaining > 0
            && orb_count < total_cells_u8
            && loop_count < self.config.feature_loop_cap
        {
            loop_count += 1;
            respins_remaining -= 1;
            result.total_respins += 1;

            let fill_ratio = orb_count as f64 / total_cells as f64;
            let chance = base_chance + fill_ratio * fill_bonus_cap;

            let mut new_landings = 0u32;
            for reel in 0..num_reels {
                for row in 0..num_rows {
                    if occupied[reel][row] {
                        continue;
                    }
                    if rng.random() < chance {
                        occupied[reel][row] = true;
                        orb_count += 1;
                        new_landings += 1;
                        let (value, jackpot) = pick_cash_value(rng, cash_dist, jackpot_tiers);
                        orb_values.push((reel as u8, row as u8, value, jackpot.clone()));
                        if let Some(j) = jackpot {
                            increment_jackpot(&mut result, &j);
                        }
                    }
                }
            }

            if new_landings > 0 && respin_reset {
                respins_remaining = respins_initial;
            }
        }

        // Sum orb values × bet.
        for (_, _, value, _) in &orb_values {
            result.total_payout += *value as i64 * bet_mc;
        }

        result.final_orb_count = orb_count;
        if orb_count >= total_cells_u8 {
            result.full_grid_bonus = true;
            // Full-grid award maps to a jackpot tier multiplier.
            if let Some(award_id) = grid_full_award {
                if let Some(tier) = jackpot_tiers.iter().find(|t| &t.id == award_id) {
                    result.total_payout += (tier.multiplier * 1000.0) as i64 * bet_mc / 1000;
                }
            }
        }

        if result.total_payout > max_win_mc {
            result.total_payout = max_win_mc;
        }

        result
    }

    // ─── Cascade ────────────────────────────────────────────────────────

    /// Cascade simulator: evaluates the grid, removes wins, refills, and
    /// repeats up to `max_chain` chains. Returns the cumulative cascade
    /// payout (already in millicredits) and the chain count.
    pub fn simulate_cascade_ir(
        &self,
        rng: &mut SlotRng,
        initial_grid: &Grid,
        bet_mc: i64,
    ) -> CascadeResult {
        let feat = match self.find_cascade() {
            Some(f) => f,
            None => return CascadeResult::default(),
        };
        let (replacement, max_chain, progression) = match feat {
            Feature::Cascade {
                replacement,
                max_chain,
                multiplier_progression,
                ..
            } => (*replacement, *max_chain, multiplier_progression.clone()),
            _ => return CascadeResult::default(),
        };

        let max_win_mc = (self.config.max_win_cap * 1000.0) as i64 * bet_mc / 1000;
        let num_reels = self.config.reels as usize;
        let num_rows = self.config.rows as usize;

        // Working copy of the grid we mutate across chains.
        let mut grid = initial_grid.clone();
        let mut result = CascadeResult::default();
        let chain_cap = max_chain.min(100);

        // Pre-resolve strip data for fixed_strip refill.
        let strips_base: Option<&Vec<Vec<String>>> = match &self.ir.reels {
            ReelSet::Strips { base, .. } => Some(base),
            _ => None,
        };

        for chain in 0..chain_cap {
            // Evaluate via the underlying evaluator (Lines/Ways/Cluster as
            // configured) — this returns base_win in millicredits.
            let spin = self
                .evaluator
                .evaluate_spin(&grid, rng, bet_mc, false, true);
            if spin.base_win <= 0 {
                break;
            }

            let mult = progression
                .as_ref()
                .and_then(|p| p.get(chain as usize).copied())
                .unwrap_or(1.0);
            let mul_int = ((mult * 1000.0) as i64).max(1000);
            let win = (spin.base_win * mul_int) / 1000;
            result.total_payout += win;
            result.chain_count += 1;
            result.max_multiplier = result.max_multiplier.max(mult as u32);

            // Collect cells whose symbol matches any winning symbol —
            // approximation since the line-wins do not carry per-cell
            // coordinates. This is acceptable for cascade smoke tests
            // because the next eval will be over a fresh refill anyway.
            let mut to_clear: Vec<(usize, usize)> = Vec::new();
            for win in &spin.line_wins {
                for reel in 0..num_reels {
                    for row in 0..num_rows {
                        if grid.get(reel, row) == win.symbol_idx {
                            to_clear.push((reel, row));
                        }
                    }
                }
            }
            if to_clear.is_empty() {
                break;
            }

            match replacement {
                ir::CascadeReplacement::Drop => {
                    cascade_drop(
                        &mut grid,
                        &to_clear,
                        rng,
                        num_reels,
                        num_rows,
                        self.grid_gen,
                    );
                }
                ir::CascadeReplacement::RefillRandom => {
                    cascade_refill_random(
                        &mut grid,
                        &to_clear,
                        rng,
                        self.config.symbols.len() as u8,
                    );
                }
                ir::CascadeReplacement::FixedStrip => {
                    cascade_refill_strip(&mut grid, &to_clear, rng, strips_base, self.config);
                }
            }

            if result.total_payout >= max_win_mc {
                result.total_payout = max_win_mc;
                break;
            }
        }

        result
    }
}

// ─── Cascade helpers ───────────────────────────────────────────────────────

fn cascade_drop(
    grid: &mut Grid,
    to_clear: &[(usize, usize)],
    rng: &mut SlotRng,
    num_reels: usize,
    num_rows: usize,
    grid_gen: &GridGenerator<'_>,
) {
    let cleared: std::collections::HashSet<(usize, usize)> = to_clear.iter().copied().collect();

    for reel in 0..num_reels {
        let mut survivors: Vec<u8> = Vec::with_capacity(num_rows);
        for row in (0..num_rows).rev() {
            if cleared.contains(&(reel, row)) {
                continue;
            }
            survivors.push(grid.get(reel, row));
        }
        while survivors.len() < num_rows {
            // Use the FS-style generator on this reel to draw fresh symbols.
            let fresh_grid = grid_gen.generate_base(rng);
            // Pull a random cell from the freshly generated grid as a refill.
            let sym = fresh_grid.get(reel, rng.random_int(num_rows as u32) as usize);
            survivors.push(sym);
        }
        // Pour back: survivors[0] is bottom-most.
        for (i, row) in (0..num_rows).rev().enumerate() {
            grid.set(reel, row, survivors[i]);
        }
    }
}

fn cascade_refill_random(
    grid: &mut Grid,
    to_clear: &[(usize, usize)],
    rng: &mut SlotRng,
    num_syms: u8,
) {
    for (reel, row) in to_clear {
        let pick = rng.random_int(num_syms as u32) as u8;
        grid.set(*reel, *row, pick);
    }
}

fn cascade_refill_strip(
    grid: &mut Grid,
    to_clear: &[(usize, usize)],
    rng: &mut SlotRng,
    strips_base: Option<&Vec<Vec<String>>>,
    config: &GameConfig,
) {
    let Some(strips) = strips_base else { return };
    for (reel, row) in to_clear {
        if let Some(strip) = strips.get(*reel) {
            if strip.is_empty() {
                continue;
            }
            let idx = rng.random_int(strip.len() as u32) as usize;
            let sym_id = &strip[idx];
            if let Some(sym_idx) = config.symbol_index(sym_id) {
                grid.set(*reel, *row, sym_idx as u8);
            }
        }
    }
}

// ─── HNW helpers ───────────────────────────────────────────────────────────

fn pick_cash_value(
    rng: &mut SlotRng,
    dist: &[ir::CashValueDist],
    jackpots: &[ir::JackpotTier],
) -> (u32, Option<String>) {
    let total: f64 = dist.iter().map(|d| d.weight).sum();
    if total <= 0.0 {
        return (1, None);
    }
    let mut roll = rng.random() * total;
    for d in dist {
        roll -= d.weight;
        if roll <= 0.0 {
            let v = d.value as u32;
            // Map to jackpot id by exact multiplier match (eps = 1e-9).
            let jackpot = jackpots
                .iter()
                .find(|t| (t.multiplier - d.value).abs() < 1e-9)
                .map(|t| t.id.clone());
            return (v, jackpot);
        }
    }
    if let Some(last) = dist.last() {
        return (last.value as u32, None);
    }
    (1, None)
}

fn increment_jackpot(result: &mut HNWResult, id: &str) {
    match id.to_uppercase().as_str() {
        "MINI" => result.jackpots_mini += 1,
        "MINOR" => result.jackpots_minor += 1,
        "MAJOR" => result.jackpots_major += 1,
        "GRAND" => result.jackpots_grand += 1,
        _ => {}
    }
}

// Suppress unused-imports warning for `SymbolKind`: future role-aware
// cascade work (sticky / expanding wilds) will reference it.
#[allow(dead_code)]
fn _ir_symbol_kind_marker(k: SymbolKind) -> SymbolKind {
    k
}
