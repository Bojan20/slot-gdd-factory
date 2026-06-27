//! IR → GameConfig Adapter (Faza 1.2)
//!
//! Converts a validated `SlotGameIR` into the `GameConfig` the Monte Carlo
//! engine consumes. This is the single bridge between the canonical
//! intermediate representation and the legacy engine types.
//!
//! Design invariants:
//!   - Start from `GameConfig::default()` and override every field the IR
//!     defines. Fields not covered by IR keep the default (safe fallback).
//!   - No hardcoded `5` or `3` for grid dimensions — all sizing comes from
//!     `ir.topology`.
//!   - Weight conversion: `(f64 × 10_000).round() as u32` so fractional
//!     weights round-trip with four decimal places of precision.
//!   - `AdapterError` variants are structured so callers can surface them
//!     as user-readable config loading failures.

use crate::config::{
    AnteBetConfig, BuyFeatureConfig, BuyFeatureOffer, CascadeConfig,
    CascadeReplacement as RtCascadeReplacement, FreeSpinsConfig, GambleConfig,
    GambleTieResolution as RtGambleTieResolution, GambleType as RtGambleType, GameConfig,
    HoldAndWinConfig, MysteryConfig, OrbValue, PayEntry, PickConfig, PrizeSlot, ReelWeight,
    RespinConfig, SymbolDef, SymbolUpgradeConfig, WheelConfig,
};
use crate::ir::{
    BuyOffer, CascadeReplacement as IrCascadeReplacement, Evaluation, Feature, GambleType,
    PrizeEntry, ReelSet, SlotGameIR, SymbolKind, TieResolution, Topology, TriggerBy,
};
use std::collections::{BTreeMap, HashMap};

// ─── Error type ────────────────────────────────────────────────────────────

/// Errors that can occur when converting IR → GameConfig.
#[derive(Debug, Clone, PartialEq)]
pub enum AdapterError {
    /// The topology kind is not yet supported by the engine.
    UnsupportedTopology(String),
    /// The evaluation kind is not supported in the requested context.
    UnsupportedEvaluation(String),
    /// A reel was expected to have symbol weights but the map was empty.
    MissingWeights { reel: usize },
}

impl std::fmt::Display for AdapterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AdapterError::UnsupportedTopology(s) => {
                write!(f, "unsupported topology: {s}")
            }
            AdapterError::UnsupportedEvaluation(s) => {
                write!(f, "unsupported evaluation: {s}")
            }
            AdapterError::MissingWeights { reel } => {
                write!(f, "reel {reel} has no symbol weights")
            }
        }
    }
}

impl std::error::Error for AdapterError {}

// ─── Weight constant ───────────────────────────────────────────────────────

/// Scale factor for converting `f64` weights to `u32`.
/// Four decimal places: 0.0001 → 1, 1.0 → 10_000.
const WEIGHT_SCALE: f64 = 10_000.0;

#[inline]
fn f64_to_weight(v: f64) -> u32 {
    (v * WEIGHT_SCALE).round() as u32
}

// ─── Public entry point ────────────────────────────────────────────────────

/// Convert a fully-validated `SlotGameIR` into a `GameConfig`.
///
/// Call `cross_validate` on the IR before this function — this adapter
/// trusts that symbol references are valid and topology/evaluation are
/// coherent. It performs no additional semantic checks.
pub fn ir_to_game_config(ir: &SlotGameIR) -> Result<GameConfig, AdapterError> {
    let mut cfg = GameConfig::default();

    // ── Meta ───────────────────────────────────────────────────────────
    cfg.name = ir.meta.name.clone();
    cfg.version = ir.meta.version.clone();
    cfg.target_rtp = ir.limits.target_rtp * 100.0; // IR stores 0.96, GameConfig wants 96.0
    cfg.max_win_cap = ir.limits.max_win_x;

    // ── Topology → grid dimensions ──────────────────────────────────────
    let (reels, rows) = topology_to_dims(&ir.topology)?;
    cfg.reels = reels as u8;
    cfg.rows = rows as u8;

    // ── Symbols ────────────────────────────────────────────────────────
    cfg.symbols = convert_symbols(ir);

    // ── Reels (base weights + optional FS weights) ─────────────────────
    let (base_weights, fs_weights) = convert_reels(ir, &cfg.symbols)?;
    cfg.base_weights = base_weights;
    cfg.fs_weights = fs_weights;

    // ── Paylines / evaluation mode ─────────────────────────────────────
    cfg.paylines = convert_paylines(ir, reels, rows)?;

    // ── Paytable ───────────────────────────────────────────────────────
    cfg.paytable = convert_paytable(ir);

    // ── Features ───────────────────────────────────────────────────────
    convert_features(ir, &mut cfg);

    // ── W152 Faza 2.4 — Pattern evaluation extraction ──────────────────
    // The IR carries pattern rules on `evaluation.kind === "pattern"`,
    // NOT on `features[]`. Extract them into `cfg.pattern` so the
    // evaluator factory can construct `EvalMode::Pattern { rules }`.
    cfg.pattern = convert_pattern_to_config(&ir.evaluation);

    Ok(cfg)
}

// ─── Topology ──────────────────────────────────────────────────────────────

/// Extract `(reels, rows)` from topology.
/// `VariableRows` uses the *maximum* row count across all reels (rectangular
/// envelope — the engine can be told per-reel rows in Faza 2).
fn topology_to_dims(topology: &Topology) -> Result<(usize, usize), AdapterError> {
    match topology {
        Topology::Rectangular { reels, rows } => Ok((*reels as usize, *rows as usize)),

        Topology::VariableRows {
            reels,
            row_range_per_reel,
            ..
        } => {
            // Max row across all reels gives the rectangular envelope.
            let max_rows = row_range_per_reel
                .iter()
                .map(|range| range[1] as usize)
                .max()
                .unwrap_or(3);
            Ok((*reels as usize, max_rows))
        }

        Topology::ClusterGrid { columns, rows, .. } => {
            // Cluster grids: columns → reels, rows → rows.
            // Cluster evaluation uses its own path (empty paylines).
            Ok((*columns as usize, *rows as usize))
        }
    }
}

// ─── Symbols ───────────────────────────────────────────────────────────────

fn convert_symbols(ir: &SlotGameIR) -> Vec<SymbolDef> {
    ir.symbols
        .iter()
        .map(|s| {
            let (is_wild, is_scatter, is_bonus) = map_symbol_kind(s.kind);
            SymbolDef {
                id: s.id.clone(),
                name: s.name.clone(),
                is_wild,
                is_scatter,
                is_bonus,
                is_mystery: false,
            is_coin_boost: false,
            }
        })
        .collect()
}

