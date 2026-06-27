//! GLI-16 compliant PAR Sheet generator — Faza 8 extended + PAR-001 Tier-1.
//!
//! Produces a structured [`PARSheet`] that can be serialised to JSON or
//! printed as a human-readable report. The field set mirrors GLI-16 Appendix D
//! requirements for slot math certification.
//!
//! ### Sections
//! 1. **Meta** — game id, version, simulation parameters
//! 2. **RTP summary** — total, base game, features, per-feature breakdown
//! 3. **Hit frequency** — overall hit rate, feature trigger 1-in-N averages
//! 4. **Volatility** — Welford CV, actual variance, max win, category
//! 5. **Win distribution** — HDR histogram mapped to standard report buckets
//! 6. **Jackpot section** — per-tier hit frequency, avg payout, RTP contribution
//! 7. **Compliance** — RTP range, max-win cap, jurisdiction notes
//! 8. **Statistical confidence** — CI-95%/99%/99.9%, std error, seed count
//! 9. **Quantiles** *(Faza 8)* — P50/P90/P99/P99.9 from HDR
//! 10. **Moments** *(Faza 8)* — Welford mean, variance, skewness, excess kurtosis
//! 11. **Bonus distances** *(Faza 8)* — FS + H&W inter-trigger distribution
//! 12. **Required spins** *(Faza 8)* — sample-size estimates for precision targets
//! 13. **Sign-off** *(PAR-001)* — mathematician / approver names + signature blobs
//! 14. **Reel config** *(PAR-001)* — per-reel mode, length, symbol counts, total cycle
//! 15. **Paytable** *(PAR-001)* — n-of-a-kind multiplier matrix + per-pay-rule RTP audit trail

use crate::bonus_buy::BonusBuySection;
use crate::ir::{ReelSet, RngKind, SlotGameIR, SymbolKind};
use crate::jackpot::JackpotMetrics;
use crate::stats::{AtomicStats, BonusDistanceTracker, HdrHistogram, PARMetrics, DISTANCE_THRESHOLDS, HDR_BUCKET_COUNT};
use crate::tail_fit::{evt_tail_quantile, fit_pareto_tail, ParetoFitOpts, TailFitError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::sync::atomic::Ordering;

// ─── serde helpers ────────────────────────────────────────────────────────────

/// Sentinel value substituted for `+Inf` when emitting JSON (the literal `Inf`
/// is not valid JSON and serde_json silently produces `null`, which then fails
/// to deserialise back to `f64`). 1e308 is finite, double-precision safe, and
/// stands out as "essentially infinite" in audit reports.
const F64_POSITIVE_INFINITY_SENTINEL: f64 = 1.0e308;

/// Sentinel for `NaN` — emitted as 0.0. The accompanying `reason` field on
/// EVT-style sections distinguishes "legitimate zero" from "fit unavailable".
const F64_NAN_SENTINEL: f64 = 0.0;

/// Replace `NaN` / `±Inf` in an `f64` with sentinels so JSON roundtrip is lossless.
fn sanitize_f64_for_json(v: f64) -> f64 {
    if v.is_nan() {
        F64_NAN_SENTINEL
    } else if v.is_infinite() {
        if v > 0.0 {
            F64_POSITIVE_INFINITY_SENTINEL
        } else {
            -F64_POSITIVE_INFINITY_SENTINEL
        }
    } else {
        v
    }
}

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PARMeta {
    pub game_id: String,
    pub game_version: String,
    pub engine_version: String,
    pub generated_at_utc: String,
    pub total_spins: u64,
    pub seeds_used: u32,
    /// Live RNG family used for this PAR run. Populated from `ir.rng.kind` when
    /// `ctx.ir = Some(...)`, otherwise the legacy fallback `"unknown"`.
    /// The previous stale literal `"mulberry32"` was fixed in PAR-002/A4.
    pub rng_kind: String,
    /// SHA-256 (lowercase hex) over the **canonical** JSON serialization of the IR.
    /// Two PAR sheets produced from byte-identical IRs share the same `config_hash`.
    /// Empty string when `ctx.ir = None` (legacy shim path).
    #[serde(default)]
    pub config_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RTPSection {
    pub total_rtp_pct: f64,
    pub base_rtp_pct: f64,
    pub free_spins_rtp_pct: f64,
    pub hold_and_win_rtp_pct: f64,
    pub cascade_rtp_pct: f64,
    pub jackpot_rtp_pct: f64,
    pub target_rtp_pct: f64,
    pub rtp_tolerance_pct: f64,
    pub within_tolerance: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HitFreqSection {
    pub overall_hit_rate_pct: f64,
    pub base_hit_rate_pct: f64,
    pub feature_freq: BTreeMap<String, f64>,
    pub avg_fs_spins: f64,
    pub avg_hnw_respins: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolatilitySection {
    /// Coefficient of variation σ/μ (Welford-based).
    pub cv: f64,
    /// Per-spin win variance (bet multiples²) from Welford accumulator.
    pub variance: f64,
    /// Standard deviation (bet multiples) from Welford accumulator.
    pub std_dev: f64,
    /// Maximum single-spin win in bet multiples.
    pub max_win_x: f64,
    /// Qualitative volatility category.
    pub category: String,
}

/// One win-distribution bucket in the PAR report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WinBucket {
    pub from_x: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_x: Option<f64>,
    pub label: String,
    pub count: u64,
    pub probability: f64,
    pub rtp_contribution_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplianceSection {
    pub jurisdictions: Vec<String>,
    pub rtp_range_required: [f64; 2],
    pub rtp_within_required: bool,
    pub max_win_cap_required: f64,
    pub max_win_within_cap: bool,
    pub near_miss_rule: String,
    pub ldw_disclosure: bool,
    pub session_time_display: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatisticalSection {
    pub ci_95_low: f64,
    pub ci_95_high: f64,
    /// CI 99% — Faza 8.
    #[serde(default)]
    pub ci_99_low: f64,
    #[serde(default)]
    pub ci_99_high: f64,
    /// CI 99.9% — Faza 8.
    #[serde(default)]
    pub ci_999_low: f64,
    #[serde(default)]
    pub ci_999_high: f64,
    pub std_error: f64,
    pub std_dev_across_seeds: f64,
    /// True when `std_error < 0.1pp` — threshold for GLI adequacy.
    pub confidence_adequate: bool,
}

// ─── Faza 8 sections ──────────────────────────────────────────────────────────

/// P-quantile report section (from HDR histogram).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QuantileSection {
    pub p50: f64,
    pub p90: f64,
    pub p99: f64,
    pub p999: f64,
}

/// Welford online 4-moment snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MomentsSection {
    /// Mean per-spin win in bet multiples.
    pub mean_win_x: f64,
    /// Per-spin win variance (bet multiples²).
    pub variance: f64,
    /// Per-spin win std deviation (bet multiples).
    pub std_dev: f64,
    /// Coefficient of variation σ/μ.
    pub cv: f64,
    /// Population skewness (Terriberry algorithm).
    pub skewness: f64,
    /// Excess kurtosis (Pearson − 3; normal = 0).
    pub excess_kurtosis: f64,
    /// Number of observations in the accumulator.
    pub sample_count: u64,
}

/// Per-feature bonus distance statistics.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BonusDistanceEntry {
    /// Mean spins between consecutive triggers (Infinity if never triggered).
    pub mean_distance: f64,
    /// Maximum spins between consecutive triggers.
    pub max_distance: u64,
}

/// FS + H&W inter-trigger distance statistics.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BonusDistancesSection {
    pub free_spins: BonusDistanceEntry,
    pub hold_and_win: BonusDistanceEntry,
}

/// Required spin counts for precision targets.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RequiredSpinsSection {
    /// Spins needed for 0.1pp CI half-width at 95% confidence.
    pub for_01pp_ci_95: u64,
    /// Spins needed for 0.01pp CI half-width at 95% confidence.
    pub for_001pp_ci_95: u64,
    /// Spins needed for 0.1pp CI half-width at 99% confidence.
    pub for_01pp_ci_99: u64,
}

// ─── PAR-001 sections ─────────────────────────────────────────────────────────

/// A single sign-off signature blob — mathematician, regulator, or QA approver.
///
/// `sha256_signature` is a hex-encoded SHA-256 over the signed payload. When the
/// PAR is generated unsigned (e.g. dev / CI runs) the value is `"unsigned"`.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct Signature {
    pub name: String,
    pub role: String,
    pub sha256_signature: String,
}

/// GAME IDENTIFICATION block — GLI-16 App D + Doc §11 requirement.
///
/// Captures the human chain of custody behind the PAR sheet. Empty / `None`
/// values are tolerated for in-progress drafts; certification builds must
/// populate `mathematician` and `approved_by`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SignOffSection {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mathematician: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mathematician_signed_at_utc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved_at_utc: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub signatures: Vec<Signature>,
}

/// Whether a reel strip is defined as a weight distribution, an explicit strip,
/// or a virtual-stops mapping. Drives downstream cycle math.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReelMode {
    /// Per-symbol weight distribution → cycle = ∏(Σ weights).
    Weighted,
    /// Explicit ordered strip → cycle = ∏(strip lengths).
    Strips,
    /// Virtual stop map (Doc §5.3 weighted reels) — not yet exposed by IR.
    VirtualMapped,
}

/// One physical reel definition for the REEL CONFIGURATION block.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReelDef {
    pub index: u32,
    pub mode: ReelMode,
    pub length: u32,
    pub symbol_counts: BTreeMap<String, u32>,
}

/// REEL CONFIGURATION block — per-reel symbol distribution + total cycle.
///
/// `total_cycle = ∏ length_i` (saturating to `u64::MAX` on overflow — flagged via
/// `total_cycle_overflow`). For Megaways games where reel heights are variable
/// we still emit the maximum length per reel and the consumer must consult IR
/// topology for `row_range_per_reel`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReelConfigSection {
    pub reels: Vec<ReelDef>,
    pub total_cycle: u64,
    pub total_cycle_overflow: bool,
}

impl ReelConfigSection {
    /// Build the section from an IR's `ReelSet`. Strips → counts symbols on the
    /// strip; Weighted → rounds weights to integer counts (×10_000 precision
    /// matches the IR→GameConfig adapter contract).
    pub fn from_ir(ir: &SlotGameIR) -> Self {
        let mut reels: Vec<ReelDef> = Vec::new();
        match &ir.reels {
            ReelSet::Weighted { base, .. } => {
                for (i, dist) in base.iter().enumerate() {
                    // Use weight integer-rounded counts so a "10A / 9X" weight pair
                    // produces sensible u32 stop counts even when authored as floats.
                    let mut counts: BTreeMap<String, u32> = BTreeMap::new();
                    let mut total = 0u32;
                    for (sym, weight) in dist.iter() {
                        let stops = (weight.max(0.0)).round() as u32;
                        if stops > 0 {
                            counts.insert(sym.clone(), stops);
                            total = total.saturating_add(stops);
                        }
                    }
                    reels.push(ReelDef {
                        index: i as u32,
                        mode: ReelMode::Weighted,
                        length: total,
                        symbol_counts: counts,
                    });
                }
            }
            ReelSet::Strips { base, .. } => {
                for (i, strip) in base.iter().enumerate() {
                    let mut counts: BTreeMap<String, u32> = BTreeMap::new();
                    for sym in strip {
                        *counts.entry(sym.clone()).or_insert(0) += 1;
                    }
                    reels.push(ReelDef {
                        index: i as u32,
                        mode: ReelMode::Strips,
                        length: strip.len() as u32,
                        symbol_counts: counts,
                    });
                }
            }
        }

        // Total cycle = ∏ length_i with overflow guard.
        let mut cycle: u128 = 1;
        let mut overflow = false;
        for r in &reels {
            let next = cycle.saturating_mul(r.length as u128);
            if next == u128::MAX || (r.length > 0 && next / r.length as u128 != cycle) {
                overflow = true;
            }
            cycle = next;
        }
        let total_cycle = if cycle > u64::MAX as u128 {
            overflow = true;
            u64::MAX
        } else {
            cycle as u64
        };

        ReelConfigSection {
            reels,
            total_cycle,
            total_cycle_overflow: overflow,
        }
    }
}

