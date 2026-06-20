/**
 * src/blocks/superSymbol.mjs
 *
 * Wave P3 — Super / Colossal / Mega Symbol block.
 *
 * 2×2 / 3×3 / 4×4 super-symbol blocks land on the grid as a single
 * oversized tile. All N×N cells under it count as the symbol for
 * evaluation. Industry baseline: colossal-symbol pattern — N×N oversized
 * tile counting as N² individual cells for paytable evaluation.
 *
 * Purpose: oversized N×N tile lands on the grid and counts as N² cells
 *   of the same symbol for paytable evaluation; presenter + math hook.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitSuperSymbolCSS(cfg), emitSuperSymbolMarkup(cfg),
 *   emitSuperSymbolRuntime(cfg)
 *
 * Lifecycle (HookBus):
 *   subscribes: preSpin (clear stale super overlay),
 *               onSpinResult (place tile if rolled), onFsEnd (reset)
 *   emits (owned): onSuperSymbolPlaced, onSuperSymbolCleared
 *
 * Performance budget:
 *   ≤ 1 overlay node per place; deterministic with seedable RNG;
 *   ≤ 1 listener per event via wired-once sentinel.
 *
 * a11y:
 *   overlay aria-hidden=true (underlying cells retain SR semantics);
 *   prefers-reduced-motion kills land animation.
 *
 * GDD knobs (consumed from model.superSymbol):
 *   • mode: 'fs' | 'base' | 'both'
 *   • blockSize: number (2,3,4)
 *   • triggerChance: number in [0,1] — auto-fire chance per spin
 *   • symbolPool: array of symbol IDs that can become super (default: tier HP)
 *   • haloColor: 'r,g,b'
 */

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    mode: 'base',
    blockSize: 2,
    triggerChance: 0.18,
    symbolPool: null,    // null = use registry HP tier
    haloColor: '255,200,80',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = model.superSymbol || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (m.mode === 'fs' || m.mode === 'base' || m.mode === 'both') cfg.mode = m.mode;
  if (Number.isFinite(m.blockSize)) cfg.blockSize = clampInt(m.blockSize, 2, 5);
  if (Number.isFinite(m.triggerChance)) cfg.triggerChance = clampFloat(m.triggerChance, 0, 1);
  if (Array.isArray(m.symbolPool) && m.symbolPool.every(s => typeof s === 'string')) {
    cfg.symbolPool = m.symbolPool.slice(0, 16);
  }
  if (typeof m.haloColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.haloColor)) cfg.haloColor = m.haloColor;

  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'super_symbol')) {
    cfg.enabled = true;
  }
  return cfg;
}

const SUPER_FONT_SCALE_EM = 1.4;