/// Map `SymbolKind` → `(is_wild, is_scatter, is_bonus)`.
///
/// Mapping table (from spec):
/// - Wild | ChainWild | Expanding → is_wild
/// - Scatter                      → is_scatter
/// - Bonus                        → is_bonus
/// - Lp | Hp | Multiplier | Sticky | Mystery | Transform → all false
#[inline]
fn map_symbol_kind(kind: SymbolKind) -> (bool, bool, bool) {
    match kind {
        SymbolKind::Wild | SymbolKind::ChainWild | SymbolKind::Expanding => (true, false, false),
        SymbolKind::Scatter => (false, true, false),
        SymbolKind::Bonus => (false, false, true),
        SymbolKind::Lp
        | SymbolKind::Hp
        | SymbolKind::Multiplier
        | SymbolKind::Sticky
        | SymbolKind::Mystery
        | SymbolKind::Transform => (false, false, false),
    }
}

// ─── Reels ─────────────────────────────────────────────────────────────────

fn convert_reels(
    ir: &SlotGameIR,
    symbols: &[SymbolDef],
) -> Result<(Vec<Vec<ReelWeight>>, Vec<Vec<ReelWeight>>), AdapterError> {
    // Build a symbol-id → index lookup (O(n) construction, O(1) lookup).
    let sym_index: HashMap<&str, usize> = symbols
        .iter()
        .enumerate()
        .map(|(i, s)| (s.id.as_str(), i))
        .collect();

    match &ir.reels {
        ReelSet::Weighted { base, free_spins } => {
            let base_weights = weighted_map_to_reel_weights(base, &sym_index)?;
            let fs_weights = if let Some(fs) = free_spins {
                weighted_map_to_reel_weights(fs, &sym_index)?
            } else {
                // No FS reels specified — clone base reels as fallback.
                base_weights.clone()
            };
            Ok((base_weights, fs_weights))
        }

        ReelSet::Strips { base, free_spins } => {
            let base_weights = strips_to_reel_weights(base, &sym_index)?;
            let fs_weights = if let Some(fs) = free_spins {
                strips_to_reel_weights(fs, &sym_index)?
            } else {
                base_weights.clone()
            };
            Ok((base_weights, fs_weights))
        }
    }
}

/// Convert `Vec<BTreeMap<SymbolKey, f64>>` (weighted mode) into
/// `Vec<Vec<ReelWeight>>`.
fn weighted_map_to_reel_weights(
    reels: &[std::collections::BTreeMap<String, f64>],
    sym_index: &HashMap<&str, usize>,
) -> Result<Vec<Vec<ReelWeight>>, AdapterError> {
    reels
        .iter()
        .enumerate()
        .map(|(reel_idx, map)| {
            if map.is_empty() {
                return Err(AdapterError::MissingWeights { reel: reel_idx });
            }
            let weights: Vec<ReelWeight> = map
                .iter()
                .filter_map(|(sym_id, &raw_weight)| {
                    // Unknown symbols are silently skipped — cross_validate
                    // catches them before the adapter is called.
                    sym_index.get(sym_id.as_str()).map(|_| ReelWeight {
                        symbol: sym_id.clone(),
                        weight: f64_to_weight(raw_weight),
                    })
                })
                .collect();
            if weights.is_empty() {
                Err(AdapterError::MissingWeights { reel: reel_idx })
            } else {
                Ok(weights)
            }
        })
        .collect()
}

/// Convert `Vec<Vec<SymbolKey>>` (strips mode) into count-based weights.
/// Each symbol's weight = number of times it appears in the strip.
fn strips_to_reel_weights(
    reels: &[Vec<String>],
    sym_index: &HashMap<&str, usize>,
) -> Result<Vec<Vec<ReelWeight>>, AdapterError> {
    reels
        .iter()
        .enumerate()
        .map(|(reel_idx, strip)| {
            if strip.is_empty() {
                return Err(AdapterError::MissingWeights { reel: reel_idx });
            }
            // Count appearances.
            let mut counts: std::collections::BTreeMap<&str, u32> =
                std::collections::BTreeMap::new();
            for sym_id in strip {
                if sym_index.contains_key(sym_id.as_str()) {
                    *counts.entry(sym_id.as_str()).or_insert(0) += 1;
                }
            }
            if counts.is_empty() {
                return Err(AdapterError::MissingWeights { reel: reel_idx });
            }
            let weights: Vec<ReelWeight> = counts
                .into_iter()
                .map(|(sym_id, count)| ReelWeight {
                    symbol: sym_id.to_string(),
                    weight: count,
                })
                .collect();
            Ok(weights)
        })
        .collect()
}

// ─── Paylines ──────────────────────────────────────────────────────────────

/// Convert IR evaluation into GameConfig paylines.
///
/// - `Lines`      → use the payline array directly (cast u32 → u8).
/// - `Ways`       → generate synthetic paylines: one per combination of
///                  (reel0_row, reel1_row, …, reelN_row). The engine flags
///                  this as Ways mode via a conventionally-empty payline vec
///                  together with the `EvalMode` path (Faza 1.3 extension).
///                  For the base GameConfig we emit `rows^reels` paylines so
///                  the legacy Lines path degrades gracefully.
/// - `Cluster` / `PayAnywhere` → empty paylines (dedicated evaluator path).
/// - `Pattern`    → not supported via paylines, returns error.
fn convert_paylines(
    ir: &SlotGameIR,
    reels: usize,
    rows: usize,
) -> Result<Vec<Vec<u8>>, AdapterError> {
    match &ir.evaluation {
        Evaluation::Lines { paylines, .. } => {
            let converted: Vec<Vec<u8>> = paylines
                .iter()
                .map(|pl| pl.iter().map(|&r| r as u8).collect())
                .collect();
            Ok(converted)
        }

        Evaluation::Ways { .. } => {
            // Generate all-ways synthetic paylines: every combination of rows
            // across reels.  For 5 reels × 3 rows that is 3^5 = 243 paylines.
            // Each payline[reel] = row index; we enumerate them in
            // lexicographic order.
            let total = rows.pow(reels as u32);
            let mut paylines: Vec<Vec<u8>> = Vec::with_capacity(total);
            for combo in 0..total {
                let mut pl = vec![0u8; reels];
                let mut rem = combo;
                for reel in (0..reels).rev() {
                    pl[reel] = (rem % rows) as u8;
                    rem /= rows;
                }
                paylines.push(pl);
            }
            Ok(paylines)
        }

        Evaluation::Cluster { .. } | Evaluation::PayAnywhere { .. } => {
            // These modes use their own evaluator path — paylines are unused.
            Ok(vec![])
        }

        Evaluation::Pattern { .. } => {
            // W152 Faza 2.4 — Pattern evaluation runs through
            // `EvalMode::Pattern`; classical paylines are unused. The
            // pattern rules themselves are extracted by
            // `convert_pattern_to_config` into `cfg.pattern`.
            Ok(vec![])
        }
    }
}

