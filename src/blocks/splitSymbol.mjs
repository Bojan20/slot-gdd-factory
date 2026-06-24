import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/splitSymbol.mjs
 *
 * Wave H16 — Split Symbol (one symbol divides into 2 after landing).
 *
 * Industry baseline (vendor-neutral):
 *   Modern cascade and ways-engine games sometimes settle with a symbol that
 *   visually splits into two identical copies inside a single cell or across
 *   adjacent cells, boosting that symbol's ways/line count for the spin.
 *
 * Pure PRESENTATION layer:
 *   - Listens to onSpinResult for symbols flagged `split: true`
 *   - Renders a thin vertical divider on the cell, with two half-glyphs
 *   - Emits announce event for downstream evaluators (winwaysIndicator, etc.)
 *
 * @module splitSymbol
 */

const BOUNDS = Object.freeze({
  pulseMs:    [120, 1500],
  zIndex:     [10, 99],
  splitGapPx: [0, 8],
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
    splitGapPx:    2,
    pulseMs:       320,
    zIndex:        17,
    dividerColor:  '#ffd84d',
    autoOnFlag:    true,         /* read cell `data-split="true"` after settle */
    restrictKinds: [],           /* [] = any kind eligible */
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.splitSymbol) || {};
  const auto = !!model.splitSymbol;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.splitGapPx = _clamp(m.splitGapPx, BOUNDS.splitGapPx, cfg.splitGapPx);
  cfg.pulseMs    = _clamp(m.pulseMs,    BOUNDS.pulseMs,    cfg.pulseMs);
  cfg.zIndex     = _clamp(m.zIndex,     BOUNDS.zIndex,     cfg.zIndex);
  cfg.dividerColor = _safe(m.dividerColor, 32, cfg.dividerColor);
  if (typeof m.autoOnFlag === 'boolean') cfg.autoOnFlag = m.autoOnFlag;
  if (Array.isArray(m.restrictKinds)) {
    cfg.restrictKinds = m.restrictKinds
      .filter(s => typeof s === 'string' && s.length > 0 && s.length <= 12)
      .map(s => s.replace(/[<>"'`]/g, ''))
      .slice(0, 32);
  }
  return cfg;
}

export function emitSplitSymbolCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* splitSymbol — Wave H16 */
  .symbol-cell[data-split="true"] {
    position: relative;
  }
  .symbol-cell[data-split="true"]::after {
    content: "";
    position: absolute;
    top: 6%;
    bottom: 6%;
    left: 50%;
    width: ${Math.max(1, cfg.splitGapPx)}px;
    transform: translateX(-50%);
    background: ${cfg.dividerColor};
    z-index: ${cfg.zIndex};
    pointer-events: none;
    border-radius: 1px;
    box-shadow: 0 0 6px ${cfg.dividerColor};
    animation: split-symbol-pulse ${cfg.pulseMs}ms ease-out;
  }
  @keyframes split-symbol-pulse {
    0%   { opacity: 0.0; }
    50%  { opacity: 1.0; }
    100% { opacity: 1.0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .symbol-cell[data-split="true"]::after { animation: none; }
  }
  `;
}

export function emitSplitSymbolMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<!-- splitSymbol decorates .symbol-cell[data-split="true"] at runtime -->`, 'splitSymbol');
}

export function emitSplitSymbolRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── splitSymbol BLOCK — Wave H16 ─────────────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var AUTO = ${JSON.stringify(cfg.autoOnFlag)};
    var RESTRICT = ${JSON.stringify(cfg.restrictKinds)};
    var restrictSet = {};
    for (var i = 0; i < RESTRICT.length; i++) restrictSet[RESTRICT[i]] = 1;
    var hasRestrict = RESTRICT.length > 0;

    function clearAll() {
      if (typeof document === 'undefined') return;
      var cells = document.querySelectorAll('.symbol-cell[data-split="true"]');
      for (var i = 0; i < cells.length; i++) cells[i].setAttribute('data-split', 'false');
    }
    function markSplit(reel, row, sym, source) {
      if (typeof document === 'undefined') return false;
      var cell = document.querySelector('.symbol-cell[data-reel="' + reel + '"][data-row="' + row + '"]');
      if (!cell) return false;
      if (hasRestrict) {
        var s = cell.getAttribute('data-sym') || cell.getAttribute('data-symbol') || sym || '';
        if (!restrictSet[s]) return false;
      }
      cell.setAttribute('data-split', 'true');
      try { window.HookBus.emit('onSplitSymbolPlaced', { reel: reel, row: row, sym: sym || '', source: source || 'auto' }); } catch (_) {}
      return true;
    }
    function autoScan(source) {
      if (!AUTO || typeof document === 'undefined') return;
      var cells = document.querySelectorAll('.symbol-cell');
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i];
        var flag = c.getAttribute('data-pending-split');
        if (flag === 'true') {
          var r = parseInt(c.getAttribute('data-reel') || '-1', 10);
          var w = parseInt(c.getAttribute('data-row') || '-1', 10);
          var s = c.getAttribute('data-sym') || '';
          if (r >= 0 && w >= 0) markSplit(r, w, s, source);
        }
      }
    }

    window.HookBus.on('preSpin',       function () { clearAll(); });
    window.HookBus.on('onSpinResult',  function () { autoScan('onSpinResult'); });
    window.HookBus.on('onTumbleStep',  function () { autoScan('onTumbleStep'); });
    window.HookBus.on('onFsSpinResult',function () { autoScan('onFsSpinResult'); });

    /* Public API */
    window.splitSymbolMark   = function (reel, row, sym) { return markSplit(reel | 0, row | 0, String(sym || ''), 'api'); };
    window.splitSymbolClear  = function () { clearAll(); try { window.HookBus.emit('onSplitSymbolCleared', { source: 'api' }); } catch (_) {} };
  })();
  `;
}
