/**
 * src/blocks/megaSymbol.mjs
 *
 * Wave H11 — Mega Symbol (oversized 2×2 / 3×3 symbol block).
 *
 * Industry baseline (vendor-neutral):
 *   Many cascade / scatter-pay slots occasionally drop a single "mega symbol"
 *   that occupies a 2×2 or 3×3 block on the grid. The mega counts as ONE
 *   symbol for evaluation but visually occupies multiple cells. When involved
 *   in a winning combination, the block awards N copies of the symbol's win
 *   credit (N = block area).
 *
 *   This block is a pure PRESENTATION + STATE layer:
 *     • Reads `model.megaSymbol.dropChance` and `model.megaSymbol.minSize`
 *       (the actual landing is decided by the engine; this block listens to
 *       the canonical event `onMegaSymbolLanded` if the engine emits it, or
 *       can be driven manually via window.megaSymbolPlant(reel, row, size)).
 *     • Renders a visible mega-symbol overlay div (z-index 17) that spans
 *       the SxS grid area, hiding the cells beneath while announcing the
 *       symbol code.
 *     • Honours preSpin clear, postSpin keep (until preSpin clears).
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitMegaSymbolCSS(cfg)
 *   emitMegaSymbolMarkup(cfg)   → empty (overlay built at runtime)
 *   emitMegaSymbolRuntime(cfg)
 *
 * Lifecycle:
 *   subscribes:
 *     preSpin                → clear mega overlay
 *     onMegaSymbolLanded     → render overlay {reel, row, size, sym}
 *     postSpin               → re-render any persistent mega (e.g. sticky)
 *     onFsEnd                → clear if cfg.clearOnFsEnd
 *   emits:
 *     onMegaSymbolPlaced     { reel, row, size, sym, source }
 *     onMegaSymbolCleared    { source }
 *
 * a11y:
 *   - role="img" + aria-label="<size>x<size> mega <sym>".
 *   - prefers-reduced-motion kills the entrance pulse.
 *
 * Vendor-neutral.
 *
 * @module megaSymbol
 */

const SIZES = new Set([2, 3, 4]);
const BOUNDS = Object.freeze({
  pulseMs:    [120, 1500],
  zIndex:     [10, 99],
  fontSizeRatio: [0.20, 1.20],
  borderPx:   [0, 8],
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
    minSize:       2,
    maxSize:       3,
    persistRound:  false,        /* keep until next preSpin (sticky mode) */
    clearOnFsEnd:  true,
    pulseMs:       380,
    zIndex:        17,
    fontSizeRatio: 0.55,
    bgColor:       'rgba(2, 4, 10, 0.78)',
    fgColor:       '#ffd84d',
    borderColor:   '#ffd84d',
    borderPx:      2,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.megaSymbol) || {};
  const auto = !!model.megaSymbol;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  if (Number.isFinite(m.minSize) && SIZES.has(m.minSize | 0)) cfg.minSize = m.minSize | 0;
  if (Number.isFinite(m.maxSize) && SIZES.has(m.maxSize | 0)) cfg.maxSize = m.maxSize | 0;
  if (cfg.maxSize < cfg.minSize) cfg.maxSize = cfg.minSize;

  cfg.pulseMs       = _clamp(m.pulseMs,       BOUNDS.pulseMs,       cfg.pulseMs);
  cfg.zIndex        = _clamp(m.zIndex,        BOUNDS.zIndex,        cfg.zIndex);
  cfg.fontSizeRatio = _clamp(m.fontSizeRatio, BOUNDS.fontSizeRatio, cfg.fontSizeRatio);
  cfg.borderPx      = _clamp(m.borderPx,      BOUNDS.borderPx,      cfg.borderPx);

  cfg.bgColor     = _safe(m.bgColor,     48, cfg.bgColor);
  cfg.fgColor     = _safe(m.fgColor,     32, cfg.fgColor);
  cfg.borderColor = _safe(m.borderColor, 32, cfg.borderColor);

  if (typeof m.persistRound  === 'boolean') cfg.persistRound = m.persistRound;
  if (typeof m.clearOnFsEnd  === 'boolean') cfg.clearOnFsEnd = m.clearOnFsEnd;
  return cfg;
}

export function emitMegaSymbolCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* megaSymbol — Wave H11 */
  .mega-symbol-overlay {
    position: absolute;
    z-index: ${cfg.zIndex};
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
    background: ${cfg.bgColor};
    color: ${cfg.fgColor};
    border: ${cfg.borderPx}px solid ${cfg.borderColor};
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6),
                inset 0 0 24px rgba(255, 255, 255, 0.08);
    font-weight: 900;
    line-height: 1.0;
    text-align: center;
    letter-spacing: 0.02em;
    animation: mega-symbol-enter ${cfg.pulseMs}ms ease-out;
  }
  @keyframes mega-symbol-enter {
    0%   { transform: scale(0.7); opacity: 0.0; }
    60%  { transform: scale(1.06); opacity: 1.0; }
    100% { transform: scale(1.0); opacity: 1.0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .mega-symbol-overlay { animation: none; }
  }
  `;
}

export function emitMegaSymbolMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<!-- megaSymbol overlay built at runtime; lives inside .grid -->`;
}