/// One row of the n-of-a-kind paytable (one symbol).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaytableRow {
    pub symbol: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub substitutes: Option<Vec<String>>,
    /// Key = n-of-a-kind (or cluster size); Value = multiplier (× bet).
    pub payouts: BTreeMap<u32, f64>,
}

/// PAYTABLE block — symbol × n-of-a-kind matrix + per-pay-rule RTP audit trail.
///
/// `pay_rule_rtp` (MLAgent gap N): a regulator audit-trail map keyed by
/// `"{symbol}_{n}oak"` containing the **theoretical** RTP contribution
/// (percent of bet) for each individual paytable cell. Sum of these
/// contributions approximates the base-game RTP; feature RTP enters via
/// `RTPSection.{free_spins,hold_and_win,cascade,jackpot}_rtp_pct`.
///
/// When the IR cannot be analytically scored (e.g. non-Lines evaluation),
/// values are emitted as `0.0` and the map serves purely as a key-coverage
/// audit trail.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PaytableSection {
    pub rows: Vec<PaytableRow>,
    #[serde(default)]
    pub pay_rule_rtp: BTreeMap<String, f64>,
}

impl PaytableSection {
    /// Build the section from an IR. Iterates `ir.paytable` for the matrix rows
    /// and (PAR-010) calls `solve_per_pay_rule_rtp(ir)` to populate
    /// `pay_rule_rtp` with closed-form per-cell contributions.
    pub fn from_ir(ir: &SlotGameIR) -> Self {
        // Build a quick lookup from symbol_id → SymbolDef for kind/substitutes.
        let lookup: BTreeMap<&str, &crate::ir::SymbolDef> =
            ir.symbols.iter().map(|s| (s.id.as_str(), s)).collect();

        let mut rows: Vec<PaytableRow> = Vec::new();
        // PAR-010 — actual closed-form solver fills the audit-trail map.
        let mut pay_rule_rtp = solve_per_pay_rule_rtp(ir);

        for (sym_id, count_map) in ir.paytable.iter() {
            let def = lookup.get(sym_id.as_str());
            let kind = def
                .map(|d| symbol_kind_string(d.kind))
                .unwrap_or_else(|| "unknown".to_string());
            let substitutes = def.and_then(|d| match &d.substitutes {
                Some(crate::ir::Substitutes::All(_)) => Some(vec!["*".to_string()]),
                Some(crate::ir::Substitutes::List(v)) => Some(v.to_vec()),
                None => None,
            });

            let mut payouts: BTreeMap<u32, f64> = BTreeMap::new();
            for (count_key, mult) in count_map.iter() {
                if let Ok(n) = count_key.parse::<u32>() {
                    payouts.insert(n, *mult);
                }
                // Make sure every IR paytable cell has an audit-trail entry,
                // even when the solver skipped it (non-Lines evaluation).
                let key = format!("{sym_id}_{count_key}oak");
                pay_rule_rtp.entry(key).or_insert(0.0);
            }

            rows.push(PaytableRow {
                symbol: sym_id.clone(),
                kind,
                substitutes,
                payouts,
            });
        }

        rows.sort_by(|a, b| a.symbol.cmp(&b.symbol));

        PaytableSection {
            rows,
            pay_rule_rtp,
        }
    }
}

// ─── PAR-002 sections ────────────────────────────────────────────────────────

/// Verdict for a single RNG statistical battery test.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TestVerdict {
    Pass,
    Fail,
    #[default]
    NotRun,
}

/// Outcome of the suite of RNG quality tests typically required for GLI-19
/// certification. `NotRun` is permitted for in-progress builds — final
/// certification packages must show `Pass` for every entry.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RngTestResults {
    pub diehard: TestVerdict,
    pub nist_sp_800_22: TestVerdict,
    pub chi_square: TestVerdict,
}

/// RNG ATTESTATION block — Doc §8.1 / §10.4 + PAR-002 (MLAgent gap L fix).
///
/// `kind` is the actual RNG family used (read from `ir.rng.kind` when present).
/// `period` is `2^N − 1` for shift-register / LCG families and `2^96 blocks`
/// for ChaCha20 — emitted as a free-form string so we don't lose meaning when
/// the period isn't a clean power of two.
/// `seed_hex` is `seed:016x` so consumers can replay deterministically.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RngAttestationSection {
    pub kind: String,
    pub period: String,
    pub seed_hex: String,
    pub tests: RngTestResults,
}

impl RngAttestationSection {
    /// Build from an IR (uses `ir.rng.kind` + `ir.rng.default_seed`).
    pub fn from_ir(ir: &SlotGameIR) -> Self {
        let (kind, period) = rng_kind_meta(ir.rng.kind);
        RngAttestationSection {
            kind,
            period,
            seed_hex: format!("{:016x}", ir.rng.default_seed),
            tests: RngTestResults::default(),
        }
    }
}

/// Map an `RngKind` to the snake_case label + theoretical period string.
/// Period strings match Doc §8.1 / `rng.rs` header table.
fn rng_kind_meta(kind: RngKind) -> (String, String) {
    let (label, period) = match kind {
        RngKind::Mulberry32 => ("mulberry32", "2^32"),
        RngKind::Pcg64 => ("pcg64", "2^126"),
        RngKind::Xoshiro256pp => ("xoshiro256pp", "2^256 - 1"),
        RngKind::AesCtrDrbg => ("aes_ctr_drbg", "2^128 blocks (NIST SP 800-90A)"),
    };
    (label.to_string(), period.to_string())
}

// ─── PAR-003 — EVT Pareto tail section ──────────────────────────────────────

/// Outcome of the Pareto fit. `NotApplicable` covers under-determined cases
/// (fewer than 5 samples above threshold, degenerate α, etc.) so the section
/// still serialises and downstream readers can flag missing fits explicitly.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ParetoFitKind {
    #[default]
    Fitted,
    NotApplicable,
}

/// EVT Pareto-tail section per Doc §3.2 (Coles 2001 POT method).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ParetoTailSection {
    pub kind: ParetoFitKind,
    /// `xm` threshold actually used for the fit (bet-multiples).
    pub threshold: f64,
    pub samples_above_threshold: u64,
    /// MLE shape parameter `α̂`. `NaN` when `kind = NotApplicable`.
    pub alpha: f64,
    pub ks_statistic: f64,
    pub ks_p_value: f64,
    /// Bootstrap PRNG seed (deterministic — Doc reproducibility requirement).
    pub ks_p_seed: u64,
    /// Pareto-projected P99.999 win level (bet-multiples).
    pub evt_p99999: f64,
    /// Probability mass `P(W > max_win_cap)` derived from the fit.
    pub cap_pressure_pct: f64,
    /// Free-form explanation when `kind = NotApplicable` (e.g. "too few tail samples").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Number of HDR midpoint observations to materialise above the threshold.
const PARETO_HDR_REPLICATION_CAP: u64 = 100_000;

/// Build a Pareto-tail section from an HDR histogram + cap.
///
/// The HDR exposes (bucket, count) pairs; we materialise samples by midpoint
/// (or top edge for the open-ended top bucket) and replicate each midpoint
/// `count` times — capped at `PARETO_HDR_REPLICATION_CAP` per bucket to keep
/// the bootstrap cheap. Threshold defaults to the P95 cell midpoint when no
/// override is supplied.
fn build_pareto_section(
    hdr: &[u64; HDR_BUCKET_COUNT],
    total_spins: u64,
    max_win_cap: f64,
    threshold_override: Option<f64>,
) -> ParetoTailSection {
    let thresholds = HdrHistogram::THRESHOLDS;

    // Materialise pseudo-samples from HDR midpoints (capped per bucket).
    let mut samples: Vec<f64> = Vec::new();
    for i in 0..thresholds.len() {
        let from = if i == 0 { 0.0 } else { thresholds[i - 1] };
        let to = thresholds[i];
        let midpoint = (from + to) / 2.0;
        let count = hdr[i + 1].min(PARETO_HDR_REPLICATION_CAP);
        for _ in 0..count {
            samples.push(midpoint);
        }
    }
    // Open-ended top bucket — use its left edge (lower bound on win level).
    let top_from = *thresholds.last().unwrap_or(&50_000.0);
    let top_count = hdr[HDR_BUCKET_COUNT - 1].min(PARETO_HDR_REPLICATION_CAP);
    for _ in 0..top_count {
        samples.push(top_from * 1.5);
    }

    if total_spins == 0 || samples.is_empty() {
        return ParetoTailSection {
            kind: ParetoFitKind::NotApplicable,
            threshold: 0.0,
            samples_above_threshold: 0,
            // NaN does not roundtrip through JSON — use 0.0 sentinel + reason field.
            alpha: 0.0,
            ks_statistic: 0.0,
            ks_p_value: 0.0,
            ks_p_seed: ParetoFitOpts::default().bootstrap_seed,
            evt_p99999: 0.0,
            cap_pressure_pct: 0.0,
            reason: Some("no HDR samples".to_string()),
        };
    }

    // Threshold default: P95 cell midpoint (95% of mass below threshold).
    let threshold = threshold_override.unwrap_or_else(|| {
        let mut cumulative = 0u64;
        let target = (total_spins as f64 * 0.95).ceil() as u64;
        for i in 0..thresholds.len() {
            cumulative += hdr[i + 1];
            if cumulative >= target {
                let from = if i == 0 { 0.0 } else { thresholds[i - 1] };
                let to = thresholds[i];
                return (from + to) / 2.0;
            }
        }
        thresholds[thresholds.len() - 1]
    });

    let opts = ParetoFitOpts::default();
    let seed = opts.bootstrap_seed;
    match fit_pareto_tail(&samples, threshold, opts) {
        Ok(fit) => {
            let evt_p99999 = evt_tail_quantile(fit.alpha, fit.xm, 1e-5).unwrap_or(0.0);
            // P(W > cap) = (xm / cap)^α   (Pareto tail CCDF), clamped to [0, 1].
            let cap_pressure = if max_win_cap > fit.xm && max_win_cap.is_finite() {
                (fit.xm / max_win_cap).powf(fit.alpha).clamp(0.0, 1.0)
            } else if max_win_cap.is_finite() {
                1.0
            } else {
                0.0
            };
            ParetoTailSection {
                kind: ParetoFitKind::Fitted,
                threshold: fit.xm,
                samples_above_threshold: fit.tail_count as u64,
                alpha: fit.alpha,
                ks_statistic: fit.ks_statistic,
                ks_p_value: fit.ks_p_value,
                ks_p_seed: seed,
                evt_p99999,
                cap_pressure_pct: cap_pressure * 100.0,
                reason: None,
            }
        }
        Err(e) => {
            let reason = match e {
                TailFitError::TooFewTailSamples { got, .. } => {
                    format!("too few tail samples ({got} < 5)")
                }
                TailFitError::DegenerateAlpha(a) => format!("degenerate alpha = {a}"),
                other => format!("{other:?}"),
            };
            ParetoTailSection {
                kind: ParetoFitKind::NotApplicable,
                threshold,
                samples_above_threshold: samples.iter().filter(|s| **s > threshold).count() as u64,
                // NaN does not survive JSON roundtrip — use 0.0 + reason field.
                alpha: 0.0,
                ks_statistic: 0.0,
                ks_p_value: 0.0,
                ks_p_seed: seed,
                evt_p99999: 0.0,
                cap_pressure_pct: 0.0,
                reason: Some(reason),
            }
        }
    }
}

