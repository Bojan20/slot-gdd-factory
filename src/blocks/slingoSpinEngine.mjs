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
 * Performance budget
 * ──────────────────
 *   ≤5 strip cells, ≤25 board cells touched per spin; <2ms total DOM
 *   work per settle on Moto G4-class hardware.
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
  minStopMs: 40,
  stripCycleDivisor: 8,
  stripCycleMinMs: 60,
  stripTranslatePx: 6,
  stripFadeOpacity: 0.85,
  matchOutlinePx: 2,
  matchOutlineOffsetPx: -3,
  matchGlowPx: 14,
  matchGlowAlpha: 0.7,
  matchOutlineColor: '#ffd76a',
  triggerSymbolFallback: 'S',
});

export function defaultConfig() { return { ...DEFAULTS }; }

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.slingoSpinEngine) || {};
  const intMap = [
    ['perColumnSpinMs', 250, 4000],
    ['staggerMs',         0,  500],
    ['matchPulseMs',    120, 2000],
    ['fadeFallbackMs',   40,  800],
    ['minStopMs',         1,  500],
    ['stripCycleDivisor', 1,   64],
    ['stripCycleMinMs',  10,  500],
    ['stripTranslatePx',  0,   64],
    ['matchOutlinePx',    0,   16],
    ['matchOutlineOffsetPx', -32, 32],
    ['matchGlowPx',       0,   64],
  ];
  for (const [k, lo, hi] of intMap) {
    const v = clampInt(src[k], lo, hi);
    if (v !== null) cfg[k] = v;
  }
  const floatMap = [
    ['stripFadeOpacity', 0, 1],
    ['matchGlowAlpha',   0, 1],
  ];
  for (const [k, lo, hi] of floatMap) {
    const v = src[k];
    if (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi) cfg[k] = v;
  }
  if (typeof src.matchOutlineColor === 'string' && src.matchOutlineColor) {
    cfg.matchOutlineColor = src.matchOutlineColor;
  }
  if (typeof src.triggerSymbolFallback === 'string' && src.triggerSymbolFallback) {
    cfg.triggerSymbolFallback = src.triggerSymbolFallback;
  }
  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  return cfg;
}

/* ── Emit ─────────────────────────────────────────────────────── */

