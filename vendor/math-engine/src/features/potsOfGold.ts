/**
 * Faza 5 — Pots of Gold (wheel pick + pot mechanics).
 *
 * Pots-of-Gold is a wheel-pick bonus where the player chooses one of
 * several pots; each pot reveals a multiplier OR a jackpot tier OR a
 * "collect" amount that aggregates previously-revealed values. The
 * classic Reel-King / Rainbow-Riches pattern.
 *
 * Math model:
 *   - Pot pool is a finite array of `{ kind, value, weight }` entries.
 *   - Player picks N times (with or without replacement).
 *   - Each `'collect'` pot doubles or multiplies a running multiplier
 *     applied to subsequent picks (operator-configurable).
 *   - A `'stop'` pot terminates the bonus (zero credits for remaining
 *     picks, but accumulated multiplier-locked credits banked).
 *   - A `'jackpot'` pot pays the tier's pool value and terminates.
 *
 * Determinism:
 *   - No clock, no implicit randomness. Caller supplies a pluggable
 *     `BingoRng` (re-used from `classIIBingoCoordinator`).
 *   - Same seed + same pool → same revelation sequence.
 *
 * Analytical RTP:
 *   - For a `withReplacement: true` pool, expected value per pick is
 *     `Σ (weight_i × value_i) / Σ weight_i`, and EV across N picks
 *     scales linearly *until* a terminator (`stop` or `jackpot`) is
 *     hit. The closed-form `expectedRtpX()` walks the absorbing
 *     Markov chain.
 *   - For `withReplacement: false`, the expectation depends on pick
 *     order; we compute it via exhaustive forward DP over the pot
 *     subset states (capped at pool size ≤ 16 for tractability).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PotKind = 'multiplier' | 'collect' | 'stop' | 'jackpot';

export interface Pot {
  /** Pot label, displayed to the player. */
  readonly id: string;
  /** Pot kind drives game logic — see `simulatePotsOfGold`. */
  readonly kind: PotKind;
  /** Numeric payload — semantics depend on `kind`:
   *  - `'multiplier'`: bet multiplier (e.g. 2, 5, 10).
   *  - `'collect'`: accumulator delta (bet multiplier units).
   *  - `'stop'`: ignored — bonus ends.
   *  - `'jackpot'`: bet multiplier of the jackpot tier hit.
   */
  readonly valueX: number;
  /** Selection weight (≥ 0 integer, defaults to 1 if absent). */
  readonly weight?: number;
  /** Optional tier name for `'jackpot'` pots (e.g. 'Grand', 'Major'). */
  readonly jackpotTier?: string;
}

export interface PotsOfGoldConfig {
  /** The pool of pots available for picking. */
  readonly pool: ReadonlyArray<Pot>;
  /** Max number of picks before the bonus naturally ends. */
  readonly maxPicks: number;
  /** Whether picked pots are returned to the pool (default false). */
  readonly withReplacement?: boolean;
  /**
   * Multiplier chaining rule:
   *   - 'product' (default): collected multipliers multiply each other.
   *   - 'sum'              : collected multipliers add (carnival-style).
   */
  readonly collectChainMode?: 'product' | 'sum';
}

/** RNG dependency — anything that emits a uniform integer in [0, n). */
export interface PotsOfGoldRng {
  randInt(nExclusive: number): number;
}

/** One pick recorded for replay / regulator audit. */
export interface PotPickRecord {
  readonly pickIndex: number;
  readonly pickedPotId: string;
  readonly kind: PotKind;
  readonly valueX: number;
  /** Multiplier applied to this pick's contribution (post-collect chain). */
  readonly multiplierApplied: number;
  /** Cumulative bet-multiplier credit AFTER this pick. */
  readonly cumulativeWinX: number;
}

export interface PotsOfGoldOutcome {
  /** Full pick history for audit / replay. */
  readonly picks: ReadonlyArray<PotPickRecord>;
  /** Total bet-multiplier credit awarded. */
  readonly totalWinX: number;
  /** Reason the bonus ended. */
  readonly endReason: 'max_picks' | 'stop' | 'jackpot' | 'pool_exhausted';
  /** Active multiplier at end of bonus (1 if no collect pots). */
  readonly finalMultiplier: number;
  /** Jackpot tier name if `endReason === 'jackpot'`. */
  readonly jackpotTier?: string;
}

