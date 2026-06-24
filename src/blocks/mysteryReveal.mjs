/**
 * src/blocks/mysteryReveal.mjs
 *
 * Wave W47.S19 — B65 · mysteryReveal block.
 *
 * Event-presenter sibling of src/blocks/mysterySymbol.mjs. The existing
 * mysterySymbol block owns the STATE (flag cells as mystery, flip-reveal
 * CSS transform, halo pulse). This block owns the EVENT LIFECYCLE +
 * optional banner cue so downstream subscribers (audio, particle bursts,
 * accessibility announcements, telemetry) can sync to the exact reveal
 * moment.
 *
 * Distinct from mysterySymbol.mjs — that block paints "?" cells and
 * flips them into a picked face. This block:
 *   • Reads __MYSTERY_REVEAL__ window state set by mysterySymbol on each
 *     spin's reveal pass.
 *   • Emits onMysteryRevealStart at flip-begin and onMysteryRevealEnd
 *     at flip-complete (paired emits — single source of truth).
 *   • Optionally renders a centered "MYSTERY: {SYM}" banner overlay for
 *     a configurable duration as a screen-reader-friendly cue.
 *
 * Industry baseline: mystery-reveal is a load-bearing emotional beat in
 * any slot using "?" tiles (e.g. mystery-stack, mystery-wild). The cue
 * needs to be observable from any side block without each block
 * re-implementing detection logic.
 *
 * GDD knobs (consumed from model.mysteryReveal):
 *   enabled        boolean                                       (default false)
 *   showBanner     boolean — render "MYSTERY: {SYM}" overlay     (default true)
 *   delayMs        number — pause before emit/banner show         (default 320)
 *   durationMs    number — banner total visible duration          (default 900)
 *   autoCloseMs    number — extra hold after duration             (default 200)
 *   bannerTemplate string — accepts {SYM} (picked symbol id)
 *                  and {N} (mystery cell count)                  (default 'MYSTERY: {SYM}')
 *   haloColor      'r,g,b' — banner halo tint                    (default '180,120,255')
 *   fgColor        'r,g,b' — banner text color                   (default '255,255,255')
 *   bgAlpha        number — banner pill background alpha [0,1]   (default 0.6)
 *   position       'top' | 'center' | 'bottom'                   (default 'center')
 *   haptic         boolean — vibrate on reveal                   (default false)
 *
 * Public API:
 *   defaultConfig()                          → safe defaults
 *   resolveConfig(model)                     → merge + clamp
 *   emitMysteryRevealCSS(cfg)                → CSS string
 *   emitMysteryRevealMarkup(cfg)             → HTML string
 *   emitMysteryRevealRuntime(cfg)            → IIFE runtime
 *
 * Lifecycle (Runtime):
 *   listens : onSpinResult — inspects window.__MYSTERY_REVEAL__ (set by
 *             mysterySymbol) for the picked symbol id + cell count.
 *   emits   : onMysteryRevealStart { symbol, count, source }
 *             onMysteryRevealEnd   { symbol, count, reason }
 *
 * Accessibility:
 *   • role="status" + aria-live="polite" + dynamic aria-label.
 *   • prefers-reduced-motion: hard motion-kill (animation: none, single
 *     opacity fade-in/out).
 *   • Apple HIG 11px font-size floor.
 *
 * Performance budget:
 *   • DOM: 1 host + 1 label (≤2 nodes).
 *   • CSS animations on transform + opacity only (GPU).
 *   • No JS frame loop, no canvas.
 *   • Re-entrant: revealToken cancels prior in-flight banner cleanly.
 *
 * Auto-enable: when model.mysterySymbol.enabled is truthy OR a feature
 * kind of 'mystery_symbol' / 'mystery_reveal' is declared. Stays opt-out
 * via explicit enabled:false.
 *
 * Vendor-neutral. No game / studio strings.
 */

const POSITIONS = Object.freeze(['top', 'center', 'bottom']);

const DEFAULTS = Object.freeze({
  enabled:        false,
  showBanner:     true,
  delayMs:        320,
  durationMs:     900,
  autoCloseMs:    200,
  bannerTemplate: 'MYSTERY: {SYM}',
  haloColor:      '180,120,255',
  fgColor:        '255,255,255',
  bgAlpha:        0.6,
  position:       'center',
  haptic:         false,
});

const BOUNDS = Object.freeze({
  delayMs:     { min: 0,   max: 3000, integer: true  },
  durationMs:  { min: 200, max: 6000, integer: true  },
  autoCloseMs: { min: 0,   max: 4000, integer: true  },
});

export function defaultConfig() {
  return Object.freeze({ ...DEFAULTS });
}

