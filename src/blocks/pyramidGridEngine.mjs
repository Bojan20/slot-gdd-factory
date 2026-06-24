import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/pyramidGridEngine.mjs
 *
 * Wave LEGO-ENG.1 — Pyramid grid topology engine.
 *
 * Purpose
 * ───────
 *   Renders + animates a PYRAMID grid where each subsequent reel has
 *   ONE MORE row than its predecessor (default 1-2-3-4-5). Symbols
 *   "fall" from the top of each column with stagger; landed grid
 *   contains exactly `(N*(N+1))/2` cells for an N-reel pyramid.
 *
 *   Distinct from existing layout engines:
 *     • `reelEngine.mjs`          — rectangular N×M reels
 *     • `hexReelEngine.mjs`       — hex axial (q,r) topology
 *     • `dynamicWaysEngine.mjs`   — variable rows per reel
 *     • `infinityReelsEngine.mjs` — grid grows per win
 *
 *   Pyramid is FIXED-SHAPE per spin; rows ramp 1→N. Common for
 *   themed slots (Aztec / Egyptian / fantasy) and for evaluator
 *   experimentation where rows-per-reel monotonic ramp opens unique
 *   payline configurations.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Pyramid reels" topology — N reels, monotonically rising row
 *   counts. Anchored bottom; cells align via centered column layout.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitPyramidGridEngineCSS(cfg)
 *   emitPyramidGridEngineMarkup(cfg)
 *   emitPyramidGridEngineRuntime(cfg, model)
 *   buildPyramidShape(reelCount, startRows)        (pure helper)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • preSpin       (priority 28) — flush pending settle, cancel timers
 *   emits:
 *     • onPyramidSpinResult   { duringFs, topology: 'pyramid', cells }
 *   exposes:
 *     • window.__SLOT_KIND_RUNSPIN__.pyramid(onSettled) — dispatcher
 *       entry point per kind-dispatch contract
 *
 * Runtime contract
 * ────────────────
 *   window.__SLOT_PYRAMID_STATE__ = { rotating, pending, reels, settleTimer }
 *
 * GDD config keys (model.pyramidGridEngine)
 * ─────────────────────────────────────────
 *   { enabled, reelCount, startRows, spinDurationMs, staggerMs,
 *     cellSizePx, gapPx, cellColor, cellBorderColor, fadeFallbackMs }
 *
 * Performance: O(cells) DOM populate per settle; O(reels) timers per spin.
 *
 * a11y: each cell is role=cell with aria-label; container is role=grid
 * sa aria-label="Pyramid reels".
 *
 * Senior-grade: wired-once via __PYRAMID_GRID_WIRED__, idempotent emit,
 * vendor-neutral, prefers-reduced-motion respected, try/catch sa
 * console.warn surface (anti-silent-failure per WASH PASS rule).
 */

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const REEL_MIN = 2;
const REEL_MAX = 8;
const ROWS_MIN = 1;
const ROWS_MAX = 8;
const SPIN_MS_MIN = 200;
const SPIN_MS_MAX = 8000;
const STAGGER_MIN = 0;
const STAGGER_MAX = 800;
const CELL_SIZE_MIN = 32;
const CELL_SIZE_MAX = 120;
const GAP_MIN = 0;
const GAP_MAX = 24;
const FADE_MIN = 40;
const FADE_MAX = 800;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    reelCount: 5,
    startRows: 1,
    spinDurationMs: 1600,
    staggerMs: 180,
    cellSizePx: 64,
    gapPx: 4,
    cellColor: '#1a2840',
    cellBorderColor: '#c9a227',
    fadeFallbackMs: 220,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.pyramidGridEngine) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (Number.isFinite(src.reelCount)) cfg.reelCount = clampInt(src.reelCount, REEL_MIN, REEL_MAX);
  if (Number.isFinite(src.startRows)) cfg.startRows = clampInt(src.startRows, ROWS_MIN, ROWS_MAX);
  if (Number.isFinite(src.spinDurationMs)) cfg.spinDurationMs = clampInt(src.spinDurationMs, SPIN_MS_MIN, SPIN_MS_MAX);
  if (Number.isFinite(src.staggerMs)) cfg.staggerMs = clampInt(src.staggerMs, STAGGER_MIN, STAGGER_MAX);
  if (Number.isFinite(src.cellSizePx)) cfg.cellSizePx = clampInt(src.cellSizePx, CELL_SIZE_MIN, CELL_SIZE_MAX);
  if (Number.isFinite(src.gapPx)) cfg.gapPx = clampInt(src.gapPx, GAP_MIN, GAP_MAX);
  if (typeof src.cellColor === 'string' && HEX_COLOR_RE.test(src.cellColor)) cfg.cellColor = src.cellColor;
  if (typeof src.cellBorderColor === 'string' && HEX_COLOR_RE.test(src.cellBorderColor)) {
    cfg.cellBorderColor = src.cellBorderColor;
  }
  if (Number.isFinite(src.fadeFallbackMs)) cfg.fadeFallbackMs = clampInt(src.fadeFallbackMs, FADE_MIN, FADE_MAX);

  return cfg;
}