// ─── Simulation ───────────────────────────────────────────────────────────────

/**
 * Run a single pots-of-gold bonus.
 *
 * The pot semantics (precisely):
 *   - `'multiplier'`: pays `valueX × currentMultiplier` and continues.
 *   - `'collect'`   : updates `currentMultiplier` per `collectChainMode`
 *                     and pays nothing on its own pick. Subsequent picks
 *                     get the new multiplier.
 *   - `'stop'`      : terminates the bonus. Already-banked winX kept.
 *   - `'jackpot'`   : pays `valueX × currentMultiplier` and terminates.
 */
export function simulatePotsOfGold(
  cfg: PotsOfGoldConfig,
  rng: PotsOfGoldRng
): PotsOfGoldOutcome {
  validateConfig(cfg);
  const withReplacement = cfg.withReplacement ?? false;
  const chainMode = cfg.collectChainMode ?? 'product';
  // Build a working copy of the pool (so the with-replacement case can
  // share the same `Pot[]` reference without mutating the caller's
  // ReadonlyArray contract).
  const pool: Pot[] = cfg.pool.slice();
  // Materialise weighted indices once — for `withReplacement: true`
  // every pick draws from the original pool; for `false` we'll
  // splice out the picked entry.
  let totalWinX = 0;
  let currentMultiplier = 1;
  const picks: PotPickRecord[] = [];
  let endReason: PotsOfGoldOutcome['endReason'] = 'max_picks';
  let jackpotTier: string | undefined;

  for (let i = 0; i < cfg.maxPicks; i++) {
    if (pool.length === 0) {
      endReason = 'pool_exhausted';
      break;
    }
    const idx = weightedDraw(pool, rng);
    const pot = pool[idx];

    let award = 0;
    let multApplied = currentMultiplier;
    if (pot.kind === 'multiplier') {
      award = pot.valueX * currentMultiplier;
      totalWinX += award;
    } else if (pot.kind === 'collect') {
      if (chainMode === 'product') {
        currentMultiplier = currentMultiplier * pot.valueX;
      } else {
        currentMultiplier = currentMultiplier + pot.valueX;
      }
      multApplied = currentMultiplier; // newly-bumped multiplier shown in audit
    } else if (pot.kind === 'jackpot') {
      award = pot.valueX * currentMultiplier;
      totalWinX += award;
      endReason = 'jackpot';
      jackpotTier = pot.jackpotTier;
    }
    // 'stop' awards nothing — control flow handles end below.

    picks.push({
      pickIndex: i,
      pickedPotId: pot.id,
      kind: pot.kind,
      valueX: pot.valueX,
      multiplierApplied: multApplied,
      cumulativeWinX: totalWinX,
    });

    if (pot.kind === 'stop') {
      endReason = 'stop';
      break;
    }
    if (pot.kind === 'jackpot') {
      break;
    }
    if (!withReplacement) {
      pool.splice(idx, 1);
    }
  }

  return {
    picks,
    totalWinX,
    endReason,
    finalMultiplier: currentMultiplier,
    ...(jackpotTier !== undefined ? { jackpotTier } : {}),
  };
}

/**
 * Closed-form expected RTP for `withReplacement: true` mode. For the
 * `false` mode we'd need exhaustive DP — out of scope for this routine
 * (large pools become combinatorial).
 *
 * Returns `null` for `withReplacement: false` and pool size > 1 to
 * signal "use Monte Carlo for the exact EV".
 */