function _hexToRgb(hex) {
  var h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
  var n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function emitSlingoSpinEngineCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const rgb = _hexToRgb(cfg.matchOutlineColor);
  const rgbStr = rgb.r + ', ' + rgb.g + ', ' + rgb.b;
  return `
/* ── Slingo spin engine (Wave J3) ───────────────────────────── */
.grid-slingo .grid-rect:last-child .cell {
  /* Strip cells flicker through symbols during spin. */
  will-change: transform, opacity;
}
.grid-slingo .grid-rect:last-child .cell.is-spinning {
  animation: slingoStripCycle ${Math.max(cfg.stripCycleMinMs, Math.floor(cfg.perColumnSpinMs / cfg.stripCycleDivisor))}ms steps(1, end) infinite;
}
@keyframes slingoStripCycle {
  0%   { transform: translateY(-${cfg.stripTranslatePx}px); opacity: ${cfg.stripFadeOpacity}; }
  50%  { transform: translateY(0);    opacity: 1.0;  }
  100% { transform: translateY(${cfg.stripTranslatePx}px);  opacity: ${cfg.stripFadeOpacity}; }
}
.grid-slingo .cell.slingo-match {
  outline: ${cfg.matchOutlinePx}px solid ${cfg.matchOutlineColor};
  outline-offset: ${cfg.matchOutlineOffsetPx}px;
  animation: slingoMatchPulse ${cfg.matchPulseMs}ms ease-out;
}
@keyframes slingoMatchPulse {
  0%   { box-shadow: 0 0 0 rgba(${rgbStr}, 0.0); }
  50%  { box-shadow: 0 0 ${cfg.matchGlowPx}px rgba(${rgbStr}, ${cfg.matchGlowAlpha}); }
  100% { box-shadow: 0 0 0 rgba(${rgbStr}, 0.0); }
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
  const MIN_STOP = cfg.minStopMs;
  const TRIG_FALLBACK = JSON.stringify(cfg.triggerSymbolFallback);
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
      var stripGrid = host.querySelector('.grid-rect[data-role="strip"]')
                    || host.querySelectorAll('.grid-rect')[1];
      return stripGrid ? Array.from(stripGrid.querySelectorAll('.cell')) : [];
    }
    function _resolveBoardCells() {
      var host = document.querySelector('.grid-slingo');
      if (!host) return [];
      var boardGrid = host.querySelector('.grid-rect[data-role="board"]')
                    || host.querySelectorAll('.grid-rect')[0];
      return boardGrid ? Array.from(boardGrid.querySelectorAll('.cell')) : [];
    }
    function _ensureAriaStatus() {
      var host = document.querySelector('.grid-slingo');
      if (!host) return null;
      var node = host.querySelector('.slingo-aria-status');
      if (!node) {
        node = document.createElement('div');
        node.className = 'slingo-aria-status';
        node.setAttribute('aria-live', 'polite');
        node.setAttribute('role', 'status');
        node.style.position = 'absolute';
        node.style.width = '1px';
        node.style.height = '1px';
        node.style.overflow = 'hidden';
        node.style.clip = 'rect(0 0 0 0)';
        host.appendChild(node);
      }
      return node;
    }

    function _randSym() {
      var p = (typeof POOL !== 'undefined' && POOL && POOL.length) ? POOL : null;
      return p ? p[Math.floor(Math.random() * p.length)] : ${TRIG_FALLBACK};
    }

    function _clearTimers() {
      for (var i = 0; i < STATE.columnTimers.length; i++) clearTimeout(STATE.columnTimers[i]);
      STATE.columnTimers.length = 0;
    }

    function _clearMatches() {
      var board = _resolveBoardCells();
      for (var i = 0; i < board.length; i++) board[i].classList.remove('slingo-match');
    }

    function _spin(onSettled) {
      if (STATE.running) {
        var prevPending = STATE.pending;
        STATE.pending = null;
        if (typeof prevPending === 'function') setTimeout(prevPending, 0);
        _clearTimers();
      }
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

      var rows = (typeof SHAPE !== 'undefined' && SHAPE && (SHAPE.rows|0)) || strip.length;
      var cols = (typeof SHAPE !== 'undefined' && SHAPE && (SHAPE.cols|0)) || strip.length;
      var aria = _ensureAriaStatus();
      var matchCount = 0;

      var completed = 0;
      function _settle() {
        STATE.running = false;
        var cb = STATE.pending; STATE.pending = null;
        if (aria) {
          aria.textContent = matchCount > 0
            ? ('Matched ' + matchCount + ' cell' + (matchCount === 1 ? '' : 's'))
            : 'No matches';
        }
        /* onSpinResult is emitted by the dispatcher (reelEngine). */
        if (typeof cb === 'function') setTimeout(cb, 0);
      }

      /* 2026-06-09 — Boki bug fix: slingo strip ignored FORCE_TRIGGER so
       * UFP FS chip + Buy Bonus failed silently on slingo (no scatter
       * planted on the strip → 0 scatter count → no FS trigger). Plant
       * the trigger symbol on the first N strip columns when the flag is
       * armed; same contract as reelEngine.commitStopSymbols. */
      var _forceN = (typeof FORCE_TRIGGER !== 'undefined' && FORCE_TRIGGER && FORCE_TRIGGER.scatterCount > 0)
        ? FORCE_TRIGGER.scatterCount : 0;
      var _trig = (window.FREESPINS && window.FREESPINS.triggerSymbol) || ${TRIG_FALLBACK};
      /* Turbo gate — Boki bug: turbo had no observable effect on slingo. */
      var _tm = (typeof window.__SLOT_TURBO_SPEED_MULT__ === 'number' && window.__SLOT_TURBO_SPEED_MULT__ > 0)
        ? window.__SLOT_TURBO_SPEED_MULT__ : 1.0;
      for (var c = 0; c < strip.length; c++) {
        (function (col) {
          var stopAt = Math.max(${MIN_STOP}, Math.round((${SPIN_MS} + col * ${STAGGER}) * _tm));
          var t = setTimeout(function () {
            strip[col].classList.remove('is-spinning');
            strip[col].textContent = (col < _forceN) ? String(_trig) : _randSym();
            /* Check the board column for any cell that matches the new
               strip symbol. */
            var symbol = strip[col].textContent;
            for (var r = 0; r < rows; r++) {
              var boardCell = board[r * cols + col];
              if (boardCell && boardCell.textContent === symbol) {
                boardCell.classList.add('slingo-match');
                matchCount++;
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
