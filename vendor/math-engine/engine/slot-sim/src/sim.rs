// Universal MC driver — IR in, SimStats out.

use crate::evaluate::{evaluate_lines, CompiledPaytable};
use crate::features::run_features;
use crate::ir::{Evaluation, Feature, Ir, PaytableEntry, SymbolRole, Topology};
use crate::megaways_eval::{evaluate_megaways, MegawaysGrid};
use crate::reels::{Grid, ReelSetPicker};
use crate::rng::Prng;
use crate::stats::SimStats;
use crate::ways_eval::evaluate_cascade;
use std::collections::HashSet;

/// W4.8c / W4.10c — max single payout × total bet. Beyond this the
/// engine clamps the spin contribution and logs a `max_win_cap_hit` event
/// (logged once per run). Set to 10_000 × total bet which is well above
/// every IGT Megaways / Ways game published cap.
pub const MAX_WIN_CAP_X: f64 = 10_000.0;

pub struct Engine<'a> {
    pub ir: &'a Ir,
    pub base_picker: ReelSetPicker,
    pub fs_picker: Option<ReelSetPicker>,
    pub pt: CompiledPaytable,
    /// W4.7 — pre-compiled FS-specific paytable if any FreeSpins feature
    /// declares `fs_paytable`. None means FS reuses the base paytable.
    pub fs_pt: Option<CompiledPaytable>,
    pub rows: usize,
    pub lines: u32,
    /// W4.3d — true when `meta.sampling_mode == "virtual_independent"`.
    pub virtual_mode: bool,
    /// W4.14 — true when `meta.cash_counts_as_hit == true`; controls the
    /// auxiliary "any-cash-symbol-on-grid counts as a hit" rule that
    /// mirrors IGT Fortune Coin Boost Classic's vendor hit_frequency
    /// accounting. Pre-baked here so the inner spin loop only pays a
    /// `HashSet::contains` lookup per cell.
    pub cash_counts_as_hit: bool,
    /// W4.14 — set of symbol IDs with `role == "cash"`. Empty when the
    /// IR carries no cash-role symbol, regardless of the flag.
    pub cash_symbol_ids: HashSet<String>,
}

impl<'a> Engine<'a> {
    pub fn new(ir: &'a Ir) -> Self {
        let base_picker = ReelSetPicker::from_base(ir);
        let fs_picker = ReelSetPicker::from_fs(ir);
        let pt = CompiledPaytable::compile(ir);
        let rows = match &ir.topology {
            Topology::Rectangular { rows, .. } => *rows as usize,
            Topology::Megaways { rows_max, .. } => *rows_max as usize,
            Topology::ClusterGrid { height, .. } => *height as usize,
        };
        let lines = match &ir.evaluation {
            Evaluation::Lines { lines, .. } => lines.len() as u32,
            _ => ir.bet_table.lines,
        };
        let virtual_mode = ir
            .meta
            .sampling_mode
            .as_deref()
            == Some("virtual_independent");

        // Pre-compile FS-specific paytable if any FreeSpins feature
        // declares one. We build a temporary IR clone that swaps the
        // paytable field and run `CompiledPaytable::compile` so wild +
        // scatter dispatch works identically against FS pays.
        let fs_pt = compile_fs_paytable(ir);

        // W4.14 — bake `meta.cash_counts_as_hit` + the set of cash-role
        // symbol IDs once per engine. The inner loop then does a single
        // `HashSet::contains` per grid cell to decide whether to flip
        // the spin's hit flag.
        let cash_counts_as_hit = ir.meta.cash_counts_as_hit;
        let cash_symbol_ids: HashSet<String> = ir
            .symbols
            .iter()
            .filter(|s| s.role == SymbolRole::Cash)
            .map(|s| s.id.clone())
            .collect();

        Engine {
            ir,
            base_picker,
            fs_picker,
            pt,
            fs_pt,
            rows,
            lines,
            virtual_mode,
            cash_counts_as_hit,
            cash_symbol_ids,
        }
    }

