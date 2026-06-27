//! Faza 11.9 — Jurisdiction Adapter (Rust).
//!
//! Implements compliance validation and auto-fix for SlotGameIR
//! against registered jurisdiction profiles.

use super::profiles::{get_profile, ALL_PROFILES};
use super::types::{
    AppliedFix, AutoFixResult, ComplianceError, ComplianceReport, ComplianceSummary,
    ComplianceViolation, JurisdictionProfile, ViolationSeverity,
};
use crate::ir::{Feature, NearMissRule, SlotGameIR};

// ─── feature kind helper ────────────────────────────────────────────────────

fn feature_kind(f: &Feature) -> &'static str {
    match f {
        Feature::FreeSpins { .. } => "free_spins",
        Feature::HoldAndWin { .. } => "hold_and_win",
        Feature::Cascade { .. } => "cascade",
        Feature::Respin { .. } => "respin",
        Feature::Pick { .. } => "pick",
        Feature::Wheel { .. } => "wheel",
        Feature::BuyFeature { .. } => "buy_feature",
        Feature::AnteBet { .. } => "ante_bet",
        Feature::Gamble { .. } => "gamble",
        Feature::MysterySymbol { .. } => "mystery_symbol",
        Feature::SymbolUpgrade { .. } => "symbol_upgrade",
        Feature::LinearProgressive { .. } => "linear_progressive",
    }
}

// ─── rule checkers ──────────────────────────────────────────────────────────

fn check_rtp(ir: &SlotGameIR, profile: &JurisdictionProfile) -> Vec<ComplianceViolation> {
    let mut violations = Vec::new();
    let rtp = ir.limits.target_rtp;
    let [min, max] = profile.rtp_range;

    if rtp < min || rtp > max {
        violations.push(ComplianceViolation {
            rule_id: format!("{}-RTP-001", profile.id),
            jurisdiction: profile.id.to_string(),
            severity: ViolationSeverity::Error,
            message: format!(
                "target_rtp {:.4} is outside {} allowed range [{}, {}].",
                rtp, profile.name, min, max
            ),
            field: Some("limits.target_rtp".to_string()),
            can_auto_fix: false,
        });
    }

    let [req_min, req_max] = ir.compliance.rtp_range_required;
    if (req_min - min).abs() > f64::EPSILON || (req_max - max).abs() > f64::EPSILON {
        violations.push(ComplianceViolation {
            rule_id: format!("{}-RTP-002", profile.id),
            jurisdiction: profile.id.to_string(),
            severity: ViolationSeverity::Warning,
            message: format!(
                "compliance.rtp_range_required [{}, {}] does not match {} range [{}, {}].",
                req_min, req_max, profile.name, min, max
            ),
            field: Some("compliance.rtp_range_required".to_string()),
            can_auto_fix: true,
        });
    }

    violations
}

fn check_max_win(ir: &SlotGameIR, profile: &JurisdictionProfile) -> Vec<ComplianceViolation> {
    if let Some(cap) = profile.max_win_x {
        if ir.limits.max_win_x > cap {
            return vec![ComplianceViolation {
                rule_id: format!("{}-MAXWIN-001", profile.id),
                jurisdiction: profile.id.to_string(),
                severity: ViolationSeverity::Error,
                message: format!(
                    "max_win_x {} exceeds {} cap of {}.",
                    ir.limits.max_win_x, profile.name, cap
                ),
                field: Some("limits.max_win_x".to_string()),
                can_auto_fix: true,
            }];
        }
    }
    vec![]
}

fn check_prohibited_features(
    ir: &SlotGameIR,
    profile: &JurisdictionProfile,
) -> Vec<ComplianceViolation> {
    let mut violations = Vec::new();
    for &prohibited in profile.prohibited_features {
        if ir.features.iter().any(|f| feature_kind(f) == prohibited) {
            let feature_tag = prohibited.replace('_', "").to_uppercase();
            violations.push(ComplianceViolation {
                rule_id: format!("{}-FEAT-{}", profile.id, feature_tag),
                jurisdiction: profile.id.to_string(),
                severity: ViolationSeverity::Error,
                message: format!(
                    "Feature '{}' is prohibited in {}.",
                    prohibited, profile.name
                ),
                field: Some("features".to_string()),
                can_auto_fix: true,
            });
        }
    }
    violations
}

