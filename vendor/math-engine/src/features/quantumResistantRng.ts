/**
 * W238 — Quantum-Resistant RNG / Post-Quantum Crypto Compliance Analyzer (95. solver).
 *
 * Industry-first PQC compliance — NIST PQC finalization 2024 (ML-KEM / ML-DSA /
 * SLH-DSA standards FIPS 203/204/205) + EU Cyber Resilience Act 2025 + UK NCSC
 * quantum-readiness guidance 2024 + AU CSC Crypto Standards.
 *
 * Math: Shor's algorithm break time vs RSA/ECC key size; NIST PQC strength
 * categories I-V; migration cost-benefit; quantum-readiness score.
 */

export interface QuantumRngConfig {
  /** Current asymmetric key bits (RSA 2048/4096 or ECC 256/384). */
  classicalKeyBits: number;
  /** Quantum computer logical qubits available to attacker (typical 2024 ≈ 100, 2030 ≈ 1000-5000). */
  attackerLogicalQubits: number;
  /** PQC migration cost (currency, one-time). */
  pqcMigrationCost: number;
  /** Annual cryptographic operations (RNG + signing). */
  annualCryptoOperations: number;
  /** Per-operation breach cost if quantum-broken. */
  perOperationBreachCost: number;
  /** Years until target migration. */
  migrationHorizonYears: number;
  /** NIST PQC security category (I/III/V) currently deployed. */
  pqcSecurityCategory: 1 | 3 | 5;
  /** Boolean: hybrid mode (classical + PQC) enabled. */
  hybridModeEnabled: boolean;
}

export interface QuantumRngResult {
  /** Shor's-algorithm qubits needed to break classical key. */
  shorQubitsRequired: number;
  /** Boolean: attacker has enough qubits today. */
  attackerCanBreakClassical: boolean;
  /** Probability of break within horizon (sigmoid-modeled). */
  probBreakWithinHorizon: number;
  /** Expected annual breach exposure cost. */
  expectedAnnualBreachExposure: number;
  /** Total expected loss without migration. */
  expectedLossWithoutMigration: number;
  /** ROI of PQC migration. */
  pqcMigrationROI: number;
  /** Years until classical key urgent break (estimated). */
  yearsUntilUrgentBreak: number;
  /** Quantum-readiness composite score ∈ [0, 1]. */
  quantumReadinessScore: number;
  /** NIST PQC + UK NCSC compliance boolean. */
  isCompliantNistPqc: boolean;
}

function validate(c: QuantumRngConfig): void {
  if (!Number.isFinite(c.classicalKeyBits) || c.classicalKeyBits < 128 || c.classicalKeyBits > 16384)
    throw new Error('classicalKeyBits must be in [128, 16384]');
  if (!Number.isFinite(c.attackerLogicalQubits) || c.attackerLogicalQubits < 0)
    throw new Error('attackerLogicalQubits must be ≥ 0');
  if (!Number.isFinite(c.pqcMigrationCost) || c.pqcMigrationCost < 0)
    throw new Error('pqcMigrationCost must be ≥ 0');
  if (!Number.isFinite(c.annualCryptoOperations) || c.annualCryptoOperations < 0)
    throw new Error('annualCryptoOperations must be ≥ 0');
  if (!Number.isFinite(c.perOperationBreachCost) || c.perOperationBreachCost < 0)
    throw new Error('perOperationBreachCost must be ≥ 0');
  if (!Number.isFinite(c.migrationHorizonYears) || c.migrationHorizonYears <= 0)
    throw new Error('migrationHorizonYears must be > 0');
  if (![1, 3, 5].includes(c.pqcSecurityCategory))
    throw new Error('pqcSecurityCategory must be 1, 3, or 5');
}

function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const z = Math.exp(x);
  return z / (1 + z);
}

export function solveQuantumRng(cfg: QuantumRngConfig): QuantumRngResult {
  validate(cfg);

  // Shor's algorithm: requires ≈ 2·n logical qubits to break RSA-n,
  // or 6·n for ECC-n curves (NIST estimates).
  const shorQubitsRequired = 2 * cfg.classicalKeyBits;
  const attackerCanBreakClassical = cfg.attackerLogicalQubits >= shorQubitsRequired;

  // Sigmoid model: probability of break in horizon
  // Center around year when quantum capability catches up.
  // Assume quantum capability doubles every 2 years (Moore-like).
  const yearsToCatchUp = Math.log2(Math.max(shorQubitsRequired / Math.max(cfg.attackerLogicalQubits, 1), 0.1)) * 2;
  const yearsUntilUrgentBreak = Math.max(0, yearsToCatchUp);
  const probBreakWithinHorizon = sigmoid(2 * (cfg.migrationHorizonYears - yearsToCatchUp));

  // Expected annual breach exposure
  const expectedAnnualBreachExposure =
    probBreakWithinHorizon * cfg.annualCryptoOperations * cfg.perOperationBreachCost;
  const expectedLossWithoutMigration = expectedAnnualBreachExposure * cfg.migrationHorizonYears;

  // Migration ROI: avoided losses minus migration cost
  const expectedSavings = expectedLossWithoutMigration; // PQC eliminates classical risk
  const pqcMigrationROI =
    cfg.pqcMigrationCost > 0 ? (expectedSavings - cfg.pqcMigrationCost) / cfg.pqcMigrationCost : 0;

  // Quantum-readiness score
  const categoryScore = cfg.pqcSecurityCategory / 5; // 1→0.2, 3→0.6, 5→1.0
  const hybridScore = cfg.hybridModeEnabled ? 1 : 0.5;
  const urgencyScore = Math.max(0, Math.min(1, yearsUntilUrgentBreak / 10)); // > 10y = safe
  const quantumReadinessScore = Math.max(0, Math.min(1, 0.4 * categoryScore + 0.3 * hybridScore + 0.3 * urgencyScore));

  // NIST PQC compliance: Category III+ AND hybrid mode
  const isCompliantNistPqc = cfg.pqcSecurityCategory >= 3 && cfg.hybridModeEnabled;

  return {
    shorQubitsRequired,
    attackerCanBreakClassical,
    probBreakWithinHorizon,
    expectedAnnualBreachExposure,
    expectedLossWithoutMigration,
    pqcMigrationROI,
    yearsUntilUrgentBreak,
    quantumReadinessScore,
    isCompliantNistPqc,
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

export interface QuantumRngMcResult {
  episodes: number;
  observedExpectedAnnualBreachExposureMean: number;
}

export function simulateQuantumRng(cfg: QuantumRngConfig, seed: number, episodes: number): QuantumRngMcResult {
  validate(cfg);
  if (!Number.isInteger(episodes) || episodes < 100) throw new Error('episodes ≥ 100');
  const rng = makeRng(seed);
  let sum = 0;
  for (let ep = 0; ep < episodes; ep++) {
    // Noise on attackerLogicalQubits ±25%
    const noisyCfg = { ...cfg, attackerLogicalQubits: cfg.attackerLogicalQubits * (0.75 + 0.5 * rng()) };
    const r = solveQuantumRng(noisyCfg);
    sum += r.expectedAnnualBreachExposure;
  }
  return { episodes, observedExpectedAnnualBreachExposureMean: sum / episodes };
}
