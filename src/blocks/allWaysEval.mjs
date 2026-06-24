import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/allWaysEval.mjs
 *
 * Wave LEGO — All-ways universal evaluator block.
 *
 * Purpose
 * ───────
 *   Universal "all-ways" win evaluator: counts a winning combination
 *   whenever a symbol appears on ANY 3+ consecutive adjacent reels — be
 *   that left-to-right (LTR), right-to-left (RTL), or both simultaneously.
 *   Distinct from:
 *     • waysEval            (LTR-only consecutive ways)
 *     • payAnywhereEval     (count anywhere on the grid, ignores adjacency)
 *     • clusterPaysEval     (orthogonally connected blob, ignores reels)
 *
 *   The pattern is a long-established industry standard for "either-end"
 *   ways: every regular symbol acts as a scatter-pay from a ways angle,
 *   but adjacency on reels is still required (a 3-of-a-kind appearing on
 *   reels 2-3-4 does NOT pay — only runs that anchor on the leftmost or
 *   rightmost reel and walk inward.)
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Classic "all-ways" industry-reference pattern — LTR ways union RTL
 *   ways. Same symbol may win from both directions on the same spin and
 *   each direction pays separately.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitAllWaysEvalCSS(cfg)
 *   emitAllWaysEvalMarkup(cfg)
 *   emitAllWaysEvalRuntime(cfg)
 *   evaluateAllWays(grid, paytable, minRunLength, wildId)   (pure helper)
 *   findConsecutiveRuns(symbolPositions, reelCount)         (pure helper)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • onSpinResult (priority 80) — evaluates grid, emits all-ways pays
 *     • preSpin      (priority 80) — clears prior pay-path overlay + state
 *     • onFsEnd      (priority 80) — resets accumulators between rounds
 *   emits:
 *     • onAllWaysPay     { wins: WinEvent[], totalPayX: number }
 *     • onAllWaysCleared { }
 *
 *   HW guard: when window.HW_STATE && HW_STATE.active === true the
 *   onSpinResult callback returns early. Hold-and-Win rounds own their
 *   own evaluator and the all-ways evaluator must not double-pay.
 *
 * Runtime contract
 * ────────────────
 *   window.ALL_WAYS_EVAL_STATE = { lastWins: WinEvent[], totalPayX: number }
 *   window.evaluateAllWays(grid)              (exposed pure helper)
 *
 *   WinEvent shape:
 *     { symbol: string,
 *       reelsHit: number[],        // reel indices, sorted asc
 *       payX: number,
 *       direction: 'ltr' | 'rtl',
 *       cells: HTMLElement[] }     // populated by runtime, [] in pure helper
 *
 * GDD config keys (model.allWaysEval)
 * ───────────────────────────────────
 *   {
 *     enabled: boolean (default false),
 *     minRunLength: int 2-6 (default 3),
 *     paytable: { [symbolId]: number[] },   // [px@minRun, px@minRun+1, …]
 *     countWildAsAny: boolean (default true),
 *     evaluateBothDirections: boolean (default true),
 *     showPayPath: boolean (default true)
 *   }
 *
 * Performance budget: ≤ 0.4 ms / spin on 5×4 grid; ≤ 1.0 ms on 6×6.
 * Wired-once via window.__ALL_WAYS_EVAL_WIRED__; one listener per event.
 *
 * a11y: pay-path overlay is purely decorative — wins announced via the
 * shared winRollup / winPresentation ARIA live region; reduced-motion
 * disables the path-stroke animation.
 *
 * Vendor-neutral, senior-grade, pure presentation + evaluator. No math
 * hooks beyond emitting the computed pay events to HookBus.
 */

const MIN_RUN_LO = 2;
const MIN_RUN_HI = 6;

/** Default tier-ladder paytable, indexed by run-length offset from minRunLength. */
const DEFAULT_PAYTABLE = Object.freeze({
  HP1: [10, 25, 100, 500],
  HP2: [ 5, 15,  50, 200],
  MP1: [ 2,  8,  25, 100],
  MP2: [ 1,  5,  15,  50],
  LP1: [ 1,  2,   8,  25],
  LP2: [ 1,  2,   5,  15],
});

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    minRunLength: 3,
    paytable: { ...DEFAULT_PAYTABLE },
    countWildAsAny: true,
    evaluateBothDirections: true,
    showPayPath: true,
  });
}

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