/// Check IR-declared stake configuration against profile cap.
///
/// We probe both `bet.base_bet` and every `bet.denominations` entry; if any
/// declared bet exceeds the regulator cap, the IR is non-compliant.
fn check_stake_cap(ir: &SlotGameIR, profile: &JurisdictionProfile) -> Vec<ComplianceViolation> {
    let mut violations = Vec::new();

    // Conservative cap: use the strictest of the declared bands when no age
    // is in context (static IR check).
    let cap = profile.resolve_stake_cap(None);
    let Some(cap) = cap else { return violations };

    if ir.bet.base_bet > cap {
        violations.push(ComplianceViolation {
            rule_id: format!("{}-STAKE-001", profile.id),
            jurisdiction: profile.id.to_string(),
            severity: ViolationSeverity::Error,
            message: format!(
                "bet.base_bet {} exceeds {} per-cycle stake cap {}.",
                ir.bet.base_bet, profile.name, cap
            ),
            field: Some("bet.base_bet".to_string()),
            can_auto_fix: true,
        });
    }

    if let Some(max_den) = ir
        .bet
        .denominations
        .iter()
        .copied()
        .filter(|d| d.is_finite())
        .fold(None, |acc: Option<f64>, d| {
            Some(acc.map_or(d, |m| m.max(d)))
        })
    {
        if max_den > cap {
            violations.push(ComplianceViolation {
                rule_id: format!("{}-STAKE-002", profile.id),
                jurisdiction: profile.id.to_string(),
                severity: ViolationSeverity::Error,
                message: format!(
                    "bet.denominations contains {} which exceeds {} per-cycle stake cap {}.",
                    max_den, profile.name, cap
                ),
                field: Some("bet.denominations".to_string()),
                can_auto_fix: true,
            });
        }
    }

    // Sanity: invalid declarations (NaN, ≤0, infinite) — never auto-fix.
    if !ir.bet.base_bet.is_finite() || ir.bet.base_bet <= 0.0 {
        violations.push(ComplianceViolation {
            rule_id: format!("{}-STAKE-003", profile.id),
            jurisdiction: profile.id.to_string(),
            severity: ViolationSeverity::Error,
            message: format!(
                "bet.base_bet {} is not a finite positive number.",
                ir.bet.base_bet
            ),
            field: Some("bet.base_bet".to_string()),
            can_auto_fix: false,
        });
    }

    violations
}

/// Check auto-play / turbo bans against the feature list and AnteBet.
///
/// In the current IR we don't model autoplay / turbo as Feature variants —
/// they're presentation-layer toggles. We still surface an `Info` note so
/// the front-end build pipeline catches it. If a future IR adds explicit
/// `AutoPlay { .. }` or `Turbo { .. }` features, those would surface as
/// Error here.
fn check_autoplay_turbo(
    _ir: &SlotGameIR,
    profile: &JurisdictionProfile,
) -> Vec<ComplianceViolation> {
    let mut violations = Vec::new();
    if profile.prohibit_autoplay {
        violations.push(ComplianceViolation {
            rule_id: format!("{}-AUTOPLAY-001", profile.id),
            jurisdiction: profile.id.to_string(),
            severity: ViolationSeverity::Info,
            message: format!(
                "{}: auto-play UI/feature must be disabled in client build.",
                profile.name
            ),
            field: None,
            can_auto_fix: false,
        });
    }
    if profile.prohibit_turbo {
        violations.push(ComplianceViolation {
            rule_id: format!("{}-TURBO-001", profile.id),
            jurisdiction: profile.id.to_string(),
            severity: ViolationSeverity::Info,
            message: format!(
                "{}: turbo / quick-spin UI must be disabled in client build.",
                profile.name
            ),
            field: None,
            can_auto_fix: false,
        });
    }
    violations
}

