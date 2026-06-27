//! Faza 3 — Symbol Behavior Plugin Layer: Implementations (Rust)
//!
//! Mirrors the 11 TS behavior classes under `src/behaviors/impls/`.
//! Only the logic-critical behaviors are fully ported; pure-TS UI behaviors
//! (animations, sounds) have stubs.

use super::types::{BehaviorContext, Effect, EffectScope, SymbolBehavior};
use std::collections::HashMap;

// ─── WildBehavior ─────────────────────────────────────────────────────────────

pub struct WildBehavior {
    pub id: String,
}

impl SymbolBehavior for WildBehavior {
    fn id(&self) -> &str {
        &self.id
    }
    fn kind(&self) -> &str {
        "WildBehavior"
    }
    fn on_land(&self, _ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        vec![]
    }
    fn on_win(&self, _ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        vec![]
    }
}

// ─── ExpandingWildBehavior ────────────────────────────────────────────────────

pub struct ExpandingWildBehavior {
    pub id: String,
    pub on_win_only: bool,
}

impl SymbolBehavior for ExpandingWildBehavior {
    fn id(&self) -> &str {
        &self.id
    }
    fn kind(&self) -> &str {
        "ExpandingWildBehavior"
    }

    fn on_land(&self, ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        if self.on_win_only {
            return vec![];
        }
        vec![Effect::ExpandWild {
            reel: ctx.reel,
            symbol: ctx.symbol_id.to_string(),
        }]
    }

    fn on_win(&self, ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        if !self.on_win_only {
            return vec![];
        }
        vec![Effect::ExpandWild {
            reel: ctx.reel,
            symbol: ctx.symbol_id.to_string(),
        }]
    }
}

// ─── StickyWildBehavior ───────────────────────────────────────────────────────

pub struct StickyWildBehavior {
    pub id: String,
    pub duration: u32,
    pub upgrade_on_win: bool,
}

impl SymbolBehavior for StickyWildBehavior {
    fn id(&self) -> &str {
        &self.id
    }
    fn kind(&self) -> &str {
        "StickyWildBehavior"
    }

    fn on_land(&self, ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        vec![Effect::LockPosition {
            reel: ctx.reel,
            row: ctx.row,
            remaining_spins: self.duration,
        }]
    }

    fn on_win(&self, ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        if !self.upgrade_on_win {
            return vec![];
        }
        let existing = ctx
            .state
            .locked_positions
            .iter()
            .find(|lp| lp.reel == ctx.reel && lp.row == ctx.row);
        if let Some(lp) = existing {
            vec![Effect::LockPosition {
                reel: ctx.reel,
                row: ctx.row,
                remaining_spins: lp.remaining_spins + 1,
            }]
        } else {
            vec![]
        }
    }
}

// ─── MultiplierWildBehavior ───────────────────────────────────────────────────

pub struct MultiplierWildBehavior {
    pub id: String,
    pub value: f64,
    pub scope: EffectScope,
    pub mul: bool, // true=mul, false=add
}

impl SymbolBehavior for MultiplierWildBehavior {
    fn id(&self) -> &str {
        &self.id
    }
    fn kind(&self) -> &str {
        "MultiplierWildBehavior"
    }

    fn on_land(&self, _ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        vec![]
    }

    fn on_win(&self, _ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        if self.mul {
            vec![Effect::MultiplierMul {
                value: self.value,
                scope: self.scope,
            }]
        } else {
            vec![Effect::MultiplierAdd {
                value: self.value,
                scope: self.scope,
            }]
        }
    }
}

// ─── ScatterBehavior ──────────────────────────────────────────────────────────

pub struct ScatterBehavior {
    pub id: String,
    pub feature_id: String,
    pub trigger_count: usize,
    pub scatter_pays: HashMap<usize, f64>, // count → multiplier
}

impl SymbolBehavior for ScatterBehavior {
    fn id(&self) -> &str {
        &self.id
    }
    fn kind(&self) -> &str {
        "ScatterBehavior"
    }

