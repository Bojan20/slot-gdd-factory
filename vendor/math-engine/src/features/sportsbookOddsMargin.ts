/**
 * W242 — Sportsbook Pricing / Odds Compilation Margin Analyzer (99. solver).
 *
 * UKGC sportsbook RTS 12 + MGA Sports Standards §11. Models N-outcome event,
 * each with true probability p_i. Bookmaker's price implies probability q_i.
 * Overround/vig = Σq_i - 1; per-outcome margin = (q_i - p_i)/p_i.
 */

export interface SportsbookConfig {
  /** True probabilities Σ p_i = 1. */
  trueProbabilities: number[];
  /** Bookmaker prices (decimal odds, e.g. 2.0, 3.5). */
  decimalOdds: number[];
  /** Sportsbook annual handle (currency). */
  annualHandle: number;
  /** Customer wager distribution (fraction of handle per outcome). */
  customerWagerDistribution: number[];
}

export interface SportsbookResult {
  /** Implied probabilities q_i = 1 / odds_i. */
  impliedProbabilities: number[];
  /** Overround = Σ q_i - 1 (book margin %). */
  overround: number;
  /** Per-outcome margin (q_i - p_i)/p_i. */
  perOutcomeMargin: number[];
  /** Average expected margin weighted by wager distribution. */
  weightedExpectedMargin: number;
  /** Annual expected GGR (book profit). */
  expectedAnnualGgr: number;
  /** UKGC margin disclosure threshold compliance (≤ 15% overround). */
  isCompliantUkgcRts12: boolean;
}

function validate(c: SportsbookConfig): void {
  if (!Array.isArray(c.trueProbabilities) || c.trueProbabilities.length < 2) throw new Error('≥ 2 outcomes required');
  const N = c.trueProbabilities.length;
  if (!Array.isArray(c.decimalOdds) || c.decimalOdds.length !== N) throw new Error('decimalOdds length mismatch');
  if (!Array.isArray(c.customerWagerDistribution) || c.customerWagerDistribution.length !== N) throw new Error('wagerDist length mismatch');
  let pSum = 0;
  for (const p of c.trueProbabilities) {
    if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error('probability ∈ [0, 1]');
    pSum += p;
  }
  if (Math.abs(pSum - 1) > 1e-6) throw new Error('true probabilities must sum to 1');
  for (const o of c.decimalOdds) {
    if (!Number.isFinite(o) || o <= 1) throw new Error('decimalOdds > 1');
  }
  let wSum = 0;
  for (const w of c.customerWagerDistribution) {
    if (!Number.isFinite(w) || w < 0) throw new Error('wager weight ≥ 0');
    wSum += w;
  }
  if (Math.abs(wSum - 1) > 1e-6) throw new Error('wager distribution must sum to 1');
  if (!Number.isFinite(c.annualHandle) || c.annualHandle < 0) throw new Error('annualHandle ≥ 0');
}

export function solveSportsbook(cfg: SportsbookConfig): SportsbookResult {
  validate(cfg);
  const N = cfg.trueProbabilities.length;
  const impliedProbabilities = cfg.decimalOdds.map(o => 1 / o);
  const overround = impliedProbabilities.reduce((s, q) => s + q, 0) - 1;
  const perOutcomeMargin: number[] = new Array(N);
  for (let i = 0; i < N; i++) {
    perOutcomeMargin[i] = cfg.trueProbabilities[i] > 1e-9
      ? (impliedProbabilities[i] - cfg.trueProbabilities[i]) / cfg.trueProbabilities[i]
      : 0;
  }
  // Weighted expected margin = Σ w_i · (1 − p_i · odds_i)
  let weightedExpectedMargin = 0;
  for (let i = 0; i < N; i++) {
    weightedExpectedMargin += cfg.customerWagerDistribution[i] * (1 - cfg.trueProbabilities[i] * cfg.decimalOdds[i]);
  }
  const expectedAnnualGgr = weightedExpectedMargin * cfg.annualHandle;
  const isCompliantUkgcRts12 = overround <= 0.15;
  return {
    impliedProbabilities, overround, perOutcomeMargin,
    weightedExpectedMargin, expectedAnnualGgr, isCompliantUkgcRts12,
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

export interface SportsbookMcResult {
  episodes: number;
  observedGgrMean: number;
}

export function simulateSportsbook(cfg: SportsbookConfig, seed: number, episodes: number): SportsbookMcResult {
  validate(cfg);
  if (!Number.isInteger(episodes) || episodes < 1000) throw new Error('episodes ≥ 1000');
  const rng = makeRng(seed);
  let sum = 0;
  for (let i = 0; i < episodes; i++) {
    // Simulate handle distribution + outcome realization
    const u = rng();
    let cumWager = 0;
    let pickedIdx = 0;
    for (let j = 0; j < cfg.customerWagerDistribution.length; j++) {
      cumWager += cfg.customerWagerDistribution[j];
      if (u < cumWager) { pickedIdx = j; break; }
    }
    const r = rng();
    let cumProb = 0;
    let outcomeIdx = 0;
    for (let j = 0; j < cfg.trueProbabilities.length; j++) {
      cumProb += cfg.trueProbabilities[j];
      if (r < cumProb) { outcomeIdx = j; break; }
    }
    // Stake = handle / episodes (simplified). Bookmaker profit per stake.
    const stake = cfg.annualHandle / episodes;
    if (pickedIdx === outcomeIdx) {
      sum -= stake * (cfg.decimalOdds[pickedIdx] - 1); // bookmaker pays player
    } else {
      sum += stake; // bookmaker keeps stake
    }
  }
  return { episodes, observedGgrMean: sum };
}
