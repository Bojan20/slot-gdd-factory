/**
 * W152 Wave 146 — Cascade Meter Charge-Up Trigger (Faza 12 ext, post-W100 roadmap).
 *
 * Closed-form solver za "cascade-charged meter trigger" mehaniku —
 * Play'n GO Reactoonz / Reactoonz 2 (Quantum Leap meter) / Hacksaw
 * Stack 'Em (boost meter every N wins) / Push Aztec Bonanza (charging
 * meter) / Yggdrasil Vault of Anubis (FS charge meter) / NetEnt
 * Wildbeast (charge meter). Per-win meter increment +1, threshold T
 * triggers feature fire sa carry-over.
 *
 * Naming policy (clean-room): "cascade meter", "charge-up trigger",
 * "feature fire", "carry-over" = generic industry terms. No vendor TM.
 *
 * ── Difference vs prior Wxx solvers ───────────────────────────────────────
 *   • W50 Charge Meter — STATIONARY steady-state analyzer, no cascade chain
 *   • W138 Tumble Multiplier with Cap — per-level ladder M_k = min(base+k·step,
 *     M_max); ovaj solver METER-driven count-based fires
 *   • W118 Bonus Collect-N — collect-N tokens from base-game scatter landings;
 *     ovaj solver fires od cascade wins inside ONE spin
 *   • W84 FS Retrigger Compound — multiplicative retrigger chain; ovaj
 *     solver meter-fire count-based
 *   • W121 Cascade Multiplier Chain — multiplier ladder per cascade level;
 *     no meter
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Per spin: cascade chain L ~ Geometric(1−p), L = 0, 1, 2, ...
 *   P(L = ℓ) = p^ℓ · (1 − p)
 *   E[L] = p / (1 − p), Var[L] = p / (1 − p)²
 *
 * Per cascade win (1 of L total): meter increments by +1 (deterministic).
 * Feature "fire" when meter ≥ T; meter then decrements by T (carry-over).
 *
 * Total fires per spin: F = ⌊L / T⌋
 *
 * **Beautiful closed form**: since L ~ Geometric(1−p) sa pmf p^ℓ·(1−p):
 *   F = ⌊L / T⌋ ~ Geometric(1 − p^T)
 *   P(F = k) = p^(kT) · (1 − p^T)
 *   E[F] = p^T / (1 − p^T)
 *   Var[F] = p^T / (1 − p^T)²
 *
 * Per fire feature reward B (X bet units):
 *   Y_feature = F · B
 *   E[Y_feature] = B · p^T / (1 − p^T)
 *   Var[Y_feature] = B² · p^T / (1 − p^T)²
 *
 * Meter state at end of spin (carry-over for next spin if persistent):
 *   M_end = L mod T (chain wins that didn't complete a T-block)
 *   E[M_end] = (1−p)/(1−p^T) · [(p − T·p^T + (T−1)·p^(T+1)) / (1−p)²]
 *            = simplified expression — computed via DP-like sum
 *
 * Probability indicators:
 *   P(at least 1 fire) = P(L ≥ T) = p^T
 *   P(no fires) = 1 − p^T
 *
 * Plus base cascade pay (per win value V ~ winValuePmf):
 *   Y_base = Σ_{k=1..L} V_k
 *   E[Y_base] = E[L] · μ_V (Wald identity)
 *   Var[Y_base] = E[L]·σ_V² + Var[L]·μ_V² (compound variance, V ⊥ L)
 *
 * Total payout per spin:
 *   Y = Y_base + Y_feature
 *   E[Y] = E[Y_base] + E[Y_feature]
 *   Var[Y] ≈ Var[Y_base] + Var[Y_feature] (cross-cov approximation)
 *
 * Note on cov(Y_base, Y_feature): both depend on L, so they ARE correlated.
 * The closed-form Var[Y] in this solver represents the lower-bound under
 * independence assumption; full Var via MC reference (`simulateCascadeMeterChargeUp`).
 *
 * ── Compliance ────────────────────────────────────────────────────────────
 *   • UKGC RTS 14 — feature trigger frequency disclosure (P(fire), E[F])
 *   • MGA PPD §11.f — operator-facing meter mechanic transparency
 *   • eCOGRA Generic Slots Audit — verifies meter fire rate matches engine
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateCascadeMeterChargeUp() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface CascadeMeterWinValuePmfEntry {
  /** Win value (X bet units, non-negative). */
  value: number;
  /** PMF weight. */
  probability: number;
}

