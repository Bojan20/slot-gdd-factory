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
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitHoldAndWinCSS(cfg), emitHoldAndWinMarkup(cfg),
 *   emitHoldAndWinRuntime(cfg)
 *
 * Lifecycle (HookBus):
 *   subscribes: postSpin (detect trigger / respin tick),
 *               preSpin (clear stale .is-locked-bonus on round end),
 *               onFsEnd (force-end if still running)
 *   emits (owned): onHoldAndWinIntro, onHoldAndWinStart, onHoldAndWinOrb,
 *                  onHoldAndWinJackpot, onHoldAndWinFullGrid,
 *                  onHoldAndWinEnd
 *
 * Performance budget:
 *   1 phase machine; MutationObserver with re-entrance flag for orb
 *   protection; ≤ 1 listener per event (wired-once); 1 rAF per
 *   intro/summary placard transition.
 *
 * a11y:
 *   intro/summary placards role="dialog" + aria-modal + aria-labelledby;
 *   HUD counters aria-live="polite" + aria-atomic; jackpot tiers
 *   announce via aria-live="assertive" (climax interrupt is the
 *   headline of the round); prefers-reduced-motion collapses pulse +
 *   shake + fly animations.
 *
 * Wave Legacy · industry baseline (vendor-neutral). Original block predates the
 * formal Wave Hxx naming + JSDoc kontrakt header pattern (auto-tagged by
 * tools/cortex-block-mega-fix.mjs).
 */

export function defaultConfig() {
  return Object.freeze({
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
      /* 2026-06-18 (Boki: "tek onda da se udje u h&w") — explicit pause
       * between celebration end and intro placard fade-in so the player
       * gets a clear visual cut. Bumped 240 → 600ms after Boki reported
       * the previous gap still read as instant transition. The player
       * needs ~half a second between visual phases to register them as
       * separate beats. */
      celebrateTailMs: 600,
    },
    /* Orb distribution — null = built-in Zeus' Storm table. GDD may
     * override with array of { label, weight, tier, valueX }. */
    orbTable: null,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = model.holdAndWin || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.triggerCount)) cfg.triggerCount = clampInt(m.triggerCount, 3, 30);
  if (typeof m.bonusSymbolId === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(m.bonusSymbolId)) cfg.bonusSymbolId = m.bonusSymbolId.toUpperCase();
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

/* ─── W48 BUGFIX v3 + v7 — bonus symbol celebration on H&W trigger ──────
 * Boki rule (2026-06-16, third pass): "za hold and win, mora prvo da se
 * zavrsi spin, da se prikaze animacija dobitka pa tek onda da se udje u
 * hold and win". Parallel to the FS-trigger flow: scatter celebration
 * plays for ~1500ms BEFORE the FS intro placard.
 *
 * v7 (Boki 2026-06-16, "sjebo si u base game reel spin reel land i mutne
 * su celije"): removed the host-class dim that was painting EVERY cell
 * with brightness 0.55 + saturate 0.7. If the host class lingered (e.g.
 * a token-cancelled celebration), every base-game cell appeared muddy
 * for the rest of the session. Bonus cells now stand out purely via
 * their own bright glow + scale animation — surrounding cells stay
 * untouched. */
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

/* 2026-06-18 — Boki rule "u base game mora da se odradi simbol win
 * animacija da se zna da je hold end win dobijen i kolko je simbola
 * dobijeno". Big centred badge that mounts during the 1500ms bonus
 * celebration window so the player gets an unambiguous "you triggered
 * Hold & Win with N bonus symbols" cue BEFORE the intro placard
 * fades in. Pure CSS — runtime mounts/unmounts the element, this rule
 * paints + animates the visible state. */
.hw-bonus-count-overlay {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.6);
  z-index: 1900;
  padding: clamp(18px, 4vw, 36px) clamp(28px, 6vw, 56px);
  border-radius: 18px;
  background: radial-gradient(circle at center,
    rgba(${cfg.haloColor}, 0.92) 0%,
    rgba(${cfg.haloColor}, 0.78) 45%,
    rgba(40, 18, 0, 0.92) 100%);
  border: 3px solid rgba(255, 255, 255, 0.55);
  box-shadow:
    0 0 0 4px rgba(${cfg.haloColor}, 0.45),
    0 18px 48px rgba(0, 0, 0, 0.65),
    inset 0 4px 12px rgba(255, 255, 255, 0.35),
    inset 0 -6px 16px rgba(0, 0, 0, 0.4);
  color: #ffffff;
  font: 900 clamp(28px, 5.2vw, 60px)/1.05 system-ui, -apple-system,
        "SF Pro Display", "Segoe UI", sans-serif;
  letter-spacing: 0.08em;
  text-align: center;
  text-shadow:
    0 2px 0 rgba(0, 0, 0, 0.65),
    0 4px 14px rgba(0, 0, 0, 0.5);
  pointer-events: none;
  white-space: nowrap;
  animation: hwBonusCountIn 320ms cubic-bezier(.25, 1.45, .55, 1) forwards,
             hwBonusCountPulse 700ms ease-in-out 350ms infinite alternate;
}
@keyframes hwBonusCountIn {
  0%   { transform: translate(-50%, -50%) scale(0.6);  opacity: 0; }
  60%  { transform: translate(-50%, -50%) scale(1.08); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(1);    opacity: 1; }
}
@keyframes hwBonusCountPulse {
  0%   { filter: drop-shadow(0 0 0  rgba(${cfg.haloColor}, 0.7)); }
  100% { filter: drop-shadow(0 0 22px rgba(${cfg.haloColor}, 1)); }
}
@media (prefers-reduced-motion: reduce) {
  .hw-bonus-count-overlay {
    animation: none;
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
  }
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
const HW_T_CELEBRATE_TAIL_MS = ${cfg.timings.celebrateTailMs || 240};
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
  /* 2026-06-18 — surface enabled/triggerCount/bonusSymbolId on the live
   * state object so external consumers (anticipation trigger registry,
   * QA probes, dev tools) can read them without re-import. Mirrors the
   * baked-in module constants below — never mutated at runtime. */
  enabled:        true,
  triggerCount:   HW_TRIGGER_COUNT,
  bonusSymbolId:  HW_BONUS_SYMBOL,
  respinsAwarded: HW_RESPINS_AWARD,
  phase: 'INACTIVE',
  active: false,            /* legacy back-compat — true iff phase !== INACTIVE */
  /* W48 bugfix v4 — set true between hwMaybeEnter() / hwForceSeed()
   * detection and _hwBeginRound() / _hwForceSeedMount(). Prevents a
   * second postSpin from re-entering through either path while the
   * bonus celebration is still playing. */
  entering: false,
  /* 2026-06-18 (industry-reference single-arm-per-spin gate) —
   * armed is the canonical "next postSpin may evaluate H&W trigger"
   * signal. Set to TRUE on every preSpin while phase === INACTIVE,
   * consumed (set FALSE) the moment hwMaybeEnter() OR hwForceSeed()
   * accepts the trigger, and explicitly held FALSE after hwEnd() until
   * the player initiates the next base spin.
   *
   * Without this gate, the postSpin that runs immediately AFTER hwEnd
   * (when the SUMMARY placard auto-dismisses on the same reel snapshot
   * that already accumulated a bonus pile) could re-fire H&W on the
   * same grid → Boki bug "zavrsi se jedan, i odmah drugi pocne".
   *
   * Industry-standard lock-and-respin cabinet sequencers ship exactly
   * this gate: a "trigger latch" cleared at round-end and re-armed
   * only on the next coin-in / spin-button press. */
  armed: true,
  respinsLeft: 0,
  respinsUsed: 0,
  totalWinX: 0,             /* accumulated × bet */
  fullGrid: false,
  /* 'r,c' → { label, tier, valueX } */
  lockedCells: new Map(),
  /* 2026-06-18 — pre-trigger snapshot keyed 'r,c' → sym (filled in
   * _hwBeginRound). reelEngine.runHnwPerCellRespin consumes this to
   * keep non-locked cells anchored to the trigger spin across every
   * respin (Boki rule "simboli ne smeju da menjaju mesta"). */
  preTriggerSyms: new Map(),
  jackpotsHit: [],          /* array of tier strings, may include duplicates */
  observer: null,
  applying: false,          /* MutationObserver re-entrance guard */
  triggerOrbCount: 0,
};
/* Publish on window so anticipation registry + probes can read without
 * re-importing the runtime emit. */
