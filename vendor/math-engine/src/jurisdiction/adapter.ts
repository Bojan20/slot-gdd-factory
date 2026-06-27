/**
 * Faza 11.9 — Jurisdiction Adapter.
 *
 * Validates a SlotGameIR against regulatory rules per market,
 * auto-fixes what it can, and generates compliance reports.
 */

import type { SlotGameIR } from '../ir/types.js';
import { PROFILES } from './profiles.js';
import type {
  AppliedFix,
  AutoFixResult,
  ComplianceError,
  ComplianceReport,
  ComplianceSummary,
  ComplianceViolation,
  JurisdictionId,
  JurisdictionProfile,
  SpinContext,
} from './types.js';

// ─── Profile helpers (Rust↔TS parity) ──────────────────────────────────────

/**
 * Resolve the maximum stake for a player based on age, falling back to
 * `maxStakeDefault`. Returns `undefined` when no cap applies.
 *
 * Mirrors `JurisdictionProfile::resolve_stake_cap` in Rust.
 */
export function resolveStakeCap(
  profile: JurisdictionProfile,
  playerAge?: number,
): number | undefined {
  const tiers = profile.ageTieredStakes ?? [];
  if (tiers.length > 0) {
    if (playerAge !== undefined) {
      let best: number | undefined;
      for (const tier of tiers) {
        if (playerAge >= tier.minAge && playerAge <= tier.maxAge) {
          best = best === undefined ? tier.maxStake : Math.min(best, tier.maxStake);
        }
      }
      return best; // undefined ⇒ unknown band — caller MUST reject
    }
    // No age supplied — return strictest cap.
    let min = Infinity;
    for (const tier of tiers) min = Math.min(min, tier.maxStake);
    return Number.isFinite(min) ? min : undefined;
  }
  return profile.maxStakeDefault;
}

// ─── Runtime enforcement (sloj 3) ───────────────────────────────────────────

/** Mirror of Rust `validate_stake`. */
export function validateStake(
  jurisdiction: string,
  stake: number,
  playerAge?: number,
): ComplianceError | null {
  const profile = PROFILES.get(jurisdiction);
  if (!profile) return { kind: 'unknown_jurisdiction', jurisdiction };

  if (!Number.isFinite(stake) || stake <= 0) {
    return { kind: 'invalid_stake', jurisdiction, stake };
  }

  const tiers = profile.ageTieredStakes ?? [];
  if (tiers.length > 0 && playerAge === undefined) {
    return { kind: 'age_required', jurisdiction };
  }
  if (tiers.length > 0 && playerAge !== undefined) {
    const anyMatch = tiers.some(
      (t) => playerAge >= t.minAge && playerAge <= t.maxAge,
    );
    if (!anyMatch) {
      return { kind: 'unknown_age_band', jurisdiction, age: playerAge };
    }
  }

  const cap = resolveStakeCap(profile, playerAge);
  if (cap !== undefined && stake > cap) {
    return { kind: 'stake_over_cap', jurisdiction, stake, cap };
  }
  return null;
}

/** Mirror of Rust `validate_spin_duration`. */
export function validateSpinDuration(
  jurisdiction: string,
  actualMs: number,
): ComplianceError | null {
  const profile = PROFILES.get(jurisdiction);
  if (!profile) return { kind: 'unknown_jurisdiction', jurisdiction };
  if (profile.minSpinDurationMs !== undefined && actualMs < profile.minSpinDurationMs) {
    return {
      kind: 'spin_too_fast',
      jurisdiction,
      actualMs,
      minMs: profile.minSpinDurationMs,
    };
  }
  return null;
}

/** Mirror of Rust `validate_autoplay`. */
export function validateAutoplay(jurisdiction: string): ComplianceError | null {
  const profile = PROFILES.get(jurisdiction);
  if (!profile) return { kind: 'unknown_jurisdiction', jurisdiction };
  if (profile.prohibitAutoplay) {
    return { kind: 'autoplay_prohibited', jurisdiction };
  }
  return null;
}

/** Mirror of Rust `validate_turbo`. */
export function validateTurbo(jurisdiction: string): ComplianceError | null {
  const profile = PROFILES.get(jurisdiction);
  if (!profile) return { kind: 'unknown_jurisdiction', jurisdiction };
  if (profile.prohibitTurbo) {
    return { kind: 'turbo_prohibited', jurisdiction };
  }
  return null;
}

