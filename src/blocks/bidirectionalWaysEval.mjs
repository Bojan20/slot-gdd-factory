import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/bidirectionalWaysEval.mjs
 *
 * Wave LEGO-BW1 — Bidirectional ways evaluator ("win-both-ways").
 *
 * Purpose
 * ───────
 *   Industry-reference "win-both-ways" paytable evaluator. Walks the
 *   grid in BOTH directions as SEPARATE pays:
 *     • LTR — runs anchored at reel 0, marching towards reel N-1.
 *     • RTL — runs anchored at reel N-1, marching towards reel 0.
 *   A symbol that hits a strict consecutive run from EITHER edge of the
 *   reel set scores; both directions can score on the same spin, which
 *   is why a 243-ways grid becomes "243-both-ways = 486 effective ways".
 *
 *   Distinct from sibling evaluators:
 *     • waysEval        — LTR by default; direction is a single knob.
 *     • allWaysEval     — any consecutive position, not edge-anchored.
 *     • payAnywhereEval — count-based scatter pays, no geometry at all.
 *   This block is the STRICTER edge-anchored subset, intentionally a
 *   separate LEGO piece so the LTR/RTL semantics are explicit and the
 *   pays land as two distinct events on the bus.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Classic "win-both-ways pattern" — a wide industry baseline where the
 *   leftmost-anchored runs and rightmost-anchored runs are independent
 *   awards stacked together on the round.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitBidirectionalWaysEvalCSS(cfg)
 *   emitBidirectionalWaysEvalMarkup(cfg)
 *   emitBidirectionalWaysEvalRuntime(cfg)
 *   evaluateLTR(grid, paytable, minRunLength, wildId)   (pure helper, exported for tests)
 *   evaluateRTL(grid, paytable, minRunLength, wildId)   (pure helper, exported for tests)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • onSpinResult (priority 80) — evaluates both directions on settle
 *     • preSpin       (priority 80) — clears any prior highlight + state
 *     • onFsEnd       (priority 80) — clears state on FS exit
 *   emits:
 *     • onBidirectionalWaysPay     { wins, ltrCount, rtlCount, totalPayX }
 *     • onBidirectionalWaysCleared {}
 *
 * Runtime contract
 * ────────────────
 *   window.BIDIR_WAYS_STATE       = { wins, ltrCount, rtlCount, totalPayX }
 *   window.evaluateBidirectionalWays(grid) → wins[]   (DOM-free helper)
 *
 * GDD config keys (model.bidirectionalWaysEval)
 * ─────────────────────────────────────────────
 *   { enabled, ltrEnabled, rtlEnabled, minRunLength (2-5),
 *     paytable: { [symbolId]: [px3, px4, px5] },
 *     countWildAsAny, highlightLTR (hex), highlightRTL (hex) }
 *
 * Performance budget: ≤ 0.4 ms / spin on a 5×4 grid; ≤ 1.2 ms on 6×5.
 * Pure helpers allocate no DOM; runtime wires once via the
 * window.__BIDIR_WAYS_EVAL_WIRED__ sentinel so re-mounting the slot
 * (hot-reload) never double-attaches listeners.
 *
 * a11y: highlight rings carry role=presentation; pure colour changes
 * never replace the textual win-rollup which remains aria-live=polite
 * via the global winPresentation block.
 *
 * Vendor-neutral, senior-grade, pure presentation + state. No math
 * hooks beyond emitting the resolved pays to HookBus.
 */

const MIN_RUN_LO = 2;
const MIN_RUN_HI = 5;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

const DEFAULT_PAYTABLE = Object.freeze({
  H1: [10, 25, 100],
  H2: [ 8, 20,  75],
  H3: [ 5, 15,  50],
  L1: [ 2,  5,  20],
  L2: [ 2,  5,  20],
  L3: [ 1,  3,  10],
});

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    ltrEnabled: true,
    rtlEnabled: true,
    minRunLength: 3,
    paytable: Object.fromEntries(
      Object.entries(DEFAULT_PAYTABLE).map(([k, v]) => [k, v.slice()]),
    ),
    countWildAsAny: true,
    highlightLTR: '#ffaa00',
    highlightRTL: '#00aaff',
  });
}

