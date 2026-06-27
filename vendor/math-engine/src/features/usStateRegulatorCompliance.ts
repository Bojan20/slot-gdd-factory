/**
 * W239 — US State Regulator Compliance Multi-Jurisdiction Analyzer (96. solver).
 *
 * NJ DGE 13:69D, PA PGCB 58 Pa.Code §812, MI MGCB R432, NV NGCB Reg 14,
 * MA MGC 205 CMR 138, CO Gaming Commission, MD LMC, IL IGB, WV LCB, RI DBR,
 * CT DCP, NH HCB, DC OLG. Per-state acceptance bands + audit cadence + fee
 * exposure aggregator.
 */

export interface UsStateConfig {
  /** State ISO code (e.g. 'NJ', 'PA', 'MI'). */
  state: string;
  /** Per-state required RTP minimum ∈ [0.80, 0.95]. */
  minRtp: number;
  /** Per-state required RTP maximum ∈ [minRtp, 1.0]. */
  maxRtp: number;
  /** Operator actual RTP. */
  actualRtp: number;
  /** Required audit cadence (days). */
  auditCadenceDays: number;
  /** Operator's actual audit cadence (days). */
  actualAuditCadenceDays: number;
  /** Annual licensing fee (currency). */
  annualLicensingFee: number;
  /** Per-violation fine exposure (currency). */
  perViolationFine: number;
  /** Annual probability of violation. */
  annualViolationProb: number;
}

export interface UsStateComplianceConfig {
  /** Per-state configs (e.g. NJ + PA + MI). */
  states: UsStateConfig[];
  /** Total operator capacity for cross-state allocation. */
  totalRevenueCapacity: number;
}

export interface UsStateComplianceResult {
  /** Per-state compliance booleans. */
  perStateCompliance: boolean[];
  /** Per-state expected annual fine. */
  perStateExpectedFine: number[];
  /** Total annual licensing fees. */
  totalAnnualLicensingFees: number;
  /** Total expected annual violation fines. */
  totalExpectedAnnualFines: number;
  /** Total compliance cost (fees + expected fines). */
  totalComplianceCost: number;
  /** % of states compliant. */
  fractionStatesCompliant: number;
  /** Composite multi-state compliance score ∈ [0, 1]. */
  multiStateComplianceScore: number;
  /** Boolean: meets all US state regulator mandates. */
  isCompliantAllStates: boolean;
}

function validate(c: UsStateComplianceConfig): void {
  if (!Array.isArray(c.states) || c.states.length < 1 || c.states.length > 30)
    throw new Error('states must be 1-30');
  for (const s of c.states) {
    if (typeof s.state !== 'string' || s.state.length < 2) throw new Error('state code invalid');
    if (!Number.isFinite(s.minRtp) || s.minRtp < 0.70 || s.minRtp > 0.97) throw new Error('minRtp ∈ [0.70, 0.97]');
    if (!Number.isFinite(s.maxRtp) || s.maxRtp < s.minRtp || s.maxRtp > 1.0) throw new Error('maxRtp range');
    if (!Number.isFinite(s.actualRtp)) throw new Error('actualRtp must be finite');
    if (!Number.isFinite(s.auditCadenceDays) || s.auditCadenceDays <= 0) throw new Error('auditCadenceDays > 0');
    if (!Number.isFinite(s.actualAuditCadenceDays) || s.actualAuditCadenceDays <= 0) throw new Error('actualAuditCadenceDays > 0');
    if (!Number.isFinite(s.annualLicensingFee) || s.annualLicensingFee < 0) throw new Error('licensingFee ≥ 0');
    if (!Number.isFinite(s.perViolationFine) || s.perViolationFine < 0) throw new Error('perViolationFine ≥ 0');
    if (!Number.isFinite(s.annualViolationProb) || s.annualViolationProb < 0 || s.annualViolationProb > 1) throw new Error('annualViolationProb ∈ [0, 1]');
  }
  if (!Number.isFinite(c.totalRevenueCapacity) || c.totalRevenueCapacity < 0) throw new Error('totalRevenueCapacity ≥ 0');
}

export function solveUsStateCompliance(cfg: UsStateComplianceConfig): UsStateComplianceResult {
  validate(cfg);
  const N = cfg.states.length;
  const perStateCompliance: boolean[] = new Array(N);
  const perStateExpectedFine: number[] = new Array(N);
  let totalLicensingFees = 0;
  let totalExpectedFines = 0;
  let compliantCount = 0;

  for (let i = 0; i < N; i++) {
    const s = cfg.states[i];
    const rtpOk = s.actualRtp >= s.minRtp && s.actualRtp <= s.maxRtp;
    const auditOk = s.actualAuditCadenceDays <= s.auditCadenceDays;
    perStateCompliance[i] = rtpOk && auditOk;
    if (perStateCompliance[i]) compliantCount++;
    perStateExpectedFine[i] = s.annualViolationProb * s.perViolationFine;
    totalLicensingFees += s.annualLicensingFee;
    totalExpectedFines += perStateExpectedFine[i];
  }

  const fractionStatesCompliant = N > 0 ? compliantCount / N : 0;
  const totalComplianceCost = totalLicensingFees + totalExpectedFines;
  const multiStateComplianceScore = fractionStatesCompliant; // simple = fraction
  const isCompliantAllStates = compliantCount === N;

  return {
    perStateCompliance,
    perStateExpectedFine,
    totalAnnualLicensingFees: totalLicensingFees,
    totalExpectedAnnualFines: totalExpectedFines,
    totalComplianceCost,
    fractionStatesCompliant,
    multiStateComplianceScore,
    isCompliantAllStates,
  };
}

function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface UsStateComplianceMcResult {
  episodes: number;
  observedTotalFinesMean: number;
}

export function simulateUsStateCompliance(cfg: UsStateComplianceConfig, seed: number, episodes: number): UsStateComplianceMcResult {
  validate(cfg);
  if (!Number.isInteger(episodes) || episodes < 100) throw new Error('episodes ≥ 100');
  const rng = makeRng(seed);
  let sum = 0;
  for (let ep = 0; ep < episodes; ep++) {
    let total = 0;
    for (const s of cfg.states) {
      if (rng() < s.annualViolationProb) total += s.perViolationFine;
    }
    sum += total;
  }
  return { episodes, observedTotalFinesMean: sum / episodes };
}