/** Mirror of Rust `validate_bonus_wagering`. */
export function validateBonusWagering(
  jurisdiction: string,
  wageringX: number,
): ComplianceError | null {
  const profile = PROFILES.get(jurisdiction);
  if (!profile) return { kind: 'unknown_jurisdiction', jurisdiction };
  if (profile.bonusWageringCapX !== undefined && wageringX > profile.bonusWageringCapX) {
    return {
      kind: 'bonus_wagering_over_cap',
      jurisdiction,
      wageringX,
      capX: profile.bonusWageringCapX,
    };
  }
  return null;
}

/**
 * Validate a complete `SpinContext` against a jurisdiction. Fails fast on
 * the first violation; for the batched variant use `validateSpinFull`.
 */
export function validateSpin(ctx: SpinContext): ComplianceError | null {
  if (ctx.autoplay) {
    const e = validateAutoplay(ctx.jurisdiction);
    if (e) return e;
  }
  if (ctx.turbo) {
    const e = validateTurbo(ctx.jurisdiction);
    if (e) return e;
  }
  const stakeErr = validateStake(ctx.jurisdiction, ctx.stake, ctx.playerAge);
  if (stakeErr) return stakeErr;
  if (ctx.spinDurationMs !== undefined) {
    const e = validateSpinDuration(ctx.jurisdiction, ctx.spinDurationMs);
    if (e) return e;
  }
  return null;
}

/** Collect every violation for a spin (does not short-circuit). */
export function validateSpinFull(ctx: SpinContext): ComplianceError[] {
  const errs: ComplianceError[] = [];
  if (ctx.autoplay) {
    const e = validateAutoplay(ctx.jurisdiction);
    if (e) errs.push(e);
  }
  if (ctx.turbo) {
    const e = validateTurbo(ctx.jurisdiction);
    if (e) errs.push(e);
  }
  const stakeErr = validateStake(ctx.jurisdiction, ctx.stake, ctx.playerAge);
  if (stakeErr) errs.push(stakeErr);
  if (ctx.spinDurationMs !== undefined) {
    const e = validateSpinDuration(ctx.jurisdiction, ctx.spinDurationMs);
    if (e) errs.push(e);
  }
  return errs;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

/** Returns the `kind` string for a Feature object. */
function featureKind(feature: { kind: string }): string {
  return feature.kind;
}

/** Resolves which jurisdictions to check. */
function resolveJurisdictions(
  ir: SlotGameIR,
  explicit?: JurisdictionId[],
): JurisdictionId[] {
  if (explicit && explicit.length > 0) return explicit;
  if (ir.compliance.jurisdictions.length > 0) return ir.compliance.jurisdictions;
  return Array.from(PROFILES.keys());
}

// ─── rule checkers ──────────────────────────────────────────────────────────

function checkRtp(
  ir: SlotGameIR,
  profile: JurisdictionProfile,
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];
  const rtp = ir.limits.target_rtp;
  const [min, max] = profile.rtpRange;

  if (rtp < min || rtp > max) {
    violations.push({
      ruleId: `${profile.id}-RTP-001`,
      jurisdiction: profile.id,
      severity: 'error',
      message: `target_rtp ${rtp.toFixed(4)} is outside ${profile.name} allowed range [${min}, ${max}].`,
      field: 'limits.target_rtp',
      actual: rtp,
      required: profile.rtpRange,
      canAutoFix: false,
    });
  }

  // Check if ir.compliance.rtp_range_required matches profile range
  const [reqMin, reqMax] = ir.compliance.rtp_range_required;
  if (reqMin !== min || reqMax !== max) {
    violations.push({
      ruleId: `${profile.id}-RTP-002`,
      jurisdiction: profile.id,
      severity: 'warning',
      message: `compliance.rtp_range_required [${reqMin}, ${reqMax}] does not match ${profile.name} range [${min}, ${max}].`,
      field: 'compliance.rtp_range_required',
      actual: ir.compliance.rtp_range_required,
      required: profile.rtpRange,
      canAutoFix: true,
    });
  }

  return violations;
}

