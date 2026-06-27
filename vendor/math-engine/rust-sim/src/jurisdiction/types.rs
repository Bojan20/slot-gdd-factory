//! Faza 11.9 — Jurisdiction types (Rust).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViolationSeverity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplianceViolation {
    pub rule_id: String,
    pub jurisdiction: String,
    pub severity: ViolationSeverity,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    pub can_auto_fix: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplianceSummary {
    pub errors: usize,
    pub warnings: usize,
    pub infos: usize,
    pub auto_fixable: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplianceReport {
    pub checked_jurisdictions: Vec<String>,
    pub violations: Vec<ComplianceViolation>,
    pub is_compliant: bool,
    pub auto_fixable: bool,
    pub summary: ComplianceSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppliedFix {
    pub rule_id: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoFixResult {
    pub applied_fixes: Vec<AppliedFix>,
    pub remaining_violations: Vec<ComplianceViolation>,
    pub is_fully_compliant: bool,
}

/// Stake limit by age band (e.g. UKGC 18-24 = £2, 25+ = £5).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AgeTier {
    pub min_age: u8,
    pub max_age: u8,
    pub max_stake: f64,
}

/// Jurisdiction requirements profile.
#[derive(Debug, Clone)]
pub struct JurisdictionProfile {
    pub id: &'static str,
    pub name: &'static str,
    pub rtp_range: [f64; 2],
    pub max_win_x: Option<f64>,
    pub prohibited_features: &'static [&'static str],
    pub require_ldw_disclosure: bool,
    pub require_session_time_display: bool,
    pub required_near_miss_rule: Option<&'static str>,
    pub informational_notes: &'static [&'static str],

    // ─── Faza 11.9+ extensions (stake / pacing / wagering) ──────────────────
    /// Default max stake per game cycle (£/€/$), if regulator caps it.
    pub max_stake_default: Option<f64>,
    /// Per-age-band stake limits (e.g. UKGC 18-24 = £2, 25+ = £5).
    pub age_tiered_stakes: &'static [AgeTier],
    /// Minimum spin/game-cycle duration in ms (e.g. UKGC RTS 14D = 2500ms).
    pub min_spin_duration_ms: Option<u32>,
    /// Auto-play prohibited (UKGC, ADM…).
    pub prohibit_autoplay: bool,
    /// Turbo / quick-spin prohibited (UKGC RTS 14D).
    pub prohibit_turbo: bool,
    /// Bonus/promo wagering multiplier cap (e.g. UKGC = 10x).
    pub bonus_wagering_cap_x: Option<u32>,
    /// ISO date the listed rules became effective.
    pub effective_from: Option<&'static str>,
    /// Primary regulator source URL.
    pub regulator_url: &'static str,
}

impl JurisdictionProfile {
    /// Resolve the maximum stake for a player based on age (if age-tiered),
    /// falling back to `max_stake_default`. Returns `None` when the
    /// jurisdiction imposes no stake cap.
    ///
    /// Behaviour:
    /// - If `age_tiered_stakes` is non-empty AND `player_age` is provided,
    ///   the lowest matching tier's `max_stake` is returned. This is
    ///   conservative on overlap (defensive: pick the stricter limit).
    /// - If `player_age` is provided but no tier matches (age out of any
    ///   declared band), return `None` (caller must reject — unknown band
    ///   should never silently default to "allow").
    /// - If `age_tiered_stakes` is empty OR `player_age` is `None`, fall
    ///   back to `max_stake_default`.
    pub fn resolve_stake_cap(&self, player_age: Option<u8>) -> Option<f64> {
        if !self.age_tiered_stakes.is_empty() {
            if let Some(age) = player_age {
                let mut best: Option<f64> = None;
                for tier in self.age_tiered_stakes {
                    if age >= tier.min_age && age <= tier.max_age {
                        best = Some(match best {
                            None => tier.max_stake,
                            Some(cur) => cur.min(tier.max_stake),
                        });
                    }
                }
                return best; // None ⇒ unknown band — caller MUST reject
            }
            // Tiered profile without an age supplied — conservative: use
            // the *minimum* of all declared caps (strictest).
            let mut min_cap = f64::INFINITY;
            for tier in self.age_tiered_stakes {
                if tier.max_stake < min_cap {
                    min_cap = tier.max_stake;
                }
            }
            if min_cap.is_finite() {
                return Some(min_cap);
            }
        }
        self.max_stake_default
    }

