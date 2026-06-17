/**
 * src/blocks/collectableSymbol.mjs
 *
 * Wave H19 — Collectable Symbol (industry-standard symbol-collector meter).
 *
 * Industry baseline (vendor-neutral):
 *   Many modern slots track a SPECIFIC symbol (typically a coin / orb / icon)
 *   across spins and increment a HUD meter every time that symbol lands.
 *   When the meter crosses a configurable threshold (e.g. 6 coins), the
 *   block fires an event so the engine can grant a bonus (FS award, cash
 *   payout, multiplier upgrade). The reset condition is GDD-configurable:
 *   per-round, per-FS, on-trigger, or never (lifetime session).
 *
 *   This block is a PURE PRESENTER:
 *     - Scans the grid on postSpin / onTumbleStep / onFsSpinResult for cells
 *       whose `data-sym` matches the configured collectable symbol.
 *     - Increments the meter, paints the chip, and emits per-symbol
 *       onSymbolCollected. Crossing the threshold emits onCollectionFull.
 *     - Math (award value, threshold ladder) is OUT OF SCOPE — engine reads
 *       the event payload and decides reward.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitCollectableSymbolCSS(cfg)
 *   emitCollectableSymbolMarkup(cfg)
 *   emitCollectableSymbolRuntime(cfg)
 *
 * Lifecycle:
 *   subscribes:
 *     postSpin           - scan + bump meter for base game.
 *     onTumbleStep       - scan after each cascade refill.
 *     onFsSpinResult     - scan during FS spins.
 *     preSpin            - if resetOn = 'spin', clear meter; emit reset.
 *     onFsTrigger        - if resetOn = 'fsTrigger', clear meter.
 *     onFsEnd            - if resetOn = 'fsEnd', clear meter.
 *   emits:
 *     onSymbolCollected  { symbol, count, threshold, delta, source }
 *     onCollectionFull   { symbol, count, threshold, source }
 *     onCollectionReset  { symbol, reason, source }
 *
 * a11y:
 *   - HUD chip: role="status", aria-live="polite", aria-label="<sym> collected N of M".
 *   - prefers-reduced-motion gate disables increment pulse.
 *
 * Performance budget:
 *   - 1 fixed HUD chip, mounted once.
 *   - O(rows * cols) DOM scan per spin/tumble; symbol comparison is O(1).
 *   - 0 timers when not animating.
 *
 * GDD keys (model.collectableSymbol):
 *   enabled, symbol, threshold, resetOn ('spin'|'fsTrigger'|'fsEnd'|'never'),
 *   position, badgeBg, badgeColor, fontSizePx, zIndex, labelTemplate, pulseMs
 *
 * Vendor-neutral. No game / studio strings.
 *
 * @module collectableSymbol
 */

const POSITIONS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
const RESETS = new Set(['spin', 'fsTrigger', 'fsEnd', 'never']);
const BOUNDS = Object.freeze({
  threshold:   [1, 999],
  fontSizePx:  [11, 28],
  zIndex:      [10, 99],
  pulseMs:     [80, 1500],
});