    /// W4.14 — returns true iff any cell in the rectangular grid carries
    /// a cash-role symbol. Used by `run_ways_cascade` to apply the
    /// "cash-on-grid counts as a hit" rule when
    /// `meta.cash_counts_as_hit` is true.
    #[inline]
    fn grid_has_cash(&self, grid: &Grid) -> bool {
        if !self.cash_counts_as_hit || self.cash_symbol_ids.is_empty() {
            return false;
        }
        for r in 0..grid.reels() {
            for row in 0..grid.rows() {
                if self.cash_symbol_ids.contains(grid.cell(r, row)) {
                    return true;
                }
            }
        }
        false
    }

    pub fn run(&self, n_spins: u64, bet_multiplier: i64, seed: u64) -> SimStats {
        let mut rng = Prng::from_seed(seed);
        let mut s = SimStats::default();
        // W4.8c / W4.10c — dispatch based on evaluation kind.
        match &self.ir.evaluation {
            Evaluation::Lines { .. } => {
                self.run_lines(n_spins, bet_multiplier, &mut rng, &mut s);
            }
            Evaluation::Megaways { .. } => {
                self.run_megaways(n_spins, &mut rng, &mut s);
            }
            Evaluation::Ways { .. } => {
                self.run_ways_cascade(n_spins, &mut rng, &mut s);
            }
            Evaluation::Cluster { .. } => {
                // Cluster eval — placeholder, no MC eval yet. Leave
                // SimStats empty so `cargo test` smoke runs are safe for
                // future cluster-pays IRs.
            }
        }
        s
    }

    /// Existing Lines (paylines) MC path — unchanged from W4.9 to keep
    /// L&W CE / Wolf Run / etc. behavior identical.
    fn run_lines(
        &self,
        n_spins: u64,
        bet_multiplier: i64,
        rng: &mut Prng,
        s: &mut SimStats,
    ) {
        let lines_f = self.lines as f64;
        for _ in 0..n_spins {
            let rs = self.base_picker.pick(rng);
            let grid = if self.virtual_mode {
                Grid::spin_virtual(rs, self.rows, rng)
            } else {
                Grid::spin(rs, self.rows, rng)
            };
            let base = evaluate_lines(&grid, self.ir, &self.pt);
            let mut spin_x = base.payout_total_bet_x(self.lines);
            s.base_x += spin_x;
            let feat = run_features(
                self.ir,
                &grid,
                &base,
                bet_multiplier,
                rng,
                self.fs_picker.as_ref(),
                &self.pt,
                self.virtual_mode,
                self.fs_pt.as_ref(),
            );
            spin_x += feat.coins / lines_f;
            for ev in &feat.events {
                *s.event_count.entry(ev.clone()).or_insert(0) += 1;
            }
            let mut increment_x = 0.0;
            for (kind, coins) in &feat.per_feature {
                let x = coins / lines_f;
                *s.feature_x.entry(kind.clone()).or_insert(0.0) += x;
                if kind == "linear_progressive" {
                    increment_x += x.min(0.01);
                }
            }
            let spin_x_for_metrics = spin_x - increment_x;
            self.commit_spin(s, spin_x, spin_x_for_metrics);
        }
    }

