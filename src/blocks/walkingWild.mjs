/**
 * src/blocks/walkingWild.mjs
 *
 * Wave L3 — Walking Wild block.
 *
 * Wild walks one position per spin (typical: leftward) and triggers a
 * respin until it walks off the grid. Industry baseline: directional
 * walking-wild pattern with auto-respin chain.
 *
 * GDD knobs:
 *   • mode: 'fs' | 'base' | 'both'
 *   • wildSymbolId: string
 *   • direction: 'left' | 'right' | 'down'
 *   • triggerRespin: boolean (true = walk grants extra respin)
 *   • haloColor: 'r,g,b'
 */

export function defaultConfig() {
  return {
    enabled: false,
    mode: 'fs',
    wildSymbolId: 'W',
    direction: 'left',
    triggerRespin: true,
    haloColor: '110,255,170',
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.walkingWild || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (m.mode === 'fs' || m.mode === 'base' || m.mode === 'both') cfg.mode = m.mode;
  if (typeof m.wildSymbolId === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(m.wildSymbolId)) cfg.wildSymbolId = m.wildSymbolId;
  if (m.direction === 'left' || m.direction === 'right' || m.direction === 'down') cfg.direction = m.direction;
  if (m.triggerRespin != null) cfg.triggerRespin = !!m.triggerRespin;
  if (typeof m.haloColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.haloColor)) cfg.haloColor = m.haloColor;

  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'walking_wild')) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitWalkingWildCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── walking wild ──────────────────────────────────────────────── */
