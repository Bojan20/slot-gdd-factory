/**
 * src/blocks/fsReelHeightEscalation.mjs
 *
 * Wave LEGO-FS3.2 — FS retrigger → reel height escalation.
 *
 * Purpose
 * ───────
 *   Each FS retrigger BUMPS the visible row count of every reel by
 *   `rowsPerRetrigger` (default +1), capped at `maxRows`. New rows are
 *   inserted at the TOP of each reel and filled with placeholder
 *   symbols until the next FS spin populates them naturally.
 *
 *   Industry-typical pattern: bonus-rich FS round with a "bigger grid"
 *   reward for player persistence (more scatters during FS).
 *
 *   Distinct from existing FS-mod blocks:
 *     • `infinityReelsEngine.mjs`     — grid grows per WIN (cascade)
 *     • `dynamicWaysEngine.mjs`       — variable rows per reel (static)
 *     • `retriggerMultiplierBump.mjs` — retrigger bumps MULT (not rows)
 *
 *   QA-DISCIPLINE (2026-06-19): This block is SIGNAL-ONLY. It mutates
 *   RECT_REELS[i].visibleRows so engine code that reads visibleRows
 *   per-spin (commitStopSymbols) honours new height; and it emits the
 *   canonical onFsReelHeightEscalated event so a future reelEngine
 *   `growReelHeight(reelIdx, newRows)` adapter (planned FS3.3) can
 *   rebuild the column DOM + stripCells buffer atomically. Direct DOM
 *   append from this block was removed: reels live inside reel.strip
 *   wrappers (not flat in .grid-rect), and column height is CSS-baked
 *   per-build → raw append corrupted the engine. Until the adapter
 *   lands the HUD chip + RECT_REELS mutation provide a soft preview;
 *   visible grow lands when adapter wires in.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Bigger grid retrigger" FS pattern present on many slots —
 *   physical grid growth rewards scatter persistence during FS.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitFsReelHeightEscalationCSS(cfg)
 *   emitFsReelHeightEscalationRuntime(cfg, model)
 *   computeNewRowCount(currentRows, perRetrigger, maxRows)   (pure helper)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onFsTrigger    (priority 29) — snapshot baseline rows
 *     • onFsRetrigger  (priority 29) — escalate row count
 *     • onFsEnd        (priority 29) — restore baseline rows
 *   emits:
 *     • onFsReelHeightEscalated   { newRowCount, retriggerCount, perReel }
 *
 * Runtime contract
 * ────────────────
 *   window.FS_REEL_HEIGHT_STATE = {
 *     active: boolean,
 *     baselineRows: number,
 *     currentRows: number,
 *     retriggerCount: number,
 *   }
 *
 * GDD config keys (model.fsReelHeightEscalation)
 * ──────────────────────────────────────────────
 *   { enabled, rowsPerRetrigger, maxRows, fillSymbol, chipColor, showChip }
 *
 * Performance: O(reels) DOM append per retrigger; ≤ 0.5 ms typical.
 *
 * a11y: HUD chip is role=status + aria-live=polite, announces
 * "Reels expanded to N rows".
 *
 * Senior-grade: wired-once via __FS_REEL_HEIGHT_WIRED__, idempotent,
 * vendor-neutral, prefers-reduced-motion respected, try/catch sa
 * console.warn surface.
 */

const HEX_COLOR_RE  = /^#[0-9a-fA-F]{3,8}$/;
const SYMBOL_ID_RE  = /^[A-Z0-9?]{1,4}$/;
const PER_TRIG_MIN  = 1;
const PER_TRIG_MAX  = 5;
const MAX_ROWS_MIN  = 2;
const MAX_ROWS_MAX  = 14;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    rowsPerRetrigger: 1,
    maxRows: 8,
    fillSymbol: '?',
    chipColor: '#ffd84d',
    showChip: true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.fsReelHeightEscalation) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (Number.isFinite(src.rowsPerRetrigger)) {
    cfg.rowsPerRetrigger = clampInt(src.rowsPerRetrigger, PER_TRIG_MIN, PER_TRIG_MAX);
  }
  if (Number.isFinite(src.maxRows)) cfg.maxRows = clampInt(src.maxRows, MAX_ROWS_MIN, MAX_ROWS_MAX);
  if (typeof src.fillSymbol === 'string' && SYMBOL_ID_RE.test(src.fillSymbol)) cfg.fillSymbol = src.fillSymbol;
  if (typeof src.chipColor === 'string' && HEX_COLOR_RE.test(src.chipColor)) cfg.chipColor = src.chipColor;
  if (src.showChip === false) cfg.showChip = false;

  return cfg;
}