function checkMaxWin(
  ir: SlotGameIR,
  profile: JurisdictionProfile,
): ComplianceViolation[] {
  if (profile.maxWinX === undefined) return [];

  const actual = ir.limits.max_win_x;
  if (actual > profile.maxWinX) {
    return [
      {
        ruleId: `${profile.id}-MAXWIN-001`,
        jurisdiction: profile.id,
        severity: 'error',
        message: `max_win_x ${actual} exceeds ${profile.name} cap of ${profile.maxWinX}.`,
        field: 'limits.max_win_x',
        actual,
        required: profile.maxWinX,
        canAutoFix: true,
      },
    ];
  }
  return [];
}

function checkProhibitedFeatures(
  ir: SlotGameIR,
  profile: JurisdictionProfile,
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];

  for (const prohibited of profile.prohibitedFeatures) {
    const found = ir.features.some((f) => featureKind(f) === prohibited);
    if (found) {
      // Use a rule ID based on the feature kind, uppercased and with underscores stripped
      const featureTag = prohibited.replace(/_/g, '').toUpperCase();
      violations.push({
        ruleId: `${profile.id}-FEAT-${featureTag}`,
        jurisdiction: profile.id,
        severity: 'error',
        message: `Feature '${prohibited}' is prohibited in ${profile.name}.`,
        field: 'features',
        actual: prohibited,
        required: 'absent',
        canAutoFix: true,
      });
    }
  }

  return violations;
}

/**
 * Check IR-declared stake configuration against profile cap (Rust parity).
 *
 * Probes both `bet.base_bet` and `bet.denominations[*]` against the
 * conservative cap (strictest tier when no age is in context).
 */
function checkStakeCap(
  ir: SlotGameIR,
  profile: JurisdictionProfile,
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];
  const cap = resolveStakeCap(profile, undefined);
  if (cap === undefined) return violations;

  const baseBet = ir.bet.base_bet;
  if (baseBet > cap) {
    violations.push({
      ruleId: `${profile.id}-STAKE-001`,
      jurisdiction: profile.id,
      severity: 'error',
      message: `bet.base_bet ${baseBet} exceeds ${profile.name} per-cycle stake cap ${cap}.`,
      field: 'bet.base_bet',
      actual: baseBet,
      required: cap,
      canAutoFix: true,
    });
  }

  const denoms = ir.bet.denominations ?? [];
  let maxDen: number | undefined;
  for (const d of denoms) {
    if (Number.isFinite(d)) maxDen = maxDen === undefined ? d : Math.max(maxDen, d);
  }
  if (maxDen !== undefined && maxDen > cap) {
    violations.push({
      ruleId: `${profile.id}-STAKE-002`,
      jurisdiction: profile.id,
      severity: 'error',
      message: `bet.denominations contains ${maxDen} which exceeds ${profile.name} per-cycle stake cap ${cap}.`,
      field: 'bet.denominations',
      actual: maxDen,
      required: cap,
      canAutoFix: true,
    });
  }

  if (!Number.isFinite(baseBet) || baseBet <= 0) {
    violations.push({
      ruleId: `${profile.id}-STAKE-003`,
      jurisdiction: profile.id,
      severity: 'error',
      message: `bet.base_bet ${baseBet} is not a finite positive number.`,
      field: 'bet.base_bet',
      actual: baseBet,
      required: '> 0',
      canAutoFix: false,
    });
  }

  return violations;
}

/** Surface autoplay / turbo bans as Info violations (UI gate). */
function checkAutoplayTurbo(
  _ir: SlotGameIR,
  profile: JurisdictionProfile,
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];
  if (profile.prohibitAutoplay) {
    violations.push({
      ruleId: `${profile.id}-AUTOPLAY-001`,
      jurisdiction: profile.id,
      severity: 'info',
      message: `${profile.name}: auto-play UI/feature must be disabled in client build.`,
      canAutoFix: false,
    });
  }
  if (profile.prohibitTurbo) {
    violations.push({
      ruleId: `${profile.id}-TURBO-001`,
      jurisdiction: profile.id,
      severity: 'info',
      message: `${profile.name}: turbo / quick-spin UI must be disabled in client build.`,
      canAutoFix: false,
    });
  }
  return violations;
}