if (typeof window !== 'undefined') window.HW_STATE = HW_STATE;

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
  /* D-3 guard — defensive against stringified/stale cell refs from upstream
     HW state restore + cluster/tumble eval after gravity pass. */
  if (typeof cell.getBoundingClientRect !== 'function') return;
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
  /* D-3 guard — defensive against non-DOM cell refs. */
  if (typeof cell.getBoundingClientRect !== 'function') return;
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

/* W48 bugfix v6 — _hwResolveCell(reel, row) returns the DOM cell at the
 * SEMANTIC (reel, row) coordinate, no matter how the strip has rotated.
 *
 * Industry pattern: the canonical hold-and-spin trigger walks a 2D
 * triggerGrid by reel + row and keys orbs per (reel, row). Our previous
 * flat-DOM-index mapping (idx / HW_REELS, idx % HW_REELS) was wrong:
 * the DOM is column-major + carries top/bottom buffer cells per reel,
 * so the flat idx neither matched the (reel, row) pair nor stayed
 * stable across rotation. This helper goes through RECT_REELS — the
 * engine per-reel array — so visible row N inside reel R is always
 * RECT_REELS[R].cells[N + 1] (the +1 hops the top buffer). Locked
 * cells stay pinned at that array idx per the W48 v1 sticky-pin fix,
 * so the lookup is stable even after dozens of respin rotations. */
function _hwResolveCell(reelIdx, rowIdx) {
  if (typeof window === 'undefined') return null;
  const reels = window.RECT_REELS;
  if (!Array.isArray(reels) || !reels[reelIdx]) return null;
  const reel = reels[reelIdx];
  const vis = reel.visibleRows;
  if (rowIdx < 0 || rowIdx >= vis) return null;
  /* +1: cell array layout is [topBuffer, vis_0, vis_1, ..., vis_N-1,
   * bottomBuffer]. visible row N = strip index N+1. */
  return reel.cells[rowIdx + 1] || null;
}

function hwHarvestBonus(opts) {
  /* Lock every BONUS cell on the grid, generating an orb value for each
   * NEW lock. Returns count of newly-locked cells.
   * opts.celebrate=true → run pop + delta + fly + jackpot celebration.
   *
   * W48 bugfix v5: opts.mapOnly records positions + orbs without
   * mutating the DOM, so the intro placard appears over the original
   * trigger spin (bonus glyphs stay rendered as themselves).
   *
   * W48 bugfix v6 (Boki 2026-06-16): walks RECT_REELS by semantic
   * (reel, row) instead of the flat querySelectorAll order. Old impl
   * (idx → r,c) miscounted positions on any grid with buffer cells
   * (every uniform reel topology since reelEngine default
   * stripBufferCells=2). After this fix, the (reel, row) key written
   * here matches the (reel, row) key read back in PHASE 2 verbatim. */
  const o = opts || {};
  /* RECT_REELS path — semantic (reel, row) walk, no DOM idx math. */
  if (typeof window !== 'undefined' && Array.isArray(window.RECT_REELS) && window.RECT_REELS.length > 0) {
    let added = 0;
    const reels = window.RECT_REELS;
    for (let r = 0; r < reels.length; r++) {
      const reel = reels[r];
      const vis = reel.visibleRows;
      for (let row = 0; row < vis; row++) {
        const cell = reel.cells[row + 1];   // skip top buffer
        if (!cell) continue;
        const txt = (cell.textContent || '').trim();
        const alreadyLocked = cell.classList.contains('is-locked-bonus');
        if (txt !== HW_BONUS_SYMBOL && !alreadyLocked) continue;
        const key = r + ',' + row;
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
          const orb = HW_STATE.lockedCells.get(key);
          _hwApplyOrbToCell(cell, orb);
          cell.classList.remove('hw-just-landed');
        }
      }
    }
    if (added > 0 && !o.mapOnly) _hwHudUpdate({ pulseLocked: true, pulseTotal: true });
    return added;
  }

  /* Fallback path — non-rectangular topology (hex / wheel / crash /
   * slingo / plinko) doesn't populate RECT_REELS. Walk the flat DOM
   * cell list; the key is still 'idx,0' so PHASE 2 retrieval below
   * mirrors the write. Bonus presence on these shapes is rare and
   * cosmetic — H&W is wired to uniform reel grids in shipping GDDs. */
  const host = document.getElementById('gridHost');
  if (!host) return 0;
  let added = 0;
  host.querySelectorAll('.cell').forEach((cell, idx) => {
    const txt = (cell.textContent || '').trim();
    const alreadyLocked = cell.classList.contains('is-locked-bonus');
    if (txt !== HW_BONUS_SYMBOL && !alreadyLocked) return;
    const key = 'flat,' + idx;
    if (!HW_STATE.lockedCells.has(key)) {
      const orb = _hwRollOrb();
      HW_STATE.lockedCells.set(key, orb);
      if (!o.mapOnly) {
        _hwApplyOrbToCell(cell, orb);
        HW_STATE.totalWinX += orb.valueX;
        if (orb.tier) HW_STATE.jackpotsHit.push(orb.tier);
      } else {
        HW_STATE.totalWinX += orb.valueX;
        if (orb.tier) HW_STATE.jackpotsHit.push(orb.tier);
      }
      added++;
    }
  });
  if (added > 0 && !o.mapOnly) _hwHudUpdate({ pulseLocked: true, pulseTotal: true });
  return added;
}

