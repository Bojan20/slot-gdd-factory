/**
 * src/blocks/stickyWild.mjs
 *
 * Wave L1 — Sticky Wild block.
 *
 * When GDD declares a `sticky_wild` feature, this block emits:
 *   • CSS halo + lock-icon overlay for sticky cells
 *   • Runtime registry of sticky positions (per FS round, by default)
 *   • Hook into commitStopSymbols to persist sticky cells across spins
 *
 * GDD knobs:
 *   • mode: 'fs' | 'base' | 'both' — which phase sticky wilds activate in
 *   • durationSpins: number — how many spins a wild stays sticky (0 = forever in FS)
 *   • wildSymbolId: string — which symbol id acts as sticky
 *   • haloColor: 'r,g,b' — gold halo around sticky cells
 *
 * Math layer (sticky cell substitution in win evaluation) is honored
 * automatically by detectLineWins/payAnywhereEval since sticky cells
 * carry the wildSymbolId already.
 */

const MAX_DURATION_SPINS = 99;
const MIN_PULSE_MS = 200;
const MAX_PULSE_MS = 5000;

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    mode: 'fs',                  // 'fs' | 'base' | 'both'
    durationSpins: 0,            // 0 = persistent through round
    wildSymbolId: 'W',
    haloColor: '255,214,110',
    pulseMs: 1400,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = model.stickyWild || {};
  const enabledExplicit = m.enabled != null;
  if (enabledExplicit) cfg.enabled = !!m.enabled;
  if (m.mode === 'fs' || m.mode === 'base' || m.mode === 'both') cfg.mode = m.mode;
  if (Number.isFinite(m.durationSpins)) cfg.durationSpins = clampInt(m.durationSpins, 0, MAX_DURATION_SPINS);
  if (typeof m.wildSymbolId === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(m.wildSymbolId)) cfg.wildSymbolId = m.wildSymbolId;
  if (typeof m.haloColor === 'string') {
    const mh = /^(\d{1,3}),(\d{1,3}),(\d{1,3})$/.exec(m.haloColor);
    if (mh && mh.slice(1).every(v => +v <= 255)) cfg.haloColor = m.haloColor;
  }
  if (Number.isFinite(m.pulseMs)) cfg.pulseMs = clampInt(m.pulseMs, MIN_PULSE_MS, MAX_PULSE_MS);

  if (!enabledExplicit && Array.isArray(model.features) && model.features.some(f => f.kind === 'sticky_wild')) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitStickyWildCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── sticky wild ────────────────────────────────────────────────── */
