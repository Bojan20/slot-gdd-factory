//! Game Configuration Module
//!
//! Loads slot game configuration from JSON files.
//! Supports any slot theme with customizable symbols, paytable, and reels.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

/// Symbol definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolDef {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub is_wild: bool,
    #[serde(default)]
    pub is_scatter: bool,
    #[serde(default)]
    pub is_bonus: bool,
    /// PAR-14-E sister-side feature #2: Mystery reveal.
    /// When `true`, every cell carrying this symbol on the spin grid
    /// is REPLACED by a single random LP/MP paying symbol (uniformly
    /// drawn from the paytable) BEFORE evaluation. Matches Skeleton
    /// Key / Mystery Reels / Mystic Reels / etc. mechanics where
    /// Mystery symbols reveal as a single shared payable symbol per
    /// spin. Sister evaluator then runs normal line eval over the
    /// post-reveal grid.
    #[serde(default)]
    pub is_mystery: bool,
    /// PAR-14-E sister-side feature #6: Coin Boost multiplier symbol.
    ///
    /// When set, every cell carrying this symbol on the spin grid
    /// holds a multiplier value (drawn from a per-symbol distribution
    /// — see `coin_multiplier_distribution` on GameConfig). Line wins
    /// crossing a Coin Boost cell are multiplied by the cell's value.
    /// Matches Fortune Coin Boost / Buffalo Link / Wonder 4 Boost
    /// semantics. Mutually exclusive with is_wild/is_scatter/is_bonus.
    #[serde(default)]
    pub is_coin_boost: bool,
}

/// Paytable entry - pays for 3, 4, 5 of a kind
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PayEntry {
    #[serde(default)]
    pub pay3: f64,
    #[serde(default)]
    pub pay4: f64,
    #[serde(default)]
    pub pay5: f64,
}

/// Orb value for Hold & Win
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrbValue {
    pub value: u32,
    pub weight: u32,
    #[serde(default)]
    pub jackpot: Option<String>,
}

/// Lightning multiplier
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightningMult {
    pub value: u32,
    pub weight: u32,
}

/// Free Spins configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FreeSpinsConfig {
    pub awards: HashMap<u8, u8>, // scatter_count -> spins_awarded
    pub mult_start: u32,
    pub mult_increment: u32,
    pub mult_max: u32,
    pub retrigger_enabled: bool,
    pub scatter_pays: HashMap<u8, f64>, // scatter_count -> pay multiplier
    /// PAR-14-E sister-side feature #5: Special Reel Set.
    ///
    /// Per-FS-round alternate reel-weight tables. When non-empty,
    /// every FS spin draws from a weighted random selection of reel
    /// sets here instead of the default `fs_weights`. Matches
    /// Skeleton Key Special Reel Set FS bonus where each FS round
    /// can use a different higher-RTP reel set than base.
    ///
    /// Each entry holds the selection weight + the per-reel
    /// `Vec<ReelWeight>` strip stack for that set. Empty by default
    /// — sister falls back to top-level fs_weights.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub special_reel_sets: Vec<SpecialReelSet>,
}

/// PAR-14-E #5: weighted alternate reel set for FS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecialReelSet {
    pub weight: u32,
    pub reels: Vec<Vec<ReelWeight>>,
}

/// Hold & Win configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HoldAndWinConfig {
    pub trigger_count: u8,
    pub initial_respins: u8,
    pub respins_on_new_orb: u8,
    pub full_grid_bonus: f64,
    pub orb_values: Vec<OrbValue>,
    pub orb_land_chance_base: f64,
    pub orb_land_chance_fill_bonus: f64,
    /// PAR-14-E sister-side feature #3: Multi-scenario HnW.
    ///
    /// Per-scenario overrides keyed by INITIAL bonus_count (i.e. how
    /// many orbs landed on the trigger spin). When present, sister's
    /// `simulate_hnw` picks the matching scenario instead of the
    /// top-level chance / orb_values. Falls back to top-level params
    /// when no scenario matches.
    ///
    /// Cash Eruption has distinct tables for 6/7/8 Fireballs landed
    /// (PAR-001 r3970-r4030+). Each scenario has its own chance,
    /// respin count, and orb distribution.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scenarios: Vec<HoldAndWinScenario>,
}

