/**
 * src/blocks/cellOverflowCounter.mjs
 *
 * Wave H8 — Cell Overflow Counter (per-reel stack-overflow badge).
 *
 * Industry baseline (vendor-neutral):
 *   Stack-based slots (giant-symbol cascade, multi-row stacked wilds, deep
 *   reel strips) occasionally settle with MORE symbols of one kind on a reel
 *   than there are visible rows. The standard presentation pattern is a
 *   small "+N" badge above (or below) the affected reel column indicating
 *   the number of *hidden* extra copies. This block owns that counter.
 *
 *   Pure PRESENTATION layer:
 *     • Reads `cell._stackDepth` or the `data-stack-depth` attribute that
 *       reelEngine writes per reel column (or counts identical .symbol-cell
 *       data-sym per reel as a fallback heuristic).
 *     • Renders a `.cell-overflow-badge` per reel where `total > visibleRows`.
 *     • Auto-hides on `preSpin`; recomputes after `postSpin` + `onTumbleStep`.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitCellOverflowCounterCSS(cfg)
 *   emitCellOverflowCounterMarkup(cfg)  → empty
 *   emitCellOverflowCounterRuntime(cfg)
 *
 * Lifecycle:
 *   subscribes:
 *     preSpin            → hide all badges
 *     postSpin           → measure + draw per reel
 *     onTumbleStep       → re-measure after cascade refill
 *     onFsSpinResult     → re-measure in FS round
 *   emits:
 *     onCellOverflow { reel, count, total, sym } per reel with overflow
 *
 * a11y:
 *   - Badge has `aria-label="reel N hidden K"`.
 *   - prefers-reduced-motion kills entrance pulse.
 *
 * Vendor-neutral.
 *
 * @module cellOverflowCounter
 */

const POSITIONS = new Set(['above', 'below']);
const BOUNDS = Object.freeze({
  badgeFontSize: [10, 18],
  pulseMs:       [120, 1000],
  zIndex:        [10, 99],
  minOverflow:   [1, 99],
});