/// Check pacing rule (min spin duration) — informational at IR level; the
/// runtime `validate_spin_duration` enforces it per-event.
fn check_pacing(_ir: &SlotGameIR, profile: &JurisdictionProfile) -> Vec<ComplianceViolation> {
    if let Some(min_ms) = profile.min_spin_duration_ms {
        return vec![ComplianceViolation {
            rule_id: format!("{}-PACING-001", profile.id),
            jurisdiction: profile.id.to_string(),
            severity: ViolationSeverity::Info,
            message: format!(
                "{}: minimum {}ms per game cycle — client spin animation must enforce.",
                profile.name, min_ms
            ),
            field: None,
            can_auto_fix: false,
        }];
    }
    vec![]
}

/// Check wagering cap — informational at IR level; runtime
/// `validate_bonus_wagering` enforces it per bonus award.
fn check_wagering(_ir: &SlotGameIR, profile: &JurisdictionProfile) -> Vec<ComplianceViolation> {
    if let Some(cap_x) = profile.bonus_wagering_cap_x {
        return vec![ComplianceViolation {
            rule_id: format!("{}-WAGERING-001", profile.id),
            jurisdiction: profile.id.to_string(),
            severity: ViolationSeverity::Info,
            message: format!(
                "{}: bonus wagering requirement capped at {}x.",
                profile.name, cap_x
            ),
            field: None,
            can_auto_fix: false,
        }];
    }
    vec![]
}

fn check_compliance(ir: &SlotGameIR, profile: &JurisdictionProfile) -> Vec<ComplianceViolation> {
    let mut violations = Vec::new();

    if profile.require_ldw_disclosure && !ir.compliance.ldw_disclosure {
        violations.push(ComplianceViolation {
            rule_id: format!("{}-LDW-001", profile.id),
            jurisdiction: profile.id.to_string(),
            severity: ViolationSeverity::Error,
            message: format!("{} requires ldw_disclosure to be true.", profile.name),
            field: Some("compliance.ldw_disclosure".to_string()),
            can_auto_fix: true,
        });
    }

    if profile.require_session_time_display && !ir.compliance.session_time_display {
        violations.push(ComplianceViolation {
            rule_id: format!("{}-SESSION-001", profile.id),
            jurisdiction: profile.id.to_string(),
            severity: ViolationSeverity::Error,
            message: format!("{} requires session_time_display to be true.", profile.name),
            field: Some("compliance.session_time_display".to_string()),
            can_auto_fix: true,
        });
    }

    if let Some(required_rule) = profile.required_near_miss_rule {
        let current = match ir.compliance.near_miss_rule {
            NearMissRule::MustBeRandom => "must_be_random",
            NearMissRule::AllowedWithinDistribution => "allowed_within_distribution",
        };
        if current != required_rule {
            violations.push(ComplianceViolation {
                rule_id: format!("{}-NEARMISS-001", profile.id),
                jurisdiction: profile.id.to_string(),
                severity: ViolationSeverity::Error,
                message: format!(
                    "{} requires near_miss_rule to be '{}', got '{}'.",
                    profile.name, required_rule, current
                ),
                field: Some("compliance.near_miss_rule".to_string()),
                can_auto_fix: true,
            });
        }
    }

    violations
}

fn check_jurisdiction_declared(
    ir: &SlotGameIR,
    profile: &JurisdictionProfile,
) -> Vec<ComplianceViolation> {
    if !ir
        .compliance
        .jurisdictions
        .contains(&profile.id.to_string())
    {
        return vec![ComplianceViolation {
            rule_id: format!("{}-DECL-001", profile.id),
            jurisdiction: profile.id.to_string(),
            severity: ViolationSeverity::Warning,
            message: format!(
                "Jurisdiction '{}' is not declared in compliance.jurisdictions.",
                profile.id
            ),
            field: Some("compliance.jurisdictions".to_string()),
            can_auto_fix: true,
        }];
    }
    vec![]
}