/**
 * Strictly validate the GDD paytable shape: object whose values are
 * numeric arrays of length ≥ 1. Returns the cleaned copy or null when
 * the input doesn't pass — caller falls back to defaults rather than
 * silently corrupting the merge.
 */
function _validatePaytable(src) {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
  const out = {};
  let kept = 0;
  for (const k of Object.keys(src)) {
    const row = src[k];
    if (!Array.isArray(row) || row.length === 0) continue;
    if (!row.every(n => Number.isFinite(n) && n >= 0)) continue;
    out[String(k).toUpperCase()] = row.map(n => Number(n));
    kept++;
  }
  return kept > 0 ? out : null;
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.bidirectionalWaysEval) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (src.ltrEnabled === false) cfg.ltrEnabled = false;
  if (src.rtlEnabled === false) cfg.rtlEnabled = false;

  if (Number.isFinite(src.minRunLength)) {
    cfg.minRunLength = clampInt(src.minRunLength, MIN_RUN_LO, MIN_RUN_HI);
  }

  const cleaned = _validatePaytable(src.paytable);
  if (cleaned) cfg.paytable = cleaned;

  if (src.countWildAsAny === false) cfg.countWildAsAny = false;

  if (typeof src.highlightLTR === 'string' && HEX_COLOR_RE.test(src.highlightLTR)) {
    cfg.highlightLTR = src.highlightLTR;
  }
  if (typeof src.highlightRTL === 'string' && HEX_COLOR_RE.test(src.highlightRTL)) {
    cfg.highlightRTL = src.highlightRTL;
  }

  return cfg;
}

/**
 * Read a column (reel) out of a 2-D grid laid out as
 * grid[rowIndex][reelIndex]. Returns the Set of distinct, non-empty
 * symbol ids that appear on that reel.
 */
function _symbolsOnReel(grid, reelIdx) {
  const out = new Set();
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    const sym = row[reelIdx];
    if (sym != null && sym !== '') out.add(String(sym).toUpperCase());
  }
  return out;
}

/**
 * Count how many positions on a reel match a target symbol, with wild
 * treated as a substitute when wildId is supplied.
 */
function _countOnReel(grid, reelIdx, sym, wildId) {
  let n = 0;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    const cell = row[reelIdx];
    if (cell == null) continue;
    const norm = String(cell).toUpperCase();
    if (norm === sym || (wildId && norm === wildId)) n++;
  }
  return n;
}

/**
 * Collect the {r, c} cell coordinates that participate in a run for a
 * single symbol across a list of reel indexes. Pure: returns plain
 * objects so it can be tested headlessly.
 */
function _collectCells(grid, reelIdxList, sym, wildId) {
  const out = [];
  for (const c of reelIdxList) {
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r];
      if (!row) continue;
      const cell = row[c];
      if (cell == null) continue;
      const norm = String(cell).toUpperCase();
      if (norm === sym || (wildId && norm === wildId)) out.push({ r, c });
    }
  }
  return out;
}

/**
 * Pure LTR evaluator. Starts at reel 0, walks rightwards. For every
 * paytable symbol, counts consecutive reels that contain it (or wild
 * if substitution is on), multiplies counts to get "ways". Pays only
 * when run length ≥ minRunLength.
 *
 * Returns wins[] of { symbol, direction:'LTR', reelsHit, payX, cells }.
 */