function isValidPaytable(pt) {
  if (!pt || typeof pt !== 'object' || Array.isArray(pt)) return false;
  const keys = Object.keys(pt);
  if (keys.length === 0) return false;
  for (const k of keys) {
    const row = pt[k];
    if (!Array.isArray(row) || row.length === 0) return false;
    for (const v of row) {
      if (!Number.isFinite(v) || v < 0) return false;
    }
  }
  return true;
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.allWaysEval) || {};

  if (src.enabled === true) cfg.enabled = true;

  if (Number.isFinite(src.minRunLength)) {
    cfg.minRunLength = clampInt(src.minRunLength, MIN_RUN_LO, MIN_RUN_HI);
  }

  if (isValidPaytable(src.paytable)) {
    const next = {};
    for (const k of Object.keys(src.paytable)) {
      next[String(k).toUpperCase()] = src.paytable[k].map(n => Number(n));
    }
    cfg.paytable = next;
  }

  if (src.countWildAsAny === false) cfg.countWildAsAny = false;
  if (src.countWildAsAny === true)  cfg.countWildAsAny = true;

  if (src.evaluateBothDirections === false) cfg.evaluateBothDirections = false;
  if (src.evaluateBothDirections === true)  cfg.evaluateBothDirections = true;

  if (src.showPayPath === false) cfg.showPayPath = false;
  if (src.showPayPath === true)  cfg.showPayPath = true;

  return cfg;
}

/**
 * Pure helper — given a sorted ascending list of reel indices on which a
 * symbol appears, return every maximal run of consecutive integers.
 *
 * @example
 *   findConsecutiveRuns([0,1,2,4,5], 6) → [[0,1,2],[4,5]]
 *   findConsecutiveRuns([], 5)          → []
 *
 * @param {number[]} symbolPositions  Sorted asc, unique reel indices.
 * @param {number}   reelCount        Total reel count (defensive bound).
 * @returns {number[][]} array of consecutive-reel runs (each ≥ 1 long).
 */
export function findConsecutiveRuns(symbolPositions, reelCount) {
  if (!Array.isArray(symbolPositions) || symbolPositions.length === 0) return [];
  const bound = Number.isFinite(reelCount) ? reelCount : Number.POSITIVE_INFINITY;
  const clean = [];
  let prev = -1;
  for (const raw of symbolPositions) {
    const n = Math.trunc(raw);
    if (!Number.isFinite(n) || n < 0 || n >= bound) continue;
    if (n === prev) continue;            // dedupe consecutive duplicates
    clean.push(n);
    prev = n;
  }
  if (clean.length === 0) return [];
  const runs = [];
  let current = [clean[0]];
  for (let i = 1; i < clean.length; i++) {
    if (clean[i] === clean[i - 1] + 1) {
      current.push(clean[i]);
    } else {
      runs.push(current);
      current = [clean[i]];
    }
  }
  runs.push(current);
  return runs;
}

/**
 * FIX-8 M12 (2026-06-19) — topology applicability note.
 * allWaysEval operates on RECTANGULAR grid arrays. For hex/pyramid
 * topologies, hexClusterEngine + pyramidGridEngine own the eval surface
 * (different adjacency rules). Rectangular slot.kind values supported:
 * rectangular, megaclusters, lock_respin, expanding, variable_reel.
 *
 * Pure helper — evaluate an all-ways grid for winning combinations.
 *
 * @param {Array<Array<string>>} grid   Column-major: grid[reelIdx][rowIdx].
 * @param {Object<string,number[]>} paytable  Per-symbol pay rows; px[i]
 *     corresponds to run length `minRunLength + i` (matched on leftmost
 *     or rightmost anchor depending on direction).
 * @param {number} minRunLength   2..6.
 * @param {string} [wildId]       Optional wild symbol id. When provided,
 *     wild cells substitute for ANY regular symbol in adjacency tests
 *     (industry-baseline all-ways wild behaviour).
 * @param {Object} [opts]
 * @param {boolean} [opts.evaluateBothDirections=true] LTR ∪ RTL.
 * @returns {Array<{symbol:string, reelsHit:number[], payX:number, direction:'ltr'|'rtl', cells:Array}>}
 */