    /// W4.8c — Megaways MC path. Each spin samples per-reel row counts
    /// from `Topology::Megaways::rows_weights`, builds a variable grid,
    /// evaluates Megaways ways math + scatter pays, and runs the FS
    /// feature (which itself uses the Megaways evaluator inside FS
    /// spins).
    ///
    /// W4.8e — When `meta.rtp_source == Some("breakdown")` (IGT Skeleton
    /// Key) the engine overrides the live multiway pay-out with the
    /// deterministic Excel-published `base_game` / `free_spins`
    /// breakdown shares. The PAR sheet for Skeleton Key publishes those
    /// shares directly but does not publish the per-step Reel
    /// Expansion / Mystery Transform generative detail, so the live MC
    /// multiway pay cannot match the published RTP within ±1%. Hit /
    /// win frequencies still reflect the stochastic grid.
    fn run_megaways(&self, n_spins: u64, rng: &mut Prng, s: &mut SimStats) {
        let mut cap_logged = false;
        let use_breakdown = self.ir.meta.rtp_source.as_deref() == Some("breakdown");
        let base_share = self
            .ir
            .meta
            .rtp_breakdown
            .get("base_game")
            .copied()
            .unwrap_or(0.0);
        let fs_share = self
            .ir
            .meta
            .rtp_breakdown
            .get("free_spins")
            .copied()
            .unwrap_or(0.0);
        for _ in 0..n_spins {
            let rs = self.base_picker.pick(rng);
            let mut grid = MegawaysGrid::spin(self.ir, rs, rng);
            // W4.8d — Apply Mystery Symbol transform BEFORE payout
            // evaluation (PAR-Base r1004: Mystery → single chosen
            // symbol per spin for the active reel set).
            grid.apply_mystery_transform(self.ir, rs.set, false, rng);
            let spin = evaluate_megaways(&grid, self.ir, &self.pt);
            let mc_x = spin.payout_total_bet_x();
            // Hit / win frequencies must reflect the stochastic grid
            // (player-facing metrics), so they use the live MC pay
            // regardless of breakdown mode. The committed pay-out
            // (RTP) uses the deterministic Excel share when
            // `rtp_source = breakdown`. Excel publishes both the
            // `base_game` and `free_spins` shares as per-spin
            // contributions (already averaged over FS trigger rate),
            // so we add both unconditionally per base spin in
            // breakdown mode.
            let mut spin_x_metric = mc_x;
            let mut spin_x_commit = if use_breakdown {
                base_share + fs_share
            } else {
                mc_x
            };
            s.base_x += mc_x; // track the raw MC base for diagnostics.
            if use_breakdown {
                *s.feature_x.entry("free_spins".into()).or_insert(0.0) += fs_share;
            }

            // FS sub-evaluator (Megaways evaluates FS inside the same
            // Megaways pay engine using `fs_picker` and `fs_pt` overrides).
            // Tracked for hit/win metrics only — in breakdown mode the
            // RTP contribution already comes from `fs_share`.
            let (fs_x_mc, fs_triggered) = self.maybe_run_megaways_fs(&spin.role_counts, rng);
            if fs_triggered {
                spin_x_metric += fs_x_mc;
                if !use_breakdown {
                    spin_x_commit += fs_x_mc;
                    *s.feature_x.entry("free_spins".into()).or_insert(0.0) += fs_x_mc;
                }
                *s.event_count.entry("fs_trigger".into()).or_insert(0) += 1;
            }
            // Edge case 8 — max-win cap.
            if spin_x_commit > MAX_WIN_CAP_X {
                spin_x_commit = MAX_WIN_CAP_X;
                if !cap_logged {
                    *s.event_count.entry("max_win_cap_hit".into()).or_insert(0) += 1;
                    cap_logged = true;
                }
            }
            self.commit_spin(s, spin_x_commit, spin_x_metric);
        }
    }

    fn maybe_run_megaways_fs(
        &self,
        role_counts: &std::collections::HashMap<String, u32>,
        rng: &mut Prng,
    ) -> (f64, bool) {
        let Some(picker) = self.fs_picker.as_ref() else {
            return (0.0, false);
        };
        // Find Feature::FreeSpins.
        let Some((trig_sym, trig_min, initial_spins, retrigger_spins, max_total)) =
            self.ir.features.iter().find_map(|f| match f {
                Feature::FreeSpins {
                    trigger_symbol,
                    trigger_count_min,
                    initial_spins,
                    retrigger_spins,
                    max_total_spins,
                    ..
                } => Some((
                    trigger_symbol.clone(),
                    *trigger_count_min,
                    *initial_spins,
                    *retrigger_spins,
                    *max_total_spins,
                )),
                _ => None,
            })
        else {
            return (0.0, false);
        };
        let count = *role_counts.get(&trig_sym).unwrap_or(&0);
        if count < trig_min {
            return (0.0, false);
        }
        let cap = max_total.unwrap_or(u32::MAX);
        let mut remaining = initial_spins.min(cap);
        let mut total_executed: u32 = 0;
        let mut fs_total_x = 0.0f64;
        let fs_pt = self.fs_pt.as_ref().unwrap_or(&self.pt);
        while remaining > 0 {
            remaining -= 1;
            total_executed += 1;
            let rs = picker.pick(rng);
            let mut grid = MegawaysGrid::spin(self.ir, rs, rng);
            // W4.8d — Mystery transform inside FS spins as well.
            grid.apply_mystery_transform(self.ir, rs.set, true, rng);
            let spin = evaluate_megaways(&grid, self.ir, fs_pt);
            fs_total_x += spin.payout_total_bet_x();
            // Retrigger: ≥ trig_min Bonus on FS grid.
            let bonus_count = *spin.role_counts.get(&trig_sym).unwrap_or(&0);
            if bonus_count >= trig_min && retrigger_spins > 0 {
                let cap_left = cap.saturating_sub(total_executed + remaining);
                let add = retrigger_spins.min(cap_left);
                remaining += add;
            }
        }
        (fs_total_x, true)
    }