function hwApplyLocks() {
  /* W48 v6 — semantic (reel,row) retrieval via RECT_REELS, mirrors the
   * key shape written by hwHarvestBonus. Flat-fallback keys are still
   * honoured for non-rectangular topologies. */
  const host = document.getElementById('gridHost');
  if (!host) return;
  HW_STATE.lockedCells.forEach((orb, key) => {
    const parts = key.split(',');
    let cell = null;
    if (parts[0] === 'flat') {
      cell = host.querySelectorAll('.cell')[parseInt(parts[1], 10)] || null;
    } else {
      cell = _hwResolveCell(parseInt(parts[0], 10), parseInt(parts[1], 10));
    }
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
    /* W48 v6 — observer doesn't try to recompute the key from the
     * mutated cell (the old flat-idx math was wrong on buffered
     * grids). Simpler: any mutation while H&W is RUNNING triggers
     * a full hwApplyLocks() — idempotent re-paint of every locked
     * cell. The hot path is cheap (≤ 15 locked cells × cell update). */
    let touchesLocked = false;
    for (let i = 0; i < mutations.length; i++) {
      const m = mutations[i];
      const target = m.target;
      if (!(target && target.nodeType === 1)) continue;
      const cell = target.classList && target.classList.contains('cell')
        ? target
        : (target.closest ? target.closest('.cell') : null);
      if (!cell) continue;
      /* Only care if THIS cell is one of our locked ones — i.e. it
       * carries .is-locked-bonus already, or it lost it. */
      if (cell.classList.contains('is-locked-bonus') ||
          (cell.dataset && cell.dataset.orbValue)) {
        const txt = (cell.textContent || '').trim();
        const hasClass = cell.classList.contains('is-locked-bonus');
        const hasData = !!cell.dataset.orbValue;
        if (txt !== HW_BONUS_SYMBOL || !hasClass || !hasData) {
          touchesLocked = true;
          break;
        }
      }
    }
    if (touchesLocked) hwApplyLocks();
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
    /* UQ-MASTERY-2 (2026-06-21) — canonical onHoldAndWinTrigger emit
     * so reserved listeners (simultaneousFsHoldAndWinPriority,
     * perTriggerVolatilitySet, potSymbolFireball) receive the start
     * signal. Fires on the FIRST non-INACTIVE transition (intro start)
     * — downstream blocks gate on payload.phase if they need finer
     * granularity. */
    if (p === 'INTRO' || p === 'START' || p === 'RUNNING') {
      try { HookBus.emit('onHoldAndWinTrigger', { phase: p }); } catch (_) {}
    }
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

  /* 2026-06-18 (part 7) — WoO Hold & Win rule (Boki + WoO GDD §5.4/§6.3):
   * "bonus simboli koji su dobijeni u base game moraju da ostanu na istim
   * mestima i u hold and win". The previous "preTriggerSyms" snapshot
   * (commit 2f53e47) tried to also preserve NON-bonus pre-trigger glyphs
   * but the live probe found it was racing the respin engine and lost
   * bonus positions on WoO (5/8 orbs vanished after first respin).
   *
   * New contract — STRICT bonus-only preservation:
   *   1. lockedCells map (write in PHASE 1) is the SINGLE SOURCE OF TRUTH
   *      for bonus positions. Every position there MUST be locked at the
   *      moment RUNNING phase begins.
   *   2. PHASE 2 walks the map and applies the orb chip to every cell.
   *   3. _hwEnsureAllOrbsLocked() runs as a SANITY pass right after — if
   *      any (r,row) in the map didn't acquire is-locked-bonus class, retry
   *      with a fresh DOM lookup. Defensive against engine ticks racing
   *      the orb-apply.
   *   4. A grid-wide scan catches any cell that STILL shows the bonus
   *      glyph but isn't in the map (force-trigger paths plant >N orbs
   *      via FORCE_TRIGGER; the harvester captured the configured N but
   *      missed the rest). Those get a fresh orb + lock.
   *   5. Non-bonus cells are left as-is — the respin engine paints them
   *      with new symbols (WoO §5.4: "remaining cells are blank").
   *
   * The respin engine's preTriggerSyms consumer path is now opt-in:
   * absence of the map = fall through to the standard randomSym() path.
   * We deliberately do NOT seed it here. */

  /* 2026-06-18 — clear stale force flags so the next base spin after
   * round-end doesn't accidentally re-fire FORCE_TRIGGER and queue
   * another H&W (Boki bug C: "zavrsi se jedan h&W i onda krene
   * slkedeci"). Idempotent — null setters are safe.
   * UQ-DEEP-J fix (2026-06-23): previously this block null-ed
   * __FORCE_FEATURE_PENDING__ unconditionally — that nuked an operator
   * Force Expanding Wild flag set BEFORE the spin even started,
   * because holdAndWin entry-detection runs in the same onSpinResult
   * callback batch and gets there first. Only clear flags that THIS
   * block owns ('hold_and_win'); leave foreign flags untouched. */
  try {
    if (typeof window !== 'undefined') {
      window.FORCE_TRIGGER = null;
      if (window.__FORCE_FEATURE_PENDING__ === 'hold_and_win') {
        window.__FORCE_FEATURE_PENDING__ = null;
      }
    }
  } catch (_) {}

  /* PHASE 1 — discover only; do NOT mutate DOM.
   *
   * 2026-06-18 — if entryCellRefs already populated (natural-entry path
   * stashed them before celebration), use them to seed lockedCells map
   * with the EXACT DOM nodes the player saw at trigger time. The bonus
   * positions become drift-proof: no (r,row) lookup, no engine-tick
   * race between celebrate-end and intro-mount can move them. */
  if (HW_STATE.entryCellRefs && HW_STATE.entryCellRefs.size > 0) {
    HW_STATE.entryCellRefs.forEach(function (orb, cell) {
      /* Synthetic key — anchored to the cell ref via a private WeakMap
       * would be ideal, but lockedCells must round-trip JSON for the
       * summary plaque + jackpot accounting. Use 'ref,N' where N is the
       * insertion index. The DOM ref is kept on HW_STATE.entryCellRefs
       * Map so PHASE 2 below resolves it directly. */
      const key = 'ref,' + HW_STATE.lockedCells.size;
      HW_STATE.lockedCells.set(key, orb);
      HW_STATE.totalWinX += orb.valueX;
      if (orb.tier) HW_STATE.jackpotsHit.push(orb.tier);
    });
  } else {
    hwHarvestBonus({ mapOnly: true });
  }
  HW_STATE.triggerOrbCount = HW_STATE.lockedCells.size;
  _hwInstallObserver();

  await _hwShowIntro(HW_STATE.triggerOrbCount);
  _hwEnterPhase('RUNNING');
  _hwHudShow(true);
  _hwHudUpdate();

  /* PHASE 2 — apply orb chips NOW. Each cell gets pop-in + delta + fly.
   *
   * 2026-06-18 drift-proof path: if entryCellRefs was stashed, walk it
   * directly. Otherwise fall through to the legacy (r,row) lookup. */
  if (HW_STATE.entryCellRefs && HW_STATE.entryCellRefs.size > 0) {
    HW_STATE.entryCellRefs.forEach(function (orb, cell) {
      if (!cell) return;
      _hwApplyOrbToCell(cell, orb);
      _hwSpawnDelta(cell, orb.valueX);
      _hwSpawnFly(cell, orb.valueX);
    });
    /* Sanity sweep + DOM reconcile keep HUD counter correct. */
    _hwEnsureAllOrbsLocked();
    HW_STATE.triggerOrbCount = HW_STATE.lockedCells.size;
    _hwHudUpdate({ pulseLocked: true, pulseTotal: true });
    return;
  }

  HW_STATE.lockedCells.forEach(function (orb, key) {
    const parts = key.split(',');
    let cell = null;
    if (parts[0] === 'flat') {
      const host = document.getElementById('gridHost');
      if (host) cell = host.querySelectorAll('.cell')[parseInt(parts[1], 10)] || null;
    } else {
      const reelIdx = parseInt(parts[0], 10);
      const rowIdx  = parseInt(parts[1], 10);
      cell = _hwResolveCell(reelIdx, rowIdx);
    }
    if (!cell) return;
    _hwApplyOrbToCell(cell, orb);
    _hwSpawnDelta(cell, orb.valueX);
    _hwSpawnFly(cell, orb.valueX);
  });

  /* PHASE 2b — sanity scan. Boki bug (WoO live probe 2026-06-18 part 7):
   * orbs sometimes didn't render is-locked-bonus class for every position
   * in the lockedCells map AND the grid still had unharvested bonus glyphs
   * (force-trigger paths planted N+ orbs but the harvester captured only N
   * before MapOnly mode bailed early). This second pass closes both gaps. */
  _hwEnsureAllOrbsLocked();
}

/* PHASE 2b helper — close the "orb on grid but not locked" gap.
 *
 * Runs TWO sweeps:
 *   (i)  for every key already in lockedCells, re-resolve the DOM cell
 *        and re-apply orb if is-locked-bonus class is missing (defensive
 *        against engine ticks racing PHASE 2 forEach above).
 *   (ii) walk the grid via RECT_REELS; any cell whose textContent is
 *        HW_BONUS_SYMBOL but doesn't carry is-locked-bonus class AND is not
 *        already keyed in lockedCells gets a fresh orb + lock (covers
 *        force-trigger over-plant where N+M orbs land but the harvester
 *        only captured N). */
function _hwEnsureAllOrbsLocked() {
  const TARGET = String(HW_BONUS_SYMBOL || 'B').toUpperCase();
  /* Sweep (i) — re-apply for every existing lockedCells entry. */
  HW_STATE.lockedCells.forEach(function (orb, key) {
    const parts = key.split(',');
    let cell = null;
    if (parts[0] === 'flat') {
      const host = document.getElementById('gridHost');
      if (host) cell = host.querySelectorAll('.cell')[parseInt(parts[1], 10)] || null;
    } else {
      cell = _hwResolveCell(parseInt(parts[0], 10), parseInt(parts[1], 10));
    }
    if (cell && !cell.classList.contains('is-locked-bonus')) {
      _hwApplyOrbToCell(cell, orb);
    }
  });
  /* Sweep (ii) — semantic RECT_REELS scan for unharvested bonus glyphs. */
  if (typeof window !== 'undefined' && Array.isArray(window.RECT_REELS)) {
    const reels = window.RECT_REELS;
    for (let r = 0; r < reels.length; r++) {
      const reel = reels[r];
      const vis = reel.visibleRows;
      for (let row = 0; row < vis; row++) {
        const cell = reel.cells[row + 1];
        if (!cell) continue;
        const txt = (cell.textContent || '').trim().toUpperCase();
        if (txt !== TARGET) continue;
        if (cell.classList.contains('is-locked-bonus')) continue;
        const key = r + ',' + row;
        if (HW_STATE.lockedCells.has(key)) {
          _hwApplyOrbToCell(cell, HW_STATE.lockedCells.get(key));
        } else {
          const orb = _hwRollOrb();
          HW_STATE.lockedCells.set(key, orb);
          _hwApplyOrbToCell(cell, orb);
          HW_STATE.totalWinX += orb.valueX;
          if (orb.tier) HW_STATE.jackpotsHit.push(orb.tier);
        }
      }
    }
  }
  /* Sweep (iii) — direct DOM walk as last-resort safety net. Some force
   * paths plant bonus glyphs on cells whose (reel,row) the RECT_REELS
   * walk above can't reach (e.g. force-trigger over-plant after the
   * harvester captured only N orbs). Walk every .cell node under the
   * grid host, case-insensitive compare, lock any orphan. */
  const host = document.getElementById('gridHost') || document.querySelector('.gridHost');
  if (host) {
    const cells = host.querySelectorAll('.cell');
    for (const cell of cells) {
      const txt = (cell.textContent || '').trim().toUpperCase();
      if (txt !== TARGET) continue;
      if (cell.classList.contains('is-locked-bonus')) continue;
      const orb = _hwRollOrb();
      _hwApplyOrbToCell(cell, orb);
      HW_STATE.totalWinX += orb.valueX;
      if (orb.tier) HW_STATE.jackpotsHit.push(orb.tier);
      /* Note: we can't add to lockedCells with the canonical (r,row) key
       * here since DOM lookup doesn't surface RECT_REELS index. The orb
       * is fully visible (chip rendered, class set, payout accrued); the
       * respin engine filter (not is-locked-bonus) will skip it correctly.
       * Trade-off: ledger count may be at most visible count for over-plant
       * paths, but every base-game bonus is locked and immovable. */
    }
  }
  /* 2026-06-18 (Boki rule "LOCKED nije tacan ... sve mora da bude
   * sinhronizovano"): sweep (iii) above doesn't add to lockedCells map
   * with semantic key (DOM walk has no RECT_REELS index). Result: HUD
   * LOCKED counter (reads lockedCells.size) drifts from visible orb
   * count. Plus stale (r,row) entries can persist if engine rotated a
   * cell out. Reconcile rebuilds the map from the AUTHORITATIVE source
   * — the actual is-locked-bonus DOM nodes — so map.size == visible. */
  _hwReconcileLockedFromDOM();

  HW_STATE.triggerOrbCount = HW_STATE.lockedCells.size;
  _hwHudUpdate({ pulseLocked: true, pulseTotal: true });
}

/* 2026-06-18 — single source of truth synchroniser for HW_STATE.lockedCells.
 * Walks the DOM, collects every cell with is-locked-bonus class, rebuilds
 * the map keyed by semantic (r,row) when RECT_REELS index resolves, else
 * by stable visited-order fallback ('dom,N'). Preserves orb metadata
 * across the rebuild — new entries get _hwRollOrb(). Returns nothing —
 * mutates HW_STATE. Guarantee: after this call, HW_STATE.lockedCells.size
 * equals the number of DOM cells with is-locked-bonus, and every map
 * entry references a currently-visible orb. */
function _hwReconcileLockedFromDOM() {
  if (typeof document === 'undefined') return;
  const host = document.getElementById('gridHost') || document.querySelector('.gridHost');
  if (!host) return;

  /* Build (cell → semantic key) lookup for RECT_REELS visible rows. */
  const cellToKey = new Map();
  if (typeof window !== 'undefined' && Array.isArray(window.RECT_REELS)) {
    const reels = window.RECT_REELS;
    for (let r = 0; r < reels.length; r++) {
      const reel = reels[r];
      const vis = reel.visibleRows;
      for (let row = 0; row < vis; row++) {
        const cell = reel.cells[row + 1];
        if (cell) cellToKey.set(cell, r + ',' + row);
      }
    }
  }

  const oldOrbs = new Map();
  HW_STATE.lockedCells.forEach(function (orb, key) { oldOrbs.set(key, orb); });

  const lockedNodes = host.querySelectorAll('.cell.is-locked-bonus');
  const newMap = new Map();
  let domFallbackIdx = 0;
  for (const cell of lockedNodes) {
    let key = cellToKey.get(cell);
    if (!key) key = 'dom,' + (domFallbackIdx++);
    let orb = oldOrbs.get(key) || null;
    if (!orb) orb = _hwRollOrb();
    newMap.set(key, orb);
  }

  HW_STATE.lockedCells = newMap;
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
    /* 2026-06-18 — accept BOTH cases (UFP plant may have leaked
     * lowercase 'b' on older builds; new builds always plant upper). */
    var TARGET = String(HW_BONUS_SYMBOL || 'B').toUpperCase();
    var cells = host.querySelectorAll('.cell');
    var hits = [];
    for (var i = 0; i < cells.length; i++) {
      var txt = (cells[i].textContent || '').trim().toUpperCase();
      if (txt === TARGET) hits.push(cells[i]);
    }
    if (hits.length === 0) { resolve(); return; }
    var myToken = ++_HW_BONUS_CELEBRATE_TOKEN;
    host.classList.add('is-hnw-bonus-celebrating');
    for (var j = 0; j < hits.length; j++) hits[j].classList.add('cell--hnw-bonus-celebrate');

    /* 2026-06-18 — Boki rule "u base game mora da se odradi simbol win
     * animacija da se zna da je hold end win dobijen i kolko je simbola
     * dobijeno". Mount a centred badge "N BONUS COLLECTED!" over the
     * grid during the 1500ms celebration window so the player sees a
     * clear "you triggered" cue BEFORE the intro placard takes over. */
    var badge = null;
    try {
      badge = document.createElement('div');
      badge.className = 'hw-bonus-count-overlay';
      badge.setAttribute('role', 'status');
      badge.setAttribute('aria-live', 'polite');
      badge.textContent = hits.length + ' BONUS COLLECTED!';
      document.body.appendChild(badge);
    } catch (_) { /* defensive */ }

    setTimeout(function () {
      if (myToken !== _HW_BONUS_CELEBRATE_TOKEN) return;
      host.classList.remove('is-hnw-bonus-celebrating');
      for (var k = 0; k < hits.length; k++) hits[k].classList.remove('cell--hnw-bonus-celebrate');
      if (badge && badge.parentNode) {
        try { badge.parentNode.removeChild(badge); } catch (_) {}
      }
      resolve();
    }, HW_T_BONUS_CELEBRATE_MS);
  });
}

