/**
 * W152 Wave 127 — Anticipation/Tease Reel Probability Tracker (Faza 12 ext, post-W100 roadmap).
 *
 * Closed-form solver za "anticipation/tease reel" UX mehaniku — BTG
 * Megaways tease reels / Pragmatic anticipation reels / NetEnt suspense
 * reels. Bayesian update P(bonus trigger | m scatters observed after i
 * reels), sa anticipation activation kada conditional probability prelazi
 * threshold (typically 0.5 za "suspense" cinematic).
 *
 * Naming policy (clean-room): "anticipation", "tease", "suspense reels"
 * = generic industry terms. UKGC regulates anticipation UX (RTS 8 §3.5
 * limits "false anticipation" — math model handles strict Bayesian).
 * No vendor TM.
 *
 * Distinct from:
 *   • W110 Bonus Trigger Wait Time — long-run trigger frequency (cross-spins)
 *   • W118 Bonus Collect-N — collect-N threshold (Negative Binomial)
 *   • W101 Symbol Upgrade Chain — sequential symbol upgrade
 *   • All other Wxxx — none compute Bayesian conditional P(trigger | partial state)
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * N reels, per-reel scatter probability q (independent Bernoulli).
 * Bonus trigger requires K total scatters across all N reels.
 *
 * State observation: after reel i reveals (i = 1..N), we know m scatters
 * landed so far on reels 1..i. Remaining: N-i reels yet to reveal.
 *
 * Bayesian conditional:
 *   P(trigger | m, i) = P(≥ K−m scatters in (N−i) remaining reels)
 *                    = Σ_{j=K−m}^{N−i} C(N−i, j) · q^j · (1−q)^(N−i−j)
 *
 *   Special cases:
 *     • m ≥ K          → P = 1   (already triggered)
 *     • K − m > N − i  → P = 0   (impossible to reach K)
 *
 * Anticipation activation: triggered za state (m, i) iff
 *   P(trigger | m, i) ≥ anticipationThreshold (e.g. 0.5)
 *
 * Per-spin metrics:
 *   • P(anticipation active at reel i) = Σ_m P(m scatters by reel i) · I(activated)
 *   • Expected anticipation duration = Σ_i P(active at reel i)
 *
 * Long-run rate (across many spins):
 *   • E[anticipation triggers per spin] = same as P(any anticipation activation in spin)
 *   • E[bonus triggers per spin] = P(total ≥ K scatters) = Σ_{j=K}^N C(N,j)·q^j·(1-q)^(N-j)
 *
 * False-anticipation rate:
 *   • P(activated but no trigger | activated) = 1 − P(trigger | activated state)
 *   • Operator must disclose UKGC RTS 8 §3.5: anticipation rate must match
 *     actual trigger conditional (no inflation).
 *
 * Industry compliance:
 *   • UKGC RTS 8 §3.5 — "false anticipation" prohibition (compliant if math model
 *     uses true Bayesian conditional, not inflated UX)
 *   • MGA PPD §11.f — anticipation rate disclosure
 *   • eCOGRA Generic Slots Audit — verifies anticipation matches math
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateAnticipationReelTease() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface AnticipationReelTeaseConfig {
  /** Number of reels (positive integer ≥ 2). */
  reelCount: number;
  /** Per-reel scatter probability (0 < q ≤ 1). */
  scatterProbabilityPerReel: number;
  /** Required scatter count for bonus trigger (positive integer ≤ reelCount). */
  triggerScatterCount: number;
  /** Anticipation threshold (0 < t ≤ 1, typically 0.5). */
  anticipationThreshold?: number;
}

export interface PerReelAnticipationStats {
  /** Reel index (1..N). */
  reelIndex: number;
  /** Probability anticipation is active at this reel boundary. */
  probAnticipationActive: number;
  /** Conditional P(trigger | currently active). */
  conditionalTriggerProb: number;
}