/// PAR-14-E #6: Coin Boost multiplier weighted entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoinBoostMultiplier {
    pub value: u32,
    pub weight: u32,
}

/// PAR-14-E #3: per-initial-orb-count override branch for HnW.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HoldAndWinScenario {
    /// Initial bonus_count this scenario activates on (e.g. 6 = "6
    /// Fireballs landed"). Single integer match.
    pub initial_count: u8,
    pub initial_respins: u8,
    pub respins_on_new_orb: u8,
    pub orb_values: Vec<OrbValue>,
    pub orb_land_chance_base: f64,
    pub orb_land_chance_fill_bonus: f64,
}

/// Lightning feature configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightningConfig {
    pub trigger_chance: f64,
    pub trigger_chance_fs: f64,
    pub multipliers: Vec<LightningMult>,
}

// ─── W152 P0-3 — IR feature unstub ─────────────────────────────────────────
//
// Three new config structs that the IR adapter now extracts from
// `Feature::Cascade`, `Feature::Respin`, and `Feature::MysterySymbol`
// instead of dropping them on the floor. They mirror the TS-side
// `TSCascadeConfig` / `TSRespinConfig` / `TSMysteryConfig` exactly
// (snake_case → camelCase rename happens in the TS adapter).
//
// Downstream consumers (analytical solver, MC simulator, PAR generator)
// can pattern-match on `Option::is_some` to decide whether the feature
// is active for a given game. The structs themselves carry data only —
// no engine logic.

/// Cascade (drop / refill) feature configuration.
///
/// `replacement` controls how the grid refills after a winning cluster
/// is cleared:
/// - `Drop`         — existing symbols fall, top is refilled from reel strip.
/// - `RefillRandom` — every cleared cell is redrawn from the reel weights.
/// - `FixedStrip`   — the cleared cells consume the next symbols on a
///                    persistent strip ("avalanche" semantics).
///
/// `max_chain` caps the number of consecutive cascade steps per spin to
/// keep variance budget finite (KIMI 07: max-win cap interaction).
///
/// `multiplier_progression` is the per-chain-step multiplier ladder.
/// For example `[1, 2, 3, 5]` means step 0 = ×1, step 1 = ×2, etc.
/// `None` ⇒ flat ×1 across all chain steps.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CascadeConfig {
    pub replacement: CascadeReplacement,
    pub max_chain: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub multiplier_progression: Option<Vec<f64>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CascadeReplacement {
    Drop,
    RefillRandom,
    FixedStrip,
}

/// Respin feature configuration — paid extra spins on existing grid.
///
/// `cost_x` is the multiplier of the base bet charged per respin.
/// `max_uses_per_spin` caps consecutive respins from a single base spin
/// (industry-typical 1–3 to bound variance).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RespinConfig {
    pub cost_x: f64,
    pub max_uses_per_spin: u32,
}

// W152 Faza 2.4 — Pattern evaluator config (sits with the other
// runtime feature configs even though the evaluator itself lives in
// `crate::evaluator::EvalMode::Pattern`). Carrying the rules here keeps
// the GameConfig the single source-of-truth that downstream consumers
// (analytical, MC sim, PAR generator) can hash for parity.

/// One pattern rule — fixed list of `(row, reel)` cells that must all
/// match the same symbol (wilds substitute). Mirrors the
/// `evaluator::PatternRule` struct exactly so the adapter can clone
/// across without translation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PatternRuleConfig {
    pub id: String,
    /// `[row, reel]` per cell. Serialised as 2-element array to match
    /// the IR wire shape (`PatternPositions::List`).
    pub positions: Vec<[u32; 2]>,
    pub pay_multiplier: f64,
}

/// Pattern evaluation configuration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PatternConfig {
    pub rules: Vec<PatternRuleConfig>,
}

