/**
 * src/blocks/symbolSplitReveal.mjs
 *
 * Wave LEGO-SSR — Symbol Split Reveal (oversized block → N×N small wins).
 *
 * Purpose
 * ───────
 *   When an N×N oversized "super symbol" block lands on the reels (carrying
 *   the `data-super-symbol-block` attribute on its anchor cell), post-stop
 *   the block visually splits into its constituent N×N cells. Each cell
 *   is repainted with the SAME pay symbol so a single landed block
 *   contributes N*N paying positions instead of 1. The split is purely a
 *   presentation/expansion of an already-resolved logical placement —
 *   math/eval is upstream. Distinct from:
 *     • expandingWild              (wild expansion across a single reel column)
 *     • cellLevelUpgrade           (per-cell rank promotion)
 *     • clusterSizeMultiplier      (cluster-count → multiplier scaling)
 *     • collectableSymbol          (sticky collection meter)
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Classic "oversized block split" pattern — a 2×2 / 3×3 / 4×4 colossal
 *   stamp lands as one visual unit, then "shatters" into individual
 *   reel cells after the stop, each cell holding the same pay icon, so
 *   the host evaluator counts them as discrete contributing positions.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitSymbolSplitRevealCSS(cfg)
 *   emitSymbolSplitRevealMarkup(cfg)
 *   emitSymbolSplitRevealRuntime(cfg)
 *   findSuperBlocks(grid, blockSize)                     (pure helper, exported for tests)
 *   cellsInBlock(anchor, size, gridReels, gridRows)      (pure helper, exported for tests)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • preSpin        (priority 30) — clear split classes
 *     • onSpinResult   (priority 30) — base branch: scan + split
 *     • onFsSpinResult (priority 30) — fs branch: scan + split
 *     • onFsEnd        (priority 30) — clear split classes
 *   emits:
 *     • onSymbolSplitStarted   { anchor, size, symbol }
 *     • onSymbolSplitRevealed  { anchor, size, symbol, cellCount }
 *     • onSymbolSplitCleared   {}
 *
 * Runtime contract
 * ────────────────
 *   No window-level state required (DOM-driven, idempotent on each spin).
 *
 * GDD config keys (model.symbolSplitReveal)
 * ─────────────────────────────────────────
 *   { enabled, blockSize: 2|3|4, appliesIn: 'base'|'fs'|'both',
 *     revealAnimMs: 200..3000, splitDelayMs: 0..500,
 *     glowColor: hex, pulseMs: 200..2000 }
 *
 * Performance budget: ≤ 0.4 ms per spin settle on 5×4 grid (one O(R*C)
 * scan + at most a handful of N×N cell paints); 1 listener per event
 * (wired-once via window.__SSR_WIRED__).
 *
 * a11y: revealed cells carry aria-label="Split reveal symbol X";
 * prefers-reduced-motion neutralises the pulse keyframe (cells remain
 * highlighted as a static glow without strobing).
 *
 * Vendor-neutral, senior-grade, pure presentation. No math decisions —
 * upstream evaluator owns the contribution count; this block only
 * surfaces the visual N×N expansion of an already-placed block.
 */

const BLOCK_SIZES        = Object.freeze([2, 3, 4]);
const APPLIES_IN         = Object.freeze(['base', 'fs', 'both']);
const REVEAL_ANIM_MIN_MS = 200;
const REVEAL_ANIM_MAX_MS = 3000;
const SPLIT_DELAY_MIN_MS = 0;
const SPLIT_DELAY_MAX_MS = 500;
const PULSE_MIN_MS       = 200;
const PULSE_MAX_MS       = 2000;

