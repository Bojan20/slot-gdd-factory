/**
 * RTP ESTIMATOR UTILITY
 *
 * Brza procena RTP-a pre simulacije.
 * Koristi matematičke formule umesto Monte Carlo.
 *
 * NAPOMENA: Ovo je PROCENA, ne finalna vrednost!
 * Uvek verifikuj sa simulacijom.
 */

// ============================================
// TYPES
// ============================================

export interface PaytableEntry {
  symbol: string;
  tier: 'LP' | 'HP' | 'WILD';
  pays: { 3: number; 4: number; 5: number };
}

export interface ReelWeights {
  symbolCounts: Map<string, number[]>;  // symbol -> counts per reel
  stripLengths: number[];               // length per reel
}

export interface FeatureConfig {
  triggerRate: number;      // 1/X spins
  avgWin: number;           // average win in bet multiples
}

export interface RtpEstimate {
  baseGameRtp: number;
  featureRtps: { name: string; rtp: number }[];
  totalRtp: number;
  breakdown: string;
}

// ============================================
// PAYTABLE PROBABILITY CALCULATOR
// ============================================

/**
 * Calculate probability of N-of-a-kind for a symbol
 *
 * Formula for paylines:
 * P(3oak) = P(reel1) × P(reel2) × P(reel3) × (1 - P(reel4))
 *
 * Where P(reelN) = symbolCount[N] / stripLength[N] * rows
 * (simplified - assumes symbol can appear in any row)
 */
export function calculateSymbolProbability(
  symbolCounts: number[],
  stripLengths: number[],
  rows: number,
  wildCounts: number[] = []
): { p3oak: number; p4oak: number; p5oak: number } {
  const numReels = symbolCounts.length;

  // Probability of symbol appearing in window for each reel
  const pSymbol = symbolCounts.map((count, i) =>
    Math.min(1, (count / stripLengths[i]) * rows)
  );

  // Add wild probability (if wild can substitute)
  const pWild = wildCounts.length > 0
    ? wildCounts.map((count, i) => Math.min(1, (count / stripLengths[i]) * rows))
    : new Array(numReels).fill(0);

  // Combined probability (symbol OR wild)
  const pCombined = pSymbol.map((p, i) =>
    Math.min(1, p + pWild[i] - p * pWild[i])
  );

  // 3-of-a-kind: first 3 reels match, 4th doesn't (or there's no 4th)
  let p3oak = 1;
  for (let i = 0; i < Math.min(3, numReels); i++) {
    p3oak *= pCombined[i];
  }
  if (numReels > 3) {
    p3oak *= (1 - pCombined[3]);
  }

  // 4-of-a-kind: first 4 reels match, 5th doesn't
  let p4oak = 1;
  for (let i = 0; i < Math.min(4, numReels); i++) {
    p4oak *= pCombined[i];
  }
  if (numReels > 4) {
    p4oak *= (1 - pCombined[4]);
  }

  // 5-of-a-kind: all 5 reels match
  let p5oak = 1;
  for (let i = 0; i < Math.min(5, numReels); i++) {
    p5oak *= pCombined[i];
  }

  return { p3oak, p4oak, p5oak };
}

// ============================================
// BASE GAME RTP ESTIMATOR
// ============================================

/**
 * Estimate base game RTP from paytable and reel weights
 *
 * RTP = Σ (probability × payout) for all symbols and counts
 */
