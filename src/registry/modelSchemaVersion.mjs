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
 * Parse a semver triple `MAJOR.MINOR.PATCH[-prerelease][+build]` into a
 * structured object. Returns `null` for non-string / malformed input —
 * the migrator treats that as "older than 1.0.0" and routes through the
 * legacy stamp path. Wrapper `parseSemver` (below) is the back-compat
 * tuple form callers already used.
 *
 * # UQ-U-2 atom #11 (Boki 2026-06-25): pre-release support
 *
 * Pre-release identifiers (`1.0.0-rc1`, `2.0.0-beta.3`) order LOWER than
 * the same MAJOR.MINOR.PATCH without pre-release per SemVer 2.0 §11.
 * Build metadata after `+` is IGNORED for ordering per §10. This lets
 * us cut release candidates without breaking the migration planner.
 *
 * @param {unknown} v
 * @returns {{major:number,minor:number,patch:number,prerelease:string[]|null}|null}
 */
function parseSemverFull(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : null,
  };
}

/**
 * Parse a semver into `[MAJOR, MINOR, PATCH]` tuple. Pre-release suffix
 * is dropped from the tuple (use `parseSemverFull` if you need it).
 *
 * Returns `[0, 0, 0]` for non-string / malformed input by default
 * (back-compat with pre-UQ-U-2 callers that route "garbage" through
 * the legacy 0.x migration path). Pass `{strict: true}` to throw on
 * malformed input — used by CLI flag validation that needs a clear
 * "this is not a semver" signal.
 *
 * @param {unknown} v
 * @param {{strict?: boolean}} [opts]
 * @returns {[number, number, number]}
 * @throws {TypeError} when `opts.strict` is true and input is invalid
 */
export function parseSemver(v, opts = {}) {
  const full = parseSemverFull(v);
  if (!full) {
    if (opts.strict) {
      throw new TypeError(`parseSemver: not a valid semver: ${JSON.stringify(v)}`);
    }
    return [0, 0, 0];
  }
  return [full.major, full.minor, full.patch];
}

/**
 * Compare two semver strings per SemVer 2.0 ordering rules. Returns
 * negative if `a < b`, zero if equal, positive if `a > b`. Used by the
 * migration runner to decide whether more migrations are needed.
 *
 * Pre-release identifiers compare per §11:
 *   - 1.0.0-rc1 < 1.0.0  (any pre-release is less than the release)
 *   - 1.0.0-rc1 < 1.0.0-rc2  (numeric identifier ordering)
 *   - 1.0.0-alpha < 1.0.0-beta  (alphabetic identifier ordering)
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareSemver(a, b) {
  const A = parseSemverFull(a);
  const B = parseSemverFull(b);
  if (!A || !B) {
    /* Legacy fallback: treat unparseable as 0.0.0 (existing behaviour). */
    const fa = parseSemverFull(a) || { major: 0, minor: 0, patch: 0, prerelease: null };
    const fb = parseSemverFull(b) || { major: 0, minor: 0, patch: 0, prerelease: null };
    return _cmpFull(fa, fb);
  }
  return _cmpFull(A, B);
}

function _cmpFull(A, B) {
  if (A.major !== B.major) return A.major - B.major;
  if (A.minor !== B.minor) return A.minor - B.minor;
  if (A.patch !== B.patch) return A.patch - B.patch;
  /* Pre-release ordering per SemVer 2.0 §11 */
  if (A.prerelease === null && B.prerelease === null) return 0;
  if (A.prerelease === null) return 1; // release > prerelease
  if (B.prerelease === null) return -1;
  const len = Math.max(A.prerelease.length, B.prerelease.length);
  for (let i = 0; i < len; i++) {
    const ai = A.prerelease[i];
    const bi = B.prerelease[i];
    if (ai === undefined) return -1; // shorter set with all preceding equal is lower
    if (bi === undefined) return 1;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const d = Number(ai) - Number(bi);
      if (d !== 0) return d;
    } else if (aNum) {
      return -1; // numeric identifiers always have lower precedence than alphanumeric
    } else if (bNum) {
      return 1;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Build the canonical `__schema__` envelope stamped on every parser
 * output. The shape is intentionally tiny so it stays cheap to read
 * and forward — consumers should treat it as opaque metadata.
 *
 * # WHY NO `generatedAt` HERE (Wave U-1 P0-2, Boki 2026-06-25 audit U-2 #21)
 *
 * The original design stamped `generatedAt: new Date().toISOString()`
 * here. That made every `parseGDD()` call produce a model with a
 * different timestamp — a determinism bomb for any downstream tool
 * that JSON-stringifies a model and compares against a baked baseline
 * (uq16, visreg, cross-corpus parity, third-party integrator round
 * trips). Even hot-loop callers paid an unnecessary `new Date()` per
 * partial-failure path.
 *
 * The envelope now carries ONLY the version (deterministic, single
 * source of truth in MODEL_SCHEMA_VERSION). Timestamps that audit
 * "when was this model parsed" belong in a separate audit log emitted
 * by the orchestrator that calls the parser — not in the parser's
 * own output where they pollute every snapshot.
 *
 * If a consumer genuinely needs a timestamp, they can stamp it at
 * persistence time (e.g. `tools/migrate-model.mjs --out` could attach
 * a sidecar `<file>.audit.json` with `{migratedAt, fromVersion, toVersion}`).
 *
 * @returns {{version: string}}
 */
export function buildSchemaEnvelope() {
  return {
    version: MODEL_SCHEMA_VERSION,
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
     runner can re-stamp it cleanly. UQ-U-2 atom #11: pre-release allowed. */
  const trimmed = v.trim();
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(trimmed)
    ? trimmed
    : '0.0.0';
}
