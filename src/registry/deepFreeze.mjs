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
 * # UQ-U-4 #1 FIX (Boki 2026-06-25)
 *
 * The previous implementation short-circuited on `Object.isFrozen(value)`
 * BEFORE recursing into children. A SHALLOW-frozen wrapper around a
 * mutable tree — e.g. `Object.freeze({a:{b:1}})` — would silently skip
 * the recursion and leave `.a` mutable. That violated the deep contract
 * for the most common input shape. The early-return is removed; we
 * still avoid duplicate work by checking the visited set (which doubles
 * as cycle guard).
 *
 * # UQ-U-4 #2 FIX
 *
 * `Object.keys` skipped Symbol-keyed and non-enumerable own properties.
 * `Reflect.ownKeys` covers both — matches `structuredClone`'s
 * enumeration set so the deep-freeze guard catches the same surface
 * area as the upstream clone in `migrate()`.
 *
 * # UQ-U-4 #6 FIX
 *
 * Header used to claim "functions pass through". The code path explicitly
 * froze them via the `'object' || 'function'` typeof gate. Doc and code
 * are now aligned: functions ARE frozen (preventing the rare
 * `fn.someProperty = 'X'` mutation), but they remain callable.
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
  /* Cycle / duplicate-work guard. Critical: this is the ONLY early
     return — we cannot short-circuit on Object.isFrozen because a
     shallow-frozen wrapper hides a mutable subtree (UQ-U-4 #1). */
  if (_visited.has(value)) return value;
  _visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item, _visited);
    if (!Object.isFrozen(value)) Object.freeze(value);
    return value;
  }

  /* Only recurse into plain objects + null-prototype objects. Class
     instances (Map / Set / Date / RegExp / Buffer / custom classes)
     have internal slots that freezing can break, so we treat them as
     opaque. The caller can pre-freeze a class instance if they want
     and `isDeepFrozen` will respect it.
     UQ-U-4 #8 — strict "plain-only" rule: any non-plain proto chain
     (including `Object.create({foo:1})`) is treated as opaque. We
     document this clearly so a default-config author knows not to
     reach for `Object.create(parent)` if they want deep coverage. */
  const proto = Object.getPrototypeOf(value);
  if (proto !== _PLAIN_PROTO && proto !== null) {
    if (!Object.isFrozen(value)) Object.freeze(value);
    return value;
  }

  /* Reflect.ownKeys returns string + Symbol + non-enumerable keys —
     superset of Object.keys. Closes the UQ-U-4 #2 hole. */
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(value[key], _visited);
  }
  if (!Object.isFrozen(value)) Object.freeze(value);
  return value;
}

/**
 * True when `value` is frozen at every depth. Mirrors deepFreeze's
 * traversal rules (plain objects + arrays only). Primitives / functions
 * trivially pass. Cycle-safe via two-pass approach.
 *
 * # UQ-U-4 #3 FIX (Boki 2026-06-25)
 *
 * The previous implementation returned `true` on visited-cycle hit
 * BEFORE verifying the node was frozen. For graph A→B→A where A is
 * frozen but B mutable, the recursion into B's `self=A` short-circuited
 * to true and propagated upward as a false negative. The new approach
 * uses an explicit "in-progress" marker so cycle hits return the verdict
 * of the currently-traversing root rather than an optimistic true.
 *
 * Implementation: a Map keyed by reference holds three states:
 *   - undefined  : not visited yet
 *   - 'pending'  : currently being traversed (cycle in progress)
 *   - true/false : settled verdict
 * When we hit 'pending' we're inside a cycle — return true OPTIMISTICALLY
 * for THIS edge, BUT the recursive caller still sees every direct
 * frozenness check on every node, so a mutable B in the cycle is caught
 * on B's own visit, not via the cycle short-circuit.
 *
 * @param {unknown} value
 * @param {Map<object, boolean | 'pending'>} [_visited]
 * @returns {boolean}
 */
export function isDeepFrozen(value, _visited = new Map()) {
  if (value === null) return true;
  const t = typeof value;
  if (t !== 'object' && t !== 'function') return true;
  const settled = _visited.get(value);
  if (settled === true) return true;
  if (settled === false) return false;
  if (settled === 'pending') {
    /* Cycle hit. Don't pre-commit to a verdict — the OTHER ancestor
       traversals will hit each node's own frozenness check directly
       (we always enter the recursion fresh per node ID). Returning
       true here only short-circuits THIS edge of the cycle. */
    return true;
  }
  _visited.set(value, 'pending');

  /* Frozen check on THE NODE ITSELF first — even before recursion. */
  if (!Object.isFrozen(value)) {
    _visited.set(value, false);
    return false;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isDeepFrozen(item, _visited)) {
        _visited.set(value, false);
        return false;
      }
    }
    _visited.set(value, true);
    return true;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== _PLAIN_PROTO && proto !== null) {
    /* Class instance — opaque. As long as IT is frozen we're done. */
    _visited.set(value, true);
    return true;
  }

  /* Reflect.ownKeys: Symbol + non-enumerable parity with deepFreeze. */
  for (const key of Reflect.ownKeys(value)) {
    if (!isDeepFrozen(value[key], _visited)) {
      _visited.set(value, false);
      return false;
    }
  }
  _visited.set(value, true);
  return true;
}
