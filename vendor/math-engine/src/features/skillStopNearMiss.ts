/**
 * W152 Wave 175 — Skill-Stop Near-Miss Rate Analyzer (59. solver).
 *
 * **INDUSTRY-FIRST regulatory anti-near-miss inflation detector.**
 * Combines closed-form baseline expectation (uniform-random-stop reel)
 * sa operator-provided observed near-miss rate da emit-uje
 * `regulatoryFlag` kad observed > baseline × tolerance.
 *
 * ── Regulatory context ──────────────────────────────────────────────────────
 *
 * **UKGC RTS 12** — Remote Technical Standard, anti-near-miss provision:
 *   "Operators must not design any feature giving the impression of a near
 *    miss when no such weighting occurs in the underlying RNG." → ANY
 *    deliberate inflation is BANNED. `regulatoryFlag` flips on at ratio > 1.0
 *    (with small tolerance for sampling noise).
 *
 * **JP Pachislot 風営法 (Entertainment Establishment Act) §2(7)** — Japan
 *   regulates Pachislot near-miss frequency: deliberately-designed reels MAY
 *   inflate near-miss rate UP TO 1.5× uniform baseline (manufacturer
 *   certification). Above 1.5× = license violation.
 *
 * **AU NCPF (National Consumer Protection Framework) 2022 §3.4** — Australian
 *   psychophysics monitoring: operator must disclose if near-miss rate
 *   exceeds 1.2× baseline (NSW/VIC enforcement).
 *
 * **AGCO (Alcohol & Gaming Commission of Ontario) Slot Standards 2024 §5.7**
 *   — Ontario follows UKGC RTS 12 (NO deliberate inflation).
 *
 * **Academic citation**: Reid (1986) "The psychology of the near miss",
 * Journal of Gambling Behavior 2(1):32-39; Harrigan & Dixon (2009) "PAR
 * Sheets, probabilities, and slot machine play"; Templeton et al (2015)
 * "Near-misses extend gambling persistence on simulated slot machine games"
 * Journal of Gambling Studies 31(3):785-800.
 *
 * ── Math ─────────────────────────────────────────────────────────────────────
 *
 * Per reel: N symbols total, M jackpot/payline symbols. Reel stops UNIFORMLY
 * AT RANDOM (RNG-driven, no skill-stop manipulation).
 *
 *   P(win-stop per reel) = M / N
 *   P(near-miss-stop per reel) = (2K) · M / N  for near-miss band K (typical K=1)
 *
 * The "near-miss" event = jackpot symbol lands AT POSITION win_pos ± 1...K
 * but NOT AT win_pos itself. So under uniform reel:
 *
 *   nearMissRateBaseline = (2K · M) / N
 *
 * For deliberately near-miss-enhanced reels (PAR sheet weighted to over-
 * represent jackpot symbol in NEAR-MISS positions), the observed rate
 * `observedNearMissRate` can exceed baseline. Define:
 *
 *   **inflationRatio** = observedNearMissRate / baselineNearMissRate
 *
 * Regulatory bands (operator-configurable, defaults match UKGC RTS 12 strict):
 *   - **UKGC / AGCO / EU GA**: inflation > 1.0 (+ ε noise tol) → FLAG (BANNED)
 *   - **JP Pachislot 風営法**: inflation > 1.5 → FLAG (license violation)
 *   - **AU NCPF**: inflation > 1.2 → FLAG (disclosure required)
 *
 * Per N spins, **expected frustration events** = N · (observedNearMissRate −
 * winRate). Frustration ratio = nearMiss/win = inflationRatio · 2K
 * (skews player-perception toward "almost won" cognition).
 *
 * Multi-reel aggregation (5-reel jackpot pattern, requires ALL reels show
 * jackpot symbol = P(all win) = (M/N)^5):
 *   - **anyReelNearMissProb** = 1 − (1 − pNearMissPerReel)^numReels
 *   - **allButOneReelWinNearMissProb** (most psychologically salient):
 *     C(5,4)·(M/N)^4·(p_NM/N) — 4 reels show jackpot, 5th shows near-miss
 *
 * ── Distinct from ──────────────────────────────────────────────────────────────
 *   - W127 Anticipation/Tease Reel (slow-down ANIMATION, not RNG enhancement)
 *   - W163 Martingale Bust Time (chase-pattern bet progression, not psychophysics)
 *   - W167 AWP Cycle Convergence (above-IR finite-cycle, not per-spin near-miss)
 *   - W123 Mega Symbol Multi-Cell Expansion (winning expansion, not pre-stop tease)
 *   - W93 Multiplicative Wild Stack (winning aggregation, not miss aggregation)
 *
 * Naming: "near-miss", "skill-stop", "frustration event" = generic regulatory
 * terms (UKGC RTS 12 vocabulary). No vendor TM.
 */

