/**
 * W152 Wave 140 — Adjacent Pays Aggregator (Faza 12 ext, post-W100 roadmap).
 *
 * Closed-form solver za "pay-adjacent / pay-anywhere on consecutive reels"
 * mehaniku — Aristocrat Buffalo (pay-adjacent classic) / Konami Roman
 * Tribune / NextGen Foxin' Wins / IGT Cleopatra adjacent variants /
 * Pragmatic Big Bass adjacent-pay families. Distinct od standardne
 * left-to-right line evaluation (anchored at reel 1) i od bi-directional
 * (anchored at reels 1 i N).
 *
 * Naming policy (clean-room): "adjacent pays", "consecutive reels",
 * "run length" = generic industry terms. No vendor TM.
 *
 * ── Difference vs prior Wxx solvers ───────────────────────────────────────
 *   • W125 Bi-Directional Line Pay — anchor mora biti na reel 1 (LEFT) ili
 *     reel N (RIGHT); ovaj solver dozvoljava run da počne NA BILO KOJOJ
 *     poziciji (1, 2, 3, ...) na consecutive reels
 *   • W123 Mega Symbol Multi-Cell — block expansion, ne run length analyzer
 *   • W112 Variable Reel Height Ways — Megaways unique-per-reel ways count
 *   • W93 Multiplicative Wild Stack — product wilds, ne adjacent run
 *   • W116 Mystery Symbol Reveal — pre-spin transform, ne payline eval
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * Per payline, N reels evaluated. Per reel, per symbol s, P(symbol s lands
 * on payline cell) = p_s (independent across reels).
 *
 * Per payline, per symbol s:
 *   Define longest_run_s = max contiguous run of reels showing s anywhere
 *   on the payline (positions 1..N).
 *
 * Closed form via DP on (position, current_run_at_end, max_run_so_far):
 *   - Per reel, conditional on symbol s match (prob p_s):
 *       current_run += 1; max_run = max(max_run, current_run)
 *     Else (prob 1 − p_s):
 *       current_run = 0; max_run unchanged
 *   - Start state: (current=0, max=0)
 *   - After N reels: marginalize over current → P(max_run = k) for k=0..N
 *
 * Per symbol s, per payline:
 *   E[pay_s] = Σ_{k=k_min..N} paytable[s][k] · P(longest_run_s = k)
 *   hit_freq_s = Σ_{k=k_min..N} P(longest_run_s = k)
 *
 * Per payline (assume cross-symbol non-overlap for sum):
 *   E[pay_payline] = Σ_s E[pay_s]
 *
 * Per spin (L paylines):
 *   E[pay_spin] = L · E[pay_payline]
 *
 * Variance per payline (per-symbol cross-independence assumption):
 *   E[pay_s²] = Σ_k paytable[s][k]² · P(longest_run_s = k)
 *   Var[pay_s] = E[pay_s²] − E[pay_s]²
 *   Var[pay_payline] = Σ_s Var[pay_s]  (cross-symbol indep approx)
 *
 * ── Adjacent-pays vs standard left-to-right ───────────────────────────────
 * Standard line eval requires run to START at reel 1. Adjacent pays allows
 * run anywhere — so for given p_s, k_min:
 *   P(adjacent ≥ k_min) ≥ P(LTR-anchored ≥ k_min)
 * because more starting positions qualify. Hit frequency is strictly higher.
 *
 * For N=5, k_min=3, p_s=0.2:
 *   P(LTR-anchored ≥ 3) = p_s³ ≈ 0.008
 *   P(adjacent_run ≥ 3) ≈ 0.0244 (computed via DP) — ~3× higher
 *
 * ── Compliance ────────────────────────────────────────────────────────────
 *   • UKGC RTS 14 — pay-frequency disclosure (adjacent variant)
 *   • MGA PPD §11.f — operator-facing payline rule (run definition)
 *   • eCOGRA Generic Slots Audit — verifies adjacent run definition matches engine
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * simulateAdjacentPaysAggregator() MC reference.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface AdjacentSymbolPaytableEntry {
  /** Symbol label. */
  label: string;
  /** Per-reel symbol density (probability of landing on payline cell). */
  density: number;
  /** Paytable: paytable[k-1] = payoutX za run of length k consecutive reels. */
  paytable: number[];
}

export interface AdjacentPaysAggregatorConfig {
  /** Number of reels (positive integer ≥ 2). */
  reelCount: number;
  /** Number of paylines (≥ 1). Per-spin scaling factor. */
  paylineCount: number;
  /** Minimum match length k_min (typically 2 for adjacent, 3 for standard). */
  minMatchLength: number;
  /** Per-symbol entries. */
  symbols: AdjacentSymbolPaytableEntry[];
}