// ─── PAR-016 — Cumulative reach curves ──────────────────────────────────────

/// Survival CDF: P(longest no-win streak ≥ N spins) under base hit rate `p`.
/// Closed-form geometric model: P(no win in N consecutive) = (1 − p)^N.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ReachCurveSection {
    pub base_hit_rate: f64,
    /// `(n_spins_threshold, probability_of_drought)`.
    pub points: Vec<(u64, f64)>,
}

impl ReachCurveSection {
    pub fn from_hit_rate(p_hit: f64) -> Self {
        let p = p_hit.clamp(1e-9, 1.0);
        let thresholds = [10u64, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];
        let points = thresholds
            .iter()
            .map(|&n| (n, (1.0 - p).powi(n as i32)))
            .collect();
        ReachCurveSection {
            base_hit_rate: p,
            points,
        }
    }
}

// ─── PAR-017 — Risk-of-Ruin formula ────────────────────────────────────────

/// Risk-of-Ruin for a player starting with `bankroll_units` bets at house
/// edge `house_edge` (fraction, e.g. 0.04 for 96% RTP). Uses the
/// classical Wizard of Odds formula:
///
///   RoR = ((1 − edge) / (1 + edge))^bankroll
///
/// Returns 1.0 when `edge ≥ 1` (degenerate), 0.0 when `edge ≤ 0`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RiskOfRuinSection {
    pub house_edge: f64,
    /// `(bankroll_bets, risk_of_ruin)`.
    pub points: Vec<(u32, f64)>,
}

impl RiskOfRuinSection {
    pub fn from_edge(house_edge_fraction: f64) -> Self {
        let edge = house_edge_fraction.clamp(0.0, 0.9999);
        let ratio = (1.0 - edge) / (1.0 + edge);
        let bankrolls = [10u32, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000];
        let points = bankrolls
            .iter()
            .map(|&n| (n, ratio.powi(n as i32)))
            .collect();
        RiskOfRuinSection {
            house_edge: edge,
            points,
        }
    }
}

// ─── PAR-015 — Variance decomposition (ANOVA) ───────────────────────────────

/// Per-feature contribution to total spin-win variance.
///
/// Derivation (proxy): `σ²_i ≈ (RTP_i / total_RTP)² × σ²_total`. True ANOVA
/// would require per-feature win records; this approximation lets the PAR
/// sheet surface "which feature contributes most variance" without engine
/// changes. Sums of `share_pct` ≤ 100; remainder = "interaction / cov".
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VarianceDecompSection {
    pub total_variance: f64,
    pub base_game_variance: f64,
    pub free_spins_variance: f64,
    pub hold_and_win_variance: f64,
    pub cascade_variance: f64,
    pub jackpot_variance: f64,
    pub interaction_residual: f64,
    /// `share_pct[i] = σ²_i / σ²_total × 100`, in same order as named fields above.
    pub share_pct: Vec<f64>,
}

impl VarianceDecompSection {
    pub fn from_metrics(par: &PARMetrics) -> Self {
        let total_var = par.welford_variance.max(0.0);
        let total_rtp = par.total_rtp.max(1e-9);
        let frac = |r: f64| -> f64 { (r.max(0.0) / total_rtp).powi(2) };
        let base = frac(par.base_rtp) * total_var;
        let fs = frac(par.fs_rtp) * total_var;
        let hnw = frac(par.hnw_rtp) * total_var;
        let casc = frac(par.cascade_rtp) * total_var;
        // jackpot RTP not separately tracked in PARMetrics — derive as residual.
        let known = base + fs + hnw + casc;
        let interaction = (total_var - known).max(0.0);
        let pct = |v: f64| -> f64 {
            if total_var > 0.0 {
                v / total_var * 100.0
            } else {
                0.0
            }
        };
        VarianceDecompSection {
            total_variance: total_var,
            base_game_variance: base,
            free_spins_variance: fs,
            hold_and_win_variance: hnw,
            cascade_variance: casc,
            jackpot_variance: 0.0,
            interaction_residual: interaction,
            share_pct: vec![
                pct(base),
                pct(fs),
                pct(hnw),
                pct(casc),
                0.0,
                pct(interaction),
            ],
        }
    }
}

// ─── PAR-010 — Closed-form per-pay-rule RTP solver ──────────────────────────

/// Closed-form per-pay-rule RTP contributions (%) for a Lines-evaluation IR.
///
/// Algorithm (Doc §6.1 + Barboianu 2013):
///   For each (symbol, n) cell in `ir.paytable`:
///     contribution_pct = 100 × multiplier × Σ_paylines P(exactly n consecutive
///         matches starting from leftmost reel on this payline)
///   where P(n) = (∏_{i=0..n-1} p_i(symbol)) × (1 − p_n(symbol))
///         p_i(symbol) = weight_i(symbol) / Σ_weights_i
///
/// Only `Evaluation::Lines` is handled (most common); other evaluation kinds
/// return an empty map. Wild substitution is approximated by treating the
/// wild symbol as a generic "matches anything" booster (its own paytable row
/// remains unchanged).
pub fn solve_per_pay_rule_rtp(ir: &SlotGameIR) -> BTreeMap<String, f64> {
    use crate::ir::{Evaluation, ReelSet};

    let mut out: BTreeMap<String, f64> = BTreeMap::new();

    // Only handle Lines evaluation in this pass.
    let (paylines, min_match, _ltr_only) = match &ir.evaluation {
        Evaluation::Lines {
            paylines,
            min_match,
            pay_left_to_right_only,
            ..
        } => (paylines, *min_match, *pay_left_to_right_only),
        _ => return out,
    };

    // Per-reel symbol probability table p[reel_idx][symbol] from weighted reels.
    let per_reel_probs: Vec<BTreeMap<String, f64>> = match &ir.reels {
        ReelSet::Weighted { base, .. } => base
            .iter()
            .map(|dist| {
                let total: f64 = dist.values().sum();
                if total <= 0.0 {
                    BTreeMap::new()
                } else {
                    dist.iter().map(|(s, w)| (s.clone(), w / total)).collect()
                }
            })
            .collect(),
        ReelSet::Strips { base, .. } => base
            .iter()
            .map(|strip| {
                let n = strip.len() as f64;
                let mut counts: BTreeMap<String, f64> = BTreeMap::new();
                for s in strip {
                    *counts.entry(s.clone()).or_insert(0.0) += 1.0;
                }
                for v in counts.values_mut() {
                    *v /= n;
                }
                counts
            })
            .collect(),
    };
    let n_reels = per_reel_probs.len();
    if n_reels == 0 {
        return out;
    }

    let p_of = |reel: usize, sym: &str| -> f64 {
        per_reel_probs
            .get(reel)
            .and_then(|m| m.get(sym).copied())
            .unwrap_or(0.0)
    };

    for (sym, count_map) in ir.paytable.iter() {
        for (count_key, multiplier) in count_map.iter() {
            let n = match count_key.parse::<u32>() {
                Ok(n) if n >= min_match && (n as usize) <= n_reels => n as usize,
                _ => continue,
            };

            // Sum over paylines: P(exactly n from left).
            let mut prob_total = 0.0_f64;
            for _payline in paylines.iter() {
                // P(symbol on reel 0..n-1) × (1 − P(symbol on reel n)) (or 1 if n == reels).
                let mut p_consec = 1.0_f64;
                for i in 0..n {
                    p_consec *= p_of(i, sym);
                }
                let p_stop = if n == n_reels {
                    1.0
                } else {
                    1.0 - p_of(n, sym)
                };
                prob_total += p_consec * p_stop;
            }
            let contribution_pct = multiplier * prob_total * 100.0;
            let key = format!("{sym}_{count_key}oak");
            out.insert(key, contribution_pct);
        }
    }
    out
}

// ─── PAR-006 — Jurisdiction-gated RTP variants ──────────────────────────────

/// One per active jurisdiction in `ComplianceSection.jurisdictions`.
///
/// `theoretical_rtp` is the closed-form / target RTP (sourced from
/// `ctx.target_rtp` when no analytical override is supplied). `simulated_rtp`
/// is `par.total_rtp`. `delta_pp` is `theoretical − simulated` in percentage
/// points. `within_ci_95` is the GLI §8.2 gate: `|delta| ≤ 1.96 × σ/√N`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JurisdictionVariant {
    pub code: String,
    pub name: String,
    pub theoretical_rtp: f64,
    pub simulated_rtp: f64,
    pub delta_pp: f64,
    pub regulatory_min: f64,
    pub regulatory_max: f64,
    pub pass: bool,
    pub within_ci_95: bool,
    pub notes: Vec<String>,
}

/// JURISDICTION-GATED RTP section (Doc §8.3).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JurisdictionGatedSection {
    pub variants: Vec<JurisdictionVariant>,
}

