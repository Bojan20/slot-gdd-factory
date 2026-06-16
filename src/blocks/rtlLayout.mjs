/**
 * src/blocks/rtlLayout.mjs
 *
 * Wave A5 — Right-to-left (RTL) layout support.
 *
 * Industry pattern: slot UIs ship to MENA / Israel / Iran / Pakistan
 * markets need bidirectional layout. Mirror the surrounding chrome
 * (HUD chip order, button rails, modal alignment) WITHOUT mirroring:
 *   • the reel grid itself (reel 1 stays semantically first)
 *   • numerics (balance, bet, win, multiplier, jackpot values)
 *
 * The block is a single coordinator:
 *   • detects RTL locale (window.__SLOT_LOCALE__ matches RTL list)
 *   • sets <html dir="rtl"> at runtime
 *   • emits CSS that:
 *       (a) isolates all numeric value containers in LTR + unicode-bidi
 *       (b) flips logical margins for hub / chip rails when html[dir=rtl]
 *       (c) preserves the reel grid order (it's a CSS grid, semantic order)
 *   • re-applies on settings panel locale change (HookBus event)
 *
 * RTL detection: based on language subtag, not country.
 *   Arabic (ar), Hebrew (he), Persian/Farsi (fa), Urdu (ur),
 *   Pashto (ps), Sindhi (sd), Divehi (dv), N'Ko (nqo), Yiddish (yi),
 *   Kurdish-Sorani (ckb), Aramaic-Syriac (syr).
 *
 * GDD config (consumed from `model.rtlLayout`):
 *   {
 *     enabled:           boolean (default true) — set false to disable globally
 *     forceDir:          'rtl' | 'ltr' | null  — override auto-detection
 *     numericSelectors:  string[] — CSS selectors that should stay LTR
 *                                    (defaults to canonical slot value classes)
 *     rtlLocaleList:     string[] — additional locale prefixes counted as RTL
 *   }
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitRtlLayoutCSS(cfg)     → CSS string
 *   emitRtlLayoutRuntime(cfg) → runtime JS string
 *
 * Runtime contract:
 *   window.__SLOT_RTL_ACTIVE__ → boolean (live mirror of dir state)
 *   window.HookBus emits 'onDirChanged' { dir, source } on change
 */

const DEFAULT_RTL_PREFIXES = Object.freeze([
  'ar', 'he', 'fa', 'ur', 'ps', 'sd', 'dv', 'nqo', 'yi', 'ckb', 'syr',
]);

/* Canonical class names that hold numeric values in slot blocks.
 * Numerics must NEVER flip — they read left-to-right even in RTL UIs.
 * Includes the universal opt-in attribute `[data-numeric]` for new
 * blocks that follow convention. */
const DEFAULT_NUMERIC_SELECTORS = Object.freeze([
  '.balance-hud__value',
  '.win-rollup',
  '.win-rollup__value',
  '.bet-display',
  '.bet-selector__value',
  '.jackpot-value',
  '.multiplier-ladder__value',
  '.energy-meter__value',
  '.sticky-meter__count',
  '.fs-progress-bar__count',
  '.history-log__amount',
  '[data-numeric]',
]);