export interface CascadeMeterChargeUpConfig {
  /** Cascade continuation probability p (0 < p < 1). Chain L ~ Geometric(1-p). */
  cascadeContinuationProbability: number;
  /** Meter threshold T (positive integer); fire when meter reaches T. */
  meterThreshold: number;
  /** Feature fire reward B (X bet units, non-negative). */
  fireRewardX: number;
  /** PMF for per-cascade win value V. Probabilities must sum to 1. */
  winValuePmf: CascadeMeterWinValuePmfEntry[];
}

export interface CascadeMeterChargeUpResult {
  cascadeContinuationProbability: number;
  meterThreshold: number;
  fireRewardX: number;
  expectedChainLength: number;            // E[L]
  varianceChainLength: number;            // Var[L]
  probZeroChain: number;                  // P(L=0) = 1-p
  expectedFiresPerSpin: number;           // E[F] = p^T/(1-p^T)
  varianceFiresPerSpin: number;           // Var[F]
  probAtLeastOneFire: number;             // P(L ≥ T) = p^T
  expectedMeterEndOfSpin: number;         // E[L mod T]
  expectedWinValuePerCascade: number;     // μ_V
  varianceWinValuePerCascade: number;     // σ_V²
  expectedBasePayoutPerSpin: number;      // E[L]·μ_V
  varianceBasePayoutPerSpin: number;      // compound variance
  expectedFeaturePayoutPerSpin: number;   // B · E[F]
  varianceFeaturePayoutPerSpin: number;   // B² · Var[F]
  expectedTotalPayoutPerSpin: number;     // E[Y]
  varianceTotalPayoutPerSpin: number;     // lower-bound under indep approx
}

export interface CascadeMeterChargeUpMcResult {
  spins: number;
  observedMeanFiresPerSpin: number;
  observedMeanChainLength: number;
  observedAtLeastOneFireFraction: number;
  observedMeanTotalPayoutPerSpin: number;
  observedMeanMeterEndOfSpin: number;
  observedMaxFiresInSingleSpin: number;
}

// ── Validation ──────────────────────────────────────────────────────────────

function validateConfig(cfg: CascadeMeterChargeUpConfig): void {
  if (!(cfg.cascadeContinuationProbability > 0 && cfg.cascadeContinuationProbability < 1)) {
    throw new Error(`cascadeContinuationProbability must be in (0, 1) (got ${cfg.cascadeContinuationProbability})`);
  }
  if (!Number.isInteger(cfg.meterThreshold) || cfg.meterThreshold < 1) {
    throw new Error(`meterThreshold must be positive integer (got ${cfg.meterThreshold})`);
  }
  if (!Number.isFinite(cfg.fireRewardX) || cfg.fireRewardX < 0) {
    throw new Error(`fireRewardX must be finite non-negative (got ${cfg.fireRewardX})`);
  }
  if (!Array.isArray(cfg.winValuePmf) || cfg.winValuePmf.length === 0) {
    throw new Error('winValuePmf must be non-empty array');
  }
  let sumP = 0;
  for (const e of cfg.winValuePmf) {
    if (!Number.isFinite(e.value) || e.value < 0) {
      throw new Error(`winValuePmf value must be finite non-negative (got ${e.value})`);
    }
    if (!(e.probability >= 0 && e.probability <= 1)) {
      throw new Error(`winValuePmf probability must be in [0, 1] (got ${e.probability})`);
    }
    sumP += e.probability;
  }
  if (Math.abs(sumP - 1) > 1e-9) {
    throw new Error(`winValuePmf probabilities must sum to 1 (got ${sumP})`);
  }
}

// ── Closed-form solver ──────────────────────────────────────────────────────

/**
 * Compute E[L mod T] where L ~ Geometric(1-p) sa pmf p^ℓ·(1-p), ℓ ≥ 0.
 *
 * E[L mod T] = Σ_{ℓ=0}^{∞} (ℓ mod T) · p^ℓ · (1-p)
 *            = (1-p) · Σ_{k=0}^{∞} Σ_{r=0}^{T-1} r · p^(kT+r)
 *            = (1-p) · [Σ_{r=0}^{T-1} r · p^r] · [Σ_{k=0}^{∞} p^(kT)]
 *            = (1-p) · S_r · 1/(1-p^T)
 *
 * where S_r = Σ_{r=0}^{T-1} r · p^r is a finite sum.
 */
