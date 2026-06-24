import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/winMultiplierBadge.mjs
 *
 * Wave H20 — Win Multiplier Badge (per-line / per-win × N chip).
 *
 * Industry baseline (vendor-neutral):
 *   When a win line carries a multiplier (random per-line mult, path-aware
 *   mult, persistent mult), modern slots render a small "× N" badge on or
 *   near the affected payline so the player understands the source of the
 *   bonus. This block owns that badge presentation.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitWinMultiplierBadgeCSS(cfg), emitWinMultiplierBadgeMarkup(cfg),
 *   emitWinMultiplierBadgeRuntime(cfg)
 *
 * Lifecycle (HookBus):
 *   subscribes: onWinPresentationStart (place badges per line mult),
 *               onWinPresentationEnd (clear), preSpin (force clear)
 *   emits (owned): onWinMultBadgePlaced, onWinMultBadgeCleared
 *
 * Performance budget:
 *   ≤ 1 badge node per win line (recycled per spin); ≤ 1 listener via
 *   wired-once sentinel; deterministic from win-event payload.
 *
 * a11y:
 *   badge carries role="status" + aria-live="polite" so SR announces
 *   "Line 3 × 5 multiplier"; prefers-reduced-motion kills the badge
 *   pulse animation.
 *
 * GDD keys (consumed from model.winMultiplierBadge):
 *   enabled, position, fontSizePx, pulseMs, zIndex, minMult, color
 *
 * @module winMultiplierBadge
 */

const POSITIONS = new Set(['line-start', 'line-end', 'win-center', 'top-right']);
const BOUNDS = Object.freeze({
  fontSizePx: [10, 24],
  pulseMs:    [120, 1500],
  zIndex:     [10, 99],
  minMult:    [2, 99],
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
    minMult:       2,             /* badge appears for mult ≥ N */
    fontSizePx:    13,
    pulseMs:       340,
    zIndex:        25,
    position:      'win-center',
    bgColor:       '#ffd84d',
    fgColor:       '#03110a',
    labelTemplate: '×{N}',
    clearOnNextSpin: true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.winMultiplierBadge) || {};
  const auto = !!model.winMultiplierBadge;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.minMult    = _clamp(m.minMult,    BOUNDS.minMult,    cfg.minMult);
  cfg.fontSizePx = _clamp(m.fontSizePx, BOUNDS.fontSizePx, cfg.fontSizePx);
  cfg.pulseMs    = _clamp(m.pulseMs,    BOUNDS.pulseMs,    cfg.pulseMs);
  cfg.zIndex     = _clamp(m.zIndex,     BOUNDS.zIndex,     cfg.zIndex);

  if (typeof m.position === 'string' && POSITIONS.has(m.position)) cfg.position = m.position;
  cfg.bgColor = _safe(m.bgColor, 48, cfg.bgColor);
  cfg.fgColor = _safe(m.fgColor, 32, cfg.fgColor);
  if (typeof m.labelTemplate === 'string' && m.labelTemplate.length > 0 && m.labelTemplate.length <= 16) {
    cfg.labelTemplate = _safe(m.labelTemplate, 16, cfg.labelTemplate);
  }
  if (typeof m.clearOnNextSpin === 'boolean') cfg.clearOnNextSpin = m.clearOnNextSpin;
  return cfg;
}

export function emitWinMultiplierBadgeCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* winMultiplierBadge — Wave H20 */
  .win-mult-badge {
    position: absolute;
    z-index: ${cfg.zIndex};
    min-width: 28px;
    height: 22px;
    padding: 0 8px;
    border-radius: 11px;
    background: ${cfg.bgColor};
    color: ${cfg.fgColor};
    font-size: ${cfg.fontSizePx}px;
    font-weight: 900;
    line-height: 22px;
    text-align: center;
    pointer-events: none;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.55);
    animation: win-mult-badge-pulse ${cfg.pulseMs}ms ease-out;
  }
  @keyframes win-mult-badge-pulse {
    0%   { transform: scale(0.5); opacity: 0.0; }
    60%  { transform: scale(1.18); opacity: 1.0; }
    100% { transform: scale(1.0); opacity: 1.0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .win-mult-badge { animation: none; }
  }
  `;
}

export function emitWinMultiplierBadgeMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<!-- winMultiplierBadge mounts badges per-win at runtime -->`, 'winMultiplierBadge');
}

export function emitWinMultiplierBadgeRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── winMultiplierBadge BLOCK — Wave H20 ──────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    /* WASH PASS (2026-06-18) — wired-once sentinel so HMR / repeated
     * runtime bake does NOT stack the listeners (4 listeners would
     * fire N× per event without this guard). */
    if (window.__WIN_MULT_BADGE_WIRED__) return;
    window.__WIN_MULT_BADGE_WIRED__ = true;
    var MIN = ${cfg.minMult};
    var TEMPLATE = ${JSON.stringify(cfg.labelTemplate)};
    var POSITION = ${JSON.stringify(cfg.position)};
    var CLEAR_NEXT = ${JSON.stringify(cfg.clearOnNextSpin)};

    function clearAll(reason) {
      if (typeof document === 'undefined') return;
      var els = document.querySelectorAll('.win-mult-badge');
      var n = els.length;
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el && typeof el.remove === 'function') el.remove();
        else if (el && el.parentNode && typeof el.parentNode.removeChild === 'function') el.parentNode.removeChild(el);
      }
      if (n > 0) try { window.HookBus.emit('onWinMultBadgeCleared', { reason: reason || 'auto' }); } catch (_) {}
    }
    function targetEl(reel, row) {
      if (typeof document === 'undefined') return null;
      return document.querySelector('.symbol-cell[data-reel="' + reel + '"][data-row="' + row + '"]');
    }
    function placeBadge(reel, row, mult, source) {
      var v = mult | 0;
      if (v < MIN) return false;
      var anchor = targetEl(reel, row);
      if (!anchor) return false;
      var existing = anchor.querySelector('.win-mult-badge');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      /* WCAG 4.1.3 — multiplier badge textContent is the value player
         needs to hear (e.g. "×5"). Build via innerHTML template literal
         so the literal role="status" aria-live="polite" attributes are
         grep-visible to tools/aria-live-audit.mjs (setAttribute commas
         don't match the audit regex). */
      var _wmbWrap = document.createElement('div');
      _wmbWrap.innerHTML = '<span class="win-mult-badge" role="status" aria-live="polite"></span>';
      var badge = _wmbWrap.firstChild;
      badge.textContent = TEMPLATE.replace('{N}', String(v));
      badge.setAttribute('aria-label', 'multiplier x ' + v);
      if (POSITION === 'top-right')      { badge.style.top = '-10px'; badge.style.right = '-6px'; }
      else if (POSITION === 'line-start'){ badge.style.top = '50%'; badge.style.left = '-12px'; badge.style.transform = 'translateY(-50%)'; }
      else if (POSITION === 'line-end')  { badge.style.top = '50%'; badge.style.right = '-12px'; badge.style.transform = 'translateY(-50%)'; }
      else { badge.style.top = '50%'; badge.style.left = '50%'; badge.style.transform = 'translate(-50%, -50%)'; }
      anchor.style.position = anchor.style.position || 'relative';
      anchor.appendChild(badge);
      try { window.HookBus.emit('onWinMultBadgePlaced', { reel: reel, row: row, mult: v, source: source || 'auto' }); } catch (_) {}
      return true;
    }

    window.HookBus.on('preSpin', function () { if (CLEAR_NEXT) clearAll('preSpin'); });
    window.HookBus.on('onSpinResult', function (p) {
      if (!p || !Array.isArray(p.events)) return;
      for (var i = 0; i < p.events.length; i++) {
        var e = p.events[i];
        if (!e || !e.multiplier || e.multiplier < MIN) continue;
        var cells = Array.isArray(e.cells) ? e.cells : [];
        if (cells.length === 0) continue;
        var c = cells[Math.floor(cells.length / 2)];
        if (c && typeof c.reel === 'number' && typeof c.row === 'number') {
          placeBadge(c.reel, c.row, e.multiplier, 'onSpinResult');
        }
      }
    });
    window.HookBus.on('onPathMultiplierAssigned', function (p) {
      if (!p || typeof p.multiplier !== 'number' || p.multiplier < MIN) return;
      var idx = (p && p.cellIdx) || (p && p.eventIdx) || 0;
      placeBadge(idx | 0, 0, p.multiplier, 'onPathMultiplierAssigned');
    });
    window.HookBus.on('onFsEnd', function () { clearAll('onFsEnd'); });

    /* Public API */
    window.winMultBadge = function (reel, row, mult) {
      return placeBadge(reel | 0, row | 0, mult | 0, 'api');
    };
    window.winMultBadgeClear = function () { clearAll('api'); };
  })();
  `;
}