/// Mystery symbol feature configuration.
///
/// `symbol_id` is the placeholder symbol that, after landing, reveals
/// as one of the symbols in `reveal_distribution` weighted by the f64
/// value. The weights are normalised by the consumer; we keep raw f64
/// to preserve the IR shape and allow downstream tooling to inspect
/// the distribution shape (KIMI 07 xWays mystery, NetEnt cluster reveal).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MysteryConfig {
    pub symbol_id: String,
    /// BTreeMap so JSON serialisation is byte-stable for parity tests.
    pub reveal_distribution: BTreeMap<String, f64>,
}

// ─── W152 P0-3 (round 2) — Pick / Wheel / BuyFeature / AnteBet / Gamble /
// SymbolUpgrade configs ─────────────────────────────────────────────────────
//
// Six additional runtime feature configs. Each mirrors a `Feature::*` IR
// variant and is materialised as `Option<…>` on `GameConfig` so consumers
// branch on `is_some()` without touching defaults.
//
// Design notes:
//   * The IR uses `Vec<PrizeEntry>` and `Vec<BuyOffer>` directly, but the
//     runtime types own their entries (no borrowing) so they can move freely
//     across thread boundaries and into per-game caches.
//   * Enum variants (`GambleType`, `TieResolution`) are mirrored 1:1 with
//     `#[serde(rename_all = "snake_case")]` so wire format matches IR.
//   * `BuyFeatureConfig` is jurisdiction-gated downstream (UKGC SI 2025/215
//     prohibits feature buys for 18-24 segment, NL KSA bans entirely since
//     May 2024; see KIMI 01 §3.10). The config carries the offers; gating
//     happens in `jurisdiction::validate` at runtime.

/// One entry in a `Pick` bonus prize pool (also reused for `Wheel`
/// segments — mathematically identical shape, weighted pick of a payout).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PrizeSlot {
    pub id: String,
    pub weight: f64,
    pub pay_multiplier: f64,
}

/// `Pick` bonus configuration — player chooses N from a weighted pool.
///
/// Common in Hold & Win bonus games and end-of-feature pick rounds.
/// We expose the raw pool; the engine handles "player picks 1 / 3 / …"
/// at simulation time based on feature trace metadata.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PickConfig {
    pub prize_pool: Vec<PrizeSlot>,
}

/// `Wheel` bonus configuration — single weighted spin of a wheel of payouts.
///
/// Identical pool shape to `PickConfig` but tagged separately so the
/// presentation layer + analytical solver can differentiate (a wheel is a
/// one-shot draw; a pick is N draws without replacement unless guaranteed).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WheelConfig {
    pub segments: Vec<PrizeSlot>,
}

/// One purchasable feature offer (e.g. "Buy free spins for 100× bet").
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BuyFeatureOffer {
    pub id: String,
    pub cost_x: f64,
    pub guaranteed: String,
}

/// `BuyFeature` configuration — bonus-buy menu.
///
/// **Jurisdiction-gated** (UKGC, NL KSA, DE GGL, DK SP — all prohibit
/// bonus-buys for online slots). The runtime jurisdiction validator
/// rejects games that ship a non-empty `BuyFeatureConfig` for those
/// markets; see KIMI 01 §3.10 for the canonical list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BuyFeatureConfig {
    pub offers: Vec<BuyFeatureOffer>,
}

/// `AnteBet` configuration — opt-in stake multiplier that boosts a
/// feature trigger probability in exchange for a higher per-spin bet.
///
/// `extra_multiplier` is the bet multiplier (e.g. 1.25 = +25%). The
/// downstream trigger model uses `enabled_by_default` to decide whether
/// the simulator runs in ante-on or ante-off mode unless the IR fixture
/// overrides it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnteBetConfig {
    pub extra_multiplier: f64,
    pub enabled_by_default: bool,
}

/// Gamble kind — what is being predicted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GambleType {
    /// Two-way pick (50/50). Industry default.
    RedBlack,
    /// Four-way pick (suit). 1/4 win, ×4 payout.
    Suit,
}

/// Tie resolution policy when the gamble outcome equals the player pick.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GambleTieResolution {
    /// House wins on ties (favors casino edge).
    House,
    /// Push — stake returned, no win, no loss.
    Push,
}