/** Surface pacing minimum (e.g. UKGC RTS 14D 2500ms) as Info. */
function checkPacing(
  _ir: SlotGameIR,
  profile: JurisdictionProfile,
): ComplianceViolation[] {
  if (profile.minSpinDurationMs === undefined) return [];
  return [
    {
      ruleId: `${profile.id}-PACING-001`,
      jurisdiction: profile.id,
      severity: 'info',
      message: `${profile.name}: minimum ${profile.minSpinDurationMs}ms per game cycle — client spin animation must enforce.`,
      canAutoFix: false,
    },
  ];
}

/** Surface bonus wagering cap (e.g. UKGC 10x) as Info. */
function checkWagering(
  _ir: SlotGameIR,
  profile: JurisdictionProfile,
): ComplianceViolation[] {
  if (profile.bonusWageringCapX === undefined) return [];
  return [
    {
      ruleId: `${profile.id}-WAGERING-001`,
      jurisdiction: profile.id,
      severity: 'info',
      message: `${profile.name}: bonus wagering requirement capped at ${profile.bonusWageringCapX}x.`,
      canAutoFix: false,
    },
  ];
}

function checkCompliance(
  ir: SlotGameIR,
  profile: JurisdictionProfile,
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];

  if (profile.requireLdwDisclosure && !ir.compliance.ldw_disclosure) {
    violations.push({
      ruleId: `${profile.id}-LDW-001`,
      jurisdiction: profile.id,
      severity: 'error',
      message: `${profile.name} requires ldw_disclosure to be true.`,
      field: 'compliance.ldw_disclosure',
      actual: false,
      required: true,
      canAutoFix: true,
    });
  }

  if (profile.requireSessionTimeDisplay && !ir.compliance.session_time_display) {
    violations.push({
      ruleId: `${profile.id}-SESSION-001`,
      jurisdiction: profile.id,
      severity: 'error',
      message: `${profile.name} requires session_time_display to be true.`,
      field: 'compliance.session_time_display',
      actual: false,
      required: true,
      canAutoFix: true,
    });
  }

  if (
    profile.requiredNearMissRule !== undefined &&
    ir.compliance.near_miss_rule !== profile.requiredNearMissRule
  ) {
    violations.push({
      ruleId: `${profile.id}-NEARMISS-001`,
      jurisdiction: profile.id,
      severity: 'error',
      message: `${profile.name} requires near_miss_rule to be '${profile.requiredNearMissRule}', got '${ir.compliance.near_miss_rule}'.`,
      field: 'compliance.near_miss_rule',
      actual: ir.compliance.near_miss_rule,
      required: profile.requiredNearMissRule,
      canAutoFix: true,
    });
  }

  return violations;
}

function checkJurisdictionDeclared(
  ir: SlotGameIR,
  profile: JurisdictionProfile,
): ComplianceViolation[] {
  if (!ir.compliance.jurisdictions.includes(profile.id)) {
    return [
      {
        ruleId: `${profile.id}-DECL-001`,
        jurisdiction: profile.id,
        severity: 'warning',
        message: `Jurisdiction '${profile.id}' is not declared in compliance.jurisdictions.`,
        field: 'compliance.jurisdictions',
        actual: ir.compliance.jurisdictions,
        required: profile.id,
        canAutoFix: true,
      },
    ];
  }
  return [];
}

function checkInformational(
  profile: JurisdictionProfile,
): ComplianceViolation[] {
  return profile.informationalNotes.map((note, idx) => ({
    ruleId: `${profile.id}-INFO-${String(idx + 1).padStart(3, '0')}`,
    jurisdiction: profile.id,
    severity: 'info' as const,
    message: note,
    canAutoFix: false,
  }));
}

// ─── apply fix ──────────────────────────────────────────────────────────────

