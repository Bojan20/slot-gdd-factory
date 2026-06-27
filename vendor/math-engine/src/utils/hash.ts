/**
 * Hash utilities for deterministic seed derivation and config checksums
 */

import { createHash } from 'crypto';

/**
 * FNV-1a 64-bit hash for fast deterministic seed derivation
 * Returns a 32-bit number suitable for RNG seeding
 */
export function hash64(baseSeed: number, workerIndex: number): number {
  // FNV-1a parameters
  const FNV_PRIME = 0x01000193;
  const FNV_OFFSET = 0x811c9dc5;

  let hash = FNV_OFFSET;

  // Hash the base seed bytes
  for (let i = 0; i < 4; i++) {
    hash ^= (baseSeed >> (i * 8)) & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }

  // Hash the worker index bytes
  for (let i = 0; i < 4; i++) {
    hash ^= (workerIndex >> (i * 8)) & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }

  return hash >>> 0;
}

/**
 * Derive deterministic worker seeds from base seed
 * Ensures each worker gets a unique but reproducible seed
 */
export function deriveWorkerSeeds(baseSeed: number, workerCount: number): number[] {
  const seeds: number[] = [];
  for (let i = 0; i < workerCount; i++) {
    seeds.push(hash64(baseSeed, i));
  }
  return seeds;
}

/**
 * Calculate SHA-256 checksum of an object (for config verification)
 */
export function checksumObject(obj: unknown): string {
  const json = JSON.stringify(obj, null, 0);
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

/**
 * Calculate SHA-256 checksum of a string
 */
export function checksumString(str: string): string {
  return createHash('sha256').update(str).digest('hex').slice(0, 16);
}

/**
 * Get git commit hash (if available)
 */
export function getGitCommit(): string | null {
  try {
    const { execSync } = require('child_process');
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    return commit;
  } catch {
    return null;
  }
}

/**
 * Murmur3 32-bit hash for additional mixing
 */
export function murmur3(key: number, seed: number = 0): number {
  let h = seed;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;

  let k = key >>> 0;
  k = Math.imul(k, c1) >>> 0;
  k = ((k << 15) | (k >>> 17)) >>> 0;
  k = Math.imul(k, c2) >>> 0;

  h ^= k;
  h = ((h << 13) | (h >>> 19)) >>> 0;
  h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;

  // Finalization
  h ^= 4;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;

  return h >>> 0;
}