// ─── Paytable ──────────────────────────────────────────────────────────────

/// Convert IR paytable into `HashMap<String, PayEntry>`.
///
/// Accepted key formats per evaluation kind:
/// - Lines / Ways: numeric count keys ("3", "4", "5" or "3+", "4+", "5+").
/// - Cluster:      numeric cluster-size keys ("5", "6", … "12+").
///
/// The adapter reads `pay3`, `pay4`, `pay5` from the minimum numeric key
/// values "3"/"3+", "4"/"4+", "5"/"5+".  Keys not matching those patterns
/// contribute nothing (e.g., "6" for a Lines config is silently ignored).
fn convert_paytable(ir: &SlotGameIR) -> HashMap<String, PayEntry> {
    let mut out = HashMap::with_capacity(ir.paytable.len());

    for (sym_id, count_map) in &ir.paytable {
        let mut entry = PayEntry::default();

        for (key, &val) in count_map {
            // Strip trailing "+" for "3+"-style keys.
            let numeric: &str = key.trim_end_matches('+');
            match numeric {
                "3" => entry.pay3 = val,
                "4" => entry.pay4 = val,
                "5" => entry.pay5 = val,
                _ => {
                    // Higher counts (6, 7, … "12+") used in Cluster mode:
                    // the cluster evaluator reads them directly from the IR;
                    // PayEntry only holds the three standard counts for Lines.
                    // Ignore here — no data lost because the cluster evaluator
                    // references the full IR map directly.
                }
            }
        }

        out.insert(sym_id.clone(), entry);
    }

    out
}

// ─── W152 Faza 2.4 — Pattern evaluator extraction ─────────────────────────
//
// The IR's `Evaluation::Pattern { patterns }` carries an array of pattern
// rules. We materialise them as a `PatternConfig` so the engine can pick
// the right `EvalMode` at construction time without re-parsing the IR.
//
// Pattern positions can be either:
// - `PatternPositions::List([row, reel], ...)` — explicit cell list.
// - `PatternPositions::All("all")` — every grid cell must match.
//
// The "all" form is expanded to the rectangular envelope `(0..rows) ×
// (0..reels)` so the evaluator can iterate it uniformly. The expansion
// must use the *adapter-known* grid dimensions; that's why this helper
// takes the topology dims as a parameter rather than re-reading them.

fn convert_pattern_to_config(evaluation: &Evaluation) -> Option<crate::config::PatternConfig> {
    let patterns = match evaluation {
        Evaluation::Pattern { patterns } => patterns,
        _ => return None,
    };
    if patterns.is_empty() {
        // An empty pattern list is not the same as "no pattern feature":
        // it would force the engine into Pattern mode with zero rules,
        // which always pays zero. We surface it explicitly as
        // `Some(empty)` so downstream tooling can flag it (vs `None`,
        // which means "this game doesn't use pattern evaluation").
        return Some(crate::config::PatternConfig { rules: Vec::new() });
    }

    let rules = patterns
        .iter()
        .map(|p| {
            let positions: Vec<[u32; 2]> = match &p.positions {
                crate::ir::PatternPositions::List(list) => list.clone(),
                crate::ir::PatternPositions::All(_) => {
                    // "all" expands at evaluator construction time —
                    // store the marker as an empty list so the engine
                    // knows to fan it out. Callers MUST check for the
                    // empty-positions sentinel and rebuild against
                    // current grid dims; mixed lists + sentinel are
                    // intentionally rejected by IR validation.
                    Vec::new()
                }
            };
            crate::config::PatternRuleConfig {
                id: p.id.clone(),
                positions,
                pay_multiplier: p.pay_multiplier,
            }
        })
        .collect();

    Some(crate::config::PatternConfig { rules })
}

// ─── Features ──────────────────────────────────────────────────────────────

fn convert_features(ir: &SlotGameIR, cfg: &mut GameConfig) {
    for feature in &ir.features {
        match feature {
            Feature::FreeSpins {
                trigger,
                global_multiplier,
                retrigger,
                ..
            } => {
                cfg.free_spins = convert_free_spins(trigger, *global_multiplier, retrigger);
            }

            Feature::HoldAndWin {
                trigger,
                respins_initial,
                cash_value_distribution,
                jackpot_tiers,
                grid_full_award,
                ..
            } => {
                cfg.hold_and_win = convert_hold_and_win(
                    trigger,
                    *respins_initial,
                    cash_value_distribution,
                    jackpot_tiers,
                    grid_full_award,
                );
            }

            // W152 P0-3 — Cascade (drop / refill / fixed-strip avalanche).
            Feature::Cascade {
                replacement,
                max_chain,
                multiplier_progression,
            } => {
                cfg.cascade = Some(convert_cascade(replacement, *max_chain, multiplier_progression));
            }

            // W152 P0-3 — Respin (paid extra spin on the existing grid).
            Feature::Respin {
                cost_x,
                max_uses_per_spin,
            } => {
                cfg.respin = Some(convert_respin(*cost_x, *max_uses_per_spin));
            }

            // W152 P0-3 — MysterySymbol (placeholder that reveals as a
            // weighted real symbol after the spin).
            Feature::MysterySymbol {
                symbol_id,
                reveal_distribution,
            } => {
                cfg.mystery = Some(convert_mystery(symbol_id, reveal_distribution));
            }

            // W152 P0-3 round 2 — Pick bonus (weighted pool draw).
            Feature::Pick { prize_pool } => {
                cfg.pick = Some(convert_pick(prize_pool));
            }

            // W152 P0-3 round 2 — Wheel bonus (single weighted spin).
            Feature::Wheel { segments } => {
                cfg.wheel = Some(convert_wheel(segments));
            }

            // W152 P0-3 round 2 — BuyFeature bonus-buy menu.
            // NOTE: jurisdiction enforcement (UKGC SI 2025/215, NL KSA May 2024,
            // DE GGL, DK SP) happens in `jurisdiction::validate`, not here —
            // the IR carries the offers verbatim so cross-market replay works.
            Feature::BuyFeature { offers } => {
                cfg.buy_feature = Some(convert_buy_feature(offers));
            }

            // W152 P0-3 round 2 — AnteBet stake modifier.
            Feature::AnteBet {
                extra_multiplier,
                enabled_by_default,
            } => {
                cfg.ante_bet = Some(convert_ante_bet(*extra_multiplier, *enabled_by_default));
            }

            // W152 P0-3 round 2 — Gamble post-win double-up
            // (jurisdiction-gated, see UKGC RTS 14D / KIMI 01 §3.9).
            Feature::Gamble {
                ty,
                max_steps,
                tie_resolution,
            } => {
                cfg.gamble = Some(convert_gamble(*ty, *max_steps, *tie_resolution));
            }

            // W152 P0-3 round 2 — SymbolUpgrade transform.
            Feature::SymbolUpgrade {
                from,
                to,
                probability,
            } => {
                cfg.symbol_upgrade = Some(convert_symbol_upgrade(from, to, *probability));
            }
            // W4.7 — LinearProgressive is IR-only metadata; runtime contribution
            // math lives in `crate::jackpot::progressive`. Adapter intentionally
            // skips conversion here so the existing `GameConfig` shape remains
            // unchanged for downstream consumers; engine reads progressive_link
            // from the IR root directly.
            Feature::LinearProgressive { .. } => {}
        }
    }
}