export function evaluateAllWays(
  grid,
  paytable,
  minRunLength,
  wildId,
  opts = {},
) {
  if (!Array.isArray(grid) || grid.length === 0) return [];
  if (!paytable || typeof paytable !== 'object') return [];
  const minRun = clampInt(minRunLength || 3, MIN_RUN_LO, MIN_RUN_HI);
  const reelCount = grid.length;
  const bothDirs = opts.evaluateBothDirections !== false;

  /* FIX-3 CRITICAL #2 (deep QA, 2026-06-19) — canonical all-ways
   * (industry-standard reel-power semantics): ways = ∏ countOnReel(reel_i)
   * for reels in the anchored run. Previous implementation only stored
   * Set membership (presence/absence) so (3,2,1) and (1,1,1) stacks paid
   * identically — that is NOT all-ways math, that is pay-anywhere.
   *
   * countsBySymbol[sym] = Map<reelIdx, count>
   * wildCountsPerReel = Map<reelIdx, count of wild cells>
   *
   * For each run, payX = paytable[sym][runLen-minRun] * ways
   * where ways = ∏ (counts[sym][r] + wildCounts[r]) over r in run.
   * Wild substitution (FIX-3 MAJOR #13): a separate wild-only ways count
   * is evaluated against paytable[wildId] and MAX(symbol_pay, wild_pay)
   * wins, per industry baseline (player gets the larger of the two). */
  const countsBySymbol = new Map();
  const wildCountsPerReel = new Map();
  for (let reelIdx = 0; reelIdx < reelCount; reelIdx++) {
    const col = grid[reelIdx];
    if (!Array.isArray(col)) continue;
    const localCounts = new Map();
    let localWild = 0;
    for (const cell of col) {
      const sym = (cell == null) ? '' : String(cell);
      if (!sym) continue;
      if (wildId && sym === wildId) {
        localWild++;
        continue;
      }
      localCounts.set(sym, (localCounts.get(sym) || 0) + 1);
    }
    if (localWild > 0) wildCountsPerReel.set(reelIdx, localWild);
    for (const [sym, n] of localCounts) {
      if (!countsBySymbol.has(sym)) countsBySymbol.set(sym, new Map());
      countsBySymbol.get(sym).set(reelIdx, n);
    }
  }

  /* Helper — compute ways multiplier over an anchored run for a given
   * symbol, optionally absorbing wild substitutions. */
  function waysForRun(symCounts, run, useWild) {
    let ways = 1;
    for (const r of run) {
      const symN = (symCounts && symCounts.get(r)) || 0;
      const wildN = useWild ? (wildCountsPerReel.get(r) || 0) : 0;
      ways *= (symN + wildN);
      if (ways === 0) return 0;
    }
    return ways;
  }

  /* Helper — wild-only ways: every reel in the run must contain at least
   * one wild cell. Used to evaluate the wild's own paytable row. */
  function wildOnlyWays(run) {
    let ways = 1;
    for (const r of run) {
      const wildN = wildCountsPerReel.get(r) || 0;
      if (wildN === 0) return 0;
      ways *= wildN;
    }
    return ways;
  }

  const wildRow = wildId ? (paytable[wildId] || paytable[String(wildId).toUpperCase()]) : null;
  const hasWildPay = Array.isArray(wildRow) && wildRow.length > 0;

  const wins = [];
  for (const [sym, symCounts] of countsBySymbol.entries()) {
    const row = paytable[sym] || paytable[sym.toUpperCase()];
    if (!Array.isArray(row) || row.length === 0) continue;

    /* Build sorted union of reels (sym presence + wild presence) for
     * anchored-run detection. */
    const sorted = [];
    for (let r = 0; r < reelCount; r++) {
      if (symCounts.has(r) || wildCountsPerReel.has(r)) sorted.push(r);
    }

    /* LTR: anchored on reel 0. */
    const ltrRun = leftAnchoredRun(sorted);
    if (ltrRun.length >= minRun) {
      const ways = waysForRun(symCounts, ltrRun, !!wildId);
      if (ways > 0) {
        const baseRow = lookupPayForRun(row, ltrRun.length, minRun);
        let payX = baseRow * ways;
        /* Wild-substitution MAX semantics (FIX-3 MAJOR #13). */
        if (hasWildPay) {
          const wWays = wildOnlyWays(ltrRun);
          if (wWays > 0) {
            const wPay = lookupPayForRun(wildRow, ltrRun.length, minRun) * wWays;
            if (wPay > payX) payX = wPay;
          }
        }
        if (payX > 0) {
          wins.push({
            symbol: sym,
            reelsHit: ltrRun.slice(),
            payX,
            ways,
            direction: 'ltr',
            cells: [],
          });
        }
      }
    }

    /* RTL: anchored on last reel. Suppressed when full-reel run already
     * paid LTR (same physical line per industry win-both-ways rule:
     * one full-line N-of-N is one win, not two). */
    if (bothDirs) {
      const rtlRun = rightAnchoredRun(sorted, reelCount);
      if (rtlRun.length >= minRun) {
        const sameAsLtr = ltrRun.length === reelCount && rtlRun.length === reelCount;
        if (!sameAsLtr) {
          const ways = waysForRun(symCounts, rtlRun, !!wildId);
          if (ways > 0) {
            const baseRow = lookupPayForRun(row, rtlRun.length, minRun);
            let payX = baseRow * ways;
            if (hasWildPay) {
              const wWays = wildOnlyWays(rtlRun);
              if (wWays > 0) {
                const wPay = lookupPayForRun(wildRow, rtlRun.length, minRun) * wWays;
                if (wPay > payX) payX = wPay;
              }
            }
            if (payX > 0) {
              wins.push({
                symbol: sym,
                reelsHit: rtlRun.slice(),
                payX,
                ways,
                direction: 'rtl',
                cells: [],
              });
            }
          }
        }
      }
    }
  }

  return wins;
}