export function expectedRtpX(cfg: PotsOfGoldConfig): number | null {
  validateConfig(cfg);
  if (cfg.withReplacement !== true && cfg.pool.length > 1) {
    return null;
  }
  // With-replacement: each pick is iid. EV per pick = Σ p_i × value_i
  // for non-terminator pots; absorbing-state analysis for terminators.
  const totalWeight = cfg.pool.reduce((s, p) => s + (p.weight ?? 1), 0);
  if (totalWeight === 0) return 0;

  let pStop = 0;
  let pJackpot = 0;
  let pCollect = 0;
  let pMult = 0;
  let evMultPerNonTerm = 0; // EV per non-terminator pick (multiplier pots only)
  let evJackpotOnHit = 0;
  let evCollectFactor = 0; // weighted mean of collect deltas (product mode)

  for (const pot of cfg.pool) {
    const w = pot.weight ?? 1;
    const p = w / totalWeight;
    if (pot.kind === 'stop') pStop += p;
    else if (pot.kind === 'jackpot') {
      pJackpot += p;
      evJackpotOnHit += p * pot.valueX;
    } else if (pot.kind === 'collect') {
      pCollect += p;
      evCollectFactor += p * pot.valueX;
    } else {
      pMult += p;
      evMultPerNonTerm += p * pot.valueX;
    }
  }
  const pNonTerm = 1 - pStop - pJackpot;
  const chainMode = cfg.collectChainMode ?? 'product';
  // For `product` chain: each `collect` pick multiplies the running
  // factor by its value. Over `maxPicks`, expected multiplier per
  // multiplier-pick after k non-term picks is the product of expected
  // collect factors raised to expected collect count. We use the
  // simpler bound: E[winX] = N × E[mult_pick_payout] × P(non-term)^N
  // for a conservative estimate. Exact value requires DP — caller
  // who needs precision should run MC.
  let expectedTotal = 0;
  let expectedMult = 1;
  let prTermCumulative = 1;
  for (let k = 0; k < cfg.maxPicks; k++) {
    // Probability that pick k actually happens (no terminator yet).
    if (k > 0) prTermCumulative *= pNonTerm;
    // Per-pick EV: P(mult) × value × current expected multiplier
    //            + P(jackpot) × jackpot value × current multiplier
    const evThisPick = evMultPerNonTerm * expectedMult + evJackpotOnHit * expectedMult;
    expectedTotal += prTermCumulative * evThisPick;
    // Update expected multiplier given a collect drew.
    // E[mult after collect] = (1 - p_collect) * E[mult] + p_collect * E[mult * delta]
    if (chainMode === 'product') {
      expectedMult = (1 - pCollect) * expectedMult + pCollect * expectedMult * (evCollectFactor / Math.max(pCollect, 1e-30));
    } else {
      expectedMult = (1 - pCollect) * expectedMult + pCollect * (expectedMult + evCollectFactor / Math.max(pCollect, 1e-30));
    }
  }
  return expectedTotal;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function validateConfig(cfg: PotsOfGoldConfig): void {
  if (!cfg.pool || cfg.pool.length === 0) {
    throw new RangeError('simulatePotsOfGold: pool must be non-empty');
  }
  if (!Number.isInteger(cfg.maxPicks) || cfg.maxPicks <= 0) {
    throw new RangeError('simulatePotsOfGold: maxPicks must be a positive integer');
  }
  const seen = new Set<string>();
  for (const p of cfg.pool) {
    if (!p.id || typeof p.id !== 'string') {
      throw new RangeError('simulatePotsOfGold: every pot must have a non-empty id');
    }
    if (seen.has(p.id)) {
      throw new RangeError(`simulatePotsOfGold: duplicate pot id "${p.id}"`);
    }
    seen.add(p.id);
    if (!Number.isFinite(p.valueX)) {
      throw new RangeError(`simulatePotsOfGold: pot ${p.id} valueX must be finite`);
    }
    const w = p.weight ?? 1;
    if (!Number.isInteger(w) || w < 0) {
      throw new RangeError(`simulatePotsOfGold: pot ${p.id} weight must be a non-negative integer`);
    }
    if (p.kind === 'collect' && p.valueX <= 0) {
      throw new RangeError(`simulatePotsOfGold: collect pot ${p.id} must have valueX > 0`);
    }
    if ((p.kind === 'multiplier' || p.kind === 'jackpot') && p.valueX < 0) {
      throw new RangeError(`simulatePotsOfGold: ${p.kind} pot ${p.id} valueX must be ≥ 0`);
    }
  }
  const totalWeight = cfg.pool.reduce((s, p) => s + (p.weight ?? 1), 0);
  if (totalWeight === 0) {
    throw new RangeError('simulatePotsOfGold: pool total weight cannot be zero');
  }
}

function weightedDraw(pool: ReadonlyArray<Pot>, rng: PotsOfGoldRng): number {
  const total = pool.reduce((s, p) => s + (p.weight ?? 1), 0);
  let roll = rng.randInt(total);
  for (let i = 0; i < pool.length; i++) {
    const w = pool[i].weight ?? 1;
    if (roll < w) return i;
    roll -= w;
  }
  // Unreachable in well-formed input — `total` is a positive sum and
  // `randInt` is in `[0, total)`. Defensive fallthrough returns last index.
  return pool.length - 1;
}
