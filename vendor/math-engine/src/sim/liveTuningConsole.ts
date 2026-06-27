/**
 * W152 Wave 24 — Live Tuning Console (Faza 14.4 ❌→✅).
 *
 * Interactive console-class API za live designer feedback. Designer
 * pošalje target tuple {RTP, vol, hitFreq, maxWinFreq}; konzola
 * orchestrates iterative tuning loop:
 *
 *   1. Run baseline MC → measure {rtp, vol, hitFreq, maxWinFreq}.
 *   2. Compute deviation vector vs target.
 *   3. Suggest weight/paytable adjustments (gradient hint).
 *   4. User accepts or modifies → loop iter++.
 *   5. Track convergence trajectory.
 *
 * Engine-side stateless — caller drives the loop and persists state.
 * Suitable for both CLI ("slot-sim tune") and future REPL/UI front-ends.
 *
 * NOT a full UI — that's the operator integration point. This is the
 * tuning state machine + suggestion math.
 */

export interface DesignerTarget {
  rtp: number;
  volatility: number; // CV = σ_payout / mean_bet
  hitFreq: number; // P(spin yields > 0 win)
  maxWinFreq?: number; // P(spin yields ≥ maxWin × bet); optional
}

export interface MeasuredMetrics {
  rtp: number;
  volatility: number;
  hitFreq: number;
  maxWinFreq?: number;
}

export interface DeviationVector {
  rtpDelta: number;
  volatilityDelta: number;
  hitFreqDelta: number;
  maxWinFreqDelta?: number;
  /** L2 norm — single-number convergence proxy. */
  l2Norm: number;
}

export interface TuningSuggestion {
  /** Weight scale per symbol (1.0 = no change). */
  weightScale: Record<string, number>;
  /** Payout scale (1.0 = no change). */
  paytableScale: number;
  /** Human-readable rationale. */
  rationale: string;
}

export interface TuningStep {
  iteration: number;
  measured: MeasuredMetrics;
  deviation: DeviationVector;
  suggestion: TuningSuggestion;
  acceptedSuggestion?: TuningSuggestion;
}

/** Compute deviation vector from target. */
export function computeDeviation(
  target: DesignerTarget,
  measured: MeasuredMetrics,
): DeviationVector {
  const rtpDelta = measured.rtp - target.rtp;
  const volDelta = measured.volatility - target.volatility;
  const hitDelta = measured.hitFreq - target.hitFreq;
  const maxWinDelta =
    target.maxWinFreq !== undefined && measured.maxWinFreq !== undefined
      ? measured.maxWinFreq - target.maxWinFreq
      : undefined;
  // L2 norm — equal weighting; caller can post-scale per-metric if needed.
  let l2 = rtpDelta * rtpDelta + volDelta * volDelta + hitDelta * hitDelta;
  if (maxWinDelta !== undefined) l2 += maxWinDelta * maxWinDelta;
  return {
    rtpDelta,
    volatilityDelta: volDelta,
    hitFreqDelta: hitDelta,
    maxWinFreqDelta: maxWinDelta,
    l2Norm: Math.sqrt(l2),
  };
}

/**
 * Generate a tuning suggestion based on deviation. Heuristic:
 *   * RTP delta > 0 (over-paying) → suggest paytableScale = 1 - α × delta
 *   * RTP delta < 0 (under-paying) → suggest paytableScale = 1 + α × |delta|
 *   * Vol delta drives weight scale on HP symbols (per-symbol scaling).
 *   * Hit freq delta affects LP weight scaling.
 *
 * Pure function — caller iterates, accepts or modifies, drives loop.
 *
 * `learningRate` (default 0.5) controls aggressiveness; small values
 * give slow but stable convergence.
 */
export function suggestAdjustment(
  deviation: DeviationVector,
  symbolKinds: Record<string, 'lp' | 'hp' | 'wild' | 'scatter' | 'other'>,
  learningRate = 0.5,
): TuningSuggestion {
  const alpha = Math.max(0, Math.min(1, learningRate));
  const paytableScale = 1 - alpha * deviation.rtpDelta;
  const weightScale: Record<string, number> = {};
  for (const [sym, kind] of Object.entries(symbolKinds)) {
    if (kind === 'lp') {
      // LP weight up = more hits, lower vol
      weightScale[sym] = 1 + alpha * deviation.hitFreqDelta * -1;
    } else if (kind === 'hp') {
      // HP weight up = higher vol, lower hit-freq
      weightScale[sym] = 1 + alpha * deviation.volatilityDelta * -1;
    } else {
      weightScale[sym] = 1.0;
    }
  }
  const rationale =
    `RTP Δ ${deviation.rtpDelta.toFixed(4)} → paytable scale ${paytableScale.toFixed(4)}; ` +
    `vol Δ ${deviation.volatilityDelta.toFixed(4)}, hit Δ ${deviation.hitFreqDelta.toFixed(4)}.`;
  return { weightScale, paytableScale, rationale };
}

/**
 * Stateful tuning console — tracks step history. Operator can save
 * snapshot + resume.
 */
export class TuningConsole {
  private readonly target: DesignerTarget;
  private readonly history: TuningStep[] = [];

  constructor(target: DesignerTarget) {
    if (target.rtp < 0 || target.rtp > 1.5) {
      throw new RangeError(`TuningConsole: target.rtp out of [0, 1.5]`);
    }
    if (target.hitFreq < 0 || target.hitFreq > 1) {
      throw new RangeError(`TuningConsole: target.hitFreq out of [0, 1]`);
    }
    if (target.volatility < 0) {
      throw new RangeError(`TuningConsole: target.volatility must be >= 0`);
    }
    this.target = target;
  }

  /** Record one tuning iteration. Returns the structured step. */
  recordStep(
    measured: MeasuredMetrics,
    symbolKinds: Record<string, 'lp' | 'hp' | 'wild' | 'scatter' | 'other'>,
    learningRate = 0.5,
  ): TuningStep {
    const deviation = computeDeviation(this.target, measured);
    const suggestion = suggestAdjustment(deviation, symbolKinds, learningRate);
    const step: TuningStep = {
      iteration: this.history.length,
      measured,
      deviation,
      suggestion,
    };
    this.history.push(step);
    return step;
  }

  /** Mark the most-recent step's suggestion as accepted (= designer
   *  applied this scaling). Useful for tracking convergence rate. */
  acceptLastSuggestion(modified?: Partial<TuningSuggestion>): void {
    if (this.history.length === 0) {
      throw new Error('TuningConsole: no step to accept');
    }
    const last = this.history[this.history.length - 1];
    last.acceptedSuggestion = { ...last.suggestion, ...modified };
  }

  /** Snapshot of step history. */
  getHistory(): ReadonlyArray<TuningStep> {
    return this.history.slice();
  }

  /** Trajectory of L2 deviation norms — convergence visualization. */
  convergenceTrajectory(): number[] {
    return this.history.map((s) => s.deviation.l2Norm);
  }

  /** True if last L2 norm is below threshold (default 0.01 = ~1% combined). */
  isConverged(threshold = 0.01): boolean {
    if (this.history.length === 0) return false;
    return this.history[this.history.length - 1].deviation.l2Norm < threshold;
  }

  /** Serialise full state for cross-session persistence. */
  serialize(): { target: DesignerTarget; history: TuningStep[] } {
    return { target: this.target, history: this.history.slice() };
  }

  static deserialize(persisted: { target: DesignerTarget; history: TuningStep[] }): TuningConsole {
    const c = new TuningConsole(persisted.target);
    for (const step of persisted.history) c.history.push(step);
    return c;
  }
}
