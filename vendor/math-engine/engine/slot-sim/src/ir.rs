// Universal IR — single JSON schema for ALL slot game families.
//
// The IR is intentionally a *flat enum union*: every variant
// (Topology::Rectangular vs Topology::Megaways, Evaluation::Lines vs
// Evaluation::Cluster, Feature::HoldAndWin vs Feature::PickBonus etc.) is
// serde-tagged so a single parser can read CE COPY TEST (3×5 paylines +
// hold-and-win + progressive) and Fort Knox Wolf Run (4×5 paylines +
// pick-bonus + linear progressive) **out of the same code path**.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

// ───────────────────────────── TOPOLOGY ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Topology {
    /// Fixed N×M grid (CE COPY TEST: 3×5, Wolf Run: 4×5).
    Rectangular { reels: u32, rows: u32 },
    /// Variable rows per reel (Megaways: 2-7 per reel × 5 reels).
    Megaways {
        reels: u32,
        rows_min: u32,
        rows_max: u32,
        /// Per-reel weighted distribution of row count.
        rows_weights: Vec<Vec<u32>>,
    },
    /// Cluster grid (typically 7×7 or 6×5 for cluster pays games).
    ClusterGrid { width: u32, height: u32 },
}

// ───────────────────────────── EVALUATION ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Evaluation {
    /// Fixed paylines L-to-R (CE: 20 lines, Wolf Run: 40 lines).
    Lines {
        lines: Vec<Vec<Option<u32>>>,
        min_count: u32, // 3 typically
    },
    /// Ways evaluation (Aristocrat 243 / 1024 ways).
    Ways {
        ways: u32, // 243 / 1024 / etc.
        min_count: u32,
    },
    /// Megaways (variable ways per spin = product of per-reel row counts).
    Megaways { min_count: u32 },
    /// Cluster pays (BFS flood-fill, 4-way or 8-way adjacency).
    Cluster {
        min_cluster_size: u32,
        adjacency: ClusterAdjacency,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClusterAdjacency {
    Orthogonal, // 4-way
    Diagonal,   // 8-way
}

// ───────────────────────────── SYMBOLS ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Symbol {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub role: SymbolRole,
    /// For Wild: list of symbols it substitutes for ("*" = all except specials).
    #[serde(default)]
    pub substitutes: Option<Vec<String>>,
    /// For Wild: list of symbols it does NOT substitute (Fireball / Volcano in CE).
    #[serde(default)]
    pub substitutes_except: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SymbolRole {
    #[default]
    Lp,
    Hp,
    Wild,
    Scatter,
    Bonus,
    /// Cash symbol for hold-and-win features (CE Fireball).
    Cash,
    /// Pattern-win anchor (CE Red7).
    Anchor,
    /// Big variant (CE FS Big_X symbols on linked reels).
    Big,
}

// ───────────────────────────── REELS ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReelStop {
    pub symbol: String,
    pub weight: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReelSet {
    /// Identifier used by reel-set picker.
    pub set: i64,
    /// Per-reel ordered list of stop entries (probabilistic reel model).
    pub reels: Vec<Vec<ReelStop>>,
    /// Optional human-readable label.
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReelSetWeight {
    pub set: i64,
    pub weight: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReelSetWeights {
    pub weights: Vec<ReelSetWeight>,
    pub total: i64,
    #[serde(default)]
    pub initial_set: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReelBank {
    /// Base-game reel sets.
    pub base: Vec<ReelSet>,
    pub base_weights: ReelSetWeights,
    /// Free-spins reel sets (optional — present only if FS feature exists).
    #[serde(default)]
    pub fs: Vec<ReelSet>,
    #[serde(default)]
    pub fs_weights: Option<ReelSetWeights>,
}

// ───────────────────────────── PAYTABLE ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaytableEntry {
    /// Combo cells (e.g. ["Red7","Red7","Red7","Red7","Red7"] or ["Any 5 Volcano"]).
    pub combo: Vec<String>,
    /// Pay (in coins per line or per-occurrence; semantics per `scope`).
    pub pays: f64,
    /// Scope: "line" (per payline) | "scatter" (× total bet, per grid) | "pattern" (replaces line wins).
    #[serde(default = "default_scope")]
    pub scope: String,
    /// Optional marker (e.g. "*" or "**") from PAR sheet.
    #[serde(default)]
    pub marker: String,
}

fn default_scope() -> String {
    "line".to_string()
}

/// W4.9d — `Feature::WildExpand.subset_search` defaults to true so legacy
/// IRs (pre-W4.9d) keep the W4.9b subset-MAX behavior.
fn default_true() -> bool {
    true
}

// ───────────────────────────── FEATURES ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Feature {
    /// CE-style hold-and-win: 6+ cash symbols → 3 respins, coin distribution per BM page.
    ///
    /// W4.5 added two convenience fields for RTP-only integration that
    /// sidesteps the full per-page Cash Eruption math:
    ///   * `trigger_prob` — Bernoulli per-spin trigger override (like
    ///     PickBonus). When `None`, falls back to cash-count threshold.
    ///   * `avg_pay_per_trigger` — total-bet-× average pay when fired.
    ///     When `Some`, runner pays the deterministic average instead of
    ///     sampling pages; gives correct mean RTP at the cost of
    ///     volatility fidelity until full pages mapping lands in W4.6.
    HoldAndWin {
        trigger_symbol: String,
        trigger_count_min: u32,
        respins: u32,
        // Per-bet-multiplier coin-value distributions (CE 21 pages).
        pages: BTreeMap<String, HoldAndWinPage>,
        #[serde(default)]
        trigger_prob: Option<f64>,
        #[serde(default)]
        avg_pay_per_trigger: Option<f64>,
        /// W4.8 — FS-spin trigger probability (when CE fires inside FS).
        /// In CE the linked block dumps ~9 Big Fireball almost every FS
        /// spin so this can be near-1.0 while the base trigger stays
        /// ~0.7 %.
        #[serde(default)]
        fs_trigger_prob: Option<f64>,
        #[serde(default)]
        fs_avg_pay_per_trigger: Option<f64>,
        /// W4.16 — units contract for `avg_pay_per_trigger` (flat path):
        ///   * `"total_bet_x"` (default) — payout is in total-bet-×
        ///     units; the engine multiplies by `lines` so the
        ///     subsequent `feat.coins / lines` divide-back yields the
        ///     correct total-bet-× contribution.
        ///   * `"coin"` — payout is in raw coin units; the engine does
        ///     NOT multiply by `lines` (one coin = one credit). This
        ///     keeps Fort Knox Wolf Run's coin-units `avg_pay_per_trigger`
        ///     from over-paying 5–7× when the engine accidentally
        ///     applied the `lines` factor.
        ///
        /// When `None`, defaults to `"total_bet_x"` so legacy IRs that
        /// already encoded their `avg_pay_per_trigger` in total-bet-×
        /// keep their semantics. The FKWR builder explicitly sets
        /// `"total_bet_x"` after rescaling, and any future game that
        /// wants coin-unit payouts can flip the field.
        #[serde(default)]
        units: Option<String>,
        /// W4.17 — Per-FS-context pages-sampling map (CE FS-CE
        /// structural cleanup). Mirrors the base-game `pages` schema
        /// but is scoped to the FS bank. When `Some` and non-empty,
        /// the FS-CE pay path uses pages-sampling (Big Fireball block
        /// → initial BIG draw + respin loop) instead of the flat
        /// `fs_avg_pay_per_trigger`. The CE builder emits the same
        /// BM=1 page as `pages` (Big Fireball / Small Fireball coin
        /// distributions are shared with the base trigger).
        #[serde(default)]
        fs_haw_pages: BTreeMap<String, HoldAndWinPage>,
        /// W4.17 — Typed FS Big-Fireball trigger contract. CE's FS
        /// uses linked reels 2/3/4 where one stop produces a 3×3 Big
        /// Fireball block on the middle row. When `Some`, the FS
        /// runner detects block landings by counting cells of the
        /// configured symbol on the grid (`count_min` cells required
        /// to trigger). For CE: `{ symbol: "Big Fireball", count_min:
        /// 3 }` — one block = 3 cells × 1 column on the middle reel
        /// at the linked stop.
        #[serde(default)]
        fs_big_fireball_trigger: Option<FsBigFireballTrigger>,
    },
    /// Wolf Run-style pick-bonus.
    ///
    /// Two trigger modes supported (W4.3c):
    ///   ▸ **Scatter-based** (default): when `trigger_prob` is `None`, fires
    ///     when `trigger_symbol` count on the grid ≥ `trigger_count_min`.
    ///   ▸ **Bernoulli-based**: when `trigger_prob` is `Some(p)`, fires with
    ///     probability `p` on every spin regardless of scatter count. Used by
    ///     IGT Fort Knox Bonus where the trigger is drawn from a published
    ///     trigger weight table (e.g. Yes=670005 / Total=100M ⇒ p=0.00670).
    PickBonus {
        trigger_symbol: String,
        trigger_count_min: u32,
        // Award Table: each entry has weight + pay (in coins or total-bet multiples).
        awards: Vec<PickAward>,
        /// W4.3c — Bernoulli trigger probability. When `Some`, overrides the
        /// scatter-count trigger; when `None`, falls back to scatter logic.
        #[serde(default)]
        trigger_prob: Option<f64>,
    },
    /// Free spins: N+ scatter → K free spins, optional retrigger, optional reel-set swap.
    FreeSpins {
        trigger_symbol: String,
        trigger_count_min: u32,
        initial_spins: u32,
        retrigger_spins: u32,
        max_total_spins: Option<u32>,
        reel_bank: String, // "fs" typically — references ReelBank.fs
        // Linked-block configuration (CE has reels 2/3/4 linked).
        #[serde(default)]
        linked_reels: Option<Vec<u32>>,
        /// W4.9b — retrigger detection uses a separate symbol when the FS
        /// reel strip swaps to Big_X family (L&W CE: base trigger Volcano,
        /// FS retrigger Big Volcano). Falls back to `trigger_symbol` when
        /// `None`.
        #[serde(default)]
        retrigger_symbol: Option<String>,
        #[serde(default)]
        retrigger_count_min: Option<u32>,
        /// W4.7 — Optional FS-specific paytable override. When `Some`,
        /// the runner compiles a separate `CompiledPaytable` and uses
        /// it for line/scatter eval inside FS spins instead of falling
        /// back to the base-game paytable. L&W publishes a distinct
        /// `fs_paytable` (different pays for the same combos) for the
        /// CE COPY TEST family.
        #[serde(default)]
        fs_paytable: Option<Vec<PaytableEntry>>,
        /// W4.3e-scatter — Immediate scatter pay on FS trigger
        /// (multiplier of TOTAL BET). IGT Fort Knox Wolf Run publishes
        /// this as "2*" in the paytable Pays column: "Three Bonus
        /// symbols on middle reels pay 2x total bet AND initiate Bonus
        /// with 5 bonus spins". When non-zero, the engine adds
        /// `scatter_pay_total_bet × total_bet` to the trigger spin
        /// payout in addition to running the FS session.
        #[serde(default)]
        scatter_pay_total_bet: f64,
    },
    /// Wild expansion on specific reels when wild lands.
    WildExpand {
        wild_symbol: String,
        on_reels: Vec<u32>,
        /// Only expand if it produces a winning combination.
        only_if_winning: bool,
        /// W4.9d — Restrict expansion to spins where base grid has NO
        /// line wins (closer interpretation of L&W CE "expansion fires
        /// only when it results in a winning combo" rule). Default
        /// false to preserve W4.9b.
        #[serde(default)]
        expand_only_when_base_no_win: bool,
        /// W4.9d — true (default): subset-MAX search over all 2^n−1
        /// expansion subsets and keep the delta-maximizing one.
        /// false: deterministic "expand ALL eligible reels" (L&W
        /// canonical behavior — every Wild expands when fired).
        #[serde(default = "default_true")]
        subset_search: bool,
    },
    /// Pattern win: 3 anchor symbols on reel 0 + wild expansion on reels 1..4.
    PatternWin {
        anchor_symbol: String,
        anchor_count: u32,
        anchor_reel: u32,
        required_wild_reels: Vec<u32>,
        pays: f64,
    },
    /// Linear-scaling progressive jackpot (Wolf Run style).
    LinearProgressive {
        /// 1-in-N at bet multiplier 1 (e.g. 7,500,000 for Wolf Run).
        odds_at_bm1: f64,
        /// Top award (in coins or as "Progressive" marker).
        top_award_coins: Option<i64>,
        /// W4.3e — per-spin deterministic increment contribution
        /// (fraction of total bet that funds the jackpot pool, e.g. 0.003
        /// for Wolf Run). Excel publishes this in the bet-table
        /// "Increment" column. Engine adds this contribution every spin
        /// so universal IR ↔ Excel RTP convergence is preserved.
        #[serde(default)]
        increment: f64,
    },
    /// Probabilistic GRAND prize (CE style).
    GrandPrize {
        /// P(grand per CE trigger) — context-dependent for base vs FS.
        prob_base: f64,
        prob_fs: f64,
        award_coins: i64,
    },
    /// W4.8d — IGT Skeleton Key Mystery Symbol: when a Mystery cell
    /// lands on the grid, ONE target symbol is sampled from the active
    /// reel set's distribution and ALL Mystery cells on the grid are
    /// replaced with that target (PAR-Base row 1004 + 1010/1025
    /// distribution blocks).
    MysteryTransform {
        trigger_symbol: String,
        /// Per-base-reel-set target distribution keyed by stringified
        /// set id (matches `ReelSetWeight.set`).
        per_set_distributions: BTreeMap<String, Vec<MysteryTarget>>,
        /// Per-FS-reel-set target distribution (optional; falls back to
        /// `per_set_distributions` when missing).
        #[serde(default)]
        fs_per_set_distributions: BTreeMap<String, Vec<MysteryTarget>>,
    },
}

/// W4.17 — Typed FS Big-Fireball trigger contract (CE FS-CE).
///
/// Encodes the per-FS-spin condition that fires the pages-sampling
/// FS-CE path. Two fields:
///   * `symbol` — the cell value to look for on the FS grid (e.g.
///     "Big Fireball"). The FS runner counts occurrences via the
///     standard `role_counts` map (the symbol must have `role ==
///     SymbolRole::Cash` to be tallied).
///   * `count_min` — minimum cells of `symbol` required to consider a
///     trigger. CE's linked block puts the same symbol on 3 cells of
///     the middle reel (rows 0/1/2 at the linked stop), so 3 is the
///     canonical threshold. Block count derived as `floor(cells /
///     count_min)`; each block = one initial BIG draw.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FsBigFireballTrigger {
    pub symbol: String,
    pub count_min: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysteryTarget {
    pub symbol: String,
    pub weight: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HoldAndWinPage {
    pub bet_multiplier: i64,
    pub set_pool_weights: SetPoolWeights,
    pub small_coin_dist: Vec<CoinValue>,
    pub big_coin_dist: Vec<CoinValue>,
    /// Legacy single-side pots map (pre-W4.16). When `pots_small` and
    /// `pots_big` are absent the engine uses `pots` for both sides.
    #[serde(default)]
    pub pots: BTreeMap<String, Pot>,
    /// W4.16 — small-side MINI/MINOR/MAJOR pot weights (CE's Small
    /// Fireballs distribution puts MINI/MINOR/MAJOR alongside the coin
    /// values; weights are pool-specific).
    #[serde(default)]
    pub pots_small: BTreeMap<String, Pot>,
    /// W4.16 — big-side MINI/MINOR/MAJOR pot weights (CE's Big Fireball
    /// distribution carries a different MINI/MINOR/MAJOR weight set;
    /// FS-only path uses this side).
    #[serde(default)]
    pub pots_big: BTreeMap<String, Pot>,
    /// W4.16 — GRAND top-award probability when feature triggers from
    /// base game (Bernoulli draw before the respin loop; on hit the
    /// feature pays `top_award` coins). When absent / 0.0, no GRAND
    /// gate is applied. Lives at the page level because CE published
    /// it per-bet-multiplier in the PAR sheet.
    #[serde(default)]
    pub grand_prob_base: Option<f64>,
    /// W4.16 — GRAND probability for FS-triggered CE.
    #[serde(default)]
    pub grand_prob_fs: Option<f64>,
    /// W4.16 — Top award (coins) paid when GRAND fires.
    #[serde(default)]
    pub top_award: Option<i64>,
    /// W4.16 — FS-only initial samples (block-trigger model). When set,
    /// the FS path samples this many initial Fireballs from the BIG
    /// distribution on FS-CE trigger (CE COPY TEST encodes this as
    /// 1 block ⇒ 1 BIG sample, with `initial_landed` set to 9 for
    /// respin-table lookup since one Big Fireball covers a 3×3 sub-grid).
    #[serde(default)]
    pub fs_initial_samples: Option<u32>,
    #[serde(default)]
    pub fs_initial_landed: Option<u32>,
    // (n_landed_str) → (remaining_str) → (n_additional_str) → weight
    pub respin_tables: BTreeMap<String, BTreeMap<String, BTreeMap<String, i64>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetPoolWeights {
    pub low: i64,
    pub med: i64,
    pub high: i64,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoinValue {
    pub coin_value: i64,
    pub low: i64,
    pub med: i64,
    pub high: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pot {
    pub value: i64,
    pub low: i64,
    pub med: i64,
    pub high: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PickAward {
    pub label: String,
    pub weight: i64,
    pub pays_coins: f64,
}

// ───────────────────────────── BET TABLE ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BetTable {
    pub lines: u32,
    pub multipliers: Vec<i64>,
    pub total_bets: Vec<f64>,
}

// ───────────────────────────── META ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Meta {
    pub name: String,
    pub vendor: String,
    pub swid: String,
    #[serde(default)]
    pub family: String, // "paylines" | "ways" | "megaways" | "cluster"
    pub rtp_total: f64,
    #[serde(default)]
    pub rtp_breakdown: BTreeMap<String, f64>,
    pub hit_frequency: f64,
    pub win_frequency: f64,
    #[serde(default)]
    pub notes: Vec<String>,
    /// W4.3d — sampling mode override.
    ///   * `Some("virtual_independent")` — per-cell independent sample
    ///     from a weighted per-reel strip (IGT virtual-reel model).
    ///   * `Some("physical_strip")` (default) — adjacent-row sampling
    ///     from a physical strip with `visible()` window (L&W model).
    ///   * `None` — defaults to `physical_strip`.
    #[serde(default)]
    pub sampling_mode: Option<String>,
    /// W4.8e / W4.10e — RTP source override.
    ///
    /// Some IGT PAR sheets (Skeleton Key Megaways, Fortune Coin Boost
    /// Classic) publish the per-spin RTP contribution of cascade /
    /// Reel-Expansion features as fixed breakdown shares
    /// (`base_game_multiway`, `base_game`, `free_spins_multiway`, …)
    /// without exposing the underlying step-by-step generative mechanic
    /// in the sheet itself. The breakdown values are the regulator
    /// ground truth.
    ///
    /// When this field is `Some("breakdown")` the engine treats those
    /// breakdown shares as the deterministic per-spin / per-FS-trigger
    /// payout, suppressing the live MC multiway pay-out (which would
    /// otherwise undershoot or overshoot the published RTP because
    /// cascade / symbol-replacement detail is missing from the PAR
    /// sheet). The grid is still spun stochastically so hit / win
    /// frequencies stay realistic.
    ///
    /// When `None` (default) the engine continues to use the live MC
    /// multiway pay-out plus any deterministic adders wired in
    /// `run_ways_cascade` (Coin / Boost jackpot share).
    #[serde(default)]
    pub rtp_source: Option<String>,
    /// W4.14 — When `true`, the engine counts any spin whose grid
    /// contains ≥ 1 symbol with `role == "cash"` as a HIT for hit-
    /// frequency accounting (without altering RTP). IGT Fortune Coin
    /// Boost Classic publishes hit_frequency including Coin / Coin
    /// Boost landings (because every Coin pays a credit-bonus), so
    /// the engine must mirror that to converge to vendor hit_freq.
    /// Default `false` so CE / FKWR / SK behavior is unchanged.
    #[serde(default)]
    pub cash_counts_as_hit: bool,
}

// ───────────────────────────── ROOT IR ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ir {
    pub meta: Meta,
    pub topology: Topology,
    pub evaluation: Evaluation,
    pub symbols: Vec<Symbol>,
    pub reels: ReelBank,
    pub paytable: Vec<PaytableEntry>,
    #[serde(default)]
    pub features: Vec<Feature>,
    pub bet_table: BetTable,
}

impl Ir {
    pub fn load(path: impl AsRef<Path>) -> std::io::Result<Self> {
        let bytes = std::fs::read(path)?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn find_symbol(&self, id: &str) -> Option<&Symbol> {
        self.symbols.iter().find(|s| s.id == id)
    }
}
