//! Slot Game IR — Rust mirror of `src/ir/types.ts`.
//!
//! Every field name, every variant tag, every discriminator string must
//! match the TS side exactly — that's the contract behind the Faza 10.3
//! TS↔Rust parity gate. The roundtrip integration test in
//! `tests/ir_roundtrip.rs` proves it: deserialize a JSON config that
//! also passes Zod, re-serialize it, and assert no field drifted.
//!
//! All types derive `Serialize + Deserialize + Clone + Debug + PartialEq`.
//! No engine logic lives here — that's `crate::evaluator` /
//! `crate::simulator`. This module is shape only.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub mod adapter;
pub mod validate;

#[allow(unused_imports)]
pub use adapter::{ir_to_game_config, AdapterError};
#[allow(unused_imports)]
pub use validate::{cross_validate, IRValidationIssue};

// ─── primitives ─────────────────────────────────────────────────────────

/// Stable kebab/snake key. We keep it `String` (not an enum) so the IR
/// supports arbitrary game-specific symbol sets without a code change.
pub type SymbolKey = String;

// ─── meta ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Meta {
    pub id: String,
    pub name: String,
    /// Semver of the config (NOT the engine binary).
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub theme_tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at_utc: Option<String>,
}

// ─── topology ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Topology {
    Rectangular {
        reels: u32,
        rows: u32,
    },
    VariableRows {
        reels: u32,
        /// `[min, max]` row count per reel index.
        row_range_per_reel: Vec<[u32; 2]>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ways_cap: Option<u64>,
    },
    ClusterGrid {
        columns: u32,
        rows: u32,
        adjacency: Adjacency,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Adjacency {
    Orthogonal,
    Diagonal,
    Hex,
}

// ─── symbols ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SymbolKind {
    Lp,
    Hp,
    Wild,
    Scatter,
    Bonus,
    Multiplier,
    Sticky,
    Expanding,
    Mystery,
    Transform,
    ChainWild,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SymbolDef {
    pub id: SymbolKey,
    pub name: String,
    pub kind: SymbolKind,
    /// `None` ⇒ doesn't substitute; `Some(All)` ⇒ "*" wildcard; `Some(List(…))`
    /// ⇒ explicit symbol list. Untagged so JSON shape exactly mirrors TS.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub substitutes: Option<Substitutes>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight_hint: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub appears_on: Option<Vec<u32>>,
    /// W4.7 — Advanced symbol behavior (colossal, expanding rule, transforming,
    /// collecting). Optional so legacy IRs stay round-trip valid.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub behavior: Option<SymbolBehavior>,
}

// ─── W4.7 symbol behavior (colossal / expanding / transforming / collecting) ─

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SymbolBehavior {
    /// Colossal block dimensions `[rows, cols]` if symbol occupies more than 1×1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub colossal_size: Option<[u32; 2]>,
    /// What happens to the symbol on landing: full-reel expand, walk, transform,
    /// collect, mystery reveal. `None` = static drop.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub behavior_type: Option<BehaviorType>,
    /// For `Transform`: which symbol it becomes after the trigger event.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transform_target: Option<SymbolKey>,
    /// For `Collect`: relative resolution order when multiple collectors land
    /// in the same spin. Higher = earlier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collection_priority: Option<i32>,
    /// How many spins the symbol persists after landing (sticky). `None` = 1 spin.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sticky_duration_spins: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BehaviorType {
    ExpandingFullReel,
    Walking,
    Transforming,
    Collecting,
    MysteryReveal,
    Colossal,
    Sticky,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Substitutes {
    /// JSON: `"*"`
    All(WildcardAll),
    /// JSON: `["S_LP1", "S_HP1", ...]`
    List(Vec<SymbolKey>),
}

/// Marker for the `"*"` literal. `#[serde(rename = "*")]` would make it
/// look like a regular string variant — wrapping it lets us keep the
/// untagged shape identical to TS (`'*' | string[]`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WildcardAll {
    #[serde(rename = "*")]
    Star,
}

// ─── reels ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum ReelSet {
    /// Per-reel symbol→weight distribution.
    Weighted {
        base: Vec<BTreeMap<SymbolKey, f64>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        free_spins: Option<Vec<BTreeMap<SymbolKey, f64>>>,
    },
    /// Per-reel explicit strip arrays — enables full-cycle analytical math.
    Strips {
        base: Vec<Vec<SymbolKey>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        free_spins: Option<Vec<Vec<SymbolKey>>>,
    },
}