/// `Gamble` configuration — optional post-win double-up.
///
/// **Jurisdiction-gated** (UKGC RTS 14D prohibits gamble features for
/// online slots; KIMI 01 §3.9). Carried in IR so legacy / land-based
/// fixtures still round-trip cleanly.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GambleConfig {
    #[serde(rename = "type")]
    pub ty: GambleType,
    pub max_steps: u32,
    pub tie_resolution: GambleTieResolution,
}

/// `SymbolUpgrade` configuration — symbol transform with a fixed probability.
///
/// Each landing instance of `from` independently becomes `to` with the given
/// probability. `0.0` ≤ `probability` ≤ `1.0` is asserted by IR validator.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SymbolUpgradeConfig {
    pub from: String,
    pub to: String,
    pub probability: f64,
}

/// Reel weight entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReelWeight {
    pub symbol: String,
    pub weight: u32,
}

/// Complete game configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameConfig {
    pub name: String,
    pub version: String,
    pub target_rtp: f64,

    // Grid layout
    pub reels: u8,
    pub rows: u8,
    pub paylines: Vec<Vec<u8>>,

    // Symbols
    pub symbols: Vec<SymbolDef>,
    pub paytable: HashMap<String, PayEntry>,

    // Reel strips (base game and free spins)
    pub base_weights: Vec<Vec<ReelWeight>>,
    pub fs_weights: Vec<Vec<ReelWeight>>,

    // Features
    pub free_spins: FreeSpinsConfig,
    pub hold_and_win: HoldAndWinConfig,
    pub lightning: LightningConfig,

    // W152 P0-3 — IR feature unstub. All `Option` so games that don't
    // declare the feature in the IR carry `None` and downstream consumers
    // can branch on `is_some()` without touching default values.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cascade: Option<CascadeConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub respin: Option<RespinConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mystery: Option<MysteryConfig>,

    // W152 P0-3 (round 2) — Pick / Wheel / BuyFeature / AnteBet / Gamble /
    // SymbolUpgrade. All `Option` for the same reason as round 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pick: Option<PickConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wheel: Option<WheelConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub buy_feature: Option<BuyFeatureConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ante_bet: Option<AnteBetConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gamble: Option<GambleConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symbol_upgrade: Option<SymbolUpgradeConfig>,

    // W152 Faza 2.4 — Pattern evaluator config. Populated when the IR's
    // evaluation kind is `pattern`; otherwise `None`. The engine
    // dispatches to `EvalMode::Pattern { rules }` when this field is
    // present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pattern: Option<PatternConfig>,

    // Limits
    pub max_win_cap: f64,
    pub feature_loop_cap: u32,

    /// PAR-14-E sister-side feature #6: Coin Boost multiplier distribution.
    ///
    /// When non-empty, sister's grid generator attaches a multiplier
    /// value to every is_coin_boost cell drawn from this weighted
    /// distribution. Line evaluation then multiplies the line's pay
    /// by product of multipliers on participating Coin Boost cells.
    ///
    /// Empty by default — games without Coin Boost behave unchanged.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub coin_boost_multipliers: Vec<CoinBoostMultiplier>,

    /// PAR-14-E sister-side feature #4: Wild Expand spatial mechanic.
    ///
    /// When `true`, after grid generation every reel that contains at
    /// least one Wild cell has ALL its cells filled with Wild before
    /// line evaluation. Sister applies Grid::apply_wild_expand() in
    /// evaluate_spin. Matches Skeleton Key / NetEnt Mega Joker
    /// expanding-wild semantics.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub wild_expand_mode: bool,

    // PAR-14-E (Boki 2026-06-27, native sister-side feature path):
    // Bonus Buy MODE flag. When `true`, the simulator skips base game
    // line evaluation entirely and routes every spin straight to the
    // Free Spins / Bonus simulation as if the player bought in. Used
    // to model Bonus Buy variant par sheets (Book of Unseen Bonus Buy,
    // Sweet Bonanza Bonus Buy, etc.) without the factory-side
    // scatter_pays scaling hack.
    //
    // Cost model: per industry convention, Bonus Buy total bet is
    // `cost_x × base_total_bet` (typically 100×). The `total_bet_mc`
    // field already carries the elevated bet at request time, so this
    // flag only needs to redirect spin flow.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub bonus_buy_mode: bool,
}

