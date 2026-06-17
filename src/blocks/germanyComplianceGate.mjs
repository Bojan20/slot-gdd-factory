/**
 * src/blocks/germanyComplianceGate.mjs
 *
 * W58.J-DE — GlüStV (Glücksspielstaatsvertrag 2021) compliance gate.
 *
 * Centralized opt-in block that enforces TWO German jurisdiction
 * obligations at boot time:
 *
 *   §11(2) Spielpause / Spin pace floor
 *     Every spin must take at LEAST 5 seconds wall-clock from trigger
 *     to settle. Faster cadence is considered "rapid play" and triggers
 *     a regulatory violation. This block sets a window-level flag
 *     `window.__DE_MIN_SPIN_MS__ = 5000` at boot; spin-trigger consumers
 *     (autoplay tick, slamStop, turboMode) must respect the floor by
 *     reading the flag at dispatch time.
 *
 *   §6e Speichern des Spielstands / No saved game state
 *     A new session must NOT inherit any game state from a prior session
 *     (no save/resume, no carry-forward of free spins, no persisted
 *     respin counters). At boot, this block clears localStorage +
 *     sessionStorage entries that match SGF's known prefixes
 *     (`__SLOT_`, `__FS_`, `__HW_`, etc.) and emits onGameStateCleared
 *     so audit-trail blocks can record the clear.
 *
 *     W58.J-DE.3 dopuna: IndexedDB databases that match the same prefix
 *     family are also wiped via the async indexedDB.databases() +
 *     deleteDatabase path (with try/catch fallback for older browsers
 *     that don't expose .databases()). A separate event
 *     onIndexedDbCleared is fired AFTER the Promise chain resolves so
 *     cert-harness counts the IDB sweep distinctly from the
 *     localStorage / sessionStorage sweep.
 *
 * §11(3) Bonus-buy ban
 *     Already enforced by bonusBuy.mjs BONUS_BUY_BANNED_JURISDICTIONS
 *     (W57.A4). This block does NOT duplicate that gate.
 *
 * Math gate
 *   ────────
 *   Block does NOT compute RTP / volatility / hit frequency. The 5-second
 *   spin floor is a presentation-layer cadence enforcement, not a math
 *   parameter. RTP integration with the spin floor is OUT-OF-SCOPE per
 *   `rule_no_math_unless_asked`.
 *
 * Public API
 *   export const STATE_CLEAR_PREFIXES
 *   export const DE_MIN_SPIN_MS_DEFAULT
 *   export function defaultConfig(): GermanyComplianceGateConfig
 *   export function resolveConfig(model?: object): GermanyComplianceGateConfig
 *   export function emitGermanyComplianceGateCSS(cfg): string  (no-op, returns '')
 *   export function emitGermanyComplianceGateRuntime(cfg): string
 *
 * Lifecycle
 *   • Boot-time only. Listens to no HookBus events. Mounts no DOM. Sets
 *     a window flag + clears storage entries + emits 2 audit events.
 *   • Emit-only block — registered in LEGO HOOK_REGISTRATION_OPT_OUT.
 *
 * HookBus events (sole emitter contract)
 *   • onMinSpinPaceEnforced  payload: { jurisdiction, minSpinMs, rule }
 *   • onGameStateCleared     payload: { jurisdiction, prefixesCleared, count, rule }
 *   • onIndexedDbCleared     payload: { jurisdiction, prefixesCleared, count, rule }
 *                                       (W58.J-DE.3 §6e IDB sweep)
 *
 * Accessibility
 *   Block is invisible to the player (boot-time DOM-free side effect).
 *   No ARIA surface.
 *
 * GDD knobs (under `model.germanyComplianceGate`)
 *   • enabled        bool   (default false — opt-in per GDD)
 *   • jurisdiction   string (3-key precedence chain w/ regulator + RG)
 *   • minSpinMs      int    (default 5000 — §11(2) floor)
 *   • clearOnBoot    bool   (default true when DE — §6e enforcement)
 *   • prefixes       string[] (default storage prefixes to clear)
 */

/* W59.H1 — Central jurisdiction precedence resolver. */
import { resolveJurisdiction } from './jurisdictionGate.mjs';

export const DE_MIN_SPIN_MS_DEFAULT = 5000;

/* SGF storage prefixes — every key that starts with one of these on
 * localStorage / sessionStorage is cleared at boot when §6e applies. */
export const STATE_CLEAR_PREFIXES = Object.freeze([
  '__SLOT_',
  '__FS_',
  '__HW_',
  '__BB_',
  '__RC_',
  '__BG_',
]);