    fn on_land(&self, ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        let mut effects = Vec::new();
        let count = count_symbol(&ctx.state.grid, &self.id);

        if count >= self.trigger_count {
            effects.push(Effect::TriggerFeature {
                feature_id: self.feature_id.clone(),
            });
        }

        if let Some(&mult) = self.scatter_pays.get(&count) {
            effects.push(Effect::ScatterPay {
                count,
                multiplier: mult,
            });
        }

        effects
    }

    fn on_win(&self, _ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        vec![]
    }
}

// ─── CoinBehavior ─────────────────────────────────────────────────────────────

pub struct CoinBehavior {
    pub id: String,
    pub feature_id: String,
    pub trigger_count: usize,
    pub default_amount: f64,
    pub respins_reset: u32,
}

impl SymbolBehavior for CoinBehavior {
    fn id(&self) -> &str {
        &self.id
    }
    fn kind(&self) -> &str {
        "CoinBehavior"
    }

    fn on_land(&self, ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        let mut effects = Vec::new();
        let amount = parse_coin_amount(&self.id, ctx.symbol_id, self.default_amount);
        effects.push(Effect::CollectCoin {
            reel: ctx.reel,
            row: ctx.row,
            amount,
        });

        let coin_count = count_coin_prefix(&ctx.state.grid, &self.id);
        if coin_count >= self.trigger_count {
            effects.push(Effect::TriggerFeature {
                feature_id: self.feature_id.clone(),
            });
        }

        if ctx.state.triggered_features.contains(&self.feature_id) {
            effects.push(Effect::Respin {
                count: self.respins_reset,
            });
        }

        effects
    }

    fn on_win(&self, _ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        vec![]
    }
}

// ─── MultiplierSymbolBehavior ─────────────────────────────────────────────────

pub enum MultiplierTrigger {
    Land,
    Win,
    Both,
}

pub struct MultiplierSymbolBehavior {
    pub id: String,
    pub value: f64,
    pub scope: EffectScope,
    pub mul: bool,
    pub trigger_on: MultiplierTrigger,
}

impl SymbolBehavior for MultiplierSymbolBehavior {
    fn id(&self) -> &str {
        &self.id
    }
    fn kind(&self) -> &str {
        "MultiplierSymbolBehavior"
    }

    fn on_land(&self, _ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        match self.trigger_on {
            MultiplierTrigger::Land | MultiplierTrigger::Both => self.make_effects(),
            _ => vec![],
        }
    }

    fn on_win(&self, _ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        match self.trigger_on {
            MultiplierTrigger::Win | MultiplierTrigger::Both => self.make_effects(),
            _ => vec![],
        }
    }
}

impl MultiplierSymbolBehavior {
    fn make_effects(&self) -> Vec<Effect> {
        if self.mul {
            vec![Effect::MultiplierMul {
                value: self.value,
                scope: self.scope,
            }]
        } else {
            vec![Effect::MultiplierAdd {
                value: self.value,
                scope: self.scope,
            }]
        }
    }
}

// ─── MysteryBehavior ──────────────────────────────────────────────────────────

pub struct MysteryBehavior {
    pub id: String,
    /// (symbol, cumulative_weight)
    pub dist: Vec<(String, f64)>,
    pub total: f64,
}

impl MysteryBehavior {
    pub fn new(id: String, weights: Vec<(String, f64)>) -> Self {
        let total: f64 = weights.iter().map(|(_, w)| w).sum();
        let mut cum = 0.0;
        let dist = weights
            .into_iter()
            .map(|(s, w)| {
                cum += w;
                (s, cum)
            })
            .collect();
        Self { id, dist, total }
    }

    pub fn draw(&self, t: f64) -> &str {
        let target = t * self.total;
        for (sym, cum) in &self.dist {
            if target <= *cum {
                return sym;
            }
        }
        self.dist.last().map(|(s, _)| s.as_str()).unwrap_or("")
    }
}

impl SymbolBehavior for MysteryBehavior {
    fn id(&self) -> &str {
        &self.id
    }
    fn kind(&self) -> &str {
        "MysteryBehavior"
    }