export function estimateBaseGameRtp(
  paytable: PaytableEntry[],
  reelWeights: ReelWeights,
  numPaylines: number,
  rows: number = 3
): number {
  let totalRtp = 0;

  // Get wild counts for substitution
  const wildEntry = paytable.find(p => p.tier === 'WILD');
  const wildCounts = wildEntry
    ? reelWeights.symbolCounts.get(wildEntry.symbol) || []
    : [];

  for (const entry of paytable) {
    if (entry.tier === 'WILD') continue; // Wild pays handled separately

    const symbolCounts = reelWeights.symbolCounts.get(entry.symbol);
    if (!symbolCounts) continue;

    const probs = calculateSymbolProbability(
      symbolCounts,
      reelWeights.stripLengths,
      rows,
      wildCounts
    );

    // RTP contribution per payline
    const symbolRtp =
      probs.p3oak * entry.pays[3] +
      probs.p4oak * entry.pays[4] +
      probs.p5oak * entry.pays[5];

    // Multiply by number of paylines
    // (simplified - doesn't account for overlapping wins)
    totalRtp += symbolRtp * numPaylines;
  }

  // Wild-only lines (rare but possible)
  if (wildEntry && wildCounts.length > 0) {
    const wildProbs = calculateSymbolProbability(
      wildCounts,
      reelWeights.stripLengths,
      rows
    );
    const wildRtp =
      wildProbs.p3oak * wildEntry.pays[3] +
      wildProbs.p4oak * wildEntry.pays[4] +
      wildProbs.p5oak * wildEntry.pays[5];
    totalRtp += wildRtp * numPaylines * 0.1; // Discount for rarity
  }

  return totalRtp;
}

// ============================================
// FEATURE RTP ESTIMATOR
// ============================================

/**
 * Estimate feature RTP contribution
 *
 * Feature RTP = (1 / triggerRate) × avgFeatureWin
 */
export function estimateFeatureRtp(feature: FeatureConfig): number {
  return feature.avgWin / feature.triggerRate;
}

// ============================================
// SCATTER PAY ESTIMATOR
// ============================================

/**
 * Estimate scatter pay RTP
 */
export function estimateScatterRtp(
  scatterCounts: number[],
  stripLengths: number[],
  rows: number,
  scatterPays: { count: number; pay: number }[]
): number {
  // P(scatter on reel) = count/length × rows (capped at 1 per reel)
  const pScatter = scatterCounts.map((count, i) =>
    Math.min(1, (count / stripLengths[i]) * rows)
  );

  let totalRtp = 0;

  for (const { count, pay } of scatterPays) {
    // Binomial probability for exactly N scatters
    const prob = binomialProbability(pScatter, count);
    totalRtp += prob * pay;
  }

  return totalRtp;
}

/**
 * Calculate binomial probability for scatter distribution
 * P(exactly k successes) across N independent reels
 */
function binomialProbability(probs: number[], k: number): number {
  const n = probs.length;
  if (k > n) return 0;

  // Generate all combinations of k reels from n
  const combinations = getCombinations(n, k);

  let totalProb = 0;
  for (const combo of combinations) {
    let prob = 1;
    for (let i = 0; i < n; i++) {
      if (combo.includes(i)) {
        prob *= probs[i];
      } else {
        prob *= (1 - probs[i]);
      }
    }
    totalProb += prob;
  }

  // Add probability for k+ (at least k)
  if (k < n) {
    for (let j = k + 1; j <= n; j++) {
      totalProb += binomialProbability(probs, j);
    }
  }

  return totalProb;
}

/**
 * Generate all combinations of k items from n
 */
function getCombinations(n: number, k: number): number[][] {
  const result: number[][] = [];

  function backtrack(start: number, current: number[]) {
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < n; i++) {
      current.push(i);
      backtrack(i + 1, current);
      current.pop();
    }
  }

  backtrack(0, []);
  return result;
}

// ============================================
// FULL RTP ESTIMATE
// ============================================

/**
 * Generate complete RTP estimate
 */