export interface AnticipationReelTeaseResult {
  reelCount: number;
  scatterProbabilityPerReel: number;
  triggerScatterCount: number;
  anticipationThreshold: number;
  // Per-reel anticipation
  perReel: PerReelAnticipationStats[];
  // Aggregate
  probAnticipationPerSpin: number;        // P(ANY anticipation activation in spin)
  expectedAnticipationDuration: number;   // E[#reels with active anticipation]
  probBonusTriggerPerSpin: number;        // P(total scatters ≥ K)
  // False anticipation
  probAnticipationButNoTrigger: number;   // P(anticipation activated AND no bonus)
  falseAnticipationRate: number;          // P(no trigger | activated)
}

export interface AnticipationReelTeaseMCResult {
  spins: number;
  observedAnticipationActivationsPerSpin: number;
  observedBonusTriggersPerSpin: number;
  observedFalseAnticipationFraction: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(cfg: AnticipationReelTeaseConfig): void {
  if (!Number.isInteger(cfg.reelCount) || cfg.reelCount < 2) {
    throw new Error(`reelCount must be integer ≥ 2 (got ${cfg.reelCount})`);
  }
  const q = cfg.scatterProbabilityPerReel;
  if (!Number.isFinite(q) || q <= 0 || q > 1) {
    throw new Error(`scatterProbabilityPerReel must be in (0, 1] (got ${q})`);
  }
  if (
    !Number.isInteger(cfg.triggerScatterCount) ||
    cfg.triggerScatterCount < 1 ||
    cfg.triggerScatterCount > cfg.reelCount
  ) {
    throw new Error(
      `triggerScatterCount must be integer in [1, reelCount] (got ${cfg.triggerScatterCount})`,
    );
  }
  if (cfg.anticipationThreshold !== undefined) {
    if (!Number.isFinite(cfg.anticipationThreshold) || cfg.anticipationThreshold <= 0 || cfg.anticipationThreshold > 1) {
      throw new Error(`anticipationThreshold must be in (0, 1] (got ${cfg.anticipationThreshold})`);
    }
  }
}

// ── Binomial helper ─────────────────────────────────────────────────────────

function binomCoeff(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let c = 1;
  const kEff = Math.min(k, n - k);
  for (let i = 0; i < kEff; i++) {
    c = (c * (n - i)) / (i + 1);
  }
  return c;
}

/** P(X ≥ k | X ~ Binomial(n, q)) = Σ_{j=k..n} C(n,j) q^j (1-q)^(n-j). */
function probBinomGE(n: number, k: number, q: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let sum = 0;
  for (let j = k; j <= n; j++) {
    sum += binomCoeff(n, j) * Math.pow(q, j) * Math.pow(1 - q, n - j);
  }
  return Math.max(0, Math.min(1, sum));
}

/** P(X = k | X ~ Binomial(n, q)). */
function probBinomEq(n: number, k: number, q: number): number {
  if (k < 0 || k > n) return 0;
  return binomCoeff(n, k) * Math.pow(q, k) * Math.pow(1 - q, n - k);
}

// ── Solver ─────────────────────────────────────────────────────────────────

export function solveAnticipationReelTease(
  config: AnticipationReelTeaseConfig,
): AnticipationReelTeaseResult {
  validate(config);
  const N = config.reelCount;
  const q = config.scatterProbabilityPerReel;
  const K = config.triggerScatterCount;
  const T = config.anticipationThreshold ?? 0.5;

  // Per-reel anticipation analysis: at each reel index i (after reveal),
  // for each possible m count (0..i), check if P(trigger | m, i) ≥ T.
  // Aggregate: probAnticipationActive at reel i = Σ_m P(m scatters by reel i) · I_activated(m, i)

  const perReel: PerReelAnticipationStats[] = [];
  let probAnyActivation = 0;
  let expectedDuration = 0;

  // For "any activation in spin" — track per-state cumulative spin-level event.
  // Simpler: aggregate over all reels i = 1..N
  //   P(ANY active) = P(at least one reel i has activated state)
  // Conservative bound via union: ≤ Σ P(active at reel i)
  // Exact via joint state evolution. For closed-form simplicity, we compute
  // the EXACT P(any active) via state propagation.

  // State (m, i) probabilities for i = 0..N
  // P(m, i) = P(m scatters after reels 1..i) = Binomial(i, q) at m

  // Track "ever activated": boolean per state.
  // Use forward-state tracking:
  //   states (m, i, activated_flag), evolve as reel reveals
  // Simpler: compute P(active state reached at any reel) = 1 - P(never active up to N)
  //   P(state (m, i) not activated) = ¬(P(trigger | m, i) ≥ T)

  // Build "activated lattice": activatedAt[i][m] = true if (m, i) state is activated
  const activatedLattice: boolean[][] = [];
  for (let i = 0; i <= N; i++) {
    const row: boolean[] = new Array<boolean>(i + 1);
    for (let m = 0; m <= i; m++) {
      // Already triggered if m ≥ K
      if (m >= K) {
        row[m] = true;
      } else {
        // P(trigger | reveal continuing) = P(≥ K−m scatters in N−i remaining)
        const need = K - m;
        const remaining = N - i;
        if (remaining <= 0 || need > remaining) {
          row[m] = false;
        } else {
          const pCond = probBinomGE(remaining, need, q);
          row[m] = pCond >= T;
        }
      }
    }
    activatedLattice.push(row);
  }

  // Per-reel: P(active at reel i) = P(state (m, i) is activated)
  // Aggregate union via complement: P(NEVER active through reel i) =
  // sum over (m=0..i) of P(reach (m, i) without ever being active).
  //
  // For tractable closed-form, track P_t(m, i) = "P(reached (m,i) AND never activated yet)".
  // Then P(ANY active by reel i) = 1 − Σ_m P_t(m, i).

  // Initial: P_t(0, 0) = 1 (start state, never activated).
  // Transition from (m, i) to (m, i+1) with prob (1-q) [no scatter on reel i+1]
  //          and to (m+1, i+1) with prob q [scatter].
  // For state (m, i) NOT activated: contributes to P_t(m, i+1) via (1-q) and to (m+1, i+1) via q.

  let pNeverActive: number[][] = [];
  // Reel 0: only state (0, 0) reachable with prob 1, activatedLattice[0][0] check
  pNeverActive.push([activatedLattice[0][0] ? 0 : 1]);

  for (let i = 0; i < N; i++) {
    const prev = pNeverActive[i];
    const next: number[] = new Array<number>(i + 2).fill(0);
    for (let m = 0; m <= i; m++) {
      const pmi = prev[m];
      if (pmi <= 0) continue;
      // From (m, i) NOT activated → reel i+1:
      //   stays NOT activated only if next state (m, i+1) ALSO not activated
      //   becomes activated if next state IS activated → don't propagate to next
      const pNoScat = pmi * (1 - q);
      const pScat = pmi * q;
      // (m, i+1)
      if (!activatedLattice[i + 1][m]) next[m] += pNoScat;
      // (m+1, i+1)
      if (!activatedLattice[i + 1][m + 1]) next[m + 1] += pScat;
    }
    pNeverActive.push(next);
  }

  // P(active by reel i) = 1 − Σ pNeverActive[i]
  for (let i = 1; i <= N; i++) {
    let pNever = 0;
    for (const p of pNeverActive[i]) pNever += p;
    const pActiveByReel_i = Math.max(0, Math.min(1, 1 - pNever));

    // P(active AT reel i exactly): probability state (m, i) is in activated set
    let pActiveAtReel = 0;
    let pConditional = 0;
    let pBaseAtReel = 0; // P(reach activated state at reel i)
    for (let m = 0; m <= i; m++) {
      if (activatedLattice[i][m]) {
        const pState = probBinomEq(i, m, q);
        pActiveAtReel += pState;
        // Conditional P(trigger | this activated state)
        const need = K - m;
        const remaining = N - i;
        const pTrigGivenState = remaining <= 0
          ? (m >= K ? 1 : 0)
          : need <= 0 ? 1
          : need > remaining ? 0
          : probBinomGE(remaining, need, q);
        pConditional += pState * pTrigGivenState;
        pBaseAtReel += pState;
      }
    }
    const condAvg = pBaseAtReel > 1e-12 ? pConditional / pBaseAtReel : 0;
    perReel.push({
      reelIndex: i,
      probAnticipationActive: pActiveAtReel,
      conditionalTriggerProb: condAvg,
    });
    expectedDuration += pActiveAtReel;

    if (i === N) probAnyActivation = pActiveByReel_i;
  }

  // Bonus trigger: P(total ≥ K) = Binomial(N, q) tail
  const probBonusTrigger = probBinomGE(N, K, q);

  // False anticipation: P(anticipation BUT no trigger) = P(anticipation) − P(anticipation AND trigger)
  // P(anticipation AND trigger) ≤ P(trigger). For Bayesian-consistent activation:
  //   P(anticipation AND trigger) = P(activation reached state X AND trigger occurred)
  //   = Σ over end states (m=N total) where some intermediate (m_i, i) is activated AND m_N ≥ K
  // Conservative computation: P(antic AND trigger) = P(antic) − probAnticipationButNoTrigger
  // Direct: false_rate = (P(antic) − P(trigger)) when antic ≥ trigger (rare),
  //         else = (1 − P(trigger | antic))
  // For threshold-based activation: states activated have ≥ T trigger prob.
  // Conservative ceiling: P(no trigger | antic) ≤ 1 − T (since condition was ≥ T).
  const probAntiButNoTrigger = Math.max(0, probAnyActivation - probBonusTrigger);
  const falseRate = probAnyActivation > 1e-12 ? probAntiButNoTrigger / probAnyActivation : 0;

  return {
    reelCount: N,
    scatterProbabilityPerReel: q,
    triggerScatterCount: K,
    anticipationThreshold: T,
    perReel,
    probAnticipationPerSpin: probAnyActivation,
    expectedAnticipationDuration: expectedDuration,
    probBonusTriggerPerSpin: probBonusTrigger,
    probAnticipationButNoTrigger: probAntiButNoTrigger,
    falseAnticipationRate: falseRate,
  };
}

// ── MC reference solver ────────────────────────────────────────────────────

function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulateAnticipationReelTease(
  config: AnticipationReelTeaseConfig,
  spins: number,
  seed: number,
): AnticipationReelTeaseMCResult {
  validate(config);
  const rng = makePrng(seed);
  const N = config.reelCount;
  const q = config.scatterProbabilityPerReel;
  const K = config.triggerScatterCount;
  const T = config.anticipationThreshold ?? 0.5;

  let anticipations = 0;
  let triggers = 0;
  let falseAntics = 0;

  for (let t = 0; t < spins; t++) {
    let m = 0;
    let triggeredThisSpin = false;
    let anticipatedThisSpin = false;
    for (let i = 0; i < N; i++) {
      if (rng() < q) m++;
      // After revealing reel (i+1), check anticipation activation
      const reelsRevealed = i + 1;
      const remaining = N - reelsRevealed;
      if (m >= K) {
        // Already triggered
        if (!anticipatedThisSpin) anticipatedThisSpin = true;
      } else if (remaining > 0 && K - m <= remaining) {
        const pCond = probBinomGE(remaining, K - m, q);
        if (pCond >= T) anticipatedThisSpin = true;
      }
    }
    if (m >= K) triggeredThisSpin = true;
    if (anticipatedThisSpin) anticipations++;
    if (triggeredThisSpin) triggers++;
    if (anticipatedThisSpin && !triggeredThisSpin) falseAntics++;
  }

  return {
    spins,
    observedAnticipationActivationsPerSpin: anticipations / spins,
    observedBonusTriggersPerSpin: triggers / spins,
    observedFalseAnticipationFraction: anticipations > 0 ? falseAntics / anticipations : 0,
  };
}