    fn on_land(&self, ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        // Positions with this mystery symbol.
        let positions: Vec<(usize, usize)> = ctx
            .state
            .grid
            .iter()
            .enumerate()
            .flat_map(|(reel, col)| {
                col.iter()
                    .enumerate()
                    .filter(|(_, cell)| cell.as_str() == self.id)
                    .map(move |(row, _)| (reel, row))
            })
            .collect();

        if positions.is_empty() {
            return vec![];
        }

        // Single draw for all instances.
        let to_symbol = self.draw(fastrand::f64()).to_string();

        positions
            .into_iter()
            .map(|(reel, row)| Effect::TransformSymbol {
                reel,
                row,
                to_symbol: to_symbol.clone(),
            })
            .collect()
    }

    fn on_win(&self, _ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        vec![]
    }
}

// ─── JackpotBehavior ──────────────────────────────────────────────────────────

pub enum JackpotTrigger {
    Land,
    Win,
}

pub struct JackpotBehavior {
    pub id: String,
    pub tier: String,
    pub amount: f64,
    pub trigger_on: JackpotTrigger,
    pub min_count: usize,
}

impl SymbolBehavior for JackpotBehavior {
    fn id(&self) -> &str {
        &self.id
    }
    fn kind(&self) -> &str {
        "JackpotBehavior"
    }

    fn on_land(&self, ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        match self.trigger_on {
            JackpotTrigger::Land if self.should_trigger(ctx) => {
                vec![Effect::AwardJackpot {
                    tier: self.tier.clone(),
                    amount: self.amount,
                }]
            }
            _ => vec![],
        }
    }

    fn on_win(&self, ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        match self.trigger_on {
            JackpotTrigger::Win if self.should_trigger(ctx) => {
                vec![Effect::AwardJackpot {
                    tier: self.tier.clone(),
                    amount: self.amount,
                }]
            }
            _ => vec![],
        }
    }
}

impl JackpotBehavior {
    fn should_trigger(&self, ctx: &BehaviorContext<'_>) -> bool {
        if self.min_count <= 1 {
            return true;
        }
        count_symbol(&ctx.state.grid, &self.id) >= self.min_count
    }
}

// ─── TransformBehavior ────────────────────────────────────────────────────────

pub enum TransformTrigger {
    SelfPos,
    Adjacent,
    All,
}

pub struct TransformRule {
    pub trigger: TransformTrigger,
    pub from: String,
    pub to: String,
}

pub struct TransformBehavior {
    pub id: String,
    pub rules: Vec<TransformRule>,
}

impl SymbolBehavior for TransformBehavior {
    fn id(&self) -> &str {
        &self.id
    }
    fn kind(&self) -> &str {
        "TransformBehavior"
    }

    fn on_land(&self, ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        let mut effects = Vec::new();
        let grid = &ctx.state.grid;

        for rule in &self.rules {
            match rule.trigger {
                TransformTrigger::SelfPos => {
                    if grid
                        .get(ctx.reel)
                        .and_then(|c| c.get(ctx.row))
                        .map_or(false, |s| s == &rule.from)
                    {
                        effects.push(Effect::TransformSymbol {
                            reel: ctx.reel,
                            row: ctx.row,
                            to_symbol: rule.to.clone(),
                        });
                    }
                }
                TransformTrigger::Adjacent => {
                    let neighbors = [
                        (ctx.reel.wrapping_sub(1), ctx.row),
                        (ctx.reel + 1, ctx.row),
                        (ctx.reel, ctx.row.wrapping_sub(1)),
                        (ctx.reel, ctx.row + 1),
                    ];
                    for (nr, nrow) in neighbors {
                        if grid
                            .get(nr)
                            .and_then(|c| c.get(nrow))
                            .map_or(false, |s| s == &rule.from)
                        {
                            effects.push(Effect::TransformSymbol {
                                reel: nr,
                                row: nrow,
                                to_symbol: rule.to.clone(),
                            });
                        }
                    }
                }
                TransformTrigger::All => {
                    for (reel, col) in grid.iter().enumerate() {
                        for (row, cell) in col.iter().enumerate() {
                            if cell == &rule.from {
                                effects.push(Effect::TransformSymbol {
                                    reel,
                                    row,
                                    to_symbol: rule.to.clone(),
                                });
                            }
                        }
                    }
                }
            }
        }
        effects
    }

