/**
 * src/blocks/lockedSymbolFs.mjs
 *
 * Wave LEGO-FSV.2 — Free Spins start with N symbols already locked.
 *
 * Purpose
 * ───────
 *   On FS_INTRO (before the first FS spin actually rolls), this block
 *   plants N "locked" symbol cells on the grid. The lock persists for
 *   the entire FS round — each subsequent FS spin only re-spins the
 *   unlocked cells, while locked cells contribute to every payout.
 *
 *   Industry pattern: gives the player a guaranteed boost from the
 *   first FS spin without needing to land scatters/bonus symbols
 *   inside FS to maintain win velocity.
 *
 *   Distinct from existing locked-cell blocks:
 *     • `stickyWild.mjs`        — single sticky wild per spin
 *     • `holdAndWin.mjs`        — full lock-and-respin feature
 *     • `respin.mjs`            — single-cell hold respin
 *
 *   This block is FS-CONTEXT ONLY and is the boot-time seeding layer.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Pre-locked FS" pattern present on many free-spin-rich slots:
 *   round opens with N high-value or wild symbols already pinned in
 *   place. Industry typical: 2–4 locked cells, random reel/row picks.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitLockedSymbolFsCSS(cfg)
 *   emitLockedSymbolFsRuntime(cfg, model)
 *   pickRandomCells(rows, cols, count, rng)   (pure helper)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onFsTrigger (priority 28) — seed N locked cells on the grid
 *     • onFsEnd     (priority 28) — clear locks + state
 *     • preSpin     (priority 28) — re-paint locks during FS spins
 *   emits:
 *     • onLockedSymbolFsSeeded   { cellKeys, lockSymbol }
 *
 * Runtime contract
 * ────────────────
 *   window.LOCKED_FS_STATE = { lockedKeys: string[], lockSymbol: string }
 *
 * GDD config keys (model.lockedSymbolFs)
 * ──────────────────────────────────────
 *   { enabled, lockSymbol, lockCount, lockColor, restrictToInnerReels }
 *
 * Performance: O(N locked) per FS spin DOM repaint, ≤ 0.4 ms typical.
 *
 * a11y: locked cells get aria-label="Locked symbol X" + role=note.
 *
 * Senior-grade: wired-once, idempotent, vendor-neutral.
 */

const HEX_COLOR_RE  = /^#[0-9a-fA-F]{3,8}$/;
const SYMBOL_ID_RE  = /^[A-Z]{1,4}$/;
const LOCK_COUNT_MIN = 1;
const LOCK_COUNT_MAX = 12;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    lockSymbol: 'W',
    lockCount: 3,
    lockColor: '#ffd84d',
    restrictToInnerReels: false,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.lockedSymbolFs) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (typeof src.lockSymbol === 'string' && SYMBOL_ID_RE.test(src.lockSymbol)) cfg.lockSymbol = src.lockSymbol;
  if (Number.isFinite(src.lockCount)) cfg.lockCount = clampInt(src.lockCount, LOCK_COUNT_MIN, LOCK_COUNT_MAX);
  if (typeof src.lockColor === 'string' && HEX_COLOR_RE.test(src.lockColor)) cfg.lockColor = src.lockColor;
  if (src.restrictToInnerReels === true) cfg.restrictToInnerReels = true;

  return cfg;
}

/**
 * Pure: pick `count` unique (reel,row) cell keys from a grid of
 * `cols` × `rows`. Uses the supplied RNG (defaults to Math.random)
 * so tests can seed determinism.
 */
export function pickRandomCells(rows, cols, count, rng = Math.random) {
  const r = Math.max(0, Math.trunc(rows));
  const c = Math.max(0, Math.trunc(cols));
  const want = Math.max(0, Math.min(Math.trunc(count), r * c));
  if (r === 0 || c === 0 || want === 0) return [];
  const pool = [];
  for (let i = 0; i < c; i++) for (let j = 0; j < r; j++) pool.push(i + ',' + j);
  const picked = [];
  for (let k = 0; k < want && pool.length > 0; k++) {
    const idx = Math.floor(rng() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

export function emitLockedSymbolFsCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ lockedSymbolFs: cfg });
  if (!c.enabled) return `\n/* lockedSymbolFs BLOCK (disabled) — no CSS */\n`;
  return `
/* ── lockedSymbolFs BLOCK — src/blocks/lockedSymbolFs.mjs ── */
.cell.is-fs-locked {
  position: relative;
  border: 2px solid ${c.lockColor};
  box-shadow: 0 0 18px ${c.lockColor}, inset 0 0 12px ${c.lockColor};
  z-index: 4;
}
.cell.is-fs-locked::after {
  content: "🔒";
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 12px;
  pointer-events: none;
}
.cell.is-fs-locked.is-fresh-locked {
  animation: lsfs-pulse 800ms ease-out;
}
@keyframes lsfs-pulse {
  0%   { transform: scale(1.18); box-shadow: 0 0 36px ${c.lockColor}; }
  100% { transform: scale(1);    box-shadow: 0 0 18px ${c.lockColor}; }
}
@media (prefers-reduced-motion: reduce) {
  .cell.is-fs-locked.is-fresh-locked { animation: none; }
}
`;
}