    /// `true` when this profile carries any *runtime-enforceable* rule
    /// (stake, pacing, wagering, autoplay/turbo bans). Used to short-circuit
    /// runtime checks when not needed.
    pub fn has_runtime_rules(&self) -> bool {
        self.max_stake_default.is_some()
            || !self.age_tiered_stakes.is_empty()
            || self.min_spin_duration_ms.is_some()
            || self.prohibit_autoplay
            || self.prohibit_turbo
            || self.bonus_wagering_cap_x.is_some()
    }
}

// ─── Runtime compliance error (sloj-3 enforcement) ──────────────────────────

/// Reasons a runtime spin/wager/bonus call may be rejected by the
/// jurisdiction adapter. Distinct from `ComplianceViolation` which targets
/// static IR validation — this one fires per *event*.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ComplianceError {
    /// Stake exceeds the resolved per-cycle cap.
    StakeOverCap {
        jurisdiction: String,
        stake: f64,
        cap: f64,
    },
    /// Age provided but no tier matched (unknown band).
    UnknownAgeBand { jurisdiction: String, age: u8 },
    /// Age required (age-tiered jurisdiction) but not supplied.
    AgeRequired { jurisdiction: String },
    /// Stake is non-positive, NaN, or infinite.
    InvalidStake { jurisdiction: String, stake: f64 },
    /// Spin duration too short under regulator pacing rule.
    SpinTooFast {
        jurisdiction: String,
        actual_ms: u32,
        min_ms: u32,
    },
    /// Auto-play attempted in a jurisdiction that bans it.
    AutoplayProhibited { jurisdiction: String },
    /// Turbo / quick-spin attempted in a jurisdiction that bans it.
    TurboProhibited { jurisdiction: String },
    /// Bonus wagering requirement exceeds the regulator cap.
    BonusWageringOverCap {
        jurisdiction: String,
        wagering_x: u32,
        cap_x: u32,
    },
    /// Profile id is unknown to the registry.
    UnknownJurisdiction { jurisdiction: String },
}

impl std::fmt::Display for ComplianceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ComplianceError::StakeOverCap {
                jurisdiction,
                stake,
                cap,
            } => write!(
                f,
                "{jurisdiction}: stake {stake} exceeds per-cycle cap {cap}"
            ),
            ComplianceError::UnknownAgeBand { jurisdiction, age } => write!(
                f,
                "{jurisdiction}: age {age} does not match any declared band"
            ),
            ComplianceError::AgeRequired { jurisdiction } => write!(
                f,
                "{jurisdiction}: player age required for age-tiered stake resolution"
            ),
            ComplianceError::InvalidStake {
                jurisdiction,
                stake,
            } => write!(
                f,
                "{jurisdiction}: stake {stake} is not a finite positive number"
            ),
            ComplianceError::SpinTooFast {
                jurisdiction,
                actual_ms,
                min_ms,
            } => write!(
                f,
                "{jurisdiction}: spin duration {actual_ms}ms below regulator minimum {min_ms}ms"
            ),
            ComplianceError::AutoplayProhibited { jurisdiction } => {
                write!(f, "{jurisdiction}: auto-play prohibited")
            }
            ComplianceError::TurboProhibited { jurisdiction } => {
                write!(f, "{jurisdiction}: turbo / quick-spin prohibited")
            }
            ComplianceError::BonusWageringOverCap {
                jurisdiction,
                wagering_x,
                cap_x,
            } => {
                write!(
                    f,
                    "{jurisdiction}: bonus wagering {wagering_x}x exceeds cap {cap_x}x"
                )
            }
            ComplianceError::UnknownJurisdiction { jurisdiction } => {
                write!(f, "unknown jurisdiction profile '{jurisdiction}'")
            }
        }
    }
}

impl std::error::Error for ComplianceError {}