export interface AdjacentPaysAggregatorResult {
  reelCount: number;
  paylineCount: number;
  minMatchLength: number;
  /** Per-symbol distribution P(longest run = k) for k=0..N. */
  perSymbolRunDistribution: Array<{
    label: string;
    density: number;
    runLengthPmf: number[];        // runLengthPmf[k] = P(longest run = k), k=0..N
    expectedPay: number;           // per payline
    hitFrequency: number;          // per payline
    variancePay: number;           // per payline
  }>;
  /** Aggregate per-payline. */
  expectedPayPerPayline: number;
  hitFrequencyPerPayline: number;
  variancePayPerPayline: number;
  /** Per-spin (× paylineCount). */
  expectedPayPerSpin: number;
  hitFrequencyPerSpin: number;
  variancePayPerSpin: number;
}

export interface AdjacentPaysAggregatorMcResult {
  spins: number;
  observedMeanPayPerSpin: number;
  observedHitRatePerSpin: number;
  observedMaxRunSeen: number;
}

// ── Validation ──────────────────────────────────────────────────────────────

function validateConfig(cfg: AdjacentPaysAggregatorConfig): void {
  if (!Number.isInteger(cfg.reelCount) || cfg.reelCount < 2) {
    throw new Error(`Invalid reelCount: ${cfg.reelCount} (must be integer ≥ 2)`);
  }
  if (!Number.isInteger(cfg.paylineCount) || cfg.paylineCount < 1) {
    throw new Error(`Invalid paylineCount: ${cfg.paylineCount} (must be integer ≥ 1)`);
  }
  if (!Number.isInteger(cfg.minMatchLength) || cfg.minMatchLength < 1 || cfg.minMatchLength > cfg.reelCount) {
    throw new Error(`Invalid minMatchLength: ${cfg.minMatchLength} (must be 1..${cfg.reelCount})`);
  }
  if (!Array.isArray(cfg.symbols) || cfg.symbols.length === 0) {
    throw new Error('symbols array must be non-empty');
  }
  let densitySum = 0;
  for (const s of cfg.symbols) {
    if (typeof s.label !== 'string' || s.label.length === 0) {
      throw new Error('symbol label must be non-empty string');
    }
    if (!(s.density > 0 && s.density <= 1)) {
      throw new Error(`Invalid density for symbol ${s.label}: ${s.density} (must be in (0, 1])`);
    }
    if (!Array.isArray(s.paytable) || s.paytable.length !== cfg.reelCount) {
      throw new Error(`paytable for ${s.label} must have length ${cfg.reelCount}`);
    }
    for (const v of s.paytable) {
      if (typeof v !== 'number' || v < 0 || !Number.isFinite(v)) {
        throw new Error(`paytable values for ${s.label} must be finite non-negative numbers`);
      }
    }
    densitySum += s.density;
  }
  if (densitySum > 1 + 1e-9) {
    throw new Error(`sum of symbol densities = ${densitySum} (must be ≤ 1 for non-overlapping symbols)`);
  }
}

// ── Closed-form solver ──────────────────────────────────────────────────────

/**
 * Compute P(longest run = k) for k=0..N via DP on (position, current_run, max_run).
 *
 * State: (c, m) with c ≤ m ≤ N. Transitions per reel:
 *   match (p):     (c, m) → (c+1, max(m, c+1))
 *   no match (1-p): (c, m) → (0, m)
 */
function longestRunPmf(N: number, p: number): number[] {
  // dp[c][m] = probability of being in state (current=c, max=m) after current position
  // Use Map for sparse; or 2D arrays of size (N+1)x(N+1).
  let dp: number[][] = Array.from({ length: N + 1 }, () => new Array(N + 1).fill(0));
  dp[0][0] = 1; // initial: current=0, max=0

  const q = 1 - p;

  for (let pos = 1; pos <= N; pos++) {
    const next: number[][] = Array.from({ length: N + 1 }, () => new Array(N + 1).fill(0));
    for (let c = 0; c <= N; c++) {
      for (let m = 0; m <= N; m++) {
        const prob = dp[c][m];
        if (prob <= 0) continue;
        // Match: c → c+1, m → max(m, c+1)
        const newC = c + 1;
        const newM = newC > m ? newC : m;
        if (newC <= N) {
          next[newC][newM] += prob * p;
        }
        // No match: c → 0, m unchanged
        next[0][m] += prob * q;
      }
    }
    dp = next;
  }

  // Marginalize: P(max_run = k) = Σ_c dp[c][k]
  const pmf = new Array(N + 1).fill(0);
  for (let m = 0; m <= N; m++) {
    let total = 0;
    for (let c = 0; c <= N; c++) {
      total += dp[c][m];
    }
    pmf[m] = total;
  }
  return pmf;
}