function hwMaybeEnter() {
  if (HW_STATE.active) return false;
  /* FIX-8 H5 (2026-06-19) — H&W ↔ FS mutual-exclusive invariant.
   * Industry baseline (canonical hold-and-win pattern): H&W round can
   * NEVER overlap with FS. The natural entry path already checks
   * FREESPINS.active at L2055 (wild-trigger path), but hwMaybeEnter
   * (the canonical "scatter-met" entry) did not. If a hypothetical GDD
   * declares scatter-trigger for H&W AND FS on the same symbol set,
   * a single spin could satisfy both → double feature mount. */
  if (typeof FREESPINS !== 'undefined' && FREESPINS.active === true) {
    try { if (typeof console !== 'undefined' && console.warn) console.warn('[H&W] entry rejected — FS round is active (mutual-exclusive invariant)'); } catch (_) {}
    return false;
  }
  /* Plus FSM phase check (defense-in-depth). */
  if (typeof FSM !== 'undefined' && (FSM.phase === 'FS_INTRO' || FSM.phase === 'FS_ACTIVE' || FSM.phase === 'FS_OUTRO')) {
    return false;
  }
  /* W48 bugfix v4 — guard against double-entry while celebration is in
   * flight. The celebration is async (1500ms+); a second postSpin event
   * (e.g. UFP fallback timer firing in parallel) could fire hwForceSeed
   * in the middle and mount the intro before celebration completes,
   * making the player see the placard with no preceding pulse. */
  if (HW_STATE.entering) return false;
  /* 2026-06-18 — industry-reference single-arm-per-spin gate: hwEnd()
   * clears armed so the postSpin immediately following a round end
   * cannot re-fire H&W on the SAME grid snapshot (bonus glyphs persist
   * as data-symbol=B even after .is-locked-bonus stripping). Only the
   * next player-initiated preSpin re-arms the latch, mirroring the
   * industry-standard trigger-latch behaviour. */
  if (HW_STATE.armed === false) return false;
  if (hwCountBonusOnGrid() >= HW_TRIGGER_COUNT) {
    /* Consume the latch the instant we accept the trigger so any
     * parallel postSpin / fallback timer that re-enters in the same
     * tick is rejected here. Re-armed by next preSpin (phase=INACTIVE
     * after this round ends → preSpin sets armed=true). */
    HW_STATE.armed = false;
    /* 2026-06-18 (Boki: "sacekaj da padne i zadnji ril, i da se napravi
     * animacija simbola koji su pali i onda tek intro plaketa"). Strict
     * serial sequence with explicit all-reels-stopped gate:
     *   1. Cancel any UFP H&W fallback timer.
     *   2. Wait until EVERY reel reports spinning=false + stopping=false
     *      + (bouncing|undefined). Without this gate the celebration can
     *      kick off while the last reel is still in its bounce decay
     *      window, and the bonus glyph snapshot misses any cell that
     *      hasn't fully committed its textContent yet.
     *   3. Stash bonus cell DOM REFs via _hwStashEntryCells.
     *   4. Run celebration (1500ms visible pulse + N BONUS COLLECTED).
     *   5. Wait HW_T_CELEBRATE_TAIL_MS for a clean visual cut.
     *   6. _hwBeginRound() mounts INTRO → RUNNING. */
    HW_STATE.entering = true;
    _hwCancelForceFallbackTimer();
    _hwWaitAllReelsStopped(function () {
      _hwStashEntryCells();
      playHwBonusCelebration().then(function () {
        setTimeout(function () {
          HW_STATE.entering = false;
          _hwBeginRound();
        }, HW_T_CELEBRATE_TAIL_MS);
      });
    });
    return true;
  }
  return false;
}

