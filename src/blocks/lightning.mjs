/**
 * src/blocks/lightning.mjs
 *
 * Wave P1 — Lightning random-hit feature block.
 *
 * On a winning spin (or with a random chance), strike N cells with
 * lightning bolts that overlay random multiplier values (×2..×500).
 * Industry baseline: random-strike multiplier overlays — 1×–500× chip drops
 * applied on top of the settled grid.
 *
 * GDD knobs:
 *   • mode: 'fs' | 'base' | 'both'
 *   • triggerChance: number in [0,1]
 *   • minStrikes / maxStrikes: how many cells get a bolt
 *   • multipliers: array of { value, weight }
 *   • haloColor: 'r,g,b'
 *   • strikeDurationMs: number
 */

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    mode: 'fs',
    triggerChance: 0.22,
    minStrikes: 2,
    maxStrikes: 6,
    multipliers: [
      { value: 2,   weight: 38 },
      { value: 3,   weight: 24 },
      { value: 5,   weight: 16 },
      { value: 10,  weight: 12 },
      { value: 25,  weight: 6 },
      { value: 50,  weight: 3 },
      { value: 100, weight: 1 },
    ],
    haloColor: '160,210,255',
    strikeDurationMs: 700,
  });
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.lightning || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (m.mode === 'fs' || m.mode === 'base' || m.mode === 'both') cfg.mode = m.mode;
  if (Number.isFinite(m.triggerChance)) cfg.triggerChance = clampFloat(m.triggerChance, 0, 1);
  if (Number.isFinite(m.minStrikes)) cfg.minStrikes = clampInt(m.minStrikes, 1, 25);
  if (Number.isFinite(m.maxStrikes)) cfg.maxStrikes = clampInt(m.maxStrikes, cfg.minStrikes, 36);
  /* Fable audit (critical): if GDD raises minStrikes ABOVE the default
   * maxStrikes (e.g. { minStrikes: 10 }) without supplying max, the
   * documented `min ≤ max` contract was silently violated, collapsing
   * picker range to a single value. Hoist max to ≥ new min. */
  if (cfg.maxStrikes < cfg.minStrikes) cfg.maxStrikes = cfg.minStrikes;
  if (Array.isArray(m.multipliers) && m.multipliers.length > 0 &&
      m.multipliers.every(p => p && Number.isFinite(p.value) && Number.isFinite(p.weight))) {
    /* Fable audit (high): the .every() check was vacuously true on an
     * empty array → defaults overwritten with [] → _litDrawMult returned
     * undefined → ×undefined tags + NaN payout. Require length > 0. */
    cfg.multipliers = m.multipliers.slice(0, 16).map(p => ({
      value: clampInt(p.value, 1, 10000),
      weight: clampInt(p.weight, 1, 1000),
    }));
  }
  if (typeof m.haloColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.haloColor)) cfg.haloColor = m.haloColor;
  if (Number.isFinite(m.strikeDurationMs)) cfg.strikeDurationMs = clampInt(m.strikeDurationMs, 80, 5000);

  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'lightning')) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitLightningCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── lightning ─────────────────────────────────────────────────── */