fn convert_free_spins(
    trigger: &crate::ir::TriggerByCount,
    global_multiplier: Option<f64>,
    retrigger: &Option<crate::ir::RetriggerSpec>,
) -> FreeSpinsConfig {
    // Build scatter_count → spins_awarded map from thresholds.
    let mut awards: HashMap<u8, u8> = HashMap::new();
    let scatter_pays: HashMap<u8, f64> = HashMap::new();

    if let Some(thresholds) = &trigger.thresholds {
        for (key, &value) in thresholds {
            let numeric: &str = key.trim_end_matches('+');
            if let Ok(count) = numeric.parse::<u8>() {
                awards.insert(count, value as u8);
                // IR thresholds carry spins-awarded, not a pay multiplier.
                // We keep scatter_pays empty unless a dedicated scatter pay
                // field is added to the IR (not in scope for Faza 1.2).
            }
        }
    }

    // Fallback: if thresholds is empty but `min` is set, apply a default.
    if awards.is_empty() {
        if let Some(min) = trigger.min {
            // Default to 10 spins for the minimum trigger count.
            awards.insert(min as u8, 10);
        }
    }

    // Multiplier: the IR global_multiplier is a fixed boost (not progressive).
    // We encode it as mult_start with an increment of 0 so the existing FS
    // simulator keeps applying it uniformly.
    let mult_start = global_multiplier.unwrap_or(1.0) as u32;
    let mult_increment = if global_multiplier.is_some() { 0 } else { 1 };
    let mult_max = if global_multiplier.is_some() {
        mult_start
    } else {
        10
    };

    let retrigger_enabled =
        retrigger.is_some() || matches!(trigger.by, TriggerBy::ScatterCount) && !awards.is_empty();

    FreeSpinsConfig {
        awards,
        mult_start,
        mult_increment,
        mult_max,
        retrigger_enabled,
        scatter_pays,
        special_reel_sets: Vec::new(),
    }
}

fn convert_hold_and_win(
    trigger: &crate::ir::TriggerByCount,
    respins_initial: u32,
    cash_value_distribution: &[crate::ir::CashValueDist],
    jackpot_tiers: &[crate::ir::JackpotTier],
    grid_full_award: &Option<String>,
) -> HoldAndWinConfig {
    // Trigger count: prefer `min` field, else lowest threshold key.
    let trigger_count = trigger
        .min
        .map(|m| m as u8)
        .or_else(|| {
            trigger.thresholds.as_ref().and_then(|t| {
                t.keys()
                    .filter_map(|k| k.trim_end_matches('+').parse::<u8>().ok())
                    .min()
            })
        })
        .unwrap_or(6);

    // Orb values from cash_value_distribution.
    let orb_values: Vec<OrbValue> = cash_value_distribution
        .iter()
        .map(|dist| {
            // Check if any jackpot tier multiplier matches this cash value.
            let jackpot = jackpot_tiers
                .iter()
                .find(|t| (t.multiplier - dist.value).abs() < 0.01)
                .map(|t| t.id.clone());
            OrbValue {
                value: dist.value as u32,
                weight: f64_to_weight(dist.weight),
                jackpot,
            }
        })
        .collect();

    // Full grid bonus: the `grid_full_award` field in the IR is a jackpot
    // tier id (e.g. "GRAND").  Map it to the multiplier of that tier.
    let full_grid_bonus = grid_full_award
        .as_deref()
        .and_then(|id| jackpot_tiers.iter().find(|t| t.id == id))
        .map(|t| t.multiplier)
        .unwrap_or(500.0);

    HoldAndWinConfig {
        trigger_count,
        initial_respins: respins_initial as u8,
        respins_on_new_orb: respins_initial as u8, // same reset count by convention
        full_grid_bonus,
        orb_values,
        orb_land_chance_base: 0.035, // sensible default — no IR field yet
        orb_land_chance_fill_bonus: 0.015,
    scenarios: Vec::new(),
        }
}

// ─── W152 P0-3 — Cascade / Respin / MysterySymbol converters ──────────────

/// Convert `Feature::Cascade` from IR into the runtime `CascadeConfig`.
///
/// The IR enum variant names are snake_case (`drop`, `refill_random`,
/// `fixed_strip`) on the wire; the Rust enum mirrors that exactly.
/// `multiplier_progression` is moved through unchanged so the consumer
/// can keep the ladder shape (e.g. `[1.0, 2.0, 3.0, 5.0]`).
fn convert_cascade(
    replacement: &IrCascadeReplacement,
    max_chain: u32,
    multiplier_progression: &Option<Vec<f64>>,
) -> CascadeConfig {
    let replacement = match replacement {
        IrCascadeReplacement::Drop => RtCascadeReplacement::Drop,
        IrCascadeReplacement::RefillRandom => RtCascadeReplacement::RefillRandom,
        IrCascadeReplacement::FixedStrip => RtCascadeReplacement::FixedStrip,
    };
    CascadeConfig {
        replacement,
        max_chain,
        multiplier_progression: multiplier_progression.clone(),
    }
}

/// Convert `Feature::Respin` from IR into the runtime `RespinConfig`.
/// No coercion — both fields are passed through verbatim.
fn convert_respin(cost_x: f64, max_uses_per_spin: u32) -> RespinConfig {
    RespinConfig {
        cost_x,
        max_uses_per_spin,
    }
}

/// Convert `Feature::MysterySymbol` from IR into the runtime `MysteryConfig`.
///
/// `reveal_distribution` is normalised into a `BTreeMap` for byte-stable
/// JSON serialisation (parity gate requirement). Weights are kept as raw
/// `f64` — the consumer normalises them per spin (TS↔Rust must use the
/// same normalisation strategy; we document it in the consumer call site,
/// not here).
fn convert_mystery(symbol_id: &str, reveal_distribution: &BTreeMap<String, f64>) -> MysteryConfig {
    MysteryConfig {
        symbol_id: symbol_id.to_owned(),
        reveal_distribution: reveal_distribution.clone(),
    }
}

