/**
 * src/blocks/wildReel.mjs
 *
 * Wave L4 — Wild Reel block.
 *
 * A randomly-picked reel turns fully wild on selected spins. References:
 * Wild Reel (Pragmatic Wolf Gold), Stacked Wilds — full reel substitution.
 *
 * GDD knobs:
 *   • mode: 'fs' | 'base' | 'both'
 *   • wildSymbolId: string
 *   • chancePerSpin: number in [0,1] — probability a wild reel fires
 *   • maxReelsPerSpin: number — at most N wild reels in one spin
 *   • haloColor: 'r,g,b'
 */

export function defaultConfig() {
  return {
    enabled: false,
    mode: 'fs',
    wildSymbolId: 'W',
    chancePerSpin: 0.18,
    maxReelsPerSpin: 1,
    haloColor: '255,180,90',
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.wildReel || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (m.mode === 'fs' || m.mode === 'base' || m.mode === 'both') cfg.mode = m.mode;
  if (typeof m.wildSymbolId === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(m.wildSymbolId)) cfg.wildSymbolId = m.wildSymbolId;
  if (Number.isFinite(m.chancePerSpin)) cfg.chancePerSpin = clampFloat(m.chancePerSpin, 0, 1);
  if (Number.isFinite(m.maxReelsPerSpin)) cfg.maxReelsPerSpin = clampInt(m.maxReelsPerSpin, 1, 7);
  if (typeof m.haloColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.haloColor)) cfg.haloColor = m.haloColor;

  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'wild_reel')) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitWildReelCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── wild reel ──────────────────────────────────────────────────── */
.cell.is-wild-reel {
  box-shadow:
    0 0 0 1.5px rgba(${cfg.haloColor},.6),
    inset 0 0 12px rgba(${cfg.haloColor},.4);
  animation: wildReelFlare 600ms ease-out;
  z-index: 2;
}
@keyframes wildReelFlare {
  0%   { filter: brightness(2.4) saturate(2); transform: scaleY(0.4); }
  60%  { filter: brightness(1.5) saturate(1.4); transform: scaleY(1.06); }
  100% { filter: brightness(1) saturate(1); transform: scaleY(1); }
}
@media (prefers-reduced-motion: reduce) {
  .cell.is-wild-reel { animation: none; }
}
`;
}

export function emitWildReelRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* wildReel: disabled */`;
  return `/* ─── wild reel runtime ───────────────────────────────────────── */
const WILD_REEL_MODE      = ${JSON.stringify(cfg.mode)};
const WILD_REEL_SYMBOL    = ${JSON.stringify(cfg.wildSymbolId)};
const WILD_REEL_CHANCE    = ${cfg.chancePerSpin};
const WILD_REEL_MAX       = ${cfg.maxReelsPerSpin};

function _wildReelPhaseAllowed() {
  if (typeof FSM === 'undefined') return WILD_REEL_MODE !== 'fs';
  const ph = FSM.phase;
  if (WILD_REEL_MODE === 'fs')   return ph === 'FS_ACTIVE';
  if (WILD_REEL_MODE === 'base') return ph === 'BASE';
  return true;
}

function maybeFireWildReel() {
  if (!_wildReelPhaseAllowed()) return [];
  const fired = [];
  const REELS = window.REELS || 5;
  const ROWS  = window.ROWS  || 3;
  const host  = document.getElementById('gridHost');
  if (!host) return [];
  const cells = host.querySelectorAll('.cell');
  let chosen = 0;
  const used = new Set();
  while (chosen < WILD_REEL_MAX) {
    if (Math.random() >= WILD_REEL_CHANCE) break;
    let col = Math.floor(Math.random() * REELS);
    let safety = 0;
    while (used.has(col) && safety++ < 16) col = Math.floor(Math.random() * REELS);
    if (used.has(col)) break;
    used.add(col);
    for (let r = 0; r < ROWS; r++) {
      const idx = r * REELS + col;
      const cell = cells[idx];
      if (!cell) continue;
      cell.textContent = WILD_REEL_SYMBOL;
      cell.classList.add('is-wild-reel');
    }
    fired.push(col);
    chosen++;
  }
  return fired;
}

function clearWildReels() {
  const host = document.getElementById('gridHost');
  if (!host) return;
  host.querySelectorAll('.cell.is-wild-reel').forEach(c => c.classList.remove('is-wild-reel'));
}

if (typeof window !== 'undefined') {
  window.maybeFireWildReel = maybeFireWildReel;
  window.clearWildReels    = clearWildReels;
}

/* HookBus wire-up — wild reel fires AFTER the grid settles (so it can
   overwrite chosen columns with the wild symbol) and clears on preSpin. */
if (typeof HookBus !== 'undefined') {
  HookBus.on('preSpin', () => { clearWildReels(); });
  HookBus.on('onSpinResult', () => { maybeFireWildReel(); });
  HookBus.on('onFsEnd',  () => { clearWildReels(); });
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