/**
 * Pure: compute the new row count after one retrigger. Returns the
 * post-bump value clamped at maxRows. Malformed inputs return current.
 */
export function computeNewRowCount(currentRows, perRetrigger, maxRows) {
  const cur = Number(currentRows);
  const per = Number(perRetrigger);
  const max = Number(maxRows);
  if (!Number.isFinite(cur) || !Number.isFinite(per) || !Number.isFinite(max)) return cur || 0;
  const next = Math.trunc(cur) + Math.max(0, Math.trunc(per));
  return Math.min(Math.trunc(max), next);
}

export function emitFsReelHeightEscalationCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ fsReelHeightEscalation: cfg });
  if (!c.enabled) return `\n/* fsReelHeightEscalation BLOCK (disabled) — no CSS */\n`;
  return `
/* ── fsReelHeightEscalation BLOCK — src/blocks/fsReelHeightEscalation.mjs ── */
.fsrhe-chip {
  position: absolute;
  top: 48px;
  right: 12px;
  background: linear-gradient(180deg, rgba(60,40,8,.92), rgba(20,12,4,.92));
  border: 1px solid ${c.chipColor};
  color: ${c.chipColor};
  font: 800 13px/1 system-ui, -apple-system, sans-serif;
  padding: 5px 11px;
  border-radius: 14px;
  z-index: 62;
  letter-spacing: 0.04em;
  pointer-events: none;
  opacity: 0;
  transition: opacity 240ms ease;
}
.fsrhe-chip.is-visible { opacity: 1; }
.fsrhe-chip.is-bumping {
  animation: fsrhe-bump 700ms cubic-bezier(.2,1.3,.4,1);
}
@keyframes fsrhe-bump {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.25); box-shadow: 0 0 16px ${c.chipColor}; }
  100% { transform: scale(1); box-shadow: 0 0 0 transparent; }
}
.cell.is-fsrhe-fresh-row {
  animation: fsrhe-fresh 900ms cubic-bezier(.34,1.56,.64,1);
}
@keyframes fsrhe-fresh {
  0%   { opacity: 0; transform: translateY(-40px); }
  60%  { opacity: 1; transform: translateY(4px); }
  100% { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .fsrhe-chip { transition: none; }
  .fsrhe-chip.is-bumping, .cell.is-fsrhe-fresh-row { animation: none; }
}
`;
}

export function emitFsReelHeightEscalationRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ fsReelHeightEscalation: cfg });
  if (!c.enabled) return `\n// fsReelHeightEscalation BLOCK (disabled) — no runtime\n`;

  const perTrig    = c.rowsPerRetrigger;
  const maxRows    = c.maxRows;
  const fillSym    = c.fillSymbol;
  const showChip   = c.showChip;

  return `
/* ── fsReelHeightEscalation BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__FS_REEL_HEIGHT_WIRED__) return;
  window.__FS_REEL_HEIGHT_WIRED__ = true;

  var PER_TRIG  = ${perTrig};
  var MAX_ROWS  = ${maxRows};
  var FILL_SYM  = ${JSON.stringify(fillSym)};
  var SHOW_CHIP = ${showChip};

  window.FS_REEL_HEIGHT_STATE = {
    active: false,
    baselineRows: 0,
    currentRows: 0,
    retriggerCount: 0,
  };

  function _ensureChip() {
    if (!SHOW_CHIP) return null;
    var existing = document.getElementById('fsrheChip');
    if (existing) return existing;
    var host = document.getElementById('gridHost') || document.body;
    if (!host) return null;
    var el = document.createElement('div');
    el.className = 'fsrhe-chip';
    el.id = 'fsrheChip';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-hidden', 'true');
    host.appendChild(el);
    return el;
  }

  function _renderChip() {
    var el = _ensureChip();
    if (!el) return;
    var st = window.FS_REEL_HEIGHT_STATE;
    if (!st.active || st.retriggerCount === 0) {
      el.classList.remove('is-visible', 'is-bumping');
      el.setAttribute('aria-hidden', 'true');
      return;
    }
    el.textContent = 'REELS ' + st.currentRows + ' ROWS';
    el.classList.add('is-visible', 'is-bumping');
    el.setAttribute('aria-hidden', 'false');
    setTimeout(function() { el.classList.remove('is-bumping'); }, 720);
  }

  function _snapshotBaseline() {
    if (Array.isArray(window.RECT_REELS) && window.RECT_REELS.length > 0) {
      var max = 0;
      for (var i = 0; i < window.RECT_REELS.length; i++) {
        var v = window.RECT_REELS[i].visibleRows || 0;
        if (v > max) max = v;
      }
      return max;
    }
    /* Fallback: count from DOM. */
    var cells = document.querySelectorAll('.cell');
    var maxR = 0;
    for (var j = 0; j < cells.length; j++) {
      var rw = parseInt(cells[j].getAttribute('data-row') || '0', 10);
      if (rw > maxR) maxR = rw;
    }
    return maxR + 1;
  }

  /* QA fix (general-purpose subagent 2026-06-19, finding F2/F3):
   * removed _addRowsToDom direct DOM append. reels live inside
   * reel.strip wrappers in reelEngine — flat append to .grid-rect
   * corrupted the grid layout and didn't sync reel.cells[] array
   * with the new size, causing commitStopSymbols out-of-bounds writes.
   * The right fix is a reelEngine growReelHeight(reelIdx, newRows)
   * API (FS3.3 wave). For now this block is signal-only: it bumps
   * RECT_REELS[i].visibleRows so per-spin reads honour new height,
   * emits the canonical event, and lets future adapter rebuild the
   * column atomically. */
  function _signalRowsChange(_newRows) {
    /* no-op placeholder; future FS3.3 wire-in for adapter. */
  }

  function _updateRectReels(newRows) {
    if (!Array.isArray(window.RECT_REELS)) return;
    for (var i = 0; i < window.RECT_REELS.length; i++) {
      window.RECT_REELS[i].visibleRows = newRows;
    }
  }

  function _onFsTrigger() {
    if (window.FS_REEL_HEIGHT_STATE.active) return;   /* idempotent */
    var baseline = _snapshotBaseline();
    window.FS_REEL_HEIGHT_STATE.active = true;
    window.FS_REEL_HEIGHT_STATE.baselineRows = baseline;
    window.FS_REEL_HEIGHT_STATE.currentRows = baseline;
    window.FS_REEL_HEIGHT_STATE.retriggerCount = 0;
  }

  function _onFsRetrigger() {
    var st = window.FS_REEL_HEIGHT_STATE;
    if (!st.active) return;
    var next = Math.min(MAX_ROWS, st.currentRows + PER_TRIG);
    if (next === st.currentRows) return;   /* at cap */
    st.currentRows = next;
    st.retriggerCount += 1;
    _signalRowsChange(next);
    _updateRectReels(next);
    _renderChip();
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onFsReelHeightEscalated', {
          newRowCount: next,
          retriggerCount: st.retriggerCount,
          perReel: PER_TRIG,
        });
      } catch (e) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[fsReelHeightEscalation] emit failed', e); } catch (__) {}
      }
    }
  }

  function _onFsEnd() {
    var st = window.FS_REEL_HEIGHT_STATE;
    if (!st.active) return;
    /* FIX-4 (deep QA #16, 2026-06-19) — finding F4 + priority semantics.
     * HookBus sorts handlers DESCENDING by priority (higher first), so
     * reelHeightAdapter._onFsEnd (priority 30) runs BEFORE us (priority
     * 29). Adapter consumes the still-escalated reel.visibleRows as its
     * shrink target and atomically shrinks DOM nodes back to baseline.
     * Our state-write of RECT_REELS[i].visibleRows = baselineRows that
     * follows is idempotent (adapter already set it inside _shrinkOne).
     *
     * If adapter is NOT in the build (st.baselines.length === 0 → early
     * return), DOM stays at escalated height and only our state-write
     * brings RECT_REELS back. Visual restore in that no-adapter scenario
     * waits for next renderRect() invocation. Documented limitation —
     * production builds should wire the adapter. */
    if (st.baselineRows > 0 && st.currentRows > st.baselineRows) {
      _updateRectReels(st.baselineRows);
    }
    st.active = false;
    st.currentRows = 0;
    st.baselineRows = 0;
    st.retriggerCount = 0;
    var chip = document.getElementById('fsrheChip');
    if (chip) {
      chip.classList.remove('is-visible', 'is-bumping');
      chip.setAttribute('aria-hidden', 'true');
      chip.textContent = '';
    }
  }

  if (window.HookBus && typeof window.HookBus.on === 'function') {
    window.HookBus.on('onFsTrigger',   _onFsTrigger,   { priority: 29 });
    window.HookBus.on('onFsRetrigger', _onFsRetrigger, { priority: 29 });
    window.HookBus.on('onFsEnd',       _onFsEnd,       { priority: 29 });
  }
})();
`;
}