fn check_informational(profile: &JurisdictionProfile) -> Vec<ComplianceViolation> {
    profile
        .informational_notes
        .iter()
        .enumerate()
        .map(|(idx, note)| ComplianceViolation {
            rule_id: format!("{}-INFO-{:03}", profile.id, idx + 1),
            jurisdiction: profile.id.to_string(),
            severity: ViolationSeverity::Info,
            message: note.to_string(),
            field: None,
            can_auto_fix: false,
        })
        .collect()
}

// ─── apply fix ──────────────────────────────────────────────────────────────

fn apply_fix(
    ir: &mut SlotGameIR,
    violation: &ComplianceViolation,
    profile: &JurisdictionProfile,
) -> Option<AppliedFix> {
    let rule_id = &violation.rule_id;

    if rule_id.ends_with("-RTP-002") {
        let [min, max] = profile.rtp_range;
        ir.compliance.rtp_range_required = [min, max];
        return Some(AppliedFix {
            rule_id: rule_id.clone(),
            description: format!(
                "Set compliance.rtp_range_required to [{}, {}] for {}.",
                min, max, profile.id
            ),
        });
    }

    if rule_id.ends_with("-MAXWIN-001") {
        if let Some(cap) = profile.max_win_x {
            ir.limits.max_win_x = cap;
            ir.compliance.max_win_cap_required = cap;
            return Some(AppliedFix {
                rule_id: rule_id.clone(),
                description: format!("Capped max_win_x to {} for {}.", cap, profile.id),
            });
        }
    }

    if rule_id.contains("-FEAT-") {
        // Determine the prohibited kind from the profile (match rule suffix)
        // The rule_id is like "UKGC-FEAT-GAMBLE" or "UKGC-FEAT-BUYFEATURE"
        let before = ir.features.len();
        for &prohibited in profile.prohibited_features {
            let feature_tag = prohibited.replace('_', "").to_uppercase();
            let expected_rule = format!("{}-FEAT-{}", profile.id, feature_tag);
            if rule_id == &expected_rule {
                ir.features.retain(|f| feature_kind(f) != prohibited);
                let removed = before - ir.features.len();
                if removed > 0 {
                    return Some(AppliedFix {
                        rule_id: rule_id.clone(),
                        description: format!(
                            "Removed {} '{}' feature(s) prohibited by {}.",
                            removed, prohibited, profile.id
                        ),
                    });
                }
                break;
            }
        }
        return None;
    }

    if rule_id.ends_with("-LDW-001") {
        ir.compliance.ldw_disclosure = true;
        return Some(AppliedFix {
            rule_id: rule_id.clone(),
            description: format!("Set compliance.ldw_disclosure = true for {}.", profile.id),
        });
    }

    if rule_id.ends_with("-SESSION-001") {
        ir.compliance.session_time_display = true;
        return Some(AppliedFix {
            rule_id: rule_id.clone(),
            description: format!(
                "Set compliance.session_time_display = true for {}.",
                profile.id
            ),
        });
    }

    if rule_id.ends_with("-NEARMISS-001") {
        if let Some(required) = profile.required_near_miss_rule {
            if required == "must_be_random" {
                ir.compliance.near_miss_rule = NearMissRule::MustBeRandom;
                return Some(AppliedFix {
                    rule_id: rule_id.clone(),
                    description: format!(
                        "Set compliance.near_miss_rule = 'must_be_random' for {}.",
                        profile.id
                    ),
                });
            }
        }
    }

    if rule_id.ends_with("-STAKE-001") {
        if let Some(cap) = profile.resolve_stake_cap(None) {
            let old = ir.bet.base_bet;
            ir.bet.base_bet = cap;
            return Some(AppliedFix {
                rule_id: rule_id.clone(),
                description: format!(
                    "Capped bet.base_bet from {} to {} for {}.",
                    old, cap, profile.id
                ),
            });
        }
        return None;
    }

    if rule_id.ends_with("-STAKE-002") {
        if let Some(cap) = profile.resolve_stake_cap(None) {
            let before = ir.bet.denominations.len();
            ir.bet
                .denominations
                .retain(|d| d.is_finite() && *d > 0.0 && *d <= cap);
            let removed = before - ir.bet.denominations.len();
            return Some(AppliedFix {
                rule_id: rule_id.clone(),
                description: format!(
                    "Dropped {} denomination(s) over {} stake cap {} for {}.",
                    removed, profile.name, cap, profile.id
                ),
            });
        }
        return None;
    }

    if rule_id.ends_with("-DECL-001") {
        let jid = profile.id.to_string();
        if !ir.compliance.jurisdictions.contains(&jid) {
            ir.compliance.jurisdictions.push(jid);
        }
        return Some(AppliedFix {
            rule_id: rule_id.clone(),
            description: format!("Added '{}' to compliance.jurisdictions.", profile.id),
        });
    }

    None
}