export function defaultConfig() {
  return {
    enabled: true,
    forceDir: null,
    numericSelectors: DEFAULT_NUMERIC_SELECTORS.slice(),
    rtlLocaleList: DEFAULT_RTL_PREFIXES.slice(),
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = (model && model.rtlLayout) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (m.forceDir === 'rtl' || m.forceDir === 'ltr') cfg.forceDir = m.forceDir;

  if (Array.isArray(m.numericSelectors) && m.numericSelectors.length > 0) {
    const extra = m.numericSelectors
      .filter(s => typeof s === 'string' && s.length > 0 && s.length < 200);
    if (extra.length > 0) {
      cfg.numericSelectors = Array.from(new Set([...cfg.numericSelectors, ...extra]));
    }
  }

  if (Array.isArray(m.rtlLocaleList) && m.rtlLocaleList.length > 0) {
    const extra = m.rtlLocaleList
      .filter(s => typeof s === 'string' && /^[a-z]{2,3}$/i.test(s))
      .map(s => s.toLowerCase());
    if (extra.length > 0) {
      cfg.rtlLocaleList = Array.from(new Set([...cfg.rtlLocaleList, ...extra]));
    }
  }

  return cfg;
}

export function emitRtlLayoutCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ rtlLayout: cfg });
  if (!c.enabled) return '';

  const numericRule = c.numericSelectors.join(',\n  ');

  return `
/* ── rtlLayout BLOCK (Wave A5) — emitted by src/blocks/rtlLayout.mjs ──
   Bidirectional layout: mirror chrome via html[dir=rtl]; never flip
   the reel grid; isolate numerics in LTR regardless of direction. */

/* Numeric isolation — values stay LTR even when surrounding text is RTL.
   unicode-bidi:isolate creates an independent BiDi context, so RTL
   neighbors don't reorder the digits / decimal points / currency. */
${numericRule} {
  direction: ltr;
  unicode-bidi: isolate;
}

/* html[dir=rtl] universal mirrors. Use logical CSS properties (start/end)
   so the chrome flows naturally; only override anchored positions. */
html[dir="rtl"] {
  /* Reel grid order preserved — grid items keep semantic order. */
  /* Hub chip rail mirrors via row-reverse */
}

html[dir="rtl"] .hub {
  flex-direction: row-reverse;
}

html[dir="rtl"] .chip-rail,
html[dir="rtl"] .force-panel,
html[dir="rtl"] .utility-rail {
  flex-direction: row-reverse;
}

/* Modal / dialog content keeps LTR for in-play overlays that carry
   numerics. Text wrapper inside flips via data attribute. */
html[dir="rtl"] [data-rtl-content] {
  text-align: right;
}

html[dir="rtl"] [data-rtl-content][data-numeric-block] {
  text-align: left;
  direction: ltr;
}

/* prefers-reduced-motion is already gated elsewhere; rtl shift is
   an instant attribute change — no animation to suppress. */
`;
}

export function emitRtlLayoutRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ rtlLayout: cfg });
  if (!c.enabled) {
    return `
  /* ── rtlLayout BLOCK (disabled) ──────────────────────────────────── */
  window.__SLOT_RTL_ACTIVE__ = false;
`;
  }

  return `
  /* ── rtlLayout BLOCK — emitted by src/blocks/rtlLayout.mjs
     Detects RTL locale, sets html[dir=rtl] / 'ltr', emits
     onDirChanged HookBus event. */
  (function () {
    var RTL_PREFIXES = ${JSON.stringify(c.rtlLocaleList)};
    var FORCE_DIR = ${JSON.stringify(c.forceDir)};

    function _isRtlLocale(loc) {
      if (!loc || typeof loc !== 'string') return false;
      var prefix = String(loc).toLowerCase().split(/[-_]/)[0];
      for (var i = 0; i < RTL_PREFIXES.length; i++) {
        if (prefix === RTL_PREFIXES[i]) return true;
      }
      return false;
    }

    function _resolveDir() {
      if (FORCE_DIR === 'rtl' || FORCE_DIR === 'ltr') return FORCE_DIR;
      var loc = (typeof window !== 'undefined' && window.__SLOT_LOCALE__) || '';
      return _isRtlLocale(loc) ? 'rtl' : 'ltr';
    }

    function _applyDir(reason) {
      var dir = _resolveDir();
      if (!document || !document.documentElement) return;
      var prev = document.documentElement.getAttribute('dir') || 'ltr';
      if (prev === dir) return;
      document.documentElement.setAttribute('dir', dir);
      window.__SLOT_RTL_ACTIVE__ = (dir === 'rtl');
      try {
        if (window.HookBus && typeof window.HookBus.emit === 'function') {
          window.HookBus.emit('onDirChanged', {
            dir: dir, prev: prev, source: reason || 'auto',
          });
        }
      } catch (_) {}
    }

    /* Initial apply at boot — runs synchronously so first paint is
     * correct (no flash of LTR before RTL flip). */
    _applyDir('init');

    /* Re-apply when settingsPanel emits locale change. */
    if (window.HookBus && typeof window.HookBus.on === 'function') {
      window.HookBus.on('onLocaleChanged', function (p) {
        _applyDir('localeChange:' + (p && p.value));
      });
    }

    /* Re-apply on storage event (multi-tab sync — settings persisted). */
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('storage', function (e) {
        if (e && typeof e.key === 'string' && e.key.indexOf('locale') >= 0) {
          _applyDir('storage');
        }
      });
    }
  })();
`;
}
