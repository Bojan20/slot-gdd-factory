import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
import { Z } from '../registry/zIndexScale.mjs';

/**
 * Slot GDD Factory · freeSpins BLOCK
 *
 * Performance budget: ≤ 1ms per FSM_renderHud, ≤ 50KB cumulative listener
 * heap across a 200-retrigger session.
 *
 * The full Free-Spins lifecycle visual layer — driven by the FSM phase
 * machine (BASE → FS_INTRO → FS_ACTIVE → FS_OUTRO → BASE).
 *
 * Three composable visual layers:
 *   1. body.fs-mode-<bg>   — full-stage background swap (purple/gold/crimson)
 *                            chosen by GDD palette heuristic.
 *   2. .fs-overlay         — full-screen modal placard for intro & outro.
 *                            Backdrop-blurs the play area; CTA centered.
 *   3. .fs-hud             — sticky HUD above the reel area with SPINS /
 *                            MULT / TOTAL.
 *
 * Runtime state machine helpers emitted:
 *   FSM_renderHud / FSM_showFsMode / FSM_hideFsMode /
 *   FSM_showOverlay / FSM_hideOverlay / FSM_showToast /
 *   FSM_enterIntro / FSM_enterActive / FSM_runNextFsSpin /
 *   FSM_handleRetrigger / FSM_enterOutro / FSM_enterBase
 *
 * GDD-driven configuration (consumed from `model.freeSpinsPresentation`):
 *   enabled               boolean                                 (default true)
 *   introLabel            string                                  (default "FREE SPINS")
 *   outroLabel            string                                  (default "FREE SPINS COMPLETE")
 *   totalWinLabel         string — outro title above the total    (default "TOTAL WIN")
 *   introCta              string                                  (default "TAP TO BEGIN")
 *   outroCta              string                                  (default "RETURN TO BASE")
 *   introSub              string                                  (default "Free Spins begin now.")
 *   fadeMs                number ms — overlay fade duration       (default 320)
 *   enterActiveDelayMs    number ms — pause before first FS spin  (default 420)
 *   spinBreathMs          number ms — breath after win cycle      (default 250)
 *   toastMs               number ms — default toast visibility    (default 1800)
 *   retriggerToastMs      number ms — retrigger toast visibility  (default 1600)
 *   featureFadeInMs       number ms — intro reel fade-in duration (default 600)
 *   featureHideMs         number ms — intro reel hide duration    (default 300)
 *   bigWinSafetyMs        number ms — big-win re-enable safety    (default 30000)
 *
 * Public API (server-side, ES module):
 *   defaultConfig()                        → safe defaults
 *   resolveConfig(model)                   → merge defaults with GDD override
 *   emitFreeSpinsCSS(config)               → CSS string
 *   emitFreeSpinsHudMarkup(config)         → HUD HTML fragment
 *   emitFreeSpinsToastMarkup(config)       → toast HTML fragment
 *   emitFreeSpinsOverlayMarkup(config)     → overlay placard HTML fragment
 *   emitFreeSpinsRuntime(config)           → runtime JS for FSM helpers
 *
 * Runtime dependencies: FSM object + FREESPINS + setStageBadge,
 * STAGE_FS_LABEL, STAGE_BASE_LABEL, spinButton, devFsBtn, statusElGlobal,
 * cancelWinSymCycle, applyWinHighlight, startSpinAll, runStaticReroll,
 * handlePostSpin, UNIFORM_REEL_KINDS, RECT_REELS, SHAPE.
 *
 * Wave Legacy · industry baseline (vendor-neutral). Original block predates the
 * formal Wave Hxx naming + JSDoc kontrakt header pattern (auto-tagged by
 * tools/cortex-block-mega-fix.mjs).
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  introLabel: 'FREE SPINS',
  outroLabel: 'FREE SPINS COMPLETE',
  totalWinLabel: 'TOTAL WIN',
  introCta: 'TAP TO BEGIN',
  outroCta: 'RETURN TO BASE',
  introSub: 'Free Spins begin now.',
  fadeMs: 320,
  enterActiveDelayMs: 420,
  spinBreathMs: 250,
  toastMs: 1800,
  retriggerToastMs: 1600,
  featureFadeInMs: 600,
  featureHideMs: 300,
  bigWinSafetyMs: 30000,
});

export function defaultConfig() {
  return Object.freeze({ ...DEFAULTS });
}

function isPlainLabel(s, maxLen = 60) {
  return typeof s === 'string' && s.length > 0 && s.length <= maxLen && !/[<>{}]/.test(s);
}

function clampMs(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.freeSpinsPresentation) || {};

  if (src.enabled === false) cfg.enabled = false;

  /* Strict-GDD enforcement (Boki rule): Free Spins UI must not paint when no
     free-spin-style feature lives in model.features. Explicit
     freeSpinsPresentation.enabled=true bypasses this guard (author override).

     Direct-cfg emitter path (Group AB CRITICAL fix 17.06.2026):
     emitFreeSpinsCSS/Markup/Runtime call resolveConfig({ freeSpinsPresentation: cfg }).
     In that call shape `model.features` is UNDEFINED — caller is bypassing
     orchestrator wholly and passing their own cfg. Strict-GDD enforcement
     only applies when caller is the orchestrator (which always defines
     `features` as an array, even if empty). */
  if (src.enabled == null && Array.isArray(model && model.features)) {
    const FS_PATTERN = /^(free[_-]?spins?|free[_-]?games?|bonus[_-]?round|respins?)$/i;
    const detected = model.features.some(f => f && typeof f.kind === 'string' && FS_PATTERN.test(f.kind));
    if (!detected) cfg.enabled = false;
  }

  if (isPlainLabel(src.introLabel)) cfg.introLabel = src.introLabel;
  if (isPlainLabel(src.outroLabel)) cfg.outroLabel = src.outroLabel;
  if (isPlainLabel(src.totalWinLabel)) cfg.totalWinLabel = src.totalWinLabel;
  if (isPlainLabel(src.introCta, 30)) cfg.introCta = src.introCta;
  if (isPlainLabel(src.outroCta, 30)) cfg.outroCta = src.outroCta;
  if (isPlainLabel(src.introSub, 120)) cfg.introSub = src.introSub;

  const msMap = [
    ['fadeMs',             100,  2000],
    ['enterActiveDelayMs',   0,  3000],
    ['spinBreathMs',         0,  3000],
    ['toastMs',            300,  6000],
    ['retriggerToastMs',   300,  6000],
    ['featureFadeInMs',    300,  2000],
    ['featureHideMs',      100,  1000],
    ['bigWinSafetyMs',   10000, 120000],
  ];
  for (const [k, lo, hi] of msMap) {
    if (k in src) {
      const v = clampMs(src[k], lo, hi);
      if (v !== null) cfg[k] = v;
    }
  }
  return cfg;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[ch]));
}

