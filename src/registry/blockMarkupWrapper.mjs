/**
 * src/registry/blockMarkupWrapper.mjs
 *
 * UQ-DEEP-AO · AO-1 — Universal data-block-name attribute injector.
 *
 * Wraps the rendered HTML markup emitted by every block's emit*Markup
 * function with a `data-block-name="<camelName>"` attribute on the root
 * element. This unblocks deterministic visual QA / Playwright walkers
 * that need to select block-by-block instead of relying on fragile
 * grep heuristics over class names or ids.
 *
 * Contract:
 *   • Idempotent — if markup already carries `data-block-name=`, return
 *     unchanged.
 *   • Skips empty strings, non-strings, and missing block names.
 *   • Preserves leading whitespace / comments — injects the attribute
 *     on the first opening HTML tag found.
 *   • HTML-attribute-escapes `"` in the supplied name.
 *
 * Public API:
 *   SCHEMA_VERSION         — '1'
 *   tagBlockMarkup(s, n)   — string · string → string
 */

export const SCHEMA_VERSION = '1';

/**
 * Wraps emit*Markup output with `data-block-name="<name>"` on root tag.
 * @param {string} markup  Raw HTML fragment emitted by the block.
 * @param {string} name    Camel-cased block name (e.g. 'achievementToast').
 * @returns {string} Markup with attribute injected (idempotent).
 */
export function tagBlockMarkup(markup, name) {
  if (typeof markup !== 'string' || markup.length === 0) return markup;
  if (typeof name !== 'string' || !name) return markup;
  if (markup.includes('data-block-name=')) return markup;

  /* Match the first opening tag after optional whitespace and HTML comments.
     Capture groups:
       1 — leading whitespace + comments
       2 — `<tagname ...attrs` (no closing `>` or `/>`)
       3 — trailing whitespace + `>` or `/>`
   */
  const m = markup.match(/^(\s*(?:<!--[\s\S]*?-->\s*)*)(<\w[^>]*?)(\s*\/?>)/);
  if (!m) return markup;
  const [, prefix, tagOpen, tagClose] = m;
  const safeName = name.replace(/"/g, '&quot;');
  const injected = tagOpen + ' data-block-name="' + safeName + '"' + tagClose;
  return prefix + injected + markup.slice(m[0].length);
}