export function estimateFullRtp(
  paytable: PaytableEntry[],
  reelWeights: ReelWeights,
  numPaylines: number,
  rows: number,
  features: { name: string; config: FeatureConfig }[],
  scatterConfig?: {
    counts: number[];
    pays: { count: number; pay: number }[];
  }
): RtpEstimate {
  // Base game
  const baseGameRtp = estimateBaseGameRtp(paytable, reelWeights, numPaylines, rows);

  // Features
  const featureRtps = features.map(f => ({
    name: f.name,
    rtp: estimateFeatureRtp(f.config)
  }));

  // Scatter pays
  let scatterRtp = 0;
  if (scatterConfig) {
    scatterRtp = estimateScatterRtp(
      scatterConfig.counts,
      reelWeights.stripLengths,
      rows,
      scatterConfig.pays
    );
  }

  // Total
  const totalRtp = baseGameRtp +
    featureRtps.reduce((sum, f) => sum + f.rtp, 0) +
    scatterRtp;

  // Breakdown string
  const breakdown = [
    `Base Game: ${(baseGameRtp * 100).toFixed(2)}%`,
    ...featureRtps.map(f => `${f.name}: ${(f.rtp * 100).toFixed(2)}%`),
    scatterConfig ? `Scatter Pays: ${(scatterRtp * 100).toFixed(2)}%` : '',
    `─────────────────`,
    `TOTAL: ${(totalRtp * 100).toFixed(2)}%`
  ].filter(Boolean).join('\n');

  return {
    baseGameRtp,
    featureRtps,
    totalRtp,
    breakdown
  };
}

// ============================================
// QUICK ESTIMATE HELPERS
// ============================================

/**
 * Quick RTP sanity check
 */
export function quickRtpCheck(
  targetRtp: number,
  baseRtp: number,
  fsRate: number,
  fsAvgWin: number,
  hnwRate: number = 0,
  hnwAvgWin: number = 0,
  scatterRtp: number = 0
): { estimated: number; delta: number; status: 'OK' | 'LOW' | 'HIGH' } {
  const fsRtp = fsAvgWin / fsRate;
  const hnwRtp = hnwRate > 0 ? hnwAvgWin / hnwRate : 0;
  const estimated = baseRtp + fsRtp + hnwRtp + scatterRtp;
  const delta = estimated - targetRtp;

  let status: 'OK' | 'LOW' | 'HIGH';
  if (Math.abs(delta) < 0.005) status = 'OK';
  else if (delta < 0) status = 'LOW';
  else status = 'HIGH';

  return { estimated, delta, status };
}

/**
 * Calculate required feature avg win to hit target RTP
 */
export function requiredFeatureWin(
  targetRtp: number,
  currentBaseRtp: number,
  featureTriggerRate: number,
  otherFeaturesRtp: number = 0
): number {
  const remainingRtp = targetRtp - currentBaseRtp - otherFeaturesRtp;
  return remainingRtp * featureTriggerRate;
}

// ============================================
// VOLATILITY ESTIMATOR
// ============================================

/**
 * Estimate volatility index from paytable
 */
export function estimateVolatilityIndex(
  paytable: PaytableEntry[],
  reelWeights: ReelWeights,
  numPaylines: number,
  rows: number = 3
): { index: number; class: 'Low' | 'Medium' | 'High' | 'Very High' } {
  // Simplified: look at top pay vs hit rate ratio
  const topPay = Math.max(...paytable.map(p => p.pays[5]));
  const avgPay = paytable.reduce((sum, p) => sum + p.pays[5], 0) / paytable.length;

  // Higher ratio = higher volatility
  const ratio = topPay / avgPay;

  // Estimate based on typical ranges
  let index: number;
  let volatilityClass: 'Low' | 'Medium' | 'High' | 'Very High';

  if (ratio < 3) {
    index = 4;
    volatilityClass = 'Low';
  } else if (ratio < 5) {
    index = 6;
    volatilityClass = 'Medium';
  } else if (ratio < 8) {
    index = 10;
    volatilityClass = 'High';
  } else {
    index = 15;
    volatilityClass = 'Very High';
  }

  return { index, class: volatilityClass };
}

// ============================================
// EXPORT SUMMARY FUNCTION
// ============================================

export function printRtpSummary(estimate: RtpEstimate): void {
  console.log('\n════════════════════════════════════════');
  console.log('         RTP ESTIMATE SUMMARY');
  console.log('════════════════════════════════════════');
  console.log(estimate.breakdown);
  console.log('════════════════════════════════════════\n');

  if (estimate.totalRtp < 0.94) {
    console.warn('⚠️  WARNING: Estimated RTP below 94%');
  } else if (estimate.totalRtp > 0.97) {
    console.warn('⚠️  WARNING: Estimated RTP above 97%');
  } else {
    console.log('✅ RTP in typical range (94-97%)');
  }
}