// ─── W152 P0-3 round 2 — Pick / Wheel / BuyFeature / AnteBet / Gamble /
// SymbolUpgrade converters ─────────────────────────────────────────────────

/// Map an IR `PrizeEntry` → runtime `PrizeSlot`.
///
/// Identical shape — kept as a separate runtime type so the engine can evolve
/// its internal representation (e.g. add caching fields) without touching IR.
fn prize_entry_to_slot(entry: &PrizeEntry) -> PrizeSlot {
    PrizeSlot {
        id: entry.id.clone(),
        weight: entry.weight,
        pay_multiplier: entry.pay_multiplier,
    }
}

/// Convert `Feature::Pick` into runtime `PickConfig`.
fn convert_pick(prize_pool: &[PrizeEntry]) -> PickConfig {
    PickConfig {
        prize_pool: prize_pool.iter().map(prize_entry_to_slot).collect(),
    }
}

/// Convert `Feature::Wheel` into runtime `WheelConfig`.
fn convert_wheel(segments: &[PrizeEntry]) -> WheelConfig {
    WheelConfig {
        segments: segments.iter().map(prize_entry_to_slot).collect(),
    }
}

/// Convert `Feature::BuyFeature` into runtime `BuyFeatureConfig`.
///
/// The offers are carried through verbatim. Downstream jurisdiction
/// validation (UKGC SI 2025/215, NL KSA, DE GGL, DK SP) decides whether
/// they can actually be exposed at runtime.
fn convert_buy_feature(offers: &[BuyOffer]) -> BuyFeatureConfig {
    BuyFeatureConfig {
        offers: offers
            .iter()
            .map(|o| BuyFeatureOffer {
                id: o.id.clone(),
                cost_x: o.cost_x,
                guaranteed: o.guaranteed.clone(),
            })
            .collect(),
    }
}

/// Convert `Feature::AnteBet` into runtime `AnteBetConfig`.
fn convert_ante_bet(extra_multiplier: f64, enabled_by_default: bool) -> AnteBetConfig {
    AnteBetConfig {
        extra_multiplier,
        enabled_by_default,
    }
}

/// Convert `Feature::Gamble` into runtime `GambleConfig`.
///
/// Both enum variants (kind, tie-resolution) are mapped 1:1.
fn convert_gamble(ty: GambleType, max_steps: u32, tie: TieResolution) -> GambleConfig {
    let ty_rt = match ty {
        GambleType::RedBlack => RtGambleType::RedBlack,
        GambleType::Suit => RtGambleType::Suit,
    };
    let tie_rt = match tie {
        TieResolution::House => RtGambleTieResolution::House,
        TieResolution::Push => RtGambleTieResolution::Push,
    };
    GambleConfig {
        ty: ty_rt,
        max_steps,
        tie_resolution: tie_rt,
    }
}

/// Convert `Feature::SymbolUpgrade` into runtime `SymbolUpgradeConfig`.
fn convert_symbol_upgrade(from: &str, to: &str, probability: f64) -> SymbolUpgradeConfig {
    SymbolUpgradeConfig {
        from: from.to_owned(),
        to: to.to_owned(),
        probability,
    }
}

// ─── Unit tests (W152 P0-3) ────────────────────────────────────────────────

#[cfg(test)]
mod cascade_respin_mystery_tests {
    use super::*;

    #[test]
    fn convert_cascade_maps_all_replacement_variants() {
        for (ir, expected) in [
            (IrCascadeReplacement::Drop, RtCascadeReplacement::Drop),
            (
                IrCascadeReplacement::RefillRandom,
                RtCascadeReplacement::RefillRandom,
            ),
            (
                IrCascadeReplacement::FixedStrip,
                RtCascadeReplacement::FixedStrip,
            ),
        ] {
            let out = convert_cascade(&ir, 7, &Some(vec![1.0, 2.0, 3.0, 5.0]));
            assert_eq!(out.replacement, expected);
            assert_eq!(out.max_chain, 7);
            assert_eq!(out.multiplier_progression, Some(vec![1.0, 2.0, 3.0, 5.0]));
        }
    }

    #[test]
    fn convert_cascade_handles_none_progression() {
        let out = convert_cascade(&IrCascadeReplacement::Drop, 3, &None);
        assert!(out.multiplier_progression.is_none());
        assert_eq!(out.max_chain, 3);
    }

    #[test]
    fn convert_respin_passes_through() {
        let out = convert_respin(2.5, 3);
        assert!((out.cost_x - 2.5).abs() < f64::EPSILON);
        assert_eq!(out.max_uses_per_spin, 3);
    }

    #[test]
    fn convert_mystery_preserves_distribution_keys() {
        let mut dist = BTreeMap::new();
        dist.insert("S_LP1".to_owned(), 50.0);
        dist.insert("S_HP1".to_owned(), 30.0);
        dist.insert("S_WILD".to_owned(), 20.0);
        let out = convert_mystery("S_MYS", &dist);
        assert_eq!(out.symbol_id, "S_MYS");
        assert_eq!(out.reveal_distribution.len(), 3);
        assert_eq!(out.reveal_distribution.get("S_LP1"), Some(&50.0));
        assert_eq!(out.reveal_distribution.get("S_HP1"), Some(&30.0));
        assert_eq!(out.reveal_distribution.get("S_WILD"), Some(&20.0));
    }

