/**
 * SLOT MATH ENGINE TEMPLATE - Config Hashing & Fingerprinting
 *
 * Uses xxhash-wasm for fast, deterministic config hashing.
 * Critical for:
 * - Simulation reproducibility
 * - Certification audits
 * - Config versioning
 * - Cache invalidation
 *
 * xxHash is 10x faster than SHA-256 and perfect for non-crypto hashing.
 */

import xxhash from 'xxhash-wasm';

// Cache the xxhash instance
let xxhashInstance: Awaited<ReturnType<typeof xxhash>> | null = null;

/**
 * Initialize xxhash (call once at startup)
 */
export async function initXXHash(): Promise<void> {
  if (!xxhashInstance) {
    xxhashInstance = await xxhash();
  }
}

/**
 * Get xxhash instance (initializes if needed)
 */
async function getXXHash(): Promise<Awaited<ReturnType<typeof xxhash>>> {
  if (!xxhashInstance) {
    await initXXHash();
  }
  return xxhashInstance!;
}

/**
 * JSON replacer that sorts object keys for deterministic output
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce((sorted, key) => {
        sorted[key] = (value as Record<string, unknown>)[key];
        return sorted;
      }, {} as Record<string, unknown>);
  }
  return value;
}

/**
 * Hash a string using xxHash64
 */
export async function hashString(input: string): Promise<string> {
  const h = await getXXHash();
  return h.h64(input).toString(16);
}

/**
 * Hash an object (JSON serialized) using xxHash64
 * Keys are sorted for deterministic output
 */
export async function hashObject(obj: unknown): Promise<string> {
  const json = JSON.stringify(obj, sortedReplacer);
  return hashString(json);
}

/**
 * Config fingerprint structure
 */
export interface ConfigFingerprint {
  version: number;
  hash: string;
  algorithm: string;
  timestamp: number;
  isoDate: string;
}

/**
 * Generate a config fingerprint
 */
export async function generateConfigFingerprint(config: unknown): Promise<ConfigFingerprint> {
  const hash = await hashObject(config);
  const timestamp = Date.now();

  return {
    version: 1,
    hash,
    algorithm: 'xxhash64',
    timestamp,
    isoDate: new Date(timestamp).toISOString()
  };
}

/**
 * Compare two fingerprints
 */
export function compareFingerprints(a: ConfigFingerprint, b: ConfigFingerprint): boolean {
  return a.hash === b.hash;
}

/**
 * Simulation manifest for audit trail
 */
export interface SimulationManifest {
  manifestVersion: string;
  createdAt: string;
  config: {
    fingerprint: ConfigFingerprint;
    raw: unknown;
  };
  simulation: {
    fingerprint: ConfigFingerprint;
    params: {
      spins: number;
      seed?: number;
      seeds?: number;
      engineVersion: string;
    };
  };
  combinedHash: string;
  reproducibility: {
    note: string;
    engineVersion: string;
  };
}

/**
 * Create a simulation manifest
 * Full audit trail for certification
 */
export async function createSimulationManifest(
  config: unknown,
  simulationParams: {
    spins: number;
    seed?: number;
    seeds?: number;
    engineVersion: string;
  }
): Promise<SimulationManifest> {
  const configFingerprint = await generateConfigFingerprint(config);
  const paramsFingerprint = await generateConfigFingerprint(simulationParams);

  // Combined fingerprint
  const combinedHash = await hashString(configFingerprint.hash + paramsFingerprint.hash);

  return {
    manifestVersion: '1.0.0',
    createdAt: new Date().toISOString(),
    config: {
      fingerprint: configFingerprint,
      raw: config
    },
    simulation: {
      fingerprint: paramsFingerprint,
      params: simulationParams
    },
    combinedHash,
    reproducibility: {
      note: 'Same config + params + seed = identical results',
      engineVersion: simulationParams.engineVersion
    }
  };
}

/**
 * Verify manifest integrity
 */
export async function verifyManifest(manifest: SimulationManifest): Promise<{
  valid: boolean;
  configMatch: boolean;
  paramsMatch: boolean;
  combinedMatch: boolean;
}> {
  const configHash = await hashObject(manifest.config.raw);
  const paramsHash = await hashObject(manifest.simulation.params);
  const combinedHash = await hashString(configHash + paramsHash);

  return {
    valid: configHash === manifest.config.fingerprint.hash &&
           paramsHash === manifest.simulation.fingerprint.hash &&
           combinedHash === manifest.combinedHash,
    configMatch: configHash === manifest.config.fingerprint.hash,
    paramsMatch: paramsHash === manifest.simulation.fingerprint.hash,
    combinedMatch: combinedHash === manifest.combinedHash
  };
}

/**
 * Quick hash for caching (sync version using FNV-1a)
 * Use for high-frequency operations where async is too slow
 */
export function quickHash(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash;
}

/**
 * Format hash for display (shortened)
 */
export function formatHash(hash: string, length: number = 8): string {
  return hash.substring(0, length);
}

/**
 * Create deterministic simulation ID from config and seed
 */
export async function createSimulationId(
  config: unknown,
  seed: number
): Promise<string> {
  const configHash = await hashObject(config);
  const seedHash = await hashString(seed.toString());
  const timestamp = Date.now().toString(36);

  return `SIM-${formatHash(configHash, 6)}-${formatHash(seedHash, 4)}-${timestamp}`;
}
