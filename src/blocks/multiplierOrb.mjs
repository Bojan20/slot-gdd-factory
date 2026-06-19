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
 * Industry baseline (vendor-neutral, reference standard):
 *   Cascade / pay-anywhere slots with an accumulating-multiplier orb
 *   symbol — orbs persist through the chain, sum each step, and apply
 *   to the final payout. Optional FS-only persistent accumulator.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitMultiplierOrbCSS(cfg), emitMultiplierOrbRuntime(cfg)
 *   window.annotateOrbs(), window.accumulateOrbMultiplier(),
 *   window.pickOrbValue(), window.resetBonusMultiplier()
 *
 * Lifecycle (HookBus):
 *   subscribes (priority 30): onSpinResult (annotate orbs),
 *               onTumbleStep (sum visible orb values into HookBus mult),
 *               onFsTrigger (reset BONUS_MULTIPLIER),
 *               onFsEnd (reset BONUS_MULTIPLIER, W47.S24),
 *               preSpin (ghost-orb sweeper, W47.S24)
 *
 * Performance budget:
 *   ≤ 0.5 ms per spin settle on 5×4 grid; ≤ 1 listener per event
 *   (wired-once via window.__MULTIPLIER_ORB_WIRED__ sentinel so HMR
 *   never stacks listeners and inflates RTP).
 *
 * a11y:
 *   chip is decorative (rendered via ::after content) — underlying
 *   cell semantics retained; prefers-reduced-motion kills the pulse
 *   keyframe via media-query in the CSS emit.
 *
 * Bake-time config (resolved from model.multiplierOrb):
 *   { enabled, symbolId, distribution: [{value, weight}, ...],
 *     bonusAccumulate: false, chipColor, chipGlow, chipShadow, pulseMs }
 */