/* 2026-06-18 — defensive gate: poll RECT_REELS until every reel reports
 * "fully settled" (not spinning, not stopping, not bouncing). Resolves
 * via the supplied callback when the last reel commits its textContent
 * + targetY snap. Caps at 1200ms so a broken engine state can't hang
 * the H&W entry forever (the callback runs anyway at the cap). */
function _hwWaitAllReelsStopped(cb, capMsOverride) {
  const START = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  /* 2026-06-18 — default cap covers a full base spin (~5s typical, up to
   * 6s on slow turbo settings). The natural hwMaybeEnter path almost
   * always finds reels already settled (postSpin is delayed
   * settleBreathMs past the engine's anyActive=false transition), but
   * the UFP fallback timer (HW_T_FORCE_FALLBACK_MS=1700ms) may invoke
   * the gate mid-spin — it must wait through the rest of the spin.
   * 6500ms = max-spin + 1500ms breath, configurable per call-site. */
  const CAP_MS = (typeof capMsOverride === 'number' && capMsOverride > 0) ? capMsOverride : 6500;
  /* 2026-06-18 — Boki "ne ceka se da se zavrse svi reel stopovi" + deep
   * recon (agent C): the spinning/stopping/bouncing flag triad alone is
   * race-prone. The bounce flag is set INSIDE the same rAF tick that
   * clears stopping, so a poll catching that tick reads both as false
   * and returns "settled" prematurely. The harden:
   *   1. Flag triad must all be falsy.
   *   2. Every reel must have a non-empty textContent on its top visible
   *      cell — empty string == commitStopSymbols hasn't finished writing.
   *   3. Two consecutive poll ticks must report settled (stability gate
   *      ~70ms wide → strictly past the worst-case bounce frame). */
  let consecutiveSettled = 0;
  function _isAllStopped() {
    if (typeof window === 'undefined' || !Array.isArray(window.RECT_REELS)) return true;
    const reels = window.RECT_REELS;
    for (let i = 0; i < reels.length; i++) {
      const r = reels[i];
      if (!r) continue;
      if (r.spinning) return false;
      if (r.stopping) return false;
      if (r.bouncing === true) return false;
      /* textContent guard — commitStopSymbols writes synchronously per
       * reel after the rotateStripDown pass; an empty cell means engine
       * hasn't fully committed yet. Read row 0 (top visible) — cheap. */
      const cell = (r.cells && r.cells[1]) ? r.cells[1] : null;
      if (cell && (cell.textContent || '').trim() === '') return false;
    }
    return true;
  }
  function _tick() {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (_isAllStopped()) {
      consecutiveSettled++;
      if (consecutiveSettled >= 2) { cb(); return; }
    } else {
      consecutiveSettled = 0;
    }
    if ((now - START) >= CAP_MS) { cb(); return; }
    setTimeout(_tick, 35);
  }
  _tick();
}