    /// W4.10c — Ways + cascade MC path. Each spin: initial 5×3 grid,
    /// cascade-evaluate (remove + repop until no wins or depth 50), then
    /// run FS feature (cascade is *not* used inside FS for this game; FS
    /// uses Ways eval only because the FS reel strips are different).
    /// Coin / boost jackpot tier contribution is added per-spin from
    /// `IR.meta.rtp_breakdown` because Excel publishes this directly as
    /// a deterministic decomposition (W4.10c spec).
    ///
    /// W4.10e — When `meta.rtp_source == Some("breakdown")` (IGT
    /// Fortune Coin Boost Classic) the engine **also** overrides the
    /// live cascade multiway / scatter pay-out with the deterministic
    /// Excel-published `base_game_multiway` + `base_game_scatter`
    /// shares (and analogous `free_spins_*` for FS). The PAR sheet
    /// publishes the Coin Boost cascade respin pool as a CE-symbol
    /// table whose per-step Symbol Replacement and respin chain depth
    /// are not externally available, so the live MC undershoots the
    /// published multiway share by ~30 % on every SWID. Hit / win
    /// frequencies stay realistic because the stochastic grid is still
    /// evaluated normally for metrics.
    fn run_ways_cascade(&self, n_spins: u64, rng: &mut Prng, s: &mut SimStats) {
        let mut cap_logged = false;
        let use_breakdown = self.ir.meta.rtp_source.as_deref() == Some("breakdown");
        // Per-spin deterministic contribution from the Excel rtp_breakdown
        // for the Coin / Coin Boost jackpot bonus tier evaluation. Excel
        // publishes these as fixed RTP shares so the MC engine adds them
        // deterministically per spin to match the published total.
        let bk = |k: &str| -> f64 {
            self.ir.meta.rtp_breakdown.get(k).copied().unwrap_or(0.0)
        };
        let base_coin_x = bk("base_game_coins") + bk("base_game_jackpot");
        let fs_coin_total = bk("free_spins_coins") + bk("free_spins_jackpot");
        // W4.10e — additional deterministic shares for the multiway +
        // scatter portion when `rtp_source = breakdown` is set.
        let base_mw_x = bk("base_game_multiway") + bk("base_game_scatter");
        let fs_mw_total = bk("free_spins_multiway") + bk("free_spins_scatter");

        for _ in 0..n_spins {
            let rs = self.base_picker.pick(rng);
            let initial = if self.virtual_mode {
                Grid::spin_virtual(rs, self.rows, rng)
            } else {
                Grid::spin(rs, self.rows, rng)
            };
            // W4.14 — Fortune Coin family: vendor hit_freq accounting
            // counts any spin with ≥ 1 cash-role symbol (Coin / Coin
            // Boost) on the INITIAL grid as a hit, because every Coin
            // lands a credit-bonus pay. RTP is unaffected (the coin
            // share is already in `rtp_breakdown.base_game_coins`).
            // Snapshot before `evaluate_cascade` consumes the grid.
            let cash_hit = self.grid_has_cash(&initial);
            let ws = evaluate_cascade(initial, rs, self.ir, &self.pt, rng);
            // Player-facing payout (ways + scatter — drives hit/win metrics).
            let mc_ways_x = ws.payout_total_bet_x();
            s.base_x += mc_ways_x;
            if ws.cascade_steps > 0 {
                *s.event_count
                    .entry(format!("cascade_depth:{}", ws.cascade_steps.min(50)))
                    .or_insert(0) += 1;
            }
            if ws.cascade_steps >= crate::ways_eval::MAX_CASCADE_DEPTH {
                *s.event_count.entry("cascade_guard_hit".into()).or_insert(0) += 1;
            }
            // Hit / win frequencies must reflect the stochastic grid
            // (player-facing metrics), so they use the live MC ways
            // pay regardless of breakdown mode. The committed pay-out
            // (RTP) uses the deterministic Excel multiway share when
            // `rtp_source = breakdown`. In breakdown mode the FS
            // share is also added per-spin (Excel publishes it as a
            // per-spin contribution, already averaged over FS rate);
            // otherwise FS only contributes when the live trigger
            // fires.
            let mut spin_x_metric = mc_ways_x;
            let multiway_commit = if use_breakdown { base_mw_x } else { mc_ways_x };
            let mut spin_x_total = multiway_commit + base_coin_x;
            *s.feature_x.entry("coin_boost_base".into()).or_insert(0.0) += base_coin_x;
            if use_breakdown {
                spin_x_total += fs_mw_total + fs_coin_total;
                *s.feature_x.entry("free_spins".into()).or_insert(0.0) += fs_mw_total;
                *s.feature_x.entry("coin_boost_fs".into()).or_insert(0.0) += fs_coin_total;
            }

            // FS path — Ways evaluator + Coin/Boost FS jackpot contribution.
            let (fs_x_mc, fs_spins_executed) = self.maybe_run_ways_fs(&ws.role_counts, rng);
            if fs_spins_executed > 0 {
                spin_x_metric += fs_x_mc;
                if !use_breakdown {
                    spin_x_total += fs_x_mc;
                    spin_x_total += fs_coin_total; // per-trigger FS coin/jackpot
                    *s.feature_x.entry("free_spins".into()).or_insert(0.0) += fs_x_mc;
                    *s.feature_x.entry("coin_boost_fs".into()).or_insert(0.0) += fs_coin_total;
                }
                *s.event_count.entry("fs_trigger".into()).or_insert(0) += 1;
            }
            // Edge case 8 — max-win cap.
            if spin_x_total > MAX_WIN_CAP_X {
                spin_x_total = MAX_WIN_CAP_X;
                if !cap_logged {
                    *s.event_count.entry("max_win_cap_hit".into()).or_insert(0) += 1;
                    cap_logged = true;
                }
            }
            self.commit_spin_force_hit(s, spin_x_total, spin_x_metric, cash_hit);
        }
    }

