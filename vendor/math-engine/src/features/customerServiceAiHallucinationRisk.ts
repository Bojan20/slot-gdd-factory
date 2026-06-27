/**
 * W243 — Customer Service AI Hallucination Risk Analyzer (100. solver — pre-milestone).
 *
 * NOTE: Numbered as 99 here; W244 milestone goes to 100. (W243 = 100th cumulative).
 *
 * Models LLM chatbot hallucination probability per query; cost of regulator
 * complaint per false-statement; sample-and-correct human-oversight overhead.
 *
 * GDPR Art. 22 + EU AI Act Art. 14 + UKGC RTS 15 customer service standards.
 */

export interface AiHallucinationConfig {
  /** Per-query hallucination probability ∈ (0, 0.5). */
  perQueryHallucinationProb: number;
  /** Annual customer service queries (chatbot). */
  annualQueries: number;
  /** Human-in-the-loop sampling rate ∈ [0, 1]. */
  humanSamplingRate: number;
  /** Human reviewer detection rate ∈ (0, 1]. */
  humanDetectionRate: number;
  /** Per-uncorrected hallucination cost (regulator complaint + refund). */
  costPerUncorrectedHallucination: number;
  /** Per-query human review cost. */
  costPerHumanReview: number;
  /** Operator annual revenue. */
  operatorAnnualRevenue: number;
}

export interface AiHallucinationResult {
  expectedHallucinationsPerYear: number;
  detectedHallucinations: number;
  undetectedHallucinations: number;
  annualHumanReviewCost: number;
  annualUncorrectedRiskCost: number;
  totalAnnualAiOversightCost: number;
  costShareOfRevenue: number;
  aiSafetyScore: number;
  isCompliantEuAiActArt14: boolean;
}

function validate(c: AiHallucinationConfig): void {
  if (!Number.isFinite(c.perQueryHallucinationProb) || c.perQueryHallucinationProb <= 0 || c.perQueryHallucinationProb >= 0.5)
    throw new Error('hallucinationProb ∈ (0, 0.5)');
  if (!Number.isFinite(c.annualQueries) || c.annualQueries < 1) throw new Error('annualQueries ≥ 1');
  if (!Number.isFinite(c.humanSamplingRate) || c.humanSamplingRate < 0 || c.humanSamplingRate > 1) throw new Error('humanSamplingRate ∈ [0, 1]');
  if (!Number.isFinite(c.humanDetectionRate) || c.humanDetectionRate <= 0 || c.humanDetectionRate > 1) throw new Error('humanDetectionRate ∈ (0, 1]');
  if (!Number.isFinite(c.costPerUncorrectedHallucination) || c.costPerUncorrectedHallucination < 0) throw new Error('cost ≥ 0');
  if (!Number.isFinite(c.costPerHumanReview) || c.costPerHumanReview < 0) throw new Error('costPerReview ≥ 0');
  if (!Number.isFinite(c.operatorAnnualRevenue) || c.operatorAnnualRevenue <= 0) throw new Error('operatorAnnualRevenue > 0');
}

export function solveAiHallucination(cfg: AiHallucinationConfig): AiHallucinationResult {
  validate(cfg);
  const expectedHallucinationsPerYear = cfg.annualQueries * cfg.perQueryHallucinationProb;
  // Detected only when (a) human samples AND (b) human detects
  const effectiveDetectionRate = cfg.humanSamplingRate * cfg.humanDetectionRate;
  const detectedHallucinations = expectedHallucinationsPerYear * effectiveDetectionRate;
  const undetectedHallucinations = expectedHallucinationsPerYear - detectedHallucinations;

  const annualHumanReviewCost = cfg.annualQueries * cfg.humanSamplingRate * cfg.costPerHumanReview;
  const annualUncorrectedRiskCost = undetectedHallucinations * cfg.costPerUncorrectedHallucination;
  const totalAnnualAiOversightCost = annualHumanReviewCost + annualUncorrectedRiskCost;
  const costShareOfRevenue = totalAnnualAiOversightCost / cfg.operatorAnnualRevenue;

  // AI safety score: high human sampling + low hallucination
  const samplingScore = cfg.humanSamplingRate;
  const detectionScore = cfg.humanDetectionRate;
  const hallucinationScore = Math.max(0, 1 - cfg.perQueryHallucinationProb * 10);
  const aiSafetyScore = Math.max(0, Math.min(1, 0.3 * samplingScore + 0.3 * detectionScore + 0.4 * hallucinationScore));

  // EU AI Act Art. 14 (human oversight): require ≥ 5% sampling AND detection ≥ 0.9
  const isCompliantEuAiActArt14 = cfg.humanSamplingRate >= 0.05 && cfg.humanDetectionRate >= 0.9;

  return {
    expectedHallucinationsPerYear, detectedHallucinations, undetectedHallucinations,
    annualHumanReviewCost, annualUncorrectedRiskCost, totalAnnualAiOversightCost,
    costShareOfRevenue, aiSafetyScore, isCompliantEuAiActArt14,
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

export interface AiHallucinationMcResult {
  episodes: number;
  observedHallucinationsMean: number;
}

export function simulateAiHallucination(cfg: AiHallucinationConfig, seed: number, episodes: number): AiHallucinationMcResult {
  validate(cfg);
  if (!Number.isInteger(episodes) || episodes < 100) throw new Error('episodes ≥ 100');
  const rng = makeRng(seed);
  let sum = 0;
  const querySample = Math.min(cfg.annualQueries, 10000);
  for (let ep = 0; ep < episodes; ep++) {
    let count = 0;
    for (let i = 0; i < querySample; i++) {
      if (rng() < cfg.perQueryHallucinationProb) count++;
    }
    sum += count * (cfg.annualQueries / querySample);
  }
  return { episodes, observedHallucinationsMean: sum / episodes };
}
