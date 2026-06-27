import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/kernelInit.mjs
 *
 * P3-P4 (Boki 2026-06-25) — kernelInit boot blob.
 *
 * # WHY
 *
 * Vendor-neutral slot game shells boot through a `kernelInit` payload
 * that captures the per-session identity tuple needed by the regulator
 * backend AND the operator's BI pipeline. Without these fields, the
 * runtime can't authenticate to the session manager, can't audit a
 * specific play to a specific player, and can't carry skin / locale /
 * brand variation per launch.
 *
 * Canonical IxF / G2S boot fields (vendor-neutral):
 *
 *   softwareid    operator's identifier for the game build (string)
 *   skincode      brand / theme variant code (string, locale-correlated)
 *   sessionToken  per-launch opaque token issued by session manager
 *   currency      ISO 4217 three-letter currency code (string)
 *   locale        BCP 47 locale tag (string, e.g. en-US, sr-Latn-RS)
 *   playerId      opaque player-correlation token (string, hashable)
 *   environment   'production' | 'staging' | 'demo' | 'cert'
 *
 * This block emits ONE inline `<script>` that defines a frozen
 * `window.__KERNEL_INIT__` object — readable by every other block /
 * regulator gate (gambleSecondary, realityCheck, jurisdictionRules,
 * sessionTimeout) without re-reading model.json.
 *
 * # WHY A BLOCK (not a parser field)
 *
 * Parser produces a static model; kernelInit values arrive at LAUNCH
 * time. The block is rendered at HTML emit so the dev-mode page works
 * with stub values (operator-supplied at production launch via query
 * string or postMessage). Either path stamps the same global.
 *
 * # GDD-driven configuration (model.kernelInit):
 *
 *   enabled         boolean                       (default true)
 *   stubMode        boolean                       (default true — dev/QA)
 *   softwareid      string                        (default "slot-gdd-factory-stub")
 *   skincode        string                        (default "default")
 *   defaultCurrency ISO 4217                      (default "USD")
 *   defaultLocale   BCP 47                        (default "en-US")
 *   environment     string                        (default "demo")
 *
 * # Runtime override surface
 *
 *   window.__SLOT_KERNEL_INIT_OVERRIDE__(partial)
 *     – before window load, operator can call this once to set
 *       sessionToken / playerId / currency / locale. Block freezes
 *       the merged object then; later calls throw to make accidental
 *       mid-session mutation visible (the regulator audit assumes
 *       constant identity per session).
 *
 * # Public API (server-side ES module):
 *
 *   defaultConfig()                  → frozen safe defaults
 *   resolveConfig(model)             → merge defaults with model.kernelInit
 *   emitKernelInitMarkup(cfg)        → '' (block emits no DOM)
 *   emitKernelInitCSS(cfg)           → '' (no styles)
 *   emitKernelInitRuntime(cfg)       → inline <script> body string
 *
 * # Lifecycle:
 *
 *   boot (DOMContentLoaded sync) → freeze __KERNEL_INIT__ and emit
 *                                  HookBus onKernelInitReady event
 *   (overrides allowed only BEFORE the freeze; rejected after)
 *
 * # Vendor-neutral. No symbol, vendor, or operator-name references.
 *
 * @module kernelInit
 */

const ENV_ALLOWLIST = Object.freeze(['production', 'staging', 'demo', 'cert']);
const ISO_4217_RE = /^[A-Z]{3}$/;
/* BCP 47 simplified: language[-script][-region] — strict enough to
   reject obviously broken locales but doesn't pin every subtag rule. */
const BCP47_RE = /^[a-zA-Z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2,3})?$/;
const ID_MAX_LEN = 128;
const HOOK_PRIORITY = 5;

function _safeId(v, fb) {
  if (typeof v !== 'string') return fb;
  /* Reject anything that could break inline-script JSON encoding or
     leak through to a regulator audit log untrusted. POSIX-portable
     filename charset is overly strict but bullet-proof. */
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(v)) return fb;
  return v.slice(0, ID_MAX_LEN);
}

function _safeCurrency(v, fb) {
  if (typeof v !== 'string') return fb;
  const up = v.toUpperCase();
  return ISO_4217_RE.test(up) ? up : fb;
}

function _safeLocale(v, fb) {
  if (typeof v !== 'string') return fb;
  return BCP47_RE.test(v) ? v : fb;
}

function _safeEnv(v, fb) {
  return ENV_ALLOWLIST.includes(v) ? v : fb;
}

/**
 * Frozen safe defaults — every field is a string so the inline-script
 * JSON encoder never has to special-case undefined.
 *
 * @returns {Readonly<{enabled:boolean, stubMode:boolean, softwareid:string, skincode:string, defaultCurrency:string, defaultLocale:string, environment:string}>}
 */
export function defaultConfig() {
  return Object.freeze({
    enabled: true,
    stubMode: true,
    softwareid: 'slot-gdd-factory-stub',
    skincode: 'default',
    defaultCurrency: 'USD',
    defaultLocale: 'en-US',
    environment: 'demo',
  });
}

