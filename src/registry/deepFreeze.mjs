/**
 * src/registry/deepFreeze.mjs
 *
 * P3-P1 (Boki 2026-06-25) — Recursive Object.freeze for default-config
 * trees that contain nested objects/arrays.
 *
 * # WHY
 *
 * Shallow `Object.freeze(defaultConfig())` was the standing pattern across
 * all 209 blocks (audited live via `tools/_freeze-default-config-audit.mjs`).
 * That prevents top-level key replacement but does NOT block:
 *
 *   const cfg = defaultConfig();
 *   cfg.theme.color = '#ff0000';   // silently mutates the SHARED default
 *
 * In practice every block currently sidesteps this by calling
 * `{ ...applyGridProfile('block', defaultConfig(), model) }` in
 * `resolveConfig` (the contract added in Wave U-1 P0-3 after the
 * scatterCelebration regression). That spread is SHALLOW too, so nested
 * mutation through a resolved cfg still mutates the shared default.
 *
 * `deepFreeze` is the explicit defence: recursively freeze every plain
 * object + array in a value graph so any nested write throws in strict
 * mode (which all ESM modules are).
 *
 * # WHEN TO USE
 *
 * - Brand-new blocks: build `defaultConfig()` from a literal, then return
 *   `deepFreeze(literal)`. `resolveConfig` MUST replace any nested key it
 *   wants to mutate with a fresh object (`{ ...c.nested, color: '#x' }`),
 *   never `c.nested.color = '#x'` directly.
 *
 * - Existing blocks: NOT migrated en-masse. Most existing `resolveConfig`
 *   implementations write nested keys directly; deep-freezing their
 *   defaults would throw at runtime. Migration is opt-in per block AFTER
 *   the resolver is rewritten to be pure-functional.
 *
 * # WHAT IT FREEZES
 *
 *   - Plain objects (Object.prototype === proto, or null-proto)
 *   - Arrays
 *
 * # WHAT IT LEAVES ALONE
 *
 *   - null / primitives (no-op)
 *   - Functions (already immutable for our purposes)
 *   - Class instances (Map, Set, Date, RegExp, Buffer) — freezing those
 *     can break their internal slots; opt-in user contract
 *   - Already-frozen objects (idempotent short-circuit)
 *
 * # CYCLES
 *
 * Visited-set guard so a defaultConfig accidentally self-referencing
 * doesn't blow the stack.
 *
 * # API
 *
 *   deepFreeze(value)     — freeze in place + return value (chain-friendly)
 *   isDeepFrozen(value)   — true when value + every nested obj/array is frozen
 */

const _PLAIN_PROTO = Object.prototype;

/**
 * Recursively `Object.freeze` every plain object and array in the value
 * graph. Returns the input by reference so callers can chain.
 *
 * @template T
 * @param {T} value
 * @param {WeakSet<object>} [_visited]
 * @returns {T}
 */
export function deepFreeze(value, _visited = new WeakSet()) {
  if (value === null) return value;
  const t = typeof value;
  if (t !== 'object' && t !== 'function') return value;
  if (Object.isFrozen(value)) return value;
  if (_visited.has(value)) return value;
  _visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item, _visited);
    Object.freeze(value);
    return value;
  }

  /* Only recurse into plain objects + null-prototype objects. Class
     instances (Map / Set / Date / RegExp / Buffer / custom classes)
     have internal slots that freezing can break, so we treat them as
     opaque. The caller can pre-freeze a class instance if they want
     and `isDeepFrozen` will respect it. */
  const proto = Object.getPrototypeOf(value);
  if (proto !== _PLAIN_PROTO && proto !== null) {
    Object.freeze(value);
    return value;
  }

  for (const key of Object.keys(value)) {
    deepFreeze(value[key], _visited);
  }
  Object.freeze(value);
  return value;
}

/**
 * True when `value` is frozen at every depth. Mirrors deepFreeze's
 * traversal rules (plain objects + arrays only). Primitives / functions
 * trivially pass. Cycle-safe via visited set.
 *
 * @param {unknown} value
 * @param {WeakSet<object>} [_visited]
 * @returns {boolean}
 */
export function isDeepFrozen(value, _visited = new WeakSet()) {
  if (value === null) return true;
  const t = typeof value;
  if (t !== 'object' && t !== 'function') return true;
  if (_visited.has(value)) return true;
  _visited.add(value);
  if (!Object.isFrozen(value)) return false;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isDeepFrozen(item, _visited)) return false;
    }
    return true;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== _PLAIN_PROTO && proto !== null) {
    /* Class instance — opaque. As long as IT is frozen we're done. */
    return true;
  }

  for (const key of Object.keys(value)) {
    if (!isDeepFrozen(value[key], _visited)) return false;
  }
  return true;
}