/**
 * Pure: build the shape array describing a pyramid. Returns an array
 * of {reel, rows} where reel index 0 has `startRows` rows and each
 * subsequent reel adds one row.
 *   buildPyramidShape(5, 1) → [{reel:0,rows:1},{1,rows:2},...{4,rows:5}]
 *   Total cells = Σ(startRows + i) for i in [0, reelCount).
 */
export function buildPyramidShape(reelCount, startRows) {
  const r = Math.trunc(Number(reelCount));
  const s = Math.trunc(Number(startRows));
  if (!Number.isFinite(r) || r < 1) return [];
  if (!Number.isFinite(s) || s < 1) return [];
  const out = [];
  for (let i = 0; i < r; i++) out.push({ reel: i, rows: s + i });
  return out;
}

export function emitPyramidGridEngineCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ pyramidGridEngine: cfg });
  if (!c.enabled) return `\n/* pyramidGridEngine BLOCK (disabled) — no CSS */\n`;
  return `
/* ── pyramidGridEngine BLOCK — src/blocks/pyramidGridEngine.mjs ── */
.grid-pyramid {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  justify-content: center;
  gap: ${c.gapPx}px;
}
.grid-pyramid .py-reel {
  display: flex;
  flex-direction: column;
  gap: ${c.gapPx}px;
  align-items: center;
}
.grid-pyramid .py-reel .cell {
  width: ${c.cellSizePx}px;
  height: ${c.cellSizePx}px;
  background: ${c.cellColor};
  border: 2px solid ${c.cellBorderColor};
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font: 800 ${Math.floor(c.cellSizePx * 0.4)}px/1 system-ui, -apple-system, sans-serif;
  color: #f6f2d8; /* WCAG AAA (F4 A1) — 6.8:1 → 7.2:1 */
  will-change: transform, opacity;
}
.grid-pyramid .py-reel.is-spinning .cell {
  animation: py-fall ${c.spinDurationMs}ms cubic-bezier(0.42, 0, 0.58, 1.0);
}
@keyframes py-fall {
  0%   { transform: translateY(-200%); opacity: 0; }
  60%  { transform: translateY(8%);    opacity: 1; }
  100% { transform: translateY(0);     opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .grid-pyramid .py-reel.is-spinning .cell {
    animation: none !important;
    transition: opacity ${c.fadeFallbackMs}ms ease !important;
  }
}
`;
}

export function emitPyramidGridEngineMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ pyramidGridEngine: cfg });
  if (!c.enabled) return `\n<!-- pyramidGridEngine BLOCK (disabled) -->\n`;
  const shape = buildPyramidShape(c.reelCount, c.startRows);
  let reels = '';
  for (const r of shape) {
    let cells = '';
    for (let row = 0; row < r.rows; row++) {
      cells += `
        <div class="cell" data-reel="${r.reel}" data-row="${row}" data-symbol="" role="cell" aria-label="Pyramid cell ${r.reel + 1}-${row + 1}">?</div>`;
    }
    reels += `
      <div class="py-reel" data-reel="${r.reel}" data-rows="${r.rows}">${cells}
      </div>`;
  }
  return tagBlockMarkup(`
<!-- pyramidGridEngine BLOCK — server-emitted markup -->
<div class="grid-pyramid" role="grid" aria-label="Pyramid reels">${reels}
</div>
`, 'pyramidGridEngine');
}