export function emitFreeSpinsCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ freeSpinsPresentation: cfg });
  if (!c.enabled) return `\n/* freeSpins BLOCK (disabled by GDD) — no CSS emitted */\n`;
  return `
/* ── freeSpins BLOCK — emitted by src/blocks/freeSpins.mjs ──────────────
   GDD knobs (baked at build time):
     fadeMs             = ${c.fadeMs}
     introLabel         = ${JSON.stringify(c.introLabel)}
     outroLabel         = ${JSON.stringify(c.outroLabel)}
   Three visual layers all driven from the same FSM state. */

/* H5.18 — Boki rule 05.06.2026: "Fs reel grid ili grid bilo kog bonusa
   ne sme da se pojavi u pozadini dok je plaketa za fs intro prikazana
   na ekranu. tek kada pritisnem tap to begin, tada se fadinuju reel
   frame sa svim celijama [...] za fs i bilo koji bonus feature."

   Generic body-level state class: any block that triggers a modal
   intro placard sets this on document.body before the overlay shows,
   and clears it (replacing with the fadein twin class) when the
   player taps to begin. The reel frame is hidden via opacity +
   visibility so layout space is preserved (no reflow) but nothing
   leaks through the blurred overlay backdrop. */
body.is-feature-intro-active .play .frame,
body.is-feature-intro-active .play .sideHud {
  opacity: 0;
  visibility: hidden;
  transition: opacity ${c.featureHideMs}ms ease, visibility 0s linear ${c.featureHideMs}ms;
}
body.is-feature-intro-fadein .play .frame,
body.is-feature-intro-fadein .play .sideHud {
  animation: featureFadeIn ${c.featureFadeInMs}ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
@keyframes featureFadeIn {
  0%   { opacity: 0; visibility: visible; transform: scale(0.94); }
  60%  { opacity: 1; visibility: visible; transform: scale(1.02); }
  100% { opacity: 1; visibility: visible; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  body.is-feature-intro-fadein .play .frame,
  body.is-feature-intro-fadein .play .sideHud {
    animation: none;
    opacity: 1;
    visibility: visible;
  }
}

/* Visual-mode body backgrounds (chosen by GDD palette heuristic). */
body.fs-mode-purple { background: #1d1230; }
body.fs-mode-gold   { background: #2a2114; }
body.fs-mode-crimson{ background: #2a0f12; }

/* Reel frame in FS modes — flat, no halo, no panel. */
body.fs-mode-purple .frame,
body.fs-mode-gold .frame,
body.fs-mode-crimson .frame {
  position: relative;
  background: transparent;
  border: none;
  box-shadow: none;
}
body.fs-mode-purple .frame::after,
body.fs-mode-gold   .frame::after,
body.fs-mode-crimson .frame::after {
  content: none;
}

/* FS HUD — slim horizontal bar pinned to the top of the viewport. */
.fs-hud {
  position: fixed;
  /* W47.S8 (A9 safe-area) — was top: 10px which sat right under the
   * notch on iPhone landscape. Honour env(safe-area-inset-top) with a
   * 10px fallback so the FS HUD slides DOWN on notched devices. */
  top: calc(max(10px, env(safe-area-inset-top, 0px) + 10px));
  left: 50%;
  transform: translateX(-50%);
  display: none;
  gap: 10px;
  padding: 8px 14px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--accent);
  border-radius: 14px;
  z-index: 50;
  font-family: inherit;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}
.fs-hud--active { display: flex; }
.fs-hud__box {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 70px;
}
.fs-hud__label {
  font-size: 0.7rem;  /* Wave UQ — ≥11px floor */
  color: var(--accent);
  opacity: 0.8;
  letter-spacing: 1.4px;
  text-transform: uppercase;
}
.fs-hud__value {
  font-size: 1rem;
  font-weight: 800;
  color: #ffe6a8;
  letter-spacing: 0.4px;
  /* W47.S20 retrigger polish — base transition lets the pulse class
   * settle smoothly into the resting style without snapping. */
  transition: text-shadow 260ms ease-out, transform 260ms ease-out, color 260ms ease-out;
  transform-origin: 50% 50%;
}
/* W47.S20 — retrigger pulse + glow on the spins counter.
 * Triggered by FSM_handleRetrigger via class toggle; auto-removed
 * after ~700ms (matches the FS_RETRIGGER_TOAST_MS attack window so
 * the counter visually "wakes up" alongside the +N toast). Pure CSS,
 * one transform + one text-shadow ramp; no extra DOM, no extra timer
 * beyond the cleanup setTimeout already needed for class removal. */
.fs-hud__value--retrig {
  animation: fs-hud-retrig-pulse 700ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
@keyframes fs-hud-retrig-pulse {
  0%   { transform: scale(1);    text-shadow: 0 0 0 rgba(255, 230, 168, 0); color: #ffe6a8; }
  25%  { transform: scale(1.32); text-shadow: 0 0 22px rgba(255, 230, 168, 0.95), 0 0 44px rgba(255, 214, 110, 0.55); color: #fff6d2; }
  60%  { transform: scale(1.08); text-shadow: 0 0 12px rgba(255, 230, 168, 0.55), 0 0 24px rgba(255, 214, 110, 0.30); color: #ffeebf; }
  100% { transform: scale(1);    text-shadow: 0 0 0 rgba(255, 230, 168, 0); color: #ffe6a8; }
}
@media (prefers-reduced-motion: reduce) {
  /* Hard kill — no scale, no glow ramp. SR users still hear the
   * aria-live counter update; motion-sensitive users see a calm
   * value swap without any pulse. */
  .fs-hud__value--retrig { animation: none !important; }
  .fs-hud__value          { transition: none !important; }
}
.fs-hud__divider {
  width: 1px;
  align-self: stretch;
  background: rgba(201, 162, 39, 0.35);
  margin: 2px 4px;
}

/* FS retrigger toast. */
.fs-toast {
  position: fixed;
  /* W47.S8 (A9 safe-area) — was top: 70px which still clipped under
   * the notch on iPhone 14 Pro Max landscape. Wrap in env() with 70px
   * fallback so the toast appears below the inset. */
  top: calc(max(70px, env(safe-area-inset-top, 0px) + 70px));
  left: 50%;
  transform: translateX(-50%) translateY(-8px);
  padding: 10px 22px;
  background: linear-gradient(180deg, #3a2a14, #1d1208);
  border: 1px solid var(--accent);
  border-radius: 999px;
  color: #ffe6a8;
  font-weight: 800;
  font-size: 0.9rem;
  letter-spacing: 2px;
  text-transform: uppercase;
  z-index: 60;
  opacity: 0;
  pointer-events: none;
  transition: opacity 280ms ease-out, transform 280ms ease-out;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55), 0 0 30px rgba(255, 214, 110, 0.35);
}
.fs-toast--show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

/* Full-stage modal placard. */
.fs-overlay {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(7, 5, 14, 0.55);
  backdrop-filter: blur(10px) saturate(1.1);
  z-index: ${Z.HUD_BACKGROUND};   /* UQ-DEEP-AO · AO-5 — was 200 (now via registry) */
  opacity: 0;
  transition: opacity ${c.fadeMs}ms ease-out;
}
.fs-overlay--show {
  display: flex;
  opacity: 1;
}
.fs-placard {
  width: min(420px, 86vw);
  padding: 32px 28px 26px;
  background: linear-gradient(180deg, #1a1228 0%, #0c0612 100%);
  border: 1px solid var(--accent);
  border-radius: 20px;
  text-align: center;
  box-shadow: 0 30px 100px rgba(0, 0, 0, 0.75),
              inset 0 1px 0 rgba(255, 230, 168, 0.12),
              0 0 80px rgba(173, 109, 255, 0.18);
  transform: translateY(8px) scale(0.96);
  transition: transform ${c.fadeMs}ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.fs-overlay--show .fs-placard { transform: translateY(0) scale(1); }
body.fs-mode-gold    .fs-placard { box-shadow: 0 30px 100px rgba(0, 0, 0, 0.75), inset 0 1px 0 rgba(255, 230, 168, 0.12), 0 0 80px rgba(255, 214, 110, 0.22); }
body.fs-mode-crimson .fs-placard { box-shadow: 0 30px 100px rgba(0, 0, 0, 0.75), inset 0 1px 0 rgba(255, 230, 168, 0.12), 0 0 80px rgba(255, 110, 110, 0.20); }

.fs-placard__eyebrow {
  font-size: 0.7rem;
  color: var(--accent);
  letter-spacing: 4px;
  text-transform: uppercase;
  opacity: 0.85;
  margin-bottom: 12px;
}
.fs-placard__title {
  font-size: 2rem;
  font-weight: 800;
  color: #ffe6a8;
  line-height: 1.05;
  letter-spacing: 1.5px;
  text-shadow: 0 6px 22px rgba(0, 0, 0, 0.65);
  margin-bottom: 6px;
}
.fs-placard__spins {
  font-size: 3.2rem;
  font-weight: 900;
  color: var(--accent);
  line-height: 1;
  text-shadow: 0 6px 24px rgba(0, 0, 0, 0.6), 0 0 32px rgba(255, 214, 110, 0.5);
  margin: 8px 0 6px;
}
.fs-placard__sub {
  font-size: 0.85rem;
  color: #d4dcef;
  opacity: 0.8;
  margin-bottom: 22px;
}
.fs-placard__cta {
  padding: 12px 28px;
  background: linear-gradient(180deg, #c9a227 0%, #8a6f15 100%);
  color: #1a1208;
  font-weight: 800;
  font-size: 0.9rem;
  letter-spacing: 2.5px;
  text-transform: uppercase;
  border: 1px solid #dbb840;
  border-radius: 999px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5),
              inset 0 1px 0 rgba(255, 230, 168, 0.35);
  transition: transform 0.15s ease-out, box-shadow 0.15s ease-out;
}
.fs-placard__cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55),
              inset 0 1px 0 rgba(255, 230, 168, 0.45),
              0 0 24px rgba(255, 214, 110, 0.5);
}
`;
}