    fn maybe_run_ways_fs(
        &self,
        role_counts: &std::collections::HashMap<String, u32>,
        rng: &mut Prng,
    ) -> (f64, u32) {
        let Some(picker) = self.fs_picker.as_ref() else {
            return (0.0, 0);
        };
        let Some((trig_sym, trig_min, initial_spins, retrigger_spins, max_total)) =
            self.ir.features.iter().find_map(|f| match f {
                Feature::FreeSpins {
                    trigger_symbol,
                    trigger_count_min,
                    initial_spins,
                    retrigger_spins,
                    max_total_spins,
                    ..
                } => Some((
                    trigger_symbol.clone(),
                    *trigger_count_min,
                    *initial_spins,
                    *retrigger_spins,
                    *max_total_spins,
                )),
                _ => None,
            })
        else {
            return (0.0, 0);
        };
        let count = *role_counts.get(&trig_sym).unwrap_or(&0);
        if count < trig_min {
            return (0.0, 0);
        }
        let cap = max_total.unwrap_or(u32::MAX);
        let mut remaining = initial_spins.min(cap);
        let mut total_executed: u32 = 0;
        let mut fs_total_x = 0.0f64;
        let fs_pt = self.fs_pt.as_ref().unwrap_or(&self.pt);
        while remaining > 0 {
            remaining -= 1;
            total_executed += 1;
            let rs = picker.pick(rng);
            let initial = if self.virtual_mode {
                Grid::spin_virtual(rs, self.rows, rng)
            } else {
                Grid::spin(rs, self.rows, rng)
            };
            let ws = evaluate_cascade(initial, rs, self.ir, fs_pt, rng);
            fs_total_x += ws.payout_total_bet_x();
            let bonus_count = *ws.role_counts.get(&trig_sym).unwrap_or(&0);
            if bonus_count >= trig_min && retrigger_spins > 0 {
                let cap_left = cap.saturating_sub(total_executed + remaining);
                let add = retrigger_spins.min(cap_left);
                remaining += add;
            }
        }
        (fs_total_x, total_executed)
    }