.cell.is-walking-wild {
  box-shadow:
    0 0 0 2px rgba(${cfg.haloColor},.7),
    0 0 16px rgba(${cfg.haloColor},.45);
  animation: walkingWildStep 700ms ease-in-out;
  z-index: 3;
}
@keyframes walkingWildStep {
  0%   { transform: translateX(0); filter: brightness(1); }
  50%  { transform: translateX(${cfg.direction === 'left' ? '-8px' : cfg.direction === 'right' ? '8px' : '0'}) translateY(${cfg.direction === 'down' ? '8px' : '0'}); filter: brightness(1.4); }
  100% { transform: translateX(0); filter: brightness(1); }
}
.cell.is-walking-wild::before {
  content: '▶';
  position: absolute;
  top: 4px; left: 6px;
  font-size: 0.6em;
  color: rgba(${cfg.haloColor},.9);
  ${cfg.direction === 'right' ? '' : "transform: rotate(180deg);"}
  ${cfg.direction === 'down' ? 'transform: rotate(90deg);' : ''}
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .cell.is-walking-wild { animation: none; }
}
`;
}

export function emitWalkingWildRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* walkingWild: disabled */`;
  const dx = cfg.direction === 'left' ? -1 : cfg.direction === 'right' ? 1 : 0;
  const dy = cfg.direction === 'down' ? 1 : 0;
  return `/* ─── walking wild runtime ────────────────────────────────────── */
const WALKING_WILD_MODE     = ${JSON.stringify(cfg.mode)};
const WALKING_WILD_SYMBOL   = ${JSON.stringify(cfg.wildSymbolId)};
const WALKING_WILD_DX       = ${dx};
const WALKING_WILD_DY       = ${dy};
const WALKING_WILD_RESPIN   = ${cfg.triggerRespin ? 'true' : 'false'};
const WALKING_WILD_REGISTRY = new Map(); /* key 'r,c' → { age: int } */

function _walkWildPhaseAllowed() {
  if (typeof FSM === 'undefined') return WALKING_WILD_MODE !== 'fs';
  const ph = FSM.phase;
  if (WALKING_WILD_MODE === 'fs')   return ph === 'FS_ACTIVE';
  if (WALKING_WILD_MODE === 'base') return ph === 'BASE';
  return true;
}

function harvestWalkingWilds() {
  if (!_walkWildPhaseAllowed()) return;
  const host = document.getElementById('gridHost');
  if (!host) return;
  const REELS = window.REELS || 5;
  const cells = host.querySelectorAll('.cell');
  cells.forEach((cell, idx) => {
    const sym = (cell.textContent || '').trim();
    if (sym !== WALKING_WILD_SYMBOL) return;
    const r = Math.floor(idx / REELS);
    const c = idx % REELS;
    const key = r + ',' + c;
    if (!WALKING_WILD_REGISTRY.has(key)) WALKING_WILD_REGISTRY.set(key, { age: 0 });
  });
}

function stepWalkingWilds() {
  if (!_walkWildPhaseAllowed()) { WALKING_WILD_REGISTRY.clear(); return false; }
  const REELS = window.REELS || 5;
  const ROWS  = window.ROWS  || 3;
  const next  = new Map();
  let stillOnGrid = false;
  WALKING_WILD_REGISTRY.forEach((meta, key) => {
    const [r, c] = key.split(',').map(n => parseInt(n, 10));
    const nr = r + WALKING_WILD_DY;
    const nc = c + WALKING_WILD_DX;
    if (nr >= 0 && nr < ROWS && nc >= 0 && nc < REELS) {
      next.set(nr + ',' + nc, { age: meta.age + 1 });
      stillOnGrid = true;
    }
  });
  WALKING_WILD_REGISTRY.clear();
  next.forEach((v, k) => WALKING_WILD_REGISTRY.set(k, v));
  return stillOnGrid;
}

function applyWalkingWilds() {
  if (!_walkWildPhaseAllowed()) return;
  const host = document.getElementById('gridHost');
  if (!host) return;
  const REELS = window.REELS || 5;
  const cells = host.querySelectorAll('.cell');
  WALKING_WILD_REGISTRY.forEach((meta, key) => {
    const [r, c] = key.split(',').map(n => parseInt(n, 10));
    const idx = r * REELS + c;
    const cell = cells[idx];
    if (!cell) return;
    cell.textContent = WALKING_WILD_SYMBOL;
    cell.classList.add('is-walking-wild');
  });
}

function clearWalkingWilds() {
  WALKING_WILD_REGISTRY.clear();
  const host = document.getElementById('gridHost');
  if (host) host.querySelectorAll('.cell.is-walking-wild').forEach(c => c.classList.remove('is-walking-wild'));
}

if (typeof window !== 'undefined') {
  window.harvestWalkingWilds = harvestWalkingWilds;
  window.stepWalkingWilds    = stepWalkingWilds;
  window.applyWalkingWilds   = applyWalkingWilds;
  window.clearWalkingWilds   = clearWalkingWilds;
  window.WALKING_WILD_REGISTRY = WALKING_WILD_REGISTRY;
}

/* HookBus wire-up — walking wilds harvest fresh wilds on every settled
   grid then step them by (DX, DY) on every tumble step. onFsTrigger /
   onFsEnd clear the registry. Without this the wild registry never
   accumulates and walking wilds never move. */
if (typeof HookBus !== 'undefined') {
  HookBus.on('onSpinResult', () => {
    /* Fable audit (critical): walking step was driven by onTumbleStep,
     * which fires once per cascade step — a single 4-step tumble would
     * walk the wild 4 cells in ONE spin, violating the documented
     * "one position per spin" pattern and breaking RNG reproducibility.
     * Step on the SPIN boundary instead; tumble step is for the harvest
     * + apply pass that keeps existing wilds visible across cascades. */
    stepWalkingWilds();
    harvestWalkingWilds();
    applyWalkingWilds();
  });
  HookBus.on('onTumbleStep', () => {
    applyWalkingWilds();
  });
  HookBus.on('preSpin', ({ duringFs } = {}) => {
    if (!duringFs) clearWalkingWilds();
  });
  HookBus.on('onFsTrigger', () => { clearWalkingWilds(); });
  HookBus.on('onFsEnd',     () => { clearWalkingWilds(); });
}
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