// ─── public API ─────────────────────────────────────────────────────────────

/// Resolve jurisdictions: use explicit list, fall back to IR declarations,
/// fall back to all profiles.
fn resolve_jurisdictions<'a>(ir: &SlotGameIR, explicit: &'a [&'a str]) -> Vec<String> {
    if !explicit.is_empty() {
        return explicit.iter().map(|s| s.to_string()).collect();
    }
    if !ir.compliance.jurisdictions.is_empty() {
        return ir.compliance.jurisdictions.clone();
    }
    ALL_PROFILES.iter().map(|p| p.id.to_string()).collect()
}

/// Validate an IR against the given jurisdictions (or all if empty).
pub fn validate(ir: &SlotGameIR, jurisdictions: &[&str]) -> ComplianceReport {
    let resolved = resolve_jurisdictions(ir, jurisdictions);
    let mut violations: Vec<ComplianceViolation> = Vec::new();

    for jid in &resolved {
        match get_profile(jid) {
            None => {
                violations.push(ComplianceViolation {
                    rule_id: format!("{}-UNKNOWN-001", jid),
                    jurisdiction: jid.clone(),
                    severity: ViolationSeverity::Warning,
                    message: format!("Unknown jurisdiction '{}' — no profile available.", jid),
                    field: None,
                    can_auto_fix: false,
                });
            }
            Some(profile) => {
                violations.extend(check_rtp(ir, profile));
                violations.extend(check_max_win(ir, profile));
                violations.extend(check_prohibited_features(ir, profile));
                violations.extend(check_stake_cap(ir, profile));
                violations.extend(check_autoplay_turbo(ir, profile));
                violations.extend(check_pacing(ir, profile));
                violations.extend(check_wagering(ir, profile));
                violations.extend(check_compliance(ir, profile));
                violations.extend(check_jurisdiction_declared(ir, profile));
                violations.extend(check_informational(profile));
            }
        }
    }

    let errors = violations
        .iter()
        .filter(|v| v.severity == ViolationSeverity::Error)
        .count();
    let warnings = violations
        .iter()
        .filter(|v| v.severity == ViolationSeverity::Warning)
        .count();
    let infos = violations
        .iter()
        .filter(|v| v.severity == ViolationSeverity::Info)
        .count();
    let auto_fixable = violations.iter().filter(|v| v.can_auto_fix).count();

    ComplianceReport {
        checked_jurisdictions: resolved,
        violations,
        is_compliant: errors == 0,
        auto_fixable: auto_fixable > 0,
        summary: ComplianceSummary {
            errors,
            warnings,
            infos,
            auto_fixable,
        },
    }
}

/// Auto-fix all fixable violations in a clone of the IR. Returns the modified IR and fix result.
pub fn auto_fix(ir: &SlotGameIR, jurisdictions: &[&str]) -> (SlotGameIR, AutoFixResult) {
    let resolved = resolve_jurisdictions(ir, jurisdictions);
    let resolved_refs: Vec<&str> = resolved.iter().map(|s| s.as_str()).collect();
    let mut working = ir.clone();

    let initial_report = validate(&working, &resolved_refs);
    let mut applied_fixes: Vec<AppliedFix> = Vec::new();

    for violation in initial_report.violations.iter().filter(|v| v.can_auto_fix) {
        if let Some(profile) = get_profile(&violation.jurisdiction) {
            if let Some(fix) = apply_fix(&mut working, violation, profile) {
                applied_fixes.push(fix);
            }
        }
    }

    // Re-validate after fixes
    let final_report = validate(&working, &resolved_refs);
    let remaining_violations: Vec<ComplianceViolation> = final_report
        .violations
        .into_iter()
        .filter(|v| {
            v.severity == ViolationSeverity::Error || v.severity == ViolationSeverity::Warning
        })
        .collect();

    let result = AutoFixResult {
        applied_fixes,
        remaining_violations,
        is_fully_compliant: final_report.is_compliant,
    };

    (working, result)
}