function expectedMeterEnd(p: number, T: number): number {
  let sumR = 0;
  for (let r = 0; r < T; r++) {
    sumR += r * Math.pow(p, r);
  }
  return ((1 - p) * sumR) / (1 - Math.pow(p, T));
}

export function solveCascadeMeterChargeUp(cfg: CascadeMeterChargeUpConfig): CascadeMeterChargeUpResult {
  validateConfig(cfg);
  const { cascadeContinuationProbability: p, meterThreshold: T, fireRewardX: B } = cfg;

  // Win value PMF moments
  let muV = 0;
  let evV2 = 0;
  for (const e of cfg.winValuePmf) {
    muV += e.value * e.probability;
    evV2 += e.value * e.value * e.probability;
  }
  const sigmaV2 = Math.max(0, evV2 - muV * muV);

  // Chain length moments (Geometric(1-p))
  const eL = p / (1 - p);
  const varL = p / ((1 - p) * (1 - p));

  // Fire count: F = floor(L/T) ~ Geometric(1-p^T)
  const pT = Math.pow(p, T);
  const eF = pT / (1 - pT);
  const varF = pT / ((1 - pT) * (1 - pT));

  // Meter at end of spin: E[L mod T]
  const eMeterEnd = expectedMeterEnd(p, T);

  // Base payout (compound sum)
  const eYbase = eL * muV;
  const varYbase = eL * sigmaV2 + varL * muV * muV;

  // Feature payout
  const eYfeature = B * eF;
  const varYfeature = B * B * varF;

  // Total (independence approx for variance — full Var via MC)
  const eY = eYbase + eYfeature;
  const varY = varYbase + varYfeature;

  return {
    cascadeContinuationProbability: p,
    meterThreshold: T,
    fireRewardX: B,
    expectedChainLength: eL,
    varianceChainLength: varL,
    probZeroChain: 1 - p,
    expectedFiresPerSpin: eF,
    varianceFiresPerSpin: varF,
    probAtLeastOneFire: pT,
    expectedMeterEndOfSpin: eMeterEnd,
    expectedWinValuePerCascade: muV,
    varianceWinValuePerCascade: sigmaV2,
    expectedBasePayoutPerSpin: eYbase,
    varianceBasePayoutPerSpin: varYbase,
    expectedFeaturePayoutPerSpin: eYfeature,
    varianceFeaturePayoutPerSpin: varYfeature,
    expectedTotalPayoutPerSpin: eY,
    varianceTotalPayoutPerSpin: varY,
  };
}

// ── MC reference ────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleWinValue(pmf: CascadeMeterWinValuePmfEntry[], u: number): number {
  let acc = 0;
  for (const e of pmf) {
    acc += e.probability;
    if (u < acc) return e.value;
  }
  return pmf[pmf.length - 1].value;
}

export function simulateCascadeMeterChargeUp(
  cfg: CascadeMeterChargeUpConfig,
  spins: number,
  seed: number,
): CascadeMeterChargeUpMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(spins) || spins < 1) {
    throw new Error(`Invalid spins: ${spins}`);
  }
  const rng = mulberry32(seed);
  const { cascadeContinuationProbability: p, meterThreshold: T, fireRewardX: B } = cfg;

  let totalFires = 0;
  let totalChain = 0;
  let totalAnyFire = 0;
  let totalPay = 0;
  let totalMeterEnd = 0;
  let maxFires = 0;

  for (let spin = 0; spin < spins; spin++) {
    // Sample chain length L ~ Geometric(1-p): increment while rng < p.
    let L = 0;
    while (rng() < p) L += 1;
    // Sum cascade win values
    let basePay = 0;
    for (let k = 0; k < L; k++) {
      basePay += sampleWinValue(cfg.winValuePmf, rng());
    }
    // Fires = floor(L/T), meter end = L mod T
    const F = Math.floor(L / T);
    const meterEnd = L - F * T;
    const featurePay = F * B;
    const Y = basePay + featurePay;

    totalFires += F;
    totalChain += L;
    if (F >= 1) totalAnyFire += 1;
    totalPay += Y;
    totalMeterEnd += meterEnd;
    if (F > maxFires) maxFires = F;
  }

  return {
    spins,
    observedMeanFiresPerSpin: totalFires / spins,
    observedMeanChainLength: totalChain / spins,
    observedAtLeastOneFireFraction: totalAnyFire / spins,
    observedMeanTotalPayoutPerSpin: totalPay / spins,
    observedMeanMeterEndOfSpin: totalMeterEnd / spins,
    observedMaxFiresInSingleSpin: maxFires,
  };
}