export function emitFreeSpinsHudMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ freeSpinsPresentation: cfg });
  if (!c.enabled) return '';
  return tagBlockMarkup(`<!-- Free Spins HUD — rendered always; toggled visible via .fs-hud--active.
       WCAG 4.1.3 (Status Messages) — every value cell is mutated on
       every FS spin / award; aria-live="polite" so SR users hear the
       spin / multiplier / total counters update without preempting
       other speech.
       W47.S26 polish:
       • Each box is a role="group" with aria-labelledby pointing at
         its label, so SR navigation lands on "Spins · 3 / 10" instead
         of bare "3 / 10".
       • Value cells use aria-labelledby so the announcement carries
         the label semantically.
       • The HUD container starts aria-hidden=true; FSM_enterIntro
         flips it to false so the polite live regions actually announce.
         Polite-on-hidden was a no-op pre-polish. -->
<div class="fs-hud" id="fsHud" role="region" aria-label="Free spins status" aria-hidden="true">
  <div class="fs-hud__box" role="group" aria-labelledby="fsHudSpinsLabel">
    <div class="fs-hud__label" id="fsHudSpinsLabel">Spins</div>
    <div class="fs-hud__value" id="fsHudSpins"
         aria-live="polite" aria-atomic="true"
         aria-labelledby="fsHudSpinsLabel fsHudSpins">0 / 0</div>
  </div>
  <div class="fs-hud__divider" aria-hidden="true"></div>
  <div class="fs-hud__box" role="group" aria-labelledby="fsHudMultLabel">
    <div class="fs-hud__label" id="fsHudMultLabel">Mult</div>
    <div class="fs-hud__value" id="fsHudMult"
         aria-live="polite" aria-atomic="true"
         aria-labelledby="fsHudMultLabel fsHudMult">×1</div>
  </div>
  <div class="fs-hud__divider" aria-hidden="true"></div>
  <div class="fs-hud__box" role="group" aria-labelledby="fsHudTotalLabel">
    <div class="fs-hud__label" id="fsHudTotalLabel">Total</div>
    <div class="fs-hud__value" id="fsHudTotal"
         aria-live="polite" aria-atomic="true"
         aria-labelledby="fsHudTotalLabel fsHudTotal">0.00</div>
  </div>
</div>`, 'freeSpins');
}

