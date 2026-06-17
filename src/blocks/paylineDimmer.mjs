/**
 * src/blocks/paylineDimmer.mjs
 *
 * Wave H27 — Payline Dimmer (dim non-winning cells during win presentation).
 *
 * Industry baseline (vendor-neutral):
 *   On a winning spin, modern slots dim every cell that ISN'T part of a
 *   winning combination so the player's eye is drawn cleanly to the win.
 *   This block owns that selective dimming.
 *
 * @module paylineDimmer
 */

const BOUNDS = Object.freeze({
  dimMs:        [120, 1500],
  zIndex:       [10, 99],
  opacityFloor: [0.10, 0.95],
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
    dimMs:         360,
    opacityFloor:  0.35,
    zIndex:        15,
    overlayColor:  'rgba(0,0,0,0.55)',
    clearOnNextSpin: true,
    skipDuringFs:  false,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.paylineDimmer) || {};
  const auto = !!model.paylineDimmer;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.dimMs        = _clamp(m.dimMs,        BOUNDS.dimMs,        cfg.dimMs);
  cfg.zIndex       = _clamp(m.zIndex,       BOUNDS.zIndex,       cfg.zIndex);
  cfg.opacityFloor = _clamp(m.opacityFloor, BOUNDS.opacityFloor, cfg.opacityFloor);
  cfg.overlayColor = _safe(m.overlayColor, 64, cfg.overlayColor);
  if (typeof m.clearOnNextSpin === 'boolean') cfg.clearOnNextSpin = m.clearOnNextSpin;
  if (typeof m.skipDuringFs    === 'boolean') cfg.skipDuringFs    = m.skipDuringFs;
  return cfg;
}

export function emitPaylineDimmerCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* paylineDimmer — Wave H27 */
  .symbol-cell[data-dimmed="true"] {
    position: relative;
    opacity: ${cfg.opacityFloor};
    transition: opacity ${cfg.dimMs}ms ease-out;
  }
  .symbol-cell[data-dimmed="true"]::after {
    content: "";
    position: absolute;
    inset: 0;
    background: ${cfg.overlayColor};
    z-index: ${cfg.zIndex};
    pointer-events: none;
    border-radius: inherit;
  }
  @media (prefers-reduced-motion: reduce) {
    .symbol-cell[data-dimmed="true"] { transition: none; }
  }
  `;
}

export function emitPaylineDimmerMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<!-- paylineDimmer decorates .symbol-cell[data-dimmed="true"] at runtime -->`;
}

export function emitPaylineDimmerRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── paylineDimmer BLOCK — Wave H27 ───────────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var CLEAR = ${JSON.stringify(cfg.clearOnNextSpin)};
    var SKIP_FS = ${JSON.stringify(cfg.skipDuringFs)};
    var inFs = false;

    function clearAll(reason) {
      if (typeof document === 'undefined') return;
      var cells = document.querySelectorAll('.symbol-cell[data-dimmed="true"]');
      var n = cells.length;
      for (var i = 0; i < cells.length; i++) cells[i].setAttribute('data-dimmed', 'false');
      if (n > 0) try { window.HookBus.emit('onPaylineDimmerCleared', { reason: reason || 'auto' }); } catch (_) {}
    }
    function dimNonWinning(events, source) {
      if (typeof document === 'undefined') return;
      if (SKIP_FS && inFs) return;
      if (!Array.isArray(events) || events.length === 0) return;

      var winningKeys = {};
      for (var i = 0; i < events.length; i++) {
        var e = events[i];
        if (!e || !Array.isArray(e.cells)) continue;
        for (var j = 0; j < e.cells.length; j++) {
          var c = e.cells[j];
          if (c && typeof c.reel === 'number' && typeof c.row === 'number') {
            winningKeys[c.reel + ':' + c.row] = 1;
          }
        }
      }
      if (Object.keys(winningKeys).length === 0) return;

      var allCells = document.querySelectorAll('.symbol-cell');
      var dimmedCount = 0;
      for (var k = 0; k < allCells.length; k++) {
        var cell = allCells[k];
        var r = parseInt(cell.getAttribute('data-reel') || '-1', 10);
        var w = parseInt(cell.getAttribute('data-row') || '-1', 10);
        if (r < 0 || w < 0) continue;
        if (winningKeys[r + ':' + w]) {
          cell.setAttribute('data-dimmed', 'false');
        } else {
          cell.setAttribute('data-dimmed', 'true');
          dimmedCount++;
        }
      }
      if (dimmedCount > 0) {
        try { window.HookBus.emit('onPaylineDimmerStart', { dimmedCount: dimmedCount, source: source || 'auto' }); } catch (_) {}
      }
    }

    window.HookBus.on('preSpin', function () { if (CLEAR) clearAll('preSpin'); });
    window.HookBus.on('onSpinResult', function (p) {
      if (!p || !Array.isArray(p.events)) return;
      dimNonWinning(p.events, 'onSpinResult');
    });
    window.HookBus.on('onTumbleStep', function () { clearAll('onTumbleStep'); });
    window.HookBus.on('onWinPresentationEnd', function () { clearAll('onWinPresentationEnd'); });
    window.HookBus.on('onFsTrigger', function () { inFs = true; });
    window.HookBus.on('onFsEnd',     function () { inFs = false; });

    /* Public API */
    window.paylineDimmerApply = function (events) { dimNonWinning(Array.isArray(events) ? events : [], 'api'); };
    window.paylineDimmerClear = function () { clearAll('api'); };
  })();
  `;
}