/* Helpers wired to HW_STATE — kept close to the entry path so the bug
 * coverage stays obvious from a single read. */
function _hwCancelForceFallbackTimer() {
  if (HW_STATE._forceFallbackTimerId) {
    try { clearTimeout(HW_STATE._forceFallbackTimerId); } catch (_) {}
    HW_STATE._forceFallbackTimerId = null;
  }
}

/* 2026-06-18 — stash DIRECT DOM cell refs (not (r,row) coords) for every
 * cell currently carrying the bonus glyph. PHASE 2 apply walks this map
 * so the orb chip lands on the EXACT DOM node the player saw at trigger
 * time, regardless of what reel.cells[] index it now holds. Eliminates
 * the drift Boki reported ("pomere se mesta simbola u h&w").
 *
 * 2026-06-18 ATOMIC LOCK-ON-TRIGGER (Boki: "Sad kad se padnu simboli
 * u base game, moraju da ostanu i u hold and win"):
 *   Deep recon (agents) proved that B glyphs were UNPROTECTED during
 *   the 1500-2500ms window between celebration start and PHASE 2 apply.
 *   The .is-locked-bonus class is what makes commitStopSymbols /
 *   rotateStripDown / tumble pipelines treat a cell as locked — until
 *   that class is present, any stray engine tick can rewrite the cell's
 *   textContent or shift the cell.
 *
 *   Industry reference (agents/research-pool/woo-controllers-RE.md §1.4
 *   line 142 + lock-and-respin cabinet patent cluster §3.2 line 255 +
 *   WoO GDD §5.4): "the orbs lock in place" happens AT SETTLE — BEFORE
 *   the placard, not after.
 *
 *   FIX: at stash time, atomically apply the lock contract:
 *     1. .is-locked-bonus class (lock signal honoured engine-wide)
 *     2. data-locked-symbol attribute (recovery marker for sweeps)
 *     3. textContent pinned to HW_BONUS_SYMBOL (defence in depth)
 *   PHASE 2 then only paints the orb chrome (label, hw-just-landed
 *   pulse) — the lock itself is already in place. */
function _hwStashEntryCells() {
  HW_STATE.entryCellRefs = new Map();
  if (typeof document === 'undefined') return;
  const host = document.getElementById('gridHost') || document.querySelector('.gridHost');
  if (!host) return;
  const TARGET = String(HW_BONUS_SYMBOL || 'B').toUpperCase();
  const cells = host.querySelectorAll('.cell');
  for (const cell of cells) {
    const txt = (cell.textContent || '').trim().toUpperCase();
    if (txt !== TARGET) continue;
    HW_STATE.entryCellRefs.set(cell, _hwRollOrb());
    /* Atomic lock-on-trigger — these three writes together form the
     * "frozen at entry" contract every downstream engine path honours.
     * Without them the cell would be drift-prone during the entire
     * celebration + intro window. */
    try {
      cell.classList.add('is-locked-bonus');
      cell.setAttribute('data-locked-symbol', TARGET);
      cell.textContent = TARGET;
    } catch (_) { /* defensive — DOM mutation must not break stash */ }
  }
}

function hwForceSeed(orbCount) {
  if (HW_STATE.active) return false;
  if (HW_STATE.entering) return false;
  /* 2026-06-18 — industry-reference armed-latch gate: hwEnd() clears
   * armed and only the next player preSpin re-arms it. Force-seed
   * fallback honours the same gate so a UFP rapid double-click (or
   * fallback timer racing the primary plant) cannot mount a second
   * round on top of the first. */
  if (HW_STATE.armed === false) return false;
  /* Consume the latch up front — see hwMaybeEnter() for the same
   * single-arm rationale. */
  HW_STATE.armed = false;
  /* W48 v6 — pick random VISIBLE (reel, row) coordinates from RECT_REELS,
   * not flat DOM indices. Falls back to flat picks on non-rect topology.
   * Each picked key is a 'reel,row' string matching the natural path. */
  let pickedKeys = [];
  if (typeof window !== 'undefined' && Array.isArray(window.RECT_REELS) && window.RECT_REELS.length > 0) {
    const reels = window.RECT_REELS;
    const allKeys = [];
    for (let r = 0; r < reels.length; r++) {
      const vis = reels[r].visibleRows;
      for (let row = 0; row < vis; row++) allKeys.push(r + ',' + row);
    }
    if (allKeys.length === 0) return false;
    const N = Math.max(1, Math.min(orbCount || HW_FORCE_SEED_DEFAULT, allKeys.length));
    const pool = allKeys.slice();
    while (pickedKeys.length < N && pool.length > 0) {
      pickedKeys.push(pool.splice(Math.floor(_hwRng() * pool.length), 1)[0]);
    }
  } else {
    const host = document.getElementById('gridHost');
    if (!host) return false;
    const cellCount = host.querySelectorAll('.cell').length;
    if (cellCount === 0) return false;
    const N = Math.max(1, Math.min(orbCount || HW_FORCE_SEED_DEFAULT, cellCount));
    const seen = new Set();
    while (seen.size < N) seen.add(Math.floor(_hwRng() * cellCount));
    pickedKeys = Array.from(seen).map(i => 'flat,' + i);
  }

  /* W48 bugfix v4 — celebrate BEFORE entering INTRO. Stamp the bonus
   * glyph on each picked cell so the celebration has visible targets.
   *
   * 2026-06-18 (Boki: "ne ceka se da se zavrse svi reel stopovi i da ide
   * animacija bonus simbola"): cortex-eyes celebration-timing probe
   * proved this path was firing AT t≈1700ms (the fallback timer cap)
   * while reels were still spinning until t≈4761ms — a 3-second visual
   * desync. ROOT CAUSE: the fallback timer fires on a fixed delay
   * regardless of spin duration, and hwForceSeed used to stamp glyphs +
   * celebrate IMMEDIATELY on entry. FIX: gate the entire body behind
   * _hwWaitAllReelsStopped, identical to the natural hwMaybeEnter path.
   * The pre-gate body just flips entering=true so a parallel postSpin
   * (natural path winning the race) returns early. */
  HW_STATE.entering = true;
  _hwCancelForceFallbackTimer();
  _hwWaitAllReelsStopped(function () {
    pickedKeys.forEach(function (key) {
      const parts = key.split(',');
      let cell = null;
      if (parts[0] === 'flat') {
        const host = document.getElementById('gridHost');
        if (host) cell = host.querySelectorAll('.cell')[parseInt(parts[1], 10)] || null;
      } else {
        cell = _hwResolveCell(parseInt(parts[0], 10), parseInt(parts[1], 10));
      }
      if (cell && !cell.classList.contains('is-locked-bonus')) {
        cell.textContent = HW_BONUS_SYMBOL;
      }
    });
    /* 2026-06-18 — same as the natural-entry path: stash DIRECT DOM refs
     * after the bonus glyphs are stamped, so PHASE 2 mount applies orbs
     * to the exact same cells the celebration painted. */
    _hwStashEntryCells();
    playHwBonusCelebration().then(function () {
      setTimeout(function () {
        HW_STATE.entering = false;
        _hwForceSeedMount(pickedKeys);
      }, HW_T_CELEBRATE_TAIL_MS);
    });
  });
  return true;
}