// ─── Runtime enforcement (sloj 3) ───────────────────────────────────────────
//
// These functions are called per-event from the engine / orchestrator, *not*
// from the static IR pipeline. They return `Result<(), ComplianceError>` so
// the caller can fail fast and surface a structured error to the client.

/// Validate a stake against the resolved per-cycle cap for `jurisdiction`.
///
/// - `stake` must be finite and `> 0`.
/// - If the profile is age-tiered and `player_age` is `None`, returns
///   `AgeRequired` — there is no safe default for an age-gated rule.
/// - If `player_age` is supplied but falls outside every declared band,
///   returns `UnknownAgeBand` (fail closed).
/// - Returns `StakeOverCap` if `stake > cap`.
pub fn validate_stake(
    jurisdiction: &str,
    stake: f64,
    player_age: Option<u8>,
) -> Result<(), ComplianceError> {
    let profile =
        get_profile(jurisdiction).ok_or_else(|| ComplianceError::UnknownJurisdiction {
            jurisdiction: jurisdiction.to_string(),
        })?;

    if !stake.is_finite() || stake <= 0.0 {
        return Err(ComplianceError::InvalidStake {
            jurisdiction: jurisdiction.to_string(),
            stake,
        });
    }

    // Age-tiered jurisdictions must have an age supplied at runtime.
    if !profile.age_tiered_stakes.is_empty() && player_age.is_none() {
        return Err(ComplianceError::AgeRequired {
            jurisdiction: jurisdiction.to_string(),
        });
    }

    // If an age was provided but doesn't match any band, fail closed.
    if !profile.age_tiered_stakes.is_empty() {
        if let Some(age) = player_age {
            let any_match = profile
                .age_tiered_stakes
                .iter()
                .any(|t| age >= t.min_age && age <= t.max_age);
            if !any_match {
                return Err(ComplianceError::UnknownAgeBand {
                    jurisdiction: jurisdiction.to_string(),
                    age,
                });
            }
        }
    }

    if let Some(cap) = profile.resolve_stake_cap(player_age) {
        if stake > cap {
            return Err(ComplianceError::StakeOverCap {
                jurisdiction: jurisdiction.to_string(),
                stake,
                cap,
            });
        }
    }

    Ok(())
}

/// Validate that a spin animation honoured the regulator pacing floor.
pub fn validate_spin_duration(jurisdiction: &str, actual_ms: u32) -> Result<(), ComplianceError> {
    let profile =
        get_profile(jurisdiction).ok_or_else(|| ComplianceError::UnknownJurisdiction {
            jurisdiction: jurisdiction.to_string(),
        })?;
    if let Some(min_ms) = profile.min_spin_duration_ms {
        if actual_ms < min_ms {
            return Err(ComplianceError::SpinTooFast {
                jurisdiction: jurisdiction.to_string(),
                actual_ms,
                min_ms,
            });
        }
    }
    Ok(())
}

/// Reject an auto-play attempt in any jurisdiction that bans it.
pub fn validate_autoplay(jurisdiction: &str) -> Result<(), ComplianceError> {
    let profile =
        get_profile(jurisdiction).ok_or_else(|| ComplianceError::UnknownJurisdiction {
            jurisdiction: jurisdiction.to_string(),
        })?;
    if profile.prohibit_autoplay {
        return Err(ComplianceError::AutoplayProhibited {
            jurisdiction: jurisdiction.to_string(),
        });
    }
    Ok(())
}

