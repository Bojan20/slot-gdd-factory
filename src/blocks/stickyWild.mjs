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

export function defaultConfig() {
  return {
    enabled: false,
    mode: 'fs',                  // 'fs' | 'base' | 'both'
    durationSpins: 0,            // 0 = persistent through round
    wildSymbolId: 'W',
    haloColor: '255,214,110',
    pulseMs: 1400,
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.stickyWild || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (m.mode === 'fs' || m.mode === 'base' || m.mode === 'both') cfg.mode = m.mode;
  if (Number.isFinite(m.durationSpins)) cfg.durationSpins = clampInt(m.durationSpins, 0, 99);
  if (typeof m.wildSymbolId === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(m.wildSymbolId)) cfg.wildSymbolId = m.wildSymbolId;
  if (typeof m.haloColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.haloColor)) cfg.haloColor = m.haloColor;
  if (Number.isFinite(m.pulseMs)) cfg.pulseMs = clampInt(m.pulseMs, 200, 5000);

  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'sticky_wild')) {
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

function harvestStickyWilds() {
  if (!_stickyPhaseAllowed()) return;
  const host = document.getElementById('gridHost');
  if (!host) return;
  const cells = host.querySelectorAll('.cell');
  cells.forEach((cell, idx) => {
    const sym = (cell.textContent || '').trim();
    if (sym !== STICKY_WILD_SYMBOL) return;
    const r = Math.floor(idx / (window.REELS || 5));
    const c = idx % (window.REELS || 5);
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
  const REELS = window.REELS || 5;
  STICKY_WILD_REGISTRY.forEach((spinsLeft, key) => {
    const [r, c] = key.split(',').map(n => parseInt(n, 10));
    const idx = r * REELS + c;
    const cell = host.querySelectorAll('.cell')[idx];
    if (!cell) return;
    cell.textContent = STICKY_WILD_SYMBOL;
    cell.classList.add('is-sticky-wild');
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
  if (host) host.querySelectorAll('.cell.is-sticky-wild').forEach(c => c.classList.remove('is-sticky-wild'));
}

if (typeof window !== 'undefined') {
  window.harvestStickyWilds = harvestStickyWilds;
  window.applyStickyWilds   = applyStickyWilds;
  window.tickStickyWilds    = tickStickyWilds;
  window.clearStickyWilds   = clearStickyWilds;
  window.STICKY_WILD_REGISTRY = STICKY_WILD_REGISTRY;
}
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