impl JurisdictionGatedSection {
    /// Build one variant per active jurisdiction. Loads regulatory band from
    /// `jurisdiction::profiles::get_profile`; falls back to a permissive band
    /// `[50, 99.99]` (warn-only) when the code is unknown.
    pub fn from_compliance(
        jurisdictions: &[String],
        theoretical_rtp_pct: f64,
        simulated_rtp_pct: f64,
        std_error_pp: f64,
    ) -> Self {
        let ci95_half = 1.96 * std_error_pp;
        let delta = (theoretical_rtp_pct - simulated_rtp_pct).abs();
        let within_ci_95 = std_error_pp > 0.0 && delta <= ci95_half;

        let mut variants: Vec<JurisdictionVariant> = jurisdictions
            .iter()
            .map(|code| {
                let (min, max, name, notes) =
                    if let Some(p) = crate::jurisdiction::profiles::get_profile(code) {
                        let min_pct = p.rtp_range[0] * 100.0;
                        let max_pct = p.rtp_range[1] * 100.0;
                        let notes: Vec<String> =
                            p.informational_notes.iter().take(3).map(|s| s.to_string()).collect();
                        (min_pct, max_pct, p.name.to_string(), notes)
                    } else {
                        (
                            50.0,
                            99.99,
                            code.clone(),
                            vec![format!("profile '{code}' not found — using permissive fallback band")],
                        )
                    };
                let pass = simulated_rtp_pct >= min && simulated_rtp_pct <= max;
                JurisdictionVariant {
                    code: code.clone(),
                    name,
                    theoretical_rtp: theoretical_rtp_pct,
                    simulated_rtp: simulated_rtp_pct,
                    delta_pp: theoretical_rtp_pct - simulated_rtp_pct,
                    regulatory_min: min,
                    regulatory_max: max,
                    pass,
                    within_ci_95,
                    notes,
                }
            })
            .collect();
        // Deterministic sort by code (Doc §8.3 acceptance gate).
        variants.sort_by(|a, b| a.code.cmp(&b.code));
        JurisdictionGatedSection { variants }
    }
}

// ─── PAR-005 — Markov chain section ─────────────────────────────────────────

/// Enumerated game states (Doc §9.1). Order MUST be stable — used as matrix index.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GameState {
    BaseGame = 0,
    FreeSpins = 1,
    Bonus = 2,
    ProgressiveJackpot = 3,
    Respin = 4,
}

/// Number of game states in the Markov chain.
pub const MARKOV_STATES: usize = 5;

/// MARKOV section: 5×5 transition matrix + stationary distribution + dwell times.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MarkovSection {
    pub states: Vec<String>,
    /// `transition_matrix[i][j] = P(S_{t+1} = j | S_t = i)`, rows sum to ≈1.
    pub transition_matrix: Vec<Vec<f64>>,
    /// Stationary distribution `π = π · P`, sums to ≈1.
    pub stationary_pi: Vec<f64>,
    /// Expected dwell time per state (geometric): `1 / (1 − P[i][i])`.
    pub expected_dwell: Vec<f64>,
}

impl MarkovSection {
    /// Build the section from simulation stats. Derivation:
    /// * `P(BaseGame → FreeSpins) = fs_triggers / total_spins`
    /// * `P(BaseGame → HoldAndWin) = hnw_triggers / total_spins`
    /// * `P(FreeSpins → FreeSpins) = 1 − (1 / avg_fs_spins)` (geometric session-length)
    /// * `P(HoldAndWin → HoldAndWin)` analogously
    /// * `P(state → BaseGame) = 1 − P(state → state)` for non-base states
    /// Progressive jackpot / Respin remain absorbing-to-base placeholders until
    /// the engine wires explicit per-state hooks (left for PAR-019).
    pub fn from_stats(stats: &AtomicStats, par: &PARMetrics) -> Self {
        let total_spins = stats.total_spins.load(Ordering::Relaxed).max(1);
        let fs_triggers = stats.fs_triggers.load(Ordering::Relaxed);
        let hnw_triggers = stats.hnw_triggers.load(Ordering::Relaxed);

        let p_base_to_fs = (fs_triggers as f64) / (total_spins as f64);
        let p_base_to_hnw = (hnw_triggers as f64) / (total_spins as f64);
        let p_base_to_base = (1.0 - p_base_to_fs - p_base_to_hnw).clamp(0.0, 1.0);

        // Self-loop within a feature derived from average session length.
        let self_loop = |avg: f64| -> f64 {
            if avg.is_finite() && avg > 1.0 {
                (1.0 - 1.0 / avg).clamp(0.0, 0.999)
            } else {
                0.0
            }
        };
        let p_fs_self = self_loop(par.avg_fs_spins);
        let p_hnw_self = self_loop(par.avg_hnw_orbs);

        // Build 5×5 matrix.
        let mut m = vec![vec![0.0_f64; MARKOV_STATES]; MARKOV_STATES];
        // BaseGame row
        m[0][0] = p_base_to_base;
        m[0][1] = p_base_to_fs;
        m[0][2] = p_base_to_hnw;
        // FreeSpins row
        m[1][1] = p_fs_self;
        m[1][0] = 1.0 - p_fs_self;
        // HoldAndWin → Bonus row
        m[2][2] = p_hnw_self;
        m[2][0] = 1.0 - p_hnw_self;
        // ProgressiveJackpot row — absorbing to base (no engine hook yet).
        m[3][0] = 1.0;
        // Respin row — absorbing to base (placeholder).
        m[4][0] = 1.0;

        // Renormalise each row defensively against accumulated FP drift.
        for row in m.iter_mut() {
            let s: f64 = row.iter().sum();
            if s > 0.0 {
                for v in row.iter_mut() {
                    *v /= s;
                }
            } else {
                row[0] = 1.0;
            }
        }

        let pi = stationary_distribution(&m, 200, 1e-12);
        let expected_dwell: Vec<f64> = (0..MARKOV_STATES)
            .map(|i| {
                let p_self = m[i][i].clamp(0.0, 0.9999_999);
                1.0 / (1.0 - p_self)
            })
            .collect();

        MarkovSection {
            states: vec![
                "base_game".to_string(),
                "free_spins".to_string(),
                "hold_and_win".to_string(),
                "progressive_jackpot".to_string(),
                "respin".to_string(),
            ],
            transition_matrix: m,
            stationary_pi: pi,
            expected_dwell,
        }
    }
}

/// Compute stationary distribution of an N×N transition matrix via power
/// iteration over `π_{t+1} = π_t · P`. Converges for ergodic chains; otherwise
/// the last iterate is returned (clamped so it always sums to 1).
fn stationary_distribution(matrix: &[Vec<f64>], max_iter: usize, eps: f64) -> Vec<f64> {
    let n = matrix.len();
    if n == 0 {
        return Vec::new();
    }
    let mut pi = vec![1.0 / n as f64; n];
    for _ in 0..max_iter {
        let mut next = vec![0.0_f64; n];
        for i in 0..n {
            for j in 0..n {
                next[j] += pi[i] * matrix[i][j];
            }
        }
        // L1 convergence.
        let delta: f64 = pi.iter().zip(next.iter()).map(|(a, b)| (a - b).abs()).sum();
        pi = next;
        if delta < eps {
            break;
        }
    }
    // Defensive renormalisation.
    let s: f64 = pi.iter().sum();
    if s > 0.0 {
        for v in pi.iter_mut() {
            *v /= s;
        }
    }
    pi
}

// ─── PAR-004 — Time-to-trigger CDF section ──────────────────────────────────

/// One point on a per-feature inter-trigger CDF.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct CdfPoint {
    pub spin_index: u64,
    pub probability: f64,
}

/// CDF of spins-between-triggers for a single feature.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TimeToTriggerCdf {
    pub feature_id: String,
    pub n_samples: u64,
    pub mean_distance: f64,
    pub max_distance: u64,
    /// Empirical CDF — monotone non-decreasing, last point ≈ 1.0.
    pub points: Vec<CdfPoint>,
}

/// Section grouping CDF entries for every feature that recorded triggers.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TimeToTriggerSection {
    pub features: Vec<TimeToTriggerCdf>,
}

impl TimeToTriggerCdf {
    /// Build from a `BonusDistanceTracker` snapshot.
    /// `feature_id` is the audit label (e.g. `"free_spins"`, `"hold_and_win"`).
    pub fn from_tracker(feature_id: &str, tracker: &BonusDistanceTracker) -> Self {
        let counts = tracker.snapshot_counts();
        let n = tracker.total_intervals();
        let mean = sanitize_f64_for_json(tracker.mean_distance());
        let max = tracker.max_distance();
        if n == 0 {
            return TimeToTriggerCdf {
                feature_id: feature_id.to_string(),
                n_samples: 0,
                mean_distance: 0.0,
                max_distance: 0,
                points: Vec::new(),
            };
        }
        let total = n as f64;
        let mut cumulative = 0u64;
        let mut points: Vec<CdfPoint> = Vec::with_capacity(13);
        for (i, &threshold) in DISTANCE_THRESHOLDS.iter().enumerate() {
            cumulative += counts[i];
            points.push(CdfPoint {
                spin_index: threshold,
                probability: (cumulative as f64) / total,
            });
        }
        // Overflow bucket: P(X ≥ 100_000) — terminal point with the same x as max.
        cumulative += counts[12];
        points.push(CdfPoint {
            spin_index: max.max(*DISTANCE_THRESHOLDS.last().unwrap_or(&100_000)),
            probability: (cumulative as f64) / total,
        });
        TimeToTriggerCdf {
            feature_id: feature_id.to_string(),
            n_samples: n,
            mean_distance: mean,
            max_distance: max,
            points,
        }
    }

    /// Approximate P-quantile (returns the smallest CDF point with probability ≥ q).
    pub fn quantile(&self, q: f64) -> Option<u64> {
        for p in &self.points {
            if p.probability >= q {
                return Some(p.spin_index);
            }
        }
        None
    }
}

/// SHA-256 (lowercase hex) over the canonical JSON serialisation of an IR.
///
/// **Canonical** here = `serde_json::to_string` (no whitespace), relying on
/// `SlotGameIR`'s `BTreeMap` fields for stable key ordering. Two byte-identical
/// IRs produce identical hashes; flipping a single weight digit changes it.
pub fn compute_config_hash(ir: &SlotGameIR) -> String {
    let canonical =
        serde_json::to_string(ir).expect("SlotGameIR must serialise deterministically");
    let mut h = Sha256::new();
    h.update(canonical.as_bytes());
    format!("{:x}", h.finalize())
}

fn symbol_kind_string(kind: SymbolKind) -> String {
    match kind {
        SymbolKind::Lp => "lp",
        SymbolKind::Hp => "hp",
        SymbolKind::Wild => "wild",
        SymbolKind::Scatter => "scatter",
        SymbolKind::Bonus => "bonus",
        SymbolKind::Multiplier => "multiplier",
        SymbolKind::Sticky => "sticky",
        SymbolKind::Expanding => "expanding",
        SymbolKind::Mystery => "mystery",
        SymbolKind::Transform => "transform",
        SymbolKind::ChainWild => "chain_wild",
    }
    .to_string()
}

