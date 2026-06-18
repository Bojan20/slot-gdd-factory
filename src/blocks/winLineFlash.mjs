/**
 * src/blocks/winLineFlash.mjs
 *
 * Wave H21 — Win Line Flash (per-line directional flash on win).
 *
 * Industry baseline (vendor-neutral):
 *   When a line win lands, modern slots paint a brief left-to-right (or
 *   right-to-left) flash along the winning cells to direct the player's
 *   eye to the source of the credit. This block owns the flash overlay.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitWinLineFlashCSS(cfg), emitWinLineFlashMarkup(cfg),
 *   emitWinLineFlashRuntime(cfg)
 *
 * Lifecycle (HookBus):
 *   subscribes: onWinPresentationStart (paint flash for each win line),
 *               onWinPresentationEnd (clear), preSpin (force clear)
 *   emits (owned): onWinLineFlashStart, onWinLineFlashEnd,
 *                  onWinLineFlashCleared
 *
 * Performance budget:
 *   1 overlay per line; ≤ 1 listener (wired-once); deterministic given
 *   identical line events; CSS-only animation, no rAF.
 *
 * a11y:
 *   flash overlay aria-hidden=true — purely visual; underlying cell
 *   semantics retained for SR; prefers-reduced-motion drops flash to
 *   a static highlight.
 *
 * GDD keys (consumed from model.winLineFlash):
 *   enabled, flashMs, direction ('ltr'|'rtl'|'both'), color,
 *   minCells, zIndex
 *
 * @module winLineFlash
 */

const DIRECTIONS = new Set(['ltr', 'rtl', 'both']);
const BOUNDS = Object.freeze({
  flashMs:   [120, 1500],
  zIndex:    [10, 99],
  minCells:  [2, 12],
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
    /* 2026-06-18 — Boki rule "sve sto postoji u svakom slotu radi odmah
     * i uvek": win-line directional flash is a universal base-game win
     * presenter (industry baseline — every certified studio paints a LTR
     * sweep on each line win). Default flipped to TRUE. GDD opt-out via
     * `winLineFlash: { enabled: false }` still honored. */
    enabled:        true,
    flashMs:        540,
    direction:      'ltr',
    minCells:       3,
    zIndex:         16,
    flashColor:     'rgba(255,216,77,0.7)',
    clearOnNextSpin: true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.winLineFlash) || {};
  const auto = !!model.winLineFlash;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.flashMs   = _clamp(m.flashMs,   BOUNDS.flashMs,   cfg.flashMs);
  cfg.minCells  = _clamp(m.minCells,  BOUNDS.minCells,  cfg.minCells);
  cfg.zIndex    = _clamp(m.zIndex,    BOUNDS.zIndex,    cfg.zIndex);
  cfg.flashColor = _safe(m.flashColor, 48, cfg.flashColor);
  if (typeof m.direction === 'string' && DIRECTIONS.has(m.direction)) cfg.direction = m.direction;
  if (typeof m.clearOnNextSpin === 'boolean') cfg.clearOnNextSpin = m.clearOnNextSpin;
  return cfg;
}

export function emitWinLineFlashCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* winLineFlash — Wave H21 */
  .symbol-cell[data-line-flash="true"] {
    position: relative;
  }
  .symbol-cell[data-line-flash="true"]::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 0%, ${cfg.flashColor} 50%, transparent 100%);
    z-index: ${cfg.zIndex};
    pointer-events: none;
    border-radius: inherit;
    animation: win-line-flash-${cfg.direction} ${cfg.flashMs}ms ease-out;
  }
  @keyframes win-line-flash-ltr {
    0%   { transform: translateX(-100%); opacity: 0.0; }
    50%  { opacity: 1.0; }
    100% { transform: translateX(100%); opacity: 0.0; }
  }
  @keyframes win-line-flash-rtl {
    0%   { transform: translateX(100%); opacity: 0.0; }
    50%  { opacity: 1.0; }
    100% { transform: translateX(-100%); opacity: 0.0; }
  }
  @keyframes win-line-flash-both {
    0%   { transform: scaleX(0.0); opacity: 0.0; }
    50%  { transform: scaleX(1.0); opacity: 1.0; }
    100% { transform: scaleX(0.0); opacity: 0.0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .symbol-cell[data-line-flash="true"]::after { animation: none; opacity: 0.6; }
  }
  `;
}

export function emitWinLineFlashMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<!-- winLineFlash decorates .symbol-cell[data-line-flash="true"] at runtime -->`;
}

export function emitWinLineFlashRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── winLineFlash BLOCK — Wave H21 ────────────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var FLASH = ${cfg.flashMs};
    var MIN = ${cfg.minCells};
    var CLEAR = ${JSON.stringify(cfg.clearOnNextSpin)};

    function clearAll(reason) {
      if (typeof document === 'undefined') return;
      var cells = document.querySelectorAll('.symbol-cell[data-line-flash="true"]');
      var n = cells.length;
      for (var i = 0; i < cells.length; i++) cells[i].setAttribute('data-line-flash', 'false');
      if (n > 0) try { window.HookBus.emit('onWinLineFlashCleared', { reason: reason || 'auto' }); } catch (_) {}
    }
    function flashCells(cells, lineIdx, source) {
      if (typeof document === 'undefined') return;
      if (!Array.isArray(cells) || cells.length < MIN) return;
      var marked = 0;
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i];
        if (!c || typeof c.reel !== 'number' || typeof c.row !== 'number') continue;
        var el = document.querySelector('.symbol-cell[data-reel="' + c.reel + '"][data-row="' + c.row + '"]');
        if (el) {
          el.setAttribute('data-line-flash', 'true');
          marked++;
        }
      }
      if (marked > 0) {
        try { window.HookBus.emit('onWinLineFlashStart', { lineIdx: lineIdx, cellCount: marked, source: source || 'auto' }); } catch (_) {}
        setTimeout(function () {
          for (var j = 0; j < cells.length; j++) {
            var cc = cells[j];
            if (cc && typeof cc.reel === 'number' && typeof cc.row === 'number') {
              var ee = document.querySelector('.symbol-cell[data-reel="' + cc.reel + '"][data-row="' + cc.row + '"]');
              if (ee) ee.setAttribute('data-line-flash', 'false');
            }
          }
          try { window.HookBus.emit('onWinLineFlashEnd', { lineIdx: lineIdx, source: source || 'auto' }); } catch (_) {}
        }, FLASH + 60);
      }
    }

    /* F3 priority 30 — decorator class. Per-line flash overlay runs after
       payout evaluators populate p.events; sibling decorator order with
       paylineDimmer / multiplierOrb / retriggerMeter not race-critical. */
    window.HookBus.on('preSpin', function () { if (CLEAR) clearAll('preSpin'); }, { priority: 30 });
    window.HookBus.on('onSpinResult', function (p) {
      if (!p || !Array.isArray(p.events)) return;
      for (var i = 0; i < p.events.length; i++) {
        var e = p.events[i];
        if (!e || !Array.isArray(e.cells)) continue;
        if (e.cells.length < MIN) continue;
        flashCells(e.cells, e.lineIdx || i, 'onSpinResult');
      }
    }, { priority: 30 });
    window.HookBus.on('onTumbleStep', function () { clearAll('onTumbleStep'); }, { priority: 30 });

    /* Public API */
    window.winLineFlash = function (cells, lineIdx) {
      flashCells(Array.isArray(cells) ? cells : [], lineIdx | 0, 'api');
    };
    window.winLineFlashClear = function () { clearAll('api'); };
  })();
  `;
}
