/**
 * src/registry/antiVendorShield.mjs
 *
 * MATH-INTEGRATION-LV3 atom #11 extension (Boki 2026-06-26) —
 * client-side anti-vendor sanitization registry.
 *
 * # WHY
 *
 * `tools/math-backend.mjs` already runs server-side `sanitizeStr` +
 * `sanitizeObj` over every response. That covers happy paths where
 * the operator owns the backend. But:
 *
 *   1. A misconfigured / proxied backend can inject vendor-trademarked
 *      strings BETWEEN the server and the client (CDN error pages,
 *      reverse-proxy banners, third-party telemetry injectors).
 *   2. Operator-side tools that READ the backend response and
 *      forward it to dashboards (LV3-4 HUD, LV3-5 batch panel,
 *      LV3-7 cert pack) need a single shared sanitizer so a future
 *      block author can't bypass the shield.
 *   3. Test fixtures and mock wrappers must use the SAME regex as
 *      production so a clean fixture stays clean and a deliberate
 *      probe (e.g. `'IGT'` test string) gets caught.
 *
 * Single source of truth lives here. Backend / blocks / tools all
 * import from `antiVendorShield`.
 *
 * # CONTRACT
 *
 *   VENDOR_RX       — regex (gi flag) — matched against every string.
 *   isVendorTainted(s) → boolean
 *   sanitizeStr(s, replacement?) → string with vendor tokens replaced
 *   sanitizeObj(obj, replacement?) → deep-walked clone with strings
 *                                    scrubbed
 *   listVendors()  → array of vendor tokens (for help / docs).
 *
 * The replacement string defaults to `'[vendor]'`. Operators that
 * need a different token (e.g. `'[redacted]'`) pass it explicitly.
 *
 * # SCOPE
 *
 * String VALUES, NOT keys. We don't scrub `{ IGT: 1 }` because a
 * vendor-named key is structurally significant (a configuration drift
 * symptom that the consumer must SURFACE, not silently rewrite). The
 * existing anti-vendor lint catches name-as-key issues at build time.
 */

/* Locked list (kept in sync with tools/math-backend.mjs:VENDOR_RX +
   tools/anti-vendor-lint.mjs). When adding a vendor here, add it to
   the lint tool as well. */
const VENDORS_LIST = Object.freeze([
  'IGT',
  'Pragmatic Play',
  'Megaways',
  'Cash Eruption',
  'Wolf Run',
  'Cleopatra',
  'Buffalo King',
  'Buffalo Gold',
  'NetEnt',
  'Microgaming',
  'Scientific Games',
  'L&W',
  'Light & Wonder',
  "Play'n Go",
  'Novomatic',
]);

/* The runtime regex tolerates inter-token whitespace, hyphen, dot,
   and underscore so `IGT`, `igt`, `Pragmatic_Play`, `pragmatic-play`,
   `Cash.Eruption` all match. */
export const VENDOR_RX = /\b(IGT|Pragmatic[\s\-_.]?Play|Megaways|Cash[\s\-_.]?Eruption|Wolf[\s\-_.]?Run|Cleopatra|Buffalo[\s\-_.]?(?:King|Gold)|NetEnt|Microgaming|Scientific[\s\-_.]?Games|L&W|Light[\s\-_.]*&[\s\-_.]*Wonder|Play'?n[\s\-_.]?Go|Novomatic)\b/gi;

/**
 * True when the input contains at least one vendor token.
 *
 * @param {unknown} s
 * @returns {boolean}
 */
/**
 * UQ-LV3-QA-2 audit #8 (Boki 2026-06-26): mid-word evasion fix.
 *
 * Pre-fix `\b` word-boundary anchors meant `pragm-atic` (hyphen in
 * the middle of the token) was NOT caught — a known evasion vector
 * for any operator who tries to slip vendor names past the lint by
 * inserting punctuation. Now we NFKD-normalize and strip every
 * separator class (whitespace, hyphen, underscore, dot) BEFORE
 * pattern matching, so `pragm-atic`, `pragm_atic`, `pragm . atic`
 * all collapse to `pragmatic` and hit the regex.
 *
 * The "presence" regex is recomputed without `\b` boundaries on the
 * normalized string; the original VENDOR_RX (with boundaries) is
 * still used for `sanitizeStr` because we DO want the original text
 * untouched outside the actual tainted slice.
 */
/* Normalized variants — separators already stripped before this regex
   runs, so both `Pragmatic` (alone) and `Pragmatic Play` (with the suffix)
   land on the `pragmatic` prefix here. Word-boundary not used because
   the input is already canonical-form. */
const _NORMALIZED_VENDOR_RX = /(igt|pragmatic|megaways|casheruption|wolfrun|cleopatra|buffaloking|buffalogold|netent|microgaming|scientificgames|l&w|lightandwonder|lightwonder|playngo|novomatic)/i;
function _normalizeForVendor(s) {
  if (typeof s !== 'string') return '';
  /* Drop combining marks, separators, then lowercase. */
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[\s._\-]+/g, '')
    .toLowerCase();
}

