/**
 * Slot GDD Factory · anticipation BLOCK
 *
 * Dynamic anticipation arming — when the scatter ladder is one short of the
 * GDD's smallest trigger threshold (or already meets it with bigger awards
 * still possible), every still-spinning reel gets a gold pulse and an
 * extended sequential hold so the player reads "come on…". Each anticipating
 * reel glows for the same visible duration (HOLD_BASE), arrives one-by-one
 * (cabinet cadence), and the wave persists until the trigger is settled or
 * impossible.
 *
 * GDD-driven configuration (consumed from `model.anticipation`):
 *   enabled       boolean                                        (default true)
 *   holdMs        number ms — each reel's visible glow + hold    (default 600)
 *   pulseMs       number ms — glow keyframe cycle                (default 700)
 *   gold          "r,g,b" string — accent color                  (default "255,214,110")
 *   skipDuringFs  boolean — skip arming during FS lifecycle      (default true)
 *
 * Public API (server-side, ES module):
 *   defaultConfig() / resolveConfig(model)
 *   emitAnticipationCSS(cfg)        — pulse keyframes + classes
 *   emitAnticipationRuntime(cfg)    — maybeArmAnticipation() + HOLD_BASE
 *
 * Runtime contract:
 *   HOLD_BASE                       module-local int (used by reel engine)
 *   maybeArmAnticipation()          callback after every reel stop
 *
 * Runtime dependencies: FREESPINS, RECT_REELS, FSM, ROWS, performance.
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  holdMs: 600,
  pulseMs: 700,
  gold: '255,214,110',
  /* Boki rule: anticipation must fire EVERYWHERE — BASE and FS_ACTIVE alike.
     Pre-rule this was `true` (skip during FS lifecycle) as a QA-budget
     trade-off; that made retrigger reads feel flat. Explicit GDD knob can
     still flip it back to `true` via `skip-during-fs: true`. */
  skipDuringFs: false,
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

