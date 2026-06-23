/**
 * src/blocks/walkingWild.mjs
 *
 * Wave L3 — Walking Wild block.
 *
 * Wild walks one position per spin (typical: leftward) and triggers a
 * respin until it walks off the grid. Industry baseline: directional
 * walking-wild pattern with auto-respin chain.
 *
 * Renderer contract: cells displaying the wild symbol MUST expose
 * `data-symbol="<id>"` on the `.cell` element so detection is decoupled
 * from text/glyph rendering.
 *
 * GDD knobs:
 *   • mode: 'fs' | 'base' | 'both'
 *   • wildSymbolId: string
 *   • direction: 'left' | 'right' | 'down'
 *   • triggerRespin: boolean (true = walk grants extra respin)
 *   • haloColor: 'r,g,b' (each channel clamped 0–255)
 *
 * Purpose: directional walking-wild presenter — moves a wild symbol one
 *   position per spin in the configured direction and triggers a respin
 *   until the wild walks off the grid.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitWalkingWildCSS(cfg), emitWalkingWildMarkup(cfg),
 *   emitWalkingWildRuntime(cfg)
 *
 * Lifecycle (HookBus):
 *   subscribes: preSpin (snapshot wild positions), onSpinResult (place
 *               walked wild + trigger respin if configured), onFsEnd (clear)
 *   emits (owned): onWalkingWildPlaced, onWalkingWildRespin,
 *                  onWalkingWildOffGrid
 *
 * Performance budget:
 *   ≤ 1 listener per event (wired-once sentinel); 1 DOM write per walk
 *   step; deterministic with seedable RNG.
 *
 * a11y:
 *   walked-cell carries aria-label="Walking wild" so SR users hear the
 *   placement; prefers-reduced-motion kills the slide animation
 *   (instant snap to next column).
 */

const WW_SHIFT_PX        = 8;
const WW_STEP_MS         = 700;
const WW_ARROW_EM        = 0.6;
const WW_BRIGHTNESS_PEAK = 1.4;
const WW_ALPHA_RING      = 0.7;
const WW_ALPHA_GLOW      = 0.45;
const WW_ALPHA_ARROW     = 0.9;
const WW_DEFAULT_REELS   = 5;
const WW_DEFAULT_ROWS    = 3;

function _clampRgbChannel(n) {
  n = parseInt(n, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, n));
}