export function isVendorTainted(s) {
  if (typeof s !== 'string') return false;
  /* Two-pass: anchored regex AND normalized check — taint on EITHER. */
  VENDOR_RX.lastIndex = 0;
  const anchored = VENDOR_RX.test(s);
  VENDOR_RX.lastIndex = 0;
  if (anchored) return true;
  return _NORMALIZED_VENDOR_RX.test(_normalizeForVendor(s));
}

/**
 * Replace every vendor token with `replacement` (default `'[vendor]'`).
 * Non-strings pass through unchanged.
 *
 * @param {unknown} s
 * @param {string} [replacement]
 * @returns {unknown}
 */
export function sanitizeStr(s, replacement = '[vendor]') {
  if (typeof s !== 'string') return s;
  VENDOR_RX.lastIndex = 0;
  let out = s.replace(VENDOR_RX, replacement);
  VENDOR_RX.lastIndex = 0;
  /* UQ-LV3-QA-2 audit #8: if isVendorTainted catches a normalized
     evasion (`pragm-atic`) but anchored regex doesn't, replace the
     entire string with the replacement marker — operator can't tell
     where the vendor mention sat inside the separator-laced token,
     so collapsing the whole string is the safe call. */
  if (out === s && isVendorTainted(s)) {
    out = replacement;
  }
  return out;
}

/**
 * Deep-walk a value and sanitize every string it contains. Returns a
 * NEW value (does not mutate the input). Recurses through plain
 * objects + arrays; treats class instances (Map, Set, Date) as opaque
 * leaf nodes (mirrors `deepFreeze.mjs` traversal contract).
 *
 * # CYCLE SAFETY
 *
 * Visited-set guard so a self-referencing graph (rare in JSON payloads
 * but possible from a probe accident) doesn't blow the stack.
 *
 * @template T
 * @param {T} obj
 * @param {string} [replacement]
 * @param {WeakSet<object>} [_visited]
 * @returns {T}
 */
/* UQ-LV3-QA-2 audit #9: depth cap. Acyclic 10000-nested JSON still
   blew the stack (WeakSet only catches cycles, not depth). 200 levels
   is far past any realistic backend response. */
const _MAX_SANITIZE_DEPTH = 200;
export function sanitizeObj(obj, replacement = '[vendor]', _visited = new WeakSet(), _depth = 0) {
  if (obj === null) return obj;
  const t = typeof obj;
  if (t === 'string') return /** @type {T} */ (sanitizeStr(obj, replacement));
  if (t !== 'object') return obj;
  if (_depth >= _MAX_SANITIZE_DEPTH) return obj;
  if (_visited.has(obj)) return obj;
  _visited.add(obj);

  if (Array.isArray(obj)) {
    return /** @type {T} */ (
      obj.map((item) => sanitizeObj(item, replacement, _visited, _depth + 1))
    );
  }

  /* Class instances stay opaque — same rule as deepFreeze.mjs. */
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    return obj;
  }

  const out = {};
  for (const k of Object.keys(obj)) {
    /* Key NOT scrubbed by design — see header. */
    out[k] = sanitizeObj(obj[k], replacement, _visited, _depth + 1);
  }
  return /** @type {T} */ (out);
}

/**
 * Read-only list of known vendor tokens (the source for the regex).
 * Useful for help text, docs, and lint configuration mirror checks.
 *
 * @returns {ReadonlyArray<string>}
 */
export function listVendors() {
  return VENDORS_LIST;
}