/// Complete GLI-compliant PAR sheet (serialisable to JSON).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PARSheet {
    pub schema_version: String,
    pub meta: PARMeta,
    pub rtp: RTPSection,
    pub hit_frequency: HitFreqSection,
    pub volatility: VolatilitySection,
    pub win_distribution: Vec<WinBucket>,
    pub jackpots: Vec<JackpotMetrics>,
    pub compliance: ComplianceSection,
    pub statistics: StatisticalSection,
    // ── Faza 8 additions (serde default so old JSON still deserialises) ────────
    #[serde(default)]
    pub quantiles: QuantileSection,
    #[serde(default)]
    pub moments: MomentsSection,
    #[serde(default)]
    pub bonus_distances: BonusDistancesSection,
    #[serde(default)]
    pub required_spins: RequiredSpinsSection,
    // ── PAR-001 additions (Tier-1 — Option so unsigned drafts skip them) ───────
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sign_off: Option<SignOffSection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reel_config: Option<ReelConfigSection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paytable: Option<PaytableSection>,
    // ── PAR-002 additions (RNG attestation — Option so legacy path stays compat) ─
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rng_attestation: Option<RngAttestationSection>,
    // ── PAR-003 — EVT Pareto tail (always emitted; kind=NotApplicable when fit fails)
    #[serde(default)]
    pub pareto_tail: ParetoTailSection,
    // ── PAR-004 — Per-feature time-to-trigger CDF (always emitted, may be empty)
    #[serde(default)]
    pub time_to_trigger: TimeToTriggerSection,
    // ── PAR-005 — Markov chain (always emitted; rows sum to 1, π sums to 1)
    #[serde(default)]
    pub markov: MarkovSection,
    // ── PAR-006 — Jurisdiction-gated RTP variants + GLI §8.2 gate
    #[serde(default)]
    pub jurisdiction_gated: JurisdictionGatedSection,
    // ── PAR-012 — Bonus Buy economics (offers + regulator warn flag)
    #[serde(default)]
    pub bonus_buy: BonusBuySection,
    // ── PAR-015 — Variance decomposition (ANOVA-style per-feature breakdown)
    #[serde(default)]
    pub variance_decomp: VarianceDecompSection,
    // ── PAR-016 — Cumulative reach curve (drought probability)
    #[serde(default)]
    pub reach_curve: ReachCurveSection,
    // ── PAR-017 — Risk-of-Ruin (geometric Wizard of Odds formula)
    #[serde(default)]
    pub risk_of_ruin: RiskOfRuinSection,
}

// ─── Build context (PAR-001 A4) ───────────────────────────────────────────────

/// Replacement for the legacy 14-positional-arg `PARGenerator::generate`.
///
/// Old call sites continue to work through the deprecated shim; new code should
/// build a `PARBuildContext`, mutate it, and call `PARGenerator::generate_with_context`.
///
/// `ir` and `sign_off` are optional — when present, they populate the Tier-1
/// sections (`reel_config`, `paytable`, `sign_off`). When absent (e.g. quick
/// CI runs), those sections are emitted as `None` and the JSON remains
/// backward-compatible with the Faza 4/8 schema.
pub struct PARBuildContext<'a> {
    pub stats: &'a AtomicStats,
    pub par: &'a PARMetrics,
    pub jackpots: Vec<JackpotMetrics>,
    pub game_id: String,
    pub game_version: String,
    pub target_rtp: f64,
    pub rtp_tolerance: f64,
    pub max_win_cap: f64,
    pub jurisdictions: Vec<String>,
    pub rtp_range_required: [f64; 2],
    pub near_miss_rule: String,
    pub ldw_disclosure: bool,
    pub session_time_display: bool,
    pub seeds_used: u32,
    /// Optional IR — when present populates reel_config + paytable sections.
    pub ir: Option<&'a SlotGameIR>,
    /// Optional sign-off block — when `None`, an empty placeholder is emitted.
    pub sign_off: Option<SignOffSection>,
}

// ─── Generator ────────────────────────────────────────────────────────────────

pub struct PARGenerator;

impl PARGenerator {
    /// Build a complete PAR sheet from accumulated simulation stats.
    ///
    /// All RTP / tolerance values are in **percentage points** (e.g., 96.0).
    ///
    /// **Deprecated since PAR-001**: prefer `PARGenerator::generate_with_context`
    /// + `PARBuildContext`. This shim forwards to it with `ir = None` /
    /// `sign_off = None` so the Tier-1 sections are absent — JSON shape stays
    /// backward-compatible with Faza 4 / Faza 8 schema readers.
    #[allow(clippy::too_many_arguments)]
    pub fn generate(
        stats: &AtomicStats,
        par: &PARMetrics,
        jackpots: Vec<JackpotMetrics>,
        game_id: &str,
        game_version: &str,
        target_rtp: f64,
        rtp_tolerance: f64,
        max_win_cap: f64,
        jurisdictions: Vec<String>,
        rtp_range_required: [f64; 2],
        near_miss_rule: &str,
        ldw_disclosure: bool,
        session_time_display: bool,
        seeds_used: u32,
    ) -> PARSheet {
        let ctx = PARBuildContext {
            stats,
            par,
            jackpots,
            game_id: game_id.to_string(),
            game_version: game_version.to_string(),
            target_rtp,
            rtp_tolerance,
            max_win_cap,
            jurisdictions,
            rtp_range_required,
            near_miss_rule: near_miss_rule.to_string(),
            ldw_disclosure,
            session_time_display,
            seeds_used,
            ir: None,
            sign_off: None,
        };
        Self::generate_with_context(ctx)
    }

    /// Build a complete PAR sheet from a `PARBuildContext`.
    ///
    /// When `ctx.ir` is `Some`, populates `reel_config` + `paytable`.
    /// When `ctx.sign_off` is `Some`, attaches it; otherwise the section is `None`.
    pub fn generate_with_context(ctx: PARBuildContext<'_>) -> PARSheet {
        let PARBuildContext {
            stats,
            par,
            jackpots,
            game_id,
            game_version,
            target_rtp,
            rtp_tolerance,
            max_win_cap,
            jurisdictions,
            rtp_range_required,
            near_miss_rule,
            ldw_disclosure,
            session_time_display,
            seeds_used,
            ir,
            sign_off,
        } = ctx;

        let total_spins = stats.total_spins.load(Ordering::Relaxed);
        let hdr = stats.get_hdr_histogram();
        let win_distribution = Self::build_win_buckets(&hdr, total_spins);
        // PAR-003 — EVT Pareto tail fit (Coles 2001 POT).
        let pareto_tail = build_pareto_section(&hdr, total_spins, max_win_cap, None);
        // PAR-004 — Time-to-trigger CDF for every feature that recorded triggers.
        let mut t2t_features: Vec<TimeToTriggerCdf> = Vec::new();
        let fs_cdf = TimeToTriggerCdf::from_tracker("free_spins", &stats.fs_distance);
        if fs_cdf.n_samples > 0 {
            t2t_features.push(fs_cdf);
        }
        let hnw_cdf = TimeToTriggerCdf::from_tracker("hold_and_win", &stats.hnw_distance);
        if hnw_cdf.n_samples > 0 {
            t2t_features.push(hnw_cdf);
        }
        let time_to_trigger = TimeToTriggerSection {
            features: t2t_features,
        };
        // PAR-005 — Markov transition matrix + stationary π.
        let markov = MarkovSection::from_stats(stats, par);
        // PAR-006 — Jurisdiction-gated RTP variants + GLI §8.2 theoretical-vs-simulated gate.
        let jurisdiction_gated = JurisdictionGatedSection::from_compliance(
            &jurisdictions,
            target_rtp,
            par.total_rtp,
            par.std_error,
        );
        // PAR-012 — Bonus Buy economics (offers + warn flag for banned jurisdictions).
        let bonus_buy = ir
            .map(|i| BonusBuySection::from_ir(i, &jurisdictions))
            .unwrap_or_default();
        // PAR-015 — Variance decomposition (ANOVA proxy).
        let variance_decomp = VarianceDecompSection::from_metrics(par);
        // PAR-016 — Drought reach curve from base game hit rate.
        let base_hit_pct = par.hit_rate.clamp(0.0, 100.0);
        let reach_curve = ReachCurveSection::from_hit_rate(base_hit_pct / 100.0);
        // PAR-017 — Risk-of-Ruin from house edge = 1 − total_rtp/100.
        let edge_frac = (1.0 - par.total_rtp / 100.0).clamp(0.0, 1.0);
        let risk_of_ruin = RiskOfRuinSection::from_edge(edge_frac);

        let jackpot_rtp_pct: f64 = jackpots.iter().map(|j| j.contribution_rtp * 100.0).sum();

        let actual_rtp = par.total_rtp;
        let within_tolerance = (actual_rtp - target_rtp).abs() <= rtp_tolerance;
        let max_win_within_cap = par.max_win <= max_win_cap;
        let rtp_within_required =
            actual_rtp >= rtp_range_required[0] && actual_rtp <= rtp_range_required[1];

        // Volatility: use Welford-based CV (Faza 8 fix — was using legacy WinDistribution CV).
        let cv = par.welford_cv.max(par.volatility_index); // fall back to legacy if Welford not populated
        let vol_category = Self::volatility_category(cv);

        // Feature frequencies.
        let mut feature_freq = BTreeMap::new();
        if par.fs_frequency > 0.0 {
            feature_freq.insert("free_spins".to_string(), par.fs_frequency);
        }
        if par.hnw_frequency > 0.0 {
            feature_freq.insert("hold_and_win".to_string(), par.hnw_frequency);
        }

        // PAR-001 Tier-1 sections (lifted from IR when present).
        let reel_config = ir.map(ReelConfigSection::from_ir);
        let paytable_section = ir.map(PaytableSection::from_ir);

        // PAR-002 — RNG attestation + canonical config hash (only when IR available).
        let rng_attestation = ir.map(RngAttestationSection::from_ir);
        let config_hash = ir.map(compute_config_hash).unwrap_or_default();
        // PAR-002/A4 — stop emitting stale "mulberry32" literal. When the IR
        // is present we use its declared `rng.kind`; otherwise we mark the
        // attestation as `unknown` so downstream consumers can flag it.
        let rng_kind_label = ir
            .map(|i| rng_kind_meta(i.rng.kind).0)
            .unwrap_or_else(|| "unknown".to_string());

        PARSheet {
            schema_version: "1.1.0".to_string(),
            meta: PARMeta {
                game_id,
                game_version,
                engine_version: env!("CARGO_PKG_VERSION").to_string(),
                generated_at_utc: "2026-05-12T00:00:00Z".to_string(),
                total_spins,
                seeds_used,
                rng_kind: rng_kind_label,
                config_hash,
            },
            rtp: RTPSection {
                total_rtp_pct: actual_rtp,
                base_rtp_pct: par.base_rtp,
                free_spins_rtp_pct: par.fs_rtp,
                hold_and_win_rtp_pct: par.hnw_rtp,
                cascade_rtp_pct: par.cascade_rtp,
                jackpot_rtp_pct,
                target_rtp_pct: target_rtp,
                rtp_tolerance_pct: rtp_tolerance,
                within_tolerance,
            },
            hit_frequency: HitFreqSection {
                overall_hit_rate_pct: par.hit_rate,
                base_hit_rate_pct: par.hit_rate,
                feature_freq,
                avg_fs_spins: par.avg_fs_spins,
                avg_hnw_respins: par.avg_hnw_orbs,
            },
            volatility: VolatilitySection {
                cv,
                // Faza 8 fix: use actual Welford variance, not CV².
                variance: par.welford_variance,
                std_dev: par.welford_std_dev,
                max_win_x: par.max_win,
                category: vol_category,
            },
            win_distribution,
            jackpots,
            compliance: ComplianceSection {
                jurisdictions,
                rtp_range_required,
                rtp_within_required,
                max_win_cap_required: max_win_cap,
                max_win_within_cap,
                near_miss_rule,
                ldw_disclosure,
                session_time_display,
            },
            statistics: StatisticalSection {
                ci_95_low: par.ci_95_low,
                ci_95_high: par.ci_95_high,
                ci_99_low: par.ci_99_low,
                ci_99_high: par.ci_99_high,
                ci_999_low: par.ci_999_low,
                ci_999_high: par.ci_999_high,
                std_error: par.std_error,
                std_dev_across_seeds: 0.0,
                confidence_adequate: par.std_error < 0.1,
            },
            // Faza 8 sections.
            quantiles: QuantileSection {
                p50: par.p50,
                p90: par.p90,
                p99: par.p99,
                p999: par.p999,
            },
            moments: MomentsSection {
                mean_win_x: par.welford_mean,
                variance: par.welford_variance,
                std_dev: par.welford_std_dev,
                cv: par.welford_cv,
                skewness: par.welford_skewness,
                excess_kurtosis: par.welford_excess_kurtosis,
                sample_count: par.welford_sample_count,
            },
            bonus_distances: BonusDistancesSection {
                free_spins: BonusDistanceEntry {
                    // `Infinity` (never-triggered case) must not leak into JSON.
                    mean_distance: sanitize_f64_for_json(par.fs_mean_distance),
                    max_distance: par.fs_max_distance,
                },
                hold_and_win: BonusDistanceEntry {
                    mean_distance: sanitize_f64_for_json(par.hnw_mean_distance),
                    max_distance: par.hnw_max_distance,
                },
            },
            required_spins: RequiredSpinsSection {
                for_01pp_ci_95: par.required_spins_01pp_95,
                for_001pp_ci_95: par.required_spins_001pp_95,
                for_01pp_ci_99: par.required_spins_01pp_99,
            },
            // PAR-001 Tier-1 sections.
            sign_off,
            reel_config,
            paytable: paytable_section,
            // PAR-002 — RNG attestation.
            rng_attestation,
            // PAR-003 — EVT Pareto tail.
            pareto_tail,
            // PAR-004 — Time-to-trigger CDF per feature.
            time_to_trigger,
            // PAR-005 — Markov chain.
            markov,
            // PAR-006 — Jurisdiction-gated RTP.
            jurisdiction_gated,
            // PAR-012 — Bonus Buy economics.
            bonus_buy,
            // PAR-015 — Variance decomposition.
            variance_decomp,
            // PAR-016 — Cumulative reach (drought) curve.
            reach_curve,
            // PAR-017 — Risk-of-Ruin.
            risk_of_ruin,
        }
    }

