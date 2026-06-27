import type { SlotGameIR } from '../ir/types.js';
import { runIRSimulation } from '../engine/irSimulator.js';
import type {
  SensitivityReport,
  SensitivityDelta,
  InverseSolverConfig,
  InverseSolverResult,
  AutoTunerConfig,
  AutoTunerResult,
} from './types.js';

// ─── applyWeightMultiplier ─────────────────────────────────────────────────

/**
 * Pure function: returns a deep-cloned IR with `symbolId` weights multiplied
 * by `multiplier` on the specified reels. Weights are clamped to integer >= 1.
 */
export function applyWeightMultiplier(
  ir: SlotGameIR,
  symbolId: string,
  reelIndices: number[],
  multiplier: number,
): SlotGameIR {
  const clone = JSON.parse(JSON.stringify(ir)) as SlotGameIR;

  if (clone.reels.mode !== 'weighted') return clone;

  const reels = clone.reels as Extract<typeof clone.reels, { mode: 'weighted' }>;
  const reelSet = new Set(reelIndices);

  // W244 wave 8 — `for...of entries()` umesto `for (let i = 0; i < len; i++)`
  // eliminiše Stryker EqualityOperator `<` → `<=` mutant na loop kondiciji
  // (mutant je bio death-equivalent jer `reels.base[len]` je `undefined`
  // što je `if (!reelMap) continue` neutralizovao). Sparse-array guard
  // (`if (!reelMap) continue`) ostaje — testovi pin-uju da se rupa u
  // `reels.base[i]` ne baci. `for...of entries()` yield-uje `[i, undefined]`
  // za sparse holes, ne preskače ih.
  for (const [i, reelMap] of reels.base.entries()) {
    if (!reelSet.has(i)) continue;
    if (!reelMap) continue;
    if (!(symbolId in reelMap)) continue;
    const current = reelMap[symbolId] ?? 1;
    reelMap[symbolId] = Math.max(1, Math.round(current * multiplier));
  }

  return clone;
}

// W244 wave 8 — extracted bisection-boundary guards so Stryker mutates a
// named, isolated method instead of inline `error < tolerance` short-circuits.
// Each helper has a dedicated killer test that pins the strict-inequality
// semantics via a deterministic spy on `runIRSimulation` returning the EXACT
// boundary value.
//
// EqualityOperator `<` → `<=` mutants on these helpers are now killable:
//   `_hasConverged(tol, tol)` → original false (mutant true)
//   `_needsHigherWeights(target, target)` → original false (mutant true)
// Exported so direct unit tests can pin the strict-inequality semantics
// independently of the bisection loop's end-to-end behavior. The W244 wave 8
// killer suite (tests/w244_stryker_99_killers.test.ts) imports both.
export function _hasConverged(error: number, tolerance: number): boolean {
  return error < tolerance;
}

export function _needsHigherWeights(achievedRtp: number, targetRtp: number): boolean {
  return achievedRtp < targetRtp;
}

// ─── analyzeSensitivity ───────────────────────────────────────────────────

export interface AnalyzeSensitivityOpts {
  evalSpins?: number;
  delta?: number;
}

/**
 * For each unique symbol ID across all reels, apply a +delta weight
 * multiplier (all reels) and measure the change in RTP and hit rate.
 */
export async function analyzeSensitivity(
  ir: SlotGameIR,
  opts?: AnalyzeSensitivityOpts,
): Promise<SensitivityReport> {
  // Non-weighted: return empty deltas gracefully
  if (ir.reels.mode !== 'weighted') {
    return {
      baseRtp: 0,
      baseHitRate: 0,
      deltas: [],
      topInfluencers: [],
    };
  }

  const evalSpins = opts?.evalSpins ?? 10000;
  const delta = opts?.delta ?? 0.1;
  const multiplier = 1 + delta;

  // Run base simulation
  const baseResult = await runIRSimulation(ir, { spins: evalSpins, seed: 42 });
  const baseRtp = baseResult.rtp;
  const baseHitRate = baseResult.hitRate;

  // Collect unique symbol IDs across all reels
  const reels = ir.reels as Extract<typeof ir.reels, { mode: 'weighted' }>;
  const allReelIndices = reels.base.map((_, i) => i);
  const symbolIds = new Set<string>();
  for (const reelMap of reels.base) {
    for (const key of Object.keys(reelMap)) {
      symbolIds.add(key);
    }
  }

  const deltas: SensitivityDelta[] = [];

  for (const symbolId of symbolIds) {
    const perturbedIr = applyWeightMultiplier(ir, symbolId, allReelIndices, multiplier);
    const perturbedResult = await runIRSimulation(perturbedIr, { spins: evalSpins, seed: 42 });

    const rtpDelta = perturbedResult.rtp - baseRtp;
    const hitRateDelta = perturbedResult.hitRate - baseHitRate;
    const sensitivity = delta !== 0 ? rtpDelta / delta : 0;

    deltas.push({
      reelIndex: -1,
      symbolId,
      delta,
      rtpDelta,
      hitRateDelta,
      sensitivity,
    });
  }

  // Sort by |sensitivity| descending, take top 5
  const topInfluencers = deltas
    .slice()
    .sort((a, b) => Math.abs(b.sensitivity) - Math.abs(a.sensitivity))
    .slice(0, 5);

  return {
    baseRtp,
    baseHitRate,
    deltas,
    topInfluencers,
  };
}

