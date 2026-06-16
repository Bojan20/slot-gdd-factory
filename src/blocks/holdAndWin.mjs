/**
 * src/blocks/holdAndWin.mjs
 *
 * Hold & Win / Hold & Spin block — industry-standard lock-and-respin pattern.
 *
 * Trigger: ≥N bonus/coin symbols on the grid → enter Hold round.
 * Mechanics: bonus symbols lock as orbs (with value 1x..GRAND), you get K
 * (default 3) respins. Each new bonus symbol RESETS the respin counter to K.
 * Round ends when respins exhausted OR every cell is locked (GRAND FULL-GRID
 * 500x bonus celebration).
 *
 * 2026-06-11 (Boki: "hold and win nije dobar, prepisi od WoO igre sto sam
 * pravio. ultimativni fix sa krpljenjem svih mogucih scenarija") — full
 * WoO Zeus' Storm rewrite:
 *
 *   PHASE MACHINE — INACTIVE → INTRO → RUNNING → SUMMARY
 *     • INTRO: full-screen placard with title + "N ORBS COLLECTED",
 *       continue-blink CTA, click-anywhere skip.
 *     • RUNNING: HUD with RESPINS / LOCKED / TOTAL counters; tension
 *       states (.tension at 2 respins, .final at 1); per-orb pop-in,
 *       win-delta chip rising over the cell, fly animation from cell
 *       to total counter; jackpot tier celebration overlays for
 *       MINI / MINOR / MAJOR / GRAND; full-grid (= REELS×ROWS locked)
 *       triggers FULL-GRID 500x mega celebration.
 *     • SUMMARY: final stats placard — total win, orbs collected,
 *       jackpot tiers hit, full-grid badge.
 *
 *   ORB ANCHOR — locked cells render as full coin-orbs with their value
 *   chip ('5x', 'MINI', 'GRAND') drawn dead-center. reelEngine
 *   rotateStripDown / commitStopSymbols + tumble guards already skip
 *   .is-locked-bonus; a MutationObserver with re-entrance flag heals any
 *   third-party clobber. WoO Zeus' Storm orb-is-sacred contract.
 *
 * GDD knobs:
 *   • triggerCount: number — min bonus symbols to enter Hold (default 6)
 *   • bonusSymbolId: string — the lockable coin/bonus symbol
 *   • respinsAwarded: number — initial respin count (default 3)
 *   • resetOnNewBonus: boolean — each new bonus resets to respinsAwarded
 *   • haloColor: 'r,g,b'
 *   • jackpotLabels: array ('MINI','MINOR','MAJOR','GRAND')
 *   • fullGridBonusX: number — multiplier awarded when every cell locks
 *   • title: short string — intro placard title ("ZEUS' STORM" / etc.)
 *   • subtitle: short string — intro placard subtitle ("Hold & Win")
 *   • showIntro: boolean — emit the intro overlay sequence (default true)
 *   • showSummary: boolean — emit the summary overlay (default true)
 */

export function defaultConfig() {
  return {
    enabled: false,
    triggerCount: 6,
    bonusSymbolId: 'B',
    respinsAwarded: 3,
    resetOnNewBonus: true,
    haloColor: '255,160,40',
    jackpotLabels: ['MINI', 'MINOR', 'MAJOR', 'GRAND'],
    fullGridBonusX: 500,
    title: "HOLD & WIN",
    subtitle: 'COLLECT THE ORBS',
    showIntro: true,
    showSummary: true,
    /* Grid dims — single authoritative source so key encoding
     * (r*REELS+c) and full-grid trigger (size >= REELS*ROWS) work on any
     * non-5×3 layout. Resolved from model.reels/model.rows by
     * resolveConfig, never from window globals at runtime. */
    reels: 5,
    rows: 3,
    /* Timings (ms) — surface for GDD override, no inline magic numbers. */
    timings: {
      introAutoMs: 1600,
      summaryAutoMs: 1800,
      endFullGridMs: 2200,
      endNormalMs: 600,
      forceFallbackMs: 1700,
      jackpotDelayMs: 280,
      jackpotShortMs: 1600,
      jackpotGrandMs: 2200,
      fullGridMs: 2600,
      /* W48 bugfix v3 (Boki 2026-06-16) — bonus-symbol celebration window
       * BEFORE the H&W intro placard mounts. Mirrors the scatter
       * celebration cadence used in the FS trigger flow (~1500ms). */
      bonusCelebrateMs: 1500,
    },
    /* Orb distribution — null = built-in Zeus' Storm table. GDD may
     * override with array of { label, weight, tier, valueX }. */
    orbTable: null,
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.holdAndWin || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.triggerCount)) cfg.triggerCount = clampInt(m.triggerCount, 3, 30);
  if (typeof m.bonusSymbolId === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(m.bonusSymbolId)) cfg.bonusSymbolId = m.bonusSymbolId;
  if (Number.isFinite(m.respinsAwarded)) cfg.respinsAwarded = clampInt(m.respinsAwarded, 1, 12);
  if (m.resetOnNewBonus != null) cfg.resetOnNewBonus = !!m.resetOnNewBonus;
  if (typeof m.haloColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.haloColor)) cfg.haloColor = m.haloColor;
  if (Array.isArray(m.jackpotLabels) && m.jackpotLabels.every(l => typeof l === 'string' && l.length <= 16)) {
    cfg.jackpotLabels = m.jackpotLabels.slice(0, 6);
  }
  if (Number.isFinite(m.fullGridBonusX)) cfg.fullGridBonusX = clampInt(m.fullGridBonusX, 10, 10000);
  if (typeof m.title === 'string' && m.title.length > 0 && m.title.length <= 32 && !/[<>{}]/.test(m.title)) cfg.title = m.title;
  if (typeof m.subtitle === 'string' && m.subtitle.length <= 48 && !/[<>{}]/.test(m.subtitle)) cfg.subtitle = m.subtitle;
  if (m.showIntro === false) cfg.showIntro = false;
  if (m.showSummary === false) cfg.showSummary = false;
  /* Grid dims — pull from top-level model so any GDD that specifies a
   * non-5×3 layout flows through to runtime constants. */
  if (Number.isFinite(model.reels)) cfg.reels = clampInt(model.reels, 1, 16);
  if (Number.isFinite(model.rows))  cfg.rows  = clampInt(model.rows,  1, 16);
  if (m.timings && typeof m.timings === 'object') {
    for (const k of Object.keys(cfg.timings)) {
      if (Number.isFinite(m.timings[k])) cfg.timings[k] = clampInt(m.timings[k], 0, 60000);
    }
  }
  if (Array.isArray(m.orbTable) && m.orbTable.every(e =>
    e && typeof e.label === 'string' &&
    Number.isFinite(e.weight) && Number.isFinite(e.valueX))) {
    cfg.orbTable = m.orbTable.slice();
  }
  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'hold_and_win')) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitHoldAndWinCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── hold & win (Zeus' Storm pattern) ──────────────────────────── */
/* Orb anchor — locked cells render as gold coin-orbs with their value
 * chip dead-center via ::before. reelEngine rotateStripDown +
 * commitStopSymbols skip .is-locked-bonus cells; a MutationObserver
 * heals any third-party clobber. */
.cell.is-locked-bonus {
  position: relative;
  background:
    radial-gradient(circle at 50% 42%,
      rgba(${cfg.haloColor},1.00) 0%,
      rgba(${cfg.haloColor},0.85) 40%,
      rgba(${cfg.haloColor},0.40) 70%,
      rgba(0,0,0,0.85) 100%) !important;
  box-shadow:
    0 0 0 3px rgba(${cfg.haloColor},.95),
    0 0 28px rgba(${cfg.haloColor},.7),
    inset 0 -4px 12px rgba(0,0,0,.45),
    inset 0 2px 6px rgba(255,255,255,.35);
  color: transparent !important;
  text-shadow: none !important;
  z-index: 4;
  animation: hwLocked 1600ms ease-in-out infinite;
  overflow: hidden;
}
.cell.is-locked-bonus::before {
  content: attr(data-orb-value);
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font: 900 1.05rem/1 system-ui, -apple-system, "SF Pro Display", "Segoe UI", sans-serif;
  letter-spacing: 0.05em;
  color: #1a0a00;
  text-shadow: 0 1px 0 rgba(255,255,255,.55), 0 -1px 1px rgba(0,0,0,.35);
  pointer-events: none;
  z-index: 2;
}
.cell.is-locked-bonus::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(ellipse at 50% 22%,
    rgba(255,255,255,.55) 0%,
    rgba(255,255,255,0) 60%);
  pointer-events: none;
  z-index: 1;
}
.cell.is-locked-bonus[data-orb-tier="MINI"]  {
  box-shadow: 0 0 0 3px #6cb6ff, 0 0 32px rgba(108,182,255,.85),
              inset 0 -4px 12px rgba(0,0,0,.45), inset 0 2px 6px rgba(255,255,255,.35);
}
.cell.is-locked-bonus[data-orb-tier="MINOR"] {
  box-shadow: 0 0 0 3px #7fffa7, 0 0 32px rgba(127,255,167,.85),
              inset 0 -4px 12px rgba(0,0,0,.45), inset 0 2px 6px rgba(255,255,255,.35);
}
.cell.is-locked-bonus[data-orb-tier="MAJOR"] {
  box-shadow: 0 0 0 3px #c084ff, 0 0 36px rgba(192,132,255,.9),
              inset 0 -4px 12px rgba(0,0,0,.45), inset 0 2px 6px rgba(255,255,255,.35);
}
.cell.is-locked-bonus[data-orb-tier="GRAND"] {
  box-shadow: 0 0 0 3px #ff5566, 0 0 44px rgba(255,85,102,.95),
              inset 0 -4px 12px rgba(0,0,0,.45), inset 0 2px 6px rgba(255,255,255,.35);
  animation: hwLockedGrand 900ms ease-in-out infinite alternate;
}
@keyframes hwLocked {
  0%, 100% { filter: brightness(1)    saturate(1); transform: scale(1); }
  50%      { filter: brightness(1.22) saturate(1.15); transform: scale(1.04); }
}
@keyframes hwLockedGrand {
  from { filter: brightness(1)    saturate(1)    drop-shadow(0 0 6px rgba(255,85,102,.6)); }
  to   { filter: brightness(1.35) saturate(1.25) drop-shadow(0 0 16px rgba(255,85,102,1)); }
}
.cell.is-locked-bonus.hw-just-landed {
  animation: hwLandPop 520ms cubic-bezier(.2,1.4,.4,1) 1, hwLocked 1600ms ease-in-out infinite 520ms;
}
@keyframes hwLandPop {
  0%   { transform: scale(0.2) rotate(-12deg); opacity: 0; }
  60%  { transform: scale(1.18) rotate(4deg); opacity: 1; }
  100% { transform: scale(1) rotate(0); opacity: 1; }
}