export function emitFreeSpinsToastMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ freeSpinsPresentation: cfg });
  if (!c.enabled) return '';
  return tagBlockMarkup(`<!-- Retrigger / award toast — animates in & out on +N FS event.
       W47.S26 — role="status" + aria-live="polite" so the +N retrigger
       announcement queues behind the spin-result announcement instead
       of cutting it off mid-utterance. Toast text is set via
       .textContent in FSM_showToast which triggers the live-region
       announce automatically. -->
<div class="fs-toast" id="fsToast" role="status" aria-live="polite" aria-atomic="true" aria-hidden="true">+0 FREE SPINS</div>`, 'freeSpins');
}

export function emitFreeSpinsOverlayMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ freeSpinsPresentation: cfg });
  if (!c.enabled) return '';
  return tagBlockMarkup(`<!-- Free Spins full-stage overlay — intro & outro placards. -->
<div class="fs-overlay" id="fsOverlay" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="fs-placard">
    <div class="fs-placard__eyebrow" id="fsPlacardEyebrow">YOU TRIGGERED</div>
    <div class="fs-placard__title" id="fsPlacardTitle">${esc(c.introLabel)}</div>
    <div class="fs-placard__spins" id="fsPlacardSpins">10</div>
    <div class="fs-placard__sub" id="fsPlacardSub">${esc(c.introSub)}</div>
    <button class="fs-placard__cta" id="fsPlacardCta" type="button" aria-label="${esc(c.introCta) || 'Continue to free spins'}">${esc(c.introCta)}</button>
  </div>
</div>`, 'freeSpins');
}

