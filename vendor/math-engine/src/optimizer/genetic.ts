import type { SlotGameIR } from '../ir/types.js';
import { runIRSimulation } from '../engine/irSimulator.js';
import type { OptimizationResult, OptimizerIteration, OptimizationTarget } from './types.js';

// ─── types ────────────────────────────────────────────────────────────────

export interface GeneticOptimizerConfig {
  target: OptimizationTarget;
  populationSize?: number;    // default 8
  tournamentSize?: number;    // default 3
  mutationRate?: number;      // default 0.3
  mutationStrength?: number;  // default 0.3
  eliteCount?: number;        // default 2
  maxGenerations?: number;    // default 10
  evalSpins?: number;         // default 3000
  seed?: number;              // default 42
  minWeight?: number;         // default 1
  maxWeight?: number;         // default 1000
}

// ─── LCG RNG ──────────────────────────────────────────────────────────────

function makeLCG(seed: number): () => number {
  let rng = seed >>> 0;
  return (): number => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 0xFFFFFFFF;
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────

function deepCloneIR(ir: SlotGameIR): SlotGameIR {
  return JSON.parse(JSON.stringify(ir)) as SlotGameIR;
}

function getSymbolIds(ir: SlotGameIR): string[] {
  if (ir.reels.mode !== 'weighted') return [];
  const reels = ir.reels as Extract<typeof ir.reels, { mode: 'weighted' }>;
  const symSet = new Set<string>();
  for (const reelMap of reels.base) {
    for (const key of Object.keys(reelMap)) symSet.add(key);
  }
  return Array.from(symSet).sort();
}

type Genome = Record<string, number>;

function extractGenome(ir: SlotGameIR, symbolIds: string[]): Genome {
  const genome: Genome = {};
  if (ir.reels.mode !== 'weighted') return genome;
  const reels = ir.reels as Extract<typeof ir.reels, { mode: 'weighted' }>;
  for (const symId of symbolIds) {
    // Use average weight across reels
    let total = 0;
    let count = 0;
    for (const reelMap of reels.base) {
      if (symId in reelMap) {
        total += reelMap[symId] ?? 0;
        count++;
      }
    }
    genome[symId] = count > 0 ? total / count : 1;
  }
  return genome;
}

function applyGenome(
  ir: SlotGameIR,
  genome: Genome,
  minWeight: number,
  maxWeight: number,
): SlotGameIR {
  const clone = deepCloneIR(ir);
  if (clone.reels.mode !== 'weighted') return clone;
  const reels = clone.reels as Extract<typeof clone.reels, { mode: 'weighted' }>;
  for (const reelMap of reels.base) {
    for (const symId of Object.keys(reelMap)) {
      if (symId in genome) {
        const w = genome[symId] ?? 1;
        reelMap[symId] = Math.max(minWeight, Math.min(maxWeight, Math.round(w)));
      }
    }
  }
  return clone;
}

function computeLoss(
  rtp: number,
  hitRate: number,
  target: OptimizationTarget,
): number {
  const rtpWeight = target.rtpWeight ?? 1.0;
  const hitRateWeight = target.hitRateWeight ?? 1.0;
  const rtpErr = rtp - target.rtp;
  let loss = rtpWeight * rtpErr * rtpErr;
  if (target.hitRate != null) {
    const hrErr = hitRate - target.hitRate;
    loss += hitRateWeight * hrErr * hrErr;
  }
  return loss;
}

// ─── Selection ────────────────────────────────────────────────────────────

function tournamentSelect(
  population: { genome: Genome; fitness: number }[],
  tournamentSize: number,
  rng: () => number,
): Genome {
  let best = population[Math.floor(rng() * population.length)];
  if (!best) throw new Error('Empty population');
  for (let i = 1; i < tournamentSize; i++) {
    const candidate = population[Math.floor(rng() * population.length)];
    if (candidate && candidate.fitness < best.fitness) {
      best = candidate;
    }
  }
  return best.genome;
}

// ─── Crossover ────────────────────────────────────────────────────────────

function arithmeticCrossover(
  g1: Genome,
  g2: Genome,
  rng: () => number,
): Genome {
  // Blend factor α ∈ [0.3, 0.7]
  const alpha = 0.3 + rng() * 0.4;
  const child: Genome = {};
  for (const key of Object.keys(g1)) {
    const v1 = g1[key] ?? 1;
    const v2 = g2[key] ?? 1;
    child[key] = alpha * v1 + (1 - alpha) * v2;
  }
  return child;
}

// ─── Mutation ─────────────────────────────────────────────────────────────

function mutate(
  genome: Genome,
  mutationRate: number,
  mutationStrength: number,
  minWeight: number,
  maxWeight: number,
  rng: () => number,
): Genome {
  const mutated: Genome = {};
  for (const key of Object.keys(genome)) {
    const w = genome[key] ?? 1;
    if (rng() < mutationRate) {
      // Scale by (1 ± mutationStrength)
      const factor = 1 + (rng() * 2 - 1) * mutationStrength;
      mutated[key] = Math.max(minWeight, Math.min(maxWeight, Math.round(w * factor)));
    } else {
      mutated[key] = w;
    }
  }
  return mutated;
}

// ─── GeneticOptimizer ─────────────────────────────────────────────────────

export class GeneticOptimizer {
  private readonly config: Required<GeneticOptimizerConfig>;

  constructor(config: GeneticOptimizerConfig) {
    this.config = {
      target: config.target,
      populationSize: config.populationSize ?? 8,
      tournamentSize: config.tournamentSize ?? 3,
      mutationRate: config.mutationRate ?? 0.3,
      mutationStrength: config.mutationStrength ?? 0.3,
      eliteCount: config.eliteCount ?? 2,
      maxGenerations: config.maxGenerations ?? 10,
      evalSpins: config.evalSpins ?? 3000,
      seed: config.seed ?? 42,
      minWeight: config.minWeight ?? 1,
      maxWeight: config.maxWeight ?? 1000,
    };
  }

  async optimize(ir: SlotGameIR): Promise<OptimizationResult> {
    const {
      target,
      populationSize,
      tournamentSize,
      mutationRate,
      mutationStrength,
      eliteCount,
      maxGenerations,
      evalSpins,
      seed,
      minWeight,
      maxWeight,
    } = this.config;

    // Non-weighted: return gracefully
    if (ir.reels.mode !== 'weighted') {
      return {
        converged: false,
        iterations: 0,
        finalRtp: 0,
        finalHitRate: 0,
        finalLoss: 0,
        targetRtp: target.rtp,
        solvedIr: ir,
        history: [],
        rtpError: Math.abs(target.rtp),
        hitRateError: target.hitRate != null
          ? Math.abs(target.hitRate)
          : undefined,
      };
    }

    const rng = makeLCG(seed);
    const symbolIds = getSymbolIds(ir);
    const rtpTolerance = target.rtpTolerance ?? 0.01;

    // Initialize population from the original genome with random mutations
    const baseGenome = extractGenome(ir, symbolIds);

    // Evaluate a genome; returns {rtp, hitRate, loss}
    const evalGenome = async (genome: Genome): Promise<{ rtp: number; hitRate: number; loss: number }> => {
      const candidateIr = applyGenome(ir, genome, minWeight, maxWeight);
      const sim = await runIRSimulation(candidateIr, { spins: evalSpins, seed });
      const loss = computeLoss(sim.rtp, sim.hitRate, target);
      return { rtp: sim.rtp, hitRate: sim.hitRate, loss };
    };

    // Initialize population: first individual = base genome, rest = random mutations
    let population: { genome: Genome; rtp: number; hitRate: number; fitness: number }[] = [];

    for (let i = 0; i < populationSize; i++) {
      let genome: Genome;
      if (i === 0) {
        genome = { ...baseGenome };
      } else {
        genome = mutate(baseGenome, mutationRate, mutationStrength, minWeight, maxWeight, rng);
      }
      const evalResult = await evalGenome(genome);
      population.push({
        genome,
        rtp: evalResult.rtp,
        hitRate: evalResult.hitRate,
        fitness: evalResult.loss,
      });
    }

    // Sort by fitness (loss) ascending
    population.sort((a, b) => a.fitness - b.fitness);

    const history: OptimizerIteration[] = [];
    let converged = false;
    let generation = 0;

    // Record initial best as iteration 0
    const best0 = population[0]!;
    history.push({
      iteration: 0,
      rtp: best0.rtp,
      hitRate: best0.hitRate,
      loss: best0.fitness,
      weights: { ...best0.genome },
    });

    if (Math.abs(best0.rtp - target.rtp) < rtpTolerance) {
      converged = true;
    }

    // Evolve
    for (let gen = 1; gen <= maxGenerations && !converged; gen++) {
      generation = gen;
      const newPop: typeof population = [];

      // Elitism: carry over top-E individuals
      for (let e = 0; e < eliteCount && e < population.length; e++) {
        newPop.push(population[e]!);
      }

      // Fill rest with crossover + mutation offspring
      while (newPop.length < populationSize) {
        const parent1 = tournamentSelect(population, tournamentSize, rng);
        const parent2 = tournamentSelect(population, tournamentSize, rng);
        let child = arithmeticCrossover(parent1, parent2, rng);
        child = mutate(child, mutationRate, mutationStrength, minWeight, maxWeight, rng);
        const evalResult = await evalGenome(child);
        newPop.push({
          genome: child,
          rtp: evalResult.rtp,
          hitRate: evalResult.hitRate,
          fitness: evalResult.loss,
        });
      }

      newPop.sort((a, b) => a.fitness - b.fitness);
      population = newPop;

      const best = population[0]!;
      history.push({
        iteration: gen,
        rtp: best.rtp,
        hitRate: best.hitRate,
        loss: best.fitness,
        weights: { ...best.genome },
      });

      if (Math.abs(best.rtp - target.rtp) < rtpTolerance) {
        converged = true;
      }
    }

    const finalBest = population[0]!;
    const solvedIr = applyGenome(ir, finalBest.genome, minWeight, maxWeight);

    return {
      converged,
      iterations: generation,
      finalRtp: finalBest.rtp,
      finalHitRate: finalBest.hitRate,
      finalLoss: finalBest.fitness,
      targetRtp: target.rtp,
      solvedIr,
      history,
      rtpError: Math.abs(finalBest.rtp - target.rtp),
      hitRateError: target.hitRate != null
        ? Math.abs(finalBest.hitRate - target.hitRate)
        : undefined,
    };
  }
}