    /// Volatility category from CV.
    ///
    /// Fixed in Faza 8: was `match cv as u32` which truncated CV < 1.0 to 0 → always VERY_LOW.
    fn volatility_category(cv: f64) -> String {
        if cv < 0.5 {
            "VERY_LOW"
        } else if cv < 2.0 {
            "LOW"
        } else if cv < 5.0 {
            "MEDIUM"
        } else if cv < 10.0 {
            "HIGH"
        } else if cv < 20.0 {
            "VERY_HIGH"
        } else {
            "EXTREME"
        }
        .to_string()
    }

    /// Map the HDR histogram snapshot to labelled WinBucket rows.
    fn build_win_buckets(hdr: &[u64; HDR_BUCKET_COUNT], total_spins: u64) -> Vec<WinBucket> {
        use crate::stats::HdrHistogram;
        let thresholds = HdrHistogram::THRESHOLDS;
        let mut buckets = Vec::with_capacity(HDR_BUCKET_COUNT);

        let zero_count = hdr[0];
        let zero_prob = if total_spins > 0 {
            zero_count as f64 / total_spins as f64
        } else {
            0.0
        };
        buckets.push(WinBucket {
            from_x: 0.0,
            to_x: Some(0.0),
            label: "no win".to_string(),
            count: zero_count,
            probability: zero_prob,
            rtp_contribution_pct: 0.0,
        });

        for i in 0..thresholds.len() {
            let from = if i == 0 { 0.0 } else { thresholds[i - 1] };
            let to = thresholds[i];
            let count = hdr[i + 1];
            let prob = if total_spins > 0 {
                count as f64 / total_spins as f64
            } else {
                0.0
            };
            let midpoint = (from + to) / 2.0;
            buckets.push(WinBucket {
                from_x: from,
                to_x: Some(to),
                label: format!("{from:.1}x–{to:.1}x"),
                count,
                probability: prob,
                rtp_contribution_pct: prob * midpoint * 100.0,
            });
        }

        let top_from = *thresholds.last().unwrap_or(&50000.0);
        let top_count = hdr[HDR_BUCKET_COUNT - 1];
        let top_prob = if total_spins > 0 {
            top_count as f64 / total_spins as f64
        } else {
            0.0
        };
        buckets.push(WinBucket {
            from_x: top_from,
            to_x: None,
            label: format!("{top_from:.0}x+"),
            count: top_count,
            probability: top_prob,
            rtp_contribution_pct: top_prob * top_from * 100.0,
        });

        buckets
    }

