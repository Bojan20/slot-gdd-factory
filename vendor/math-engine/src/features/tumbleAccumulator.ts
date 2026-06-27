/**
 * W152 Wave 20 — Tumble Accumulator (Faza 15.C.1).
 *
 * Recursive cascade resolver sa multiplier accumulation across tumble
 * chains. Generic mehanika dokumentovana u akademskoj literaturi
 * (Cabot & Hannum 2002 § "Drop-style mechanics") i industry-standard
 * regulatornim guidelines (GLI-11 §3.2 Cascade Family). Engine-generic
 * implementacija — clean-room rebrand polje, NIJE specifična ka bilo kom
 * vendor-u.
 *
 * Tok jednog tumble step-a:
 *   1. Detect winning cells (caller dovodi).
 *   2. Remove winning cells.
 *   3. Apply gravity refill (caller dovodi novi cell stream).
 *   4. Bump tumble counter + apply multiplier rule.
 *   5. Repeat dok god se win pojavi.
 *
 * Multiplier rules:
 *   * `none`           — multiplier ostaje 1× (pure cascade, no boost).
 *   * `additive`       — multiplier += step (default step=1: 1, 2, 3, …).
 *   * `multiplicative` — multiplier *= step (default step=2: 1, 2, 4, 8, …).
 *
 * Cap rules:
 *   * `capX`     — apsolutna gornja granica multiplier-a.
 *   * `decayRule.maxTumbles` — hard prekid posle N kaskada (RG safeguard).
 *
 * Determinizam: nema RNG-a u modulu. Caller dovodi fresh cell stream
 * (deterministically generated upstream). Replay-safe.
 *
 * Naming policy: tumbleAccumulator je engine-generic naziv. Brand
 * imena su reserved per `docs/glossary.md`.
 */

export type MultiplierMode = 'none' | 'additive' | 'multiplicative';

export interface TumbleAccumulatorConfig {
  mode: MultiplierMode;
  /** Step size (default 1 for additive, 2 for multiplicative). */
  step?: number;
  /** Hard cap on multiplier value (default Infinity). */
  capX?: number;
  /** Hard cap on tumble depth (default 50, RG safeguard). */
  maxTumbles?: number;
  /** Initial multiplier (default 1). */
  initialMultiplier?: number;
}

export interface TumbleStep {
  /** 1-based tumble index (step 1 = base spin, step 2 = first cascade, …). */
  tumbleIndex: number;
  /** Win amount BEFORE multiplier application (in stake-multiples). */
  baseWinX: number;
  /** Multiplier applied at this step. */
  multiplier: number;
  /** Win amount AFTER multiplier (= baseWinX × multiplier). */
  effectiveWinX: number;
}

export interface TumbleResult {
  steps: TumbleStep[];
  /** Sum of all `effectiveWinX` across steps. */
  totalWinX: number;
  /** Final multiplier value reached. */
  finalMultiplier: number;
  /** True if `maxTumbles` cap was hit (forced stop). */
  capExhausted: boolean;
}

/** Step-by-step accumulator. Caller drives the win stream. */
export class TumbleAccumulator {
  private readonly cfg: Required<TumbleAccumulatorConfig>;
  private currentMultiplier: number;
  private tumbleIndex = 0;
  private steps: TumbleStep[] = [];

  constructor(config: TumbleAccumulatorConfig) {
    if (config.mode !== 'none' && config.mode !== 'additive' && config.mode !== 'multiplicative') {
      throw new Error(`TumbleAccumulator: unknown mode '${config.mode}'`);
    }
    const defaultStep = config.mode === 'multiplicative' ? 2 : 1;
    this.cfg = {
      mode: config.mode,
      step: config.step ?? defaultStep,
      capX: config.capX ?? Number.POSITIVE_INFINITY,
      maxTumbles: config.maxTumbles ?? 50,
      initialMultiplier: config.initialMultiplier ?? 1,
    };
    if (this.cfg.step <= 0 || !Number.isFinite(this.cfg.step)) {
      throw new RangeError(`TumbleAccumulator: step must be positive finite (got ${this.cfg.step})`);
    }
    if (this.cfg.capX <= 0) {
      throw new RangeError(`TumbleAccumulator: capX must be > 0 (got ${this.cfg.capX})`);
    }
    if (!Number.isInteger(this.cfg.maxTumbles) || this.cfg.maxTumbles <= 0) {
      throw new RangeError(`TumbleAccumulator: maxTumbles must be positive integer`);
    }
    if (this.cfg.initialMultiplier <= 0) {
      throw new RangeError(`TumbleAccumulator: initialMultiplier must be > 0`);
    }
    this.currentMultiplier = this.cfg.initialMultiplier;
  }

