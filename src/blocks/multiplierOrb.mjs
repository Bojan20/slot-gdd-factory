/**
 * src/blocks/multiplierOrb.mjs
 *
 * Wave K3 — Multiplier Orb runtime.
 *
 * Special "orb" symbol (`M` by default) that carries a multiplier value
 * (e.g. 2x, 5x, 25x, 1000x). Visible orbs:
 *   • Show their value as a chip on the cell
 *   • Stay on screen through tumble chains (preservation owned by tumble.mjs)
 *   • Accumulate Total_Multiplier = Σ(visible orb values)
 *   • Total_Multiplier applies to the FINAL chain payout (or every FS spin
 *     when bonus-multiplier accumulation is enabled — pay-anywhere FS rule)
 *
 * Bake-time config (resolved from `model.multiplierOrb`):
 *   { enabled, symbolId, distribution: [{value, weight}, ...],
 *     bonusAccumulate: false }
 */

export function defaultConfig() {
  return {
    enabled: false,
    symbolId: 'M',
    /* Wave T-orb (2026-06-04) — neutral 6-tier distribution used as a
     * template baseline. Concrete games override via
     * model.multiplierOrb.distribution; nothing in the template should
     * imply a specific math profile. Industry-typical "modest" curve:
     * heavy weight on small values, geometric falloff to a 100× cap. */
    distribution: [
      { value:   2, weight: 60 },
      { value:   3, weight: 40 },
      { value:   5, weight: 20 },
      { value:  10, weight: 10 },
      { value:  25, weight:  5 },
      { value: 100, weight:  1 },
    ],
    bonusAccumulate: false,  // FS-mode persistent multiplier (pay-anywhere FS rule)
    chipColor: '#ffe680',
    pulseMs: 1000,
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.multiplierOrb || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (typeof m.symbolId === 'string' && /^[A-Z]{1,4}$/.test(m.symbolId)) cfg.symbolId = m.symbolId;
  if (Array.isArray(m.distribution) && m.distribution.length > 0) {
    /* Fable audit (high): if EVERY supplied entry fails the value>0
     * filter, the array collapses to [] and pickOrbValue blows up.
     * Keep the default distribution unless the filter produced ≥1 entry.
     * Fable audit (low): also reject non-positive weights so a stray
     * negative doesn't silently bias the picker. */
    const filtered = m.distribution
      .filter(e => Number.isFinite(e.value) && e.value > 0)
      .map(e => {
        const w = Number(e.weight);
        return { value: Number(e.value), weight: Number.isFinite(w) && w > 0 ? w : 1 };
      });
    if (filtered.length > 0) cfg.distribution = filtered;
  }
  if (m.bonusAccumulate != null) cfg.bonusAccumulate = !!m.bonusAccumulate;
  if (typeof m.chipColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(m.chipColor)) cfg.chipColor = m.chipColor;
  if (Number.isFinite(m.pulseMs)) cfg.pulseMs = clampInt(m.pulseMs, 100, 5000);

  // Auto-enable if GDD declared a Multiplier Orb special symbol
  if (model.symbols && Array.isArray(model.symbols.specials)) {
    const hasOrb = model.symbols.specials.some(
      s => /orb|multiplier/i.test(s.name || '') && /^[A-Z]{1,4}$/.test(String(s.id).toUpperCase())
    );
    if (hasOrb) cfg.enabled = true;
  }
  return cfg;
}

export function emitMultiplierOrbCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── multiplier orb ───────────────────────────────────────────── */
.cell--orb { position: relative; }
.cell--orb::after {
  content: attr(data-orb-value) "x";
  position: absolute;
  bottom: 6px; right: 6px;
  font-size: 0.65em;
  font-weight: 900;
  color: ${cfg.chipColor};
  text-shadow: 0 0 6px rgba(255,200,80,.9), 0 1px 0 #000;
  letter-spacing: 0.02em;
  pointer-events: none;
}
@keyframes orbPulse {
  0%   { filter: brightness(1) drop-shadow(0 0 0 rgba(255,200,80,0)); }
  50%  { filter: brightness(1.5) drop-shadow(0 0 12px rgba(255,200,80,.95)); }
  100% { filter: brightness(1) drop-shadow(0 0 0 rgba(255,200,80,0)); }
}
.cell--orb.is-pulsing { animation: orbPulse ${cfg.pulseMs}ms ease-in-out 1; }
@media (prefers-reduced-motion: reduce) {
  .cell--orb.is-pulsing { animation: none; filter: brightness(1.3); }
}
`;
}

export function emitMultiplierOrbRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `/* multiplierOrb: disabled */
const MULTIPLIER_ORB_ENABLED = false;
function annotateOrbs() {}
function accumulateOrbMultiplier() { return 0; }
`;
  }
  const ID = cfg.symbolId;
  const DIST = JSON.stringify(cfg.distribution);
  const BONUS_ACC = !!cfg.bonusAccumulate;

  return `/* ─── multiplier orb runtime ──────────────────────────────────── */
const MULTIPLIER_ORB_ENABLED = true;
const MULTIPLIER_ORB_ID = "${ID}";
const MULTIPLIER_ORB_DIST = ${DIST};
const MULTIPLIER_ORB_BONUS_ACC = ${BONUS_ACC};
if (typeof window !== 'undefined') window.MULTIPLIER_ORB_ID = MULTIPLIER_ORB_ID;

/* Persistent FS multiplier — bumped every time an orb participates in a
   bonus tumble chain (pay-anywhere FS accumulating rule). Reset on
   FS_INTRO entry by handlePostSpin / FSM_enterIntro. */
let BONUS_MULTIPLIER = 0;
if (typeof window !== 'undefined') {
  window.BONUS_MULTIPLIER = 0;
  window.resetBonusMultiplier = () => { BONUS_MULTIPLIER = 0; window.BONUS_MULTIPLIER = 0; };
}

/* Weighted-random pick from MULTIPLIER_ORB_DIST. */
function pickOrbValue() {
  const total = MULTIPLIER_ORB_DIST.reduce((a, e) => a + e.weight, 0);
  let r = Math.random() * total;
  for (const e of MULTIPLIER_ORB_DIST) {
    r -= e.weight;
    if (r <= 0) return e.value;
  }
  return MULTIPLIER_ORB_DIST[0].value;
}

/* Annotate every visible orb cell with a data-orb-value attribute and
   the .cell--orb / .is-pulsing classes. Called once per spin settle. */
function annotateOrbs() {
  if (!Array.isArray(RECT_REELS)) return;
  for (let r = 0; r < RECT_REELS.length; r++) {
    const reel = RECT_REELS[r];
    if (!reel || !Array.isArray(reel.visible)) continue;
    const vRows = reel.visibleRows || reel.visible.length;
    for (let row = 0; row < vRows; row++) {
      const sym = String(reel.visible[row] || '').toUpperCase();
      const cell = (typeof reel.cellAt === 'function') ? reel.cellAt(row) : (reel.cells && reel.cells[row]);
      if (!cell) continue;
      if (sym === MULTIPLIER_ORB_ID) {
        if (!cell.dataset.orbValue) cell.dataset.orbValue = String(pickOrbValue());
        cell.classList.add('cell--orb');
        cell.classList.add('is-pulsing');
        setTimeout(() => cell.classList.remove('is-pulsing'), ${cfg.pulseMs});
      } else {
        cell.classList.remove('cell--orb');
        cell.classList.remove('is-pulsing');
        delete cell.dataset.orbValue;
      }
    }
  }
}

/* Σ(visible orb values) — used as Total_Multiplier on a tumble chain. */
function accumulateOrbMultiplier() {
  if (!Array.isArray(RECT_REELS)) return 0;
  let total = 0;
  for (let r = 0; r < RECT_REELS.length; r++) {
    const reel = RECT_REELS[r];
    if (!reel || !Array.isArray(reel.visible)) continue;
    const vRows = reel.visibleRows || reel.visible.length;
    for (let row = 0; row < vRows; row++) {
      const sym = String(reel.visible[row] || '').toUpperCase();
      const cell = (typeof reel.cellAt === 'function') ? reel.cellAt(row) : (reel.cells && reel.cells[row]);
      if (sym !== MULTIPLIER_ORB_ID || !cell) continue;
      const v = parseInt(cell.dataset.orbValue || '0', 10);
      if (Number.isFinite(v) && v > 0) total += v;
    }
  }
  // FS accumulating multiplier — bonus mode adds to persistent counter
  if (MULTIPLIER_ORB_BONUS_ACC && typeof FSM !== 'undefined' && FSM.phase === 'FS_ACTIVE' && total > 0) {
    BONUS_MULTIPLIER += total;
    if (typeof window !== 'undefined') window.BONUS_MULTIPLIER = BONUS_MULTIPLIER;
  }
  // Bonus mode returns the persistent multiplier (applies to every subsequent win)
  if (MULTIPLIER_ORB_BONUS_ACC && typeof FSM !== 'undefined' && FSM.phase === 'FS_ACTIVE') {
    return Math.max(total, BONUS_MULTIPLIER);
  }
  return total;
}

if (typeof window !== 'undefined') {
  window.annotateOrbs = annotateOrbs;
  window.accumulateOrbMultiplier = accumulateOrbMultiplier;
  window.pickOrbValue = pickOrbValue;
}

/* ── HookBus registration — wires Multiplier Orb into the spin lifecycle.
   Without this block the orb is dead code (chips never render, mult never
   applies). Order: onSpinResult annotates → onTumbleStep accumulates →
   onFsTrigger resets BONUS_MULTIPLIER between FS rounds.

   Fable audit (high): re-emit of this runtime (hot-reload, re-bake,
   dev-mode HMR) would otherwise stack listeners → annotateOrbs runs N×
   per spin → BONUS_MULTIPLIER += total fires N× → RTP drifts upward.
   Sentinel flag is idempotent across reloads. */
if (typeof HookBus !== 'undefined' &&
    !(typeof window !== 'undefined' && window.__MULTIPLIER_ORB_WIRED__)) {
  if (typeof window !== 'undefined') window.__MULTIPLIER_ORB_WIRED__ = true;
  /* On every settled grid (BASE + each FS spin): chip render + pulse. */
  HookBus.on('onSpinResult', () => {
    annotateOrbs();
  });
  /* On every tumble step (or single-eval step): sum visible orb values
     into the HookBus multiplier. In FS bonus-accumulate mode the result
     is the persistent BONUS_MULTIPLIER (rises across the round). */
  HookBus.on('onTumbleStep', () => {
    const v = accumulateOrbMultiplier();
    if (v > 0) {
      /* Bonus mode → persistent accumulator (already includes prior chain).
         Non-bonus → this-step orb sum stacks on top of existing mult. */
      if (MULTIPLIER_ORB_BONUS_ACC) HookBus.setMult(v);
      else HookBus.addMult(v);
      /* Mirror into FSM.mult so the FS HUD reads the live value. */
      if (typeof FSM !== 'undefined' && FSM.phase === 'FS_ACTIVE') {
        FSM.mult = HookBus.getMult();
        if (typeof FSM_renderHud === 'function') FSM_renderHud();
      }
    }
  });
  /* Fresh FS round → clear BONUS_MULTIPLIER so the next round starts from
     the FREESPINS.multiplier.start baseline. */
  HookBus.on('onFsTrigger', () => {
    BONUS_MULTIPLIER = 0;
    if (typeof window !== 'undefined') window.BONUS_MULTIPLIER = 0;
  });
}
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