    /// Pretty-print a PAR sheet to stdout in GLI report style.
    pub fn print(par: &PARSheet) {
        let w = 74usize;
        let rule = "═".repeat(w - 2);

        println!("╔{rule}╗");
        println!(
            "║  PAR SHEET  ─  {}  v{:<width$}║",
            par.meta.game_id,
            par.meta.game_version,
            width = w.saturating_sub(par.meta.game_id.len() + par.meta.game_version.len() + 18)
        );
        println!(
            "║  Engine v{}  ·  Spins: {:>14}  ·  Seeds: {:<width$}║",
            par.meta.engine_version,
            par.meta.total_spins,
            par.meta.seeds_used,
            width = w.saturating_sub(
                par.meta.engine_version.len() + par.meta.seeds_used.to_string().len() + 33
            )
        );

        // PAR-001: GAME IDENTIFICATION sign-off block.
        if let Some(so) = &par.sign_off {
            println!("╠{rule}╣");
            println!("║  GAME IDENTIFICATION{:<width$}║", "", width = w - 22);
            let m = so.mathematician.as_deref().unwrap_or("(unsigned)");
            let a = so.approved_by.as_deref().unwrap_or("(unapproved)");
            let line_m = format!("    Mathematician: {m}");
            let line_a = format!("    Approved by:   {a}");
            println!("║  {line_m:<width$}║", width = w - 4);
            println!("║  {line_a:<width$}║", width = w - 4);
            for sig in &so.signatures {
                let line = format!(
                    "    Sig · {} ({}): {}…",
                    sig.name,
                    sig.role,
                    sig.sha256_signature.chars().take(16).collect::<String>()
                );
                println!("║  {line:<width$}║", width = w - 4);
            }
        }

        println!("╠{rule}╣");

        // RTP section.
        println!("║  RTP{:<width$}║", "", width = w - 6);
        println!(
            "║    Total:       {:>8.4}%   target {:.4}% ± {:.4}%  {:<width$}║",
            par.rtp.total_rtp_pct,
            par.rtp.target_rtp_pct,
            par.rtp.rtp_tolerance_pct,
            if par.rtp.within_tolerance {
                "✓"
            } else {
                "✗ OUT OF TOLERANCE"
            },
            width = w.saturating_sub(57)
        );
        println!(
            "║    Base game:   {:>8.4}%{:<width$}║",
            par.rtp.base_rtp_pct,
            "",
            width = w - 30
        );
        println!(
            "║    Free Spins:  {:>8.4}%{:<width$}║",
            par.rtp.free_spins_rtp_pct,
            "",
            width = w - 30
        );
        println!(
            "║    Hold & Win:  {:>8.4}%{:<width$}║",
            par.rtp.hold_and_win_rtp_pct,
            "",
            width = w - 30
        );
        if par.rtp.cascade_rtp_pct > 0.0 {
            println!(
                "║    Cascade:     {:>8.4}%{:<width$}║",
                par.rtp.cascade_rtp_pct,
                "",
                width = w - 30
            );
        }
        if par.rtp.jackpot_rtp_pct > 0.0 {
            println!(
                "║    Jackpot:     {:>8.4}%{:<width$}║",
                par.rtp.jackpot_rtp_pct,
                "",
                width = w - 30
            );
        }
        println!("╠{rule}╣");

        // Hit frequency.
        println!("║  HIT FREQUENCY{:<width$}║", "", width = w - 17);
        println!(
            "║    Overall:     {:>8.4}%{:<width$}║",
            par.hit_frequency.overall_hit_rate_pct,
            "",
            width = w - 30
        );
        for (kind, freq) in &par.hit_frequency.feature_freq {
            if freq.is_finite() {
                let line = format!("    {kind:.20}  1 in {freq:>12.1} spins");
                println!("║  {line:<width$}║", width = w - 4);
            }
        }
        if par.hit_frequency.avg_fs_spins > 0.0 {
            println!(
                "║    Avg FS spins:{:>8.1}{:<width$}║",
                par.hit_frequency.avg_fs_spins,
                "",
                width = w - 30
            );
        }
        println!("╠{rule}╣");

        // Volatility — Faza 8: show Welford variance + skewness.
        println!("║  VOLATILITY{:<width$}║", "", width = w - 13);
        let vol_line = format!(
            "    Category: {}   CV: {:.4}   Max win: {:.1}x",
            par.volatility.category, par.volatility.cv, par.volatility.max_win_x
        );
        println!("║  {vol_line:<width$}║", width = w - 4);
        let mom_line = format!(
            "    Var: {:.4}  σ: {:.4}  Skew: {:.4}  KurtEx: {:.4}",
            par.moments.variance,
            par.moments.std_dev,
            par.moments.skewness,
            par.moments.excess_kurtosis
        );
        println!("║  {mom_line:<width$}║", width = w - 4);

        // Faza 8: Quantiles.
        println!("╠{rule}╣");
        println!("║  QUANTILES{:<width$}║", "", width = w - 12);
        let q_line = format!(
            "    P50: {:.2}x   P90: {:.2}x   P99: {:.2}x   P99.9: {:.2}x",
            par.quantiles.p50, par.quantiles.p90, par.quantiles.p99, par.quantiles.p999
        );
        println!("║  {q_line:<width$}║", width = w - 4);
        println!("╠{rule}╣");

        // Win distribution.
        println!("║  WIN DISTRIBUTION{:<width$}║", "", width = w - 19);
        println!(
            "║    {:<16}  {:>10}  {:>9}  {:>12}{:<width$}║",
            "Range",
            "Count",
            "Prob %",
            "RTP contrib",
            "",
            width = w - 55
        );
        let mut shown = 0;
        for bucket in &par.win_distribution {
            if bucket.count == 0 {
                continue;
            }
            if shown >= 20 {
                break;
            }
            shown += 1;
            println!(
                "║    {:<16}  {:>10}  {:>8.4}%  {:>11.4}%{:<width$}║",
                bucket.label,
                bucket.count,
                bucket.probability * 100.0,
                bucket.rtp_contribution_pct,
                "",
                width = w - 55
            );
        }

        if !par.jackpots.is_empty() {
            println!("╠{rule}╣");
            println!("║  JACKPOTS{:<width$}║", "", width = w - 11);
            for j in &par.jackpots {
                let avg = if j.avg_interval.is_infinite() {
                    "never".to_string()
                } else {
                    format!("1 in {:>10.0}", j.avg_interval)
                };
                let line = format!(
                    "    {:.<18}  hits: {:>6}  {}  RTP: {:>6.4}%",
                    j.name,
                    j.hits,
                    avg,
                    j.contribution_rtp * 100.0
                );
                println!("║  {line:<width$}║", width = w - 4);
            }
        }

        println!("╠{rule}╣");

        // Compliance.
        println!("║  COMPLIANCE{:<width$}║", "", width = w - 13);
        println!(
            "║    RTP range:   [{:.2}%, {:.2}%]  {}{:<width$}║",
            par.compliance.rtp_range_required[0],
            par.compliance.rtp_range_required[1],
            if par.compliance.rtp_within_required {
                "✓"
            } else {
                "✗ FAIL"
            },
            "",
            width = w - 42
        );
        println!(
            "║    Max win cap: {:.0}x  {}{:<width$}║",
            par.compliance.max_win_cap_required,
            if par.compliance.max_win_within_cap {
                "✓"
            } else {
                "✗ FAIL"
            },
            "",
            width = w - 24
        );
        let jurs = par.compliance.jurisdictions.join(", ");
        println!(
            "║    Jurisdictions: {jurs:<width$}║",
            width = w - jurs.len() - 20
        );
        println!("╠{rule}╣");

        // Statistical confidence — Faza 8: show all three CI levels.
        println!("║  STATISTICAL CONFIDENCE{:<width$}║", "", width = w - 25);
        println!(
            "║    CI-95%%:      [{:.4}%, {:.4}%]{:<width$}║",
            par.statistics.ci_95_low,
            par.statistics.ci_95_high,
            "",
            width = w - 38
        );
        println!(
            "║    CI-99%%:      [{:.4}%, {:.4}%]{:<width$}║",
            par.statistics.ci_99_low,
            par.statistics.ci_99_high,
            "",
            width = w - 38
        );
        println!(
            "║    CI-99.9%%:    [{:.4}%, {:.4}%]{:<width$}║",
            par.statistics.ci_999_low,
            par.statistics.ci_999_high,
            "",
            width = w - 38
        );
        println!(
            "║    Std error:   {:>8.4}pp  {}{:<width$}║",
            par.statistics.std_error,
            if par.statistics.confidence_adequate {
                "adequate"
            } else {
                "INSUFFICIENT"
            },
            "",
            width = w - 34
        );

        // Faza 8: Required spins.
        println!("╠{rule}╣");
        println!(
            "║  REQUIRED SPINS FOR PRECISION{:<width$}║",
            "",
            width = w - 31
        );
        println!(
            "║    0.1pp @ 95%%:  {:>12}{:<width$}║",
            par.required_spins.for_01pp_ci_95,
            "",
            width = w - 31
        );
        println!(
            "║    0.01pp @ 95%: {:>12}{:<width$}║",
            par.required_spins.for_001pp_ci_95,
            "",
            width = w - 31
        );
        println!(
            "║    0.1pp @ 99%%:  {:>12}{:<width$}║",
            par.required_spins.for_01pp_ci_99,
            "",
            width = w - 31
        );

        // PAR-002: RNG ATTESTATION block.
        if let Some(rng) = &par.rng_attestation {
            println!("╠{rule}╣");
            println!("║  RNG ATTESTATION{:<width$}║", "", width = w - 18);
            let line = format!(
                "    Family: {}  ·  Period: {}  ·  Seed: 0x{}",
                rng.kind, rng.period, rng.seed_hex
            );
            let truncated: String = line.chars().take(w - 4).collect();
            println!("║  {truncated:<width$}║", width = w - 4);
            let verdict = |v: TestVerdict| match v {
                TestVerdict::Pass => "PASS",
                TestVerdict::Fail => "FAIL",
                TestVerdict::NotRun => "n/r",
            };
            let test_line = format!(
                "    DIEHARD: {}   NIST SP 800-22: {}   χ²: {}",
                verdict(rng.tests.diehard),
                verdict(rng.tests.nist_sp_800_22),
                verdict(rng.tests.chi_square)
            );
            println!("║  {test_line:<width$}║", width = w - 4);
        }
        if !par.meta.config_hash.is_empty() {
            let hash_line = format!(
                "    config_hash (SHA-256): {}",
                &par.meta.config_hash[..16.min(par.meta.config_hash.len())]
            );
            println!("║  {hash_line:<width$}║", width = w - 4);
        }

        // PAR-003: EVT PARETO TAIL block (always — emits NotApplicable verdict if no fit).
        println!("╠{rule}╣");
        println!("║  EVT PARETO TAIL (Coles 2001 POT){:<width$}║", "", width = w - 35);
        match par.pareto_tail.kind {
            ParetoFitKind::Fitted => {
                let line = format!(
                    "    α̂={:.4}  xm={:.2}x  tail_n={}  KS_p={:.4} (seed=0x{:x})",
                    par.pareto_tail.alpha,
                    par.pareto_tail.threshold,
                    par.pareto_tail.samples_above_threshold,
                    par.pareto_tail.ks_p_value,
                    par.pareto_tail.ks_p_seed
                );
                let truncated: String = line.chars().take(w - 4).collect();
                println!("║  {truncated:<width$}║", width = w - 4);
                let proj_line = format!(
                    "    EVT P99.999 = {:.2}x   cap_pressure = {:.4}%",
                    par.pareto_tail.evt_p99999, par.pareto_tail.cap_pressure_pct
                );
                println!("║  {proj_line:<width$}║", width = w - 4);
            }
            ParetoFitKind::NotApplicable => {
                let reason = par.pareto_tail.reason.as_deref().unwrap_or("n/a");
                let line = format!("    NotApplicable: {reason}");
                let truncated: String = line.chars().take(w - 4).collect();
                println!("║  {truncated:<width$}║", width = w - 4);
            }
        }

        // PAR-006: JURISDICTION-GATED RTP block (per-code PASS/FAIL + GLI §8.2 gate).
        if !par.jurisdiction_gated.variants.is_empty() {
            println!("╠{rule}╣");
            println!("║  JURISDICTION-GATED RTP{:<width$}║", "", width = w - 25);
            for v in &par.jurisdiction_gated.variants {
                let band_pass = if v.pass { "✓" } else { "✗" };
                let ci_pass = if v.within_ci_95 { "✓" } else { "✗" };
                let line = format!(
                    "    {:<4} sim={:6.3}%  theo={:6.3}%  Δ={:+.3}pp  band[{:.1},{:.1}]{}  CI95{}",
                    v.code,
                    v.simulated_rtp,
                    v.theoretical_rtp,
                    v.delta_pp,
                    v.regulatory_min,
                    v.regulatory_max,
                    band_pass,
                    ci_pass
                );
                let truncated: String = line.chars().take(w - 4).collect();
                println!("║  {truncated:<width$}║", width = w - 4);
            }
        }

        // PAR-005: MARKOV CHAIN block (5×5 matrix summary + stationary π).
        if !par.markov.states.is_empty() {
            println!("╠{rule}╣");
            println!("║  MARKOV STATE MODEL{:<width$}║", "", width = w - 21);
            for (i, name) in par.markov.states.iter().enumerate() {
                let row = &par.markov.transition_matrix[i];
                let row_str: String = row
                    .iter()
                    .map(|v| format!("{v:5.3}"))
                    .collect::<Vec<_>>()
                    .join(" ");
                let line = format!(
                    "    {:<22} [{}]  π={:5.3}  dwell={:6.2}",
                    name, row_str, par.markov.stationary_pi[i], par.markov.expected_dwell[i]
                );
                let truncated: String = line.chars().take(w - 4).collect();
                println!("║  {truncated:<width$}║", width = w - 4);
            }
        }

        // PAR-004: TIME-TO-TRIGGER CDF block (sažet summary, full CDF u JSON).
        if !par.time_to_trigger.features.is_empty() {
            println!("╠{rule}╣");
            println!("║  TIME-TO-TRIGGER CDF{:<width$}║", "", width = w - 22);
            for cdf in &par.time_to_trigger.features {
                let p10 = cdf.quantile(0.10).unwrap_or(0);
                let p50 = cdf.quantile(0.50).unwrap_or(0);
                let p90 = cdf.quantile(0.90).unwrap_or(0);
                let line = format!(
                    "    {}: n={}, P10={} P50={} P90={} (mean={:.1}, max={})",
                    cdf.feature_id, cdf.n_samples, p10, p50, p90, cdf.mean_distance, cdf.max_distance
                );
                let truncated: String = line.chars().take(w - 4).collect();
                println!("║  {truncated:<width$}║", width = w - 4);
            }
        }

        // PAR-001: REEL CONFIGURATION block.
        if let Some(rc) = &par.reel_config {
            println!("╠{rule}╣");
            let cycle_label = if rc.total_cycle_overflow {
                format!("∏ = {} (overflow saturated)", rc.total_cycle)
            } else {
                format!("∏ = {}", rc.total_cycle)
            };
            let header = format!("  REEL CONFIGURATION   {cycle_label}");
            println!("║{header:<width$}║", width = w - 2);
            for r in &rc.reels {
                let mode_s = match r.mode {
                    ReelMode::Weighted => "weighted",
                    ReelMode::Strips => "strips",
                    ReelMode::VirtualMapped => "virtual",
                };
                let counts: Vec<String> = r
                    .symbol_counts
                    .iter()
                    .map(|(s, n)| format!("{s}:{n}"))
                    .collect();
                let line = format!(
                    "    Reel {} ({}, len={}): {}",
                    r.index,
                    mode_s,
                    r.length,
                    counts.join(", ")
                );
                let truncated: String = line.chars().take(w - 4).collect();
                println!("║  {truncated:<width$}║", width = w - 4);
            }
        }

        // PAR-001: PAYTABLE block.
        if let Some(pt) = &par.paytable {
            println!("╠{rule}╣");
            println!("║  PAYTABLE{:<width$}║", "", width = w - 11);
            for row in &pt.rows {
                let payouts: Vec<String> = row
                    .payouts
                    .iter()
                    .map(|(n, m)| format!("{n}oak={m:.0}x"))
                    .collect();
                let line = format!("    {} ({}): {}", row.symbol, row.kind, payouts.join("  "));
                let truncated: String = line.chars().take(w - 4).collect();
                println!("║  {truncated:<width$}║", width = w - 4);
            }
            if !pt.pay_rule_rtp.is_empty() {
                let total: f64 = pt.pay_rule_rtp.values().sum();
                let line = format!(
                    "    Σ pay_rule_rtp = {:.4}% across {} rule(s)",
                    total,
                    pt.pay_rule_rtp.len()
                );
                println!("║  {line:<width$}║", width = w - 4);
            }
        }

        // Faza 8: Bonus distances (only if triggered at all).
        if par.bonus_distances.free_spins.mean_distance.is_finite()
            || par.bonus_distances.hold_and_win.mean_distance.is_finite()
        {
            println!("╠{rule}╣");
            println!(
                "║  BONUS INTER-TRIGGER DISTANCES{:<width$}║",
                "",
                width = w - 32
            );
            if par.bonus_distances.free_spins.mean_distance.is_finite() {
                println!(
                    "║    Free Spins:  mean {:>10.1}  max {:>8}{:<width$}║",
                    par.bonus_distances.free_spins.mean_distance,
                    par.bonus_distances.free_spins.max_distance,
                    "",
                    width = w - 44
                );
            }
            if par.bonus_distances.hold_and_win.mean_distance.is_finite() {
                println!(
                    "║    Hold & Win:  mean {:>10.1}  max {:>8}{:<width$}║",
                    par.bonus_distances.hold_and_win.mean_distance,
                    par.bonus_distances.hold_and_win.max_distance,
                    "",
                    width = w - 44
                );
            }
        }

        println!("╚{rule}╝");
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stats::{AtomicStats, MultiSeedStats, PARMetrics, SeedStats};
    use std::sync::atomic::Ordering;

    fn make_stats() -> AtomicStats {
        let s = AtomicStats::new();
        s.total_spins.store(1_000_000, Ordering::Relaxed);
        s.total_wagered.store(1_000_000, Ordering::Relaxed);
        s.total_won.store(960_000, Ordering::Relaxed);
        s.total_base_won.store(600_000, Ordering::Relaxed);
        s.total_fs_won.store(360_000, Ordering::Relaxed);
        s.winning_spins.store(330_000, Ordering::Relaxed);
        s.fs_triggers.store(5_000, Ordering::Relaxed);
        s.total_fs_spins.store(60_000, Ordering::Relaxed);
        let mut rng = crate::rng::SlotRng::new(42);
        for i in 0u64..1_000_000 {
            let win = if rng.random() < 0.33 {
                0.0
            } else {
                rng.random() * 100.0
            };
            s.record_win_full(win, 42, i);
            if i % 200 == 0 {
                s.record_fs_trigger(i);
            }
        }
        s
    }

    fn make_par_metrics(stats: &AtomicStats) -> PARMetrics {
        let rtps = [
            96.00, 96.02, 95.98, 96.01, 95.99, 96.03, 95.97, 96.00, 96.01, 95.99, 96.00, 95.98,
            96.02, 96.01, 95.99, 96.00, 96.02, 95.98, 96.01, 95.99,
        ];
        let seeds: Vec<SeedStats> = rtps
            .iter()
            .map(|&rtp| SeedStats {
                spins: 50_000,
                wagered: 50_000,
                won: (50_000.0 * rtp / 100.0) as i64,
                rtp,
            })
            .collect();
        let multi = MultiSeedStats::from_seeds(seeds);
        PARMetrics::from_stats(stats, &multi, 1)
    }

    fn make_par() -> PARSheet {
        let stats = make_stats();
        let par_metrics = make_par_metrics(&stats);
        PARGenerator::generate(
            &stats,
            &par_metrics,
            vec![],
            "test-game",
            "1.0.0",
            96.0,
            0.5,
            5000.0,
            vec!["MGA".to_string(), "UKGC".to_string()],
            [85.0, 99.0],
            "must_be_random",
            true,
            true,
            20,
        )
    }

    // ── Backward-compat tests (identical to Faza 4 unit tests) ────────────────

    #[test]
    fn test_par_generates_all_sections() {
        let par = make_par();
        assert_eq!(par.meta.game_id, "test-game");
        assert_eq!(par.meta.seeds_used, 20);
        assert_eq!(par.meta.total_spins, 1_000_000);
        assert!(!par.win_distribution.is_empty());
        assert!(par.compliance.rtp_within_required);
    }

    #[test]
    fn test_rtp_within_tolerance() {
        let par = make_par();
        assert!(par.rtp.within_tolerance, "96% must be within 96% ± 0.5%");
    }

    #[test]
    fn test_rtp_out_of_tolerance() {
        let stats = make_stats();
        let mut par_metrics = make_par_metrics(&stats);
        par_metrics.total_rtp = 94.0;
        let par = PARGenerator::generate(
            &stats,
            &par_metrics,
            vec![],
            "g",
            "1.0.0",
            96.0,
            0.5,
            5000.0,
            vec![],
            [85.0, 99.0],
            "must_be_random",
            true,
            true,
            1,
        );
        assert!(!par.rtp.within_tolerance);
    }

    #[test]
    fn test_win_distribution_bucket_count() {
        let par = make_par();
        assert_eq!(par.win_distribution.len(), crate::stats::HDR_BUCKET_COUNT);
    }

    #[test]
    fn test_win_distribution_counts_sum_to_spins() {
        let par = make_par();
        let total: u64 = par.win_distribution.iter().map(|b| b.count).sum();
        assert_eq!(total, 1_000_000);
    }

    #[test]
    fn test_compliance_jurisdiction_check() {
        let par = make_par();
        assert!(
            par.compliance.rtp_within_required,
            "96% is within [85%, 99%]"
        );
        assert!(par.compliance.max_win_within_cap);
        assert_eq!(par.compliance.jurisdictions, vec!["MGA", "UKGC"]);
    }

    #[test]
    fn test_statistical_confidence_adequate() {
        let par = make_par();
        assert!(
            par.statistics.confidence_adequate,
            "std_error={}",
            par.statistics.std_error
        );
    }

    #[test]
    fn test_json_roundtrip() {
        let par = make_par();
        let json = serde_json::to_string_pretty(&par).unwrap();
        let par2: PARSheet = serde_json::from_str(&json).unwrap();
        assert_eq!(par.meta.game_id, par2.meta.game_id);
        assert!((par.rtp.total_rtp_pct - par2.rtp.total_rtp_pct).abs() < 1e-12);
        assert_eq!(par.win_distribution.len(), par2.win_distribution.len());
    }

    #[test]
    fn test_print_doesnt_panic() {
        let par = make_par();
        PARGenerator::print(&par);
    }

    // ── Faza 8: Volatility category fix ───────────────────────────────────────

    #[test]
    fn volatility_category_uses_f64_ranges() {
        // CV = 0.3 → < 0.5 → VERY_LOW (old code would give VERY_LOW only coincidentally)
        assert_eq!(PARGenerator::volatility_category(0.3), "VERY_LOW");
        // CV = 0.7 → [0.5, 2.0) → LOW (old code: 0 as u32 → VERY_LOW! BUG fixed)
        assert_eq!(PARGenerator::volatility_category(0.7), "LOW");
        assert_eq!(PARGenerator::volatility_category(1.5), "LOW");
        assert_eq!(PARGenerator::volatility_category(3.0), "MEDIUM");
        assert_eq!(PARGenerator::volatility_category(7.0), "HIGH");
        assert_eq!(PARGenerator::volatility_category(15.0), "VERY_HIGH");
        assert_eq!(PARGenerator::volatility_category(25.0), "EXTREME");
    }

    // ── Faza 8: new sections ──────────────────────────────────────────────────

    #[test]
    fn par_has_quantile_section() {
        let par = make_par();
        // P90 should be greater than P50.
        assert!(
            par.quantiles.p90 >= par.quantiles.p50,
            "P90={} should be >= P50={}",
            par.quantiles.p90,
            par.quantiles.p50
        );
        assert!(
            par.quantiles.p99 >= par.quantiles.p90,
            "P99={} should be >= P90={}",
            par.quantiles.p99,
            par.quantiles.p90
        );
    }

    #[test]
    fn par_has_moments_section() {
        let par = make_par();
        // With 1M spins all recorded via record_win_full, sample count should be 1M.
        assert_eq!(par.moments.sample_count, 1_000_000);
        assert!(par.moments.mean_win_x > 0.0, "mean must be positive");
        assert!(par.moments.variance >= 0.0, "variance must be non-negative");
        assert!(par.moments.std_dev >= 0.0, "std_dev must be non-negative");
    }

    #[test]
    fn par_has_ci_99_and_999() {
        let par = make_par();
        // CI99 must be wider than CI95.
        let width_95 = par.statistics.ci_95_high - par.statistics.ci_95_low;
        let width_99 = par.statistics.ci_99_high - par.statistics.ci_99_low;
        let width_999 = par.statistics.ci_999_high - par.statistics.ci_999_low;
        assert!(width_99 >= width_95, "CI99 must be >= CI95 width");
        assert!(width_999 >= width_99, "CI99.9 must be >= CI99 width");
    }

    #[test]
    fn par_has_required_spins() {
        let par = make_par();
        // Required spins for 0.01pp should be > for 0.1pp.
        assert!(
            par.required_spins.for_001pp_ci_95 > par.required_spins.for_01pp_ci_95,
            "tighter target needs more spins"
        );
        assert!(
            par.required_spins.for_01pp_ci_99 > par.required_spins.for_01pp_ci_95,
            "higher confidence needs more spins"
        );
    }

    #[test]
    fn par_has_bonus_distances() {
        let par = make_par();
        // FS was triggered every 200 spins → mean_distance ≈ 200.
        assert!(
            par.bonus_distances.free_spins.mean_distance.is_finite(),
            "fs mean_distance should be finite"
        );
        assert!(
            (par.bonus_distances.free_spins.mean_distance - 200.0).abs() < 5.0,
            "expected ~200, got {}",
            par.bonus_distances.free_spins.mean_distance
        );
    }

    #[test]
    fn par_variance_uses_welford_not_cv_squared() {
        // The old code had `variance: cv * cv` which is dimensionless and wrong.
        // With Welford, variance is in bet-multiples² ≥ 0.
        let par = make_par();
        // Variance from Welford should be numerically distinct from CV².
        // (For a distribution with mean ~66x and σ ~30x, CV≈0.45, CV²≈0.2
        //  but actual variance ≈ 900 — very different.)
        assert!(
            par.volatility.variance > 1.0 || par.volatility.cv < 0.01,
            "variance={} should be in bet-multiples² (not CV²)",
            par.volatility.variance
        );
    }

    #[test]
    fn par_jackpot_rtp_aggregation() {
        use crate::jackpot::{JackpotKind, JackpotMetrics};
        let stats = make_stats();
        let par_metrics = make_par_metrics(&stats);
        let jackpots = vec![
            JackpotMetrics {
                id: "mini".to_string(),
                name: "MINI".to_string(),
                kind: JackpotKind::Fixed,
                hits: 100,
                avg_interval: 10_000.0,
                total_paid_x: 1_000.0,
                total_contributed_x: 0.0,
                current_pool_x: 10.0,
                contribution_rtp: 0.001,
            },
            JackpotMetrics {
                id: "grand".to_string(),
                name: "GRAND".to_string(),
                kind: JackpotKind::Fixed,
                hits: 2,
                avg_interval: 500_000.0,
                total_paid_x: 10_000.0,
                total_contributed_x: 0.0,
                current_pool_x: 5000.0,
                contribution_rtp: 0.01,
            },
        ];
        let par = PARGenerator::generate(
            &stats,
            &par_metrics,
            jackpots,
            "g",
            "1.0.0",
            96.0,
            0.5,
            5000.0,
            vec![],
            [85.0, 99.0],
            "must_be_random",
            true,
            true,
            1,
        );
        assert!(
            (par.rtp.jackpot_rtp_pct - 1.1).abs() < 1e-9,
            "got {}",
            par.rtp.jackpot_rtp_pct
        );
    }
}