/** ── Config ───────────────────────────────────────────────────────────────── */
export interface SkillStopNearMissConfig {
  /** Symbols per reel N ≥ 2. */
  symbolsPerReel: number;
  /** Jackpot/payline-trigger symbols per reel M ∈ [1, N − 1]. */
  jackpotSymbolsPerReel: number;
  /** Near-miss band K = ±K cells around win-pos (typically 1). */
  nearMissBand: number;
  /** Operator-provided observed near-miss rate per reel-stop, from PAR sheet or LIVE telemetry. */
  observedNearMissRatePerReel: number;
  /** Reel count for multi-reel aggregation (typical 5). */
  numReels: number;
  /**
   * Regulatory regime — selects inflation tolerance:
   *   - 'UKGC' (default): tol 1.0 + ε (RTS 12 NO deliberate near-miss)
   *   - 'JP_PACHISLOT': tol 1.5 (風営法)
   *   - 'AU_NCPF': tol 1.2 (NCPF §3.4)
   *   - 'AGCO': tol 1.0 + ε (Ontario follows UKGC)
   */
  regulatoryRegime?: 'UKGC' | 'JP_PACHISLOT' | 'AU_NCPF' | 'AGCO';
  /** Override tolerance ratio if custom regime needed. */
  customInflationTolerance?: number;
  /** Inflation sampling-noise tolerance (default 0.02 = 2% slack for finite-sample telemetry). */
  noiseTolerance?: number;
}

/** ── Result ───────────────────────────────────────────────────────────────── */
export interface SkillStopNearMissResult {
  /** Per-reel uniform-random baseline P(near-miss). */
  baselineNearMissRate: number;
  /** Per-reel uniform-random baseline P(win-stop) = M/N. */
  baselineWinRate: number;
  /** Operator-provided observed rate (passthrough). */
  observedNearMissRate: number;
  /** observed / baseline. */
  inflationRatio: number;
  /** Effective regulatory tolerance applied. */
  regulatoryToleranceApplied: number;
  /** Regime name used. */
  regimeUsed: string;
  /** TRUE if inflationRatio > tolerance + noiseTolerance (deliberate enhancement detected). */
  regulatoryFlag: boolean;
  /** Severity score ∈ [0, ∞) — by how much inflation exceeds tolerance. */
  severityScore: number;
  /** Per-spin frustration ratio = nearMiss/win = inflationRatio · 2K. */
  frustrationRatio: number;
  /** Multi-reel: P(at least one reel shows near-miss this spin). */
  anyReelNearMissProb: number;
  /** Multi-reel: P(4-of-5 jackpot symbols + 1 near-miss reel) — most salient frustration event. */
  allButOneWinNearMissProb: number;
  /** Per N spins, expected count of frustration events (near-miss but no win). */
  expectedFrustrationEventsPerSpin: number;
  /** Disclosure text (regulatory body language for help-screen / certification). */
  disclosureText: string;
}

const REGIME_TOLERANCES: Record<string, number> = {
  UKGC: 1.0,
  AGCO: 1.0,
  AU_NCPF: 1.2,
  JP_PACHISLOT: 1.5,
};