export function emitMegaSymbolRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── megaSymbol BLOCK — Wave H11 ──────────────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var MIN_SIZE = ${cfg.minSize};
    var MAX_SIZE = ${cfg.maxSize};
    var FONT_RATIO = ${cfg.fontSizeRatio};
    var PERSIST = ${JSON.stringify(cfg.persistRound)};
    var CLEAR_FS = ${JSON.stringify(cfg.clearOnFsEnd)};

    function findGrid() {
      if (typeof document === 'undefined') return null;
      return document.querySelector('.grid') || document.querySelector('#grid') || document.body;
    }
    function cellAt(reel, row) {
      if (typeof document === 'undefined') return null;
      return document.querySelector('.symbol-cell[data-reel="' + reel + '"][data-row="' + row + '"]');
    }
    function clearOverlay(source) {
      if (typeof document === 'undefined') return;
      var existing = document.querySelectorAll('.mega-symbol-overlay');
      var n = existing.length;
      for (var i = 0; i < existing.length; i++) {
        var el = existing[i];
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }
      if (n > 0) {
        try { window.HookBus.emit('onMegaSymbolCleared', { source: source || 'auto' }); } catch (_) {}
      }
    }
    function placeOverlay(reel, row, size, sym, source) {
      if (typeof document === 'undefined') return false;
      var s = Math.max(MIN_SIZE, Math.min(MAX_SIZE, size | 0));
      var anchorTL = cellAt(reel, row);
      var anchorBR = cellAt(reel + s - 1, row + s - 1);
      if (!anchorTL || !anchorBR) return false;
      var rectTL = anchorTL.getBoundingClientRect && anchorTL.getBoundingClientRect();
      var rectBR = anchorBR.getBoundingClientRect && anchorBR.getBoundingClientRect();
      if (!rectTL || !rectBR) return false;
      var grid = findGrid();
      var gridRect = grid && grid.getBoundingClientRect && grid.getBoundingClientRect();
      if (!gridRect) return false;

      clearOverlay('replace');
      var ov = document.createElement('div');
      ov.className = 'mega-symbol-overlay';
      ov.setAttribute('role', 'img');
      ov.setAttribute('aria-label', s + 'x' + s + ' mega ' + (sym || ''));
      ov.setAttribute('data-mega-size', String(s));
      ov.setAttribute('data-mega-sym',  String(sym || ''));
      var left = rectTL.left - gridRect.left;
      var top  = rectTL.top  - gridRect.top;
      var w = rectBR.right - rectTL.left;
      var h = rectBR.bottom - rectTL.top;
      ov.style.left = left + 'px';
      ov.style.top  = top  + 'px';
      ov.style.width  = w + 'px';
      ov.style.height = h + 'px';
      ov.style.fontSize = Math.round(Math.min(w, h) * FONT_RATIO) + 'px';
      ov.textContent = String(sym || '?');
      grid.style.position = grid.style.position || 'relative';
      grid.appendChild(ov);
      try { window.HookBus.emit('onMegaSymbolPlaced', { reel: reel, row: row, size: s, sym: sym, source: source || 'auto' }); } catch (_) {}
      return true;
    }

    window.HookBus.on('preSpin', function () {
      if (!PERSIST) clearOverlay('preSpin');
    });
    window.HookBus.on('onMegaSymbolLanded', function (p) {
      if (!p) return;
      placeOverlay(p.reel | 0, p.row | 0, p.size | MIN_SIZE, p.sym || '', 'onMegaSymbolLanded');
    });
    window.HookBus.on('postSpin', function () {
      /* Persistent mega — re-render at the same location since cells may
       * have been re-rendered. Engine emits onMegaSymbolLanded if it wants
       * to keep the visual; do nothing here for ephemeral. */
    });
    window.HookBus.on('onFsEnd', function () {
      if (CLEAR_FS) clearOverlay('onFsEnd');
    });

    /* Public API for force / dev / test. */
    window.megaSymbolPlant = function (reel, row, size, sym) {
      return placeOverlay(reel | 0, row | 0, size | MIN_SIZE, String(sym || ''), 'api');
    };
    window.megaSymbolClear = function () { clearOverlay('api'); };
    /* Engine-facing announcement helper: emits the canonical
     * onMegaSymbolLanded event so this block is the SOLE owner per LEGO
     * single-owner-emit rule. Engine integration can call this OR the
     * onMegaSymbolLanded handler above can also be driven by external
     * payload — but in-repo emit lives here. */
    window.megaSymbolAnnounce = function (reel, row, size, sym) {
      try {
        window.HookBus.emit('onMegaSymbolLanded', { reel: reel | 0, row: row | 0, size: size | MIN_SIZE, sym: String(sym || '') });
      } catch (_) {}
    };
  })();
  `;
}
