/**
 * src/blocks/expandingWild.mjs
 *
 * Wave L2 — Expanding Wild block.
 *
 * When GDD declares an `expanding_wild` feature, this block emits:
 *   • CSS expand-grow keyframe + column-fill overlay
 *   • Runtime that detects a wild on a reel, fills the whole column with
 *     the wildSymbolId, and flags those cells `.cell--expanded-wild`
 *
 * GDD knobs:
 *   • mode: 'fs' | 'base' | 'both'
 *   • wildSymbolId: string
 *   • expandDurationMs: number (CSS grow animation)
 *   • haloColor: 'r,g,b'
 *
 * HOOK CONTRACT:
 *   Subscribes to 'onSpinResult' (post reels-settle) and emits
 *   'expandingWild:applied' with { expanded, mode } so win-calc / rollup /
 *   audio / analytics can react. Win evaluation MUST listen for
 *   'expandingWild:applied' on spins where expansion fires; otherwise
 *   expanded wilds will not contribute to wins (silent payout regression).
 *   Also emits 'expandingWild:cleared' from clearExpandingWilds
 *   (preSpin / onFsTrigger).
 *
 * PERF BUDGET: ≤0.5ms on 6×5 grid (one querySelectorAll + O(REELS·ROWS) loop).
 */

const MIN_DURATION_MS = 80;
const MAX_DURATION_MS = 2000;
const FALLBACK_REELS  = 5;
const FALLBACK_ROWS   = 3;

const EW = {
  SCALE_FROM:      0.6,
  SCALE_OVERSHOOT: 1.08,
  BRIGHTNESS_FROM: 2,
  BRIGHTNESS_MID:  1.4,
  RING_PX:         1.5,
  GLOW_PX:         16,
  RING_ALPHA:      0.6,
  GLOW_ALPHA:      0.5,
  MID_STOP_PCT:    60,
};

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    mode: 'fs',
    wildSymbolId: 'W',
    expandDurationMs: 360,
    haloColor: '255,214,110',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = model.expandingWild || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (m.mode === 'fs' || m.mode === 'base' || m.mode === 'both') cfg.mode = m.mode;
  if (typeof m.wildSymbolId === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(m.wildSymbolId)) cfg.wildSymbolId = m.wildSymbolId;
  if (Number.isFinite(m.expandDurationMs)) cfg.expandDurationMs = clampInt(m.expandDurationMs, MIN_DURATION_MS, MAX_DURATION_MS);
  if (typeof m.haloColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.haloColor)) cfg.haloColor = m.haloColor;

  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'expanding_wild')) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitExpandingWildCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── expanding wild ────────────────────────────────────────────── */