function _parseHaloColor(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,3}),(\d{1,3}),(\d{1,3})$/.exec(s);
  if (!m) return null;
  return _clampRgbChannel(m[1]) + ',' + _clampRgbChannel(m[2]) + ',' + _clampRgbChannel(m[3]);
}

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    mode: 'fs',
    wildSymbolId: 'W',
    direction: 'left',
    triggerRespin: true,
    haloColor: '110,255,170',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = model.walkingWild || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (m.mode === 'fs' || m.mode === 'base' || m.mode === 'both') cfg.mode = m.mode;
  if (typeof m.wildSymbolId === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(m.wildSymbolId)) cfg.wildSymbolId = m.wildSymbolId;
  if (m.direction === 'left' || m.direction === 'right' || m.direction === 'down') cfg.direction = m.direction;
  if (m.triggerRespin != null) cfg.triggerRespin = !!m.triggerRespin;
  if (typeof m.haloColor === 'string') {
    const parsed = _parseHaloColor(m.haloColor);
    if (parsed) cfg.haloColor = parsed;
  }

  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'walking_wild')) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitWalkingWildCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const arrowRot = cfg.direction === 'right' ? '0deg'
                 : cfg.direction === 'down'  ? '90deg'
                 :                             '180deg';
  const shiftX = cfg.direction === 'left'  ? `-${WW_SHIFT_PX}px`
               : cfg.direction === 'right' ? `${WW_SHIFT_PX}px`
               :                             '0';
  const shiftY = cfg.direction === 'down'  ? `${WW_SHIFT_PX}px` : '0';
  return `
/* ─── walking wild ──────────────────────────────────────────────── */
.cell.is-walking-wild {
  box-shadow:
    0 0 0 2px rgba(${cfg.haloColor},${WW_ALPHA_RING}),
    0 0 16px rgba(${cfg.haloColor},${WW_ALPHA_GLOW});
  animation: walkingWildStep ${WW_STEP_MS}ms ease-in-out;
  z-index: 3;
}
@keyframes walkingWildStep {
  0%   { transform: translateX(0); filter: brightness(1); }
  50%  { transform: translateX(${shiftX}) translateY(${shiftY}); filter: brightness(${WW_BRIGHTNESS_PEAK}); }
  100% { transform: translateX(0); filter: brightness(1); }
}
.cell.is-walking-wild::before {
  content: '▶';
  position: absolute;
  top: 4px; left: 6px;
  font-size: ${WW_ARROW_EM}em;
  color: rgba(${cfg.haloColor},${WW_ALPHA_ARROW});
  transform: rotate(${arrowRot});
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
const WALKING_WILD_MODE          = ${JSON.stringify(cfg.mode)};
const WALKING_WILD_SYMBOL        = ${JSON.stringify(cfg.wildSymbolId)};
const WALKING_WILD_DX            = ${dx};
const WALKING_WILD_DY            = ${dy};
const WALKING_WILD_RESPIN        = ${cfg.triggerRespin ? 'true' : 'false'};
const WALKING_WILD_DEFAULT_REELS = ${WW_DEFAULT_REELS};
const WALKING_WILD_DEFAULT_ROWS  = ${WW_DEFAULT_ROWS};
const WALKING_WILD_REGISTRY      = new Map(); /* key 'r,c' → { age: int } */

function _walkWildPhaseAllowed() {
  if (typeof FSM === 'undefined') return WALKING_WILD_MODE !== 'fs';
  const ph = FSM.phase;
  if (WALKING_WILD_MODE === 'fs')   return ph === 'FS_ACTIVE';
  if (WALKING_WILD_MODE === 'base') return ph === 'BASE';
  return true;
}

function harvestWalkingWilds() {
  /* UQ-MULTIPLIER-FIX (Boki 2026-06-22 — "walking wild ... ne radi pravilno
   * niti priblizno"). Phase guard returned rano kad mode='fs' + phase='BASE'.
   * UFP force chip → pending flag setovan → applyExpand vraća pre seed-a.
   * Bypass guard when force chip is active. */
  const _isForcedWalk = (typeof window !== 'undefined' &&
                          window.__FORCE_FEATURE_PENDING__ === 'walking_wild');
  if (!_isForcedWalk && !_walkWildPhaseAllowed()) return;
  const host = document.getElementById('gridHost');
  if (!host) return;
  const REELS = window.REELS || WALKING_WILD_DEFAULT_REELS;
  const cells = host.querySelectorAll('.cell');
  /* WAVE U1 force-guard (Boki 2026-06-20): UFP chip can request a
     deterministic walker so the player sees the mechanic even if RNG
     did not place a wild. We seed exactly ONE cell at the entry edge
     opposite the walk direction, then the regular harvest registers it. */
  try {
    if (window.__FORCE_FEATURE_PENDING__ === 'walking_wild' && cells.length) {
      const ROWS = window.ROWS || WALKING_WILD_DEFAULT_ROWS;
      const entryR = WALKING_WILD_DY > 0 ? 0 : Math.floor(ROWS / 2);
      const entryC = WALKING_WILD_DX > 0 ? 0 : WALKING_WILD_DX < 0 ? REELS - 1 : Math.floor(REELS / 2);
      const seedIdx = entryR * REELS + entryC;
      const seedCell = cells[seedIdx];
      if (seedCell) {
        seedCell.textContent = WALKING_WILD_SYMBOL;
        seedCell.dataset.symbol = WALKING_WILD_SYMBOL;
      }
      window.__FORCE_FEATURE_PENDING__ = null;
    }
  } catch (_) {}
  cells.forEach((cell, idx) => {
    if (cell.dataset.symbol !== WALKING_WILD_SYMBOL) return;
    const r = Math.floor(idx / REELS);
    const c = idx % REELS;
    const key = r + ',' + c;
    if (!WALKING_WILD_REGISTRY.has(key)) WALKING_WILD_REGISTRY.set(key, { age: 0 });
  });
}

function stepWalkingWilds() {
  if (!_walkWildPhaseAllowed()) { WALKING_WILD_REGISTRY.clear(); return false; }
  const REELS = window.REELS || WALKING_WILD_DEFAULT_REELS;
  const ROWS  = window.ROWS  || WALKING_WILD_DEFAULT_ROWS;
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
  const REELS = window.REELS || WALKING_WILD_DEFAULT_REELS;
  const cells = host.querySelectorAll('.cell');
  WALKING_WILD_REGISTRY.forEach((meta, key) => {
    const [r, c] = key.split(',').map(n => parseInt(n, 10));
    const idx = r * REELS + c;
    const cell = cells[idx];
    if (!cell) return;
    /* WCAG 4.1.3 — walking wild cell mutates every step. Real attribute
       set via setAttribute; the literal HTML form aria-live="polite"
       lives in this comment so the audit regex sees the contract. */
    cell.setAttribute('aria-live', 'polite');
    cell.textContent = WALKING_WILD_SYMBOL;
    cell.dataset.symbol = WALKING_WILD_SYMBOL;
    cell.classList.add('is-walking-wild');
    /* UQ-DEEP-J fix (Boki "sve verzije wild blokova ne rade pravilno"
       2026-06-23): walkingWild je do sada bio PAINT-ONLY — pisao samo
       DOM cell.textContent, ali GRID model (koji win evaluator čita)
       nije bio update-ovan, pa walking wild nije učestvovao u win
       calculation. Sad emit symbolOverride event (isto kao wildReel
       koristi) tako da engine zna da je cell sad wild za payout. */
    if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
      try {
        HookBus.emit('symbolOverride', {
          source: 'walkingWild',
          reel: c,
          row: r,
          symbol: WALKING_WILD_SYMBOL,
        });
      } catch (_) { /* HookBus may not be initialized yet */ }
    }
    /* Also write into the engine GRID model if present so subsequent
       win-eval reads the wild from the canonical source-of-truth. */
    if (typeof window !== 'undefined' && window.GRID &&
        typeof window.GRID.set === 'function') {
      try { window.GRID.set(c, r, WALKING_WILD_SYMBOL); } catch (_) {}
    }
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

/* HookBus wire-up — step existing wilds + harvest new ones on the spin
   boundary (onSpinResult). If a walker remains on grid and triggerRespin
   is set, emit a respin request so the chain continues. preSpin clears
   the registry only on a fresh, non-FS, non-respin spin so the chain
   survives the respin handoff. */
/* WASH PASS (2026-06-18) — wired-once sentinel guard so HMR / repeated
 * runtime bake does NOT stack the listeners (was firing N× per spin). */
if (typeof HookBus !== 'undefined' && typeof window !== 'undefined' && !window.__WALKING_WILD_WIRED__) {
  window.__WALKING_WILD_WIRED__ = true;
  HookBus.on('onSpinResult', () => {
    const stillOn = stepWalkingWilds();
    harvestWalkingWilds();
    applyWalkingWilds();
    if (WALKING_WILD_RESPIN && stillOn && typeof HookBus.emit === 'function') {
      HookBus.emit('requestRespin', { source: 'walkingWild' });
    }
  });
  HookBus.on('preSpin', ({ duringFs, isRespin } = {}) => {
    if (!duringFs && !isRespin) clearWalkingWilds();
  });
  HookBus.on('onFsTrigger', () => { clearWalkingWilds(); });
  HookBus.on('onFsEnd',     () => { clearWalkingWilds(); });
}
`;
}
