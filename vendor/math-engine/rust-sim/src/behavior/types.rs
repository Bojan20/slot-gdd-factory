//! Faza 3 — Symbol Behavior Plugin Layer: Core Types (Rust mirror)
//!
//! Mirrors `src/behaviors/types.ts`. Must stay in sync with the TS side.
//! Serde field names match the TS `Effect` discriminated union `kind` values.
//!
//! ## Design choices
//!
//! - `Effect` is a Rust enum with named fields on each variant (matches TS).
//! - `SpinState` is a plain struct; behaviors receive `&SpinState` (shared ref).
//! - Behaviors implement the `SymbolBehavior` trait.
//! - All behavior hooks return `Vec<Effect>` (empty = no-op).
//! - The pipeline (`apply_effect`) owns the mutable `SpinState`.

use std::collections::{HashMap, HashSet};

// ─── EffectScope ─────────────────────────────────────────────────────────────

/// Scope of a multiplier effect — mirrors TS `EffectScope`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EffectScope {
    Line,
    Ways,
    Spin,
    Session,
}

// ─── Effect ───────────────────────────────────────────────────────────────────

/// Sealed enum of all behavior side-effects — mirrors TS `Effect`.
#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    Noop,

    MultiplierAdd {
        value: f64,
        scope: EffectScope,
    },
    MultiplierMul {
        value: f64,
        scope: EffectScope,
    },

    TransformSymbol {
        reel: usize,
        row: usize,
        to_symbol: String,
    },

    ExpandWild {
        reel: usize,
        symbol: String,
    },

    LockPosition {
        reel: usize,
        row: usize,
        remaining_spins: u32,
    },

    AddWild {
        reel: usize,
        row: usize,
        symbol: String,
    },

    CollectCoin {
        reel: usize,
        row: usize,
        amount: f64,
    },

    TriggerFeature {
        feature_id: String,
    },

    AwardJackpot {
        tier: String,
        amount: f64,
    },

    UpgradeSymbols {
        from_symbol: String,
        to_symbol: String,
    },

    ScatterPay {
        count: usize,
        multiplier: f64,
    },

    Respin {
        count: u32,
    },
}

// ─── LockedPosition ───────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct LockedPosition {
    pub reel: usize,
    pub row: usize,
    pub symbol: String,
    pub remaining_spins: u32,
}

// ─── CollectedCoin ────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct CollectedCoin {
    pub reel: usize,
    pub row: usize,
    pub amount: f64,
}

// ─── SpinState ────────────────────────────────────────────────────────────────

/// Mutable accumulator for one spin (or feature session).
/// Pipeline owns it; behaviors receive `&SpinState`.
#[derive(Debug)]
pub struct SpinState {
    /// grid[reel][row] — symbol ids
    pub grid: Vec<Vec<String>>,
    pub reels: usize,
    pub rows: usize,

    pub line_multiplier: f64,
    pub spin_multiplier: f64,
    pub session_multiplier: f64,

    pub locked_positions: Vec<LockedPosition>,
    pub collected_coins: Vec<CollectedCoin>,
    pub triggered_features: HashSet<String>,
    pub jackpot_awarded: Option<(String, f64)>,

    pub scatter_payout: f64,
    pub respins_awarded: u32,
    pub upgrades: Vec<(String, String)>,
}

impl SpinState {
    /// Create a blank SpinState wrapping `grid`.
    pub fn new(grid: Vec<Vec<String>>) -> Self {
        let reels = grid.len();
        let rows = grid.first().map_or(0, |c| c.len());
        Self {
            grid,
            reels,
            rows,
            line_multiplier: 1.0,
            spin_multiplier: 1.0,
            session_multiplier: 1.0,
            locked_positions: Vec::new(),
            collected_coins: Vec::new(),
            triggered_features: HashSet::new(),
            jackpot_awarded: None,
            scatter_payout: 0.0,
            respins_awarded: 0,
            upgrades: Vec::new(),
        }
    }
}

// ─── BehaviorContext ──────────────────────────────────────────────────────────

/// Read-only context injected into every behavior hook.
pub struct BehaviorContext<'a> {
    pub symbol_id: &'a str,
    pub reel: usize,
    pub row: usize,
    pub state: &'a SpinState,
    pub config: &'a HashMap<String, String>,
}

// ─── SymbolBehavior trait ─────────────────────────────────────────────────────

/// Plugin interface every behavior implementation must satisfy.
pub trait SymbolBehavior: Send + Sync {
    fn id(&self) -> &str;
    fn kind(&self) -> &str;

    fn on_land(&self, ctx: &BehaviorContext<'_>) -> Vec<Effect>;
    fn on_win(&self, ctx: &BehaviorContext<'_>) -> Vec<Effect>;

    fn on_cascade_remove(&self, _ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        vec![]
    }
    fn on_feature_start(&self, _ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        vec![]
    }
    fn on_spin_end(&self, _ctx: &BehaviorContext<'_>) -> Vec<Effect> {
        vec![]
    }
}