function isValidRgb(s) {
  if (typeof s !== 'string') return false;
  const parts = s.split(',').map(p => p.trim());
  if (parts.length !== 3) return false;
  return parts.every(p => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.mysteryReveal) || {};

  if (src.enabled != null) cfg.enabled = !!src.enabled;

  if (typeof src.position === 'string' && POSITIONS.includes(src.position)) {
    cfg.position = src.position;
  }
  if (typeof src.showBanner === 'boolean') cfg.showBanner = src.showBanner;
  if (typeof src.haptic === 'boolean')     cfg.haptic     = src.haptic;
  if (isValidRgb(src.haloColor)) cfg.haloColor = src.haloColor;
  if (isValidRgb(src.fgColor))   cfg.fgColor   = src.fgColor;
  if (typeof src.bannerTemplate === 'string' && src.bannerTemplate.length > 0 && src.bannerTemplate.length <= 48) {
    cfg.bannerTemplate = src.bannerTemplate;
  }
  if (typeof src.bgAlpha === 'number' && Number.isFinite(src.bgAlpha) && src.bgAlpha >= 0 && src.bgAlpha <= 1) {
    cfg.bgAlpha = src.bgAlpha;
  }

  for (const key of Object.keys(BOUNDS)) {
    const v = src[key];
    const b = BOUNDS[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= b.min && v <= b.max) {
      cfg[key] = b.integer ? Math.floor(v) : v;
    }
  }

  /* Auto-enable: tied to mysterySymbol state owner so a single GDD knob
     (model.mysterySymbol) automatically lights up both sibling blocks.
     Feature-kind paths catch GDDs that declare the feature without a
     mysterySymbol config block. */
  const features = Array.isArray(model.features) ? model.features : [];
  const hasMysteryKind = features.some(f =>
    typeof f === 'object' && f && (
      f.kind === 'mystery_symbol' ||
      f.kind === 'mystery_reveal'
    )
  );
  const hasMysterySymbol = !!(model.mysterySymbol && model.mysterySymbol.enabled);

  if (hasMysteryKind || hasMysterySymbol) {
    if (src.enabled !== false) cfg.enabled = true;
  }

  return cfg;
}

function positionStyle(pos) {
  switch (pos) {
    case 'top':    return 'top: 12%; transform: translate(-50%, 0);';
    case 'bottom': return 'bottom: 16%; transform: translate(-50%, 0);';
    case 'center':
    default:       return 'top: 50%;  transform: translate(-50%, -50%);';
  }
}

export function emitMysteryRevealCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── mysteryReveal block — emitted by src/blocks/mysteryReveal.mjs ─── */
.mystery-reveal {
  position: fixed;
  left: 50%;
  ${positionStyle(cfg.position)}
  z-index: 91;
  pointer-events: none;
  opacity: 0;
  display: none;
}
.mystery-reveal[data-active="true"] { display: block; }
.mystery-reveal .mr-label {
  display: inline-block;
  padding: 8px 18px;
  border-radius: 999px;
  background: rgba(0, 0, 0, ${cfg.bgAlpha});
  color: rgba(${cfg.fgColor}, 1);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.75);
  box-shadow:
    0 0 0 2px rgba(${cfg.haloColor}, 0.7),
    0 0 18px rgba(${cfg.haloColor}, 0.55),
    0 0 36px rgba(${cfg.haloColor}, 0.35);
}
.mystery-reveal[data-active="true"] {
  animation: mrShow ${cfg.durationMs}ms cubic-bezier(.22, .61, .36, 1) forwards;
}
@keyframes mrShow {
  0%   { opacity: 0; transform: translate(-50%, 6px) scale(0.92); }
  15%  { opacity: 1; transform: translate(-50%, 0)   scale(1.05); }
  25%  { opacity: 1; transform: translate(-50%, 0)   scale(1); }
  82%  { opacity: 1; transform: translate(-50%, 0)   scale(1); }
  100% { opacity: 0; transform: translate(-50%, -4px) scale(0.98); }
}
@media (prefers-reduced-motion: reduce) {
  /* Hard motion kill — no scale, no translate.
     Pure opacity fade preserves the cue without vestibular load. */
  .mystery-reveal[data-active="true"] {
    animation: none;
    transform: translate(-50%, 0);
    transition: opacity 220ms ease-out;
    opacity: 1;
  }
  .mystery-reveal[data-active="false"] {
    opacity: 0;
  }
}
@media (max-width: 480px) {
  .mystery-reveal .mr-label {
    font-size: 12px;
    padding: 6px 14px;
  }
}
`;
}

export function emitMysteryRevealMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="mysteryReveal" class="mystery-reveal" data-active="false" role="status" aria-live="polite" aria-label="Mystery reveal" aria-hidden="true">
    <span class="mr-label">&nbsp;</span>
  </div>`;
}