.cell.is-sticky-wild {
  position: relative;
  box-shadow:
    0 0 0 2px rgba(${cfg.haloColor},.7),
    0 0 18px 4px rgba(${cfg.haloColor},.45),
    inset 0 0 12px rgba(${cfg.haloColor},.25);
  animation: stickyWildPulse ${cfg.pulseMs}ms ease-in-out infinite;
  z-index: 3;
}
.cell.is-sticky-wild::after {
  content: '🔒';
  position: absolute;
  top: 4px; right: 6px;
  font-size: 0.7em;
  filter: drop-shadow(0 0 4px rgba(${cfg.haloColor},.9));
  pointer-events: none;
}
@keyframes stickyWildPulse {
  0%, 100% { filter: brightness(1); }
  50%      { filter: brightness(1.18); }
}
@media (prefers-reduced-motion: reduce) {
  .cell.is-sticky-wild { animation: none; }
}
`;
}

export function emitStickyWildRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* stickyWild: disabled */`;
  return `/* ─── sticky wild runtime ─────────────────────────────────────── */
const STICKY_WILD_MODE      = ${JSON.stringify(cfg.mode)};
const STICKY_WILD_DURATION  = ${cfg.durationSpins};
const STICKY_WILD_SYMBOL    = ${JSON.stringify(cfg.wildSymbolId)};
/* Registry: { 'r,c': spinsRemaining } */
const STICKY_WILD_REGISTRY = new Map();

function _stickyPhaseAllowed() {
  if (typeof FSM === 'undefined') return STICKY_WILD_MODE !== 'fs';
  const ph = FSM.phase;
  if (STICKY_WILD_MODE === 'fs')   return ph === 'FS_ACTIVE' || ph === 'FS_INTRO';
  if (STICKY_WILD_MODE === 'base') return ph === 'BASE';
  return true; // 'both'
}

function _stickyReels(host) {
  const n = Number(host && host.dataset && host.dataset.reels);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function harvestStickyWilds() {
  if (!_stickyPhaseAllowed()) return;
  const host = document.getElementById('gridHost');
  if (!host) return;
  const REELS = _stickyReels(host);
  if (!REELS) return;
  const cells = host.querySelectorAll('.cell');
  cells.forEach((cell, idx) => {
    const sym = (cell.textContent || '').trim();
    if (sym !== STICKY_WILD_SYMBOL) return;
    const r = Math.floor(idx / REELS);
    const c = idx % REELS;
    const key = r + ',' + c;
    if (!STICKY_WILD_REGISTRY.has(key)) {
      STICKY_WILD_REGISTRY.set(key, STICKY_WILD_DURATION > 0 ? STICKY_WILD_DURATION : Infinity);
    }
  });
}

function applyStickyWilds() {
  if (!_stickyPhaseAllowed()) return;
  const host = document.getElementById('gridHost');
  if (!host) return;
  const REELS = _stickyReels(host);
  if (!REELS) return;
  const cells = host.querySelectorAll('.cell');
  STICKY_WILD_REGISTRY.forEach((spinsLeft, key) => {
    const [r, c] = key.split(',').map(n => parseInt(n, 10));
    const idx = r * REELS + c;
    const cell = cells[idx];
    if (!cell) return;
    cell.textContent = STICKY_WILD_SYMBOL;
    cell.classList.add('is-sticky-wild');
    cell.setAttribute('aria-label', 'sticky wild');
  });
}

function tickStickyWilds() {
  const toDelete = [];
  STICKY_WILD_REGISTRY.forEach((spinsLeft, key) => {
    if (spinsLeft !== Infinity) {
      const next = spinsLeft - 1;
      if (next <= 0) toDelete.push(key);
      else STICKY_WILD_REGISTRY.set(key, next);
    }
  });
  toDelete.forEach(k => STICKY_WILD_REGISTRY.delete(k));
}

function clearStickyWilds() {
  STICKY_WILD_REGISTRY.clear();
  const host = document.getElementById('gridHost');
  if (host) host.querySelectorAll('.cell.is-sticky-wild').forEach(c => {
    c.classList.remove('is-sticky-wild');
    c.removeAttribute('aria-label');
  });
}

if (typeof window !== 'undefined') {
  window.harvestStickyWilds = harvestStickyWilds;
  window.applyStickyWilds   = applyStickyWilds;
  window.tickStickyWilds    = tickStickyWilds;
  window.clearStickyWilds   = clearStickyWilds;
  window.STICKY_WILD_REGISTRY = STICKY_WILD_REGISTRY;
}

/* HookBus wire-up — sticky wilds participate in every reel settle:
   onSpinResult → re-apply registered sticky cells; harvest any NEW
   wild cells on the settled grid.
   postSpin    → tick countdowns (durationSpins decrement).
   onFsTrigger → clear last round's registry. */
if (typeof HookBus !== 'undefined' && typeof window !== 'undefined' && !window.__STICKY_WILD_WIRED__) {
  window.__STICKY_WILD_WIRED__ = true;
  HookBus.on('onSpinResult', () => {
    applyStickyWilds();
    harvestStickyWilds();
  });
  HookBus.on('postSpin', () => { tickStickyWilds(); });
  HookBus.on('onFsTrigger', () => { clearStickyWilds(); });
  HookBus.on('onFsEnd', () => { if (STICKY_WILD_MODE === 'fs') clearStickyWilds(); });
  HookBus.on('onRoundEnd', () => { if (STICKY_WILD_MODE !== 'fs') clearStickyWilds(); });
}
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
