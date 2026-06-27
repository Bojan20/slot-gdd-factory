/**
 * Faza 11.9 — Jurisdiction Adapter: Core Types.
 */

import type { SlotGameIR } from '../ir/types.js';

export type JurisdictionId =
  | 'UKGC' | 'MGA' | 'ADM' | 'BMM' | 'GLI19' | 'AGCO' | 'DGA' | 'NJDGE'
  | string;

export type ViolationSeverity = 'error' | 'warning' | 'info';

export interface ComplianceViolation {
  ruleId: string;
  jurisdiction: JurisdictionId;
  severity: ViolationSeverity;
  message: string;
  field?: string;
  actual?: unknown;
  required?: unknown;
  canAutoFix: boolean;
}

export interface ComplianceSummary {
  errors: number;
  warnings: number;
  infos: number;
  autoFixable: number;
}

export interface ComplianceReport {
  checkedJurisdictions: JurisdictionId[];
  violations: ComplianceViolation[];
  isCompliant: boolean;
  autoFixable: boolean;
  summary: ComplianceSummary;
}

export interface AppliedFix {
  ruleId: string;
  description: string;
}

export interface AutoFixResult {
  ir: SlotGameIR;
  appliedFixes: AppliedFix[];
  remainingViolations: ComplianceViolation[];
  isFullyCompliant: boolean;
}

/** Stake limit by age band (e.g. UKGC 18-24 = £2, 25+ = £5). */
export interface AgeTier {
  readonly minAge: number;
  readonly maxAge: number;
  readonly maxStake: number;
}

export interface JurisdictionProfile {
  readonly id: JurisdictionId;
  readonly name: string;
  readonly rtpRange: [number, number];
  readonly maxWinX?: number;
  readonly prohibitedFeatures: ReadonlyArray<string>;
  readonly requireLdwDisclosure: boolean;
  readonly requireSessionTimeDisplay: boolean;
  readonly requiredNearMissRule?: 'must_be_random' | 'allowed_within_distribution';
  readonly informationalNotes: ReadonlyArray<string>;

  // ── Faza 11.10+ runtime-enforceable extensions ───────────────────────────
  /** Default max stake per game cycle, if regulator caps it. */
  readonly maxStakeDefault?: number;
  /** Per-age-band stake limits (e.g. UKGC 18-24 = £2, 25+ = £5). */
  readonly ageTieredStakes?: ReadonlyArray<AgeTier>;
  /** Minimum spin / game-cycle duration in ms (UKGC RTS 14D = 2500). */
  readonly minSpinDurationMs?: number;
  /** Auto-play prohibited (UKGC RTS 14D). */
  readonly prohibitAutoplay?: boolean;
  /** Turbo / quick-spin prohibited (UKGC RTS 14D). */
  readonly prohibitTurbo?: boolean;
  /** Bonus / promo wagering multiplier cap (UKGC = 10x). */
  readonly bonusWageringCapX?: number;
  /** ISO date the listed rules became effective. */
  readonly effectiveFrom?: string;
  /** Primary regulator source URL. */
  readonly regulatorUrl?: string;
}

/** Runtime compliance error — fires per spin/wager/bonus event. */
export type ComplianceError =
  | {
      kind: 'stake_over_cap';
      jurisdiction: string;
      stake: number;
      cap: number;
    }
  | { kind: 'unknown_age_band'; jurisdiction: string; age: number }
  | { kind: 'age_required'; jurisdiction: string }
  | { kind: 'invalid_stake'; jurisdiction: string; stake: number }
  | {
      kind: 'spin_too_fast';
      jurisdiction: string;
      actualMs: number;
      minMs: number;
    }
  | { kind: 'autoplay_prohibited'; jurisdiction: string }
  | { kind: 'turbo_prohibited'; jurisdiction: string }
  | {
      kind: 'bonus_wagering_over_cap';
      jurisdiction: string;
      wageringX: number;
      capX: number;
    }
  | { kind: 'unknown_jurisdiction'; jurisdiction: string };

/** Per-spin runtime context for `validateSpin`. */
export interface SpinContext {
  jurisdiction: string;
  stake: number;
  playerAge?: number;
  spinDurationMs?: number;
  autoplay?: boolean;
  turbo?: boolean;
}