function _clamp(v, [lo, hi], fb) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
}
function _safeColor(v, fb) {
  if (typeof v !== 'string') return fb;
  const s = v.replace(/[<>"'`]/g, '').slice(0, 32);
  return s.length ? s : fb;
}

export function defaultConfig() {
  return Object.freeze({
    enabled:        false,
    position:       'above',     /* 'above' | 'below' */
    badgeFontSize:  12,
    badgeColor:     '#03110a',
    badgeBg:        '#ffd84d',
    minOverflow:    1,           /* only show when N ≥ this */
    pulseMs:        260,
    zIndex:         18,
    /* If true, prefer reading `data-stack-depth` attr per column from
     * the reel engine; if absent, fall back to counting identical .symbol-cell
     * within each reel. */
    preferDataAttr: true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.cellOverflowCounter) || {};
  const auto = !!model.cellOverflowCounter;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  if (typeof m.position === 'string' && POSITIONS.has(m.position)) cfg.position = m.position;
  cfg.badgeFontSize = _clamp(m.badgeFontSize, BOUNDS.badgeFontSize, cfg.badgeFontSize);
  cfg.pulseMs       = _clamp(m.pulseMs,       BOUNDS.pulseMs,       cfg.pulseMs);
  cfg.zIndex        = _clamp(m.zIndex,        BOUNDS.zIndex,        cfg.zIndex);
  cfg.minOverflow   = _clamp(m.minOverflow,   BOUNDS.minOverflow,   cfg.minOverflow);
  cfg.badgeColor    = _safeColor(m.badgeColor, cfg.badgeColor);
  cfg.badgeBg       = _safeColor(m.badgeBg,    cfg.badgeBg);
  if (typeof m.preferDataAttr === 'boolean') cfg.preferDataAttr = m.preferDataAttr;
  return cfg;
}

export function emitCellOverflowCounterCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const offset = cfg.position === 'above' ? 'top: -22px;' : 'bottom: -22px;';
  return `
  /* cellOverflowCounter — Wave H8 */
  .cell-overflow-badge {
    position: absolute;
    ${offset}
    left: 50%;
    transform: translateX(-50%);
    z-index: ${cfg.zIndex};
    min-width: 28px;
    height: 18px;
    padding: 0 6px;
    border-radius: 9px;
    background: ${cfg.badgeBg};
    color: ${cfg.badgeColor};
    font-size: ${cfg.badgeFontSize}px;
    font-weight: 800;
    line-height: 18px;
    text-align: center;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    display: none;
  }
  .cell-overflow-badge[data-visible="true"] {
    display: inline-block;
    animation: cell-overflow-pulse ${cfg.pulseMs}ms ease-out;
  }
  @keyframes cell-overflow-pulse {
    0%   { transform: translateX(-50%) scale(0.5); opacity: 0.0; }
    60%  { transform: translateX(-50%) scale(1.15); opacity: 1.0; }
    100% { transform: translateX(-50%) scale(1.0); opacity: 1.0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .cell-overflow-badge[data-visible="true"] { animation: none; }
  }
  `;
}

export function emitCellOverflowCounterMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<!-- cellOverflowCounter decorates reel columns at runtime -->`;
}

export function emitCellOverflowCounterRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── cellOverflowCounter BLOCK — Wave H8 ──────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var MIN_OVERFLOW = ${cfg.minOverflow};
    var PREFER_ATTR  = ${JSON.stringify(cfg.preferDataAttr)};

    function reelColumnEl(reelIdx) {
      if (typeof document === 'undefined') return null;
      return document.querySelector('.reel-column[data-reel="' + reelIdx + '"]') ||
             document.querySelector('.reel[data-reel="' + reelIdx + '"]');
    }
    function badgeFor(col) {
      if (!col) return null;
      var b = col.querySelector('.cell-overflow-badge');
      if (b) return b;
      /* WCAG 4.1.3 — overflow counter text mutates on every reel measure;
         role="status" aria-live="polite" announces "+3" overflow updates. */
      var _wrap = document.createElement('div');
      _wrap.innerHTML = '<span class="cell-overflow-badge" role="status" aria-live="polite" data-visible="false"></span>';
      b = _wrap.firstChild;
      col.appendChild(b);
      return b;
    }
    function hideAll() {
      if (typeof document === 'undefined') return;
      var bs = document.querySelectorAll('.cell-overflow-badge');
      for (var i = 0; i < bs.length; i++) bs[i].setAttribute('data-visible', 'false');
    }

    function measure() {
      if (typeof document === 'undefined') return;
      var reels = document.querySelectorAll('.reel-column, .reel[data-reel]');
      var seen = {};
      for (var i = 0; i < reels.length; i++) {
        var reel = reels[i];
        var reelIdx = parseInt(reel.getAttribute('data-reel') || '-1', 10);
        if (reelIdx < 0 || seen[reelIdx]) continue;
        seen[reelIdx] = 1;
        var total = 0;
        var visible = 0;
        var sym = '';
        if (PREFER_ATTR) {
          total = parseInt(reel.getAttribute('data-stack-depth') || '0', 10) | 0;
          visible = parseInt(reel.getAttribute('data-visible-rows') || '0', 10) | 0;
          sym = reel.getAttribute('data-stack-sym') || '';
        }
        if (!total) {
          var cells = reel.querySelectorAll('.symbol-cell');
          visible = cells.length;
          /* Fallback heuristic: count identical adjacent data-sym values */
          var primary = cells[0] && cells[0].getAttribute && (cells[0].getAttribute('data-sym') || '');
          if (primary) {
            var run = 0;
            for (var j = 0; j < cells.length; j++) {
              if (cells[j].getAttribute('data-sym') === primary) run++;
            }
            if (run === cells.length && run > 0) {
              total = run; /* same symbol filling reel — no overflow signal */
            }
          }
          sym = primary || sym;
        }
        var overflow = Math.max(0, total - visible);
        var badge = badgeFor(reel);
        if (overflow >= MIN_OVERFLOW) {
          if (badge) {
            badge.textContent = '+' + overflow;
            badge.setAttribute('data-visible', 'true');
            badge.setAttribute('aria-label', 'reel ' + reelIdx + ' hidden ' + overflow);
          }
          try { window.HookBus.emit('onCellOverflow', { reel: reelIdx, count: overflow, total: total, sym: sym }); } catch (_) {}
        } else if (badge) {
          badge.setAttribute('data-visible', 'false');
        }
      }
    }

    window.HookBus.on('preSpin',        function () { hideAll(); });
    window.HookBus.on('postSpin',       function () { measure(); });
    window.HookBus.on('onTumbleStep',   function () { measure(); });
    window.HookBus.on('onFsSpinResult', function () { measure(); });

    window.cellOverflowMeasure = function () { measure(); };
    window.cellOverflowHide    = function () { hideAll(); };

    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', measure);
      } else {
        measure();
      }
    }
  })();
  `;
}