// ─── solveTargetRtp ────────────────────────────────────────────────────────

/**
 * Bisection search on weight multiplier ∈ [0.1, 10.0] to find the
 * multiplier that achieves `config.targetRtp` for `config.varySymbol`.
 */
export async function solveTargetRtp(
  ir: SlotGameIR,
  config: InverseSolverConfig,
): Promise<InverseSolverResult> {
  const tolerance = config.tolerance ?? 0.001;
  const maxIterations = config.maxIterations ?? 50;
  const evalSpins = config.evalSpins ?? 10000;
  const varyReels = config.varyReels;

  // Non-weighted: return gracefully
  if (ir.reels.mode !== 'weighted') {
    return {
      converged: false,
      iterations: 0,
      achievedRtp: 0,
      targetRtp: config.targetRtp,
      error: Math.abs(config.targetRtp),
      solvedIr: ir,
      weightChange: 1,
    };
  }

  const allReelIndices = (ir.reels as Extract<typeof ir.reels, { mode: 'weighted' }>)
    .base.map((_, i) => i);
  const reelIndices = varyReels ?? allReelIndices;

  let lo = 0.1;
  let hi = 10.0;
  let iterations = 0;
  let achievedRtp = 0;
  let solvedIr = ir;
  let weightChange = 1;
  let converged = false;

  for (let i = 0; i < maxIterations; i++) {
    iterations++;
    const mid = (lo + hi) / 2;
    const perturbedIr = applyWeightMultiplier(ir, config.varySymbol, reelIndices, mid);
    const result = await runIRSimulation(perturbedIr, { spins: evalSpins, seed: 42 });
    achievedRtp = result.rtp;
    solvedIr = perturbedIr;
    weightChange = mid;

    const error = Math.abs(achievedRtp - config.targetRtp);
    if (_hasConverged(error, tolerance)) {
      converged = true;
      break;
    }

    // If achievedRtp < targetRtp → need higher weights → lo = mid
    if (_needsHigherWeights(achievedRtp, config.targetRtp)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return {
    converged,
    iterations,
    achievedRtp,
    targetRtp: config.targetRtp,
    error: Math.abs(achievedRtp - config.targetRtp),
    solvedIr,
    weightChange,
  };
}

// ─── autoTune ─────────────────────────────────────────────────────────────

/**
 * Finds the wild symbol (behavior.kind='wild') or falls back to the first
 * symbol, then calls solveTargetRtp to achieve the desired RTP.
 */
export async function autoTune(
  ir: SlotGameIR,
  config: AutoTunerConfig,
): Promise<AutoTunerResult> {
  // Non-weighted: return gracefully
  if (ir.reels.mode !== 'weighted') {
    return {
      converged: false,
      achievedRtp: 0,
      iterations: 0,
      solvedIr: ir,
    };
  }

  const rtpTolerance = config.rtpTolerance ?? 0.005;
  const maxIterations = config.maxIterations ?? 20;
  const evalSpins = config.evalSpins ?? 10000;

  // Find wild symbol or fall back to first symbol
  const wildSymbol = ir.symbols.find((s) => s.kind === 'wild');
  const varySymbol = wildSymbol?.id ?? ir.symbols[0]?.id ?? '';

  if (!varySymbol) {
    return {
      converged: false,
      achievedRtp: 0,
      iterations: 0,
      solvedIr: ir,
    };
  }

  const solverResult = await solveTargetRtp(ir, {
    targetRtp: config.targetRtp,
    varySymbol,
    tolerance: rtpTolerance,
    maxIterations,
    evalSpins,
  });

  // Evaluate final RTP including hit rate on the solved IR
  const finalResult = await runIRSimulation(solverResult.solvedIr, {
    spins: evalSpins,
    seed: 42,
  });

  return {
    converged: solverResult.converged,
    achievedRtp: solverResult.achievedRtp,
    achievedHitRate: config.targetHitRate != null ? finalResult.hitRate : undefined,
    iterations: solverResult.iterations,
    solvedIr: solverResult.solvedIr,
  };
}
