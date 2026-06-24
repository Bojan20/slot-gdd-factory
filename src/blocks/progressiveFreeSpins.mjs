import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/progressiveFreeSpins.mjs
 *
 * Wave U1 — Progressive Free-Spins multiplier block.
 *
 * Multiplier that **escalates on every FS spin regardless of win**, in
 * contrast to `persistentMultiplier` which grows on every win event
 * (`onTumbleStep`). The escalation strategy is GDD-driven:
 *
 *   • linear      — multiplier += step       (1 → 2 → 3 → 4 → …)
 *   • doubling    — multiplier *= step       (1 → 2 → 4 → 8 → …)
 *   • fibonacci   — next = prev + curr       (1 → 2 → 3 → 5 → 8 → 13 → …)
 *   • ladder      — pick from explicit array (e.g. [1,2,5,10,25,100])
 *
 * Industry baseline: progressive-FS multiplier — a fundamental FS
 * mechanic where the multiplier *grows over time* even if intermediate
 * spins miss. This block centralises the escalator so it composes
 * cleanly with `multiplierOrb` (per-spin orb sum) and
 * `persistentMultiplier` (per-win bump).
 *
 * Lifecycle (HookBus contract — Wave R / S):
 *
 *   onFsTrigger          → reset to startMult, render chip "×N"
 *   onFsSpinResult       → escalate one rung, render with grow pulse
 *                          + push into HookBus.setMult so winPresentation
 *                          applies it to payouts on this FS spin
 *   onFsEnd              → optional reset based on resetOnRoundEnd
 *
 * NOT a replacement for:
 *   • `multiplierOrb`        — orb chip value sum (per spin)
 *   • `persistentMultiplier` — per-win bump (incremental on payouts)
 * These three compose: HookBus.setMult uses max(progressive, persistent, orb).
 *
 * Bake-time config (resolved from `model.progressiveFreeSpins`):
 *   { enabled, strategy, startMult, step, ladderValues, maxMult,
 *     resetOnRoundEnd, chipColor, chipLabel }
 *
 * Public API (server-side, ES module):
 *   defaultConfig()                         → safe defaults
 *   resolveConfig(model)                    → merge defaults with GDD override
 *   emitProgressiveFreeSpinsCSS(cfg)        → CSS string
 *   emitProgressiveFreeSpinsMarkup(cfg)     → HTML markup string
 *   emitProgressiveFreeSpinsRuntime(cfg)    → runtime JS string for orchestrator
 *
 * Runtime contract (after emitted JS executes):
 *   pfsReset()                              — set to startMult, render
 *   pfsBump()                               — advance one rung by strategy
 *   pfsGet()                                — current multiplier value
 *   PFS_STATE                               — { current, stepIndex }
 *
 * Runtime dependencies: FSM (phase tracking), HookBus (lifecycle bus),
 * document (HUD chip).
 */