function _hwForceSeedMount(pickedKeys) {
  /* W48 v5+v6 — two-phase mount with semantic key shape. */
  _hwEnterPhase('INTRO');
  HW_STATE.respinsLeft = HW_RESPINS_AWARD;
  HW_STATE.respinsUsed = 0;
  HW_STATE.totalWinX = 0;
  HW_STATE.fullGrid = false;
  HW_STATE.lockedCells.clear();
  HW_STATE.jackpotsHit = [];
  /* 2026-06-18 — clear stale force flags (Boki bug C). */
  try { if (typeof window !== 'undefined') { window.FORCE_TRIGGER = null; window.__FORCE_FEATURE_PENDING__ = null; } } catch (_) {}

  /* PHASE 1 — record positions, DO NOT mutate DOM. */
  pickedKeys.forEach(function (key) {
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
    /* PHASE 2 — apply orb chips with pop-in. */
    pickedKeys.forEach(function (key) {
      const orb = HW_STATE.lockedCells.get(key);
      if (!orb) return;
      const parts = key.split(',');
      let cell = null;
      if (parts[0] === 'flat') {
        const host = document.getElementById('gridHost');
        if (host) cell = host.querySelectorAll('.cell')[parseInt(parts[1], 10)] || null;
      } else {
        cell = _hwResolveCell(parseInt(parts[0], 10), parseInt(parts[1], 10));
      }
      if (!cell) return;
      _hwApplyOrbToCell(cell, orb);
      _hwSpawnDelta(cell, orb.valueX);
      _hwSpawnFly(cell, orb.valueX);
    });
    /* 2026-06-18 (part 7) — same sanity sweep as the natural-entry
     * _hwBeginRound path. The UFP H&W chip plants N orbs and emits a
     * fallback force-seed timer; the engine sometimes lands additional
     * bonus glyphs in the same spin (random RNG hit), so the harvester
     * captured only the seeded N. Sweep (iii) DOM walk locks every
     * remaining bonus glyph so the WoO contract holds for the force
     * path too: bonus simboli iz base game OSTAJU na istim mestima. */
    _hwEnsureAllOrbsLocked();
  });
  return true;
}

