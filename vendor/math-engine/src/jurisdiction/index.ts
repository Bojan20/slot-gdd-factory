/**
 * Faza 11.9 — Jurisdiction Adapter: Public API.
 */

export { JurisdictionAdapter } from './adapter.js';
export {
  resolveStakeCap,
  validateAutoplay,
  validateBonusWagering,
  validateSpin,
  validateSpinDuration,
  validateSpinFull,
  validateStake,
  validateTurbo,
} from './adapter.js';
export { PROFILES } from './profiles.js';
export type {
  AgeTier,
  AppliedFix,
  AutoFixResult,
  ComplianceError,
  ComplianceReport,
  ComplianceSummary,
  ComplianceViolation,
  JurisdictionId,
  JurisdictionProfile,
  SpinContext,
  ViolationSeverity,
} from './types.js';
