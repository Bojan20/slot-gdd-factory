/**
 * src/blocks/slingoSpinEngine.mjs
 *
 * Wave J3 — Slingo board + strip animation.
 *
 * Industry-reference rationale
 * ────────────────────────────
 *   Slingo combines bingo + slot: 5×5 marked board + 1×5 strip that
 *   spins to reveal a new row. Each strip column independently spins
 *   (vertical translate of cell labels) until it lands on a fresh
 *   symbol; if that symbol exists on the board column above it, the
 *   board cell illuminates as a "match".
 *
 *   Pre-J3 the kind dropped into runStaticReroll() — instant blink.
 *   This block adds:
 *     • Per-column strip spin with stop-stagger.
 *     • Match-reveal CSS class on matched board cells.
 *
 * Composition contract (LEGO ownership)
 * ────────────────────────────────────
 *   • SOLE OWNER of slingo strip animation. Registers
 *     window.__SLOT_KIND_RUNSPIN__.slingo.
 *   • Reads: SHAPE.kind, document (DOM root), POOL, HookBus.
 *   • Owns the 5 strip cells animation + `.slingo-match` class on
 *     winning board cells.
 *
 * Lifecycle
 * ─────────
 *   preSpin → cancel pending column timers + clear match highlights
 *             so the next round starts clean.
 *
 * Vendor neutrality
 * ─────────────────
 *   Zero vendor mentions. Generic "5×5 marked board + strip" reference.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitSlingoSpinEngineCSS(cfg)
 *   emitSlingoSpinEngineRuntime(cfg)
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  perColumnSpinMs: 750,
  staggerMs: 140,
  matchPulseMs: 480,
  fadeFallbackMs: 220,
});

export function defaultConfig() { return { ...DEFAULTS }; }

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

export function resolveConfig(model) {
  const cfg = defaultConfig();
  const src = (model && model.slingoSpinEngine) || {};
  const intMap = [
    ['perColumnSpinMs', 250, 4000],
    ['staggerMs',         0,  500],
    ['matchPulseMs',    120, 2000],
    ['fadeFallbackMs',   40,  800],
  ];
  for (const [k, lo, hi] of intMap) {
    const v = clampInt(src[k], lo, hi);
    if (v !== null) cfg[k] = v;
  }
  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  return cfg;
}

/* ── Emit ─────────────────────────────────────────────────────── */

export function emitSlingoSpinEngineCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ── Slingo spin engine (Wave J3) ───────────────────────────── */
.grid-slingo .grid-rect:last-child .cell {
  /* Strip cells flicker through symbols during spin. */
  will-change: transform, opacity;
}
.grid-slingo .grid-rect:last-child .cell.is-spinning {
  animation: slingoStripCycle ${Math.max(60, Math.floor(cfg.perColumnSpinMs / 8))}ms steps(1, end) infinite;
}
@keyframes slingoStripCycle {
  0%   { transform: translateY(-6px); opacity: 0.85; }
  50%  { transform: translateY(0);    opacity: 1.0;  }
  100% { transform: translateY(6px);  opacity: 0.85; }
}
.grid-slingo .cell.slingo-match {
  outline: 2px solid #ffd76a;
  outline-offset: -3px;
  animation: slingoMatchPulse ${cfg.matchPulseMs}ms ease-out;
}
@keyframes slingoMatchPulse {
  0%   { box-shadow: 0 0 0 rgba(255, 215, 106, 0.0); }
  50%  { box-shadow: 0 0 14px rgba(255, 215, 106, 0.7); }
  100% { box-shadow: 0 0 0 rgba(255, 215, 106, 0.0); }
}
@media (prefers-reduced-motion: reduce) {
  .grid-slingo .grid-rect:last-child .cell.is-spinning,
  .grid-slingo .cell.slingo-match {
    animation: none !important;
    transition: opacity ${cfg.fadeFallbackMs}ms ease !important;
  }
}
`;
}

export function emitSlingoSpinEngineRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const SPIN_MS = cfg.perColumnSpinMs;
  const STAGGER = cfg.staggerMs;
  return `
  /* ── Slingo spin runtime (Wave J3) ─────────────────────────── */
  (function () {
    if (!SHAPE || SHAPE.kind !== 'slingo') return;
    window.__SLOT_KIND_RUNSPIN__ = window.__SLOT_KIND_RUNSPIN__ || {};

    var STATE = { running: false, columnTimers: [], pending: null };
    Object.defineProperty(window, '__SLOT_SLINGO_STATE__', {
      configurable: true,
      get: function () { return STATE; },
    });

    function _resolveStripCells() {
      var host = document.querySelector('.grid-slingo');
      if (!host) return [];
      var stripGrid = host.querySelectorAll('.grid-rect')[1];
      return stripGrid ? Array.from(stripGrid.querySelectorAll('.cell')) : [];
    }
    function _resolveBoardCells() {
      var host = document.querySelector('.grid-slingo');
      if (!host) return [];
      var boardGrid = host.querySelectorAll('.grid-rect')[0];
      return boardGrid ? Array.from(boardGrid.querySelectorAll('.cell')) : [];
    }

    function _randSym() { return POOL[Math.floor(Math.random() * POOL.length)]; }

    function _clearTimers() {
      for (var i = 0; i < STATE.columnTimers.length; i++) clearTimeout(STATE.columnTimers[i]);
      STATE.columnTimers.length = 0;
    }

    function _clearMatches() {
      var board = _resolveBoardCells();
      for (var i = 0; i < board.length; i++) board[i].classList.remove('slingo-match');
    }

    function _spin(onSettled) {
      var strip = _resolveStripCells();
      var board = _resolveBoardCells();
      if (!strip.length) {
        if (typeof onSettled === 'function') setTimeout(onSettled, 0);
        return;
      }
      _clearTimers();
      _clearMatches();
      STATE.running = true;
      STATE.pending = onSettled || null;

      /* Arm every column with spinning class. */
      for (var c = 0; c < strip.length; c++) strip[c].classList.add('is-spinning');

      var completed = 0;
      function _settle() {
        STATE.running = false;
        var cb = STATE.pending; STATE.pending = null;
        /* onSpinResult is emitted by the dispatcher (reelEngine). */
        if (typeof cb === 'function') setTimeout(cb, 0);
      }

      for (var c = 0; c < strip.length; c++) {
        (function (col) {
          var stopAt = ${SPIN_MS} + col * ${STAGGER};
          var t = setTimeout(function () {
            strip[col].classList.remove('is-spinning');
            strip[col].textContent = _randSym();
            /* Check the board column (5 board cells stacked) for any
               cell that matches the new strip symbol. */
            var symbol = strip[col].textContent;
            for (var r = 0; r < 5; r++) {
              var boardCell = board[r * 5 + col];
              if (boardCell && boardCell.textContent === symbol) {
                boardCell.classList.add('slingo-match');
              }
            }
            completed++;
            if (completed === strip.length) _settle();
          }, stopAt);
          STATE.columnTimers.push(t);
        })(c);
      }
    }

    if (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function') {
      HookBus.on('preSpin', function () {
        _clearTimers();
        _clearMatches();
        var strip = _resolveStripCells();
        for (var i = 0; i < strip.length; i++) strip[i].classList.remove('is-spinning');
        STATE.running = false;
      });
    }

    window.__SLOT_KIND_RUNSPIN__.slingo = _spin;
  })();
`;
}
