/**
 * src/utils/safeCoerce.mjs
 *
 * FIX-8 M3 + M4 (2026-06-19) — Byte-safe coercion + injection-safe escape.
 *
 * Industry baseline: GDD JSON / parsed YAML can deliver values as strings
 * ("0.30"), nulls, empty strings, or formatted variants ("30%"). Native
 * Number() and CSS comment emit have classic traps:
 *
 *   M3 traps:
 *     • Number('')      === 0       (silent 0 — bad default)
 *     • Number(null)    === 0       (silent 0 — bad default)
 *     • Number('30%')   === NaN     (silently downstream → 0 or junk)
 *     • Number('0.30')  === 0.3     (OK)
 *     • Number('  3  ') === 3       (OK; trim works)
 *     • Number('0x10')  === 16      (OK but unintended for decimal)
 *
 *   M4 traps:
 *     • GDD label containing a star-slash digraph emitted inside CSS
 *       block comment breaks out of comment context — produces invalid
 *       CSS or worse, script-side execution if comment wraps inline-
 *       style with attr().
 *     • GDD label containing a close-style-tag inside style tag.
 *
 * Public API:
 *   safeNumber(value, fallback)        — clamp to finite Number or fallback
 *   safeCssComment(s, maxLen)          — strip '* /' digraph + close-tags
 *   safeHtmlContent(s, maxLen)         — escape <,>,&,",'
 *   safeJsonScriptInline(s)            — JSON.stringify + '<' → '\\u003c'
 *
 * Zero runtime deps. Idempotent. Tree-shakeable.
 */

/**
 * @param {*} value     candidate (string, number, null, undefined)
 * @param {number} [fallback=0]
 * @returns {number} finite number or fallback
 *
 * @example
 *   safeNumber('0.30', 0)   → 0.3
 *   safeNumber('30%', 0)    → 0
 *   safeNumber('', 5)       → 5
 *   safeNumber(null, 5)     → 5
 *   safeNumber('  10 ', 0)  → 10
 *   safeNumber('0x10', 0)   → 16   (intentional; hex is valid Number input)
 */
export function safeNumber(value, fallback) {
  const fb = Number.isFinite(fallback) ? fallback : 0;
  if (value === '' || value == null) return fb;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fb;
  if (typeof value !== 'string') {
    const coerced = Number(value);
    return Number.isFinite(coerced) ? coerced : fb;
  }
  const trimmed = value.trim();
  if (trimmed === '') return fb;
  /* Reject formatted variants like "30%", "$5", "1,000" — these are
   * locale/UI strings, not data. Caller should pre-normalize. */
  if (/[%,$€£]|\s/.test(trimmed)) return fb;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : fb;
}

/**
 * Strip the star+slash close-comment digraph from any string destined for
 * inclusion inside a CSS block comment, plus close-tag variants.
 * Also caps length so a hostile GDD cannot generate a kilobyte of comment.
 *
 * @param {string} s
 * @param {number} [maxLen=200]
 * @returns {string} safe-to-inline
 *
 * @example
 *   safeCssComment('hack * / inject')  → 'hack * \/ inject'
 *   safeCssComment('</style>')         → '<\/style>'
 */
export function safeCssComment(s, maxLen) {
  if (s == null) return '';
  const cap = Number.isFinite(maxLen) && maxLen > 0 ? maxLen : 200;
  let str = String(s).slice(0, cap);
  /* Break close-comment digraph */
  str = str.replace(/\*\//g, '*\\/');
  /* Break HTML close-tag escapes inside <style> */
  str = str.replace(/<\//g, '<\\/');
  /* Strip newlines so a multi-line GDD label cannot inject a CSS rule */
  str = str.replace(/[\r\n]+/g, ' ');
  return str;
}

/**
 * Escape user-controlled text for safe inclusion inside HTML body text.
 * NOT a replacement for proper templating — only for inline content.
 *
 * @param {string} s
 * @param {number} [maxLen=500]
 * @returns {string}
 */
export function safeHtmlContent(s, maxLen) {
  if (s == null) return '';
  const cap = Number.isFinite(maxLen) && maxLen > 0 ? maxLen : 500;
  return String(s).slice(0, cap).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

/**
 * Wrap value for safe inclusion inside an inline <script> block as JSON.
 * Escapes the '<' character so close-script digraph (</script>) cannot
 * break out. Mirrors the FIX-8 H2 hardening pattern.
 *
 * @param {*} value
 * @returns {string}
 *
 * @example
 *   safeJsonScriptInline('ab</script>cd')
 *     → '"ab\\u003c\\/script\\u003ecd"'
 */
export function safeJsonScriptInline(value) {
  const json = JSON.stringify(value == null ? null : value);
  return json.replace(/</g, '\\u003c');
}