impl GameConfig {
    /// Load configuration from JSON file
    pub fn from_file(path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let content = std::fs::read_to_string(path)?;
        let config: GameConfig = serde_json::from_str(&content)?;
        Ok(config)
    }

    /// Get symbol index by ID
    pub fn symbol_index(&self, id: &str) -> Option<usize> {
        self.symbols.iter().position(|s| s.id == id)
    }

    /// Get wild symbol ID
    pub fn wild_id(&self) -> Option<&str> {
        self.symbols
            .iter()
            .find(|s| s.is_wild)
            .map(|s| s.id.as_str())
    }

    /// Get scatter symbol ID
    pub fn scatter_id(&self) -> Option<&str> {
        self.symbols
            .iter()
            .find(|s| s.is_scatter)
            .map(|s| s.id.as_str())
    }

    /// Get bonus symbol ID
    pub fn bonus_id(&self) -> Option<&str> {
        self.symbols
            .iter()
            .find(|s| s.is_bonus)
            .map(|s| s.id.as_str())
    }

    /// Get total weight for a reel
    pub fn reel_total_weight(&self, reel: usize, is_fs: bool) -> u32 {
        let weights = if is_fs {
            &self.fs_weights
        } else {
            &self.base_weights
        };
        weights
            .get(reel)
            .map(|w| w.iter().map(|e| e.weight).sum())
            .unwrap_or(0)
    }
}

/// Default configuration for testing
impl Default for GameConfig {
    fn default() -> Self {
        GameConfig {
            name: "Default Slot".to_string(),
            version: "1.0.0".to_string(),
            target_rtp: 96.0,
            reels: 5,
            rows: 3,
            paylines: vec![
                vec![1, 1, 1, 1, 1], // Middle row
            ],
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
            paytable: HashMap::new(),
            base_weights: vec![],
            fs_weights: vec![],
            free_spins: FreeSpinsConfig {
                awards: HashMap::from([(3, 10), (4, 12), (5, 15)]),
                mult_start: 1,
                mult_increment: 1,
                mult_max: 10,
                retrigger_enabled: true,
                scatter_pays: HashMap::from([(3, 2.0), (4, 5.0), (5, 20.0)]),
                special_reel_sets: Vec::new(),
            },
            hold_and_win: HoldAndWinConfig {
                trigger_count: 6,
                initial_respins: 3,
                respins_on_new_orb: 3,
                full_grid_bonus: 500.0,
                orb_values: vec![
                    OrbValue {
                        value: 1,
                        weight: 600,
                        jackpot: None,
                    },
                    OrbValue {
                        value: 2,
                        weight: 250,
                        jackpot: None,
                    },
                    OrbValue {
                        value: 5,
                        weight: 100,
                        jackpot: None,
                    },
                ],
                orb_land_chance_base: 0.035,
                orb_land_chance_fill_bonus: 0.015,
                scenarios: Vec::new(),
            },
            lightning: LightningConfig {
                trigger_chance: 0.15,
                trigger_chance_fs: 0.0,
                multipliers: vec![
                    LightningMult {
                        value: 2,
                        weight: 70,
                    },
                    LightningMult {
                        value: 3,
                        weight: 18,
                    },
                    LightningMult {
                        value: 5,
                        weight: 10,
                    },
                    LightningMult {
                        value: 10,
                        weight: 2,
                    },
                ],
            },
            // W152 P0-3 — IR features default to None on the testing
            // default config; games that need them populate via the
            // IR adapter.
            cascade: None,
            respin: None,
            mystery: None,
            pick: None,
            wheel: None,
            buy_feature: None,
            ante_bet: None,
            gamble: None,
            symbol_upgrade: None,
            // W152 Faza 2.4 — Pattern evaluator default.
            pattern: None,
            max_win_cap: 5000.0,
            feature_loop_cap: 100,
            bonus_buy_mode: false,
            wild_expand_mode: false,
            coin_boost_multipliers: Vec::new(),
        }
    }
}