/**
 * Merge defaults with `model.kernelInit` overrides, sanitizing each
 * field through its own validator. Unknown / malformed values fall
 * back to defaults — never throws on GDD input drift.
 *
 * @param {object} [model]
 * @returns {Readonly<ReturnType<typeof defaultConfig>>}
 */
export function resolveConfig(model) {
  const d = defaultConfig();
  const override = (model && typeof model === 'object' && model.kernelInit) || {};
  return Object.freeze({
    enabled: override.enabled === false ? false : d.enabled,
    stubMode: override.stubMode === false ? false : d.stubMode,
    softwareid: _safeId(override.softwareid, d.softwareid),
    skincode: _safeId(override.skincode, d.skincode),
    defaultCurrency: _safeCurrency(override.defaultCurrency, d.defaultCurrency),
    defaultLocale: _safeLocale(override.defaultLocale, d.defaultLocale),
    environment: _safeEnv(override.environment, d.environment),
  });
}

/** Block emits no DOM markup — pure runtime block. */
export function emitKernelInitMarkup(cfg) {
  const resolved = cfg || defaultConfig();
  if (!resolved.enabled) return '';
  return tagBlockMarkup('', 'kernelInit');
}

/** Block emits no CSS — pure runtime block. */
export function emitKernelInitCSS() {
  return '';
}

/**
 * Emit the inline `<script>` body that defines + freezes
 * window.__KERNEL_INIT__.
 *
 * UQ-FORTIFY9 #1 safe JSON encoding: we use JSON.stringify on plain
 * strings (no `<` `>` `&` risk because every value already passed the
 * strict regex sanitizers above) — but still HTML-escape defensively
 * so a future regression in the sanitizer can't introduce inline
 * script-injection.
 *
 * @param {ReturnType<typeof defaultConfig>} [cfg]
 * @returns {string}
 */
export function emitKernelInitRuntime(cfg) {
  const resolved = cfg || defaultConfig();
  if (!resolved.enabled) {
    return '/* kernelInit disabled by GDD */';
  }
  const seed = {
    softwareid: resolved.softwareid,
    skincode: resolved.skincode,
    defaultCurrency: resolved.defaultCurrency,
    defaultLocale: resolved.defaultLocale,
    environment: resolved.environment,
    stubMode: resolved.stubMode,
    /* sessionToken + playerId left null in the seed — operator override
       sets them at launch. Stub mode uses synthesized values so dev runs
       don't need an external session manager. */
    sessionToken: resolved.stubMode ? `stub-${Date.now().toString(36)}` : null,
    playerId: resolved.stubMode ? 'stub-player-00000000' : null,
  };
  const safeSeedJSON = JSON.stringify(seed)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  return [
    '(function(){',
    `  var seed = ${safeSeedJSON};`,
    '  var frozen = false;',
    '  function _freeze(){ Object.freeze(window.__KERNEL_INIT__); frozen = true; }',
    '  window.__KERNEL_INIT__ = Object.assign({}, seed);',
    /* UQ-U-5 atom #5: every override field passes a STRICT charset gate.
       sessionToken / playerId: POSIX-safe IDs (alnum + . _ -)
       currency: 3-letter UPPERCASE ISO 4217
       locale:   BCP47 shape */
    '  var _SAFE_ID_RE  = /^[A-Za-z0-9._-]{1,256}$/;',
    '  var _ISO4217_RE  = /^[A-Z]{3}$/;',
    '  var _BCP47_RE    = /^[a-zA-Z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2,3})?$/;',
    '  function _validOverride(k, v) {',
    '    if (typeof v !== "string") return false;',
    '    if (k === "sessionToken" || k === "playerId") return _SAFE_ID_RE.test(v);',
    '    if (k === "currency") return _ISO4217_RE.test(v);',
    '    if (k === "locale") return _BCP47_RE.test(v);',
    '    return false;',
    '  }',
    '  window.__SLOT_KERNEL_INIT_OVERRIDE__ = function(partial){',
    '    if (frozen) {',
    '      throw new Error("kernelInit: override rejected — already frozen at boot");',
    '    }',
    '    if (!partial || typeof partial !== "object") return;',
    '    var allowed = ["sessionToken","playerId","currency","locale"];',
    '    for (var i=0; i<allowed.length; i++) {',
    '      var k = allowed[i];',
    '      if (_validOverride(k, partial[k])) {',
    '        window.__KERNEL_INIT__[k] = partial[k];',
    '      }',
    '    }',
    '  };',
    '  /* Freeze at DOMContentLoaded so regulator-audit blocks see a',
    '     stable identity tuple from then on. */',
    '  if (document.readyState === "loading") {',
    '    document.addEventListener("DOMContentLoaded", _freeze, { once: true });',
    '  } else {',
    '    _freeze();',
    '  }',
    '  /* Emit HookBus event for any block that wants to react. */',
    '  if (window.HookBus && typeof window.HookBus.emit === "function") {',
    `    window.HookBus.emit("onKernelInitReady", window.__KERNEL_INIT__, { priority: ${HOOK_PRIORITY} });`,
    '  }',
    '})();',
  ].join('\n');
}