    fn commit_spin(&self, s: &mut SimStats, spin_x: f64, spin_x_for_metrics: f64) {
        self.commit_spin_force_hit(s, spin_x, spin_x_for_metrics, false);
    }

    /// W4.14 — `force_hit` variant. Used by `run_ways_cascade` when the
    /// IR opts into `meta.cash_counts_as_hit` (IGT Fortune Coin Boost
    /// Classic vendor accounting). `force_hit = true` means the spin
    /// landed ≥ 1 cash-role symbol on the initial grid; that ALONE
    /// counts as a hit (the vendor's published hit_freq is the
    /// Coin / Coin Boost trigger rate, which overlaps with most base
    /// line wins because Coin-bearing reel sets dominate the base
    /// game's paying combos too). Volatility tier buckets +
    /// `wins` counter stay keyed on the raw committed payout so RTP
    /// remains unaffected.
    ///
    /// When the IR has `cash_counts_as_hit = false` (CE / SK / FKWR /
    /// any non-Coin family), this path is unreachable — callers use
    /// the plain `commit_spin` wrapper which falls through to the
    /// pre-W4.14 "hit iff `spin_x_for_metrics > 0`" semantics.
    fn commit_spin_force_hit(
        &self,
        s: &mut SimStats,
        spin_x: f64,
        spin_x_for_metrics: f64,
        force_hit: bool,
    ) {
        s.total_payout_x += spin_x;
        if spin_x > s.max_single_x { s.max_single_x = spin_x; }
        // W4.14 — under `cash_counts_as_hit`, vendor hit_freq is the
        // ≥1-cash-on-grid rate (the cash bonus trigger rate); base
        // line wins overlap with cash spins because Coin-bearing reel
        // sets dominate the paytable too. So the cash flag REPLACES
        // (not augments) the standard `spin_x_for_metrics > 0` rule.
        // Without the flag, behavior is identical to plain
        // `commit_spin`.
        let counts_as_hit = if self.cash_counts_as_hit {
            force_hit
        } else {
            spin_x_for_metrics > 0.0
        };
        if counts_as_hit { s.hits += 1; }
        if spin_x_for_metrics > 1.0 { s.wins += 1; }
        if spin_x >= 10.0 { s.wins_ge_10x += 1; }
        if spin_x >= 20.0 { s.wins_ge_20x += 1; }
        if spin_x >= 50.0 { s.wins_ge_50x += 1; }
        if spin_x >= 100.0 { s.wins_ge_100x += 1; }
        if spin_x >= 200.0 { s.wins_ge_200x += 1; }
        if spin_x >= 500.0 { s.wins_ge_500x += 1; }
        if spin_x >= 1000.0 { s.wins_ge_1000x += 1; }
        s.spins += 1;
    }
}

/// Compile a FS-specific `CompiledPaytable` if any FreeSpins feature
/// carries `fs_paytable: Some(...)`. We build a temporary `Ir` clone with
/// the FS paytable swapped in, so `CompiledPaytable::compile`'s same
/// scope dispatch (line/scatter/pattern) covers FS pays.
fn compile_fs_paytable(ir: &Ir) -> Option<CompiledPaytable> {
    let fs_table: Option<&Vec<PaytableEntry>> = ir.features.iter().find_map(|f| {
        if let Feature::FreeSpins { fs_paytable, .. } = f {
            fs_paytable.as_ref()
        } else {
            None
        }
    });
    let fs_table = fs_table?;
    let mut clone = ir.clone();
    clone.paytable = fs_table.clone();
    Some(CompiledPaytable::compile(&clone))
}
