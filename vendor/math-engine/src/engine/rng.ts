/**
 * SLOT MATH ENGINE TEMPLATE - RNG Engine
 *
 * Mulberry32 PRNG for reproducible simulations.
 * MUST match Rust implementation exactly for TS/Rust parity.
 *
 * Properties:
 * - Period: ~2^32
 * - Fast (single 32-bit state)
 * - Deterministic: same seed = same sequence
 * - Identical output in TypeScript and Rust
 */

/**
 * Create a Mulberry32 PRNG function
 *
 * This is the canonical implementation that Rust must match.
 *
 * @param seed - Initial seed value (will be cast to u32)
 * @returns Function that returns random float in [0, 1)
 *
 * @example
 * const rng = mulberry32(12345);
 * console.log(rng()); // 0.9797282677609473
 * console.log(rng()); // 0.3067522644996643
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
 * Pick random integer in [min, max)
 */
export function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min)) + min;
}

/**
 * Pick from weighted items
 */
export function pickWeighted<T>(
  rng: () => number,
  items: Array<{ value: T; weight: number }>
): T {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = rng() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it.value;
  }
  return items[items.length - 1].value;
}

/**
 * Pick index from weight array
 */
export function pickWeightedIndex(rng: () => number, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;

  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      return i;
    }
  }

  return weights.length - 1;
}

/**
 * RNG Class wrapper for object-oriented usage
 * Wraps mulberry32 function for compatibility with existing code
 */
export class RNG {
  private rng: () => number;
  private seed: number;

  constructor(seed?: number) {
    this.seed = seed !== undefined ? seed : Math.floor(Math.random() * 0xFFFFFFFF);
    this.rng = mulberry32(this.seed);
  }

  /**
   * Get random float in [0, 1)
   */
  random(): number {
    return this.rng();
  }

  /**
   * Get random integer in [0, max)
   */
  nextInt(max: number): number {
    return Math.floor(this.random() * max);
  }

  /**
   * Get random integer in [min, max]
   */
  nextIntRange(min: number, max: number): number {
    return min + Math.floor(this.random() * (max - min + 1));
  }

  /**
   * Select from weighted options
   * @param weights Array of weights
   * @returns Index of selected option
   */
  weightedSelect(weights: number[]): number {
    return pickWeightedIndex(this.rng, weights);
  }

  /**
   * Shuffle array in place (Fisher-Yates)
   */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Get seed for debugging
   */
  getSeed(): number {
    return this.seed;
  }

  /**
   * Create new RNG with same seed (for replay)
   */
  clone(): RNG {
    return new RNG(this.seed);
  }
}

/**
 * Global RNG instance for simulation
 */
let globalRng = new RNG();

export function getGlobalRng(): RNG {
  return globalRng;
}

export function seedGlobalRng(seed: number): void {
  globalRng = new RNG(seed);
}

export function createRng(seed?: number): RNG {
  return new RNG(seed);
}