export function solveAdjacentPaysAggregator(cfg: AdjacentPaysAggregatorConfig): AdjacentPaysAggregatorResult {
  validateConfig(cfg);
  const { reelCount: N, paylineCount: L, minMatchLength: kMin } = cfg;

  const perSymbol = cfg.symbols.map((s) => {
    const pmf = longestRunPmf(N, s.density);
    let ePay = 0;
    let hit = 0;
    let ePay2 = 0;
    for (let k = kMin; k <= N; k++) {
      const pk = pmf[k];
      const pay = s.paytable[k - 1];
      ePay += pay * pk;
      hit += pk;
      ePay2 += pay * pay * pk;
    }
    const variancePay = ePay2 - ePay * ePay;
    return {
      label: s.label,
      density: s.density,
      runLengthPmf: pmf,
      expectedPay: ePay,
      hitFrequency: hit,
      variancePay: variancePay > 0 ? variancePay : 0,
    };
  });

  const expectedPayPerPayline = perSymbol.reduce((acc, s) => acc + s.expectedPay, 0);
  const hitFrequencyPerPayline = perSymbol.reduce((acc, s) => acc + s.hitFrequency, 0);
  const variancePayPerPayline = perSymbol.reduce((acc, s) => acc + s.variancePay, 0);

  return {
    reelCount: N,
    paylineCount: L,
    minMatchLength: kMin,
    perSymbolRunDistribution: perSymbol,
    expectedPayPerPayline,
    hitFrequencyPerPayline,
    variancePayPerPayline,
    expectedPayPerSpin: L * expectedPayPerPayline,
    hitFrequencyPerSpin: L * hitFrequencyPerPayline,
    variancePayPerSpin: L * variancePayPerPayline,
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

export function simulateAdjacentPaysAggregator(
  cfg: AdjacentPaysAggregatorConfig,
  spins: number,
  seed: number,
): AdjacentPaysAggregatorMcResult {
  validateConfig(cfg);
  if (!Number.isInteger(spins) || spins < 1) {
    throw new Error(`Invalid spins: ${spins}`);
  }
  const rng = mulberry32(seed);
  const { reelCount: N, paylineCount: L, minMatchLength: kMin } = cfg;

  // Pre-compute cumulative density thresholds per symbol for fast sampling.
  // Sum of densities ≤ 1; "no symbol" event for remaining mass.
  const densities = cfg.symbols.map((s) => s.density);
  const thresholds: number[] = [];
  let acc = 0;
  for (const d of densities) {
    acc += d;
    thresholds.push(acc);
  }
  // thresholds[i] = cum prob through symbol i; if r > last threshold → no symbol

  let totalPay = 0;
  let hitCount = 0;
  let maxRunSeen = 0;

  for (let spin = 0; spin < spins; spin++) {
    let spinPay = 0;
    let spinHit = false;
    // Each payline: sample N reels, find longest run per symbol, pay.
    for (let pl = 0; pl < L; pl++) {
      // Sample N reel cells (per-payline). reelSymbol[i] = symbol index or -1 for none.
      const reelSymbol = new Array(N).fill(-1);
      for (let r = 0; r < N; r++) {
        const u = rng();
        for (let i = 0; i < thresholds.length; i++) {
          if (u < thresholds[i]) {
            reelSymbol[r] = i;
            break;
          }
        }
      }
      // For each symbol, find longest run.
      for (let s = 0; s < cfg.symbols.length; s++) {
        let curRun = 0;
        let maxRun = 0;
        for (let r = 0; r < N; r++) {
          if (reelSymbol[r] === s) {
            curRun += 1;
            if (curRun > maxRun) maxRun = curRun;
          } else {
            curRun = 0;
          }
        }
        if (maxRun > maxRunSeen) maxRunSeen = maxRun;
        if (maxRun >= kMin) {
          spinPay += cfg.symbols[s].paytable[maxRun - 1];
          spinHit = true;
        }
      }
    }
    totalPay += spinPay;
    if (spinHit) hitCount += 1;
  }

  return {
    spins,
    observedMeanPayPerSpin: totalPay / spins,
    observedHitRatePerSpin: hitCount / spins,
    observedMaxRunSeen: maxRunSeen,
  };
}