/* ── HUD (RESPINS / LOCKED / TOTAL) ── */
.hw-hud {
  position: fixed;
  /* W47.S8 (A9 safe-area) — was top: 60px which collided with the
   * notch on iPhone Pro Max landscape. Honour env(safe-area-inset-top)
   * with a 60px fallback so the HUD slides INWARD on noctched devices. */
  top: calc(max(60px, env(safe-area-inset-top, 0px) + 60px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 70;
  background: rgba(0,0,0,.82);
  border: 2px solid rgba(${cfg.haloColor},.7);
  border-radius: 16px;
  padding: 0.6rem 1.2rem;
  color: rgba(${cfg.haloColor},1);
  font-weight: 900;
  letter-spacing: 0.08em;
  display: none;
  gap: 1.3rem;
  text-shadow: 0 0 6px rgba(${cfg.haloColor},.7);
  box-shadow: 0 0 18px rgba(${cfg.haloColor},.45);
}
.hw-hud[data-show="true"] { display: inline-flex; }
.hw-hud .hw-box { display: flex; flex-direction: column; align-items: center; min-width: 56px; }
.hw-hud .hw-lbl { font-size: 0.7rem; opacity: 0.75; letter-spacing: 0.12em; }
.hw-hud .hw-val { font-size: 1.15rem; transition: color 220ms ease, transform 220ms ease; }
.hw-hud .hw-box.tension .hw-val { color: #ffd24a; }
.hw-hud .hw-box.final   .hw-val {
  color: #ff5566;
  animation: hwTensionFinal 700ms ease-in-out infinite;
}
@keyframes hwTensionFinal {
  0%, 100% { transform: scale(1);    text-shadow: 0 0 8px rgba(255,85,102,.7); }
  50%      { transform: scale(1.18); text-shadow: 0 0 18px rgba(255,85,102,1); }
}
.hw-hud .hw-box.tick .hw-val {
  animation: hwTickPulse 280ms ease-out 1;
}
@keyframes hwTickPulse {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.3); }
  100% { transform: scale(1); }
}

/* ── INTRO overlay ── */
.hw-intro {
  position: fixed;
  inset: 0;
  z-index: 95;
  background: radial-gradient(ellipse at center,
    rgba(${cfg.haloColor},0.18) 0%,
    rgba(0,0,0,0.92) 65%);
  backdrop-filter: blur(6px);
  display: none;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  cursor: pointer;
}
.hw-intro[data-show="true"] { display: flex; animation: hwIntroFadeIn 220ms ease-out; }
@keyframes hwIntroFadeIn { from { opacity: 0; } to { opacity: 1; } }
.hw-intro__inner {
  text-align: center;
  color: #fff;
  padding: 0 1rem;
}
.hw-intro__title {
  font: 900 2.6rem/1 system-ui, -apple-system, "SF Pro Display", serif;
  letter-spacing: 0.18em;
  color: rgba(${cfg.haloColor},1);
  text-shadow:
    0 0 24px rgba(${cfg.haloColor},.9),
    0 4px 10px rgba(0,0,0,.6);
  margin-bottom: 0.4rem;
  opacity: 0;
  transform: translateY(20px);
  animation: hwIntroTitleIn 600ms cubic-bezier(.2,1.4,.4,1) 60ms forwards;
}
@keyframes hwIntroTitleIn {
  from { opacity: 0; transform: translateY(24px) scale(.92); }
  to   { opacity: 1; transform: translateY(0)    scale(1);   }
}
.hw-intro__subtitle {
  font: 700 0.95rem/1 system-ui, -apple-system, sans-serif;
  letter-spacing: 0.32em;
  color: rgba(255,255,255,0.75);
  margin-bottom: 1.5rem;
  opacity: 0;
  animation: hwFadeSlow 500ms ease-out 380ms forwards;
}
.hw-intro__orbcount {
  font: 900 1.6rem/1 system-ui, -apple-system, sans-serif;
  letter-spacing: 0.14em;
  color: rgba(${cfg.haloColor},1);
  text-shadow: 0 0 16px rgba(${cfg.haloColor},.8);
  margin-bottom: 1.4rem;
  opacity: 0;
  animation: hwFadeSlow 460ms ease-out 700ms forwards;
}
.hw-intro__cta {
  font: 700 0.85rem/1 system-ui, sans-serif;
  letter-spacing: 0.24em;
  color: rgba(255,255,255,0.65);
  opacity: 0;
  animation: hwFadeSlow 360ms ease-out 1050ms forwards,
             hwBlink 1100ms ease-in-out 1450ms infinite;
}
@keyframes hwFadeSlow { from { opacity: 0; } to { opacity: 1; } }
@keyframes hwBlink    { 0%, 100% { opacity: 0.65; } 50% { opacity: 1; } }

/* ── Win delta chip ── */
.hw-delta {
  position: fixed;
  pointer-events: none;
  z-index: 88;
  font: 900 1.15rem/1 system-ui, sans-serif;
  letter-spacing: 0.06em;
  color: rgba(${cfg.haloColor},1);
  text-shadow: 0 0 12px rgba(${cfg.haloColor},.9), 0 2px 4px rgba(0,0,0,.6);
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.6);
  animation: hwDeltaRise 1100ms cubic-bezier(.2,1.4,.4,1) forwards;
}
@keyframes hwDeltaRise {
  0%   { opacity: 0; transform: translate(-50%, -30%) scale(.4); }
  18%  { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
  60%  { opacity: 1; transform: translate(-50%, -90%) scale(1.0); }
  100% { opacity: 0; transform: translate(-50%, -130%) scale(.85); }
}

/* ── Fly animation: orb value flies from cell to total counter ── */
.hw-fly {
  position: fixed;
  pointer-events: none;
  z-index: 89;
  font: 900 1rem/1 system-ui, sans-serif;
  color: rgba(${cfg.haloColor},1);
  text-shadow: 0 0 12px rgba(${cfg.haloColor},.95);
  will-change: transform, opacity;
}

/* ── Jackpot celebration overlays ── */
.hw-jackpot {
  position: fixed;
  inset: 0;
  z-index: 96;
  display: none;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at center, rgba(0,0,0,.7) 0%, rgba(0,0,0,.92) 70%);
  pointer-events: none;
}
.hw-jackpot[data-show="true"] { display: flex; animation: hwIntroFadeIn 180ms ease-out; }
.hw-jackpot__inner {
  text-align: center;
  padding: 1.4rem 2rem;
  border-radius: 22px;
  border: 3px solid;
  animation: hwJackpotPop 600ms cubic-bezier(.2,1.4,.4,1) 1, hwJackpotIdle 1100ms ease-in-out 600ms infinite;
}
@keyframes hwJackpotPop {
  from { transform: scale(0.4) rotate(-6deg); opacity: 0; }
  to   { transform: scale(1)   rotate(0);     opacity: 1; }
}
@keyframes hwJackpotIdle {
  0%, 100% { transform: scale(1);    filter: brightness(1); }
  50%      { transform: scale(1.05); filter: brightness(1.25); }
}
.hw-jackpot__label {
  font: 900 2.2rem/1 system-ui, sans-serif;
  letter-spacing: 0.22em;
  margin-bottom: 0.6rem;
}
.hw-jackpot__value {
  font: 900 1.5rem/1 system-ui, sans-serif;
  letter-spacing: 0.08em;
  color: rgba(255,255,255,0.95);
  text-shadow: 0 2px 8px rgba(0,0,0,.6);
}
.hw-jackpot[data-tier="MINI"]  .hw-jackpot__inner { border-color: #6cb6ff; box-shadow: 0 0 60px rgba(108,182,255,.85); }
.hw-jackpot[data-tier="MINOR"] .hw-jackpot__inner { border-color: #7fffa7; box-shadow: 0 0 60px rgba(127,255,167,.85); }
.hw-jackpot[data-tier="MAJOR"] .hw-jackpot__inner { border-color: #c084ff; box-shadow: 0 0 80px rgba(192,132,255,.9);  }
.hw-jackpot[data-tier="GRAND"] .hw-jackpot__inner { border-color: #ff5566; box-shadow: 0 0 100px rgba(255,85,102,.95); }
.hw-jackpot[data-tier="MINI"]  .hw-jackpot__label { color: #6cb6ff; text-shadow: 0 0 24px rgba(108,182,255,.95); }
.hw-jackpot[data-tier="MINOR"] .hw-jackpot__label { color: #7fffa7; text-shadow: 0 0 24px rgba(127,255,167,.95); }
.hw-jackpot[data-tier="MAJOR"] .hw-jackpot__label { color: #c084ff; text-shadow: 0 0 28px rgba(192,132,255,.95); }
.hw-jackpot[data-tier="GRAND"] .hw-jackpot__label { color: #ff5566; text-shadow: 0 0 32px rgba(255,85,102,1.0);  }

/* ── Full-grid mega bonus ── */
.hw-fullgrid {
  position: fixed;
  inset: 0;
  z-index: 97;
  display: none;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at center,
    rgba(255,210,80,.32) 0%,
    rgba(0,0,0,.95) 75%);
  pointer-events: none;
}
.hw-fullgrid[data-show="true"] { display: flex; animation: hwIntroFadeIn 220ms ease-out; }
.hw-fullgrid__title {
  font: 900 3rem/1 system-ui, sans-serif;
  letter-spacing: 0.2em;
  color: #ffd24a;
  text-shadow: 0 0 38px rgba(255,210,80,1), 0 4px 10px rgba(0,0,0,.6);
  animation: hwFullGridThrob 800ms ease-in-out infinite alternate;
  text-align: center;
}
@keyframes hwFullGridThrob {
  from { transform: scale(1);    filter: brightness(1); }
  to   { transform: scale(1.08); filter: brightness(1.35); }
}
.hw-fullgrid__bonus {
  margin-top: 1rem;
  font: 900 1.5rem/1 system-ui, sans-serif;
  letter-spacing: 0.12em;
  color: #fff;
  text-shadow: 0 0 18px rgba(255,210,80,.95);
}

/* ── Summary overlay ── */
.hw-summary {
  position: fixed;
  inset: 0;
  z-index: 95;
  background: rgba(0,0,0,0.86);
  backdrop-filter: blur(8px);
  display: none;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  cursor: pointer;
}
.hw-summary[data-show="true"] { display: flex; animation: hwIntroFadeIn 220ms ease-out; }
.hw-summary__inner {
  text-align: center;
  padding: 1.6rem 2rem;
  border: 2.5px solid rgba(${cfg.haloColor},.85);
  border-radius: 20px;
  background: linear-gradient(160deg, rgba(40,28,8,.92), rgba(12,8,2,.95));
  box-shadow: 0 0 50px rgba(${cfg.haloColor},.5);
  min-width: min(360px, 90vw);
  color: #fff;
}
.hw-summary__title {
  font: 900 1.4rem/1 system-ui, sans-serif;
  letter-spacing: 0.18em;
  color: rgba(${cfg.haloColor},1);
  text-shadow: 0 0 18px rgba(${cfg.haloColor},.85);
  margin-bottom: 0.8rem;
}
.hw-summary__total {
  font: 900 2.4rem/1 system-ui, sans-serif;
  color: rgba(${cfg.haloColor},1);
  text-shadow: 0 0 20px rgba(${cfg.haloColor},.9);
  margin-bottom: 0.6rem;
}
.hw-summary__stats {
  font-size: 0.95rem;
  letter-spacing: 0.06em;
  margin-bottom: 1.1rem;
  color: rgba(255,255,255,0.85);
}
.hw-summary__stats span { color: rgba(${cfg.haloColor},1); font-weight: 900; }
.hw-summary__cta {
  font: 700 0.85rem/1 system-ui, sans-serif;
  letter-spacing: 0.22em;
  color: rgba(255,255,255,0.7);
  animation: hwBlink 1100ms ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .cell.is-locked-bonus,
  .cell.is-locked-bonus[data-orb-tier="GRAND"],
  .cell.is-locked-bonus.hw-just-landed,
  .hw-hud .hw-box.final .hw-val,
  .hw-hud .hw-box.tick .hw-val,
  .hw-intro__title,
  .hw-intro__subtitle,
  .hw-intro__orbcount,
  .hw-intro__cta,
  .hw-delta,
  .hw-jackpot__inner,
  .hw-fullgrid__title,
  .hw-summary__cta,
  .cell.cell--hnw-bonus-celebrate { animation: none; transform: none; }
}

/* ─── W48 BUGFIX v3 — bonus symbol celebration on H&W trigger ───────────
 * Boki rule (2026-06-16, third pass): "za hold and win, mora prvo da se
 * zavrsi spin, da se prikaze animacija dobitka pa tek onda da se udje u
 * hold and win". Parallel to the FS-trigger flow: scatter celebration
 * plays for ~1500ms BEFORE the FS intro placard; the H&W flow needs the
 * same — when the trigger pile lands, pulse the bonus cells first, THEN
 * mount the intro. Reuses the scatterCelebration pattern (host class +
 * per-cell pulse keyframe) so visual cadence reads consistent between
 * trigger types. */
.gridHost.is-hnw-bonus-celebrating .cell,
.gridHost.is-hnw-bonus-celebrating text {
  filter: brightness(0.55) saturate(0.7);
  transition: filter 180ms ease;
}
.gridHost.is-hnw-bonus-celebrating .cell.cell--hnw-bonus-celebrate,
.gridHost.is-hnw-bonus-celebrating text.cell--hnw-bonus-celebrate {
  filter: brightness(1.45) saturate(1.25)
          drop-shadow(0 0 12px rgba(${cfg.haloColor}, 0.9));
  animation: hwBonusCelebrate 380ms ease-in-out 4;
  z-index: 5;
}
@keyframes hwBonusCelebrate {
  0%, 100% { transform: scale(1);    box-shadow: 0 0 0  rgba(${cfg.haloColor}, 0); }
  50%      { transform: scale(1.16); box-shadow: 0 0 24px rgba(${cfg.haloColor}, 0.85); }
}

/* ─── W48 BUGFIX — H&W per-cell respin (Boki 2026-06-16) ────────────────
 * Industry reference (template-neutral): the canonical hold-and-spin
 * round renders the spin as INDEPENDENT per-cell CSS animations on
 * non-orb cells, with NO parent strip transform applied. The strip
 * itself stays still; each non-orb cell animates its own pulse + sweep,
 * then a staggered stop reveals the new symbol per cell.
 *
 * Pre-existing slot-gdd-factory model translated the WHOLE strip via
 * reel.strip.style.transform; the orb cells visually drifted with the
 * spin even after rotateStripDown pinned their array index. The fix is
 * to branch reelEngine.runOneBaseSpin into a dedicated per-cell respin
 * mode when HW_STATE.active is true: each .cell (except .is-locked-bonus)
 * gets the .hnw-cell-spinning class, a sweep + pulse plays in place, and
 * after a stagger window each cell stops independently
 * (.hnw-cell-stopping then .hnw-cell-stopped). The strip never translates.
 * Locked cells get explicit suppression of any of the three per-cell
 * classes — they stay statically rendered as orbs the entire respin. */
.cell.hnw-cell-spinning {
  position: relative;
  overflow: hidden;
  animation: hnwCellPulse 0.6s ease-in-out infinite;
}
.cell.hnw-cell-spinning::after {
  content: "";
  position: absolute;
  inset: 4px;
  background: linear-gradient(90deg,
    transparent 0%,
    rgba(${cfg.haloColor}, 0.55) 50%,
    transparent 100%
  );
  animation: hnwCellSweep 0.8s linear infinite;
  border-radius: 6px;
  pointer-events: none;
  z-index: 1;
}
@keyframes hnwCellPulse {
  0%, 100% { box-shadow: inset 0 0 8px  rgba(${cfg.haloColor}, 0.28); }
  50%      { box-shadow: inset 0 0 22px rgba(${cfg.haloColor}, 0.55); }
}
@keyframes hnwCellSweep {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
.cell.hnw-cell-stopping {
  animation: hnwCellStopping 0.16s ease-out;
}
@keyframes hnwCellStopping {
  0%   { transform: scale(1.06); }
  100% { transform: scale(1); }
}
.cell.hnw-cell-stopped {
  animation: hnwCellLanded 0.34s cubic-bezier(.2, 1.4, .4, 1);
}
@keyframes hnwCellLanded {
  0%   { transform: scale(0.82); filter: brightness(1.6); }
  55%  { transform: scale(1.10); }
  100% { transform: scale(1);    filter: brightness(1); }
}
/* Hard suppression — locked orbs NEVER take the per-cell classes even if
 * the engine accidentally tagged them. Belt-and-brace seatbelt. */
.cell.is-locked-bonus.hnw-cell-spinning,
.cell.is-locked-bonus.hnw-cell-stopping,
.cell.is-locked-bonus.hnw-cell-stopped {
  animation: hwLocked 1600ms ease-in-out infinite !important;
}
.cell.is-locked-bonus.hnw-cell-spinning::after { display: none !important; }

@media (prefers-reduced-motion: reduce) {
  .cell.hnw-cell-spinning,
  .cell.hnw-cell-stopping,
  .cell.hnw-cell-stopped { animation: none !important; }
  .cell.hnw-cell-spinning::after { animation: none !important; display: none !important; }
}
`;
}

export function emitHoldAndWinMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="hwHud" class="hw-hud" data-show="false" aria-live="polite">
  <div class="hw-box" id="hwRespinsBox"><span class="hw-lbl">RESPINS</span><span class="hw-val" id="hwRespins">${cfg.respinsAwarded}</span></div>
  <div class="hw-box" id="hwLockedBox"><span class="hw-lbl">LOCKED</span><span class="hw-val" id="hwLocked">0</span></div>
  <div class="hw-box" id="hwTotalBox"><span class="hw-lbl">TOTAL</span><span class="hw-val" id="hwTotal">0.00</span></div>
</div>
<div id="hwIntro" class="hw-intro" data-show="false" role="dialog" aria-modal="true" aria-labelledby="hwIntroTitle" tabindex="0" aria-label="Hold and Win intro — press Enter or Space to continue">
  <div class="hw-intro__inner">
    <div id="hwIntroTitle" class="hw-intro__title">${escapeHtml(cfg.title)}</div>
    <div class="hw-intro__subtitle">${escapeHtml(cfg.subtitle)}</div>
    <div id="hwIntroOrbCount" class="hw-intro__orbcount">0 ORBS</div>
    <div class="hw-intro__cta">TAP TO CONTINUE</div>
  </div>
</div>
<div id="hwJackpot" class="hw-jackpot" data-show="false" data-tier="">
  <div class="hw-jackpot__inner">
    <div id="hwJackpotLabel" class="hw-jackpot__label">MINI</div>
    <div id="hwJackpotValue" class="hw-jackpot__value">+0.00</div>
  </div>
</div>
<div id="hwFullgrid" class="hw-fullgrid" data-show="false">
  <div>
    <div class="hw-fullgrid__title">FULL GRID!</div>
    <div class="hw-fullgrid__bonus" id="hwFullgridBonus">+${cfg.fullGridBonusX}×</div>
  </div>
</div>
<div id="hwSummary" class="hw-summary" data-show="false" role="dialog" aria-modal="true" tabindex="0" aria-label="Hold and Win summary — press Enter or Space to collect">
  <div class="hw-summary__inner">
    <div class="hw-summary__title">COLLECT</div>
    <div class="hw-summary__total" id="hwSummaryTotal">0.00</div>
    <div class="hw-summary__stats" id="hwSummaryStats">0 orbs · 0 respins used</div>
    <div class="hw-summary__cta">TAP TO COLLECT</div>
  </div>
</div>`;
}

export function emitHoldAndWinRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* holdAndWin: disabled */`;
  const orbTableJSON = cfg.orbTable
    ? JSON.stringify(cfg.orbTable)
    : JSON.stringify([
        { label: '1x',  weight: 26,  tier: null,    valueX:   1 },
        { label: '2x',  weight: 22,  tier: null,    valueX:   2 },
        { label: '3x',  weight: 16,  tier: null,    valueX:   3 },
        { label: '5x',  weight: 12,  tier: null,    valueX:   5 },
        { label: '8x',  weight:  9,  tier: null,    valueX:   8 },
        { label: '12x', weight:  6,  tier: null,    valueX:  12 },
        { label: '15x', weight:  4,  tier: null,    valueX:  15 },
        { label: '25x', weight:  2,  tier: null,    valueX:  25 },
        { label: 'MINI',  weight: 1.6, tier: 'MINI',  valueX:  12 },
        { label: 'MINOR', weight: 0.9, tier: 'MINOR', valueX:  25 },
        { label: 'MAJOR', weight: 0.4, tier: 'MAJOR', valueX:  50 },
        { label: 'GRAND', weight: 0.1, tier: 'GRAND', valueX: 150 },
      ]);
  return `/* ─── hold & win runtime (Zeus' Storm pattern) ────────────────── */
const HW_TRIGGER_COUNT  = ${cfg.triggerCount};
const HW_BONUS_SYMBOL   = ${JSON.stringify(cfg.bonusSymbolId)};
const HW_RESPINS_AWARD  = ${cfg.respinsAwarded};
const HW_RESET_ON_NEW   = ${cfg.resetOnNewBonus ? 'true' : 'false'};
const HW_JACKPOT_LABELS = ${JSON.stringify(cfg.jackpotLabels)};
const HW_FULL_GRID_X    = ${cfg.fullGridBonusX};
const HW_SHOW_INTRO     = ${cfg.showIntro ? 'true' : 'false'};
const HW_SHOW_SUMMARY   = ${cfg.showSummary ? 'true' : 'false'};

/* Grid dims — GDD-driven, never read from window globals. */
const HW_REELS          = ${cfg.reels};
const HW_ROWS           = ${cfg.rows};

/* Hoisted timings (ms) — surface for GDD override; no inline magic. */
const HW_T_INTRO_AUTO_MS     = ${cfg.timings.introAutoMs};
const HW_T_SUMMARY_AUTO_MS   = ${cfg.timings.summaryAutoMs};
const HW_T_END_FULLGRID_MS   = ${cfg.timings.endFullGridMs};
const HW_T_END_NORMAL_MS     = ${cfg.timings.endNormalMs};
const HW_T_FORCE_FALLBACK_MS = ${cfg.timings.forceFallbackMs};
const HW_T_JACKPOT_DELAY_MS  = ${cfg.timings.jackpotDelayMs};
const HW_T_JACKPOT_SHORT_MS  = ${cfg.timings.jackpotShortMs};
const HW_T_JACKPOT_GRAND_MS  = ${cfg.timings.jackpotGrandMs};
const HW_T_FULLGRID_MS       = ${cfg.timings.fullGridMs};
const HW_T_BONUS_CELEBRATE_MS = ${cfg.timings.bonusCelebrateMs};
const HW_FORCE_SEED_DEFAULT  = Math.max(3, Math.ceil(HW_TRIGGER_COUNT / 2));

/* Orb value table (weighted) — Zeus' Storm distribution, GDD-overridable. */
const HW_ORB_TABLE = ${orbTableJSON};

/* Deterministic RNG hook — routes through host-injected rng() so QA can
 * pin a seed and PAR validation can replay distributions. Math.random
 * remains a last-resort fallback only. */
function _hwRng() {
  try {
    if (typeof window !== 'undefined' && typeof window.rng === 'function') return window.rng();
  } catch (_) {}
  return Math.random();
}

/* Phase machine — INACTIVE → INTRO → RUNNING → SUMMARY. */
const HW_STATE = {
  phase: 'INACTIVE',
  active: false,            /* legacy back-compat — true iff phase !== INACTIVE */
  /* W48 bugfix v4 — set true between hwMaybeEnter() / hwForceSeed()
   * detection and _hwBeginRound() / _hwForceSeedMount(). Prevents a
   * second postSpin from re-entering through either path while the
   * bonus celebration is still playing. */
  entering: false,
  respinsLeft: 0,
  respinsUsed: 0,
  totalWinX: 0,             /* accumulated × bet */
  fullGrid: false,
  /* 'r,c' → { label, tier, valueX } */
  lockedCells: new Map(),
  jackpotsHit: [],          /* array of tier strings, may include duplicates */
  observer: null,
  applying: false,          /* MutationObserver re-entrance guard */
  triggerOrbCount: 0,
};

function _hwBet() {
  try {
    if (typeof window !== 'undefined' && typeof window.currentBet === 'function') return Number(window.currentBet()) || 1;
    if (typeof BET === 'number') return BET;
  } catch (_) {}
  return 1;
}
function _hwFmt(x) {
  try { return (Number(x) || 0).toFixed(2); } catch (_) { return String(x); }
}

function _hwHudShow(show) {
  const hud = document.getElementById('hwHud');
  if (hud) hud.dataset.show = show ? 'true' : 'false';
}
function _hwHudUpdate(opts) {
  const o = opts || {};
  const r = document.getElementById('hwRespins');
  const l = document.getElementById('hwLocked');
  const t = document.getElementById('hwTotal');
  const rBox = document.getElementById('hwRespinsBox');
  const lBox = document.getElementById('hwLockedBox');
  const tBox = document.getElementById('hwTotalBox');
  if (r) r.textContent = String(HW_STATE.respinsLeft);
  if (l) l.textContent = String(HW_STATE.lockedCells.size);
  if (t) t.textContent = _hwFmt(HW_STATE.totalWinX);
  if (rBox) {
    rBox.classList.remove('tension', 'final');
    if (HW_STATE.respinsLeft === 1) rBox.classList.add('final');
    else if (HW_STATE.respinsLeft === 2) rBox.classList.add('tension');
  }
  /* Tick pulse on the box that changed this update — caller flags it. */
  function _pulse(box) {
    if (!box) return;
    box.classList.remove('tick');
    void box.offsetHeight; /* force restart of animation */
    box.classList.add('tick');
    setTimeout(function () { try { box.classList.remove('tick'); } catch (_) {} }, 320);
  }
  if (o.pulseRespins) _pulse(rBox);
  if (o.pulseLocked)  _pulse(lBox);
  if (o.pulseTotal)   _pulse(tBox);
}

function _hwRollOrb() {
  var total = 0;
  for (var i = 0; i < HW_ORB_TABLE.length; i++) total += HW_ORB_TABLE[i].weight;
  var roll = _hwRng() * total;
  for (var j = 0; j < HW_ORB_TABLE.length; j++) {
    roll -= HW_ORB_TABLE[j].weight;
    if (roll <= 0) {
      var e = HW_ORB_TABLE[j];
      return { label: e.label, tier: e.tier, valueX: e.valueX };
    }
  }
  return { label: '1x', tier: null, valueX: 1 };
}

function _hwApplyOrbToCell(cell, orb) {
  HW_STATE.applying = true;
  try {
    cell.classList.add('is-locked-bonus');
    cell.dataset.lockedSymbol = HW_BONUS_SYMBOL;
    cell.dataset.orbValue = orb.label;
    if (orb.tier) cell.dataset.orbTier = orb.tier; else delete cell.dataset.orbTier;
    cell.textContent = HW_BONUS_SYMBOL;
    cell.classList.add('hw-just-landed');
    setTimeout(function () { try { cell.classList.remove('hw-just-landed'); } catch (_) {} }, 540);
  } finally {
    Promise.resolve().then(function () { HW_STATE.applying = false; });
  }
}

function _hwSpawnDelta(cell, valueX) {
  if (!cell || valueX <= 0) return;
  try {
    var rect = cell.getBoundingClientRect();
    var el = document.createElement('div');
    el.className = 'hw-delta';
    el.textContent = '+' + (Math.round(valueX * 100) / 100) + 'x';
    el.style.left = (rect.left + rect.width / 2) + 'px';
    el.style.top  = (rect.top  + rect.height / 2) + 'px';
    document.body.appendChild(el);
    setTimeout(function () { try { el.remove(); } catch (_) {} }, 1100);
  } catch (_) {}
}

function _hwSpawnFly(cell, valueX) {
  if (!cell) return;
  try {
    var totalEl = document.getElementById('hwTotal');
    if (!totalEl) return;
    var c = cell.getBoundingClientRect();
    var t = totalEl.getBoundingClientRect();
    var fly = document.createElement('div');
    fly.className = 'hw-fly';
    fly.textContent = '+' + valueX + 'x';
    fly.style.left = (c.left + c.width / 2 - 16) + 'px';
    fly.style.top  = (c.top  + c.height / 2 - 10) + 'px';
    fly.style.transition = 'transform 620ms cubic-bezier(.4,.0,.4,1), opacity 620ms ease-out';
    document.body.appendChild(fly);
    requestAnimationFrame(function () {
      var dx = (t.left + t.width / 2) - (c.left + c.width / 2);
      var dy = (t.top  + t.height / 2) - (c.top  + c.height / 2);
      fly.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(.55)';
      fly.style.opacity = '0';
    });
    setTimeout(function () { try { fly.remove(); } catch (_) {} }, 700);
  } catch (_) {}
}

function _hwShowJackpot(tier, valueX) {
  var ov = document.getElementById('hwJackpot');
  if (!ov) return;
  var lab = document.getElementById('hwJackpotLabel');
  var val = document.getElementById('hwJackpotValue');
  ov.dataset.tier = tier;
  if (lab) lab.textContent = tier;
  if (val) val.textContent = '+' + valueX + '×';
  ov.dataset.show = 'true';
  setTimeout(function () { ov.dataset.show = 'false'; }, tier === 'GRAND' ? HW_T_JACKPOT_GRAND_MS : HW_T_JACKPOT_SHORT_MS);
}

function _hwShowFullGrid() {
  var ov = document.getElementById('hwFullgrid');
  if (!ov) return;
  ov.dataset.show = 'true';
  setTimeout(function () { ov.dataset.show = 'false'; }, HW_T_FULLGRID_MS);
}

function _hwShowIntro(orbCount) {
  if (!HW_SHOW_INTRO) return Promise.resolve();
  var ov = document.getElementById('hwIntro');
  if (!ov) return Promise.resolve();
  var num = document.getElementById('hwIntroOrbCount');
  if (num) num.textContent = orbCount + ' ORB' + (orbCount === 1 ? '' : 'S');
  ov.dataset.show = 'true';
  return new Promise(function (resolve) {
    function dismiss() {
      try { ov.removeEventListener('click', dismiss); } catch (_) {}
      try { document.removeEventListener('keydown', onKey); } catch (_) {}
      ov.dataset.show = 'false';
      resolve();
    }
    function onKey(e) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') dismiss(); }
    /* Auto-dismiss if user does nothing — keeps QA walker and autoplay
     * rolling without lingering on the placard. Player can also click
     * anywhere or press Enter/Space to skip early. */
    var autoTimer = setTimeout(dismiss, HW_T_INTRO_AUTO_MS);
    ov.addEventListener('click', function () { clearTimeout(autoTimer); dismiss(); });
    document.addEventListener('keydown', onKey, { once: false });
    /* HookBus skip — autoplay / force-skip / FS-trigger upstream can
     * dismiss the placard so the player isn't blocked. */
    try {
      if (typeof HookBus !== 'undefined') {
        var onSkip = function () { clearTimeout(autoTimer); dismiss(); HookBus.off('onSkipRequested', onSkip); };
        HookBus.on('onSkipRequested', onSkip);
      }
    } catch (_) {}
  });
}

function _hwShowSummary(stats) {
  if (!HW_SHOW_SUMMARY) return Promise.resolve();
  var ov = document.getElementById('hwSummary');
  if (!ov) return Promise.resolve();
  var totalEl = document.getElementById('hwSummaryTotal');
  var statsEl = document.getElementById('hwSummaryStats');
  if (totalEl) totalEl.textContent = _hwFmt(stats.totalWinX) + 'x';
  if (statsEl) {
    var s = stats.orbsCollected + ' orb' + (stats.orbsCollected === 1 ? '' : 's') +
            ' · ' + stats.respinsUsed + ' respin' + (stats.respinsUsed === 1 ? '' : 's') + ' used';
    if (stats.jackpotsHit > 0) s += ' · ' + stats.jackpotsHit + ' jackpot' + (stats.jackpotsHit === 1 ? '' : 's');
    if (stats.fullGrid) s += ' · FULL GRID!';
    statsEl.textContent = s;
  }
  ov.dataset.show = 'true';
  return new Promise(function (resolve) {
    function dismiss() {
      try { ov.removeEventListener('click', dismiss); } catch (_) {}
      try { document.removeEventListener('keydown', onKey); } catch (_) {}
      ov.dataset.show = 'false';
      resolve();
    }
    function onKey(e) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') dismiss(); }
    var autoTimer = setTimeout(dismiss, HW_T_SUMMARY_AUTO_MS);
    ov.addEventListener('click', function () { clearTimeout(autoTimer); dismiss(); });
    document.addEventListener('keydown', onKey, { once: false });
    try {
      if (typeof HookBus !== 'undefined') {
        var onSkip = function () { clearTimeout(autoTimer); dismiss(); HookBus.off('onSkipRequested', onSkip); };
        HookBus.on('onSkipRequested', onSkip);
      }
    } catch (_) {}
  });
}

function hwCountBonusOnGrid() {
  const host = document.getElementById('gridHost');
  if (!host) return 0;
  let n = 0;
  host.querySelectorAll('.cell').forEach(c => {
    if ((c.textContent || '').trim() === HW_BONUS_SYMBOL) n++;
  });
  return n;
}

function hwHarvestBonus(opts) {
  /* Lock every BONUS cell on the grid, generating an orb value for each
   * NEW lock. Returns count of newly-locked cells.
   * opts.celebrate=true → run pop + delta + fly + jackpot celebration.
   *
   * W48 bugfix v5 (Boki 2026-06-16): added opts.mapOnly. When true,
   * positions + orb values are recorded into HW_STATE.lockedCells BUT
   * the DOM is NOT mutated — bonus cells stay rendered as the raw
   * symbol glyph that LANDED in the trigger spin. Used by _hwBeginRound
   * so the intro placard appears OVER the original grid; only after the
   * player dismisses the placard do we apply the orb chips (with the
   * pop-in animation). This preserves Boki's rule: "tu gde se pao
   * hold and win simbol, na toj celiji mora i da ostane kada se udje
   * u hold and win — ne sme da se menja pozicija bilo kog simbola". */
  const o = opts || {};
  const host = document.getElementById('gridHost');
  if (!host) return 0;
  let added = 0;
  host.querySelectorAll('.cell').forEach((cell, idx) => {
    const txt = (cell.textContent || '').trim();
    const alreadyLocked = cell.classList.contains('is-locked-bonus');
    if (txt !== HW_BONUS_SYMBOL && !alreadyLocked) return;
    const r = Math.floor(idx / HW_REELS);
    const c = idx % HW_REELS;
    const key = r + ',' + c;
    if (!HW_STATE.lockedCells.has(key)) {
      const orb = _hwRollOrb();
      HW_STATE.lockedCells.set(key, orb);
      if (!o.mapOnly) {
        _hwApplyOrbToCell(cell, orb);
        HW_STATE.totalWinX += orb.valueX;
        if (orb.tier) HW_STATE.jackpotsHit.push(orb.tier);
        if (o.celebrate !== false) {
          _hwSpawnDelta(cell, orb.valueX);
          _hwSpawnFly(cell, orb.valueX);
          if (orb.tier) {
            setTimeout(function () { _hwShowJackpot(orb.tier, orb.valueX); }, HW_T_JACKPOT_DELAY_MS);
          }
        }
      } else {
        /* Still accumulate the prize ledger so the intro placard
         * "N ORBS COLLECTED" line reflects the real trigger count. */
        HW_STATE.totalWinX += orb.valueX;
        if (orb.tier) HW_STATE.jackpotsHit.push(orb.tier);
      }
      added++;
    } else if (!o.mapOnly) {
      /* Re-apply idempotently — keep existing orb data. */
      const orb = HW_STATE.lockedCells.get(key);
      _hwApplyOrbToCell(cell, orb);
      cell.classList.remove('hw-just-landed');
    }
  });
  if (added > 0 && !o.mapOnly) _hwHudUpdate({ pulseLocked: true, pulseTotal: true });
  return added;
}

function hwApplyLocks() {
  const host = document.getElementById('gridHost');
  if (!host) return;
  const cells = host.querySelectorAll('.cell');
  HW_STATE.lockedCells.forEach((orb, key) => {
    const [r, c] = key.split(',').map(n => parseInt(n, 10));
    const idx = r * HW_REELS + c;
    const cell = cells[idx];
    if (!cell) return;
    _hwApplyOrbToCell(cell, orb);
    cell.classList.remove('hw-just-landed');
  });
}

function _hwInstallObserver() {
  if (HW_STATE.observer) return;
  if (typeof MutationObserver !== 'function') return;
  const host = document.getElementById('gridHost');
  if (!host) return;
  HW_STATE.observer = new MutationObserver(function (mutations) {
    if (!HW_STATE.active) return;
    if (HW_STATE.applying) return;
    let needsHeal = false;
    const allCells = host.querySelectorAll('.cell');
    for (let i = 0; i < mutations.length; i++) {
      const m = mutations[i];
      const target = m.target;
      if (!(target && target.nodeType === 1)) continue;
      const cell = target.classList && target.classList.contains('cell')
        ? target
        : (target.closest ? target.closest('.cell') : null);
      if (!cell) continue;
      const idx = Array.prototype.indexOf.call(allCells, cell);
      if (idx < 0) continue;
      const key = Math.floor(idx / HW_REELS) + ',' + (idx % HW_REELS);
      if (HW_STATE.lockedCells.has(key)) {
        const txt = (cell.textContent || '').trim();
        const hasClass = cell.classList.contains('is-locked-bonus');
        const hasData = !!cell.dataset.orbValue;
        if (txt !== HW_BONUS_SYMBOL || !hasClass || !hasData) needsHeal = true;
      }
    }
    if (needsHeal) hwApplyLocks();
  });
  HW_STATE.observer.observe(host, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['class'],
  });
}
function _hwTeardownObserver() {
  if (HW_STATE.observer) {
    try { HW_STATE.observer.disconnect(); } catch (_) {}
    HW_STATE.observer = null;
  }
}

function _hwEnterPhase(p) {
  HW_STATE.phase = p;
  HW_STATE.active = p !== 'INACTIVE';
  if (typeof HookBus !== 'undefined') {
    try { HookBus.emit('onHoldAndWinPhase', { phase: p }); } catch (_) {}
  }
}

async function _hwBeginRound() {
  /* W48 bugfix v5 — Boki rule: "tu gde se pao hold and win simbol, na
   * toj celiji mora i da ostane kada se udje u hold and win. ne sme da
   * se menja pozicija bilo kog simbola".
   *
   * Two-phase mount:
   *   PHASE 1 (before intro placard): mapOnly harvest — discover the
   *     (r,c) positions of the bonus pile and roll the orb values into
   *     HW_STATE.lockedCells, but leave the grid DOM untouched. The
   *     player sees the ORIGINAL trigger spin behind the intro placard,
   *     with the bonus glyphs still rendered as themselves.
   *
   *   PHASE 2 (after intro dismissed): apply orb chips to the same
   *     positions with the pop-in animation so the orbs feel earned at
   *     the moment of reveal.
   *
   * Non-bonus cells are never touched in either phase — their symbols
   * stay verbatim from the trigger spin and across every respin (the
   * respin engine writes only NON-locked cells, gated by the same
   * .is-locked-bonus selector). */
  _hwEnterPhase('INTRO');
  HW_STATE.respinsLeft = HW_RESPINS_AWARD;
  HW_STATE.respinsUsed = 0;
  HW_STATE.totalWinX = 0;
  HW_STATE.fullGrid = false;
  HW_STATE.lockedCells.clear();
  HW_STATE.jackpotsHit = [];

  /* PHASE 1 — discover only; do NOT mutate DOM. */
  hwHarvestBonus({ mapOnly: true });
  HW_STATE.triggerOrbCount = HW_STATE.lockedCells.size;
  _hwInstallObserver();

  await _hwShowIntro(HW_STATE.triggerOrbCount);
  _hwEnterPhase('RUNNING');
  _hwHudShow(true);
  _hwHudUpdate();

  /* PHASE 2 — apply orb chips NOW. Each cell gets pop-in + delta + fly. */
  const introHost = document.getElementById('gridHost');
  if (introHost) {
    const introCells = introHost.querySelectorAll('.cell');
    HW_STATE.lockedCells.forEach(function (orb, key) {
      const parts = key.split(',');
      const r = parseInt(parts[0], 10);
      const c = parseInt(parts[1], 10);
      const idx = r * HW_REELS + c;
      const cell = introCells[idx];
      if (!cell) return;
      _hwApplyOrbToCell(cell, orb);
      _hwSpawnDelta(cell, orb.valueX);
      _hwSpawnFly(cell, orb.valueX);
    });
  }
}

/* W48 bugfix v3 — bonus-symbol celebration before H&W intro.
 *
 * Mirrors the scatter-celebration cadence used in the FS trigger flow:
 * find every cell currently carrying the bonus glyph (B by default),
 * tag the gridHost + each cell with the celebration classes, await the
 * configured window, then strip the classes. The promise resolves so
 * the caller (postSpin listener) can sequentially mount the INTRO. */
var _HW_BONUS_CELEBRATE_TOKEN = 0;

function playHwBonusCelebration() {
  return new Promise(function (resolve) {
    var host = document.getElementById('gridHost');
    if (!host) { resolve(); return; }
    var cells = host.querySelectorAll('.cell');
    var hits = [];
    for (var i = 0; i < cells.length; i++) {
      var txt = (cells[i].textContent || '').trim();
      if (txt === HW_BONUS_SYMBOL) hits.push(cells[i]);
    }
    if (hits.length === 0) { resolve(); return; }
    var myToken = ++_HW_BONUS_CELEBRATE_TOKEN;
    host.classList.add('is-hnw-bonus-celebrating');
    for (var j = 0; j < hits.length; j++) hits[j].classList.add('cell--hnw-bonus-celebrate');
    setTimeout(function () {
      if (myToken !== _HW_BONUS_CELEBRATE_TOKEN) return;
      host.classList.remove('is-hnw-bonus-celebrating');
      for (var k = 0; k < hits.length; k++) hits[k].classList.remove('cell--hnw-bonus-celebrate');
      resolve();
    }, HW_T_BONUS_CELEBRATE_MS);
  });
}

function hwMaybeEnter() {
  if (HW_STATE.active) return false;
  /* W48 bugfix v4 — guard against double-entry while celebration is in
   * flight. The celebration is async (1500ms+); a second postSpin event
   * (e.g. UFP fallback timer firing in parallel) could fire hwForceSeed
   * in the middle and mount the intro before celebration completes,
   * making the player see the placard with no preceding pulse. */
  if (HW_STATE.entering) return false;
  if (hwCountBonusOnGrid() >= HW_TRIGGER_COUNT) {
    /* W48 bugfix v3 — celebrate the bonus pile FIRST, then mount intro.
     * Boki rule (2026-06-16): "mora prvo da se zavrsi spin, da se prikaze
     * animacija dobitka pa tek onda da se udje u hold and win". The
     * bonus-cell pulse is the "animacija dobitka" for this trigger type. */
    HW_STATE.entering = true;
    playHwBonusCelebration().then(function () {
      HW_STATE.entering = false;
      _hwBeginRound();
    });
    return true;
  }
  return false;
}

function hwForceSeed(orbCount) {
  if (HW_STATE.active) return false;
  if (HW_STATE.entering) return false;
  const host = document.getElementById('gridHost');
  if (!host) return false;
  const allCells = Array.from(host.querySelectorAll('.cell'));
  if (allCells.length === 0) return false;
  const N = Math.max(1, Math.min(orbCount || HW_FORCE_SEED_DEFAULT, allCells.length));
  const picked = new Set();
  while (picked.size < N) picked.add(Math.floor(_hwRng() * allCells.length));

  /* W48 bugfix v4 — Boki rule: "mora prvo da se zavrsi spin, da se prikaze
   * animacija dobitka pa tek onda da se udje u hold and win". The forced
   * path used to mount the placard instantly. We now stamp the picked
   * cells with the bonus glyph and play the same celebration the natural
   * path uses BEFORE entering INTRO. */
  HW_STATE.entering = true;
  picked.forEach(function (idx) {
    const cell = allCells[idx];
    if (cell && !cell.classList.contains('is-locked-bonus')) {
      cell.textContent = HW_BONUS_SYMBOL;
    }
  });
  playHwBonusCelebration().then(function () {
    HW_STATE.entering = false;
    _hwForceSeedMount(picked, allCells);
  });
  return true;
}

function _hwForceSeedMount(picked, allCells) {
  /* W48 bugfix v5 — same two-phase mount as the natural _hwBeginRound:
   *   PHASE 1 (before intro): roll the orb ladger into HW_STATE.lockedCells
   *     BUT do NOT mutate the DOM. The bonus glyph that was stamped by
   *     hwForceSeed during the celebration stays visible behind the intro.
   *   PHASE 2 (after intro dismissed): apply orb chips with pop-in. */
  _hwEnterPhase('INTRO');
  HW_STATE.respinsLeft = HW_RESPINS_AWARD;
  HW_STATE.respinsUsed = 0;
  HW_STATE.totalWinX = 0;
  HW_STATE.fullGrid = false;
  HW_STATE.lockedCells.clear();
  HW_STATE.jackpotsHit = [];

  /* PHASE 1 — roll orb values, record positions, DO NOT mutate DOM. */
  picked.forEach(function (idx) {
    const r = Math.floor(idx / HW_REELS);
    const c = idx % HW_REELS;
    const key = r + ',' + c;
    const orb = _hwRollOrb();
    HW_STATE.lockedCells.set(key, orb);
    HW_STATE.totalWinX += orb.valueX;
    if (orb.tier) HW_STATE.jackpotsHit.push(orb.tier);
  });
  HW_STATE.triggerOrbCount = HW_STATE.lockedCells.size;

  _hwInstallObserver();
  _hwShowIntro(HW_STATE.triggerOrbCount).then(function () {
    _hwEnterPhase('RUNNING');
    _hwHudShow(true);
    _hwHudUpdate();
    /* PHASE 2 — apply orb chips NOW with pop-in animation. */
    picked.forEach(function (idx) {
      const cell = allCells[idx];
      if (!cell) return;
      const r = Math.floor(idx / HW_REELS);
      const c = idx % HW_REELS;
      const key = r + ',' + c;
      const orb = HW_STATE.lockedCells.get(key);
      if (!orb) return;
      _hwApplyOrbToCell(cell, orb);
      _hwSpawnDelta(cell, orb.valueX);
      _hwSpawnFly(cell, orb.valueX);
    });
  });
  return true;
}

function hwAfterRespin() {
  if (!HW_STATE.active || HW_STATE.phase !== 'RUNNING') return { ended: false, allLocked: false };
  const added = hwHarvestBonus({ celebrate: true });
  /* Re-entrance gate: a stray postSpin after the end-timer is scheduled
   * but before SUMMARY transitions in would otherwise schedule a second
   * hwEnd. If we have no respins left AND no new orb landed, this is
   * that stray re-entry — no-op. */
  if (HW_STATE.respinsLeft <= 0 && added === 0) return { ended: false, allLocked: false };
  /* respinsUsed was incremented only on the else-branch, but a respin
   * where HW_RESET_ON_NEW fires (orb landed, counter resets) was ALSO
   * consumed by the engine. Summary placard was under-reporting
   * ("0 respins used" on 10-spin rounds). Always increment, then
   * conditionally refill or decrement remaining. */
  HW_STATE.respinsUsed++;
  if (added > 0 && HW_RESET_ON_NEW) {
    HW_STATE.respinsLeft = HW_RESPINS_AWARD;
  } else {
    HW_STATE.respinsLeft = Math.max(0, HW_STATE.respinsLeft - 1);
  }
  _hwHudUpdate({ pulseRespins: true });
  const allLocked = HW_STATE.lockedCells.size >= HW_REELS * HW_ROWS;
  if (allLocked) {
    HW_STATE.fullGrid = true;
    HW_STATE.totalWinX += HW_FULL_GRID_X;
    _hwShowFullGrid();
    _hwHudUpdate({ pulseTotal: true });
    setTimeout(hwEnd, HW_T_END_FULLGRID_MS);
    return { ended: true, allLocked: true };
  }
  if (HW_STATE.respinsLeft <= 0) {
    setTimeout(hwEnd, HW_T_END_NORMAL_MS);
    return { ended: true, allLocked: false };
  }
  return { ended: false, allLocked: false };
}

function hwEnd() {
  if (HW_STATE.phase === 'INACTIVE' || HW_STATE.phase === 'SUMMARY') return;
  _hwEnterPhase('SUMMARY');
  _hwTeardownObserver();
  const stats = {
    totalWinX: HW_STATE.totalWinX,
    orbsCollected: HW_STATE.lockedCells.size,
    respinsUsed: HW_STATE.respinsUsed,
    jackpotsHit: HW_STATE.jackpotsHit.length,
    fullGrid: HW_STATE.fullGrid,
  };
  _hwShowSummary(stats).then(function () {
    _hwHudShow(false);
    const host = document.getElementById('gridHost');
    if (host) {
      HW_STATE.applying = true;
      try {
        host.querySelectorAll('.cell.is-locked-bonus').forEach(function (c) {
          c.classList.remove('is-locked-bonus', 'hw-just-landed');
          delete c.dataset.lockedSymbol;
          delete c.dataset.orbValue;
          delete c.dataset.orbTier;
        });
      } finally {
        Promise.resolve().then(function () { HW_STATE.applying = false; });
      }
    }
    /* Credit total via canonical HookBus signal — payments block owns
     * the balance grammar. Removes the window-global coupling that
     * silently dropped the total in alt hosts / test harnesses. */
    try {
      if (HW_STATE.totalWinX > 0 && typeof HookBus !== 'undefined') {
        HookBus.emit('onHoldAndWinPayout', { winX: HW_STATE.totalWinX, bet: _hwBet() });
      }
    } catch (_) {}
    HW_STATE.lockedCells.clear();
    HW_STATE.totalWinX = 0;
    HW_STATE.respinsLeft = 0;
    HW_STATE.respinsUsed = 0;
    HW_STATE.fullGrid = false;
    HW_STATE.jackpotsHit = [];
    _hwEnterPhase('INACTIVE');
    if (typeof HookBus !== 'undefined') {
      try { HookBus.emit('onHoldAndWinEnd', stats); } catch (_) {}
    }
  });
}

if (typeof window !== 'undefined') {
  window.hwMaybeEnter           = hwMaybeEnter;
  window.hwAfterRespin          = hwAfterRespin;
  window.hwApplyLocks           = hwApplyLocks;
  window.hwHarvestBonus         = hwHarvestBonus;
  window.hwForceSeed            = hwForceSeed;
  window.hwEnd                  = hwEnd;
  window.playHwBonusCelebration = playHwBonusCelebration;
  window.HW_STATE               = HW_STATE;
}

if (typeof HookBus !== 'undefined' && !(typeof window !== 'undefined' && window.__hwInstalled)) {
  if (typeof window !== 'undefined') window.__hwInstalled = true;
  HookBus.on('postSpin', () => {
    if (!HW_STATE.active) {
      hwMaybeEnter();
    } else if (HW_STATE.phase === 'RUNNING') {
      hwAfterRespin();
    }
  });
  HookBus.on('onSpinResult', () => {
    if (HW_STATE.active) hwApplyLocks();
  });
  HookBus.on('onFsTrigger', () => { hwEnd(); });
  HookBus.on('onFsEnd',     () => { hwEnd(); });

  /* 2026-06-11 (Boki rule "pritisnes force dugme odradi se spin i onda
   * se dobije ishod forsa") — chip click no longer seeds orbs in-place.
   * UFP plants FORCE_TRIGGER with bonusCount + bonusSymbol, the base
   * spin lands the bonus pile, and the regular postSpin → hwMaybeEnter
   * path enters INTRO → RUNNING. Player sees: chip → reels spin → orbs
   * lock + INTRO placard. If the spin somehow fails to plant (e.g. the
   * reel pool refuses to accept the symbol on a heavily-stacked grid),
   * fall back to hwForceSeed on a slight delay so the chip is never
   * silent. */
  HookBus.on('onForceFeatureRequested', (payload) => {
    if (!payload || payload.kind !== 'hold_and_win') return;
    /* Fallback timer — wait long enough that the just-fired base spin
     * has a chance to land its bonus pile through FORCE_TRIGGER. If the
     * pile lands, hwMaybeEnter() activated the round in postSpin and
     * HW_STATE.active is already true. If the pool refused the bonus
     * symbol (no B in the natural strip) OR if FS interrupted, we no-op:
     * forcing both orbs AND FS into the same round corrupts both
     * lifecycles. */
    setTimeout(function () {
      try {
        if (HW_STATE.active) return;
        var fsActive = (typeof FSM !== 'undefined' && FSM && FSM.phase && FSM.phase !== 'BASE');
        if (fsActive) return;
        hwForceSeed(HW_FORCE_SEED_DEFAULT);
      } catch (_) {}
    }, HW_T_FORCE_FALLBACK_MS);
  });
}
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