export function emitMysteryRevealRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `/* ─── mysteryReveal runtime — emitted by src/blocks/mysteryReveal.mjs ─── */
(function _mysteryRevealRuntime() {
  var MR_TEMPLATE     = ${JSON.stringify(cfg.bannerTemplate)};
  var MR_SHOW_BANNER  = ${cfg.showBanner ? 'true' : 'false'};
  var MR_DELAY_MS     = ${cfg.delayMs};
  var MR_DURATION_MS  = ${cfg.durationMs};
  var MR_AUTOCLOSE_MS = ${cfg.autoCloseMs};
  var MR_HAPTIC       = ${cfg.haptic ? 'true' : 'false'};
  var MR_TOKEN        = 0;
  var MR_TIMERS       = [];

  function _mrHost() {
    return (typeof document !== 'undefined') ? document.getElementById('mysteryReveal') : null;
  }
  function _mrClearTimers() {
    for (var i = 0; i < MR_TIMERS.length; i++) {
      try { clearTimeout(MR_TIMERS[i]); } catch (_) {}
    }
    MR_TIMERS = [];
  }
  function _mrLabelFor(symbol, count) {
    return String(MR_TEMPLATE)
      .replace('{SYM}', String(symbol == null ? '' : symbol).slice(0, 16))
      .replace('{N}',   String(Number.isFinite(count) ? count : 0));
  }

  /* Public entry — also accepts manual { symbol, count } payload for
     dev / test invocation. Re-entrant: each call mints a new token. */
  function _mrReveal(payload) {
    var token = ++MR_TOKEN;
    _mrClearTimers();
    var symbol = payload && (payload.symbol || payload.symbolId) || null;
    var count  = payload && Number(payload.count != null ? payload.count : payload.n) || 0;

    /* Defer to delayMs so the banner times with the cell-flip start. */
    MR_TIMERS.push(setTimeout(function () {
      if (token !== MR_TOKEN) return;
      if (typeof HookBus !== 'undefined') {
        try { HookBus.emit('onMysteryRevealStart', { symbol: symbol, count: count, source: payload && payload.source || 'auto' }); } catch (_) {}
      }
      if (MR_HAPTIC && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(25); } catch (_) {}
      }
      if (MR_SHOW_BANNER) {
        var host = _mrHost();
        if (host) {
          var labelEl = host.querySelector('.mr-label');
          if (labelEl) labelEl.textContent = _mrLabelFor(symbol, count);
          host.setAttribute('aria-label',
            'Mystery reveal: ' + (count || 0) + ' cell(s) revealed as ' + (symbol || 'symbol'));
          host.setAttribute('aria-hidden', 'false');
          host.dataset.active = 'true';
        }
      }
      /* End emit + close fires after duration + autoClose hold. */
      MR_TIMERS.push(setTimeout(function () {
        if (token !== MR_TOKEN) return;
        var host = _mrHost();
        if (host) {
          host.dataset.active = 'false';
          host.setAttribute('aria-hidden', 'true');
        }
        if (typeof HookBus !== 'undefined') {
          try { HookBus.emit('onMysteryRevealEnd', { symbol: symbol, count: count, reason: 'auto' }); } catch (_) {}
        }
      }, MR_DURATION_MS + MR_AUTOCLOSE_MS));
    }, MR_DELAY_MS));
  }

  if (typeof window !== 'undefined') {
    window.fireMysteryReveal = _mrReveal;
  }

  /* Bind to onSpinResult — when mysterySymbol resolves cells, it sets
     window.__MYSTERY_REVEAL__ to { symbol, count } before the spin
     result emit fires. We read that snapshot and react. Multiple
     fallbacks accepted for payload-shape robustness. */
  if (typeof HookBus !== 'undefined') {
    HookBus.on('onSpinResult', function (evt) {
      var snap = (typeof window !== 'undefined' && window.__MYSTERY_REVEAL__) || null;
      if (!snap && evt && evt.mystery) snap = evt.mystery;
      if (!snap) return;
      var sym = snap.symbol || snap.symbolId || null;
      var n   = Number(snap.count != null ? snap.count : snap.n);
      if (!sym || !Number.isFinite(n) || n <= 0) return;
      _mrReveal({ symbol: sym, count: n, source: 'onSpinResult' });
      /* Consume the snapshot so a stale value doesn't re-fire on a
         spin that produced no mystery cells. */
      try { window.__MYSTERY_REVEAL__ = null; } catch (_) {}
    });
  }
})();
`;
}
