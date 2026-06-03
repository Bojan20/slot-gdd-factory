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
 */

export function defaultConfig() {
  return {
    enabled: false,
    mode: 'fs',
    wildSymbolId: 'W',
    expandDurationMs: 360,
    haloColor: '255,214,110',
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.expandingWild || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (m.mode === 'fs' || m.mode === 'base' || m.mode === 'both') cfg.mode = m.mode;
  if (typeof m.wildSymbolId === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(m.wildSymbolId)) cfg.wildSymbolId = m.wildSymbolId;
  if (Number.isFinite(m.expandDurationMs)) cfg.expandDurationMs = clampInt(m.expandDurationMs, 80, 2000);
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
    0 0 0 1.5px rgba(${cfg.haloColor},.6),
    0 0 16px rgba(${cfg.haloColor},.5);
  z-index: 2;
}
@keyframes expandWildGrow {
  0%   { transform: scale(0.6); opacity: 0; filter: brightness(2); }
  60%  { transform: scale(1.08); opacity: 1; filter: brightness(1.4); }
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

function _expWildPhaseAllowed() {
  if (typeof FSM === 'undefined') return EXPANDING_WILD_MODE !== 'fs';
  const ph = FSM.phase;
  if (EXPANDING_WILD_MODE === 'fs')   return ph === 'FS_ACTIVE';
  if (EXPANDING_WILD_MODE === 'base') return ph === 'BASE';
  return true;
}

function applyExpandingWilds() {
  if (!_expWildPhaseAllowed()) return [];
  const host = document.getElementById('gridHost');
  if (!host) return [];
  const REELS = window.REELS || 5;
  const ROWS  = window.ROWS  || 3;
  const cells = host.querySelectorAll('.cell');
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
      cell.textContent = EXPANDING_WILD_SYMBOL;
      cell.classList.add('is-expanded-wild');
      expanded.push({ r, c: col });
    }
  });
  return expanded;
}

function clearExpandingWilds() {
  const host = document.getElementById('gridHost');
  if (!host) return;
  host.querySelectorAll('.cell.is-expanded-wild').forEach(c => c.classList.remove('is-expanded-wild'));
}

if (typeof window !== 'undefined') {
  window.applyExpandingWilds = applyExpandingWilds;
  window.clearExpandingWilds = clearExpandingWilds;
}
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
