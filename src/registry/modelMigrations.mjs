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
 * Test-only — remove every migration EXCEPT the built-in `0.0.0->1.0.0`
 * baseline. Lets test suites that register probe migrations clean up so
 * later tests in the same process see the canonical registry. NOT for
 * production use (it would orphan future bumped versions).
 *
 * UQ-U-3 atom #8 (contract agent #10): test contamination — the BFS test
 * registered `1.0.0->1.1.0` + `1.1.0->1.2.0` and these survived for any
 * subsequent in-process consumer. Now tests can call this in cleanup.
 *
 * @returns {string[]} keys removed
 */
export function _resetRegistryForTests(keepBuiltins = true) {
  const removed = [];
  for (const key of Array.from(_registry.keys())) {
    if (keepBuiltins && key === '0.0.0->1.0.0') continue;
    _registry.delete(key);
    removed.push(key);
  }
  return removed;
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
  /* UQ-U-2 atom #10 (Boki 2026-06-25): proper BFS planner.
   *
   * Previous greedy implementation could deadlock or miss the shortest
   * path when the registry grew. Now BFS:
   *   - Treats each version as a graph node.
   *   - Each registered `from->to` edge is one hop.
   *   - Returns the SHORTEST chain (fewest registered migrations) that
   *     ends EXACTLY at `toVersion`. If `toVersion` is reachable via
   *     intermediate steps (1.0.0 → 1.1.0 → 1.2.0 when target is 1.2.0)
   *     BFS will find it; if a shortcut 1.0.0 → 1.2.0 exists, BFS prefers
   *     the single-hop path. Deterministic tie-breaker: sorted edge order.
   *   - Throws when target unreachable, with the visited set in the error
   *     so consumers can see how far the planner got.
   */
  const edgesByFrom = new Map();
  for (const key of _registry.keys()) {
    const [from, to] = key.split('->');
    if (!edgesByFrom.has(from)) edgesByFrom.set(from, []);
    edgesByFrom.get(from).push({ key, to });
  }
  /* Sort each adjacency list so BFS is deterministic across Map insertion order. */
  for (const edges of edgesByFrom.values()) {
    edges.sort((a, b) => compareSemver(a.to, b.to));
  }

  const queue = [{ version: fromVersion, chain: [] }];
  const visited = new Set([fromVersion]);
  while (queue.length > 0) {
    const node = queue.shift();
    const edges = edgesByFrom.get(node.version) || [];
    for (const edge of edges) {
      if (compareSemver(edge.to, toVersion) > 0) continue; // overshoot
      const nextChain = [...node.chain, edge.key];
      if (compareSemver(edge.to, toVersion) === 0) return nextChain;
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push({ version: edge.to, chain: nextChain });
      }
    }
  }
  throw new Error(
    `planMigration: no path from ${fromVersion} to ${toVersion} (visited: ${Array.from(visited).join(', ')})`,
  );
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
     every registered migration starts from a fully owned copy.

     UQ-U-3 atom #4 (contract agent #4 VERIFIED): structuredClone throws
     DataCloneError on Function / Symbol / WeakRef fields. The official
     contract says "JSON+Date/Map/Set", but defensive coding now
     try/catches and falls back to JSON-roundtrip clone (loses Map/Set
     but preserves shape — strictly better than throwing on a foreign
     field that no current parser produces). The fallback emits a
     tracing warning so production hits are visible. */
  let cur;
  if (chain.length > 0) {
    try {
      cur = structuredClone(model);
    } catch (cloneErr) {
      try {
        cur = JSON.parse(JSON.stringify(model));
        // eslint-disable-next-line no-console
        console.warn(
          `migrate: structuredClone failed (${cloneErr.message}); fell back to JSON-clone (Map/Set/Date demoted to plain)`,
        );
      } catch (jsonErr) {
        throw new Error(
          `migrate: model is uncloneable (structuredClone: ${cloneErr.message}; JSON: ${jsonErr.message})`,
        );
      }
    }
  } else {
    cur = model;
  }

  /* UQ-U-3 atom #5 (contract agent #5): after EACH migration fn we
     re-read the __schema__.version stamp and assert it matches the
     `to` part of the migration key. A sloppy fn that forgets to bump
     the version would silently leave the model "looking" old and the
     planMigration runner would think more steps are needed (loop) or
     the final consumer would see stale envelope. Hard-fail with the
     actual vs expected stamp so the broken migration is obvious. */
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
    const expectedTo = key.split('->')[1];
    const actualVer = readModelVersion(cur);
    if (compareSemver(actualVer, expectedTo) !== 0) {
      throw new Error(
        `migrate: ${key} produced model.__schema__.version=${actualVer}, expected ${expectedTo}`,
      );
    }
  }
  return cur;
}

/**
 * UQ-U-8 P1 (Boki 2026-06-25, observability U-8-C #5): same as `migrate`
 * but returns `{model, chain}` so a programmatic consumer (e.g. the
 * audit walker doing 338-file bulk migration) can log WHICH steps
 * fired per file. Operators previously had no visibility into the
 * applied chain because only the CLI runner printed it; bulk callers
 * silently transformed entire corpora.
 *
 * @param {object} model
 * @param {string} [toVersion]
 * @returns {{ model: object, chain: string[] }}
 */
export function migrateWithReceipt(model, toVersion = MODEL_SCHEMA_VERSION) {
  if (!model || typeof model !== 'object') {
    throw new TypeError('migrateWithReceipt: model must be an object');
  }
  const fromVersion = readModelVersion(model);
  const chain = planMigration(fromVersion, toVersion);
  const result = migrate(model, toVersion);
  return { model: result, chain };
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