const GLUESTV_JURISDICTIONS = Object.freeze(['DE']);

const DEFAULTS = Object.freeze({
  enabled:      false,
  jurisdiction: null,
  minSpinMs:    DE_MIN_SPIN_MS_DEFAULT,
  clearOnBoot:  true,
  prefixes:     STATE_CLEAR_PREFIXES,
});

const MIN_SPIN_MS_BOUNDS = Object.freeze([1000, 30000]); /* sanity clamp */

export function defaultConfig() {
  return {
    ...DEFAULTS,
    prefixes: STATE_CLEAR_PREFIXES.slice(), /* fresh array per call */
  };
}

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

function sanitizePrefixArray(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  for (const p of arr) {
    if (typeof p !== 'string') continue;
    const trimmed = p.trim();
    if (!trimmed) continue;
    if (trimmed.length > 32) continue; /* sanity */
    /* alphanumeric + underscore only (CSS / JS safe prefix tokens) */
    if (!/^[A-Za-z0-9_]+$/.test(trimmed)) continue;
    out.push(trimmed);
  }
  return out.length > 0 ? out : null;
}

export function resolveConfig(model) {
  const cfg = defaultConfig();
  const src = (model && model.germanyComplianceGate) || {};

  /* W59.H1 — Central jurisdiction precedence resolver. Same semantics:
   * regulator.profile > RG > germanyComplianceGate.jurisdiction. */
  const jurisdiction = resolveJurisdiction(model, { fallbackKey: 'germanyComplianceGate.jurisdiction' });
  cfg.jurisdiction = jurisdiction;

  /* Enabled iff GlüStV jurisdiction matched OR explicit opt-in via GDD. */
  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  if (jurisdiction && GLUESTV_JURISDICTIONS.indexOf(jurisdiction) !== -1) {
    cfg.enabled = true;
  }

  /* §11(2) spin pace floor — clamp into sanity range, default 5000 ms. */
  const ms = clampInt(src.minSpinMs, MIN_SPIN_MS_BOUNDS[0], MIN_SPIN_MS_BOUNDS[1]);
  if (ms !== null) cfg.minSpinMs = ms;

  if (typeof src.clearOnBoot === 'boolean') cfg.clearOnBoot = src.clearOnBoot;

  const px = sanitizePrefixArray(src.prefixes);
  if (px) cfg.prefixes = px;

  return cfg;
}

/* ─── CSS emit (no-op) ──────────────────────────────────────────────────── */

export function emitGermanyComplianceGateCSS(_cfg) {
  /* This block has no visual surface — all enforcement is window-flag /
   * storage-side-effect / HookBus emit. Returning '' keeps the
   * orchestrator clean while preserving the standard cfg-driven API. */
  return '';
}

/* ─── Runtime emit (boot-time only) ──────────────────────────────────────── */

export function emitGermanyComplianceGateRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  const jurJSON = JSON.stringify(c.jurisdiction || '');
  const prefixesJSON = JSON.stringify(c.prefixes);
  const minMs = c.minSpinMs;
  const clearOnBoot = c.clearOnBoot;

  return `
/* germanyComplianceGate runtime — §11(2) spin pace + §6e state clear */
(function germanyComplianceGateInit() {
  var JURISDICTION = ${jurJSON};
  var MIN_SPIN_MS = ${minMs};
  var CLEAR_ON_BOOT = ${clearOnBoot};
  var PREFIXES = ${prefixesJSON};

  /* §11(2) — Set the window-level spin-pace floor flag. Downstream
   * consumers (autoplay tick, slamStop, turboMode dispatch) read this
   * flag and refuse to dispatch a new spin sooner than the floor. */
  if (typeof window !== 'undefined') {
    window.__DE_MIN_SPIN_MS__ = MIN_SPIN_MS;
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onMinSpinPaceEnforced', {
          jurisdiction: JURISDICTION,
          minSpinMs: MIN_SPIN_MS,
          rule: 'DE-GluStV-2021-§11(2)',
        });
      } catch (_) {}
    }
  }

  /* §6e — Clear any persisted session state matching SGF prefixes.
   * Safe try/catch around each storage access (private-mode browsers
   * throw on localStorage / sessionStorage). */
  if (CLEAR_ON_BOOT && typeof window !== 'undefined') {
    function _clearPrefixedStorage(storage) {
      var cleared = 0;
      if (!storage || typeof storage.length !== 'number') return cleared;
      var toRemove = [];
      for (var i = 0; i < storage.length; i++) {
        var key = storage.key(i);
        if (typeof key !== 'string') continue;
        for (var j = 0; j < PREFIXES.length; j++) {
          if (key.indexOf(PREFIXES[j]) === 0) {
            toRemove.push(key);
            break;
          }
        }
      }
      for (var k = 0; k < toRemove.length; k++) {
        try { storage.removeItem(toRemove[k]); cleared++; } catch (_) {}
      }
      return cleared;
    }
    var totalCleared = 0;
    try { totalCleared += _clearPrefixedStorage(window.localStorage); } catch (_) {}
    try { totalCleared += _clearPrefixedStorage(window.sessionStorage); } catch (_) {}
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onGameStateCleared', {
          jurisdiction: JURISDICTION,
          prefixesCleared: PREFIXES.slice(),
          count: totalCleared,
          rule: 'DE-GluStV-2021-§6e',
        });
      } catch (_) {}
    }

    /* W58.J-DE.3 — §6e dopuna: IndexedDB databases that match the SGF
     * prefix family must also be wiped. Modern browsers expose
     * indexedDB.databases() which returns Promise<[{name, version}]>.
     * Older browsers (older Safari, Firefox < 126) don't expose it; we
     * fall back to attempting deleteDatabase on each known prefix-name
     * (best-effort: deleteDatabase on a non-existent DB is a no-op).
     *
     * The whole IDB branch is fully async; we DO NOT await the result
     * (boot-time gate must never block the rest of the page). The
     * onIndexedDbCleared audit emit fires only AFTER the Promise chain
     * resolves, so cert-harness sees the accurate count. */
    if (typeof window.indexedDB !== 'undefined') {
      var _idbPrefixMatches = function (name) {
        if (typeof name !== 'string') return false;
        for (var i = 0; i < PREFIXES.length; i++) {
          if (name.indexOf(PREFIXES[i]) === 0) return true;
        }
        return false;
      };
      var _idbDelete = function (name) {
        return new Promise(function (resolve) {
          try {
            var req = window.indexedDB.deleteDatabase(name);
            req.onsuccess = function () { resolve(true); };
            req.onerror   = function () { resolve(false); };
            req.onblocked = function () { resolve(false); };
          } catch (_) { resolve(false); }
        });
      };
      var _idbFinalize = function (cleared) {
        if (window.HookBus && typeof window.HookBus.emit === 'function') {
          try {
            window.HookBus.emit('onIndexedDbCleared', {
              jurisdiction: JURISDICTION,
              prefixesCleared: PREFIXES.slice(),
              count: cleared,
              rule: 'DE-GluStV-2021-§6e',
            });
          } catch (_) {}
        }
      };
      var _idbAttempt = function () {
        if (typeof window.indexedDB.databases === 'function') {
          /* Modern path: enumerate then delete matches. */
          try {
            var listP = window.indexedDB.databases();
            if (listP && typeof listP.then === 'function') {
              listP.then(function (list) {
                if (!Array.isArray(list) || list.length === 0) {
                  _idbFinalize(0);
                  return;
                }
                var matches = [];
                for (var i = 0; i < list.length; i++) {
                  if (list[i] && _idbPrefixMatches(list[i].name)) {
                    matches.push(list[i].name);
                  }
                }
                if (matches.length === 0) {
                  _idbFinalize(0);
                  return;
                }
                var deletions = [];
                for (var k = 0; k < matches.length; k++) {
                  deletions.push(_idbDelete(matches[k]));
                }
                Promise.all(deletions).then(function (results) {
                  var ok = 0;
                  for (var j = 0; j < results.length; j++) { if (results[j] === true) ok++; }
                  _idbFinalize(ok);
                }, function () { _idbFinalize(0); });
              }, function () {
                /* databases() rejected — fall back to prefix-name attempts. */
                _idbAttemptFallback();
              });
              return;
            }
          } catch (_) {}
        }
        _idbAttemptFallback();
      };
      var _idbAttemptFallback = function () {
        /* Best-effort path for browsers without .databases(). Attempt
         * deleteDatabase on each SGF prefix as a literal DB name. A no-
         * op for non-existent DBs; counts only successful deletions. */
        var deletions = [];
        for (var i = 0; i < PREFIXES.length; i++) {
          deletions.push(_idbDelete(PREFIXES[i]));
        }
        Promise.all(deletions).then(function (results) {
          var ok = 0;
          for (var j = 0; j < results.length; j++) { if (results[j] === true) ok++; }
          _idbFinalize(ok);
        }, function () { _idbFinalize(0); });
      };
      _idbAttempt();
    }
  }
})();
`;
}
