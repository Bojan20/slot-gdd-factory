//! Analytical (Exact) RTP Solver
//!
//! Computes EXACT RTP via exhaustive enumeration — no Monte Carlo, no variance.
//! Result is deterministic: identical regardless of "spin count".
//!
//! Method: For each payline, enumerate all N^5 symbol combinations and sum
//! prob × payout. For N≈10 symbols and 10 paylines → ~1M ops, sub-millisecond.
//!
//! Trigger probabilities (scatter, bonus) use DP over 15 independent cells.
//!
//! Limitations of current pass:
//!   - FS and H&W secondary RTP require Markov chain (Phase 6); this pass
//!     computes FS base contribution (single FS sequence, no retriggers) exactly
//!     and flags H&W as "needs Markov solver".
//!   - Hit-rate across paylines is approximate (assumes payline independence).

use crate::config::GameConfig;

// ─────────────────────────────────────────────────────────────────────────────
// Public result types
// ─────────────────────────────────────────────────────────────────────────────

/// Per-payline analytical breakdown
#[derive(Debug, Clone)]
pub struct PaylineAnalytics {
    pub payline_id: u8,
    /// E[payout per unit bet] contributed by this payline alone
    pub rtp_contribution: f64,
    /// P(this payline wins on any given spin)
    pub hit_rate: f64,
}

/// Symbol global appearance statistics
#[derive(Debug, Clone)]
pub struct SymbolStats {
    pub symbol_id: String,
    /// P(symbol appears at least once in the full grid)
    pub grid_hit_rate: f64,
    /// P(symbol appears on reel 0 row 0) — same for any cell of that reel
    pub reel_probs: Vec<f64>,
}

/// Full analytical result — exact, zero-variance
#[derive(Debug)]
pub struct AnalyticalResult {
    // ── Base game (exact) ────────────────────────────────────────────────────
    /// Pure payline RTP (before lightning)
    pub payline_rtp: f64,
    /// E[extra win from lightning multiplier per spin]
    pub lightning_rtp: f64,
    /// payline_rtp + lightning_rtp
    pub base_game_rtp: f64,
    /// P(any payline wins on a base-game spin) [approx — paylines share reels]
    pub base_hit_rate: f64,

    // ── Trigger probabilities (exact via DP) ─────────────────────────────────
    /// P(exactly k scatter symbols land), k = 0..=15
    pub scatter_dist: [f64; 16],
    /// P(exactly k bonus symbols land), k = 0..=15
    pub bonus_dist: [f64; 16],
    /// P(FS triggered) = P(scatter ≥ 3) × P(bonus < trigger_count)
    pub fs_trigger_prob: f64,
    /// P(H&W triggered) = P(bonus ≥ trigger_count)
    pub hnw_trigger_prob: f64,

    // ── Free-spins contribution (partial — no retrigger chain) ───────────────
    /// E[FS payout per unit bet] for a single FS sequence (avg spins, no retrigs)
    pub fs_base_rtp_per_trigger: f64,
    /// fs_trigger_prob × fs_base_rtp_per_trigger
    pub fs_total_rtp: f64,

    // ── Combined total (base + FS base; H&W TBD) ─────────────────────────────
    pub total_rtp_partial: f64,

    // ── Breakdown vectors ─────────────────────────────────────────────────────
    pub paylines: Vec<PaylineAnalytics>,
    pub symbols: Vec<SymbolStats>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Solver
// ─────────────────────────────────────────────────────────────────────────────

pub struct AnalyticalSolver<'a> {
    config: &'a GameConfig,

    /// Marginal symbol probabilities per reel — base game.
    /// base_probs[reel][sym_idx] = P(that symbol drawn on any row of that reel)
    base_probs: Vec<Vec<f64>>,

    /// Same for free-spins reel weights
    fs_probs: Vec<Vec<f64>>,

    scatter_idx: Option<usize>,
    bonus_idx: Option<usize>,
    wild_idx: Option<usize>,
    num_syms: usize,

    /// paytable[sym_idx][count-3] = payout multiplier (× total_bet)
    paytable: Vec<[f64; 3]>,

    lightning_trigger: f64,
    lightning_trigger_fs: f64,
    /// E[multiplier | lightning triggers]
    expected_multiplier: f64,

    hnw_trigger_count: usize,
}

impl<'a> AnalyticalSolver<'a> {
    // ─────────────────────────────────────────────────────────────────────────
    // Construction
    // ─────────────────────────────────────────────────────────────────────────