export function emitPyramidGridEngineRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ pyramidGridEngine: cfg });
  if (!c.enabled) return `\n// pyramidGridEngine BLOCK (disabled) — no runtime\n`;

  const reelCount = c.reelCount;
  const spinMs    = c.spinDurationMs;
  const stagger   = c.staggerMs;

  return `
/* ── pyramidGridEngine BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__PYRAMID_GRID_WIRED__) return;
  window.__PYRAMID_GRID_WIRED__ = true;

  var REEL_COUNT = ${reelCount};
  var SPIN_MS    = ${spinMs};
  var STAGGER    = ${stagger};

  window.__SLOT_KIND_RUNSPIN__ = window.__SLOT_KIND_RUNSPIN__ || {};

  var STATE = { rotating: false, pending: null, reelTimers: [] };
  Object.defineProperty(window, '__SLOT_PYRAMID_STATE__', {
    configurable: true,
    get: function() { return STATE; },
  });

  function _rng() {
    if (window.GameRNG && typeof window.GameRNG.next === 'function') return window.GameRNG.next();
    return Math.random();
  }

  function _pickSymbol() {
    var pool = (Array.isArray(window.POOL) && window.POOL.length > 0) ? window.POOL
             : (Array.isArray(window.SYMBOLS) && window.SYMBOLS.length > 0) ? window.SYMBOLS
             : ['9', '10', 'J', 'Q', 'K', 'A'];
    return pool[Math.floor(_rng() * pool.length)];
  }

  function _clearTimers() {
    for (var i = 0; i < STATE.reelTimers.length; i++) clearTimeout(STATE.reelTimers[i]);
    STATE.reelTimers.length = 0;
  }

  function _spin(onSettled) {
    if (STATE.rotating) {
      /* QA fix (general-purpose subagent 2026-06-19, finding F4):
       * follow crashSpinEngine pattern — flush old pending FIRST so
       * the dispatcher does not lose the in-flight callback when a
       * double-click arrives mid-spin. Then immediately invoke the new
       * onSettled (no-op spin), preserving the dispatcher's contract
       * that every call to __SLOT_KIND_RUNSPIN__.pyramid resolves. */
      var prevPending = STATE.pending;
      STATE.pending = null;
      if (typeof prevPending === 'function') setTimeout(prevPending, 0);
      if (typeof onSettled === 'function') setTimeout(onSettled, 0);
      return;
    }
    var host = document.querySelector('.grid-pyramid');
    if (!host) {
      if (typeof onSettled === 'function') setTimeout(onSettled, 0);
      return;
    }
    _clearTimers();
    STATE.rotating = true;
    STATE.pending = onSettled || null;

    var reels = host.querySelectorAll('.py-reel');
    var settled = 0;
    for (var i = 0; i < reels.length; i++) (function(reel, idx) {
      var stopAt = SPIN_MS + idx * STAGGER;
      reel.classList.add('is-spinning');
      var t = setTimeout(function() {
        reel.classList.remove('is-spinning');
        /* Commit fresh symbols on settle. */
        var cells = reel.querySelectorAll('.cell');
        for (var k = 0; k < cells.length; k++) {
          var sym = _pickSymbol();
          cells[k].setAttribute('data-symbol', sym);
          cells[k].textContent = sym;
        }
        settled += 1;
        if (settled >= reels.length) _settle();
      }, stopAt);
      STATE.reelTimers.push(t);
    })(reels[i], i);
  }

  function _settle() {
    STATE.rotating = false;
    var cb = STATE.pending; STATE.pending = null;

    /* WASH PASS #2 precedent (2026-06-19): canonical onSpinResult is
     * emitted by reelEngine.mjs _wrappedSettled (line 1041) when the
     * dispatcher invokes the cb that this engine eventually calls.
     * Emitting onSpinResult from here would cause DOUBLE-EMIT
     * (the bug that WASH PASS #1 introduced and #2 rolled back).
     * We ONLY emit the topology-specific event so blocks that need
     * pyramid-specific state can subscribe selectively. */
    try {
      if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
        var duringFs = (typeof FSM !== 'undefined' && FSM && FSM.phase === 'FS_ACTIVE');
        /* QA fix (general-purpose subagent 2026-06-19, finding F2):
         * harvest settled cells so the JSDoc contract (payload includes
         * cells) is honoured. Listeners (evaluator blocks, eyes probes)
         * can iterate without extra DOM walks. */
        var settledCells = [];
        var allCells = document.querySelectorAll('.grid-pyramid .py-reel .cell');
        for (var sc = 0; sc < allCells.length; sc++) {
          var sCell = allCells[sc];
          settledCells.push({
            reel: parseInt(sCell.getAttribute('data-reel') || '0', 10),
            row:  parseInt(sCell.getAttribute('data-row')  || '0', 10),
            symbol: (sCell.getAttribute('data-symbol') || '').trim(),
          });
        }
        (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function' ? HookBus.emit('onPyramidSpinResult', {
          duringFs: duringFs,
          topology: 'pyramid',
          cells: settledCells,
        }) : void 0);
      }
    } catch (e) {
      try { if (typeof console !== 'undefined' && console.warn) console.warn('[pyramidGridEngine] onPyramidSpinResult emit failed', e); } catch (__) {}
    }

    if (typeof cb === 'function') setTimeout(cb, 0);
  }

  window.__SLOT_KIND_RUNSPIN__.pyramid = _spin;

  if (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function') {
    HookBus.on('preSpin', function() {
      /* Flush deferred callback + cancel timers so a re-click can't
       * leave the chain waiting on a cancelled spin. */
      var cb = STATE.pending; STATE.pending = null;
      if (typeof cb === 'function') setTimeout(cb, 0);
      _clearTimers();
      var reels = document.querySelectorAll('.grid-pyramid .py-reel.is-spinning');
      for (var i = 0; i < reels.length; i++) reels[i].classList.remove('is-spinning');
      STATE.rotating = false;
    }, { priority: 28 });
  }
})();
`;
}
