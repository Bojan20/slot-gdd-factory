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
  box-shadow: inset 0 0 0 2px rgba(${c.gold}, 0.55),
              inset 0 0 35px rgba(${c.gold}, 0.25);
  animation: reel-antic-pulse ${c.pulseMs}ms ease-in-out infinite;
}
@keyframes reel-antic-pulse {
  0%, 100% { box-shadow: inset 0 0 0 2px rgba(${c.gold}, 0.55),
                         inset 0 0 35px rgba(${c.gold}, 0.22); }
  50%      { box-shadow: inset 0 0 0 2px rgba(255, 230, 168, 0.85),
                         inset 0 0 55px rgba(${c.gold}, 0.42); }
}
.cell--anticipating {
  box-shadow: inset 0 0 0 2px rgba(${c.gold}, 0.6),
              inset 0 0 16px rgba(${c.gold}, 0.32);
  animation: cell-antic-pulse ${c.pulseMs}ms ease-in-out infinite;
}
@keyframes cell-antic-pulse {
  0%, 100% { box-shadow: inset 0 0 0 2px rgba(${c.gold}, 0.55),
                         inset 0 0 14px rgba(${c.gold}, 0.30); }
  50%      { box-shadow: inset 0 0 0 2px rgba(255, 230, 168, 0.85),
                         inset 0 0 22px rgba(${c.gold}, 0.55); }
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
  function maybeArmAnticipation() {
    if (!FREESPINS.enabled || !RECT_REELS) return;
    ${c.skipDuringFs ? `/* Anticipation is a BASE-game suspense cue — skipped during FS lifecycle. */
    if (FSM && FSM.phase && FSM.phase !== 'BASE') return;` : `/* skipDuringFs disabled in GDD — anticipation also runs inside FS_*. */`}
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
    const anticipationGate = Math.max(1, threshold - 1);
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
