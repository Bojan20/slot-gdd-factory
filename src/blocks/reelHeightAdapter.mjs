/**
 * src/blocks/reelHeightAdapter.mjs
 *
 * Wave LEGO-FS3.3.A — reelEngine grow/shrink adapter.
 *
 * Purpose
 * ───────
 *   Provides ATOMIC grow + shrink of reel column height at runtime.
 *   Consumes the `onFsReelHeightEscalated` event from
 *   `fsReelHeightEscalation.mjs` and rebuilds the affected reel
 *   columns INSIDE reelEngine's invariants: new cells go into the
 *   `reel.strip` wrapper, `reel.cells[]` array stays in sync,
 *   `reel.col` height + grid-row span match the new visibleRows.
 *
 *   Without this adapter the FS-retrigger height escalation block is
 *   signal-only (per QA finding F2-F4 review of fsReelHeightEscalation):
 *   raw DOM append to `.grid-rect` corrupted the engine because reels
 *   live inside `reel.strip` wrappers, not flat in the grid host.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Dynamic reel-size adapter — standard architecture pattern for FS
 *   modes that grow grid mid-round without rebuilding the entire
 *   render tree.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitReelHeightAdapterCSS(cfg)
 *   emitReelHeightAdapterRuntime(cfg, model)
 *   computeRowDelta(currentRows, targetRows)        (pure helper)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onFsReelHeightEscalated (priority 30) — grow each reel to newRowCount
 *     • onFsEnd                  (priority 30) — shrink back to baseline
 *   emits:
 *     • onReelHeightGrown       { reelIdx, addedRows, newVisibleRows }
 *     • onReelHeightShrunk      { reelIdx, removedRows, newVisibleRows }
 *
 * Runtime contract
 * ────────────────
 *   window.growReelHeight(reelIdx, newRows)     — direct API surface
 *   window.shrinkReelHeight(reelIdx, newRows)   — direct API surface
 *   window.REEL_HEIGHT_ADAPTER_STATE = { baselines: number[] }
 *
 * GDD config keys (model.reelHeightAdapter)
 * ─────────────────────────────────────────
 *   { enabled, freshRowFillSymbol, freshRowClass }
 *
 * Performance: O(delta) DOM appends per grow; O(delta) removeChild on
 * shrink. Operations happen between spins (idle state), no race with
 * commitStopSymbols.
 *
 * a11y: new cells inherit aria-* from the cloned sibling; fresh-row
 * pulse animation respects prefers-reduced-motion.
 *
 * Senior-grade: wired-once via __REEL_HEIGHT_ADAPTER_WIRED__,
 * idempotent emit, vendor-neutral, prefers-reduced-motion respected,
 * try/catch sa console.warn surface (anti-silent-failure per WASH
 * PASS rule).
 */

const SYMBOL_ID_RE = /^[A-Z0-9?]{1,4}$/;

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    freshRowFillSymbol: '?',
    freshRowClass: 'is-rha-fresh',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.reelHeightAdapter) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (typeof src.freshRowFillSymbol === 'string' && SYMBOL_ID_RE.test(src.freshRowFillSymbol)) {
    cfg.freshRowFillSymbol = src.freshRowFillSymbol;
  }
  if (typeof src.freshRowClass === 'string' && /^[a-z0-9_-]{2,30}$/i.test(src.freshRowClass)) {
    cfg.freshRowClass = src.freshRowClass;
  }
  return cfg;
}

/** Pure: how many rows to add (positive) or remove (negative). */
export function computeRowDelta(currentRows, targetRows) {
  const cur = Number(currentRows);
  const tgt = Number(targetRows);
  if (!Number.isFinite(cur) || !Number.isFinite(tgt)) return 0;
  return Math.trunc(tgt) - Math.trunc(cur);
}