    fn on_win(&self, _ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        vec![]
    }
}

// ─── WalkingWildBehavior ──────────────────────────────────────────────────────

pub enum WalkDirection {
    Left,
    Right,
    Up,
    Down,
}

pub struct WalkingWildBehavior {
    pub id: String,
    pub direction: WalkDirection,
    pub disappears_on_edge: bool,
    pub reels: usize,
    pub rows: usize,
}

const WALK_SENTINEL: u32 = 9999;

impl SymbolBehavior for WalkingWildBehavior {
    fn id(&self) -> &str {
        &self.id
    }
    fn kind(&self) -> &str {
        "WalkingWildBehavior"
    }

    fn on_land(&self, ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        vec![Effect::LockPosition {
            reel: ctx.reel,
            row: ctx.row,
            remaining_spins: WALK_SENTINEL,
        }]
    }

    fn on_win(&self, _ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        vec![]
    }

    fn on_spin_end(&self, ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        if let Some((nr, nrow)) = self.next_pos(ctx.reel, ctx.row) {
            vec![
                Effect::AddWild {
                    reel: nr,
                    row: nrow,
                    symbol: self.id.clone(),
                },
                Effect::LockPosition {
                    reel: nr,
                    row: nrow,
                    remaining_spins: WALK_SENTINEL,
                },
                Effect::LockPosition {
                    reel: ctx.reel,
                    row: ctx.row,
                    remaining_spins: 1,
                },
            ]
        } else {
            vec![]
        }
    }
}

impl WalkingWildBehavior {
    fn next_pos(&self, reel: usize, row: usize) -> Option<(usize, usize)> {
        let (nr, nrow): (i64, i64) = match self.direction {
            WalkDirection::Left => (reel as i64 - 1, row as i64),
            WalkDirection::Right => (reel as i64 + 1, row as i64),
            WalkDirection::Up => (reel as i64, row as i64 - 1),
            WalkDirection::Down => (reel as i64, row as i64 + 1),
        };
        if nr < 0 || nr >= self.reels as i64 || nrow < 0 || nrow >= self.rows as i64 {
            if self.disappears_on_edge {
                return None;
            }
            // Bounce
            let (br, brow): (i64, i64) = match self.direction {
                WalkDirection::Left => (reel as i64 + 1, row as i64),
                WalkDirection::Right => (reel as i64 - 1, row as i64),
                WalkDirection::Up => (reel as i64, row as i64 + 1),
                WalkDirection::Down => (reel as i64, row as i64 - 1),
            };
            if br < 0 || br >= self.reels as i64 || brow < 0 || brow >= self.rows as i64 {
                return None;
            }
            return Some((br as usize, brow as usize));
        }
        Some((nr as usize, nrow as usize))
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn count_symbol(grid: &[Vec<String>], sym: &str) -> usize {
    grid.iter()
        .flat_map(|col| col.iter())
        .filter(|c| c.as_str() == sym)
        .count()
}

fn count_coin_prefix(grid: &[Vec<String>], prefix: &str) -> usize {
    let base = prefix.split(':').next().unwrap_or(prefix);
    grid.iter()
        .flat_map(|col| col.iter())
        .filter(|c| c.as_str() == prefix || c.starts_with(&format!("{}:", base)))
        .count()
}

fn parse_coin_amount(base_id: &str, symbol_id: &str, default: f64) -> f64 {
    let _ = base_id;
    if let Some(colon) = symbol_id.find(':') {
        if let Ok(v) = symbol_id[colon + 1..].parse::<f64>() {
            if v > 0.0 {
                return v;
            }
        }
    }
    default
}