// ─── evaluation ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    Ltr,
    Rtl,
    Both,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Evaluation {
    Lines {
        paylines: Vec<Vec<u32>>,
        direction: Direction,
        min_match: u32,
        pay_left_to_right_only: bool,
    },
    Ways {
        direction: Direction,
        min_match: u32,
        max_ways_per_spin: u64,
    },
    Cluster {
        min_cluster_size: u32,
        /// Cluster-size string key (`"5"`..`"12+"`) → multiplier.
        cluster_pay_table: BTreeMap<String, f64>,
    },
    PayAnywhere {
        min_count: u32,
    },
    Pattern {
        patterns: Vec<PatternSpec>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PatternSpec {
    pub id: String,
    pub positions: PatternPositions,
    pub pay_multiplier: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PatternPositions {
    /// JSON: `[[row, reel], ...]`
    List(Vec<[u32; 2]>),
    /// JSON: `"all"`
    All(All),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum All {
    #[serde(rename = "all")]
    All,
}

// ─── paytable ───────────────────────────────────────────────────────────

/// `symbol_id → (count_or_size_as_string → multiplier)`.
pub type Paytable = BTreeMap<SymbolKey, BTreeMap<String, f64>>;

// ─── features ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TriggerByCount {
    pub by: TriggerBy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thresholds: Option<BTreeMap<String, f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TriggerBy {
    ScatterCount,
    BonusCount,
    SpecialCount,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RetriggerSpec {
    #[serde(flatten)]
    pub trigger: TriggerByCount,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_total: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FsModifier {
    StickyWilds,
    ExpandingWilds,
    MultiplierLadder,
    MysterySymbol,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CascadeReplacement {
    Drop,
    RefillRandom,
    FixedStrip,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CashValueDist {
    pub value: f64,
    pub weight: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JackpotTier {
    pub id: String,
    pub multiplier: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PrizeEntry {
    pub id: String,
    pub weight: f64,
    pub pay_multiplier: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BuyOffer {
    pub id: String,
    pub cost_x: f64,
    pub guaranteed: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Feature {
    FreeSpins {
        trigger: TriggerByCount,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        retrigger: Option<RetriggerSpec>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        global_multiplier: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        modifiers: Option<Vec<FsModifier>>,
    },
    HoldAndWin {
        trigger: TriggerByCount,
        respins_initial: u32,
        respin_reset_on_new: bool,
        cash_value_distribution: Vec<CashValueDist>,
        jackpot_tiers: Vec<JackpotTier>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        grid_full_award: Option<String>,
    },
    Cascade {
        replacement: CascadeReplacement,
        max_chain: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        multiplier_progression: Option<Vec<f64>>,
    },
    Respin {
        cost_x: f64,
        max_uses_per_spin: u32,
    },
    Pick {
        prize_pool: Vec<PrizeEntry>,
    },
    Wheel {
        segments: Vec<PrizeEntry>,
    },
    BuyFeature {
        offers: Vec<BuyOffer>,
    },
    AnteBet {
        extra_multiplier: f64,
        enabled_by_default: bool,
    },
    Gamble {
        #[serde(rename = "type")]
        ty: GambleType,
        max_steps: u32,
        tie_resolution: TieResolution,
    },
    MysterySymbol {
        symbol_id: SymbolKey,
        reveal_distribution: BTreeMap<SymbolKey, f64>,
    },
    SymbolUpgrade {
        from: SymbolKey,
        to: SymbolKey,
        probability: f64,
    },
    /// W4.7 — Linear / WAP progressive. Mirrors slot-sim universal IR variant.
    /// IR-only descriptor: actual contribution math handled by `crate::jackpot`.
    LinearProgressive {
        pool_id: String,
        contribution_per_spin_x: f64,
        seed_x: f64,
        /// Optional must-hit-by spin counter (mystery progressive style).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        must_hit_by_x: Option<f64>,
        /// Optional ladder of jackpot tiers (e.g. Mini / Minor / Major / Grand).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tier_ladder: Option<Vec<JackpotTier>>,
        /// External pool link (WAP) — if set, contribution funnels into an
        /// off-game shared pot. None = standalone (linear) progressive.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        external_pool_ref: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GambleType {
    RedBlack,
    Suit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TieResolution {
    House,
    Push,
}

// ─── rng / bet / limits / compliance / rtp_allocation ───────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Rng {
    pub kind: RngKind,
    pub default_seed: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jump_function: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RngKind {
    Mulberry32,
    Pcg64,
    Xoshiro256pp,
    AesCtrDrbg,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnteBet {
    pub enabled: bool,
    pub extra_multiplier: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Bet {
    pub currency: String,
    pub base_bet: f64,
    pub denominations: Vec<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ante_bet: Option<AnteBet>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub buy_feature: Option<Vec<BuyOffer>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WinCapApply {
    PerSpin,
    PerFeatureSession,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Volatility {
    Low,
    Medium,
    High,
    Ultra,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Limits {
    pub target_rtp: f64,
    pub rtp_tolerance: f64,
    pub max_win_x: f64,
    pub win_cap_apply: WinCapApply,
    pub target_volatility: Volatility,
    pub hit_freq_target: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NearMissRule {
    MustBeRandom,
    AllowedWithinDistribution,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Compliance {
    pub jurisdictions: Vec<String>,
    pub rtp_range_required: [f64; 2],
    pub max_win_cap_required: f64,
    pub near_miss_rule: NearMissRule,
    pub ldw_disclosure: bool,
    pub session_time_display: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RtpAllocation {
    pub base_game: f64,
    pub free_spins: f64,
    pub hold_and_win: f64,
    pub jackpot: f64,
    pub tolerance: f64,
}

// ─── W4.7 progressive link (WAP / multi-tier) ─────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProgressiveLink {
    /// External pool identifier (WAP). Shared across multiple SKUs in the same
    /// jurisdiction. `None` ⇒ standalone linear progressive (per-machine seed).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pool_id: Option<String>,
    /// Fraction of every wager funneled into the pot (e.g. 0.005 = 0.5 %).
    pub contribution_per_spin_x: f64,
    /// Seed (top-up value) the pot resets to after a hit, expressed as bet × X.
    pub seed_x: f64,
    /// Optional reset cadence — `Some(spins)` ⇒ "must hit by N spins" mystery
    /// style. `None` ⇒ unconditional / Markov hit logic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub must_hit_by_x: Option<f64>,
    /// Tier ladder for multi-level progressives (e.g. Mini / Minor / Major /
    /// Grand). Empty / `None` ⇒ single-tier linear.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tier_ladder: Option<Vec<JackpotTier>>,
    /// Reset rule for the pot post-hit: "seed_only" (default) | "rollover" |
    /// "cap_reset". Free-form string so jurisdiction-specific words are
    /// preserved verbatim from the PAR sheet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reset_rule: Option<String>,
}

// ─── W4.7 jurisdiction overrides (multi-market) ──────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JurisdictionOverride {
    /// RTP target for THIS jurisdiction (overrides global `limits.target_rtp`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_rtp: Option<f64>,
    /// Max win cap override (e.g. UK £250k, Italy €30k).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_win_x: Option<f64>,
    /// Minimum spin time enforced (e.g. UKGC 2.5 s).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_spin_time_ms: Option<u32>,
    /// Maximum bet cap (e.g. UK B3 £2 since 2019).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_bet_x: Option<f64>,
    /// Feature toggles — `Some(false)` disables the feature in this market
    /// (e.g. "buy_feature" forbidden in UK as of 2025).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feature_toggles: Option<BTreeMap<String, bool>>,
    /// Switch into compensated (Class II / VLT) mode where outcomes are drawn
    /// from a central pool rather than RNG. `None` ⇒ Class III true RNG.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compensated_mode: Option<bool>,
    /// Mandatory loss-disclosure / session-time overlay required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub force_ldw_disclosure: Option<bool>,
    /// Mandatory autoplay disable (e.g. UKGC since Oct 2018).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autoplay_forbidden: Option<bool>,
}

// ─── W4.7 persistent state (cross-spin / cross-session) ──────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PersistentState {
    /// Named state fields the engine must serialize between spins.
    pub fields: Vec<PersistentField>,
    /// Optional finite state machine modelling supermeter / mode transitions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_machine: Option<StateMachine>,
    /// Survival scope — does state cross sessions, or reset on session end?
    pub scope: PersistenceScope,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PersistentField {
    pub name: String,
    pub kind: PersistentFieldKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<f64>,
    /// Reset rule: "never" | "on_session_end" | "on_feature_trigger" | string.
    pub reset_rule: String,
    /// Optional max cap on accumulator-style fields.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_value: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PersistentFieldKind {
    Counter,
    Accumulator,
    Multiplier,
    Boolean,
    Symbol,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PersistenceScope {
    Spin,
    Session,
    Account,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StateMachine {
    pub states: Vec<String>,
    pub initial_state: String,
    /// `[from, to, condition_expr]` triples — condition is free-form DSL parsed
    /// by `crate::evaluator`.
    pub transitions: Vec<StateTransition>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StateTransition {
    pub from: String,
    pub to: String,
    pub condition: String,
}

// ─── W4.7 provenance (cert / audit chain) ─────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Provenance {
    /// Vendor of the source PAR sheet (e.g. "vendor_b", "vendor_a", "igt").
    pub vendor: String,
    /// Path / identifier of the original PAR file.
    pub par_source: String,
    /// SWID (Game ID) of the publishing math sheet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub swid: Option<String>,
    /// SHA-256 of the canonical PAR JSON dump (Merkle-root style).
    pub par_sha256: String,
    /// SHA-256 of the rendered `SlotGameIR` JSON (this very IR after
    /// canonicalization). Reproducible build proof.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ir_sha256: Option<String>,
    /// Build hash of the slot-build tool that produced this IR.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build_hash: Option<String>,
    /// ISO-8601 UTC timestamp of build.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub built_at_utc: Option<String>,
    /// Optional ed25519 signature over `par_sha256||ir_sha256`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signed_by: Option<String>,
    /// Optional signature hex.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

// ─── root ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SlotGameIR {
    pub schema_version: String,
    pub meta: Meta,
    pub topology: Topology,
    pub symbols: Vec<SymbolDef>,
    pub reels: ReelSet,
    pub evaluation: Evaluation,
    pub paytable: Paytable,
    pub features: Vec<Feature>,
    pub rng: Rng,
    pub bet: Bet,
    pub limits: Limits,
    pub compliance: Compliance,
    pub rtp_allocation: RtpAllocation,
    // ─── W4.7 expansion — all optional, additive only ─────────────────────
    /// Linear / WAP progressive descriptor. Closes 30 % of modern games.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progressive_link: Option<ProgressiveLink>,
    /// Per-jurisdiction overrides (UK, Italy, Spain, NL, US, ...). Closes
    /// 100 % of multi-market certification.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jurisdiction_overrides: Option<BTreeMap<String, JurisdictionOverride>>,
    /// Cross-spin / cross-session persistent state (supermeter, bonus bank,
    /// frame upgrade). Closes 20–25 % of modern games.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persistent_state: Option<PersistentState>,
    /// Reproducible-build provenance / cert audit trail.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<Provenance>,
}

impl SlotGameIR {
    /// Parse JSON. Returns serde errors verbatim — no wrapping so callers
    /// can stream them into structured logs.
    pub fn from_json(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }

    /// Serialize to canonical JSON (pretty-printed, stable key order).
    /// BTreeMap fields give us key-stable output for free, which is the
    /// minimum requirement for the byte-level parity comparator.
    pub fn to_json_pretty(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }
}