function _clamp(v, [lo, hi], fb) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
}
function _safe(v, max, fb) {
  if (typeof v !== 'string') return fb;
  const s = v.replace(/[<>"'`]/g, '').slice(0, max);
  return s.length ? s : fb;
}

export function defaultConfig() {
  return Object.freeze({
    enabled:       false,
    symbol:        'COIN',
    threshold:     6,
    resetOn:       'fsEnd',
    position:      'bottom-right',
    badgeBg:       'rgba(0,0,0,0.65)',
    badgeColor:    '#ffd84d',
    activeBg:      '#ffd84d',
    activeColor:   '#03110a',
    labelTemplate: '{S} {N}/{M}',
    fontSizePx:    13,
    pulseMs:       380,
    zIndex:        40,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.collectableSymbol) || {};
  const auto = !!model.collectableSymbol;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.threshold  = _clamp(m.threshold,  BOUNDS.threshold,  cfg.threshold);
  cfg.fontSizePx = _clamp(m.fontSizePx, BOUNDS.fontSizePx, cfg.fontSizePx);
  cfg.zIndex     = _clamp(m.zIndex,     BOUNDS.zIndex,     cfg.zIndex);
  cfg.pulseMs    = _clamp(m.pulseMs,    BOUNDS.pulseMs,    cfg.pulseMs);

  if (typeof m.position === 'string' && POSITIONS.has(m.position)) cfg.position = m.position;
  if (typeof m.resetOn  === 'string' && RESETS.has(m.resetOn))     cfg.resetOn  = m.resetOn;

  cfg.symbol       = _safe(m.symbol,       12, cfg.symbol);
  cfg.badgeBg      = _safe(m.badgeBg,      64, cfg.badgeBg);
  cfg.badgeColor   = _safe(m.badgeColor,   32, cfg.badgeColor);
  cfg.activeBg     = _safe(m.activeBg,     48, cfg.activeBg);
  cfg.activeColor  = _safe(m.activeColor,  32, cfg.activeColor);
  if (typeof m.labelTemplate === 'string' && m.labelTemplate.length > 0 && m.labelTemplate.length <= 48) {
    cfg.labelTemplate = _safe(m.labelTemplate, 48, cfg.labelTemplate);
  }
  return cfg;
}

function _posStyle(pos) {
  const v  = 'calc(max(8px, env(safe-area-inset-top, 0px) + 8px))';
  const bV = 'calc(max(8px, env(safe-area-inset-bottom, 0px) + 8px))';
  const h  = 'calc(max(8px, env(safe-area-inset-left, 0px) + 8px))';
  const rH = 'calc(max(8px, env(safe-area-inset-right, 0px) + 8px))';
  switch (pos) {
    case 'top-left':     return `top: ${v}; left: ${h};`;
    case 'top-right':    return `top: ${v}; right: ${rH};`;
    case 'bottom-left':  return `bottom: ${bV}; left: ${h};`;
    case 'bottom-right':
    default:             return `bottom: ${bV}; right: ${rH};`;
  }
}

export function emitCollectableSymbolCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* collectableSymbol — Wave H19 */
  .collect-badge {
    position: fixed;
    ${_posStyle(cfg.position)}
    z-index: ${cfg.zIndex};
    padding: 5px 12px;
    border-radius: 999px;
    background: ${cfg.badgeBg};
    color: ${cfg.badgeColor};
    font-size: ${cfg.fontSizePx}px;
    font-weight: 800;
    letter-spacing: 0.06em;
    pointer-events: none;
    border: 2px solid rgba(255, 255, 255, 0.18);
    display: inline-block;
    transition: background-color 220ms ease, color 220ms ease;
  }
  .collect-badge[data-bumping="true"] {
    background: ${cfg.activeBg};
    color: ${cfg.activeColor};
    animation: collect-pulse ${cfg.pulseMs}ms ease-out;
  }
  .collect-badge[data-full="true"] {
    background: ${cfg.activeBg};
    color: ${cfg.activeColor};
    box-shadow: 0 0 24px ${cfg.activeBg};
  }
  @keyframes collect-pulse {
    0%   { transform: scale(1.0); }
    50%  { transform: scale(1.20); }
    100% { transform: scale(1.0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .collect-badge { transition: none; animation: none; }
    .collect-badge[data-bumping="true"] { animation: none; }
  }
  `;
}

export function emitCollectableSymbolMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const initial = cfg.labelTemplate.replace('{S}', cfg.symbol).replace('{N}', '0').replace('{M}', String(cfg.threshold));
  return `<div id="collectBadge" class="collect-badge" role="status" aria-live="polite" aria-label="${cfg.symbol} collected" data-count="0" data-full="false" data-bumping="false">${initial}</div>`;
}

export function emitCollectableSymbolRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── collectableSymbol BLOCK — Wave H19 ──────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var SYM = ${JSON.stringify(cfg.symbol)};
    var THR = ${cfg.threshold};
    var RESET = ${JSON.stringify(cfg.resetOn)};
    var PULSE = ${cfg.pulseMs};
    var TEMPLATE = ${JSON.stringify(cfg.labelTemplate)};
    var count = 0;
    var fired = false;
    var badge = (typeof document !== 'undefined') ? document.getElementById('collectBadge') : null;

    function render(bumping) {
      if (!badge) return;
      badge.setAttribute('data-count', String(count));
      badge.setAttribute('data-full', count >= THR ? 'true' : 'false');
      badge.textContent = TEMPLATE.replace('{S}', SYM).replace('{N}', String(count)).replace('{M}', String(THR));
      badge.setAttribute('aria-label', SYM + ' collected ' + count + ' of ' + THR);
      if (bumping) {
        badge.setAttribute('data-bumping', 'true');
        setTimeout(function () { badge && badge.setAttribute('data-bumping', 'false'); }, PULSE + 40);
      }
    }
    function scanGrid() {
      if (typeof document === 'undefined' || !document.querySelectorAll) return 0;
      var cells = document.querySelectorAll('.symbol-cell');
      var found = 0;
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i];
        var s = c.getAttribute && (c.getAttribute('data-sym') || c.getAttribute('data-symbol') || '');
        if (s === SYM) found++;
      }
      return found;
    }
    function bump(source) {
      var delta = scanGrid();
      if (delta <= 0) return;
      count += delta;
      render(true);
      try { window.HookBus.emit('onSymbolCollected', { symbol: SYM, count: count, threshold: THR, delta: delta, source: source || 'auto' }); } catch (_) {}
      if (!fired && count >= THR) {
        fired = true;
        try { window.HookBus.emit('onCollectionFull', { symbol: SYM, count: count, threshold: THR, source: source || 'auto' }); } catch (_) {}
      }
    }
    function reset(reason) {
      if (count === 0 && !fired) return;
      count = 0;
      fired = false;
      render(false);
      try { window.HookBus.emit('onCollectionReset', { symbol: SYM, reason: reason || 'auto', source: 'auto' }); } catch (_) {}
    }

    window.HookBus.on('postSpin',       function () { bump('postSpin'); });
    window.HookBus.on('onTumbleStep',   function () { bump('onTumbleStep'); });
    window.HookBus.on('onFsSpinResult', function () { bump('onFsSpinResult'); });

    window.HookBus.on('preSpin', function () {
      if (RESET === 'spin') reset('preSpin');
    });
    window.HookBus.on('onFsTrigger', function () {
      if (RESET === 'fsTrigger') reset('onFsTrigger');
    });
    window.HookBus.on('onFsEnd', function () {
      if (RESET === 'fsEnd') reset('onFsEnd');
    });

    /* Public API for engine + force probes. */
    window.collectableSymbolBump = function (n) {
      var add = Number(n) | 0;
      if (add <= 0) return;
      count += add;
      render(true);
      try { window.HookBus.emit('onSymbolCollected', { symbol: SYM, count: count, threshold: THR, delta: add, source: 'api' }); } catch (_) {}
      if (!fired && count >= THR) {
        fired = true;
        try { window.HookBus.emit('onCollectionFull', { symbol: SYM, count: count, threshold: THR, source: 'api' }); } catch (_) {}
      }
    };
    window.collectableSymbolReset = function () { reset('api'); };
    window.collectableSymbolGet   = function () { return { symbol: SYM, count: count, threshold: THR, full: count >= THR }; };

    render(false);
  })();
  `;
}