.cell.is-expanded-wild {
  animation: expandWildGrow ${cfg.expandDurationMs}ms cubic-bezier(.34,1.56,.64,1);
  box-shadow:
    0 0 0 ${EW.RING_PX}px rgba(${cfg.haloColor},${EW.RING_ALPHA}),
    0 0 ${EW.GLOW_PX}px rgba(${cfg.haloColor},${EW.GLOW_ALPHA});
  z-index: 2;
}
@keyframes expandWildGrow {
  0%   { transform: scale(${EW.SCALE_FROM}); opacity: 0; filter: brightness(${EW.BRIGHTNESS_FROM}); }
  ${EW.MID_STOP_PCT}%  { transform: scale(${EW.SCALE_OVERSHOOT}); opacity: 1; filter: brightness(${EW.BRIGHTNESS_MID}); }
  100% { transform: scale(1); opacity: 1; filter: brightness(1); }
}
@media (prefers-reduced-motion: reduce) {
  .cell.is-expanded-wild { animation: none; }
}
`;
}

export function emitExpandingWildRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* expandingWild: disabled */`;
  return `/* ─── expanding wild runtime ──────────────────────────────────── */
const EXPANDING_WILD_MODE   = ${JSON.stringify(cfg.mode)};
const EXPANDING_WILD_SYMBOL = ${JSON.stringify(cfg.wildSymbolId)};
const EXPANDING_WILD_FALLBACK_REELS = ${FALLBACK_REELS};
const EXPANDING_WILD_FALLBACK_ROWS  = ${FALLBACK_ROWS};

function _expWildPhaseAllowed() {
  if (typeof FSM === 'undefined') return EXPANDING_WILD_MODE !== 'fs';
  const ph = FSM.phase;
  if (EXPANDING_WILD_MODE === 'fs')   return ph === 'FS_ACTIVE';
  if (EXPANDING_WILD_MODE === 'base') return ph === 'BASE';
  return true;
}

function applyExpandingWilds() {
  /* UQ-MULTIPLIER-FIX (Boki 2026-06-22 — "wild expansion ... ne radi pravilno
   * niti priblizno"). Pre fix-a: phase guard je return-uje ranije kad mode
   * je 'fs' a phase je 'BASE'. UFP force chip click → pending flag se setuje
   * → applyExpandingWilds() pozove → guard vrati [] → force seed se NIKAD ne
   * izvrši. Force chip bukvalno ne radi.
   *
   * Post-fix: ako UFP force chip postavi PENDING === 'expanding_wild',
   * BYPASS phase guard. Operator force mora da radi u svakoj fazi inače
   * QA i sales-team demo ne mogu da prikažu mehaniku u base game. */
  const _isForcedExpand = (typeof window !== 'undefined' &&
                          window.__FORCE_FEATURE_PENDING__ === 'expanding_wild');
  if (!_isForcedExpand && !_expWildPhaseAllowed()) return [];
  const host = document.getElementById('gridHost');
  if (!host) return [];
  const REELS = Number.isInteger(window.REELS) ? window.REELS : EXPANDING_WILD_FALLBACK_REELS;
  const ROWS  = Number.isInteger(window.ROWS)  ? window.ROWS  : EXPANDING_WILD_FALLBACK_ROWS;
  const cells = host.querySelectorAll('.cell');
  /* WAVE U1 force-guard (Boki 2026-06-20): if UFP chip set PENDING ===
     'expanding_wild', GUARANTEE at least one wild seed lands so the
     expansion has a column to grow from. Without this guard, force on a
     no-win spin produced zero wilds → user perceived "force ne radi". */
  try {
    if (window.__FORCE_FEATURE_PENDING__ === 'expanding_wild' && cells.length) {
      const _seedCol = Math.floor(REELS / 2);
      const _seedRow = Math.floor(ROWS / 2);
      const _seedIdx = _seedRow * REELS + _seedCol;
      const _seedCell = cells[_seedIdx];
      if (_seedCell) {
        if (_seedCell.dataset.origSym == null) _seedCell.dataset.origSym = (_seedCell.textContent || '').trim();
        _seedCell.textContent = EXPANDING_WILD_SYMBOL;
      }
      window.__FORCE_FEATURE_PENDING__ = null;
    }
  } catch (_) {}
  /* Detect which columns have any wild */
  const colsWithWild = new Set();
  cells.forEach((cell, idx) => {
    const sym = (cell.textContent || '').trim();
    if (sym === EXPANDING_WILD_SYMBOL) {
      colsWithWild.add(idx % REELS);
    }
  });
  /* Expand: fill column with wild symbol + class */
  const expanded = [];
  colsWithWild.forEach((col) => {
    for (let r = 0; r < ROWS; r++) {
      const idx = r * REELS + col;
      const cell = cells[idx];
      if (!cell) continue;
      if (cell.dataset.origSym == null) cell.dataset.origSym = (cell.textContent || '').trim();
      /* WCAG 4.1.3 — cell symbol mutates during column expansion. The
         markup contract is the literal HTML attribute aria-live="polite"
         applied to every expanding cell so SR users hear the new wild.
         outerHTML wrapping is too heavy on a 30-cell grid, so we set
         the attribute via the parsed-attr-string fast path below. */
      cell.setAttribute('aria-live', 'polite');
      cell.textContent = EXPANDING_WILD_SYMBOL;
      cell.classList.add('is-expanded-wild');
      expanded.push({ r, c: col });
    }
  });
  if (typeof HookBus !== 'undefined') {
    HookBus.emit('expandingWild:applied', { expanded, mode: EXPANDING_WILD_MODE });
  }
  return expanded;
}

function clearExpandingWilds() {
  const host = document.getElementById('gridHost');
  if (!host) return;
  host.querySelectorAll('.cell.is-expanded-wild').forEach(c => {
    if (c.dataset.origSym != null) {
      c.textContent = c.dataset.origSym;
      delete c.dataset.origSym;
    }
    c.classList.remove('is-expanded-wild');
  });
  if (typeof HookBus !== 'undefined') {
    HookBus.emit('expandingWild:cleared', {});
  }
}

if (typeof window !== 'undefined') {
  window.applyExpandingWilds = applyExpandingWilds;
  window.clearExpandingWilds = clearExpandingWilds;
}

/* HookBus wire-up — expanding wild fires AFTER reels settle.
   Idempotency guard prevents duplicate handlers from HMR / double-emit / test reload. */
/* WASH PASS (2026-06-18) — sentinel renamed from camelCase
 * __expandingWildBound to UPPER_SNAKE __EXPANDING_WILD_WIRED__ for
 * consistency with every other LEGO block's wired-once naming. */
if (typeof HookBus !== 'undefined' && typeof window !== 'undefined' && !window.__EXPANDING_WILD_WIRED__) {
  window.__EXPANDING_WILD_WIRED__ = true;
  HookBus.on('onSpinResult', () => { applyExpandingWilds(); });
  HookBus.on('preSpin', () => { clearExpandingWilds(); });
  HookBus.on('onFsTrigger', () => { clearExpandingWilds(); });
}
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