export function emitFreeSpinsRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ freeSpinsPresentation: cfg });
  if (!c.enabled) {
    return `
  /* ── freeSpins BLOCK (disabled by GDD) ──────────────────────────────── */
  const FSM = { phase: 'BASE', spinsTotal: 0, spinsRemaining: 0, mult: 1, totalWin: 0, retrigCount: 0 };
  if (typeof window !== 'undefined') window.FSM = FSM;
  const fsHud = null, fsToast = null, fsOverlay = null;
  const fsPlacardEyebrow = null, fsPlacardTitle = null, fsPlacardSpins = null,
        fsPlacardSub = null, fsPlacardCta = null;
  function FSM_renderHud() {}
  function FSM_showFsMode() {}
  function FSM_hideFsMode() {}
  function FSM_showOverlay() {}
  function FSM_hideOverlay() {}
  function FSM_showToast() {}
  function FSM_enterIntro() {}
  function FSM_enterActive() {}
  function FSM_runNextFsSpin() {}
  function FSM_handleRetrigger() {}
  function FSM_enterOutro() {}
  function FSM_enterBase() {}
`;
  }
  return `
  /* ── freeSpins BLOCK — emitted by src/blocks/freeSpins.mjs ───────────
     GDD knobs baked at build time:
       fadeMs              = ${c.fadeMs}
       enterActiveDelayMs  = ${c.enterActiveDelayMs}
       spinBreathMs        = ${c.spinBreathMs}
       toastMs             = ${c.toastMs}
       retriggerToastMs    = ${c.retriggerToastMs}
       introLabel          = ${JSON.stringify(c.introLabel)}
       outroLabel          = ${JSON.stringify(c.outroLabel)}
       totalWinLabel       = ${JSON.stringify(c.totalWinLabel)}
       introCta            = ${JSON.stringify(c.introCta)}
       outroCta            = ${JSON.stringify(c.outroCta)}
       introSub            = ${JSON.stringify(c.introSub)} */
  const FS_INTRO_LABEL       = ${JSON.stringify(c.introLabel)};
  const FS_OUTRO_LABEL       = ${JSON.stringify(c.outroLabel)};
  const FS_TOTALWIN_LABEL    = ${JSON.stringify(c.totalWinLabel)};
  const FS_INTRO_CTA         = ${JSON.stringify(c.introCta)};
  const FS_OUTRO_CTA         = ${JSON.stringify(c.outroCta)};
  const FS_INTRO_SUB         = ${JSON.stringify(c.introSub)};
  const FS_SPIN_BREATH_MS    = ${c.spinBreathMs};
  const FS_ENTER_ACTIVE_MS   = ${c.enterActiveDelayMs};
  const FS_TOAST_MS          = ${c.toastMs};
  const FS_RETRIGGER_TOAST_MS = ${c.retriggerToastMs};
  const FS_FEATURE_FADEIN_MS = ${c.featureFadeInMs};
  const FS_FEATURE_HIDE_MS   = ${c.featureHideMs};
  const FS_BIGWIN_SAFETY_MS  = ${c.bigWinSafetyMs};

  /* ─── FSM · phases: BASE → FS_INTRO → FS_ACTIVE → FS_OUTRO → BASE ────── */
  const FSM = {
    phase: "BASE",
    spinsTotal: 0,
    spinsRemaining: 0,
    mult: 1,
    totalWin: 0,
    retrigCount: 0,
  };
  if (typeof window !== "undefined") window.FSM = FSM;

  /* Cached DOM handles for the FS UI — looked up once at boot. */
  const fsHud      = document.getElementById("fsHud");
  const fsHudSpins = document.getElementById("fsHudSpins");
  const fsHudMult  = document.getElementById("fsHudMult");
  const fsHudTotal = document.getElementById("fsHudTotal");
  const fsToast    = document.getElementById("fsToast");
  const fsOverlay  = document.getElementById("fsOverlay");
  const fsPlacardEyebrow = document.getElementById("fsPlacardEyebrow");
  const fsPlacardTitle   = document.getElementById("fsPlacardTitle");
  const fsPlacardSpins   = document.getElementById("fsPlacardSpins");
  const fsPlacardSub     = document.getElementById("fsPlacardSub");
  const fsPlacardCta     = document.getElementById("fsPlacardCta");

  function FSM_renderHud() {
    if (!fsHud) return;
    const consumed = FSM.spinsTotal - FSM.spinsRemaining;
    fsHudSpins.textContent = consumed + " / " + FSM.spinsTotal;
    fsHudMult.textContent  = "×" + (FSM.mult || 1);
    fsHudTotal.textContent = FSM.totalWin.toFixed(2);
  }

  function FSM_showFsMode() {
    const FS_MODE_WHITELIST = new Set(["purple", "gold", "crimson"]);
    const raw = String(FREESPINS.bgMode || "purple").toLowerCase();
    const mode = FS_MODE_WHITELIST.has(raw) ? raw : "purple";
    document.body.classList.remove("fs-mode-purple", "fs-mode-gold", "fs-mode-crimson");
    document.body.classList.add("fs-mode-" + mode);
    if (fsHud) {
      fsHud.classList.add("fs-hud--active");
      fsHud.setAttribute("aria-hidden", "false");
    }
  }

  function FSM_hideFsMode() {
    document.body.classList.remove("fs-mode-purple", "fs-mode-gold", "fs-mode-crimson");
    if (fsHud) {
      fsHud.classList.remove("fs-hud--active");
      fsHud.setAttribute("aria-hidden", "true");
    }
  }

  function FSM_showOverlay() {
    if (!fsOverlay) return;
    fsOverlay.classList.add("fs-overlay--show");
    fsOverlay.setAttribute("aria-hidden", "false");
  }
  function FSM_hideOverlay() {
    if (!fsOverlay) return;
    fsOverlay.classList.remove("fs-overlay--show");
    fsOverlay.setAttribute("aria-hidden", "true");
  }

  function FSM_showToast(text, duration) {
    if (!fsToast) return;
    fsToast.textContent = text;
    fsToast.classList.add("fs-toast--show");
    fsToast.setAttribute("aria-hidden", "false");
    clearTimeout(fsToast._t);
    fsToast._t = setTimeout(() => {
      fsToast.classList.remove("fs-toast--show");
      fsToast.setAttribute("aria-hidden", "true");
    }, duration || FS_TOAST_MS);
  }

  function FSM_enterIntro(spinsAwarded, scatterCount) {
    const n = Number.isFinite(spinsAwarded) ? Math.max(0, Math.floor(spinsAwarded)) : 0;
    if (n === 0) { FSM_enterBase(); return; }
    /* FIX-8 H5 (2026-06-19) — H&W ↔ FS mutual-exclusive invariant.
     * Industry baseline: FS cannot start while H&W is running. The
     * H&W round owns the screen until summary; queuing FS to start
     * after H&W ends is OUT OF SCOPE for this gate (it would require
     * deferred-trigger semantics). The simple correct behavior is to
     * REJECT the FS trigger; orchestrator must re-deliver after H&W
     * ends if game design requires deferred FS. Defense-in-depth. */
    if (typeof window !== 'undefined' && window.HW_STATE && window.HW_STATE.active === true) {
      try { if (typeof console !== 'undefined' && console.warn) console.warn('[FS] entry rejected — H&W round is active (mutual-exclusive invariant)'); } catch (_) {}
      return;
    }
    FSM.phase = "FS_INTRO";
    setStageBadge("fs", STAGE_FS_LABEL);
    FSM.spinsTotal = n;
    FSM.spinsRemaining = n;
    FSM.mult = (FREESPINS.multiplier && FREESPINS.multiplier.start) || 1;
    FSM.totalWin = 0;
    FSM.retrigCount = 0;
    /* HookBus: notify every block (multiplier orb resets BONUS_MULTIPLIER,
       sticky/walking wilds clear collection, hold-and-win clears board,
       persistent multiplier resets to baseline). HookBus.resetMult() returns
       the payout multiplier to FSM.mult baseline. */
    if (typeof HookBus !== 'undefined') {
      HookBus.resetMult();
      HookBus.setMult(FSM.mult);
      /* UQ-MASTERY-2 (2026-06-21) — canonical alias chain so reserved
       * listeners (simultaneousFsHoldAndWinPriority, linkedReels) actually
       * receive the start signal. Emit ARMED first so deferring blocks can
       * intercept BEFORE the FSM commits, then ENTER + TRIGGER + START so
       * any of the four legacy aliases routes to a real owner. All four
       * carry the same payload — listeners can pick whichever they pinned. */
      try { HookBus.emit('onFsTriggerArmed', { award: spinsAwarded, scatters: scatterCount }); } catch (_) {}
      HookBus.emit('onFsTrigger',  { award: spinsAwarded, scatters: scatterCount });
      try { HookBus.emit('onFsEnter', { award: spinsAwarded, scatters: scatterCount }); } catch (_) {}
      try { HookBus.emit('onFsStart', { award: spinsAwarded, scatters: scatterCount }); } catch (_) {}
    }

    /* 2026-06-18 — Boki rule "ne želim nigde brojač koliko je scattera
     * palo". FS intro placard eyebrow stays generic ("YOU TRIGGERED")
     * regardless of how many scatters landed. Industry baseline leads
     * with the AWARDED COUNT (spins granted), not the trigger ladder
     * math — scatter count is regulator audit data, never player-facing
     * copy. */
    fsPlacardEyebrow.textContent = "YOU TRIGGERED";
    fsPlacardTitle.textContent   = ((FREESPINS.introLabel || FS_INTRO_LABEL) + "").toUpperCase();
    fsPlacardSpins.textContent   = String(spinsAwarded);
    fsPlacardSub.textContent     = FS_INTRO_SUB;
    fsPlacardCta.textContent     = FS_INTRO_CTA;

    spinButton && (spinButton.disabled = true);
    devFsBtn   && (devFsBtn.disabled   = true);
    statusElGlobal && (statusElGlobal.textContent = "FS · READY");

    /* H5.18 — hide reel frame BEFORE the overlay shows so the player
     * never sees the base-game grid blur through the placard. Reels
     * fade back in on FSM_enterActive (TAP TO BEGIN). */
    document.body.classList.remove('is-feature-intro-fadein');
    document.body.classList.add('is-feature-intro-active');

    FSM_showOverlay();
  }

  function FSM_enterActive() {
    FSM.phase = "FS_ACTIVE";
    setStageBadge("fs", STAGE_FS_LABEL);
    FSM_hideOverlay();
    /* H5.18 — TAP TO BEGIN tapped. Swap the hide class for the fadein
     * twin and let the keyframe animation play. After the animation
     * completes, clear the class so future intros start from a clean slate. */
    document.body.classList.remove('is-feature-intro-active');
    document.body.classList.add('is-feature-intro-fadein');
    /* FsMode swap (theme background) lands inside the fadein window
     * so the player experiences a single coordinated reveal. */
    FSM_showFsMode();
    FSM_renderHud();
    setTimeout(function () {
      document.body.classList.remove('is-feature-intro-fadein');
    }, FS_FEATURE_FADEIN_MS);
    spinButton && (spinButton.disabled = true);
    devFsBtn   && (devFsBtn.disabled   = true);
    setTimeout(FSM_runNextFsSpin, FS_ENTER_ACTIVE_MS);
  }

  function FSM_runNextFsSpin() {
    if (FSM.phase !== "FS_ACTIVE") return;
    /* Wave T4 guard — same race as runOneBaseSpin (engine-block.mjs). If a
       previous FS spin is still in flight (startSpinAll allReelsActive=true
       or runStaticReroll staticRerollInFlight=true), bail before emitting
       preSpin so the reelEngine preSpin listener doesn't clear the live
       stopTimerId of the running spin and leave reels stuck blurring. */
    const inFlightFs =
      (UNIFORM_REEL_KINDS.has(SHAPE.kind) && RECT_REELS)
        ? !!(typeof allReelsActive !== 'undefined' && allReelsActive)
        : !!(typeof staticRerollInFlight !== 'undefined' && staticRerollInFlight);
    if (inFlightFs) return;
    cancelWinSymCycle();
    statusElGlobal && (statusElGlobal.textContent =
      "FS · " + ((FSM.spinsTotal - FSM.spinsRemaining) + 1) + " / " + FSM.spinsTotal);

    if (UNIFORM_REEL_KINDS.has(SHAPE.kind) && RECT_REELS) {
      startSpinAll(() => {
        /* HookBus: onFsSpinResult → blocks that escalate per FS spin
           (progressive mult, persistent mult, multiplier-orb-bonus). */
        if (typeof HookBus !== 'undefined') {
          HookBus.emit('onFsSpinResult', { chainIndex: 0 });
        }
        handlePostSpin(true);
      });
    } else {
      runStaticReroll(() => {
        if (typeof HookBus !== 'undefined') {
          HookBus.emit('onFsSpinResult', { chainIndex: 0 });
        }
        handlePostSpin(true);
      });
    }
  }

  function FSM_handleRetrigger(extraSpins) {
    const n = Number.isFinite(extraSpins) ? Math.max(0, Math.floor(extraSpins)) : 0;
    if (n === 0) return;
    FSM.spinsTotal += n;
    FSM.spinsRemaining += n;
    FSM.retrigCount++;
    FSM_renderHud();
    FSM_showToast("+" + n + " FREE SPINS", FS_RETRIGGER_TOAST_MS);
    /* W47.S20 — pulse + glow on the spins counter so the player's eye
     * is drawn to the HUD update simultaneously with the +N toast.
     * Single class toggle, single cleanup timer; no extra DOM. The
     * CSS keyframe self-resolves at 700ms but we re-add via class so
     * back-to-back retriggers restart cleanly (animation-name swap).
     * prefers-reduced-motion suppresses the visual via CSS gate above. */
    if (fsHudSpins) {
      fsHudSpins.classList.remove("fs-hud__value--retrig");
      /* Force reflow so the animation restarts on consecutive retriggers
       * (Chromium/Safari need a layout tick between class remove + add). */
      void fsHudSpins.offsetWidth;
      fsHudSpins.classList.add("fs-hud__value--retrig");
      clearTimeout(fsHudSpins._pulseT);
      fsHudSpins._pulseT = setTimeout(function () {
        fsHudSpins.classList.remove("fs-hud__value--retrig");
      }, 720);
    }
    /* FIX-4 (deep QA #17, 2026-06-19) — guarantee onFsRetrigger reaches
     * downstream subscribers (fsReelHeightEscalation, retriggerMeter,
     * retriggerMultiplierBump) even when superchargedFs block is NOT
     * in the build.
     *
     * Original LEGO discipline: superchargedFs owns the emit via
     * superchargedFsAnnounceRetrigger() helper. But if that block isn't
     * enabled in the GDD, the event was silently lost — every FS-retrigger
     * subscriber stopped working. Soft-dependency on a sibling block
     * violates LEGO universality.
     *
     * Hardening: prefer superchargedFs's helper when present (so its
     * re-entrancy guard owns the emit), fall through to a direct emit
     * otherwise. Either path produces exactly one onFsRetrigger per
     * retrigger event. */
    try {
      if (typeof window !== 'undefined'
          && typeof window.superchargedFsAnnounceRetrigger === 'function') {
        window.superchargedFsAnnounceRetrigger();
      } else if (typeof HookBus !== 'undefined'
                 && typeof HookBus.emit === 'function') {
        HookBus.emit('onFsRetrigger', { extraSpins: n, retriggerIndex: FSM.retrigCount });
      }
    } catch (_) {}
  }

  function FSM_enterOutro() {
    FSM.phase = "FS_OUTRO";
    setStageBadge("fs", STAGE_FS_LABEL);
    /* HookBus: onFsEnd → blocks that snapshot final state (hold-and-win
       reveal, sticky harvest, persistent multiplier final tally). */
    if (typeof HookBus !== 'undefined') {
      HookBus.emit('onFsEnd', { totalWin: FSM.totalWin });
    }
    fsPlacardEyebrow.textContent = ((FREESPINS.outroLabel || FS_OUTRO_LABEL) + "").toUpperCase();
    fsPlacardTitle.textContent   = FS_TOTALWIN_LABEL;
    fsPlacardSpins.textContent   = FSM.totalWin.toFixed(2);
    fsPlacardSub.textContent     = FSM.retrigCount > 0
      ? FSM.retrigCount + " retrigger" + (FSM.retrigCount === 1 ? "" : "s") +
        " across " + FSM.spinsTotal + " spins."
      : FSM.spinsTotal + " spins played.";
    fsPlacardCta.textContent     = FS_OUTRO_CTA;
    statusElGlobal && (statusElGlobal.textContent = "FS · COMPLETE");

    FSM_showOverlay();
  }

  function FSM_enterBase() {
    /* H5.18 defensive — if any intro-hide class survived (e.g. session
     * skip / out-of-band state transition), strip it on base entry so
     * the reel frame is never left invisible. */
    document.body.classList.remove('is-feature-intro-active', 'is-feature-intro-fadein');
    /* H5.16 — Boki rule 05.06.2026: "kad se vratim iz FS bonusa, treba
     * da bude ako postoji uslov za big win, onda mora big win da se
     * pokaze, ako postoji uslov za bilo koji win onda mora da se pokaze,
     * dakle isto win animacija counter itd."
     *
     * Capture the FS aggregate BEFORE we touch state. If it qualifies for
     * any win (>0), kick the post-FS presentation chain. Spin button stays
     * disabled until the chain resolves so the player can't accidentally
     * launch a new spin on top of the big-win banner / rollup counter. */
    var __fsTotalWin = (FSM && Number.isFinite(FSM.totalWin)) ? FSM.totalWin : 0;
    FSM.phase = "BASE";
    setStageBadge("base", STAGE_BASE_LABEL);
    FSM_hideOverlay();
    FSM_hideFsMode();
    devFsBtn   && (devFsBtn.disabled   = !FREESPINS.enabled);
    statusElGlobal && (statusElGlobal.textContent = "PRESS SPIN");

    if (__fsTotalWin > 0 && typeof window !== 'undefined' && typeof window.presentExternalWin === 'function') {
      /* Hold the spin button until the post-FS presentation closes.
       * bigWinTier banner fires onBigWinTierEnd at the very end of a
       * compound walkthrough (or skip); regular wins resolve immediately
       * once presentExternalWin's promise settles. */
      spinButton && (spinButton.disabled = true);
      var __reEnable = function () {
        spinButton && (spinButton.disabled = false);
      };
      var __postFsCleanup = function () {
        if (typeof window === 'undefined' || !window.HookBus) { __reEnable(); return; }
        var bwActive = !!(window.BIG_WIN_TIER_STATE && window.BIG_WIN_TIER_STATE.walkActive);
        if (bwActive) {
          var __safety = null;
          var __cleanup = function () {
            if (window.HookBus && typeof window.HookBus.off === 'function') window.HookBus.off('onBigWinTierEnd', onBwEnd);
            if (__safety !== null) clearTimeout(__safety);
          };
          var onBwEnd = function () {
            __cleanup();
            __reEnable();
          };
          window.HookBus.on('onBigWinTierEnd', onBwEnd);
          /* Safety floor: re-enable after 30s no-matter-what, so a missed
           * onBigWinTierEnd doesn't permanently lock the spin CTA. */
          __safety = setTimeout(function () { __cleanup(); __reEnable(); }, FS_BIGWIN_SAFETY_MS);
        } else {
          __reEnable();
        }
      };
      try {
        var p = window.presentExternalWin(__fsTotalWin);
        if (p && typeof p.then === 'function') p.then(__postFsCleanup, __postFsCleanup);
        else __postFsCleanup();
      } catch (_) {
        __reEnable();
      }
    } else {
      spinButton && (spinButton.disabled = false);
    }
  }

  /* Placard CTA — advances the FSM. */
  if (fsPlacardCta) {
    fsPlacardCta.addEventListener("click", () => {
      if (FSM.phase === "FS_INTRO") FSM_enterActive();
      else if (FSM.phase === "FS_OUTRO") FSM_enterBase();
    });
  }

  /* 2026-06-10 (Boki: "ultimativno detaljan QA svakog grida") — expose a
   * QA-only hard exit that collapses any FS lifecycle straight back to
   * BASE without running every remaining FS spin. The grid matrix walker
   * uses this on high-scatter shapes (rectangular_stacked_scatter,
   * variable_reel) where natural retrigger chains can run 30+ spins —
   * forcing the round to settle for the STATE/NO_ERRORS assertions.
   * Production code path (CTA click + organic round end) is untouched. */
  if (typeof window !== "undefined") {
    window.fsHardExit = function () {
      try {
        if (FSM.phase === "FS_INTRO") {
          FSM_enterOutro();
          FSM_enterBase();
        } else if (FSM.phase === "FS_ACTIVE") {
          FSM.spinsRemaining = 0;
          FSM_enterOutro();
          FSM_enterBase();
        } else if (FSM.phase === "FS_OUTRO") {
          FSM_enterBase();
        }
        /* Clear any in-flight presentation flags so STATE assertion can
         * confirm a clean idle round. Production code never reaches
         * fsHardExit, so resetting these is QA-only. */
        try { window.__SLOT_WIN_PRESENT_ACTIVE__ = false; } catch (_) {}
        try {
          var sb = document.getElementById("spinBtn");
          if (sb) {
            sb.classList.remove("is-spinning");
            sb.disabled = false;
          }
        } catch (_) {}
        try {
          var ovs = document.querySelectorAll(
            ".fs-overlay, .fs-overlay-cta, [data-fs-overlay]"
          );
          ovs.forEach(function (el) {
            if (el && el.dataset) el.dataset.show = "false";
            if (el && el.style) el.style.display = "none";
          });
        } catch (_) {}
      } catch (_) { /* defensive */ }
      return (FSM && FSM.phase) || "BASE";
    };
  }

  /* Wave S LEGO conformance — freeSpins registers postSpin to react to
     external round-control signals (winCap hard-cap during FS, scheduled
     forced outro from operator console). When winCap has tripped during an
     FS spin, we early-exit the FSM to the outro placard so the player gets
     immediate closure on the MAX WIN moment. */
  if (typeof HookBus !== 'undefined') {
    HookBus.on('postSpin', (p) => {
      if (!p || !p.duringFs) return;
      if (typeof window !== 'undefined' && window.__WIN_CAP_TRIPPED__ === true) {
        /* winCap block sets this flag when cumulative payout has reached
           the GDD-declared cap. Closing the FS round now prevents the
           remaining spins from accidentally exceeding the cap. */
        if (FSM.phase === 'FS_ACTIVE' && FSM.spinsRemaining > 0) {
          FSM.spinsRemaining = 0;
          FSM_enterOutro();
        }
      }
    }, { priority: -30 });
    /* FS lifecycle telemetry — used by playground inspector + dev FS panel
       to verify event sequencing without polluting the round logic. */
    HookBus.on('onFsTrigger', (p) => {
      if (typeof window !== 'undefined') {
        window.__FS_LAST_TRIGGER__ = { ts: Date.now(), award: p && p.award, scatters: p && p.scatters };
      }
    }, { priority: -30 });

    /* Wave V6 — react to force-skip during FS intro / outro overlays.
       'fsIntro' → advance from FS_INTRO to FS_ACTIVE (same as CTA click).
       'fsOutro' → advance from FS_OUTRO to BASE (same as CTA click).
       Emit matching onSkipComplete so the forceSkip block hides the
       button and clears window.__SLOT_SKIPPED__. */
    HookBus.on('onSkipRequested', (payload) => {
      if (!payload) return;
      const phase = payload.phase;
      if (phase !== 'fsIntro' && phase !== 'fsOutro') return;
      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (phase === 'fsIntro' && FSM.phase === 'FS_INTRO') {
        FSM_enterActive();
      } else if (phase === 'fsOutro' && FSM.phase === 'FS_OUTRO') {
        FSM_enterBase();
      } else {
        /* Phase mismatch — silently no-op but still emit Complete so the
           UI doesn't deadlock on a stuck skip flag. */
      }
      const duration = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);
      HookBus.emit('onSkipComplete', { phase: phase, duration });
    });
  }
`;
}