const PULSE_MS_MIN = 100;
const PULSE_MS_MAX = 5000;
const PULSE_MS_DEFAULT = 1000;
const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export function defaultConfig() {
  return Object.freeze({
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
    chipGlow: '255,200,80',   // RGB values for glow effect (opacities added in CSS)
    chipShadow: '#000',       // Shadow color for text-shadow
    pulseMs: PULSE_MS_DEFAULT,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
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
  if (typeof m.chipGlow === 'string') cfg.chipGlow = m.chipGlow;
  if (typeof m.chipShadow === 'string') cfg.chipShadow = m.chipShadow;
  if (Number.isFinite(m.pulseMs)) cfg.pulseMs = clampInt(m.pulseMs, PULSE_MS_MIN, PULSE_MS_MAX);

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
  text-shadow: 0 0 6px rgba(${cfg.chipGlow},.9), 0 1px 0 ${cfg.chipShadow};
  letter-spacing: 0.02em;
  pointer-events: none;
}
@keyframes orbPulse {
  0%   { filter: brightness(1) drop-shadow(0 0 0 rgba(${cfg.chipGlow},0)); }
  50%  { filter: brightness(1.5) drop-shadow(0 0 12px rgba(${cfg.chipGlow},.95)); }
  100% { filter: brightness(1) drop-shadow(0 0 0 rgba(${cfg.chipGlow},0)); }
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
const ORB_RNG = (typeof window !== 'undefined' && window.GameRNG?.next) ? window.GameRNG.next : Math.random;
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
  let r = ORB_RNG() * total;
  for (const e of MULTIPLIER_ORB_DIST) {
    r -= e.weight;
    if (r <= 0) return e.value;
  }
  return MULTIPLIER_ORB_DIST[0].value;
}

/* Annotate every visible orb cell with a data-orb-value attribute and
   the .cell--orb / .is-pulsing classes. Called once per spin settle.
   Perf budget: ≤0.5 ms per spin settle on 5×4 grid. */
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
    return BONUS_MULTIPLIER;
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
  /* F3 priority 30 — decorator class. Orb chip rendering + multiplier
     accumulation runs AFTER state-mutators (winCap clamp) and payout
     evaluators have set ev.payX, but BEFORE telemetry/HUD readers consume
     HookBus.getMult(). Decorator order among siblings is not critical. */
  HookBus.on('onSpinResult', () => {
    /* 2026-06-18 — Boki rule "kad se udje u h&w menja se mesto multipliera
     * na celijama. uostalom, sta ce multiplieri tu". Industry rule: base-
     * game multiplier chips DO NOT render during Hold & Win round — H&W
     * has its own orb-value system (1x/5x/MINI/MAJOR/GRAND). Two-chip
     * stack on the same cell creates visual conflict and the "menja se
     * mesto" drift Boki reported. Guard on every annotateOrbs entry. */
    if (typeof window !== 'undefined' && window.HW_STATE && window.HW_STATE.active) return;
    annotateOrbs();
  }, { priority: 30 });
  /* On every tumble step (or single-eval step): sum visible orb values
     into the HookBus multiplier. In FS bonus-accumulate mode the result
     is the persistent BONUS_MULTIPLIER (rises across the round). */
  HookBus.on('onTumbleStep', () => {
    /* 2026-06-18 — same H&W guard; orb mult accumulation must NOT
     * fire during H&W round (cells are anchored bonus orbs, not
     * tumble-step multiplier orbs). */
    if (typeof window !== 'undefined' && window.HW_STATE && window.HW_STATE.active) return;
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
  }, { priority: 30 });

  /* 2026-06-18 — clear stale base-game multiplier orb chips when H&W
   * intro mounts. Strictly the .cell--orb cells that AREN'T H&W lock
   * targets (.is-locked-bonus owns the same data-orb-value attribute
   * for its own orb chip — those must stay). */
  HookBus.on('onHoldAndWinIntro', () => {
    try {
      const cells = document.querySelectorAll('.cell.cell--orb');
      cells.forEach(c => {
        if (c.classList.contains('is-locked-bonus')) return;
        c.classList.remove('cell--orb');
        c.removeAttribute('data-orb-value');
      });
    } catch (e) {
      /* FIX-8 M1 (2026-06-19) — orb render path is UI-critical. */
      try { if (typeof console !== 'undefined' && console.warn) console.warn('[multiplierOrb] cell render failed', e); } catch (_) {}
    }
  }, { priority: 30 });
  /* Fresh FS round → clear BONUS_MULTIPLIER so the next round starts from
     the FREESPINS.multiplier.start baseline. */
  HookBus.on('onFsTrigger', () => {
    BONUS_MULTIPLIER = 0;
    if (typeof window !== 'undefined') window.BONUS_MULTIPLIER = 0;
  }, { priority: 30 });
  /* W47.S24 audit fix — FS round ENDS → clear BONUS_MULTIPLIER so the
     persisted FS bonus accumulator doesn't bleed into the next BASE
     spin's mult readout. Without this, the FS final mult stayed in
     window.BONUS_MULTIPLIER until the next FS trigger; any base-game
     reader of the global saw a stale FS value. */
  HookBus.on('onFsEnd', () => {
    BONUS_MULTIPLIER = 0;
    if (typeof window !== 'undefined') window.BONUS_MULTIPLIER = 0;
  }, { priority: 30 });
  /* W47.S24 audit fix — preSpin GHOST-orb sweeper. If the engine
     re-paints reels mid-cycle (force-spin / fast respin / autoplay
     stage skip), orb classes from the PRIOR spin could be re-discovered
     on the new symbols by accumulateOrbMultiplier and stacked. Strip
     .cell--orb / .is-pulsing / data-orb-value at preSpin so the new
     spin's settle path is the single source of truth. */
  HookBus.on('preSpin', () => {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.cell--orb, .cell.is-pulsing').forEach(c => {
      c.classList.remove('cell--orb');
      c.classList.remove('is-pulsing');
      if (c.dataset) delete c.dataset.orbValue;
    });
  }, { priority: 30 });
}
`;
}