export function evaluateLTR(grid, paytable, minRunLength, wildId) {
  if (!Array.isArray(grid) || grid.length === 0) return [];
  const rowSample = grid.find(r => Array.isArray(r));
  if (!rowSample || rowSample.length === 0) return [];
  if (!paytable || typeof paytable !== 'object') return [];
  /* QA sweep (2026-06-19): normalize wildId case so caller can pass
   * 'w' or 'W' interchangeably — matches runtime behavior on L390. */
  wildId = String(wildId || '').toUpperCase();
  const reels = rowSample.length;
  const wins = [];
  const seen = new Set();

  const reel0Syms = _symbolsOnReel(grid, 0);
  const candidates = new Set();
  for (const s of reel0Syms) {
    if (paytable[s]) candidates.add(s);
    if (wildId && s === wildId) {
      // wild on reel 0 anchors every paying symbol
      for (const k of Object.keys(paytable)) candidates.add(k);
    }
  }

  for (const sym of candidates) {
    /* FIX-7.1 (deep QA #28, 2026-06-19) — explicit empty/nullish guard
     * instead of falsy `if (!sym)`. A numeric tier id of "0" would be
     * truthy as a string but falsy as a coerced number, so the previous
     * generic falsy check could either accept '0' or accidentally reject
     * a valid string-converted zero. Defensive-on-input: only skip when
     * sym is literally empty or nullish. */
    if (sym === '' || sym == null) continue;
    if (seen.has(sym)) continue;
    seen.add(sym);
    let ways = 0;
    let run = 0;
    const reelsHit = [];
    for (let i = 0; i < reels; i++) {
      const cnt = _countOnReel(grid, i, sym, wildId);
      if (cnt === 0) break;
      ways = ways === 0 ? cnt : ways * cnt;
      run++;
      reelsHit.push(i);
    }
    if (run < minRunLength) continue;
    const row = paytable[sym];
    if (!row || row.length === 0) continue;
    // row indexed by (run - minRunLength); clamp to last bucket
    const idx = Math.min(run - minRunLength, row.length - 1);
    const px = Number(row[idx]) || 0;
    if (px <= 0) continue;
    const payX = px * ways;
    const cells = _collectCells(grid, reelsHit, sym, wildId);
    wins.push({ symbol: sym, direction: 'LTR', reelsHit, payX, cells });
  }
  return wins;
}

/**
 * Pure RTL evaluator. Mirror of LTR — starts at the rightmost reel and
 * walks leftwards. Indexes in reelsHit are still column indexes (so a
 * 5-reel RTL run hitting reels 4,3,2 yields reelsHit=[4,3,2]).
 */
export function evaluateRTL(grid, paytable, minRunLength, wildId) {
  if (!Array.isArray(grid) || grid.length === 0) return [];
  const rowSample = grid.find(r => Array.isArray(r));
  if (!rowSample || rowSample.length === 0) return [];
  if (!paytable || typeof paytable !== 'object') return [];
  /* QA sweep (2026-06-19): wildId case normalization (see evaluateLTR). */
  wildId = String(wildId || '').toUpperCase();
  const reels = rowSample.length;
  const wins = [];
  const seen = new Set();

  const reelLastSyms = _symbolsOnReel(grid, reels - 1);
  const candidates = new Set();
  for (const s of reelLastSyms) {
    if (paytable[s]) candidates.add(s);
    if (wildId && s === wildId) {
      for (const k of Object.keys(paytable)) candidates.add(k);
    }
  }

  for (const sym of candidates) {
    if (seen.has(sym)) continue;
    seen.add(sym);
    let ways = 0;
    let run = 0;
    const reelsHit = [];
    for (let i = reels - 1; i >= 0; i--) {
      const cnt = _countOnReel(grid, i, sym, wildId);
      if (cnt === 0) break;
      ways = ways === 0 ? cnt : ways * cnt;
      run++;
      reelsHit.push(i);
    }
    if (run < minRunLength) continue;
    const row = paytable[sym];
    if (!row || row.length === 0) continue;
    const idx = Math.min(run - minRunLength, row.length - 1);
    const px = Number(row[idx]) || 0;
    if (px <= 0) continue;
    const payX = px * ways;
    const cells = _collectCells(grid, reelsHit, sym, wildId);
    wins.push({ symbol: sym, direction: 'RTL', reelsHit, payX, cells });
  }
  return wins;
}

export function emitBidirectionalWaysEvalCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ bidirectionalWaysEval: cfg });
  if (!c.enabled) return `\n/* bidirectionalWaysEval BLOCK (disabled) — no CSS */\n`;
  return `
/* ── bidirectionalWaysEval BLOCK — src/blocks/bidirectionalWaysEval.mjs ── */
.cell.bidir-pay-ltr {
  outline: 3px solid ${c.highlightLTR};
  outline-offset: -3px;
  box-shadow: 0 0 12px ${c.highlightLTR};
  transition: outline 180ms ease, box-shadow 180ms ease;
}
.cell.bidir-pay-rtl {
  outline: 3px solid ${c.highlightRTL};
  outline-offset: -3px;
  box-shadow: 0 0 12px ${c.highlightRTL};
  transition: outline 180ms ease, box-shadow 180ms ease;
}
.cell.bidir-pay-ltr.bidir-pay-rtl {
  outline: 3px solid ${c.highlightLTR};
  box-shadow: 0 0 14px ${c.highlightLTR}, 0 0 14px ${c.highlightRTL};
}
@media (prefers-reduced-motion: reduce) {
  .cell.bidir-pay-ltr,
  .cell.bidir-pay-rtl { transition: none; }
}
`;
}

export function emitBidirectionalWaysEvalMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ bidirectionalWaysEval: cfg });
  if (!c.enabled) return `\n<!-- bidirectionalWaysEval BLOCK (disabled) -->\n`;
  return tagBlockMarkup(`
<!-- bidirectionalWaysEval BLOCK — server-emitted markup -->
<div class="bidir-ways-host" id="bidirWaysHost" role="presentation" aria-hidden="true"></div>
`, 'bidirectionalWaysEval');
}

export function emitBidirectionalWaysEvalRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ bidirectionalWaysEval: cfg });
  if (!c.enabled) return `\n// bidirectionalWaysEval BLOCK (disabled) — no runtime\n`;

  const paytableJson  = JSON.stringify(c.paytable);
  const ltrEnabled    = c.ltrEnabled ? 'true' : 'false';
  const rtlEnabled    = c.rtlEnabled ? 'true' : 'false';
  const wildSub       = c.countWildAsAny ? 'true' : 'false';
  const minRunLen     = c.minRunLength;

  return `
/* ── bidirectionalWaysEval BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__BIDIR_WAYS_EVAL_WIRED__) return;
  window.__BIDIR_WAYS_EVAL_WIRED__ = true;

  var PAYTABLE      = ${paytableJson};
  var LTR_ENABLED   = ${ltrEnabled};
  var RTL_ENABLED   = ${rtlEnabled};
  var WILD_AS_ANY   = ${wildSub};
  var MIN_RUN_LEN   = ${minRunLen};

  window.BIDIR_WAYS_STATE = {
    wins:       [],
    ltrCount:   0,
    rtlCount:   0,
    totalPayX:  0,
  };

  function _readGrid() {
    /* Build a 2D grid from the live DOM .cell elements. Row-major:
       grid[row][reel]. Returns null when topology globals missing. */
    var host = document.getElementById('gridHost');
    if (!host) return null;
    var REELS = window.REELS || 5;
    var ROWS  = window.ROWS  || 3;
    var cells = host.querySelectorAll('.cell');
    if (!cells || cells.length === 0) return null;
    var grid = [];
    for (var r = 0; r < ROWS; r++) {
      var row = [];
      for (var c = 0; c < REELS; c++) {
        var idx = r * REELS + c;
        var el  = cells[idx];
        row.push(el ? String(el.textContent || '').trim().toUpperCase() : '');
      }
      grid.push(row);
    }
    return grid;
  }

  function _wildId() {
    if (!WILD_AS_ANY) return null;
    if (typeof SYMBOL_REGISTRY !== 'undefined' && SYMBOL_REGISTRY && SYMBOL_REGISTRY.wild) {
      return String(SYMBOL_REGISTRY.wild).toUpperCase();
    }
    return null;
  }

  function _symsOnReel(grid, reelIdx) {
    var out = {};
    for (var r = 0; r < grid.length; r++) {
      var s = grid[r] && grid[r][reelIdx];
      if (s) out[s] = true;
    }
    return out;
  }

  function _countOnReel(grid, reelIdx, sym, wild) {
    var n = 0;
    for (var r = 0; r < grid.length; r++) {
      var s = grid[r] && grid[r][reelIdx];
      if (!s) continue;
      if (s === sym || (wild && s === wild)) n++;
    }
    return n;
  }

  function _collectCellElems(grid, reelIdxList, sym, wild) {
    var REELS = (grid[0] || []).length;
    var host  = document.getElementById('gridHost');
    if (!host) return [];
    var nodes = host.querySelectorAll('.cell');
    var out = [];
    for (var k = 0; k < reelIdxList.length; k++) {
      var c = reelIdxList[k];
      for (var r = 0; r < grid.length; r++) {
        var s = grid[r] && grid[r][c];
        if (!s) continue;
        if (s === sym || (wild && s === wild)) {
          var idx = r * REELS + c;
          if (nodes[idx]) out.push(nodes[idx]);
        }
      }
    }
    return out;
  }

  function _evalDir(grid, startReel, step, wild) {
    var reels = (grid[0] || []).length;
    var wins  = [];
    var seen  = {};
    var anchorSyms = _symsOnReel(grid, startReel);
    var candidates = {};
    for (var s in anchorSyms) {
      if (PAYTABLE[s]) candidates[s] = true;
      if (wild && s === wild) {
        for (var k in PAYTABLE) candidates[k] = true;
      }
    }
    for (var sym in candidates) {
      if (seen[sym]) continue;
      seen[sym] = true;
      var ways = 0, run = 0;
      var reelsHit = [];
      for (var i = 0; i < reels; i++) {
        var reelIdx = startReel + i * step;
        if (reelIdx < 0 || reelIdx >= reels) break;
        var cnt = _countOnReel(grid, reelIdx, sym, wild);
        if (cnt === 0) break;
        ways = ways === 0 ? cnt : ways * cnt;
        run++;
        reelsHit.push(reelIdx);
      }
      if (run < MIN_RUN_LEN) continue;
      var row = PAYTABLE[sym];
      if (!row || row.length === 0) continue;
      var bucket = Math.min(run - MIN_RUN_LEN, row.length - 1);
      var px = Number(row[bucket]) || 0;
      if (px <= 0) continue;
      var payX  = px * ways;
      var cells = _collectCellElems(grid, reelsHit, sym, wild);
      wins.push({
        symbol:    sym,
        direction: step === 1 ? 'LTR' : 'RTL',
        reelsHit:  reelsHit,
        payX:      payX,
        cells:     cells,
      });
    }
    return wins;
  }

  function _paint(wins) {
    for (var i = 0; i < wins.length; i++) {
      var w = wins[i];
      var cls = w.direction === 'LTR' ? 'bidir-pay-ltr' : 'bidir-pay-rtl';
      for (var j = 0; j < w.cells.length; j++) {
        if (w.cells[j] && w.cells[j].classList) w.cells[j].classList.add(cls);
      }
    }
  }

  function _clearPaint() {
    var host = document.getElementById('gridHost');
    if (!host) return;
    var nodes = host.querySelectorAll('.cell.bidir-pay-ltr, .cell.bidir-pay-rtl');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.remove('bidir-pay-ltr');
      nodes[i].classList.remove('bidir-pay-rtl');
    }
  }

  /* FIX-3 CRITICAL #3 + #6 (deep QA, 2026-06-19) — dedupe full-line
   * reverse runs + MAX(ltr_per_symbol, rtl_per_symbol) instead of SUM.
   * A symbol that reaches every reel emits one LTR run [0..N-1] AND one
   * RTL run [N-1..0]; in industry win-both-ways semantics this is the
   * SAME physical line, paid ONCE. Previous code summed both → 2× on
   * 5-of-5. Per-symbol MAX also prevents same-side double-counting when
   * a partial LTR (3) and a partial RTL (3) on different reels both pay.
   *
   * FS-only flag (industry pattern): when winBothWaysActivation publishes
   * window.__WIN_BOTH_WAYS__ = true (FS phase only), allow RTL. Otherwise
   * RTL_ENABLED is the static GDD setting; bidirectional is permanent.
   * The block itself does NOT force FS-only — it respects whatever the
   * GDD declares, plus an opt-in transient flag from sibling block.
   */
  function _normReelsHit(rh) {
    if (!Array.isArray(rh)) return '';
    var copy = rh.slice().sort(function(a,b){ return a-b; });
    return copy.join(',');
  }

  function _dedupeFullLineMirror(wins, reelCount) {
    if (!Array.isArray(wins) || wins.length < 2) return wins;
    var seenLtrFullLine = new Map(); /* symbol → idx */
    for (var i = 0; i < wins.length; i++) {
      var w = wins[i];
      if (w.direction === 'LTR' && Array.isArray(w.reelsHit) && w.reelsHit.length === reelCount) {
        seenLtrFullLine.set(w.symbol, i);
      }
    }
    var out = [];
    for (var j = 0; j < wins.length; j++) {
      var v = wins[j];
      if (v.direction === 'RTL' && Array.isArray(v.reelsHit) && v.reelsHit.length === reelCount && seenLtrFullLine.has(v.symbol)) {
        continue; /* same physical line — paid once on LTR side */
      }
      out.push(v);
    }
    return out;
  }

  function _evalAll(grid) {
    var wild = _wildId();
    var reels = (grid[0] || []).length;
    /* FS-only flag opt-in: if GDD sets RTL_ENABLED static-true, run; else
     * read transient window.__WIN_BOTH_WAYS__ (sole-owner winBothWays-
     * Activation flag) to decide RTL gate. */
    var rtlActive = !!RTL_ENABLED || (typeof window !== 'undefined' && window.__WIN_BOTH_WAYS__ === true);
    var all  = [];
    if (LTR_ENABLED) all = all.concat(_evalDir(grid, 0, 1, wild));
    if (rtlActive) {
      all = all.concat(_evalDir(grid, reels - 1, -1, wild));
    }
    return _dedupeFullLineMirror(all, reels);
  }

  function _onSpinResult() {
    /* QA sweep (2026-06-19): HW guard parity with allWaysEval +
     * round-control family. If Hold & Win round is active, both
     * evaluators would double-pay on the same grid snapshot. */
    if (typeof window !== 'undefined' && window.HW_STATE && window.HW_STATE.active === true) return;
    var grid = _readGrid();
    if (!grid) return;
    var wins      = _evalAll(grid);
    var ltrCount  = 0;
    var rtlCount  = 0;
    /* FIX-3 CRITICAL #6: per-symbol MAX of LTR vs RTL payX, then sum
     * across symbols. Prevents same-symbol double-count when both
     * directions land for different stack shapes. */
    var bestPerSym = Object.create(null);
    for (var i = 0; i < wins.length; i++) {
      if (wins[i].direction === 'LTR') ltrCount++;
      else rtlCount++;
      var s = wins[i].symbol;
      var px = wins[i].payX || 0;
      if (!(s in bestPerSym) || px > bestPerSym[s]) bestPerSym[s] = px;
    }
    var totalPayX = 0;
    for (var k in bestPerSym) totalPayX += bestPerSym[k];
    window.BIDIR_WAYS_STATE = {
      wins:      wins,
      ltrCount:  ltrCount,
      rtlCount:  rtlCount,
      totalPayX: totalPayX,
    };
    _paint(wins);
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onBidirectionalWaysPay', {
          wins:      wins,
          ltrCount:  ltrCount,
          rtlCount:  rtlCount,
          totalPayX: totalPayX,
        });
      } catch (_) {}
    }
  }

  function _onClear() {
    _clearPaint();
    window.BIDIR_WAYS_STATE = { wins: [], ltrCount: 0, rtlCount: 0, totalPayX: 0 };
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onBidirectionalWaysCleared', {}); } catch (_) {}
    }
  }

  /* Pure DOM-free helper exposed for force/dev tools. */
  window.evaluateBidirectionalWays = function(grid) {
    if (!Array.isArray(grid) || grid.length === 0) return [];
    return _evalAll(grid);
  };

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onSpinResult', _onSpinResult, { priority: 80 });
    window.HookBus.on('preSpin',      _onClear,      { priority: 80 });
    window.HookBus.on('onFsEnd',      _onClear,      { priority: 80 });
  }
})();
`;
}