function isValidRGB(s) {
  if (typeof s !== 'string') return false;
  const parts = s.split(',').map(p => p.trim());
  if (parts.length !== 3) return false;
  return parts.every(p => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

export function resolveConfig(model) {
  const cfg = defaultConfig();
  const src = (model && model.anticipation) || {};

  if (src.enabled === false) cfg.enabled = false;
  if (typeof src.holdMs === 'number' && src.holdMs >= 100 && src.holdMs <= 5000) {
    cfg.holdMs = Math.floor(src.holdMs);
  }
  if (typeof src.pulseMs === 'number' && src.pulseMs >= 200 && src.pulseMs <= 5000) {
    cfg.pulseMs = Math.floor(src.pulseMs);
  }
  if (isValidRGB(src.gold)) cfg.gold = src.gold;
  /* Tri-state: explicit true → skip during FS; explicit false → run during FS
     (matches new default); undefined → defaults wins (false = "run everywhere"). */
  if (src.skipDuringFs === true) cfg.skipDuringFs = true;
  if (src.skipDuringFs === false) cfg.skipDuringFs = false;
  return cfg;
}

export function emitAnticipationCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ anticipation: cfg });
  if (!c.enabled) return `\n/* anticipation BLOCK (disabled by GDD) — no CSS emitted */\n`;

  /* ── private CSS magic-number constants ────────────────────────────────
     Every opacity / blur / accent literal that previously lived inline in
     the template now has exactly one named declaration. Opacities are kept
     as STRINGS (not Number) so the emitted CSS text is byte-identical to
     the prior hand-tuned values — e.g. "0.30" must not collapse to "0.3"
     via Number.prototype.toString(), which would break visual diffs and
     any snapshot tests in tests/visual-regression. */

  // Gold inset-border alpha at steady state. Shared by: reelCol static rule,
  // reel keyframe 0%/100%, cell keyframe 0%/100% border, AND reused as the
  // cell keyframe 50% inset-glow alpha (same numeric value, different role).
  const OPACITY_BORDER_STEADY      = '0.55';
  // Gold inset-glow alpha on the .reelCol--anticipating static (non-keyframe) rule.
  const OPACITY_GLOW_REEL_STATIC   = '0.25';
  // Gold inset-glow alpha at reel keyframe 0%/100% — the resting low end of the pulse.
  const OPACITY_GLOW_REEL_KF_BASE  = '0.22';
  // Gold inset-glow alpha at reel keyframe 50% — peak of the mid-pulse swell.
  const OPACITY_GLOW_REEL_KF_PEAK  = '0.42';
  // Lighter-accent inset-border alpha at the 50% mid-pulse highlight (both reel + cell variants).
  const OPACITY_HIGHLIGHT_MIDPULSE = '0.85';
  // Gold inset-border alpha on the .cell--anticipating static rule — slightly hotter than reel.
  const OPACITY_BORDER_CELL_STATIC = '0.6';
  // Gold inset-glow alpha on the .cell--anticipating static rule.
  const OPACITY_GLOW_CELL_STATIC   = '0.32';
  // Gold inset-glow alpha at cell keyframe 0%/100% — the resting low end of the cell pulse.
  const OPACITY_GLOW_CELL_KF_BASE  = '0.30';

  // Inset-glow blur radius on the reel column — used by static rule AND kf 0%/100%.
  const BLUR_REEL_BASE    = '35px';
  // Inset-glow blur radius on the reel column at kf 50% — wider mid-pulse spread.
  const BLUR_REEL_PEAK    = '55px';
  // Inset-glow blur radius on .cell--anticipating static rule.
  const BLUR_CELL_STATIC  = '16px';
  // Inset-glow blur radius on cell at kf 0%/100% — slightly tighter than the static rule.
  const BLUR_CELL_KF_BASE = '14px';
  // Inset-glow blur radius on cell at kf 50% — wider mid-pulse spread.
  const BLUR_CELL_PEAK    = '22px';

  // Lighter accent RGB triplet (no alpha). Used ONLY at the 50% mid-pulse
  // keyframe of both reel + cell variants to lift the border above the
  // steady GDD-knob `gold` color for a perceptible highlight pop.
  const GOLD_HIGHLIGHT_RGB = '255, 230, 168';

  return `
/* ── anticipation BLOCK — emitted by src/blocks/anticipation.mjs ──────────
   GDD knobs (baked at build time):
     enabled = ${c.enabled}
     holdMs  = ${c.holdMs}
     pulseMs = ${c.pulseMs}
     gold    = ${c.gold}
   Soft golden inset glow on the reel column / cell while the scatter ladder
   is one short of trigger. Two keyframe sets — reel-antic-pulse (column
   variant) and cell-antic-pulse (per-cell variant for non-rectangular). */
.reelCol--anticipating {
  box-shadow: inset 0 0 0 2px rgba(${c.gold}, ${OPACITY_BORDER_STEADY}),
              inset 0 0 ${BLUR_REEL_BASE} rgba(${c.gold}, ${OPACITY_GLOW_REEL_STATIC});
  animation: reel-antic-pulse ${c.pulseMs}ms ease-in-out infinite;
}
@keyframes reel-antic-pulse {
  0%, 100% { box-shadow: inset 0 0 0 2px rgba(${c.gold}, ${OPACITY_BORDER_STEADY}),
                         inset 0 0 ${BLUR_REEL_BASE} rgba(${c.gold}, ${OPACITY_GLOW_REEL_KF_BASE}); }
  50%      { box-shadow: inset 0 0 0 2px rgba(${GOLD_HIGHLIGHT_RGB}, ${OPACITY_HIGHLIGHT_MIDPULSE}),
                         inset 0 0 ${BLUR_REEL_PEAK} rgba(${c.gold}, ${OPACITY_GLOW_REEL_KF_PEAK}); }
}
.cell--anticipating {
  box-shadow: inset 0 0 0 2px rgba(${c.gold}, ${OPACITY_BORDER_CELL_STATIC}),
              inset 0 0 ${BLUR_CELL_STATIC} rgba(${c.gold}, ${OPACITY_GLOW_CELL_STATIC});
  animation: cell-antic-pulse ${c.pulseMs}ms ease-in-out infinite;
}
@keyframes cell-antic-pulse {
  0%, 100% { box-shadow: inset 0 0 0 2px rgba(${c.gold}, ${OPACITY_BORDER_STEADY}),
                         inset 0 0 ${BLUR_CELL_KF_BASE} rgba(${c.gold}, ${OPACITY_GLOW_CELL_KF_BASE}); }
  50%      { box-shadow: inset 0 0 0 2px rgba(${GOLD_HIGHLIGHT_RGB}, ${OPACITY_HIGHLIGHT_MIDPULSE}),
                         inset 0 0 ${BLUR_CELL_PEAK} rgba(${c.gold}, ${OPACITY_BORDER_STEADY}); }
}
@media (prefers-reduced-motion: reduce) {
  .reelCol--anticipating,
  .cell--anticipating { animation: none; }
}
`;
}

