/**
 * W152 Wave 19 — Market Compliance Gate (Faza 15.B.5).
 *
 * Build-time + runtime gate koji blokira deploy ako IR ne zadovoljava
 * jurisdikcijski profil. Pokriva:
 *
 *   * RTP floor / ceiling (per `rtpRange`)
 *   * Max win cap (per `maxWinX`, optional)
 *   * Prohibited features (per `prohibitedFeatures` set)
 *   * Min spin duration (per `minSpinDurationMs`)
 *   * Auto-play / turbo prohibition
 *   * Bonus wagering cap (per `bonusWageringCapX`)
 *   * Default max stake
 *   * LDW disclosure flag
 *   * Session-time display flag
 *
 * Vraća strukturisan `ComplianceVerdict` sa per-rule pass/fail + diagnostic
 * message. Operator decides u CI da li exit-uje ne-nula na bilo kojem
 * `❌` ili samo na `error`-level (FAIL dominates WARN).
 *
 * Naming: `complianceGate` is engine-generic. Vendor-neutral.
 */

import type { SlotGameIR } from '../ir/types.js';
import type { JurisdictionProfile } from './types.js';
import { PROFILES } from './profiles.js';

export type ComplianceStatus = 'PASS' | 'FAIL' | 'WARN' | 'N/A';

export interface ComplianceCheck {
  ruleId: string;
  status: ComplianceStatus;
  expected?: unknown;
  observed?: unknown;
  note?: string;
  citation?: string;
}

export interface ComplianceVerdict {
  jurisdictionId: string;
  jurisdictionName: string;
  overallStatus: ComplianceStatus;
  failCount: number;
  warnCount: number;
  passCount: number;
  naCount: number;
  checks: ComplianceCheck[];
}