const HEX_COLOR_RE       = /^#[0-9a-fA-F]{3,8}$/;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    blockSize: 2,
    appliesIn: 'both',
    revealAnimMs: 600,
    splitDelayMs: 150,
    glowColor: '#ffcc00',
    pulseMs: 800,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.symbolSplitReveal) || {};

  if (src.enabled === true) cfg.enabled = true;

  if (Number.isFinite(src.blockSize) && BLOCK_SIZES.includes(Math.trunc(src.blockSize))) {
    cfg.blockSize = Math.trunc(src.blockSize);
  }

  if (typeof src.appliesIn === 'string' && APPLIES_IN.includes(src.appliesIn)) {
    cfg.appliesIn = src.appliesIn;
  }

  if (Number.isFinite(src.revealAnimMs)) {
    cfg.revealAnimMs = clampInt(src.revealAnimMs, REVEAL_ANIM_MIN_MS, REVEAL_ANIM_MAX_MS);
  }

  if (Number.isFinite(src.splitDelayMs)) {
    cfg.splitDelayMs = clampInt(src.splitDelayMs, SPLIT_DELAY_MIN_MS, SPLIT_DELAY_MAX_MS);
  }

  if (typeof src.glowColor === 'string' && HEX_COLOR_RE.test(src.glowColor)) {
    cfg.glowColor = src.glowColor;
  }

  if (Number.isFinite(src.pulseMs)) {
    cfg.pulseMs = clampInt(src.pulseMs, PULSE_MIN_MS, PULSE_MAX_MS);
  }

  return cfg;
}

/**
 * Pure helper: scan an abstract grid representation for super-symbol
 * block anchors. Grid is expected as a 2D array indexed `grid[reel][row]`
 * whose entries are either `null`/`undefined`/string symbol IDs OR
 * objects carrying `{ symbol, superBlock: true }`. The function returns
 * one record per anchor cell (top-left corner of each N×N block) that
 * fits within the grid bounds.
 *
 * @param {Array<Array<any>>} grid       grid[reel][row]
 * @param {number}            blockSize  expected N (2|3|4)
 * @returns {Array<{anchor:{reel:number,row:number}, symbol:string}>}
 */
export function findSuperBlocks(grid, blockSize) {
  const out = [];
  if (!Array.isArray(grid) || grid.length === 0) return out;
  const size = Math.trunc(blockSize);
  if (!Number.isFinite(size) || size < 1) return out;

  const reels = grid.length;
  const rows  = Array.isArray(grid[0]) ? grid[0].length : 0;
  if (rows === 0) return out;

  for (let r = 0; r <= reels - size; r++) {
    const col = grid[r];
    if (!Array.isArray(col)) continue;
    for (let y = 0; y <= rows - size; y++) {
      const cell = col[y];
      if (!cell || typeof cell !== 'object') continue;
      if (cell.superBlock !== true) continue;
      const sym = typeof cell.symbol === 'string' ? cell.symbol : null;
      if (!sym) continue;
      out.push({ anchor: { reel: r, row: y }, symbol: sym });
    }
  }
  return out;
}

/**
 * Pure helper: enumerate the {reel,row} coordinates an N×N block
 * occupies given its anchor (top-left) cell. Caller is responsible for
 * having validated the anchor fits within the grid; this function still
 * gracefully truncates if `gridReels`/`gridRows` are supplied and the
 * block would otherwise overflow.
 *
 * @param {{reel:number,row:number}} anchor
 * @param {number} size
 * @param {number} gridReels
 * @param {number} gridRows
 * @returns {Array<{reel:number,row:number}>}
 */
export function cellsInBlock(anchor, size, gridReels, gridRows) {
  const out = [];
  if (!anchor || typeof anchor !== 'object') return out;
  const r0 = Number.isFinite(anchor.reel) ? Math.trunc(anchor.reel) : -1;
  const y0 = Number.isFinite(anchor.row)  ? Math.trunc(anchor.row)  : -1;
  const n  = Number.isFinite(size)        ? Math.trunc(size)        : 0;
  if (r0 < 0 || y0 < 0 || n < 1) return out;

  const maxR = Number.isFinite(gridReels) ? Math.trunc(gridReels) : Infinity;
  const maxY = Number.isFinite(gridRows)  ? Math.trunc(gridRows)  : Infinity;

  for (let dr = 0; dr < n; dr++) {
    const r = r0 + dr;
    if (r >= maxR) break;
    for (let dy = 0; dy < n; dy++) {
      const y = y0 + dy;
      if (y >= maxY) break;
      out.push({ reel: r, row: y });
    }
  }
  return out;
}

export function emitSymbolSplitRevealCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ symbolSplitReveal: cfg });
  if (!c.enabled) return `\n/* symbolSplitReveal BLOCK (disabled) — no CSS */\n`;
  return `
/* ── symbolSplitReveal BLOCK — src/blocks/symbolSplitReveal.mjs ── */
.is-split-revealing {
  position: relative;
  box-shadow:
    0 0 0 2px ${c.glowColor}cc,
    0 0 16px ${c.glowColor}88;
  z-index: 5;
  animation: ssr-split-in ${c.revealAnimMs}ms ease-out both;
}
.is-split-revealed {
  position: relative;
  box-shadow:
    0 0 0 2px ${c.glowColor}aa,
    0 0 12px ${c.glowColor}66;
  z-index: 4;
  animation: ssr-pulse ${c.pulseMs}ms ease-in-out infinite alternate;
}
@keyframes ssr-split-in {
  0%   { transform: scale(1.05); opacity: 0.6; filter: brightness(1.3); }
  60%  { transform: scale(0.95); opacity: 1;   filter: brightness(1.15); }
  100% { transform: scale(1);    opacity: 1;   filter: brightness(1); }
}
@keyframes ssr-pulse {
  0%   { filter: brightness(1)    drop-shadow(0 0 0 ${c.glowColor}); }
  100% { filter: brightness(1.2)  drop-shadow(0 0 8px ${c.glowColor}); }
}
@media (prefers-reduced-motion: reduce) {
  .is-split-revealing,
  .is-split-revealed { animation: none; }
}
`;
}

export function emitSymbolSplitRevealMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ symbolSplitReveal: cfg });
  if (!c.enabled) return `\n<!-- symbolSplitReveal BLOCK (disabled) -->\n`;
  /* The split overlay attaches directly to existing grid cells via
   * runtime class toggles, so no server-emitted shell is required. The
   * empty marker keeps the orchestrator's `insert(markup)` slot
   * deterministic. */
  return `
<!-- symbolSplitReveal BLOCK — runtime-mounted on grid cells (no shell) -->
`;
}

export function emitSymbolSplitRevealRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ symbolSplitReveal: cfg });
  if (!c.enabled) return `\n// symbolSplitReveal BLOCK (disabled) — no runtime\n`;

  const blockSize    = c.blockSize;
  const appliesIn    = JSON.stringify(c.appliesIn);
  const revealAnimMs = c.revealAnimMs;
  const splitDelayMs = c.splitDelayMs;

  return `
/* ── symbolSplitReveal BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__SSR_WIRED__) return;
  window.__SSR_WIRED__ = true;

  var BLOCK_SIZE     = ${blockSize};
  var APPLIES_IN     = ${appliesIn};
  var REVEAL_ANIM_MS = ${revealAnimMs};
  var SPLIT_DELAY_MS = ${splitDelayMs};

  function _isFsActive() {
    if (window.FSM && typeof window.FSM === 'object') {
      var st = window.FSM.state || window.FSM.phase;
      if (st && /^FS_/.test(st)) return true;
    }
    if (window.__SLOT_FSM_STATE && /^FS_/.test(window.__SLOT_FSM_STATE)) return true;
    if (window.FREESPINS && window.FREESPINS.remaining > 0) return true;
    return false;
  }

  function _isHwActive() {
    if (window.HW_STATE && window.HW_STATE.active === true) return true;
    if (window.__SLOT_FSM_STATE && /^HW_/.test(window.__SLOT_FSM_STATE)) return true;
    return false;
  }

  function _appliesNow() {
    if (APPLIES_IN === "fs")   return _isFsActive();
    if (APPLIES_IN === "base") return !_isFsActive();
    return true; /* "both" */
  }

  function _reelCount() {
    if (Number.isFinite(window.REELS) && window.REELS > 0) return window.REELS;
    return 5;
  }

  function _rowCount() {
    if (Number.isFinite(window.ROWS) && window.ROWS > 0) return window.ROWS;
    return 4;
  }

  function _cellAt(reel, row) {
    var host = document.getElementById("gridHost");
    if (!host) return null;
    /* Selector convention: cells carry data-reel + data-row attributes.
     * Renderer parity check is layout-only — no game-specific branch. */
    var sel = ".cell[data-reel=\\"" + reel + "\\"][data-row=\\"" + row + "\\"]";
    return host.querySelector(sel);
  }

  function _scanGridForBlocks() {
    var host = document.getElementById("gridHost");
    if (!host) return [];
    var anchors = host.querySelectorAll("[data-super-symbol-block]");
    var out = [];
    for (var i = 0; i < anchors.length; i++) {
      var node = anchors[i];
      var reel = parseInt(node.getAttribute("data-reel"), 10);
      var row  = parseInt(node.getAttribute("data-row"),  10);
      var sym  = node.getAttribute("data-symbol") || node.getAttribute("data-super-symbol-block");
      if (!Number.isFinite(reel) || !Number.isFinite(row)) continue;
      if (typeof sym !== "string" || sym.length === 0) continue;
      out.push({ anchor: { reel: reel, row: row }, symbol: sym });
    }
    return out;
  }

  function _clearSplitClasses() {
    var host = document.getElementById("gridHost");
    if (!host) return;
    var revealing = host.querySelectorAll(".is-split-revealing");
    for (var i = 0; i < revealing.length; i++) {
      revealing[i].classList.remove("is-split-revealing");
    }
    var revealed = host.querySelectorAll(".is-split-revealed");
    for (var j = 0; j < revealed.length; j++) {
      revealed[j].classList.remove("is-split-revealed");
    }
    if (window.HookBus && typeof window.HookBus.emit === "function") {
      try { window.HookBus.emit('onSymbolSplitCleared', {}); } catch (_) {}
    }
  }

  function _cellsForBlock(anchor, size) {
    var R = _reelCount();
    var Y = _rowCount();
    var out = [];
    for (var dr = 0; dr < size; dr++) {
      var r = anchor.reel + dr;
      if (r >= R) break;
      for (var dy = 0; dy < size; dy++) {
        var y = anchor.row + dy;
        if (y >= Y) break;
        out.push({ reel: r, row: y });
      }
    }
    return out;
  }

  function _splitOneBlock(entry) {
    var cells = _cellsForBlock(entry.anchor, BLOCK_SIZE);
    if (cells.length === 0) return;

    if (window.HookBus && typeof window.HookBus.emit === "function") {
      try {
        window.HookBus.emit('onSymbolSplitStarted', {
          anchor: entry.anchor,
          size:   BLOCK_SIZE,
          symbol: entry.symbol,
        });
      } catch (_) {}
    }

    /* Phase 1: mark all cells as "revealing" (split-in animation). */
    var nodes = [];
    for (var i = 0; i < cells.length; i++) {
      var node = _cellAt(cells[i].reel, cells[i].row);
      if (!node) continue;
      node.classList.add("is-split-revealing");
      nodes.push(node);
    }

    /* Phase 2: after revealAnimMs, repaint textContent + flip class. */
    setTimeout(function() {
      for (var k = 0; k < nodes.length; k++) {
        var n = nodes[k];
        n.classList.remove("is-split-revealing");
        n.classList.add("is-split-revealed");
        n.textContent = entry.symbol;
        n.setAttribute("data-symbol", entry.symbol);
        n.setAttribute("aria-label", "Split reveal symbol " + entry.symbol);
      }
      if (window.HookBus && typeof window.HookBus.emit === "function") {
        try {
          window.HookBus.emit('onSymbolSplitRevealed', {
            anchor:    entry.anchor,
            size:      BLOCK_SIZE,
            symbol:    entry.symbol,
            cellCount: nodes.length,
          });
        } catch (_) {}
      }
    }, REVEAL_ANIM_MS);
  }

  function _runSplitPass() {
    if (_isHwActive())   return;
    if (!_appliesNow())  return;
    var blocks = _scanGridForBlocks();
    if (blocks.length === 0) return;
    for (var i = 0; i < blocks.length; i++) {
      var entry = blocks[i];
      var delay = SPLIT_DELAY_MS * i;
      (function(e, d) {
        if (d <= 0) { _splitOneBlock(e); return; }
        setTimeout(function() { _splitOneBlock(e); }, d);
      })(entry, delay);
    }
  }

  function _onPreSpin() {
    _clearSplitClasses();
  }

  function _onSpinResult() {
    if (APPLIES_IN !== "base" && APPLIES_IN !== "both") return;
    if (_isFsActive()) return;
    _runSplitPass();
  }

  function _onFsSpinResult() {
    if (APPLIES_IN !== "fs" && APPLIES_IN !== "both") return;
    if (!_isFsActive()) return;
    _runSplitPass();
  }

  function _onFsEnd() {
    _clearSplitClasses();
  }

  if (window.HookBus && typeof window.HookBus.on === "function") {
    window.HookBus.on("preSpin",        _onPreSpin,       { priority: 30 });
    window.HookBus.on("onSpinResult",   _onSpinResult,    { priority: 30 });
    window.HookBus.on("onFsSpinResult", _onFsSpinResult,  { priority: 30 });
    window.HookBus.on("onFsEnd",        _onFsEnd,         { priority: 30 });
  }
})();
`;
}