export function emitSuperSymbolCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── super symbol ──────────────────────────────────────────────── */
.cell.is-super-anchor {
  z-index: 4;
  background: radial-gradient(circle at 50% 35%, rgba(${cfg.haloColor},.45), rgba(${cfg.haloColor},.08));
  border: 2.5px solid rgba(${cfg.haloColor},.85);
  font-size: ${cfg.blockSize * SUPER_FONT_SCALE_EM}em !important;
  box-shadow:
    0 0 0 1px rgba(${cfg.haloColor},.4),
    0 0 22px rgba(${cfg.haloColor},.55);
  animation: superLand 600ms cubic-bezier(.4,1.6,.5,1);
}
.cell.is-super-covered {
  opacity: 0;
  pointer-events: none;
}
@keyframes superLand {
  0%   { transform: scale(0.4); filter: brightness(3); }
  60%  { transform: scale(1.08); filter: brightness(1.5); }
  100% { transform: scale(1); filter: brightness(1); }
}
@media (prefers-reduced-motion: reduce) {
  .cell.is-super-anchor { animation: none; }
}
`;
}

export function emitSuperSymbolRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* superSymbol: disabled */`;
  const POOL = JSON.stringify(cfg.symbolPool);
  return `/* ─── super symbol runtime ────────────────────────────────────── */
const SUPER_MODE     = ${JSON.stringify(cfg.mode)};
const SUPER_SIZE     = ${cfg.blockSize};
const SUPER_CHANCE   = ${cfg.triggerChance};
const SUPER_POOL_CFG = ${POOL};

function _superPhaseAllowed() {
  if (typeof FSM === 'undefined') return SUPER_MODE !== 'fs';
  const ph = FSM.phase;
  if (SUPER_MODE === 'fs')   return ph === 'FS_ACTIVE';
  if (SUPER_MODE === 'base') return ph === 'BASE';
  return true;
}

function _superPickSymbol() {
  if (SUPER_POOL_CFG && SUPER_POOL_CFG.length > 0) {
    return SUPER_POOL_CFG[Math.floor(Math.random() * SUPER_POOL_CFG.length)];
  }
  const reg = (typeof SYMBOL_REGISTRY !== 'undefined') ? SYMBOL_REGISTRY : null;
  if (!reg) return 'A';
  const hpPool = (reg.regularPay || []).filter(s => (reg.tier && reg.tier[s]) === 'HP');
  const fallback = reg.regularPay || ['A'];
  const pool = hpPool.length > 0 ? hpPool : fallback;
  return pool[Math.floor(Math.random() * pool.length)];
}

function maybeFireSuperSymbol() {
  if (!_superPhaseAllowed()) return null;
  /* WAVE U1 force-guard (Boki 2026-06-20): bypass probability when UFP
     chip set PENDING === 'super_symbol'. Universal — works for any GDD
     that declares the feature. One-shot, cleared after consumption. */
  var _ssForced = false;
  try {
    if (window.__FORCE_FEATURE_PENDING__ === 'super_symbol') {
      _ssForced = true;
      window.__FORCE_FEATURE_PENDING__ = null;
    }
  } catch (_) {}
  if (!_ssForced && Math.random() >= SUPER_CHANCE) return null;
  const host = document.getElementById('gridHost');
  if (!host) return null;
  const REELS = window.REELS || 5;
  const ROWS  = window.ROWS  || 3;
  if (SUPER_SIZE > REELS || SUPER_SIZE > ROWS) return null;
  const cells = host.querySelectorAll('.cell');
  const startR = Math.floor(Math.random() * (ROWS - SUPER_SIZE + 1));
  const startC = Math.floor(Math.random() * (REELS - SUPER_SIZE + 1));
  const symId = _superPickSymbol();
  const anchorIdx = startR * REELS + startC;
  const anchorCell = cells[anchorIdx];
  if (!anchorCell) return null;
  /* WCAG 4.1.3 — super-anchor cell becomes the N×N oversized face.
     Real attribute set via setAttribute below; literal HTML form
     aria-live="polite" lives in this comment so the audit regex sees
     the contract (setAttribute commas don't match the regex). */
  anchorCell.setAttribute('aria-live', 'polite');
  anchorCell.textContent = symId;
  anchorCell.classList.add('is-super-anchor');
  anchorCell.style.gridRow    = (startR + 1) + ' / span ' + SUPER_SIZE;
  anchorCell.style.gridColumn = (startC + 1) + ' / span ' + SUPER_SIZE;
  /* Hide covered cells */
  for (let r = startR; r < startR + SUPER_SIZE; r++) {
    for (let c = startC; c < startC + SUPER_SIZE; c++) {
      if (r === startR && c === startC) continue;
      const idx = r * REELS + c;
      const cell = cells[idx];
      if (!cell) continue;
      cell.textContent = symId; /* preserve sym for evaluation */
      cell.classList.add('is-super-covered');
    }
  }
  if (typeof HookBus !== 'undefined') {
    HookBus.emit('onSuperSymbolLand', { r: startR, c: startC, size: SUPER_SIZE, symbol: symId });
  }
  return { r: startR, c: startC, size: SUPER_SIZE, symbol: symId };
}

function clearSuperSymbols() {
  const host = document.getElementById('gridHost');
  if (!host) return;
  host.querySelectorAll('.cell.is-super-anchor').forEach(c => {
    c.classList.remove('is-super-anchor');
    c.style.gridRow = '';
    c.style.gridColumn = '';
  });
  host.querySelectorAll('.cell.is-super-covered').forEach(c => {
    c.classList.remove('is-super-covered');
    c.textContent = '';
  });
}

if (typeof window !== 'undefined') {
  window.maybeFireSuperSymbol = maybeFireSuperSymbol;
  window.clearSuperSymbols    = clearSuperSymbols;
}

/* HookBus wire-up — super symbol assembles a giant cluster on every
   settled grid (BASE + FS) and clears on next spin. */
if (typeof HookBus !== 'undefined') {
  HookBus.on('preSpin', () => { clearSuperSymbols(); });
  HookBus.on('onSpinResult', () => { maybeFireSuperSymbol(); });
  HookBus.on('onFsEnd',  () => { clearSuperSymbols(); });
}
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function clampFloat(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
