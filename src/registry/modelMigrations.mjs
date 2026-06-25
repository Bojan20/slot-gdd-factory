/**
 * src/registry/modelMigrations.mjs
 *
 * N+2 atom I (Boki 2026-06-25) — Migration registry + runner for
 * the top-level `model.json` schema. Pairs with `modelSchemaVersion.mjs`.
 *
 * # CONTRACT
 *
 * Each migration is a pure function `(model) => model'` that
 * transforms an instance of schema version `from` into an instance of
 * schema version `to`. Migrations MUST:
 *   - NOT mutate the input model (shallow-clone or build a new object).
 *   - Be idempotent under repeat application (running twice produces
 *     the same result as running once).
 *   - Preserve every field that the new schema still recognises.
 *   - Stamp the new `__schema__` envelope on the way out.
 *
 * Migrations MAY:
 *   - Add fields with default values (MINOR bump).
 *   - Remove or rename fields (MAJOR bump).
 *   - Change value semantics (MAJOR bump).
 *
 * # WHY A REGISTRY (NOT A CHAIN OF if/else)
 *
 * Keeping every step keyed by `${from}->${to}` means:
 *   - A consumer can ask "is there a path from 0.0.0 → 1.0.0?" without
 *     reading code.
 *   - Future jumps (e.g. 1.0.0 → 1.1.0 → 2.0.0) compose by running each
 *     migration in order. No "if version < X" cascade.
 *   - Tests can target one migration in isolation.
 *
 * # ADDING A NEW MIGRATION
 *
 *   import { register } from './modelMigrations.mjs';
 *   register('1.0.0', '1.1.0', (model) => ({
 *     ...model,
 *     newField: defaultForNewField(),
 *     __schema__: { ...model.__schema__, version: '1.1.0' },
 *   }));
 *
 * Then bump `MODEL_SCHEMA_VERSION` in modelSchemaVersion.mjs and add a
 * test in tests/_modelSchema.test.mjs.
 */

import {
  MODEL_SCHEMA_VERSION,
  buildSchemaEnvelope,
  readModelVersion,
  compareSemver,
} from './modelSchemaVersion.mjs';

/** @type {Map<string, (model: object) => object>} */
const _registry = new Map();

/**
 * Register a migration from one version to another. Idempotent —
 * calling with the same key replaces the prior function (useful for
 * tests that want to inject a probe migration).
 *
 * @param {string} from
 * @param {string} to
 * @param {(model: object) => object} fn
 */
export function register(from, to, fn) {
  if (typeof from !== 'string' || typeof to !== 'string') {
    throw new TypeError('register: from/to must be strings');
  }
  if (typeof fn !== 'function') {
    throw new TypeError('register: fn must be a function');
  }
  _registry.set(`${from}->${to}`, fn);
}

/**
 * List every registered migration key. Useful for tools/migrate-model
 * --list and for tests asserting coverage.
 *
 * @returns {string[]}
 */
export function listMigrations() {
  return Array.from(_registry.keys()).sort();
}

/**
 * Plan the migration chain from `fromVersion` to `toVersion`. Returns
 * an array of `${from}->${to}` keys to apply in order. Throws if no
 * path exists. The planner uses a simple linear walk because the
 * registry is intentionally small — when it grows past ~20 entries we
 * can swap in a BFS without changing the contract.
 *
 * @param {string} fromVersion
 * @param {string} toVersion
 * @returns {string[]}
 */
export function planMigration(fromVersion, toVersion) {
  if (compareSemver(fromVersion, toVersion) === 0) return [];
  if (compareSemver(fromVersion, toVersion) > 0) {
    throw new Error(
      `planMigration: downgrade not supported (from=${fromVersion} > to=${toVersion})`,
    );
  }
  const chain = [];
  let cur = fromVersion;
  const visited = new Set();
  while (compareSemver(cur, toVersion) < 0) {
    if (visited.has(cur)) {
      throw new Error(`planMigration: cycle detected at version ${cur}`);
    }
    visited.add(cur);
    /* Find the registered migration whose `from` matches `cur`. We
       intentionally take the SHORTEST single step that gets us closer
       to `toVersion` so a registry with both `1.0.0->1.1.0` and a
       hypothetical `1.0.0->2.0.0` shortcut still goes step-by-step
       (deterministic, predictable for tests). */
    const candidates = Array.from(_registry.keys())
      .filter((k) => k.startsWith(`${cur}->`))
      .map((k) => ({ key: k, to: k.split('->')[1] }))
      .filter((c) => compareSemver(c.to, toVersion) <= 0)
      /* Prefer the smallest next step (closest to `cur`). */
      .sort((a, b) => compareSemver(a.to, b.to));
    if (candidates.length === 0) {
      throw new Error(
        `planMigration: no registered migration from ${cur} toward ${toVersion}`,
      );
    }
    chain.push(candidates[0].key);
    cur = candidates[0].to;
  }
  return chain;
}

/**
 * Apply the migration chain to a model. Returns a new object (the
 * input is never mutated — every step rebuilds via spread). The
 * resulting model has `__schema__.version === toVersion`.
 *
 * @param {object} model
 * @param {string} [toVersion]  Defaults to MODEL_SCHEMA_VERSION (current).
 * @returns {object}
 */
export function migrate(model, toVersion = MODEL_SCHEMA_VERSION) {
  if (!model || typeof model !== 'object') {
    throw new TypeError('migrate: model must be an object');
  }
  const fromVersion = readModelVersion(model);
  const chain = planMigration(fromVersion, toVersion);
  /* Wave U-1 P0-3 (Boki 2026-06-25 audit U-2 #5) — defence in depth.
     The built-in 0.0.0->1.0.0 migration is a shallow spread, which
     leaves `model.topology`, `model.theme`, etc. as shared references
     with the caller's input. A future MAJOR migration that touches
     a nested key (e.g. `m.topology.kind = 'X'`) would mutate the
     caller's original object. We deep-clone the input ONCE here so
     every registered migration starts from a fully owned copy. The
     contract that migrations "MUST NOT mutate input" then holds
     transitively even if a future engineer writes a sloppy migration.
     `structuredClone` is in Node since 17 and handles every shape
     that survives JSON round-trip plus Date/Map/Set. */
  let cur = chain.length > 0 ? structuredClone(model) : model;
  for (const key of chain) {
    const fn = _registry.get(key);
    /* planMigration only emits keys it found in the registry, so this
       can only be null if someone deleted the registry mid-loop —
       defensive guard for tests that monkey-patch. */
    if (!fn) throw new Error(`migrate: registry lost migration ${key}`);
    cur = fn(cur);
    if (!cur || typeof cur !== 'object') {
      throw new Error(`migrate: ${key} returned non-object`);
    }
  }
  return cur;
}

/* ────────────────────────────────────────────────────────────────────
   Built-in migrations
   ──────────────────────────────────────────────────────────────────── */

/**
 * 0.0.0 → 1.0.0 — legacy stamp.
 *
 * Pre-2026-06-25 models never had `__schema__`. The shape itself was
 * already `1.0.0`-equivalent (no field renames, no removed fields), so
 * the migration just stamps the envelope. This makes every cached
 * `tools/_wave-v-cache/<slug>.json` and every persisted model.json
 * load through the same code path going forward.
 */
register('0.0.0', '1.0.0', (model) => ({
  ...model,
  __schema__: buildSchemaEnvelope(),
}));