function applyFix(
  ir: SlotGameIR,
  violation: ComplianceViolation,
  profile: JurisdictionProfile,
): AppliedFix | null {
  const { ruleId } = violation;

  // RTP-002: set compliance.rtp_range_required
  if (ruleId.endsWith('-RTP-002')) {
    ir.compliance.rtp_range_required = [profile.rtpRange[0], profile.rtpRange[1]];
    return {
      ruleId,
      description: `Set compliance.rtp_range_required to [${profile.rtpRange[0]}, ${profile.rtpRange[1]}] for ${profile.id}.`,
    };
  }

  // MAXWIN-001: cap max_win_x
  if (ruleId.endsWith('-MAXWIN-001') && profile.maxWinX !== undefined) {
    ir.limits.max_win_x = profile.maxWinX;
    ir.compliance.max_win_cap_required = profile.maxWinX;
    return {
      ruleId,
      description: `Capped max_win_x to ${profile.maxWinX} for ${profile.id}.`,
    };
  }

  // FEAT-*: remove matching feature kind
  if (ruleId.includes('-FEAT-')) {
    // Find prohibited feature kind from the violation's actual field
    const prohibitedKind = violation.actual as string;
    const before = ir.features.length;
    ir.features = ir.features.filter((f) => featureKind(f) !== prohibitedKind);
    const removed = before - ir.features.length;
    if (removed > 0) {
      return {
        ruleId,
        description: `Removed ${removed} '${prohibitedKind}' feature(s) prohibited by ${profile.id}.`,
      };
    }
    return null;
  }

  // LDW-001: set ldw_disclosure = true
  if (ruleId.endsWith('-LDW-001')) {
    ir.compliance.ldw_disclosure = true;
    return { ruleId, description: `Set compliance.ldw_disclosure = true for ${profile.id}.` };
  }

  // SESSION-001: set session_time_display = true
  if (ruleId.endsWith('-SESSION-001')) {
    ir.compliance.session_time_display = true;
    return {
      ruleId,
      description: `Set compliance.session_time_display = true for ${profile.id}.`,
    };
  }

  // NEARMISS-001: set near_miss_rule
  if (ruleId.endsWith('-NEARMISS-001') && profile.requiredNearMissRule !== undefined) {
    ir.compliance.near_miss_rule = profile.requiredNearMissRule;
    return {
      ruleId,
      description: `Set compliance.near_miss_rule = '${profile.requiredNearMissRule}' for ${profile.id}.`,
    };
  }

  // STAKE-001: cap bet.base_bet to strictest profile band
  if (ruleId.endsWith('-STAKE-001')) {
    const cap = resolveStakeCap(profile, undefined);
    if (cap !== undefined) {
      const old = ir.bet.base_bet;
      ir.bet.base_bet = cap;
      return {
        ruleId,
        description: `Capped bet.base_bet from ${old} to ${cap} for ${profile.id}.`,
      };
    }
    return null;
  }

  // STAKE-002: drop denominations over cap
  if (ruleId.endsWith('-STAKE-002')) {
    const cap = resolveStakeCap(profile, undefined);
    if (cap !== undefined) {
      const before = ir.bet.denominations.length;
      ir.bet.denominations = ir.bet.denominations.filter(
        (d) => Number.isFinite(d) && d > 0 && d <= cap,
      );
      const removed = before - ir.bet.denominations.length;
      return {
        ruleId,
        description: `Dropped ${removed} denomination(s) over ${profile.name} stake cap ${cap} for ${profile.id}.`,
      };
    }
    return null;
  }

  // DECL-001: push jurisdiction to compliance.jurisdictions
  if (ruleId.endsWith('-DECL-001')) {
    if (!ir.compliance.jurisdictions.includes(profile.id)) {
      ir.compliance.jurisdictions.push(profile.id);
    }
    return {
      ruleId,
      description: `Added '${profile.id}' to compliance.jurisdictions.`,
    };
  }

  return null;
}

// ─── public API ─────────────────────────────────────────────────────────────