.cell.is-lightning-struck {
  position: relative;
  animation: lightningFlash ${cfg.strikeDurationMs}ms ease-out;
  z-index: 3;
}
.cell.is-lightning-struck::before {
  content: '⚡';
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%) scale(1.6);
  font-size: 1.2em;
  color: rgba(${cfg.haloColor},1);
  filter: drop-shadow(0 0 10px rgba(${cfg.haloColor},.9));
  z-index: 5;
  pointer-events: none;
}
.cell.is-lightning-struck .lit-mult {
  position: absolute;
  bottom: 2px; right: 4px;
  background: rgba(0,0,0,.78);
  color: rgba(${cfg.haloColor},1);
  border: 1.5px solid rgba(${cfg.haloColor},.85);
  border-radius: 7px;
  padding: 1px 5px;
  font-size: 0.62em;
  font-weight: 900;
  z-index: 6;
  text-shadow: 0 0 4px rgba(${cfg.haloColor},.8);
}
@keyframes lightningFlash {
  0%   { filter: brightness(4) contrast(1.6); }
  30%  { filter: brightness(1.8); }
  100% { filter: brightness(1); }
}
@media (prefers-reduced-motion: reduce) {
  .cell.is-lightning-struck { animation: none; }
}
`;
}

export function emitLightningRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* lightning: disabled */`;
  return `/* ─── lightning runtime ───────────────────────────────────────── */
const LIT_MODE       = ${JSON.stringify(cfg.mode)};
const LIT_CHANCE     = ${cfg.triggerChance};
const LIT_MIN        = ${cfg.minStrikes};
const LIT_MAX        = ${cfg.maxStrikes};
const LIT_POOL       = ${JSON.stringify(cfg.multipliers)};
const LIT_DURATION   = ${cfg.strikeDurationMs};

function _litPhaseAllowed() {
  if (typeof FSM === 'undefined') return LIT_MODE !== 'fs';
  const ph = FSM.phase;
  if (LIT_MODE === 'fs')   return ph === 'FS_ACTIVE';
  if (LIT_MODE === 'base') return ph === 'BASE';
  return true;
}

function _litDrawMult() {
  let total = 0;
  for (const p of LIT_POOL) total += p.weight;
  let roll = Math.random() * total;
  for (const p of LIT_POOL) {
    roll -= p.weight;
    if (roll <= 0) return p.value;
  }
  return LIT_POOL[0].value;
}

function maybeFireLightning() {
  if (!_litPhaseAllowed()) return null;
  if (Math.random() >= LIT_CHANCE) return null;
  const host = document.getElementById('gridHost');
  if (!host) return null;
  const cells = Array.from(host.querySelectorAll('.cell'));
  if (cells.length === 0) return null;
  const n = LIT_MIN + Math.floor(Math.random() * (LIT_MAX - LIT_MIN + 1));
  const struck = [];
  const used = new Set();
  for (let i = 0; i < n; i++) {
    let idx, safety = 0;
    do { idx = Math.floor(Math.random() * cells.length); safety++; } while (used.has(idx) && safety < 64);
    if (used.has(idx)) break;
    used.add(idx);
    const mult = _litDrawMult();
    const cell = cells[idx];
    cell.classList.add('is-lightning-struck');
    const tag = document.createElement('span');
    tag.className = 'lit-mult';
    tag.textContent = '×' + mult;
    cell.appendChild(tag);
    struck.push({ idx, mult });
    setTimeout(() => {
      cell.classList.remove('is-lightning-struck');
      if (tag.parentNode === cell) cell.removeChild(tag);
    }, LIT_DURATION + 1400);
  }
  return struck;
}

function clearLightning() {
  const host = document.getElementById('gridHost');
  if (!host) return;
  host.querySelectorAll('.cell.is-lightning-struck').forEach(c => {
    c.classList.remove('is-lightning-struck');
    const tag = c.querySelector('.lit-mult');
    if (tag) tag.remove();
  });
}

if (typeof window !== 'undefined') {
  window.maybeFireLightning = maybeFireLightning;
  window.clearLightning     = clearLightning;
}

/* HookBus wire-up — lightning fires on every settled grid (BASE + FS),
   strikes random cells with multiplier values, pushes the chosen mult
   into HookBus so winPresentation applies it. */
if (typeof HookBus !== 'undefined') {
  HookBus.on('preSpin', () => { clearLightning(); });
  HookBus.on('onSpinResult', () => {
    const struck = maybeFireLightning();
    if (struck && Array.isArray(struck) && struck.length > 0) {
      /* Sum of multipliers — winPresentation reads HookBus.getMult() */
      const sum = struck.reduce((a, s) => a + (Number(s && s.mult) || 0), 0);
      if (sum > 0) HookBus.addMult(sum);
    }
  });
  HookBus.on('onFsEnd', () => { clearLightning(); });
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