export function emitAnticipationRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ anticipation: cfg });
  if (!c.enabled) {
    return `
  /* ── anticipation BLOCK (disabled by GDD) ───────────────────────────── */
  const HOLD_BASE = ${c.holdMs};
  function maybeArmAnticipation() { /* no-op */ }
`;
  }
  return `
  /* ── anticipation BLOCK — emitted by src/blocks/anticipation.mjs ─────
     GDD knobs:
       holdMs       = ${c.holdMs}
       pulseMs      = ${c.pulseMs}
       gold         = ${c.gold}
       skipDuringFs = ${c.skipDuringFs}

     Dynamic anticipation arming. Called after every reel STOP transition
     in onTickAll(). Counts visible trigger symbols across the already-
     stopped reels and, if the count is one short of the GDD's smallest
     trigger threshold (or already meets it — bigger awards still on the
     line), pushes back the stop time on every still-spinning reel so the
     player sees the classic "come on…" slowdown.

     Why this works dynamically rather than pre-computed:
       1. Real spins (no FORCE_TRIGGER) can land scatters anywhere — we can
          only tell after each reel settles.
       2. Even with FORCE_TRIGGER, the random POOL can drop bonus scatters
          past the planted N, raising the award. The slowdown must hold
          until the LAST reel that could affect the award has stopped. */
  const HOLD_BASE = ${c.holdMs};

  /* Shared registry — anticipation.mjs is the single owner of the rect-reel
     kind list. Companion blocks (e.g. anticipationUniversal.mjs) read from
     window.__ANT_RECT_KINDS__ so adding/renaming a reel shape touches one
     file, not two. Idempotent: only seeded if not already present. */
  if (typeof window !== 'undefined' && !(window.__ANT_RECT_KINDS__ instanceof Set)) {
    window.__ANT_RECT_KINDS__ = new Set([
      'rectangular','cluster','megaclusters','lock_respin',
      'expanding','infinity','variable_reel',
      'diamond','pyramid','cross','l_shape'
    ]);
  }

  /* Wave S LEGO conformance — anticipation registers preSpin to clear any
     leftover glow timers / anticipating flags from the previous spin. Without
     this, a fast click after a near-miss can carry the gold pulse into the
     fresh spin (visible as ghost glow on reels 4-5 the moment they spawn). */
  function _anticipationPreSpinReset() {
    if (!Array.isArray(RECT_REELS)) return;
    for (const reel of RECT_REELS) {
      if (reel.glowTimerId) { clearTimeout(reel.glowTimerId); reel.glowTimerId = null; }
      if (reel.stopTimerId) { /* leave engine to re-set */ }
      reel.anticipating = false;
      if (reel.col && reel.col.classList) {
        reel.col.classList.remove('reelCol--anticipating');
      }
    }
    /* Per-cell variant for non-rectangular grids. */
    if (typeof document !== 'undefined') {
      document.querySelectorAll('.cell--anticipating').forEach(c =>
        c.classList.remove('cell--anticipating'));
    }
  }
  if (typeof HookBus !== 'undefined') {
    HookBus.on('preSpin', _anticipationPreSpinReset, { priority: 10 });
    /* Also reset on FS boundary — entering or leaving FS clears state. */
    HookBus.on('onFsTrigger', _anticipationPreSpinReset, { priority: 10 });
    HookBus.on('onFsEnd',     _anticipationPreSpinReset, { priority: 10 });
  }

  function maybeArmAnticipation() {
    if (!FREESPINS.enabled || !RECT_REELS) return;
    ${c.skipDuringFs ? `/* Anticipation is a BASE-game suspense cue — skipped during FS lifecycle. */
    if (FSM && FSM.phase && FSM.phase !== 'BASE') return;` : `/* skipDuringFs disabled in GDD — anticipation also runs inside FS_*. */`}
    /* 2026-06-09 — Boki bug: clicking the UFP FS chip or BUY BONUS plants
     * scatter on the first N reels via FORCE_TRIGGER. With anticipation
     * active, every reel-stop re-armed the remaining reels (scattersSoFar
     * always crossed the gate immediately), each arm appended +HOLD_BASE
     * to scheduledStopAt, and the spin never settled. Skip anticipation
     * entirely while FORCE_TRIGGER is engaged — force-spin is a deterministic
     * dev surface, the suspense beat is moot. */
    if (typeof FORCE_TRIGGER !== 'undefined' && FORCE_TRIGGER && FORCE_TRIGGER.scatterCount > 0) return;
    const threshold = (FREESPINS.triggerCounts && FREESPINS.triggerCounts[0]) ||
                      (FREESPINS.awards && FREESPINS.awards[0] && FREESPINS.awards[0].count) || 3;
    /* Highest scatter count in the ladder — anticipation persists until
       we can no longer reach it (so 4S and 5S awards keep the suspense). */
    const topRung = (FREESPINS.awards || []).reduce(
      (m, a) => Math.max(m, a.count), threshold);

    const trig = (FREESPINS.triggerSymbol || "S").toUpperCase();
    const countMode = (FREESPINS.countMode === 'any') ? 'any' : 'perReel';
    let scattersSoFar = 0;
    for (const r of RECT_REELS) {
      if (r.spinning) continue;
      let reelHits = 0;
      const vis = r.visibleRows || ROWS;
      for (let i = 1; i <= vis; i++) {
        if ((r.cells[i].textContent || "").toUpperCase() === trig) reelHits++;
      }
      scattersSoFar += (countMode === 'any') ? reelHits : (reelHits > 0 ? 1 : 0);
    }

    const stillSpinning = RECT_REELS.filter(r => r.spinning);
    if (stillSpinning.length === 0) return;

    const remaining = stillSpinning.length;
    /* Wave V1 — Boki bug fix "padne 1. ril → 2. ril → 3. ril i anticipation
       se gasi" (MASTER_TODO V1):
       Pre-fix: anticipationGate = max(1, threshold - 1). That demanded
       scattersSoFar ≥ threshold-1 BEFORE arming, which silently dropped
       the suspense the moment a mid-spin reel landed scatter-light. E.g.
       threshold=3, 1 scatter after 3 reels stopped (2 remaining) →
       1 ≥ 2 ? false → anticipation never armed even though mathematically
       1 + 2 = 3 (trigger still reachable if both remaining land scatter).
       Post-fix: anticipationGate = max(1, threshold - remaining). The
       gate now reflects "minimum scatters needed so the remaining reels
       can still hit threshold IF every one of them lands scatter". Combined
       with the (scattersSoFar + remaining >= threshold) reachability check,
       the suspense fires the moment the trigger is *mathematically alive*
       and stays armed until either threshold or topRung is settled. */
    const anticipationGate = Math.max(1, threshold - remaining);
    const armed = (scattersSoFar >= anticipationGate) &&
                  (scattersSoFar + remaining >= threshold) &&
                  (scattersSoFar < topRung);
    if (!armed) return;

    /* Sequential per-reel anticipation hold — every anticipating reel
       glows for exactly HOLD_BASE before landing. */
    const now = performance.now();
    let cursor = stillSpinning.reduce(
      (m, r) => Math.max(m, r.scheduledStopAt), now);
    const ordered = stillSpinning
      .filter(r => !r.anticipating)
      .sort((a, b) => a.scheduledStopAt - b.scheduledStopAt);
    ordered.forEach((r) => {
      r.anticipating = true;
      const glowStartAt = cursor;
      cursor += HOLD_BASE;
      r.scheduledStopAt = cursor;
      const glowDelay = Math.max(0, glowStartAt - now);
      if (r.glowTimerId) clearTimeout(r.glowTimerId);
      r.glowTimerId = setTimeout(() => {
        r.col.classList.add("reelCol--anticipating");
      }, glowDelay);
      if (r.stopTimerId) clearTimeout(r.stopTimerId);
      r.stopTimerId = setTimeout(() => {
        r.stopRequested = true;
        r.stopRequestTime = performance.now();
      }, r.scheduledStopAt - now);
    });
  }
`;
}