/** ── Validation ───────────────────────────────────────────────────────────── */
function validate(cfg: SkillStopNearMissConfig): void {
  if (
    !Number.isFinite(cfg.symbolsPerReel) ||
    cfg.symbolsPerReel < 2 ||
    !Number.isInteger(cfg.symbolsPerReel)
  ) {
    throw new Error(`symbolsPerReel must be integer ≥ 2, got ${cfg.symbolsPerReel}`);
  }
  if (
    !Number.isFinite(cfg.jackpotSymbolsPerReel) ||
    cfg.jackpotSymbolsPerReel < 1 ||
    cfg.jackpotSymbolsPerReel >= cfg.symbolsPerReel ||
    !Number.isInteger(cfg.jackpotSymbolsPerReel)
  ) {
    throw new Error(
      `jackpotSymbolsPerReel must be integer in [1, symbolsPerReel − 1], got ${cfg.jackpotSymbolsPerReel}`,
    );
  }
  if (
    !Number.isFinite(cfg.nearMissBand) ||
    cfg.nearMissBand < 1 ||
    !Number.isInteger(cfg.nearMissBand)
  ) {
    throw new Error(`nearMissBand must be integer ≥ 1, got ${cfg.nearMissBand}`);
  }
  if (
    !Number.isFinite(cfg.observedNearMissRatePerReel) ||
    cfg.observedNearMissRatePerReel < 0 ||
    cfg.observedNearMissRatePerReel > 1
  ) {
    throw new Error(
      `observedNearMissRatePerReel must be in [0, 1], got ${cfg.observedNearMissRatePerReel}`,
    );
  }
  if (
    !Number.isFinite(cfg.numReels) ||
    cfg.numReels < 1 ||
    !Number.isInteger(cfg.numReels)
  ) {
    throw new Error(`numReels must be integer ≥ 1, got ${cfg.numReels}`);
  }
  if (cfg.customInflationTolerance !== undefined) {
    if (!Number.isFinite(cfg.customInflationTolerance) || cfg.customInflationTolerance <= 0) {
      throw new Error(
        `customInflationTolerance must be > 0, got ${cfg.customInflationTolerance}`,
      );
    }
  }
  if (cfg.noiseTolerance !== undefined) {
    if (
      !Number.isFinite(cfg.noiseTolerance) ||
      cfg.noiseTolerance < 0 ||
      cfg.noiseTolerance > 0.5
    ) {
      throw new Error(`noiseTolerance must be in [0, 0.5], got ${cfg.noiseTolerance}`);
    }
  }
}

/** ── Main analyzer ───────────────────────────────────────────────────────── */
export function analyzeSkillStopNearMiss(
  cfg: SkillStopNearMissConfig,
): SkillStopNearMissResult {
  validate(cfg);

  const N = cfg.symbolsPerReel;
  const M = cfg.jackpotSymbolsPerReel;
  const K = cfg.nearMissBand;
  const R = cfg.numReels;
  const noiseTol = cfg.noiseTolerance ?? 0.02;
  const regime = cfg.regulatoryRegime ?? 'UKGC';
  const regulatoryTol =
    cfg.customInflationTolerance ?? REGIME_TOLERANCES[regime] ?? REGIME_TOLERANCES.UKGC;

  const baselineWin = M / N;
  // Baseline near-miss: 2K positions (K above + K below win-pos), each with M/N
  // probability of jackpot symbol. Clamp at 1 for tiny reels.
  const baselineNearMiss = Math.min(1, (2 * K * M) / N);

  const observed = cfg.observedNearMissRatePerReel;
  const inflation = baselineNearMiss > 0 ? observed / baselineNearMiss : 0;

  const flag = inflation > regulatoryTol + noiseTol;
  const severity = Math.max(0, inflation - regulatoryTol);

  // Frustration ratio = near-miss rate / win rate (cognitive "almost-won" amplification)
  const frustration = baselineWin > 0 ? observed / baselineWin : 0;

  // Multi-reel: P(≥ 1 reel near-miss) = 1 − (1 − p_NM)^R
  const anyReelNM = 1 - Math.pow(1 - observed, R);

  // 4-of-5 jackpot + 1 near-miss (binomial coefficient C(R, R-1) = R)
  // pWin per reel = baselineWin (assuming RNG-uniform for the wins; near-miss
  // inflation affects only the OFF-position weighting).
  // Salience-form formula for "near jackpot": (winRate)^(R-1) · observedNM · R
  const allButOneNM = R * Math.pow(baselineWin, R - 1) * observed;

  // Per-spin frustration count: max(observed − baselineWin, 0) × R lower-bound
  // (psychologically salient when player saw near-miss but no win)
  const frustrationEvents = Math.max(0, observed - baselineWin) * R;

  const disclosureText = buildDisclosure(regime, regulatoryTol, inflation, flag, R, N, M, K);

  return {
    baselineNearMissRate: baselineNearMiss,
    baselineWinRate: baselineWin,
    observedNearMissRate: observed,
    inflationRatio: inflation,
    regulatoryToleranceApplied: regulatoryTol,
    regimeUsed: regime,
    regulatoryFlag: flag,
    severityScore: severity,
    frustrationRatio: frustration,
    anyReelNearMissProb: anyReelNM,
    allButOneWinNearMissProb: allButOneNM,
    expectedFrustrationEventsPerSpin: frustrationEvents,
    disclosureText,
  };
}