function leftAnchoredRun(sortedReels) {
  if (sortedReels.length === 0 || sortedReels[0] !== 0) return [];
  const run = [0];
  for (let i = 1; i < sortedReels.length; i++) {
    if (sortedReels[i] === sortedReels[i - 1] + 1) run.push(sortedReels[i]);
    else break;
  }
  return run;
}

function rightAnchoredRun(sortedReels, reelCount) {
  if (sortedReels.length === 0) return [];
  const last = sortedReels[sortedReels.length - 1];
  if (last !== reelCount - 1) return [];
  const run = [last];
  for (let i = sortedReels.length - 2; i >= 0; i--) {
    if (sortedReels[i] === sortedReels[i + 1] - 1) run.unshift(sortedReels[i]);
    else break;
  }
  return run;
}

function lookupPayForRun(row, runLen, minRun) {
  const offset = runLen - minRun;
  if (offset < 0) return 0;
  const clampedOffset = Math.min(offset, row.length - 1);
  const v = Number(row[clampedOffset]);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function emitAllWaysEvalCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ allWaysEval: cfg });
  if (!c.enabled) return `\n/* allWaysEval BLOCK (disabled) — no CSS */\n`;
  return `
/* ── allWaysEval BLOCK — src/blocks/allWaysEval.mjs ── */
.all-ways-pay-path {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 64;
  opacity: 0;
  transition: opacity 220ms ease;
}
.all-ways-pay-path.is-visible {
  opacity: 1;
}
.all-ways-pay-path svg {
  width: 100%;
  height: 100%;
  display: block;
}
.all-ways-pay-path .awp-stroke {
  fill: none;
  stroke: rgba(255, 215, 80, 0.92);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 0 6px rgba(255, 215, 80, 0.6));
  animation: all-ways-pay-pulse 1600ms ease-in-out infinite;
}
.all-ways-pay-path .awp-stroke.is-rtl {
  stroke: rgba(120, 220, 255, 0.92);
  filter: drop-shadow(0 0 6px rgba(120, 220, 255, 0.6));
}
@keyframes all-ways-pay-pulse {
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .all-ways-pay-path .awp-stroke { animation: none; opacity: 1; }
}
`;
}

export function emitAllWaysEvalMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ allWaysEval: cfg });
  if (!c.enabled) return `\n<!-- allWaysEval BLOCK (disabled) -->\n`;
  return tagBlockMarkup(`
<!-- allWaysEval BLOCK — server-emitted markup -->
<div class="all-ways-pay-path" id="allWaysPayPath" aria-hidden="true"></div>
`, 'allWaysEval');
}