/** Run all checks for a given (IR, jurisdictionId). Throws if profile not found. */
export function evaluateCompliance(ir: SlotGameIR, jurisdictionId: string): ComplianceVerdict {
  const profile = PROFILES.get(jurisdictionId);
  if (profile === undefined) {
    throw new Error(`evaluateCompliance: unknown jurisdiction '${jurisdictionId}'`);
  }
  const checks: ComplianceCheck[] = [];

  // ── 1. RTP envelope ─────────────────────────────────────────────────────
  checks.push(checkRtpRange(ir, profile));

  // ── 2. Max-win cap ──────────────────────────────────────────────────────
  checks.push(checkMaxWinCap(ir, profile));

  // ── 3. Prohibited features ──────────────────────────────────────────────
  checks.push(...checkProhibitedFeatures(ir, profile));

  // ── 4. Min spin duration ────────────────────────────────────────────────
  checks.push(checkMinSpinDuration(profile));

  // ── 5. Auto-play prohibition ────────────────────────────────────────────
  checks.push(checkAutoplay(profile));

  // ── 6. Turbo prohibition ────────────────────────────────────────────────
  checks.push(checkTurbo(profile));

  // ── 7. Bonus wagering cap ───────────────────────────────────────────────
  checks.push(checkBonusWagering(profile));

  // ── 8. Default max stake ────────────────────────────────────────────────
  checks.push(checkMaxStake(profile));

  // ── 9. LDW disclosure ───────────────────────────────────────────────────
  checks.push(checkLdwDisclosure(ir, profile));

  // ── 10. Session-time display ────────────────────────────────────────────
  checks.push(checkSessionTimeDisplay(ir, profile));

  // ── 11. Near-miss rule (UKGC RTS-3 / MGA equivalent) ────────────────────
  checks.push(checkNearMissRule(ir, profile));

  // ── Aggregate ──────────────────────────────────────────────────────────
  const failCount = checks.filter((c) => c.status === 'FAIL').length;
  const warnCount = checks.filter((c) => c.status === 'WARN').length;
  const passCount = checks.filter((c) => c.status === 'PASS').length;
  const naCount = checks.filter((c) => c.status === 'N/A').length;
  let overallStatus: ComplianceStatus = 'PASS';
  if (failCount > 0) overallStatus = 'FAIL';
  else if (warnCount > 0) overallStatus = 'WARN';
  else if (passCount === 0) overallStatus = 'N/A';

  return {
    jurisdictionId: profile.id,
    jurisdictionName: profile.name,
    overallStatus,
    failCount,
    warnCount,
    passCount,
    naCount,
    checks,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Check helpers
// ════════════════════════════════════════════════════════════════════════════

function checkRtpRange(ir: SlotGameIR, profile: JurisdictionProfile): ComplianceCheck {
  const target = ir.limits.target_rtp;
  const [lo, hi] = profile.rtpRange;
  const ok = target >= lo && target <= hi;
  return {
    ruleId: 'rtp_range',
    status: ok ? 'PASS' : 'FAIL',
    expected: profile.rtpRange,
    observed: target,
    note: ok ? undefined : `target_rtp ${target} outside ${profile.id} envelope ${profile.rtpRange.join(' – ')}`,
    citation: profile.regulatorUrl,
  };
}

function checkMaxWinCap(ir: SlotGameIR, profile: JurisdictionProfile): ComplianceCheck {
  if (profile.maxWinX === undefined) {
    return { ruleId: 'max_win_cap', status: 'N/A', note: 'No max-win cap mandated by jurisdiction' };
  }
  const ok = ir.limits.max_win_x <= profile.maxWinX;
  return {
    ruleId: 'max_win_cap',
    status: ok ? 'PASS' : 'FAIL',
    expected: profile.maxWinX,
    observed: ir.limits.max_win_x,
    note: ok ? undefined : `max_win_x ${ir.limits.max_win_x}× exceeds jurisdiction cap ${profile.maxWinX}×`,
    citation: profile.regulatorUrl,
  };
}

function checkProhibitedFeatures(ir: SlotGameIR, profile: JurisdictionProfile): ComplianceCheck[] {
  if (profile.prohibitedFeatures.length === 0) {
    return [
      {
        ruleId: 'prohibited_features',
        status: 'N/A',
        note: 'No feature prohibitions for this jurisdiction',
      },
    ];
  }
  const violations: string[] = [];
  // String-typed Set so we can check arbitrary jurisdiction-banned terms
  // against IR feature kinds without locking the IR enum.
  const declared = new Set<string>(ir.features.map((f) => f.kind as string));
  for (const banned of profile.prohibitedFeatures) {
    if (declared.has(banned)) violations.push(banned);
  }
  if (violations.length === 0) {
    return [
      {
        ruleId: 'prohibited_features',
        status: 'PASS',
        expected: profile.prohibitedFeatures,
        observed: Array.from(declared),
      },
    ];
  }
  return [
    {
      ruleId: 'prohibited_features',
      status: 'FAIL',
      expected: profile.prohibitedFeatures,
      observed: Array.from(declared),
      note: `Features ${violations.join(', ')} are prohibited in ${profile.id}`,
      citation: profile.regulatorUrl,
    },
  ];
}

function checkMinSpinDuration(profile: JurisdictionProfile): ComplianceCheck {
  if (profile.minSpinDurationMs === undefined) {
    return { ruleId: 'min_spin_duration', status: 'N/A' };
  }
  return {
    ruleId: 'min_spin_duration',
    status: 'WARN',
    expected: profile.minSpinDurationMs,
    note: `Operator must enforce ≥${profile.minSpinDurationMs} ms server-side spin gate (engine cannot self-verify).`,
    citation: profile.regulatorUrl,
  };
}

function checkAutoplay(profile: JurisdictionProfile): ComplianceCheck {
  if (profile.prohibitAutoplay !== true) {
    return { ruleId: 'autoplay_prohibition', status: 'N/A' };
  }
  return {
    ruleId: 'autoplay_prohibition',
    status: 'WARN',
    expected: false,
    note: 'Autoplay must be disabled in client UI.',
    citation: profile.regulatorUrl,
  };
}

function checkTurbo(profile: JurisdictionProfile): ComplianceCheck {
  if (profile.prohibitTurbo !== true) {
    return { ruleId: 'turbo_prohibition', status: 'N/A' };
  }
  return {
    ruleId: 'turbo_prohibition',
    status: 'WARN',
    expected: false,
    note: 'Turbo / quick-spin must be disabled in client UI.',
    citation: profile.regulatorUrl,
  };
}

function checkBonusWagering(profile: JurisdictionProfile): ComplianceCheck {
  if (profile.bonusWageringCapX === undefined) {
    return { ruleId: 'bonus_wagering_cap', status: 'N/A' };
  }
  return {
    ruleId: 'bonus_wagering_cap',
    status: 'WARN',
    expected: profile.bonusWageringCapX,
    note: `Promo wagering must not exceed ${profile.bonusWageringCapX}× principal.`,
    citation: profile.regulatorUrl,
  };
}

function checkMaxStake(profile: JurisdictionProfile): ComplianceCheck {
  if (profile.maxStakeDefault === undefined) {
    return { ruleId: 'max_stake_default', status: 'N/A' };
  }
  return {
    ruleId: 'max_stake_default',
    status: 'WARN',
    expected: profile.maxStakeDefault,
    note: `Default per-game-cycle stake cap ${profile.maxStakeDefault} (operator must enforce).`,
    citation: profile.regulatorUrl,
  };
}

function checkLdwDisclosure(ir: SlotGameIR, profile: JurisdictionProfile): ComplianceCheck {
  if (!profile.requireLdwDisclosure) {
    return { ruleId: 'ldw_disclosure', status: 'N/A' };
  }
  const ok = ir.compliance.ldw_disclosure === true;
  return {
    ruleId: 'ldw_disclosure',
    status: ok ? 'PASS' : 'FAIL',
    expected: true,
    observed: ir.compliance.ldw_disclosure,
    note: ok ? undefined : 'Loss-disguised-as-win celebration guard required',
    citation: profile.regulatorUrl,
  };
}

/**
 * Check near-miss rule per Kimi K8 + UKGC RTS-3 + MGA PPD §11.f.
 *
 * UKGC RTS-3 explicitly bans "false display of near-miss results" — the
 * symbol that almost-completed a payline must not be artificially
 * over-represented relative to its baseline strip frequency. Most
 * jurisdictions require `near_miss_rule: 'must_be_random'`. A few
 * (BMM Class III legacy cabinets) allow `'allowed_within_distribution'`
 * when the operator publishes the conditional symbol distribution.
 */
function checkNearMissRule(ir: SlotGameIR, profile: JurisdictionProfile): ComplianceCheck {
  if (profile.requiredNearMissRule === undefined) {
    return { ruleId: 'near_miss_rule', status: 'N/A' };
  }
  const observed = ir.compliance.near_miss_rule;
  const ok = observed === profile.requiredNearMissRule;
  return {
    ruleId: 'near_miss_rule',
    status: ok ? 'PASS' : 'FAIL',
    expected: profile.requiredNearMissRule,
    observed,
    note: ok
      ? undefined
      : `${profile.id} requires near_miss_rule '${profile.requiredNearMissRule}', got '${observed ?? 'undefined'}'`,
    citation: profile.regulatorUrl,
  };
}

function checkSessionTimeDisplay(ir: SlotGameIR, profile: JurisdictionProfile): ComplianceCheck {
  if (!profile.requireSessionTimeDisplay) {
    return { ruleId: 'session_time_display', status: 'N/A' };
  }
  const ok = ir.compliance.session_time_display === true;
  return {
    ruleId: 'session_time_display',
    status: ok ? 'PASS' : 'FAIL',
    expected: true,
    observed: ir.compliance.session_time_display,
    note: ok ? undefined : 'Session timer display required by jurisdiction',
    citation: profile.regulatorUrl,
  };
}

/** Strict CI gate — exit 1 on any FAIL, ignore WARN. */
export function isStrictPass(verdict: ComplianceVerdict): boolean {
  return verdict.failCount === 0;
}

/** Lenient gate — exit 1 only on multiple FAIL or any single critical failure. */
export function isLenientPass(verdict: ComplianceVerdict): boolean {
  return verdict.failCount === 0 || (verdict.failCount === 1 && verdict.warnCount === 0);
}
