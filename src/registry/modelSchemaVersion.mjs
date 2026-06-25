/**
 * src/registry/modelSchemaVersion.mjs
 *
 * N+2 atom I (Boki 2026-06-25) — Single source of truth for the
 * top-level model.json schema semver.
 *
 * # WHY THIS EXISTS
 *
 * Per-block `schemaVersion` markers (spinControl, symbolModifiers,
 * inSyncReels, copyWildOrchestrator) already track per-block contract
 * drift. What was missing: a TOP-LEVEL stamp on the parser output so
 * a downstream consumer (cached `tools/_wave-v-cache/<slug>.json`,
 * persisted GDD model, regulator manifest, third-party integrator
 * reading the JSON) can tell:
 *   - which contract version produced this file
 *   - whether it needs migration before the current loader will accept it
 *
 * Without that stamp, the only way to detect "this cache was generated
 * by an older parser" is field-by-field absence checking — fragile.
 *
 * # SEMVER POLICY
 *
 *   MAJOR  — removed field, renamed field, changed value semantics
 *            (e.g. `topology.evaluation: null` no longer means "lines").
 *            Forces an explicit migration in `modelMigrations.mjs`.
 *   MINOR  — added field with a safe default (older models still load
 *            without migration; the field gets default-resolved).
 *            Migration optional (back-fill default) but recommended.
 *   PATCH  — bugfix that does NOT change the shape (e.g. coercion
 *            tightening, validation guard). No migration needed.
 *
 * # CURRENT VERSION
 *
 * 1.0.0 — first stamped release (2026-06-25). Anything without a
 * `__schema__.version` field is treated as 0.x (legacy / pre-stamped)
 * and routed through `modelMigrations.migrate(model, '1.0.0')`.
 *
 * The legacy `0.x → 1.0.0` migration is a no-op shape-wise — it just
 * stamps the version. That gives every consumer the same code path
 * regardless of whether the source was a fresh parse or a 2025 cache.
 *
 * # HOW TO BUMP
 *
 * 1. Change MODEL_SCHEMA_VERSION below to the new semver.
 * 2. Add a migration entry to `src/registry/modelMigrations.mjs`
 *    keyed by `${from}->${to}` returning the transformed model.
 * 3. Add a contract test in `tests/_modelSchema.test.mjs` that loads
 *    an old fixture and asserts the migration produces the new shape.
 * 4. Run `npm run verify:quick` to confirm the gate is still green.
 */

export const MODEL_SCHEMA_VERSION = '1.0.0';

/**
 * Parse a semver triple `MAJOR.MINOR.PATCH` into an array. Returns
 * `[0, 0, 0]` for non-string / malformed input — the migrator treats
 * that as "older than 1.0.0" and routes through the legacy stamp path.
 *
 * @param {unknown} v
 * @returns {[number, number, number]}
 */
export function parseSemver(v) {
  if (typeof v !== 'string') return [0, 0, 0];
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Compare two semver triples. Returns negative if `a < b`, zero if
 * equal, positive if `a > b`. Used by the migration runner to decide
 * whether more migrations are needed.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareSemver(a, b) {
  const A = parseSemver(a);
  const B = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (A[i] !== B[i]) return A[i] - B[i];
  }
  return 0;
}

/**
 * Build the canonical `__schema__` envelope stamped on every parser
 * output. The shape is intentionally tiny so it stays cheap to read
 * and forward — consumers should treat it as opaque metadata.
 *
 * @returns {{version: string, generatedAt: string}}
 */
export function buildSchemaEnvelope() {
  return {
    version: MODEL_SCHEMA_VERSION,
    /* ISO-8601 timestamp — useful for cache invalidation, audit,
       and "this model was parsed before the bug fix at commit X"
       investigations. UTC so it sorts lexicographically. */
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Read the model's schema version, treating missing / malformed
 * `__schema__` as 0.x legacy. Centralised so callers don't all
 * re-implement the legacy detection guard.
 *
 * @param {object|null|undefined} model
 * @returns {string}
 */
export function readModelVersion(model) {
  if (!model || typeof model !== 'object') return '0.0.0';
  const env = model.__schema__;
  if (!env || typeof env !== 'object') return '0.0.0';
  const v = env.version;
  if (typeof v !== 'string') return '0.0.0';
  /* Defensive: if someone hand-edited the cache JSON and the version
     no longer matches semver, fall through to legacy so the migration
     runner can re-stamp it cleanly. */
  return /^\d+\.\d+\.\d+$/.test(v.trim()) ? v.trim() : '0.0.0';
}
