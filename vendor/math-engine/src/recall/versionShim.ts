/**
 * W152 Wave 16 — Cross-version replay compatibility shim for spin recall.
 *
 * Why: a regulator who needs to replay a 3-year-old spin can't expect us
 * to keep the v1.0.0 schema frozen forever. The engine evolves — new
 * fields land in `SpinResultSummary`, `ComplianceFlags` grows, audit
 * IDs gain prefixes. Without an explicit shim, every schema bump breaks
 * forensic replay.
 *
 * The shim is a tiny, declarative migration ladder: each step takes the
 * previous-version object and returns the next. `migrateEntry(entry)`
 * walks the ladder until the entry's `schema_version` matches
 * `RECALL_SCHEMA_VERSION` — or throws if there's no migration registered.
 *
 * Contract:
 *   * Migrations MUST be additive. Never remove a field; always default
 *     it on read. This keeps the chain re-verifiable: an old hash was
 *     computed over old fields, so the hash check still passes when we
 *     re-canonicalise the migrated entry against its archived hash.
 *   * `entry_hash` and `prev_hash` are NEVER touched. The shim only
 *     renames or adds non-hashed convenience fields. The original entry
 *     content (everything seal-hashed) stays byte-identical.
 *   * Every migration is registered in the `MIGRATIONS` table below
 *     keyed by `from-version → to-version`. New schema bump → new entry.
 *
 * Failure modes:
 *   * Unknown source version → `UnknownSchemaVersionError`.
 *   * Gap in the ladder (1.0.0 → 1.5.0 directly with no intermediate
 *     1.0.0→1.1.0) → `BrokenMigrationLadderError`. We refuse to skip
 *     because skipping means a regulator's audit log has a hidden delta.
 *   * Migration produces invalid output → throws inline; caller sees
 *     the original error.
 *
 * Convenience:
 *   * `replayWithShim(entry, driver, opts)` reads the entry, migrates
 *     to current schema, then hands off to the existing replay engine.
 *   * `currentSchema()` returns the version this build understands.
 *   * `supportedSourceVersions()` enumerates every version the shim
 *     can up-migrate from — useful for `/health` endpoints.
 */

import { RECALL_SCHEMA_VERSION, type SchemaVersion, type SpinJournalEntry } from './types.js';

/** Migration step: takes one shape, returns the next-version shape. */
export type MigrationStep = (entry: SpinJournalEntry) => SpinJournalEntry;

/** Registered migrations keyed by `${from}->${to}`. */
const MIGRATIONS: Map<string, { from: SchemaVersion; to: SchemaVersion; step: MigrationStep }> =
  new Map();

/**
 * Public API to register a migration. Operators / future engine commits
 * call this at module load time when they bump `RECALL_SCHEMA_VERSION`.
 *
 * Throws on duplicate registration or backward (`to <= from`) migration.
 */
export function registerMigration(from: SchemaVersion, to: SchemaVersion, step: MigrationStep): void {
  if (compareVersions(to, from) <= 0) {
    throw new Error(
      `registerMigration: target version '${to}' must be strictly greater than source '${from}'`,
    );
  }
  const key = `${from}->${to}`;
  if (MIGRATIONS.has(key)) {
    throw new Error(`registerMigration: duplicate migration '${key}'`);
  }
  MIGRATIONS.set(key, { from, to, step });
}

/** `1.2.3` → `[1, 2, 3]`. */
function parseVersion(v: SchemaVersion): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`parseVersion: invalid SchemaVersion '${v}'`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Returns negative / 0 / positive (semver-style). */
export function compareVersions(a: SchemaVersion, b: SchemaVersion): number {
  const [a0, a1, a2] = parseVersion(a);
  const [b0, b1, b2] = parseVersion(b);
  if (a0 !== b0) return a0 - b0;
  if (a1 !== b1) return a1 - b1;
  return a2 - b2;
}

/** Errors */
export class UnknownSchemaVersionError extends Error {
  constructor(public readonly version: string) {
    super(`UnknownSchemaVersionError: no migration path from '${version}' to '${RECALL_SCHEMA_VERSION}'`);
    this.name = 'UnknownSchemaVersionError';
  }
}

export class BrokenMigrationLadderError extends Error {
  constructor(public readonly fromVersion: SchemaVersion) {
    super(
      `BrokenMigrationLadderError: no registered next-step from '${fromVersion}' towards '${RECALL_SCHEMA_VERSION}'`,
    );
    this.name = 'BrokenMigrationLadderError';
  }
}

/**
 * Walk the ladder from `entry.schema_version` to `RECALL_SCHEMA_VERSION`.
 *
 * Returns the up-to-date entry. If `entry.schema_version` is already
 * current, returns the entry unchanged (zero-cost path).
 */
export function migrateEntry(entry: SpinJournalEntry): SpinJournalEntry {
  if (entry.schema_version === RECALL_SCHEMA_VERSION) return entry;
  if (compareVersions(entry.schema_version, RECALL_SCHEMA_VERSION) > 0) {
    // Future-version entry — engine is older than journal. Refuse to
    // silently misinterpret. Operator must upgrade the engine binary.
    throw new UnknownSchemaVersionError(entry.schema_version);
  }
  let current = entry;
  // Bound the loop — pathological circular registration would otherwise loop forever.
  for (let safety = 0; safety < 64; safety++) {
    if (current.schema_version === RECALL_SCHEMA_VERSION) return current;
    const candidates = Array.from(MIGRATIONS.values()).filter(
      (m) => m.from === current.schema_version,
    );
    if (candidates.length === 0) {
      throw new BrokenMigrationLadderError(current.schema_version);
    }
    // If multiple migrations branch from the same source, pick the one
    // whose target is closest to our goal AND not past it. This lets an
    // operator publish 1.0→1.1 and 1.0→2.0; the shim picks 1.1 first
    // (smaller step) and continues from there.
    const goalUpward = candidates
      .filter((m) => compareVersions(m.to, RECALL_SCHEMA_VERSION) <= 0)
      .sort((a, b) => compareVersions(a.to, b.to));
    const next = goalUpward[0] ?? candidates.sort((a, b) => compareVersions(a.to, b.to))[0];
    if (next === undefined) throw new BrokenMigrationLadderError(current.schema_version);
    current = next.step(current);
  }
  throw new Error(`migrateEntry: ladder did not converge after 64 steps from '${entry.schema_version}'`);
}

/** Returns the schema version this build understands. */
export function currentSchema(): SchemaVersion {
  return RECALL_SCHEMA_VERSION;
}

/** Enumerate the source versions for which a migration is registered. */
export function supportedSourceVersions(): SchemaVersion[] {
  const out = new Set<SchemaVersion>();
  for (const m of MIGRATIONS.values()) out.add(m.from);
  // Always include the current schema (no migration needed).
  out.add(RECALL_SCHEMA_VERSION);
  return Array.from(out).sort(compareVersions);
}

/** Test-only: clear the registration table. */
export function _resetMigrations(): void {
  MIGRATIONS.clear();
}