function hwAfterRespin() {
  if (!HW_STATE.active || HW_STATE.phase !== 'RUNNING') return { ended: false, allLocked: false };
  const added = hwHarvestBonus({ celebrate: true });
  /* 2026-06-18 (Boki rule "LOCKED nije tačan ... sinhronizovano"):
   * after each respin, rebuild lockedCells from the DOM so the HUD
   * counter (reads lockedCells.size) always matches the visible orb
   * pile. hwHarvestBonus may carry stale entries if a strip rotation
   * race lost a cell between map-write and DOM commit. */
  _hwReconcileLockedFromDOM();
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
  /* FIX-8 H6 (2026-06-19) — atomic credit escrow + commit.
   * Industry baseline (UKGC RTS 7 + AGCO Ontario): the credit-payment
   * MUST be derived from a state SNAPSHOT taken at the entry to
   * SUMMARY phase, not from live HW_STATE that summary-render async
   * resolution mutates. Previously hwEnd entered SUMMARY (async render
   * 1500ms+) and ON RESOLVE emitted payout from HW_STATE.totalWinX.
   * If a sibling block (e.g. winCap, jackpotPicker, telemetry) re-
   * entered HW_STATE mid-await and changed totalWinX, credit drifted.
   *
   * Atomic fix: snapshot the payout NOW into an escrow object that
   * the resolve handler reads. HW_STATE may mutate freely thereafter;
   * the player credit is locked to the escrow snapshot.
   */
  const ESCROW = Object.freeze({
    winX: Number(HW_STATE.totalWinX) || 0,
    bet:  _hwBet(),
    orbsCollected: HW_STATE.lockedCells ? HW_STATE.lockedCells.size : 0,
    respinsUsed:   HW_STATE.respinsUsed || 0,
    jackpotsHit:   (HW_STATE.jackpotsHit && HW_STATE.jackpotsHit.length) || 0,
    fullGrid:      !!HW_STATE.fullGrid,
    committedAt:   Date.now(),
  });
  _hwEnterPhase('SUMMARY');
  _hwTeardownObserver();
  const stats = {
    totalWinX: ESCROW.winX,
    orbsCollected: ESCROW.orbsCollected,
    respinsUsed: ESCROW.respinsUsed,
    jackpotsHit: ESCROW.jackpotsHit,
    fullGrid: ESCROW.fullGrid,
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
     * silently dropped the total in alt hosts / test harnesses.
     *
     * FIX-8 H6: read from ESCROW snapshot, NOT live HW_STATE. Atomic. */
    try {
      if (ESCROW.winX > 0 && typeof HookBus !== 'undefined') {
        HookBus.emit('onHoldAndWinPayout', { winX: ESCROW.winX, bet: ESCROW.bet, escrow: ESCROW });
        /* UQ-MASTERY-2 (2026-06-21) — generic feature-payout alias so
         * grandInterruptionLock (and any future block listening on the
         * canonical feature payout signal) actually receives the event.
         * Carries feature='holdAndWin' so listeners can route. */
        try { HookBus.emit('onFeaturePayout', { feature: 'holdAndWin', winX: ESCROW.winX, bet: ESCROW.bet, escrow: ESCROW }); } catch (_) {}
      }
    } catch (_) {}
    HW_STATE.lockedCells.clear();
    HW_STATE.totalWinX = 0;
    HW_STATE.respinsLeft = 0;
    HW_STATE.respinsUsed = 0;
    HW_STATE.fullGrid = false;
    HW_STATE.jackpotsHit = [];
    /* 2026-06-18 — industry-reference trigger-latch: hold the armed
     * flag FALSE until the next player-initiated preSpin re-arms it.
     * This is the gate that fixes Boki bug "zavrsi se jedan H&W, i
     * odmah drugi pocne": without this latch, the very next postSpin
     * (often firing on the same reel snapshot as the round just ended)
     * could re-evaluate the grid, still see 6+ data-symbol=B cells,
     * and immediately mount round #2. Industry-standard cabinet
     * sequencers ship the same latch. */
    HW_STATE.armed = false;
    /* Double-safety FORCE_TRIGGER nullify — _hwBeginRound() already
     * cleared it at INTRO time, but if a downstream block (autoplay,
     * sales-loop) re-planted FORCE_TRIGGER during the running round,
     * we wipe it here so the next spin starts from a clean slate. */
    try {
      if (typeof window !== 'undefined') {
        window.FORCE_TRIGGER = null;
        window.__FORCE_FEATURE_PENDING__ = null;
      }
    } catch (_) {}
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
  /* W48 v7 — defensive preSpin cleanup: strip any leftover celebration
   * classes so a token-cancelled or race-aborted celebration cannot leave
   * the grid in a dim state across base-game spins. Belt-and-brace —
   * playHwBonusCelebration's own timer normally cleans up, this is the
   * seat-belt for the edge case Boki reported ("sjebo si u base game
   * reel spin reel land i mutne su celije"). */
  HookBus.on('preSpin', () => {
    try {
      var host = document.getElementById('gridHost');
      if (host && host.classList) {
        host.classList.remove('is-hnw-bonus-celebrating');
        if (host.querySelectorAll) {
          host.querySelectorAll('.cell--hnw-bonus-celebrate').forEach(function (c) {
            c.classList.remove('cell--hnw-bonus-celebrate');
          });
        }
      }
      /* 2026-06-18 — Deep-recon Risk #5 fix: HW_STATE.entering was set
       * true inside hwMaybeEnter() / hwForceSeed() to block double-mount,
       * cleared inside the playHwBonusCelebration().then() callback. If
       * the player slam-stops or skips DURING the 1500ms celebrate window,
       * the .then() may run AFTER the abort but the next base spin's
       * postSpin already saw entering=true and returned early → next H&W
       * trigger never mounts. Defensive: clear the flag at every preSpin
       * boundary unless an H&W round is already RUNNING (in which case
       * preSpin is a respin and the flag is already false). */
      if (HW_STATE.phase === 'INACTIVE') HW_STATE.entering = false;
      /* 2026-06-18 — industry-reference trigger-latch re-arm: when the
       * player initiates a new base spin and we are between rounds
       * (phase INACTIVE), the latch is re-armed so the next postSpin
       * may evaluate H&W trigger. Inside a RUNNING round (respins),
       * the preSpin is the respin loop and armed MUST stay whatever
       * it currently is (false from the round-start consume) — respins
       * must never re-arm because the postSpin after each respin must
       * NOT re-enter as a NEW H&W round (would mean nested-round). */
      if (HW_STATE.phase === 'INACTIVE') HW_STATE.armed = true;
    } catch (_) {}
  }, { priority: 10 });
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

  /* FIX-6 (deep QA #10, 2026-06-19) — wild-trigger H&W canonical entry.
   * wildTriggerHoldAndWin emits 'onWildTriggerHoldAndWinRequested' as an
   * alternative entry-path (N wilds on screen → enter H&W). Before this
   * subscriber, the emit fired into nothing (no listener), so wild-trigger
   * H&W was dead code. Mirrors the natural hwMaybeEnter contract:
   * activate ONLY if not already active + not in FS. Optional preSeed
   * payload (wild cell keys) defers to hwForceSeed for orb placement. */
  HookBus.on('onWildTriggerHoldAndWinRequested', (payload) => {
    if (HW_STATE.active) return;
    /* If FS is currently active (FSM is mid-FS round), defer — let
     * onFsEnd run first; H&W and FS cannot interleave. */
    if (typeof FREESPINS !== 'undefined' && FREESPINS.active) return;
    try {
      const seedKeys = payload && Array.isArray(payload.wildCellKeys) ? payload.wildCellKeys : [];
      if (seedKeys.length > 0 && typeof hwForceSeed === 'function') {
        hwForceSeed(seedKeys.length);
      } else if (typeof hwMaybeEnter === 'function') {
        hwMaybeEnter();
      }
    } catch (e) {
      try { if (typeof console !== 'undefined' && console.warn) console.warn('[holdAndWin] wildTrigger handler failed', e); } catch (_) {}
    }
  });

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
    /* 2026-06-18 — cancel any in-flight fallback timer first so a
     * rapid second chip click doesn't queue two fallbacks (Boki bug C:
     * "zavrsi se jedan h&W i onda krene slkedeci"). */
    _hwCancelForceFallbackTimer();
    /* Fallback timer — wait long enough that the just-fired base spin
     * has a chance to land its bonus pile through FORCE_TRIGGER. If the
     * pile lands, hwMaybeEnter() activated the round in postSpin and
     * HW_STATE.active is already true. If the pool refused the bonus
     * symbol (no B in the natural strip) OR if FS interrupted, we no-op:
     * forcing both orbs AND FS into the same round corrupts both
     * lifecycles. The timer ID is stashed on HW_STATE so the natural-
     * entry path can cancel it the moment celebration starts (no double
     * H&W after the round ends). */
    /* 2026-06-18 (Boki: "ne ceka se da se zavrse svi reel stopovi i da ide
     * animacija bonus simbola"): cortex-eyes timing probe proved this
     * fallback was firing at t=1700ms while the spin was still running
     * (settled at t=4761ms). Result: hwForceSeed stamped bonus glyphs +
     * played celebration WHILE the reels were visibly mid-spin — 3-second
     * desync from the player's perspective. FIX: after the initial 1700ms
     * defer, ALSO wait for _hwWaitAllReelsStopped before deciding. The
     * fallback only fires when (a) every reel is fully settled AND
     * (b) the natural plant did not engage hwMaybeEnter. */
    HW_STATE._forceFallbackTimerId = setTimeout(function () {
      HW_STATE._forceFallbackTimerId = null;
      _hwWaitAllReelsStopped(function () {
        try {
          if (HW_STATE.active) return;
          if (HW_STATE.entering) return;   /* natural path already kicked off */
          var fsActive = (typeof FSM !== 'undefined' && FSM && FSM.phase && FSM.phase !== 'BASE');
          if (fsActive) return;
          hwForceSeed(HW_FORCE_SEED_DEFAULT);
        } catch (_) {}
      });
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