export function emitReelHeightAdapterCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ reelHeightAdapter: cfg });
  if (!c.enabled) return `\n/* reelHeightAdapter BLOCK (disabled) — no CSS */\n`;
  return `
/* ── reelHeightAdapter BLOCK — src/blocks/reelHeightAdapter.mjs ── */
.cell.${c.freshRowClass} {
  animation: rha-fresh 900ms cubic-bezier(.34,1.56,.64,1);
}
@keyframes rha-fresh {
  0%   { opacity: 0; transform: translateY(-40px); }
  60%  { opacity: 1; transform: translateY(4px); }
  100% { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .cell.${c.freshRowClass} { animation: none; }
}
`;
}

export function emitReelHeightAdapterRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ reelHeightAdapter: cfg });
  if (!c.enabled) return `\n// reelHeightAdapter BLOCK (disabled) — no runtime\n`;

  const fillSym  = c.freshRowFillSymbol;
  const freshCls = c.freshRowClass;

  return `
/* ── reelHeightAdapter BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__REEL_HEIGHT_ADAPTER_WIRED__) return;
  window.__REEL_HEIGHT_ADAPTER_WIRED__ = true;

  var FILL_SYM  = ${JSON.stringify(fillSym)};
  var FRESH_CLS = ${JSON.stringify(freshCls)};

  window.REEL_HEIGHT_ADAPTER_STATE = { baselines: [] };

  function _snapshotBaselines() {
    if (!Array.isArray(window.RECT_REELS)) return;
    window.REEL_HEIGHT_ADAPTER_STATE.baselines = window.RECT_REELS.map(function(r) {
      return r.visibleRows || 0;
    });
  }

  /**
   * Atomic grow of a single reel column to newRows. Performs the work
   * INSIDE reelEngine invariants:
   *   1. Validate inputs.
   *   2. Compute delta and short-circuit no-ops.
   *   3. Clone the LAST visible cell as the template for fresh cells
   *      (preserves classes, dataset, inline styles, dimensions).
   *   4. Append delta fresh cells to reel.strip.
   *   5. Push fresh cells into reel.cells[] array so commitStopSymbols
   *      sees the new size on the next spin (cells[i+1] addressing).
   *   6. Update reel.visibleRows.
   *   7. Update reel.col height + gridRow span to match new visibleRows.
   *   8. Emit canonical onReelHeightGrown event.
   */
  function _growOne(reelIdx, newRows) {
    if (!Array.isArray(window.RECT_REELS)) return;
    var reel = window.RECT_REELS[reelIdx];
    if (!reel) return;
    var cur = reel.visibleRows || 0;
    var delta = Math.max(0, Math.trunc(newRows) - cur);
    if (delta === 0) return;

    var tmpl = (reel.cells && reel.cells.length > 0) ? reel.cells[reel.cells.length - 1] : null;
    if (!tmpl) return;

    /* QA fix (Wave LEGO-FS3.3 PASS-WITH-MINORS, F2 MAJOR 2026-06-19):
     * reelEngine builds strip with stripCells = visibleRows + bufferCells
     * (top + bottom buffer). Cells[1..visibleRows] are VISIBLE; cells at
     * cells.length-1 sit in the BOTTOM BUFFER zone. Naïve append puts
     * fresh nodes BEHIND the buffer → invisible to the player. Correct
     * insertion point: AFTER the last visible cell (= cells[visibleRows]),
     * pushing the bottom buffer cell down. The strip.insertBefore mirrors
     * the same shift in the DOM. */
    var insertionIdx = cur + 1;   /* cells[0]=top buffer, cells[1..vis]=visible */
    var domAnchor = reel.cells[insertionIdx] || null;
    var added = [];
    for (var i = 0; i < delta; i++) {
      var fresh = tmpl.cloneNode(false);
      fresh.classList.add(FRESH_CLS);
      fresh.textContent = FILL_SYM;
      if (domAnchor && domAnchor.parentNode === reel.strip) {
        reel.strip.insertBefore(fresh, domAnchor);
      } else {
        reel.strip.appendChild(fresh);
      }
      /* Mirror DOM order in the cells[] array — keeps commitStopSymbols
       * cells[i+1] addressing aligned. */
      reel.cells.splice(insertionIdx + i, 0, fresh);
      added.push(fresh);
      (function(c) { setTimeout(function() { c.classList.remove(FRESH_CLS); }, 920); })(fresh);
    }

    reel.visibleRows = (cur + delta);

    /* Update column height + grid-row span. */
    try {
      var newHeight = reel.visibleRows * reel.side + (reel.visibleRows - 1) * 6;
      reel.col.style.height = newHeight + 'px';
      /* Parse existing gridRow ("3 / span 5") and keep the rowStart. */
      var gridRow = reel.col.style.gridRow || '';
      var startMatch = gridRow.match(/^(\\d+)\\s*\\//);
      if (startMatch) {
        reel.col.style.gridRow = startMatch[1] + ' / span ' + reel.visibleRows;
      } else {
        reel.col.style.gridRow = '1 / span ' + reel.visibleRows;
      }
    } catch (_) {}

    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onReelHeightGrown', {
          reelIdx: reelIdx,
          addedRows: delta,
          newVisibleRows: reel.visibleRows,
        });
      } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[reelHeightAdapter] grow emit failed', e); } catch (__) {}
      }
    }
  }

  /** Atomic shrink — reverse of _growOne. */
  function _shrinkOne(reelIdx, newRows) {
    if (!Array.isArray(window.RECT_REELS)) return;
    var reel = window.RECT_REELS[reelIdx];
    if (!reel) return;
    var cur = reel.visibleRows || 0;
    var delta = Math.max(0, cur - Math.max(1, Math.trunc(newRows)));
    if (delta === 0) return;
    /* Don't shrink mid-spin — safe-guard. */
    if (reel.spinning || reel.stopping) return;

    for (var i = 0; i < delta; i++) {
      if (reel.cells.length === 0) break;
      var removed = reel.cells.pop();
      try { if (removed && removed.parentNode) removed.parentNode.removeChild(removed); } catch (_) {}
    }

    reel.visibleRows = (cur - delta);

    try {
      var newHeight = reel.visibleRows * reel.side + (reel.visibleRows - 1) * 6;
      reel.col.style.height = newHeight + 'px';
      var gridRow = reel.col.style.gridRow || '';
      var startMatch = gridRow.match(/^(\\d+)\\s*\\//);
      if (startMatch) {
        reel.col.style.gridRow = startMatch[1] + ' / span ' + reel.visibleRows;
      } else {
        reel.col.style.gridRow = '1 / span ' + reel.visibleRows;
      }
    } catch (_) {}

    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onReelHeightShrunk', {
          reelIdx: reelIdx,
          removedRows: delta,
          newVisibleRows: reel.visibleRows,
        });
      } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[reelHeightAdapter] shrink emit failed', e); } catch (__) {}
      }
    }
  }

  function _growAll(newRows) {
    if (!Array.isArray(window.RECT_REELS)) return;
    for (var i = 0; i < window.RECT_REELS.length; i++) _growOne(i, newRows);
  }

  function _restoreBaselines() {
    var st = window.REEL_HEIGHT_ADAPTER_STATE;
    if (!Array.isArray(st.baselines) || st.baselines.length === 0) return;
    if (!Array.isArray(window.RECT_REELS)) return;
    for (var i = 0; i < window.RECT_REELS.length; i++) {
      var base = st.baselines[i];
      if (Number.isFinite(base)) _shrinkOne(i, base);
    }
  }

  function _onFsReelHeightEscalated(payload) {
    if (!payload || !Number.isFinite(payload.newRowCount)) return;
    if (window.REEL_HEIGHT_ADAPTER_STATE.baselines.length === 0) _snapshotBaselines();
    _growAll(payload.newRowCount);
  }

  function _onFsEnd() {
    _restoreBaselines();
    window.REEL_HEIGHT_ADAPTER_STATE.baselines = [];
  }

  /* Public API. */
  window.growReelHeight   = _growOne;
  window.shrinkReelHeight = _shrinkOne;

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onFsReelHeightEscalated', _onFsReelHeightEscalated, { priority: 30 });
    window.HookBus.on('onFsEnd',                 _onFsEnd,                  { priority: 30 });
  }
})();
`;
}