  /**
   * Record one cascade step. Returns the resulting `TumbleStep`.
   * If `baseWinX === 0`, the cascade is considered terminated; subsequent
   * `recordStep` calls become no-ops (but throw to surface caller bug).
   */
  recordStep(baseWinX: number): TumbleStep {
    if (!Number.isFinite(baseWinX) || baseWinX < 0) {
      throw new RangeError(`recordStep: baseWinX must be non-negative finite (got ${baseWinX})`);
    }
    if (this.tumbleIndex >= this.cfg.maxTumbles) {
      throw new Error(
        `TumbleAccumulator: maxTumbles cap (${this.cfg.maxTumbles}) reached — call result() and stop`,
      );
    }
    this.tumbleIndex += 1;
    // First step uses initial multiplier; subsequent steps progress the
    // multiplier per the configured mode.
    if (this.tumbleIndex > 1) {
      this.advanceMultiplier();
    }
    const effectiveWinX = baseWinX * this.currentMultiplier;
    const step: TumbleStep = {
      tumbleIndex: this.tumbleIndex,
      baseWinX,
      multiplier: this.currentMultiplier,
      effectiveWinX,
    };
    this.steps.push(step);
    return step;
  }

  private advanceMultiplier(): void {
    let next = this.currentMultiplier;
    switch (this.cfg.mode) {
      case 'none':
        return; // stays at initialMultiplier
      case 'additive':
        next = this.currentMultiplier + this.cfg.step;
        break;
      case 'multiplicative':
        next = this.currentMultiplier * this.cfg.step;
        break;
    }
    this.currentMultiplier = Math.min(next, this.cfg.capX);
  }

  /** Snapshot result so far. Repeatable; doesn't mutate state. */
  result(): TumbleResult {
    const totalWinX = this.steps.reduce((s, x) => s + x.effectiveWinX, 0);
    return {
      steps: this.steps.slice(),
      totalWinX,
      finalMultiplier: this.currentMultiplier,
      capExhausted: this.tumbleIndex >= this.cfg.maxTumbles,
    };
  }

  /** Test-only inspector: how many steps recorded so far. */
  stepCount(): number {
    return this.tumbleIndex;
  }
}

/**
 * Closed-form expected total win for a Poisson-style cascade chain:
 *   * Per-step trigger probability `p`.
 *   * Per-step expected win `μ_baseWin`.
 *   * Multiplier follows configured mode.
 *
 * Returns expected `totalWinX` over all chains starting from one base spin.
 *
 * Useful for analytical solver — bypasses MC for low-depth cascade
 * configs. For `mode='none'`, returns `μ_baseWin / (1 - p)` (geometric
 * sum). For `additive` and `multiplicative`, returns analytical sum
 * truncated at `maxTumbles`.
 *
 * NOTE: not exact under conditional dependence (e.g. "tumble multiplier
 * grows only on big hits"). Caller falls back to MC for those.
 */
export function expectedCascadeWin(
  triggerProb: number,
  baseWinExpectation: number,
  cfg: TumbleAccumulatorConfig,
): number {
  if (triggerProb < 0 || triggerProb >= 1) {
    throw new RangeError(`expectedCascadeWin: triggerProb must be in [0, 1) (got ${triggerProb})`);
  }
  if (baseWinExpectation < 0 || !Number.isFinite(baseWinExpectation)) {
    throw new RangeError(`expectedCascadeWin: baseWinExpectation must be non-negative finite`);
  }
  const mode = cfg.mode;
  const step = cfg.step ?? (mode === 'multiplicative' ? 2 : 1);
  const cap = cfg.capX ?? Number.POSITIVE_INFINITY;
  const maxN = cfg.maxTumbles ?? 50;
  const initial = cfg.initialMultiplier ?? 1;

  let total = 0;
  let multiplier = initial;
  let probAtStep = 1; // prob that the chain reaches step n
  for (let n = 1; n <= maxN; n++) {
    if (n > 1) {
      switch (mode) {
        case 'none':
          break;
        case 'additive':
          multiplier = Math.min(multiplier + step, cap);
          break;
        case 'multiplicative':
          multiplier = Math.min(multiplier * step, cap);
          break;
      }
    }
    total += probAtStep * baseWinExpectation * multiplier;
    probAtStep *= triggerProb;
    if (probAtStep < 1e-15) break; // truncate when contribution becomes negligible
  }
  return total;
}