function buildDisclosure(
  regime: string,
  tol: number,
  ratio: number,
  flag: boolean,
  R: number,
  N: number,
  M: number,
  K: number,
): string {
  const status = flag ? '⚠️ FLAG' : '✅ COMPLIANT';
  const regimeText: Record<string, string> = {
    UKGC: 'UKGC RTS 12 (NO deliberate near-miss enhancement)',
    AGCO: 'AGCO Slot Standards 2024 §5.7 (follows UKGC)',
    AU_NCPF: 'AU NCPF 2022 §3.4 (NSW/VIC psychophysics monitoring, 1.2× cap)',
    JP_PACHISLOT: 'JP Pachislot 風営法 §2(7) (1.5× near-miss cap)',
  };
  const regText = regimeText[regime] ?? regime;
  return (
    `${status} | Regime: ${regText} | ` +
    `Reel: ${R}×{N=${N}, M=${M}, K=${K}} | ` +
    `Inflation ratio: ${ratio.toFixed(3)} vs tolerance ${tol.toFixed(2)}. ` +
    (flag
      ? 'Operator must REMEDIATE PAR sheet (re-weight reel strip to remove off-position jackpot inflation) or face regulatory non-compliance.'
      : 'Reel design is within regulatory bounds. Audit trail: this analyzer is auditor-replayable per machine certification cycle.')
  );
}

/** Alias for portfolio runner naming convention (solve* family). */
export const solveSkillStopNearMiss = analyzeSkillStopNearMiss;

/** ── Monte Carlo cross-validation (per-reel sampling) ─────────────────────── */
export function simulateSkillStopNearMiss(
  cfg: SkillStopNearMissConfig,
  numSpins: number,
  seed = 0xbeef0175,
): {
  observedFrustrationEventsPerSpin: number;
  observedAnyReelNearMissProb: number;
  observedAllButOneWinNearMissProb: number;
  observedFrustrationRatio: number;
} {
  validate(cfg);
  if (!Number.isFinite(numSpins) || numSpins < 1 || !Number.isInteger(numSpins)) {
    throw new Error(`numSpins must be integer ≥ 1, got ${numSpins}`);
  }

  let s = seed >>> 0;
  const rng = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    z = (z ^ (z >>> 16)) >>> 0;
    return (z >>> 0) / 4294967296;
  };

  const N = cfg.symbolsPerReel;
  const M = cfg.jackpotSymbolsPerReel;
  const R = cfg.numReels;
  const pWin = M / N;
  const pNM = cfg.observedNearMissRatePerReel;

  let frustrationEvents = 0;
  let anyReelNMCount = 0;
  let allButOneNMCount = 0;
  let winCount = 0;
  let nmCount = 0;

  for (let spin = 0; spin < numSpins; spin++) {
    let winsThisSpin = 0;
    let nmThisSpin = 0;
    for (let r = 0; r < R; r++) {
      const u = rng();
      // Three-bucket draw: WIN (pWin) | NEAR_MISS (pNM) | OTHER (1−pWin−pNM)
      if (u < pWin) {
        winsThisSpin++;
        winCount++;
      } else if (u < pWin + pNM) {
        nmThisSpin++;
        nmCount++;
      }
    }
    if (nmThisSpin > 0) anyReelNMCount++;
    if (winsThisSpin === R - 1 && nmThisSpin >= 1) allButOneNMCount++;
    if (nmThisSpin > 0 && winsThisSpin < R) frustrationEvents += nmThisSpin;
  }

  return {
    observedFrustrationEventsPerSpin: frustrationEvents / numSpins,
    observedAnyReelNearMissProb: anyReelNMCount / numSpins,
    observedAllButOneWinNearMissProb: allButOneNMCount / numSpins,
    observedFrustrationRatio: winCount > 0 ? nmCount / winCount : 0,
  };
}