export class JurisdictionAdapter {
  /** Validate an IR against one or more jurisdictions. */
  validate(ir: SlotGameIR, jurisdictions?: JurisdictionId[]): ComplianceReport {
    const resolved = resolveJurisdictions(ir, jurisdictions);
    const violations: ComplianceViolation[] = [];

    for (const jid of resolved) {
      const profile = PROFILES.get(jid);
      if (!profile) {
        violations.push({
          ruleId: `${jid}-UNKNOWN-001`,
          jurisdiction: jid,
          severity: 'warning',
          message: `Unknown jurisdiction '${jid}' — no profile available.`,
          canAutoFix: false,
        });
        continue;
      }

      violations.push(...checkRtp(ir, profile));
      violations.push(...checkMaxWin(ir, profile));
      violations.push(...checkProhibitedFeatures(ir, profile));
      violations.push(...checkStakeCap(ir, profile));
      violations.push(...checkAutoplayTurbo(ir, profile));
      violations.push(...checkPacing(ir, profile));
      violations.push(...checkWagering(ir, profile));
      violations.push(...checkCompliance(ir, profile));
      violations.push(...checkJurisdictionDeclared(ir, profile));
      violations.push(...checkInformational(profile));
    }

    const errors = violations.filter((v) => v.severity === 'error').length;
    const warnings = violations.filter((v) => v.severity === 'warning').length;
    const infos = violations.filter((v) => v.severity === 'info').length;
    const autoFixable = violations.filter((v) => v.canAutoFix).length;

    const summary: ComplianceSummary = { errors, warnings, infos, autoFixable };

    return {
      checkedJurisdictions: resolved,
      violations,
      isCompliant: errors === 0,
      autoFixable: autoFixable > 0,
      summary,
    };
  }

  /** Auto-fix all fixable violations and return modified IR + result. */
  autoFix(ir: SlotGameIR, jurisdictions?: JurisdictionId[]): AutoFixResult {
    const resolved = resolveJurisdictions(ir, jurisdictions);
    const working = deepClone(ir);
    const initialReport = this.validate(working, resolved);

    const appliedFixes: AppliedFix[] = [];
    const fixableViolations = initialReport.violations.filter((v) => v.canAutoFix);

    for (const violation of fixableViolations) {
      const profile = PROFILES.get(violation.jurisdiction);
      if (!profile) continue;

      const fix = applyFix(working, violation, profile);
      if (fix) {
        appliedFixes.push(fix);
      }
    }

    // Re-validate after fixes
    const finalReport = this.validate(working, resolved);
    const remainingViolations = finalReport.violations.filter(
      (v) => v.severity === 'error' || v.severity === 'warning',
    );

    return {
      ir: working,
      appliedFixes,
      remainingViolations,
      isFullyCompliant: finalReport.isCompliant,
    };
  }

  /** Generate a human-readable compliance report text. */
  generateReport(ir: SlotGameIR, jurisdictions?: JurisdictionId[]): string {
    const report = this.validate(ir, jurisdictions);
    const lines: string[] = [];

    const statusIcon = report.isCompliant ? '✅' : '❌';
    lines.push(`${statusIcon} Jurisdiction Compliance Report — ${ir.meta.name} (${ir.meta.id})`);
    lines.push(`   Checked: ${report.checkedJurisdictions.join(', ')}`);
    lines.push(
      `   Errors: ${report.summary.errors}  Warnings: ${report.summary.warnings}  Infos: ${report.summary.infos}  Auto-fixable: ${report.summary.autoFixable}`,
    );
    lines.push('');

    if (report.violations.length === 0) {
      lines.push('   No violations found.');
      return lines.join('\n');
    }

    // Group by jurisdiction
    const byJurisdiction = new Map<JurisdictionId, ComplianceViolation[]>();
    for (const v of report.violations) {
      const list = byJurisdiction.get(v.jurisdiction) ?? [];
      list.push(v);
      byJurisdiction.set(v.jurisdiction, list);
    }

    for (const [jid, vs] of byJurisdiction) {
      const profile = PROFILES.get(jid);
      const jName = profile ? profile.name : jid;
      lines.push(`── ${jid}: ${jName} ──`);

      for (const v of vs) {
        const icon =
          v.severity === 'error' ? '  ❌' : v.severity === 'warning' ? '  ⚠️ ' : '  ℹ️ ';
        const fixTag = v.canAutoFix ? ' [auto-fixable]' : '';
        lines.push(`${icon} [${v.ruleId}]${fixTag} ${v.message}`);
        if (v.field) {
          lines.push(`       field: ${v.field}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /** List all known jurisdiction IDs. */
  listJurisdictions(): JurisdictionId[] {
    return Array.from(PROFILES.keys());
  }

  /** Get a jurisdiction profile by ID. */
  getProfile(id: JurisdictionId): JurisdictionProfile | undefined {
    return PROFILES.get(id);
  }
}