    #[test]
    fn convert_mystery_btreemap_iter_is_byte_stable() {
        // BTreeMap iteration order is lexicographic — encode + decode
        // must yield the same string for any input order.
        let mut a = BTreeMap::new();
        a.insert("Z".to_owned(), 1.0);
        a.insert("A".to_owned(), 2.0);
        a.insert("M".to_owned(), 3.0);
        let out = convert_mystery("S_MYS", &a);
        let json = serde_json::to_string(&out.reveal_distribution).unwrap();
        // Lexicographic key order: A, M, Z.
        assert_eq!(json, r#"{"A":2.0,"M":3.0,"Z":1.0}"#);
    }

    // ── W152 P0-3 round 2 — Pick / Wheel / BuyFeature / AnteBet / Gamble /
    // SymbolUpgrade ────────────────────────────────────────────────────────

    fn sample_prize_pool() -> Vec<PrizeEntry> {
        vec![
            PrizeEntry {
                id: "MINI".to_owned(),
                weight: 50.0,
                pay_multiplier: 10.0,
            },
            PrizeEntry {
                id: "MINOR".to_owned(),
                weight: 30.0,
                pay_multiplier: 50.0,
            },
            PrizeEntry {
                id: "MAJOR".to_owned(),
                weight: 15.0,
                pay_multiplier: 250.0,
            },
            PrizeEntry {
                id: "GRAND".to_owned(),
                weight: 5.0,
                pay_multiplier: 1000.0,
            },
        ]
    }

    #[test]
    fn convert_pick_preserves_pool_order_and_values() {
        let pool = sample_prize_pool();
        let out = convert_pick(&pool);
        assert_eq!(out.prize_pool.len(), 4);
        assert_eq!(out.prize_pool[0].id, "MINI");
        assert!((out.prize_pool[0].weight - 50.0).abs() < f64::EPSILON);
        assert!((out.prize_pool[3].pay_multiplier - 1000.0).abs() < f64::EPSILON);
    }

    #[test]
    fn convert_pick_handles_empty_pool() {
        let out = convert_pick(&[]);
        assert!(out.prize_pool.is_empty());
    }

    #[test]
    fn convert_wheel_preserves_segments() {
        let pool = sample_prize_pool();
        let out = convert_wheel(&pool);
        assert_eq!(out.segments.len(), 4);
        // Weights sum check (analytical RTP relies on this; off-by-one here
        // would silently corrupt EV calculations).
        let total: f64 = out.segments.iter().map(|s| s.weight).sum();
        assert!((total - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn convert_buy_feature_roundtrips_offers() {
        let offers = vec![
            BuyOffer {
                id: "FS".to_owned(),
                cost_x: 100.0,
                guaranteed: "free_spins".to_owned(),
            },
            BuyOffer {
                id: "SUPER_FS".to_owned(),
                cost_x: 250.0,
                guaranteed: "super_free_spins".to_owned(),
            },
        ];
        let out = convert_buy_feature(&offers);
        assert_eq!(out.offers.len(), 2);
        assert_eq!(out.offers[1].id, "SUPER_FS");
        assert!((out.offers[1].cost_x - 250.0).abs() < f64::EPSILON);
        assert_eq!(out.offers[1].guaranteed, "super_free_spins");
    }

    #[test]
    fn convert_ante_bet_passes_through() {
        let out = convert_ante_bet(1.25, true);
        assert!((out.extra_multiplier - 1.25).abs() < f64::EPSILON);
        assert!(out.enabled_by_default);

        let off = convert_ante_bet(1.5, false);
        assert!((off.extra_multiplier - 1.5).abs() < f64::EPSILON);
        assert!(!off.enabled_by_default);
    }

    #[test]
    fn convert_gamble_maps_all_variants() {
        let cases = [
            (
                GambleType::RedBlack,
                TieResolution::House,
                RtGambleType::RedBlack,
                RtGambleTieResolution::House,
            ),
            (
                GambleType::Suit,
                TieResolution::Push,
                RtGambleType::Suit,
                RtGambleTieResolution::Push,
            ),
        ];
        for (ir_ty, ir_tie, rt_ty, rt_tie) in cases {
            let out = convert_gamble(ir_ty, 5, ir_tie);
            assert_eq!(out.ty, rt_ty);
            assert_eq!(out.tie_resolution, rt_tie);
            assert_eq!(out.max_steps, 5);
        }
    }

    #[test]
    fn convert_symbol_upgrade_passes_through() {
        let out = convert_symbol_upgrade("S_LP1", "S_HP3", 0.05);
        assert_eq!(out.from, "S_LP1");
        assert_eq!(out.to, "S_HP3");
        assert!((out.probability - 0.05).abs() < f64::EPSILON);
    }

    #[test]
    fn convert_gamble_serializes_snake_case_kind_and_tie() {
        // Round-trip through serde to confirm wire format matches IR.
        let g = convert_gamble(GambleType::RedBlack, 3, TieResolution::Push);
        let json = serde_json::to_string(&g).unwrap();
        // Expected wire shape (RtGambleConfig uses #[serde(rename = "type")]
        // and snake_case enums to mirror the IR wire format).
        assert!(json.contains(r#""type":"red_black""#));
        assert!(json.contains(r#""tie_resolution":"push""#));
        assert!(json.contains(r#""max_steps":3"#));
    }
}

// ─── W237 — adapter mutation kill tests ────────────────────────────────────
//
// Targeted unit tests covering 11 mutants from cargo-mutants baseline
// (reports/mutation/rust/adapter/mutants.out/missed.txt) so the adapter
// reaches effective 100 % mutation coverage.
//
// Mutant map (line:col → kill test):
//   266 strips_to_reel_weights → Ok(vec![])           → kill_strips_outer_len
//   266 strips_to_reel_weights → Ok(vec![vec![]])     → kill_strips_inner_nonempty
//   334 convert_paylines % → +                         → kill_ways_modulo
//   335 convert_paylines /= → *=                       → kill_ways_division
//   598 convert_free_spins && → ||                     → kill_free_spins_and_op
//   598 convert_free_spins || → &&                     → kill_free_spins_or_op
//   637 convert_hold_and_win < → >                     → kill_haw_tier_match_lt_gt
//   637 convert_hold_and_win < → <=                    → kill_haw_tier_match_strict_lt
//   637 convert_hold_and_win - → +                     → kill_haw_tier_match_minus_plus
//   637 convert_hold_and_win - → /                     → kill_haw_tier_match_minus_div
//   651 convert_hold_and_win == → !=                   → kill_haw_full_grid_id_match
#[cfg(test)]
mod w237_kill_tests {
    use super::*;
    use crate::ir::{CashValueDist, JackpotTier, RetriggerSpec, TriggerByCount};

    // ── helpers ────────────────────────────────────────────────────────────

    fn sym_index() -> HashMap<&'static str, usize> {
        let mut m: HashMap<&'static str, usize> = HashMap::new();
        m.insert("S_A", 0);
        m.insert("S_B", 1);
        m.insert("S_C", 2);
        m
    }

    fn ir_ways(reels: u32, rows: u32) -> SlotGameIR {
        // Skeleton IR with Ways evaluation.  `convert_paylines` reads only
        // `ir.evaluation`, so the rest is filler with safe defaults that
        // satisfy the struct signatures (kept here to insulate the kill
        // tests from unrelated schema drift).
        SlotGameIR {
            schema_version: "1.0".into(),
            meta: crate::ir::Meta {
                id: "W237-T".into(),
                name: "ways-kill".into(),
                version: "1".into(),
                description: None,
                theme_tags: vec![],
                author: None,
                created_at_utc: None,
            },
            topology: Topology::Rectangular { reels, rows },
            symbols: vec![],
            reels: ReelSet::Weighted {
                base: vec![],
                free_spins: None,
            },
            evaluation: Evaluation::Ways {
                direction: crate::ir::Direction::Ltr,
                min_match: 3,
                max_ways_per_spin: 1024,
            },
            paytable: BTreeMap::new(),
            features: vec![],
            rng: crate::ir::Rng {
                kind: crate::ir::RngKind::Mulberry32,
                default_seed: 1,
                jump_function: None,
            },
            bet: crate::ir::Bet {
                currency: "USD".into(),
                base_bet: 1.0,
                denominations: vec![1.0],
                ante_bet: None,
                buy_feature: None,
            },
            limits: crate::ir::Limits {
                target_rtp: 0.96,
                rtp_tolerance: 0.01,
                max_win_x: 5000.0,
                win_cap_apply: crate::ir::WinCapApply::PerSpin,
                target_volatility: crate::ir::Volatility::Medium,
                hit_freq_target: 0.25,
            },
            compliance: crate::ir::Compliance {
                jurisdictions: vec!["XX".into()],
                rtp_range_required: [0.85, 0.99],
                max_win_cap_required: 5000.0,
                near_miss_rule: crate::ir::NearMissRule::MustBeRandom,
                ldw_disclosure: false,
                session_time_display: false,
            },
            rtp_allocation: crate::ir::RtpAllocation {
                base_game: 80.0,
                free_spins: 15.0,
                hold_and_win: 5.0,
                jackpot: 0.0,
                tolerance: 1.0,
            },
            // W4.7 — additive optionals (all None for kill-test skeleton).
            progressive_link: None,
            jurisdiction_overrides: None,
            persistent_state: None,
            provenance: None,
        }
    }

    // ── 1-2. strips_to_reel_weights ────────────────────────────────────────

    #[test]
    fn kill_strips_outer_len() {
        // Three non-empty strips → outer Vec must have length 3, never 0.
        // Kills: Ok(vec![]) — empty outer.
        let idx = sym_index();
        let reels: Vec<Vec<String>> = vec![
            vec!["S_A".into(), "S_B".into()],
            vec!["S_B".into(), "S_C".into()],
            vec!["S_A".into(), "S_C".into()],
        ];
        let out = strips_to_reel_weights(&reels, &idx).expect("strips conversion");
        assert_eq!(out.len(), 3, "outer length must match reel count");
    }

    #[test]
    fn kill_strips_inner_nonempty() {
        // Inner reel must contain at least one weight entry — kills
        // Ok(vec![vec![]]) which would emit a single empty reel.
        let idx = sym_index();
        let reels: Vec<Vec<String>> = vec![
            vec!["S_A".into(), "S_A".into(), "S_B".into()],
        ];
        let out = strips_to_reel_weights(&reels, &idx).expect("strips conversion");
        assert_eq!(out.len(), 1);
        assert!(!out[0].is_empty(), "inner weights must not be empty");
        // S_A counted twice, S_B once → 2 distinct weights.
        assert_eq!(out[0].len(), 2);
        // BTreeMap orders by key — A before B.
        assert_eq!(out[0][0].symbol, "S_A");
        assert_eq!(out[0][0].weight, 2);
        assert_eq!(out[0][1].symbol, "S_B");
        assert_eq!(out[0][1].weight, 1);
    }

    // ── 3-4. convert_paylines (Ways generation) ───────────────────────────

    #[test]
    fn kill_ways_modulo() {
        // Ways on 2 reels × 3 rows = 9 paylines; each cell ∈ [0,2].
        // Mutating `%` → `+` produces values up to (rem + rows) which on
        // the last iteration exceeds the row count — assertion catches it.
        let ir = ir_ways(2u32, 3u32);
        let out = convert_paylines(&ir, 2, 3).expect("ways paylines");
        assert_eq!(out.len(), 9);
        for pl in &out {
            assert_eq!(pl.len(), 2);
            for &cell in pl {
                assert!(
                    cell < 3,
                    "ways payline cell must be < rows (got {cell})",
                );
            }
        }
    }

    #[test]
    fn kill_ways_division() {
        // Verify concrete payline contents.  Lexicographic enumeration of
        // 2 reels × 3 rows yields (reel0, reel1):
        //   combo 0 → [0,0],  1 → [0,1],  2 → [0,2],
        //   combo 3 → [1,0],  4 → [1,1],  5 → [1,2],
        //   combo 6 → [2,0],  7 → [2,1],  8 → [2,2].
        // Mutating `/=` → `*=` causes `rem` to explode → reel0 value
        // becomes `(rem * rows) % rows`, which is always 0 for any non-zero
        // rows — every payline's first cell would be 0, breaking the
        // strict equality below.
        let ir = ir_ways(2u32, 3u32);
        let out = convert_paylines(&ir, 2, 3).expect("ways paylines");
        let expected = vec![
            vec![0u8, 0],
            vec![0, 1],
            vec![0, 2],
            vec![1, 0],
            vec![1, 1],
            vec![1, 2],
            vec![2, 0],
            vec![2, 1],
            vec![2, 2],
        ];
        assert_eq!(out, expected, "lexicographic ways enumeration");
    }

    // ── 5-6. convert_free_spins (retrigger_enabled boolean) ───────────────

    #[test]
    fn kill_free_spins_and_op() {
        // Setup: retrigger=None, trigger.by=BonusCount (not ScatterCount),
        // awards populated.  With original `&& !awards.is_empty()`:
        //   None.is_some() || (false && true) = false
        // Mutant `|| !awards.is_empty()`:
        //   None.is_some() || false || true = true
        // → expected `retrigger_enabled == false`.
        let mut thresholds = BTreeMap::new();
        thresholds.insert("3".into(), 10.0);
        let trigger = TriggerByCount {
            by: TriggerBy::BonusCount,
            thresholds: Some(thresholds),
            min: None,
        };
        let out = convert_free_spins(&trigger, None, &None);
        assert!(
            !out.retrigger_enabled,
            "BonusCount + no retrigger → retrigger_enabled must be false",
        );
    }

    #[test]
    fn kill_free_spins_or_op() {
        // Setup: retrigger=Some(_), trigger.by=BonusCount, awards empty.
        // Original `A || (B && C)` with A=true → true.
        // Mutant `A && (B && C)` = A && B && C with B=false → false.
        // Also catches `A && B || C` re-parse (false || false = false).
        let trigger = TriggerByCount {
            by: TriggerBy::BonusCount,
            thresholds: None,
            min: None,
        };
        let retrigger = Some(RetriggerSpec {
            trigger: TriggerByCount {
                by: TriggerBy::BonusCount,
                thresholds: None,
                min: Some(2),
            },
            max_total: Some(50),
        });
        let out = convert_free_spins(&trigger, None, &retrigger);
        assert!(
            out.retrigger_enabled,
            "retrigger.is_some() → retrigger_enabled must be true regardless of trigger.by",
        );
    }

    #[test]
    fn kill_free_spins_negation() {
        // Surface-only mutant that became visible after W237 killed the
        // 598:78 boolean-op mutants: `delete !` rewrites
        //   ... && !awards.is_empty()
        // to
        //   ... && awards.is_empty()
        // Killer setup: retrigger=None, by=ScatterCount, awards populated
        // (single threshold `"3":10`).  Original `false || (true && true)`
        // = true; mutant `false || (true && false)` = false.
        let mut thresholds = BTreeMap::new();
        thresholds.insert("3".into(), 10.0);
        let trigger = TriggerByCount {
            by: TriggerBy::ScatterCount,
            thresholds: Some(thresholds),
            min: None,
        };
        let out = convert_free_spins(&trigger, None, &None);
        assert!(
            out.retrigger_enabled,
            "ScatterCount with populated awards must enable retrigger \
             (mutant `awards.is_empty()` would flip this to false)",
        );
    }

    // ── 7-11. convert_hold_and_win (jackpot match + grid full bonus) ──────

    fn haw_trigger() -> TriggerByCount {
        TriggerByCount {
            by: TriggerBy::SpecialCount,
            thresholds: None,
            min: Some(6),
        }
    }

    #[test]
    fn kill_haw_tier_match_lt_gt() {
        // dist.value = 100.0; tier.multiplier = 100.0 → diff = 0.0.
        // Original `0.0 < 0.01` → true → orb.jackpot = Some("GRAND").
        // Mutant `0.0 > 0.01` → false → orb.jackpot = None.
        let dist = vec![CashValueDist {
            value: 100.0,
            weight: 1.0,
        }];
        let tiers = vec![JackpotTier {
            id: "GRAND".into(),
            multiplier: 100.0,
        }];
        let out = convert_hold_and_win(&haw_trigger(), 3, &dist, &tiers, &None);
        assert_eq!(out.orb_values.len(), 1);
        assert_eq!(
            out.orb_values[0].jackpot.as_deref(),
            Some("GRAND"),
            "exact-match tier must populate jackpot id",
        );
    }

    #[test]
    fn kill_haw_tier_match_strict_lt() {
        // Killing 637:61 `<` → `<=` requires an input that lands the
        // `(t.multiplier - dist.value).abs()` expression exactly on the
        // f64-representable value of `0.01_f64`.
        //
        // The trick: `0.01_f64` is the literal constant in the source,
        // so subtracting `0.0_f64` from `0.01_f64` reproduces *the same
        // bit pattern* — diff == 0.01_f64 exactly.
        //
        //   diff = (0.01_f64 - 0.0_f64).abs() = 0.01_f64  (bit-identical)
        //   original `<`  : 0.01 <  0.01 = false → no match → jackpot=None
        //   mutant   `<=` : 0.01 <= 0.01 = true  → match    → jackpot=Some
        //
        // Verified empirically: see /tmp/floateq.rs scratch in W237 notes.
        let dist = vec![CashValueDist {
            value: 0.0,
            weight: 1.0,
        }];
        let tiers = vec![JackpotTier {
            id: "EDGE".into(),
            multiplier: 0.01,
        }];
        let out = convert_hold_and_win(&haw_trigger(), 3, &dist, &tiers, &None);
        assert_eq!(
            out.orb_values[0].jackpot, None,
            "strict `<` must reject diff == 0.01_f64 exactly \
             (mutant `<=` would emit Some(\"EDGE\"))",
        );
    }

    #[test]
    fn kill_haw_tier_match_minus_plus() {
        // Original predicate: |t.multiplier - dist.value| < 0.01
        // Mutant `-` → `+`: |t.multiplier + dist.value| < 0.01.
        // With multiplier=50 and value=50, original |0|<0.01 → match.
        // Mutant |100|<0.01 → no match.  We use small positive numbers so
        // the original matches (diff 0) and the mutant cannot (sum 100).
        let dist = vec![CashValueDist {
            value: 50.0,
            weight: 1.0,
        }];
        let tiers = vec![JackpotTier {
            id: "MAJOR".into(),
            multiplier: 50.0,
        }];
        let out = convert_hold_and_win(&haw_trigger(), 3, &dist, &tiers, &None);
        assert_eq!(
            out.orb_values[0].jackpot.as_deref(),
            Some("MAJOR"),
            "subtraction-based equality must match equal values",
        );
    }

    #[test]
    fn kill_haw_tier_match_minus_div() {
        // Mutant `-` → `/`: |t.multiplier / dist.value| < 0.01.
        // With multiplier=5, value=5: original |0|<0.01 → match.
        // Mutant |1.0|<0.01 → false → no match.
        // (Same input shape as plus mutant, but using a smaller magnitude
        // so this assertion is robust independently.)
        let dist = vec![CashValueDist {
            value: 5.0,
            weight: 1.0,
        }];
        let tiers = vec![JackpotTier {
            id: "MINI".into(),
            multiplier: 5.0,
        }];
        let out = convert_hold_and_win(&haw_trigger(), 3, &dist, &tiers, &None);
        assert_eq!(
            out.orb_values[0].jackpot.as_deref(),
            Some("MINI"),
            "subtraction (not division) must drive jackpot tier match",
        );
    }

    #[test]
    fn kill_haw_full_grid_id_match() {
        // Original `t.id == id` matches by string equality → full_grid_bonus
        // uses the tier multiplier (777.0).
        // Mutant `t.id != id` matches the *first* non-matching tier (DUMMY)
        // → full_grid_bonus would be 1.0, not 777.0.
        // We also include a sentinel tier "DUMMY" with multiplier 1.0 so the
        // mutant has a wrong candidate to lock onto, and so the assertion
        // is non-trivial (i.e. not just default 500.0).
        let dist = vec![CashValueDist {
            value: 10.0,
            weight: 1.0,
        }];
        let tiers = vec![
            JackpotTier {
                id: "DUMMY".into(),
                multiplier: 1.0,
            },
            JackpotTier {
                id: "GRAND".into(),
                multiplier: 777.0,
            },
        ];
        let out = convert_hold_and_win(
            &haw_trigger(),
            3,
            &dist,
            &tiers,
            &Some("GRAND".to_owned()),
        );
        assert!(
            (out.full_grid_bonus - 777.0).abs() < f64::EPSILON,
            "grid_full_award lookup must use string equality (got {})",
            out.full_grid_bonus,
        );
    }
}