const STRATEGIES = Object.freeze(['linear', 'doubling', 'fibonacci', 'ladder']);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    /* 'linear' is the most common industry pattern (FS multiplier accrues
       by +1 every spin); 'ladder' is the second-most common (jackpot-style
       climbing values). */
    strategy: 'linear',
    startMult: 1,
    /* For linear: additive step. For doubling: multiplicative factor.
       Ignored for fibonacci / ladder. */
    step: 1,
    /* For ladder strategy only: explicit progression. Pick advances one
       index per FS spin; clamped at last index. */
    ladderValues: [1, 2, 3, 5, 10, 25, 50, 100],
    /* Cap. 0 = uncapped. Doubling strategy without a cap can explode
       quickly; defaults to 0 but GDD typically sets a sensible cap. */
    maxMult: 0,
    /* Whether the FS-end resets back to startMult. Almost always true. */
    resetOnRoundEnd: true,
    chipColor: '255,180,80',
    chipLabel: 'FS MULT',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.progressiveFreeSpins) || {};

  const explicitEnabled = m.enabled != null;
  if (explicitEnabled) cfg.enabled = !!m.enabled;
  if (typeof m.strategy === 'string' && STRATEGIES.includes(m.strategy)) {
    cfg.strategy = m.strategy;
  }
  if (Number.isFinite(m.startMult)) cfg.startMult = clampInt(m.startMult, 1, 100000);
  if (Number.isFinite(m.step)) cfg.step = clampInt(m.step, 1, 1000);
  if (Array.isArray(m.ladderValues) && m.ladderValues.length >= 2 &&
      m.ladderValues.every(v => Number.isFinite(v) && v >= 1)) {
    const asc = m.ladderValues.every((v, i, a) => i === 0 || v >= a[i - 1]);
    if (asc) {
      cfg.ladderValues = m.ladderValues
        .slice(0, 32)
        .map(v => clampInt(v, 1, 1000000));
    }
  }
  if (Number.isFinite(m.maxMult)) cfg.maxMult = clampInt(m.maxMult, 0, 10000000);
  if (m.resetOnRoundEnd != null) cfg.resetOnRoundEnd = !!m.resetOnRoundEnd;
  if (typeof m.chipColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.chipColor)) {
    cfg.chipColor = m.chipColor;
  }
  if (typeof m.chipLabel === 'string' && m.chipLabel.length > 0 && m.chipLabel.length <= 24) {
    cfg.chipLabel = m.chipLabel;
  }

  /* Doubling with step < 2 would be a no-op or shrink — clamp at resolve
     time so the runtime can trust the resolved config without magic floors. */
  if (cfg.strategy === 'doubling' && cfg.step < 2) cfg.step = 2;

  /* Auto-enable when GDD declares a progressive_free_spins feature kind */
  if (!explicitEnabled && Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'progressive_free_spins' || f.kind === 'progressive_fs')) {
    cfg.enabled = true;
  }

  return cfg;
}

export function emitProgressiveFreeSpinsCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── progressive free spins multiplier (Wave U1) ───────────────── */
.pfs-chip {
  position: fixed;
  /* W47.S8 (A9 safe-area) — wrap both bottom and right in max(N, env)
   * so the chip stays above the home-bar AND respects the right-edge
   * gesture zone. Stack relationship with pm-chip (80px base) holds:
   * when home-bar pushes pm-chip up by inset, this chip stacks above. */
  bottom: calc(max(136px, env(safe-area-inset-bottom, 0px) + 136px));
  right: calc(max(22px, env(safe-area-inset-right, 22px)));
  z-index: 56;
  background: rgba(0,0,0,.72);
  border: 1.5px solid rgba(${cfg.chipColor},.75);
  border-radius: 12px;
  padding: 0.5rem 0.85rem;
  color: rgba(${cfg.chipColor},1);
  font-size: 0.85rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  display: none;
  align-items: center;
  gap: 0.45rem;
  user-select: none;
  text-shadow: 0 0 6px rgba(${cfg.chipColor},.6);
  box-shadow: 0 0 16px rgba(${cfg.chipColor},.4);
}
.pfs-chip[data-show="true"] { display: inline-flex; }
.pfs-chip .pfs-lbl { font-size: 0.7rem; opacity: 0.82; letter-spacing: 0.1em; } /* Wave UQ — ≥11px floor */
.pfs-chip .pfs-val { font-size: 1.1rem; }
.pfs-chip.is-grown { animation: pfsGrow 700ms cubic-bezier(.4,1.45,.5,1); }
@keyframes pfsGrow {
  0%   { transform: scale(1); }
  35%  { transform: scale(1.32); filter: brightness(1.5); }
  100% { transform: scale(1); filter: brightness(1); }
}
@media (max-width: 620px) {
  .pfs-chip { padding: 0.35rem 0.65rem; font-size: 0.72rem; bottom: 110px; right: 14px; }
}
@media (prefers-reduced-motion: reduce) {
  .pfs-chip.is-grown { animation: none; }
}
`;
}

export function emitProgressiveFreeSpinsMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<div id="pfsChip" class="pfs-chip" data-show="false" aria-live="polite">
  <span class="pfs-lbl">${escapeHtml(cfg.chipLabel)}</span>
  <span class="pfs-val">×${cfg.startMult}</span>
</div>`, 'progressiveFreeSpins');
}

export function emitProgressiveFreeSpinsRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* progressiveFreeSpins: disabled */`;
  return `/* ─── progressive free spins runtime (Wave U1) ─────────────────── */
const PFS_STRATEGY  = ${JSON.stringify(cfg.strategy)};
const PFS_START     = ${cfg.startMult};
const PFS_STEP      = ${cfg.step};
const PFS_LADDER    = ${JSON.stringify(cfg.ladderValues)};
const PFS_MAX       = ${cfg.maxMult};
const PFS_RESET_END = ${cfg.resetOnRoundEnd ? 'true' : 'false'};
const PFS_STATE     = { current: PFS_START, stepIndex: 0, prev: PFS_START };

function _pfsActive() {
  if (typeof FSM === 'undefined') return false;
  return FSM.phase === 'FS_ACTIVE' || FSM.phase === 'FS_INTRO';
}

function _pfsRenderChip(grown) {
  const chip = document.getElementById('pfsChip');
  if (!chip) return;
  chip.dataset.show = _pfsActive() ? 'true' : 'false';
  const v = chip.querySelector('.pfs-val');
  if (v) v.textContent = '×' + PFS_STATE.current;
  if (grown) {
    chip.classList.remove('is-grown');
    void chip.offsetWidth;   /* force reflow so the animation re-runs */
    chip.classList.add('is-grown');
  }
}

function _pfsCap(n) {
  if (PFS_MAX > 0 && n > PFS_MAX) return PFS_MAX;
  return n;
}

function pfsReset() {
  PFS_STATE.current = PFS_STRATEGY === 'ladder' ? PFS_LADDER[0] : PFS_START;
  PFS_STATE.stepIndex = 0;
  PFS_STATE.prev = PFS_STATE.current;
  _pfsRenderChip(false);
}

function pfsBump() {
  if (!_pfsActive()) return PFS_STATE.current;
  let next;
  if (PFS_STRATEGY === 'doubling') {
    next = _pfsCap(PFS_STATE.current * PFS_STEP);
  } else if (PFS_STRATEGY === 'fibonacci') {
    next = _pfsCap(PFS_STATE.current + PFS_STATE.prev);
  } else if (PFS_STRATEGY === 'ladder') {
    PFS_STATE.stepIndex = Math.min(PFS_LADDER.length - 1, PFS_STATE.stepIndex + 1);
    next = _pfsCap(PFS_LADDER[PFS_STATE.stepIndex]);
  } else {
    /* linear (default) */
    next = _pfsCap(PFS_STATE.current + PFS_STEP);
  }
  if (next === PFS_STATE.current) {
    /* Already at cap — no animation needed */
    return PFS_STATE.current;
  }
  PFS_STATE.prev = PFS_STATE.current;
  PFS_STATE.current = next;
  _pfsRenderChip(true);
  return PFS_STATE.current;
}

function pfsGet() { return PFS_STATE.current; }

if (typeof window !== 'undefined') {
  window.pfsReset = pfsReset;
  window.pfsBump  = pfsBump;
  window.pfsGet   = pfsGet;
  window.PFS_STATE = PFS_STATE;
}

/* Initial render at boot so the chip exists in DOM in the right state. */
document.addEventListener('DOMContentLoaded', () => _pfsRenderChip(false));

/* HookBus wire-up — escalator climbs once per FS spin and pushes the
   value into HookBus.setMult so winPresentation applies it to payouts.
   Composes with multiplierOrb and persistentMultiplier — uses max() so
   the highest active source wins, never double-counts. Without these
   handlers the block is dead code (chip renders but never changes). */
if (typeof HookBus !== 'undefined') {
  HookBus.on('onFsTrigger', () => { pfsReset(); });
  HookBus.on('onFsSpinResult', () => {
    pfsBump();
    const v = pfsGet();
    if (v > 0) HookBus.setMult(Math.max(HookBus.getMult(), v));
  });
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsEnd', () => {
    if (PFS_RESET_END) pfsReset();
  }) : void 0);
}
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
