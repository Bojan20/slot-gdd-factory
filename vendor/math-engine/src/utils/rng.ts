/**
 * SLOT MATH ENGINE TEMPLATE - Deterministic RNG
 *
 * Uses Mulberry32 algorithm for:
 * - TypeScript/Rust parity (IDENTICAL output)
 * - Deterministic reproducibility
 * - Fast performance (single u32 state)
 *
 * Every simulation result is reproducible with the same seed.
 * Results match Rust simulator exactly.
 */

/**
 * Core Mulberry32 PRNG function
 * This is the canonical implementation that Rust must match.
 *
 * Expected values for seed 12345:
 * - v1: 0.9797282677609473
 * - v2: 0.3067522644996643
 * - v3: 0.484205421525985
 */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function rand(): number {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded RNG instance using Mulberry32
 */
export class RNG {
  private rng: () => number;
  private initialSeed: number;

  constructor(seed: number) {
    this.initialSeed = seed;
    this.rng = mulberry32(seed);
  }

  /**
   * Get the initial seed used to create this RNG
   */
  getSeed(): number {
    return this.initialSeed;
  }

  /**
   * Generate random float in [0, 1)
   * Primary method for slot mechanics
   */
  nextFloat(): number {
    return this.rng();
  }

  /**
   * Generate random integer in [min, max] inclusive
   */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.rng() * (max - min + 1));
  }

  /**
   * Generate random integer in [0, max) exclusive
   */
  nextIntExclusive(max: number): number {
    return Math.floor(this.rng() * max);
  }

  /**
   * Pick random element from array
   */
  pick<T>(array: T[]): T {
    if (array.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    return array[Math.floor(this.rng() * array.length)];
  }

  /**
   * Weighted random selection
   * Returns index of selected weight
   */
  weightedSelect(weights: number[]): number {
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = this.rng() * total;

    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return i;
    }

    return weights.length - 1;
  }

  /**
   * Weighted random selection returning the value
   */
  weightedPick<T>(items: T[], weights: number[]): T {
    if (items.length !== weights.length) {
      throw new Error('Items and weights must have same length');
    }
    return items[this.weightedSelect(weights)];
  }

  /**
   * Shuffle array in-place (Fisher-Yates)
   */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Get shuffled copy of array
   */
  shuffled<T>(array: T[]): T[] {
    return this.shuffle([...array]);
  }

  /**
   * Boolean with probability p
   */
  chance(probability: number): boolean {
    return this.rng() < probability;
  }

  /**
   * Clone RNG (creates new RNG with same initial seed)
   * Note: This does NOT preserve current state, only initial seed
   */
  clone(): RNG {
    return new RNG(this.initialSeed);
  }

  /**
   * Skip ahead n values (for parallel simulation)
   */
  skip(n: number): void {
    for (let i = 0; i < n; i++) {
      this.rng();
    }
  }
}

/**
 * Create seeded RNG instance
 */
export function createRNG(seed: number): RNG {
  return new RNG(seed);
}

/**
 * Derive deterministic worker seed from base seed and worker index
 * Uses xxHash-style mixing for quality distribution
 */
export function deriveWorkerSeed(baseSeed: number, workerIndex: number): number {
  // Mix seed and index using prime multipliers
  let h = baseSeed >>> 0;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= workerIndex;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * Derive array of worker seeds
 */
export function deriveWorkerSeeds(baseSeed: number, workerCount: number): number[] {
  const seeds: number[] = [];
  for (let i = 0; i < workerCount; i++) {
    seeds.push(deriveWorkerSeed(baseSeed, i));
  }
  return seeds;
}

/**
 * Generate random seed from system entropy
 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

/**
 * Global RNG for quick operations (not recommended for simulation)
 */
let globalRng: RNG | null = null;

export function getGlobalRNG(): RNG {
  if (!globalRng) {
    globalRng = new RNG(randomSeed());
  }
  return globalRng;
}

export function setGlobalSeed(seed: number): void {
  globalRng = new RNG(seed);
}