/// Reject a turbo / quick-spin attempt in any jurisdiction that bans it.
pub fn validate_turbo(jurisdiction: &str) -> Result<(), ComplianceError> {
    let profile =
        get_profile(jurisdiction).ok_or_else(|| ComplianceError::UnknownJurisdiction {
            jurisdiction: jurisdiction.to_string(),
        })?;
    if profile.prohibit_turbo {
        return Err(ComplianceError::TurboProhibited {
            jurisdiction: jurisdiction.to_string(),
        });
    }
    Ok(())
}

/// Validate a bonus wagering requirement against the regulator cap.
pub fn validate_bonus_wagering(jurisdiction: &str, wagering_x: u32) -> Result<(), ComplianceError> {
    let profile =
        get_profile(jurisdiction).ok_or_else(|| ComplianceError::UnknownJurisdiction {
            jurisdiction: jurisdiction.to_string(),
        })?;
    if let Some(cap_x) = profile.bonus_wagering_cap_x {
        if wagering_x > cap_x {
            return Err(ComplianceError::BonusWageringOverCap {
                jurisdiction: jurisdiction.to_string(),
                wagering_x,
                cap_x,
            });
        }
    }
    Ok(())
}

/// Convenience wrapper: validate a complete `SpinContext` against a
/// jurisdiction in one call.
///
/// Fails fast on the first violation — returns a `Vec<ComplianceError>` only
/// in the batched variant `validate_spin_full`.
pub fn validate_spin(ctx: &SpinContext<'_>) -> Result<(), ComplianceError> {
    if ctx.autoplay {
        validate_autoplay(ctx.jurisdiction)?;
    }
    if ctx.turbo {
        validate_turbo(ctx.jurisdiction)?;
    }
    validate_stake(ctx.jurisdiction, ctx.stake, ctx.player_age)?;
    if let Some(dur) = ctx.spin_duration_ms {
        validate_spin_duration(ctx.jurisdiction, dur)?;
    }
    Ok(())
}

/// Validate a spin and collect **every** violation rather than short-circuit.
/// Returns an empty Vec when compliant.
pub fn validate_spin_full(ctx: &SpinContext<'_>) -> Vec<ComplianceError> {
    let mut errs = Vec::new();
    if ctx.autoplay {
        if let Err(e) = validate_autoplay(ctx.jurisdiction) {
            errs.push(e);
        }
    }
    if ctx.turbo {
        if let Err(e) = validate_turbo(ctx.jurisdiction) {
            errs.push(e);
        }
    }
    if let Err(e) = validate_stake(ctx.jurisdiction, ctx.stake, ctx.player_age) {
        errs.push(e);
    }
    if let Some(dur) = ctx.spin_duration_ms {
        if let Err(e) = validate_spin_duration(ctx.jurisdiction, dur) {
            errs.push(e);
        }
    }
    errs
}

/// Per-spin runtime context used by [`validate_spin`].
///
/// All fields except `jurisdiction` and `stake` are optional/default-able
/// so callers can adopt incrementally.
#[derive(Debug, Clone)]
pub struct SpinContext<'a> {
    pub jurisdiction: &'a str,
    pub stake: f64,
    pub player_age: Option<u8>,
    pub spin_duration_ms: Option<u32>,
    pub autoplay: bool,
    pub turbo: bool,
}

impl<'a> SpinContext<'a> {
    /// Minimal context — just jurisdiction + stake.
    pub fn new(jurisdiction: &'a str, stake: f64) -> Self {
        Self {
            jurisdiction,
            stake,
            player_age: None,
            spin_duration_ms: None,
            autoplay: false,
            turbo: false,
        }
    }

    pub fn with_age(mut self, age: u8) -> Self {
        self.player_age = Some(age);
        self
    }

    pub fn with_duration_ms(mut self, ms: u32) -> Self {
        self.spin_duration_ms = Some(ms);
        self
    }

    pub fn with_autoplay(mut self, on: bool) -> Self {
        self.autoplay = on;
        self
    }

    pub fn with_turbo(mut self, on: bool) -> Self {
        self.turbo = on;
        self
    }
}
