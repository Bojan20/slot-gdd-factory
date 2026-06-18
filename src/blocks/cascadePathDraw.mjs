/**
 * src/blocks/cascadePathDraw.mjs
 *
 * Wave H24 — Cascade Path Draw (visual chain between cascade win cells).
 *
 * Industry baseline (vendor-neutral):
 *   Cascade/tumble slots benefit from a brief visual line connecting all
 *   the winning cells in a cluster — helping the player parse complex
 *   cluster pays (e.g. 12-cell cluster across a 7×7 grid). This block
 *   owns the SVG path overlay.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitCascadePathDrawCSS(cfg), emitCascadePathDrawMarkup(cfg),
 *   emitCascadePathDrawRuntime(cfg)
 *
 * Lifecycle (HookBus):
 *   subscribes: onTumbleStep, preSpin
 *   emits (owned): onCascadePathDrawn { eventIdx, cellCount }
 *
 * Performance budget:
 *   ≤ 1 SVG re-render per tumble step; ≤ 1 listener; deterministic.
 *
 * a11y:
 *   SVG marked aria-hidden=true — decorative; prefers-reduced-motion
 *   collapses draw animation.
 *
 * GDD keys (consumed from model.cascadePathDraw):
 *   enabled, drawMs, strokePx, color, glow, minCells, zIndex
 *
 * @module cascadePathDraw
 */

const BOUNDS = Object.freeze({
  drawMs:     [120, 2000],
  strokePx:   [1, 8],
  zIndex:     [10, 99],
  minCells:   [2, 24],
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
    enabled:        false,
    drawMs:         900,
    strokePx:       3,
    zIndex:         18,
    minCells:       3,
    strokeColor:    '#ffd84d',
    glowColor:      'rgba(255,216,77,0.55)',
    clearOnNextSpin: true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.cascadePathDraw) || {};
  const auto = !!model.cascadePathDraw;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.drawMs   = _clamp(m.drawMs,   BOUNDS.drawMs,   cfg.drawMs);
  cfg.strokePx = _clamp(m.strokePx, BOUNDS.strokePx, cfg.strokePx);
  cfg.zIndex   = _clamp(m.zIndex,   BOUNDS.zIndex,   cfg.zIndex);
  cfg.minCells = _clamp(m.minCells, BOUNDS.minCells, cfg.minCells);

  cfg.strokeColor = _safe(m.strokeColor, 48, cfg.strokeColor);
  cfg.glowColor   = _safe(m.glowColor,   48, cfg.glowColor);
  if (typeof m.clearOnNextSpin === 'boolean') cfg.clearOnNextSpin = m.clearOnNextSpin;
  return cfg;
}

export function emitCascadePathDrawCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* cascadePathDraw — Wave H24 */
  #cascadePathSvg {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: ${cfg.zIndex};
    overflow: visible;
  }
  #cascadePathSvg path {
    stroke: ${cfg.strokeColor};
    stroke-width: ${cfg.strokePx};
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    filter: drop-shadow(0 0 6px ${cfg.glowColor});
    stroke-dasharray: 2000;
    stroke-dashoffset: 2000;
    animation: cascade-path-draw ${cfg.drawMs}ms ease-out forwards;
  }
  @keyframes cascade-path-draw {
    to { stroke-dashoffset: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    #cascadePathSvg path { animation: none; stroke-dashoffset: 0; }
  }
  `;
}

export function emitCascadePathDrawMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<svg id="cascadePathSvg" aria-hidden="true"></svg>`;
}

export function emitCascadePathDrawRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── cascadePathDraw BLOCK — Wave H24 ─────────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var MIN = ${cfg.minCells};
    var DRAW = ${cfg.drawMs};
    var CLEAR = ${JSON.stringify(cfg.clearOnNextSpin)};

    function svgEl() {
      if (typeof document === 'undefined') return null;
      return document.getElementById('cascadePathSvg');
    }
    function clearAll(reason) {
      var svg = svgEl();
      if (!svg) return;
      var had = svg.children.length > 0;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      if (had) try { window.HookBus.emit('onCascadePathCleared', { reason: reason || 'auto' }); } catch (_) {}
    }
    function drawPath(cells, eventIdx, source) {
      if (typeof document === 'undefined') return false;
      if (!Array.isArray(cells) || cells.length < MIN) return false;
      var svg = svgEl();
      if (!svg) return false;
      var grid = document.querySelector('.grid') || document.querySelector('#grid');
      var gridRect = (grid && grid.getBoundingClientRect) ? grid.getBoundingClientRect() : null;
      if (!gridRect) return false;
      if (grid && !svg.parentNode) grid.appendChild(svg);

      var d = '';
      var validPoints = 0;
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i];
        if (!c || typeof c.reel !== 'number' || typeof c.row !== 'number') continue;
        var el = document.querySelector('.symbol-cell[data-reel="' + c.reel + '"][data-row="' + c.row + '"]');
        if (!el) continue;
        var r = el.getBoundingClientRect();
        var cx = r.left + r.width / 2 - gridRect.left;
        var cy = r.top + r.height / 2 - gridRect.top;
        d += (validPoints === 0 ? 'M' : 'L') + cx.toFixed(1) + ',' + cy.toFixed(1) + ' ';
        validPoints++;
      }
      if (validPoints < MIN) return false;
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d.trim());
      path.setAttribute('data-event-idx', String(eventIdx | 0));
      svg.appendChild(path);
      try { window.HookBus.emit('onCascadePathDrawn', { eventIdx: eventIdx | 0, points: validPoints, source: source || 'auto' }); } catch (_) {}
      return true;
    }

    window.HookBus.on('preSpin', function () { if (CLEAR) clearAll('preSpin'); });
    window.HookBus.on('onSpinResult', function (p) {
      if (!p || !Array.isArray(p.events)) return;
      for (var i = 0; i < p.events.length; i++) {
        var e = p.events[i];
        if (e && Array.isArray(e.cells) && e.cells.length >= MIN) drawPath(e.cells, i, 'onSpinResult');
      }
    });
    window.HookBus.on('onTumbleStep', function (p) {
      clearAll('onTumbleStep');
      if (!p || !Array.isArray(p.events)) return;
      for (var i = 0; i < p.events.length; i++) {
        var e = p.events[i];
        if (e && Array.isArray(e.cells) && e.cells.length >= MIN) drawPath(e.cells, i, 'onTumbleStep');
      }
    });

    /* Public API */
    window.cascadePathDraw = function (cells, eventIdx) { return drawPath(cells, eventIdx | 0, 'api'); };
    window.cascadePathClear = function () { clearAll('api'); };
  })();
  `;
}