export function emitAllWaysEvalRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ allWaysEval: cfg });
  if (!c.enabled) return `\n// allWaysEval BLOCK (disabled) — no runtime\n`;

  const paytableJson = JSON.stringify(c.paytable);
  const minRunLen = c.minRunLength;
  const bothDirs = c.evaluateBothDirections ? 'true' : 'false';
  const wildAsAny = c.countWildAsAny ? 'true' : 'false';
  const showPath = c.showPayPath ? 'true' : 'false';

  return `
/* -- allWaysEval BLOCK runtime -- */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__ALL_WAYS_EVAL_WIRED__) return;
  window.__ALL_WAYS_EVAL_WIRED__ = true;

  var PAYTABLE = ${paytableJson};
  var MIN_RUN_LENGTH = ${minRunLen};
  var EVALUATE_BOTH_DIRECTIONS = ${bothDirs};
  var COUNT_WILD_AS_ANY = ${wildAsAny};
  var SHOW_PAY_PATH = ${showPath};

  window.ALL_WAYS_EVAL_STATE = { lastWins: [], totalPayX: 0 };

  function _isHwActive() {
    return !!(window.HW_STATE && window.HW_STATE.active === true);
  }

  function _wildId() {
    if (!COUNT_WILD_AS_ANY) return null;
    if (window.SYMBOL_REGISTRY && window.SYMBOL_REGISTRY.wild) return window.SYMBOL_REGISTRY.wild;
    return null;
  }

  function _readGridColumnMajor() {
    /* Build a column-major grid by reading visible symbols from
       window.RECT_REELS, falling back to DOM cell scan when needed. */
    if (Array.isArray(window.RECT_REELS) && window.RECT_REELS.length > 0) {
      var out = [];
      for (var r = 0; r < window.RECT_REELS.length; r++) {
        var reel = window.RECT_REELS[r];
        if (!reel || !Array.isArray(reel.visible)) { out.push([]); continue; }
        var col = [];
        var vRows = reel.visibleRows || reel.visible.length;
        for (var row = 0; row < vRows; row++) {
          col.push(String(reel.visible[row] || '').toUpperCase());
        }
        out.push(col);
      }
      return out;
    }
    var host = document.getElementById('gridHost');
    if (!host) return [];
    var REELS = window.REELS || 5;
    var ROWS  = window.ROWS  || 3;
    var cells = host.querySelectorAll('.cell');
    var byCol = [];
    for (var rc = 0; rc < REELS; rc++) byCol.push([]);
    for (var rr = 0; rr < ROWS; rr++) {
      for (var rc2 = 0; rc2 < REELS; rc2++) {
        var idx = rr * REELS + rc2;
        var sym = ((cells[idx] && cells[idx].textContent) || '').trim().toUpperCase();
        byCol[rc2].push(sym);
      }
    }
    return byCol;
  }

  function _collectCellsForRun(reelsHit, symbol, wildId) {
    /* Collect DOM cell elements for highlight/path overlay. */
    var cells = [];
    var host = document.getElementById('gridHost');
    if (Array.isArray(window.RECT_REELS) && window.RECT_REELS.length > 0) {
      for (var i = 0; i < reelsHit.length; i++) {
        var reelIdx = reelsHit[i];
        var reel = window.RECT_REELS[reelIdx];
        if (!reel || !Array.isArray(reel.visible)) continue;
        var vRows = reel.visibleRows || reel.visible.length;
        for (var row = 0; row < vRows; row++) {
          var sym = String(reel.visible[row] || '').toUpperCase();
          if (sym === symbol || (wildId && sym === wildId)) {
            var cell = (typeof reel.cellAt === 'function')
              ? reel.cellAt(row)
              : (reel.cells && reel.cells[row]);
            if (cell) cells.push(cell);
          }
        }
      }
      return cells;
    }
    if (!host) return cells;
    var REELS = window.REELS || 5;
    var ROWS  = window.ROWS  || 3;
    var domCells = host.querySelectorAll('.cell');
    for (var ri = 0; ri < reelsHit.length; ri++) {
      for (var rrow = 0; rrow < ROWS; rrow++) {
        var didx = rrow * REELS + reelsHit[ri];
        var dc = domCells[didx];
        if (!dc) continue;
        var s = (dc.textContent || '').trim().toUpperCase();
        if (s === symbol || (wildId && s === wildId)) cells.push(dc);
      }
    }
    return cells;
  }

  function _leftRun(sorted) {
    if (sorted.length === 0 || sorted[0] !== 0) return [];
    var out = [0];
    for (var i = 1; i < sorted.length; i++) {
      if (sorted[i] === sorted[i - 1] + 1) out.push(sorted[i]);
      else break;
    }
    return out;
  }

  function _rightRun(sorted, reelCount) {
    if (sorted.length === 0) return [];
    var last = sorted[sorted.length - 1];
    if (last !== reelCount - 1) return [];
    var out = [last];
    for (var i = sorted.length - 2; i >= 0; i--) {
      if (sorted[i] === sorted[i + 1] - 1) out.unshift(sorted[i]);
      else break;
    }
    return out;
  }

  function _lookupPay(row, runLen) {
    if (!row || row.length === 0) return 0;
    var offset = runLen - MIN_RUN_LENGTH;
    if (offset < 0) return 0;
    var idx = Math.min(offset, row.length - 1);
    var v = Number(row[idx]);
    return (isFinite(v) && v > 0) ? v : 0;
  }

  function _evaluate() {
    var grid = _readGridColumnMajor();
    if (!grid || grid.length === 0) return [];
    var reelCount = grid.length;
    var wildId = _wildId();
    var presence = Object.create(null);
    var wildReels = Object.create(null);
    for (var r = 0; r < reelCount; r++) {
      var col = grid[r] || [];
      var localSeen = Object.create(null);
      for (var c = 0; c < col.length; c++) {
        var sym = String(col[c] || '');
        if (!sym) continue;
        if (wildId && sym === wildId) { wildReels[r] = true; continue; }
        localSeen[sym] = true;
      }
      for (var k in localSeen) {
        if (!presence[k]) presence[k] = Object.create(null);
        presence[k][r] = true;
      }
    }
    var wildReelSet = Object.keys(wildReels).map(function(n) { return Number(n); });
    var wins = [];
    for (var symKey in presence) {
      var row = PAYTABLE[symKey] || PAYTABLE[symKey.toUpperCase()];
      if (!Array.isArray(row) || row.length === 0) continue;
      var reelsForSym = Object.keys(presence[symKey]).map(function(n) { return Number(n); });
      if (wildId) {
        for (var w = 0; w < wildReelSet.length; w++) {
          if (reelsForSym.indexOf(wildReelSet[w]) === -1) reelsForSym.push(wildReelSet[w]);
        }
      }
      reelsForSym.sort(function(a, b) { return a - b; });
      var ltrRun = _leftRun(reelsForSym);
      if (ltrRun.length >= MIN_RUN_LENGTH) {
        var payL = _lookupPay(row, ltrRun.length);
        if (payL > 0) {
          wins.push({
            symbol: symKey,
            reelsHit: ltrRun.slice(),
            payX: payL,
            direction: 'ltr',
            cells: _collectCellsForRun(ltrRun, symKey, wildId),
          });
        }
      }
      if (EVALUATE_BOTH_DIRECTIONS) {
        var rtlRun = _rightRun(reelsForSym, reelCount);
        if (rtlRun.length >= MIN_RUN_LENGTH) {
          var sameAsLtr = (ltrRun.length === reelCount && rtlRun.length === reelCount);
          if (!sameAsLtr) {
            var payR = _lookupPay(row, rtlRun.length);
            if (payR > 0) {
              wins.push({
                symbol: symKey,
                reelsHit: rtlRun.slice(),
                payX: payR,
                direction: 'rtl',
                cells: _collectCellsForRun(rtlRun, symKey, wildId),
              });
            }
          }
        }
      }
    }
    return wins;
  }

  function _showPayPath(wins) {
    if (!SHOW_PAY_PATH) return;
    var host = document.getElementById('allWaysPayPath');
    if (!host) return;
    host.innerHTML = '';
    if (!wins || wins.length === 0) {
      host.classList.remove('is-visible');
      host.setAttribute('aria-hidden', 'true');
      return;
    }
    host.classList.add('is-visible');
    host.setAttribute('aria-hidden', 'false');
  }

  function _clear() {
    window.ALL_WAYS_EVAL_STATE.lastWins = [];
    window.ALL_WAYS_EVAL_STATE.totalPayX = 0;
    var host = document.getElementById('allWaysPayPath');
    if (host) {
      host.innerHTML = '';
      host.classList.remove('is-visible');
      host.setAttribute('aria-hidden', 'true');
    }
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onAllWaysCleared', {}); } catch (_) {}
    }
  }

  function _onSpinResult() {
    if (_isHwActive()) return;
    var wins = _evaluate();
    var total = 0;
    for (var i = 0; i < wins.length; i++) total += wins[i].payX;
    window.ALL_WAYS_EVAL_STATE.lastWins = wins;
    window.ALL_WAYS_EVAL_STATE.totalPayX = total;
    _showPayPath(wins);
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onAllWaysPay', { wins: wins, totalPayX: total });
      } catch (_) {}
    }
  }

  function _onPreSpin() { _clear(); }
  function _onFsEnd()   { _clear(); }

  window.evaluateAllWays = _evaluate;

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onSpinResult', _onSpinResult, { priority: 80 });
    window.HookBus.on('preSpin',      _onPreSpin,    { priority: 80 });
    window.HookBus.on('onFsEnd',      _onFsEnd,      { priority: 80 });
  }
})();
`;
}