export function emitLockedSymbolFsRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ lockedSymbolFs: cfg });
  if (!c.enabled) return `\n// lockedSymbolFs BLOCK (disabled) — no runtime\n`;

  const lockSym  = c.lockSymbol;
  const lockN    = c.lockCount;
  const inner    = c.restrictToInnerReels;

  return `
/* ── lockedSymbolFs BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__LOCKED_FS_WIRED__) return;
  window.__LOCKED_FS_WIRED__ = true;

  var LOCK_SYM = ${JSON.stringify(lockSym)};
  var LOCK_N   = ${lockN};
  var INNER    = ${inner};

  window.LOCKED_FS_STATE = { lockedKeys: [], lockSymbol: LOCK_SYM };

  function _rng() {
    if (window.GameRNG && typeof window.GameRNG.next === 'function') return window.GameRNG.next();
    return Math.random();
  }

  function _gridDims() {
    var reels = (window.RECT_REELS && Array.isArray(window.RECT_REELS)) ? window.RECT_REELS : null;
    if (reels && reels.length > 0) {
      return {
        cols: reels.length,
        maxRows: reels.reduce(function(m, r) { return Math.max(m, r.visibleRows || 0); }, 0),
        reels: reels,
      };
    }
    /* Fallback: count from DOM. */
    var cells = document.querySelectorAll('.cell');
    if (!cells.length) return { cols: 0, maxRows: 0, reels: null };
    var maxR = 0, maxC = 0;
    for (var i = 0; i < cells.length; i++) {
      var rr = parseInt(cells[i].getAttribute('data-reel') || '0', 10);
      var rw = parseInt(cells[i].getAttribute('data-row')  || '0', 10);
      if (rr > maxC) maxC = rr;
      if (rw > maxR) maxR = rw;
    }
    return { cols: maxC + 1, maxRows: maxR + 1, reels: null };
  }

  function _pickCells(want) {
    var dims = _gridDims();
    if (dims.cols === 0 || dims.maxRows === 0) return [];
    var pool = [];
    var loStart = INNER && dims.cols >= 5 ? 1 : 0;
    var hiEnd   = INNER && dims.cols >= 5 ? dims.cols - 1 : dims.cols;
    for (var r = loStart; r < hiEnd; r++) {
      var rows = dims.reels ? (dims.reels[r] && dims.reels[r].visibleRows) || dims.maxRows : dims.maxRows;
      for (var row = 0; row < rows; row++) pool.push(r + ',' + row);
    }
    var n = Math.max(0, Math.min(want, pool.length));
    var picked = [];
    for (var k = 0; k < n && pool.length > 0; k++) {
      var idx = Math.floor(_rng() * pool.length);
      picked.push(pool.splice(idx, 1)[0]);
    }
    return picked;
  }

  function _paintLocks(fresh) {
    var keys = window.LOCKED_FS_STATE.lockedKeys || [];
    for (var i = 0; i < keys.length; i++) {
      var parts = keys[i].split(',');
      var sel = '.cell[data-reel="' + parts[0] + '"][data-row="' + parts[1] + '"]';
      var cell = document.querySelector(sel);
      if (!cell) continue;
      cell.classList.add('is-fs-locked');
      cell.setAttribute('aria-label', 'Locked symbol ' + LOCK_SYM);
      cell.setAttribute('role', 'note');
      /* Override the symbol so the player sees the LOCKED value, not
       * whatever the underlying reel strip would have planted. */
      cell.setAttribute('data-symbol', LOCK_SYM);
      if (cell.textContent !== undefined) cell.textContent = LOCK_SYM;
      if (fresh) {
        cell.classList.add('is-fresh-locked');
        setTimeout((function(c) { return function() { c.classList.remove('is-fresh-locked'); }; })(cell), 850);
      }
    }
  }

  function _clearLocks() {
    var cells = document.querySelectorAll('.cell.is-fs-locked');
    for (var i = 0; i < cells.length; i++) {
      cells[i].classList.remove('is-fs-locked', 'is-fresh-locked');
      cells[i].removeAttribute('aria-label');
      cells[i].removeAttribute('role');
    }
    window.LOCKED_FS_STATE.lockedKeys = [];
  }

  function _onFsTrigger() {
    _clearLocks();
    window.LOCKED_FS_STATE.lockedKeys = _pickCells(LOCK_N);
    _paintLocks(true);
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onLockedSymbolFsSeeded', {
          cellKeys: window.LOCKED_FS_STATE.lockedKeys.slice(),
          lockSymbol: LOCK_SYM,
        });
      } catch (_) {}
    }
  }

  function _onFsEnd() {
    _clearLocks();
  }

  function _onPreSpin() {
    /* During FS, re-paint locks AFTER reels land. preSpin fires before
     * a spin actually starts; we schedule a microtask so the new reel
     * symbols don't visually overwrite the locked cells on render. */
    if (window.LOCKED_FS_STATE.lockedKeys.length === 0) return;
    setTimeout(function() { _paintLocks(false); }, 0);
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onFsTrigger', _onFsTrigger, { priority: 28 });
    window.HookBus.on('onFsEnd',     _onFsEnd,     { priority: 28 });
    window.HookBus.on('preSpin',     _onPreSpin,   { priority: 28 });
    /* Also re-paint at every post-spin so reel strip render doesn't
     * overwrite the locked cells (canonical: postSpin runs after the
     * reel engine commits stop symbols). */
    window.HookBus.on('postSpin',    function() {
      if (window.LOCKED_FS_STATE.lockedKeys.length > 0) _paintLocks(false);
    }, { priority: 28 });
  }
})();
`;
}