    pub fn new(config: &'a GameConfig) -> Self {
        let num_syms = config.symbols.len();
        let num_reels = config.reels as usize;

        let mut base_probs = vec![vec![0.0f64; num_syms]; num_reels];
        let mut fs_probs = vec![vec![0.0f64; num_syms]; num_reels];

        for reel in 0..num_reels {
            // ── base game ──
            let base_total: u32 = config
                .base_weights
                .get(reel)
                .map(|w| w.iter().map(|e| e.weight).sum())
                .unwrap_or(0);
            if base_total > 0 {
                if let Some(weights) = config.base_weights.get(reel) {
                    for entry in weights {
                        if let Some(idx) = config.symbol_index(&entry.symbol) {
                            base_probs[reel][idx] += entry.weight as f64 / base_total as f64;
                        }
                    }
                }
            }

            // ── free spins ──
            let fs_total: u32 = config
                .fs_weights
                .get(reel)
                .map(|w| w.iter().map(|e| e.weight).sum())
                .unwrap_or(0);
            if fs_total > 0 {
                if let Some(weights) = config.fs_weights.get(reel) {
                    for entry in weights {
                        if let Some(idx) = config.symbol_index(&entry.symbol) {
                            fs_probs[reel][idx] += entry.weight as f64 / fs_total as f64;
                        }
                    }
                }
            }
        }

        let scatter_idx = config.symbols.iter().position(|s| s.is_scatter);
        let bonus_idx = config.symbols.iter().position(|s| s.is_bonus);
        let wild_idx = config.symbols.iter().position(|s| s.is_wild);

        // ── paytable lookup ──
        let mut paytable = vec![[0.0f64; 3]; num_syms];
        for (sym_id, pay) in &config.paytable {
            if let Some(idx) = config.symbol_index(sym_id) {
                paytable[idx][0] = pay.pay3;
                paytable[idx][1] = pay.pay4;
                paytable[idx][2] = pay.pay5;
            }
        }

        // ── lightning ──
        let lightning_trigger = config.lightning.trigger_chance;
        let lightning_trigger_fs = config.lightning.trigger_chance_fs;
        let mult_total: u32 = config.lightning.multipliers.iter().map(|m| m.weight).sum();
        let expected_multiplier = if mult_total > 0 {
            config
                .lightning
                .multipliers
                .iter()
                .map(|m| m.value as f64 * m.weight as f64 / mult_total as f64)
                .sum()
        } else {
            1.0
        };

        let hnw_trigger_count = config.hold_and_win.trigger_count as usize;

        AnalyticalSolver {
            config,
            base_probs,
            fs_probs,
            scatter_idx,
            bonus_idx,
            wild_idx,
            num_syms,
            paytable,
            lightning_trigger,
            lightning_trigger_fs,
            expected_multiplier,
            hnw_trigger_count,
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    #[inline]
    fn blocks_line(&self, idx: usize) -> bool {
        Some(idx) == self.scatter_idx || Some(idx) == self.bonus_idx
    }

    #[inline]
    fn is_wild(&self, idx: usize) -> bool {
        Some(idx) == self.wild_idx
    }

    #[inline]
    fn get_payout(&self, sym: usize, count: usize) -> f64 {
        if count < 3 || count > 5 {
            return 0.0;
        }
        self.paytable[sym][count - 3]
    }

    /// Mirror of Evaluator::evaluate_payline — exact same logic, pure function.
    fn eval_payline_sequence(&self, syms: &[usize; 5]) -> f64 {
        if self.blocks_line(syms[0]) {
            return 0.0;
        }

        let mut chain_len = 0usize;
        for &s in syms.iter() {
            if self.blocks_line(s) {
                break;
            }
            chain_len += 1;
        }
        if chain_len < 3 {
            return 0.0;
        }

        let mut best = 0.0f64;

        // ── non-wild paying symbol ──
        let mut first_paying: Option<usize> = None;
        for i in 0..chain_len {
            let s = syms[i];
            if !self.is_wild(s) && self.get_payout(s, 3) > 0.0 {
                first_paying = Some(s);
                break;
            }
        }
        if let Some(target) = first_paying {
            let mut count = 0;
            for i in 0..chain_len {
                if syms[i] == target || self.is_wild(syms[i]) {
                    count += 1;
                } else {
                    break;
                }
            }
            if count >= 3 {
                let p = self.get_payout(target, count);
                if p > best {
                    best = p;
                }
            }
        }

        // ── wild-only win ──
        if let Some(wild) = self.wild_idx {
            let mut count = 0;
            for i in 0..chain_len {
                if self.is_wild(syms[i]) {
                    count += 1;
                } else {
                    break;
                }
            }
            if count >= 3 {
                let p = self.get_payout(wild, count);
                if p > best {
                    best = p;
                }
            }
        }

        best
    }

    /// Exhaustive N^5 enumeration for one payline.
    /// Returns (rtp_contribution, hit_rate).
    ///
    /// Note: In this engine, rows within a reel are independent draws with
    /// the same weight table → P(symbol at reel r) is row-independent.
    /// Therefore payline row indices don't affect probabilities here.
    fn compute_payline_exact(&self, probs: &[Vec<f64>]) -> (f64, f64) {
        let n = self.num_syms;
        let mut rtp = 0.0f64;
        let mut hr = 0.0f64;

        for s0 in 0..n {
            let p0 = probs[0][s0];
            if p0 == 0.0 {
                continue;
            }
            for s1 in 0..n {
                let p1 = probs[1][s1];
                if p1 == 0.0 {
                    continue;
                }
                let p01 = p0 * p1;
                for s2 in 0..n {
                    let p2 = probs[2][s2];
                    if p2 == 0.0 {
                        continue;
                    }
                    let p012 = p01 * p2;
                    for s3 in 0..n {
                        let p3 = probs[3][s3];
                        if p3 == 0.0 {
                            continue;
                        }
                        let p0123 = p012 * p3;
                        for s4 in 0..n {
                            let p4 = probs[4][s4];
                            if p4 == 0.0 {
                                continue;
                            }
                            let prob = p0123 * p4;
                            let syms = [s0, s1, s2, s3, s4];
                            let pay = self.eval_payline_sequence(&syms);
                            rtp += prob * pay;
                            if pay > 0.0 {
                                hr += prob;
                            }
                        }
                    }
                }
            }
        }

        (rtp, hr)
    }

    /// DP over all grid cells to compute P(exactly k of given symbol).
    /// Cells: reels × rows — each independent with prob = probs[reel][sym_idx].
    fn symbol_count_dist(&self, probs: &[Vec<f64>], sym_idx: usize, rows: usize) -> [f64; 16] {
        let num_reels = probs.len();
        let mut dp = [0.0f64; 16];
        dp[0] = 1.0;
        let mut max_seen = 0usize;

        for reel in 0..num_reels {
            for _row in 0..rows {
                let p = probs[reel][sym_idx];
                // Iterate backwards to avoid double-counting
                for k in (0..=max_seen).rev() {
                    if dp[k] == 0.0 {
                        continue;
                    }
                    dp[k + 1] += dp[k] * p;
                    dp[k] *= 1.0 - p;
                }
                max_seen += 1;
            }
        }

        dp
    }

    /// P(symbol appears at least once in any cell of the grid)
    fn symbol_grid_hit_rate(&self, probs: &[Vec<f64>], sym_idx: usize, rows: usize) -> f64 {
        let p_absent: f64 = probs
            .iter()
            .map(|reel_p| (1.0 - reel_p[sym_idx]).powi(rows as i32))
            .product();
        1.0 - p_absent
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────────────

    /// Compute exact analytical result.
    /// No Monte Carlo — deterministic, zero-variance.
    pub fn solve(&self) -> AnalyticalResult {
        let rows = self.config.rows as usize;
        let probs = &self.base_probs;
        let fs_probs = &self.fs_probs;

        // ── 1. Paylines ──────────────────────────────────────────────────────
        let mut payline_rtp = 0.0f64;
        let mut base_hr_approx = 0.0f64; // P(no win on any line) product approx
        let mut p_no_win = 1.0f64;
        let mut paylines_out = Vec::new();

        for (i, _payline) in self.config.paylines.iter().enumerate() {
            let (rtp, hr) = self.compute_payline_exact(probs);
            payline_rtp += rtp;
            p_no_win *= 1.0 - hr; // independence approx
            paylines_out.push(PaylineAnalytics {
                payline_id: i as u8 + 1,
                rtp_contribution: rtp,
                hit_rate: hr,
            });
        }
        base_hr_approx = 1.0 - p_no_win;

        // ── 2. Lightning boost ───────────────────────────────────────────────
        // E[final_win] = E[base_win] × (1 + p_trigger × (E[mult] – 1))
        let lightning_boost = self.lightning_trigger * (self.expected_multiplier - 1.0);
        let lightning_rtp = payline_rtp * lightning_boost;
        let base_game_rtp = payline_rtp + lightning_rtp;

        // ── 3. Trigger distributions (DP) ────────────────────────────────────
        let scatter_dist = match self.scatter_idx {
            Some(i) => self.symbol_count_dist(probs, i, rows),
            None => {
                let mut d = [0.0; 16];
                d[0] = 1.0;
                d
            }
        };
        let bonus_dist = match self.bonus_idx {
            Some(i) => self.symbol_count_dist(probs, i, rows),
            None => {
                let mut d = [0.0; 16];
                d[0] = 1.0;
                d
            }
        };

        let hnw_trigger_prob: f64 = bonus_dist[self.hnw_trigger_count..].iter().sum();
        // FS: scatter ≥ 3  AND  bonus < trigger (H&W not active)
        // Scatter and bonus are independent → joint = product
        let p_scatter_gte3: f64 = scatter_dist[3..].iter().sum();
        let p_no_hnw = 1.0 - hnw_trigger_prob;
        let fs_trigger_prob = p_scatter_gte3 * p_no_hnw;

        // ── 4. FS base contribution ───────────────────────────────────────────
        // Compute payline RTP per FS spin (on FS reels, with FS lightning chance)
        let (fs_payline_rtp_per_spin, _) = self.compute_payline_exact(fs_probs);
        let fs_lightning_boost = self.lightning_trigger_fs * (self.expected_multiplier - 1.0);
        let fs_rtp_per_spin = fs_payline_rtp_per_spin * (1.0 + fs_lightning_boost);

        // Average spins awarded (weighted by scatter count probability)
        let fs_avg_spins = {
            let mut total_prob = 0.0f64;
            let mut weighted = 0.0f64;
            for k in 3usize..=15 {
                let p = scatter_dist[k];
                if p == 0.0 {
                    continue;
                }
                let spins = *self.config.free_spins.awards.get(&(k as u8)).unwrap_or(&10) as f64;
                weighted += p * spins;
                total_prob += p;
            }
            if total_prob > 0.0 {
                weighted / total_prob
            } else {
                10.0
            }
        };

        let fs_base_rtp_per_trigger = fs_rtp_per_spin * fs_avg_spins;
        let fs_total_rtp = fs_trigger_prob * fs_base_rtp_per_trigger;

        let total_rtp_partial = base_game_rtp + fs_total_rtp;

        // ── 5. Symbol stats ───────────────────────────────────────────────────
        let symbols_out: Vec<SymbolStats> = self
            .config
            .symbols
            .iter()
            .enumerate()
            .map(|(idx, sym)| {
                let grid_hr = self.symbol_grid_hit_rate(probs, idx, rows);
                let reel_probs = probs.iter().map(|r| r[idx]).collect();
                SymbolStats {
                    symbol_id: sym.id.clone(),
                    grid_hit_rate: grid_hr,
                    reel_probs,
                }
            })
            .collect();

        AnalyticalResult {
            payline_rtp,
            lightning_rtp,
            base_game_rtp,
            base_hit_rate: base_hr_approx,
            scatter_dist,
            bonus_dist,
            fs_trigger_prob,
            hnw_trigger_prob,
            fs_base_rtp_per_trigger,
            fs_total_rtp,
            total_rtp_partial,
            paylines: paylines_out,
            symbols: symbols_out,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pretty printer
// ─────────────────────────────────────────────────────────────────────────────

pub fn print_analytical_report(result: &AnalyticalResult, target_rtp: f64) {
    println!("\n╔══════════════════════════════════════════════════════════════╗");
    println!("║          ANALYTICAL (EXACT) RTP SOLVER — ZERO VARIANCE      ║");
    println!("╚══════════════════════════════════════════════════════════════╝");
    println!("\n  NOTE: These values are mathematically exact.");
    println!("  They will be IDENTICAL whether you run 1000 or 10,000,000,000 spins.\n");

    println!("──────────────────────── BASE GAME ─────────────────────────────");
    println!(
        "  Payline RTP          : {:.6}%",
        result.payline_rtp * 100.0
    );
    println!(
        "  Lightning boost RTP  : {:.6}%",
        result.lightning_rtp * 100.0
    );
    println!(
        "  Base game RTP        : {:.6}%",
        result.base_game_rtp * 100.0
    );
    println!(
        "  Hit rate (approx)    : {:.4}%  ({:.1} in 100 spins win)",
        result.base_hit_rate * 100.0,
        result.base_hit_rate * 100.0
    );

    println!("\n─────────────────────── TRIGGER PROBS ──────────────────────────");
    let p_scatter_ge3: f64 = result.scatter_dist[3..].iter().sum();
    println!(
        "  P(scatter ≥ 3)       : 1 in {:.1}   ({:.6}%)",
        1.0 / p_scatter_ge3.max(1e-12),
        p_scatter_ge3 * 100.0
    );
    println!(
        "  P(FS triggered)      : 1 in {:.1}   ({:.6}%)",
        1.0 / result.fs_trigger_prob.max(1e-12),
        result.fs_trigger_prob * 100.0
    );
    println!(
        "  P(H&W triggered)     : 1 in {:.1}   ({:.6}%)",
        1.0 / result.hnw_trigger_prob.max(1e-12),
        result.hnw_trigger_prob * 100.0
    );

    println!("\n────────────────────── SCATTER DIST ────────────────────────────");
    for k in 0..=6usize {
        if result.scatter_dist[k] > 1e-12 {
            println!(
                "  P({} scatter{})  : {:.6}%",
                k,
                if k == 1 { " " } else { "s" },
                result.scatter_dist[k] * 100.0
            );
        }
    }

    println!("\n──────────────────── FREE SPINS RTP ─────────────────────────────");
    println!(
        "  FS RTP / trigger     : {:.6}×  ({:.6}%)",
        result.fs_base_rtp_per_trigger,
        result.fs_base_rtp_per_trigger * 100.0
    );
    println!(
        "  FS total RTP contrib : {:.6}%",
        result.fs_total_rtp * 100.0
    );

    println!("\n─────────────────────── PER PAYLINE ────────────────────────────");
    for pl in &result.paylines {
        println!(
            "  PL {:2} │ RTP {:.5}%  │ hit 1 in {:.1}",
            pl.payline_id,
            pl.rtp_contribution * 100.0,
            1.0 / pl.hit_rate.max(1e-12)
        );
    }

    println!("\n──────────────────────── SYMBOLS ───────────────────────────────");
    for sym in &result.symbols {
        println!(
            "  {:6} │ grid hit {:.4}%  │ reel probs: {}",
            sym.symbol_id,
            sym.grid_hit_rate * 100.0,
            sym.reel_probs
                .iter()
                .map(|p| format!("{:.3}", p))
                .collect::<Vec<_>>()
                .join("  ")
        );
    }

    println!("\n═══════════════════════════════════════════════════════════════");
    println!(
        "  PARTIAL TOTAL RTP    : {:.6}%  (base + FS base, no H&W)",
        result.total_rtp_partial * 100.0
    );
    println!("  TARGET RTP           : {:.3}%", target_rtp);
    let delta = result.total_rtp_partial * 100.0 - target_rtp;
    println!(
        "  DELTA vs target      : {:+.4}%  (H&W not yet included — add Markov pass)",
        delta
    );
    println!("═══════════════════════════════════════════════════════════════\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::GameConfig;

    fn make_simple_config() -> GameConfig {
        use crate::config::*;
        use std::collections::HashMap;

        // 1-reel, 1-payline config for hand-verification
        let mut paytable = HashMap::new();
        paytable.insert(
            "H1".to_string(),
            PayEntry {
                pay3: 10.0,
                pay4: 25.0,
                pay5: 100.0,
            },
        );
        paytable.insert(
            "L1".to_string(),
            PayEntry {
                pay3: 2.0,
                pay4: 5.0,
                pay5: 10.0,
            },
        );
        paytable.insert(
            "W".to_string(),
            PayEntry {
                pay3: 5.0,
                pay4: 15.0,
                pay5: 50.0,
            },
        );

        let reel_weights = vec![
            ReelWeight {
                symbol: "W".to_string(),
                weight: 5,
            },
            ReelWeight {
                symbol: "H1".to_string(),
                weight: 10,
            },
            ReelWeight {
                symbol: "L1".to_string(),
                weight: 25,
            },
            ReelWeight {
                symbol: "S".to_string(),
                weight: 5,
            },
            ReelWeight {
                symbol: "B".to_string(),
                weight: 5,
            },
        ]; // total = 50

        GameConfig {
            name: "test".to_string(),
            version: "1.0".to_string(),
            target_rtp: 96.0,
            reels: 5,
            rows: 3,
            paylines: vec![vec![1, 1, 1, 1, 1]],
            symbols: vec![
                SymbolDef {
                    id: "W".to_string(),
                    name: "Wild".to_string(),
                    is_wild: true,
                    is_scatter: false,
                    is_bonus: false,
                is_mystery: false,
            is_coin_boost: false,
            },
                SymbolDef {
                    id: "H1".to_string(),
                    name: "High 1".to_string(),
                    is_wild: false,
                    is_scatter: false,
                    is_bonus: false,
                is_mystery: false,
            is_coin_boost: false,
            },
                SymbolDef {
                    id: "L1".to_string(),
                    name: "Low 1".to_string(),
                    is_wild: false,
                    is_scatter: false,
                    is_bonus: false,
                is_mystery: false,
            is_coin_boost: false,
            },
                SymbolDef {
                    id: "S".to_string(),
                    name: "Scatter".to_string(),
                    is_wild: false,
                    is_scatter: true,
                    is_bonus: false,
                is_mystery: false,
            is_coin_boost: false,
            },
                SymbolDef {
                    id: "B".to_string(),
                    name: "Bonus".to_string(),
                    is_wild: false,
                    is_scatter: false,
                    is_bonus: true,
                is_mystery: false,
            is_coin_boost: false,
            },
            ],
            paytable,
            base_weights: vec![reel_weights.clone(); 5],
            fs_weights: vec![reel_weights; 5],
            ..GameConfig::default()
        }
    }

    #[test]
    fn test_analytical_deterministic() {
        // Two independent calls → identical result
        let config = make_simple_config();
        let solver = AnalyticalSolver::new(&config);
        let r1 = solver.solve();
        let r2 = solver.solve();
        assert_eq!(
            r1.payline_rtp.to_bits(),
            r2.payline_rtp.to_bits(),
            "Analytical solver must be bit-identical across runs"
        );
        assert_eq!(r1.fs_trigger_prob.to_bits(), r2.fs_trigger_prob.to_bits());
    }

    #[test]
    fn test_scatter_dist_sums_to_one() {
        let config = make_simple_config();
        let solver = AnalyticalSolver::new(&config);
        let result = solver.solve();
        let sum: f64 = result.scatter_dist.iter().sum();
        assert!(
            (sum - 1.0).abs() < 1e-12,
            "Scatter distribution must sum to 1.0, got {}",
            sum
        );
    }

    #[test]
    fn test_bonus_dist_sums_to_one() {
        let config = make_simple_config();
        let solver = AnalyticalSolver::new(&config);
        let result = solver.solve();
        let sum: f64 = result.bonus_dist.iter().sum();
        assert!(
            (sum - 1.0).abs() < 1e-12,
            "Bonus distribution must sum to 1.0, got {}",
            sum
        );
    }

    #[test]
    fn test_payline_rtp_nonnegative() {
        let config = make_simple_config();
        let solver = AnalyticalSolver::new(&config);
        let result = solver.solve();
        assert!(result.payline_rtp >= 0.0);
        assert!(result.fs_trigger_prob >= 0.0 && result.fs_trigger_prob <= 1.0);
        assert!(result.hnw_trigger_prob >= 0.0 && result.hnw_trigger_prob <= 1.0);
    }

    #[test]
    fn test_trigger_probs_exclusive() {
        // P(FS) + P(H&W) ≤ 1
        let config = make_simple_config();
        let solver = AnalyticalSolver::new(&config);
        let result = solver.solve();
        assert!(
            result.fs_trigger_prob + result.hnw_trigger_prob <= 1.0 + 1e-12,
            "FS and H&W triggers can't exceed 100% combined"
        );
    }

    #[test]
    fn test_no_mc_needed() {
        // Verify result is NOT using any random state — call 1000 times, all identical
        let config = make_simple_config();
        let solver = AnalyticalSolver::new(&config);
        let baseline = solver.solve().payline_rtp;
        for _ in 0..999 {
            let r = solver.solve().payline_rtp;
            assert_eq!(r.to_bits(), baseline.to_bits());
        }
    }
}
