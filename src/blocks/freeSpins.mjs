/**
 * Slot GDD Factory · freeSpins BLOCK
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
});

export function defaultConfig() {
  return { ...DEFAULTS };
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
  const cfg = defaultConfig();
  const src = (model && model.freeSpinsPresentation) || {};

  if (src.enabled === false) cfg.enabled = false;
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
  top: 10px;
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
  font-size: 0.55rem;
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
  top: 70px;
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
  z-index: 200;
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
  return `<!-- Free Spins HUD — rendered always; toggled visible via .fs-hud--active. -->
<div class="fs-hud" id="fsHud" aria-hidden="true">
  <div class="fs-hud__box">
    <div class="fs-hud__label">Spins</div>
    <div class="fs-hud__value" id="fsHudSpins">0 / 0</div>
  </div>
  <div class="fs-hud__divider"></div>
  <div class="fs-hud__box">
    <div class="fs-hud__label">Mult</div>
    <div class="fs-hud__value" id="fsHudMult">×1</div>
  </div>
  <div class="fs-hud__divider"></div>
  <div class="fs-hud__box">
    <div class="fs-hud__label">Total</div>
    <div class="fs-hud__value" id="fsHudTotal">0.00</div>
  </div>
</div>`;
}

export function emitFreeSpinsToastMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ freeSpinsPresentation: cfg });
  if (!c.enabled) return '';
  return `<!-- Retrigger / award toast — animates in & out on +N FS event. -->
<div class="fs-toast" id="fsToast" aria-hidden="true">+0 FREE SPINS</div>`;
}

export function emitFreeSpinsOverlayMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ freeSpinsPresentation: cfg });
  if (!c.enabled) return '';
  return `<!-- Free Spins full-stage overlay — intro & outro placards. -->
<div class="fs-overlay" id="fsOverlay" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="fs-placard">
    <div class="fs-placard__eyebrow" id="fsPlacardEyebrow">YOU TRIGGERED</div>
    <div class="fs-placard__title" id="fsPlacardTitle">${esc(c.introLabel)}</div>
    <div class="fs-placard__spins" id="fsPlacardSpins">10</div>
    <div class="fs-placard__sub" id="fsPlacardSub">${esc(c.introSub)}</div>
    <button class="fs-placard__cta" id="fsPlacardCta" type="button">${esc(c.introCta)}</button>
  </div>
</div>`;
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
    const mode = (FREESPINS.bgMode || "purple").toLowerCase();
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
    FSM.phase = "FS_INTRO";
    setStageBadge("fs", STAGE_FS_LABEL);
    FSM.spinsTotal = spinsAwarded;
    FSM.spinsRemaining = spinsAwarded;
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
      HookBus.emit('onFsTrigger', { award: spinsAwarded, scatters: scatterCount });
    }

    fsPlacardEyebrow.textContent = scatterCount
      ? scatterCount + " SCATTERS TRIGGERED"
      : "YOU TRIGGERED";
    fsPlacardTitle.textContent   = ((FREESPINS.introLabel || FS_INTRO_LABEL) + "").toUpperCase();
    fsPlacardSpins.textContent   = String(spinsAwarded);
    fsPlacardSub.textContent     = FS_INTRO_SUB;
    fsPlacardCta.textContent     = FS_INTRO_CTA;

    spinButton && (spinButton.disabled = true);
    devFsBtn   && (devFsBtn.disabled   = true);
    statusElGlobal && (statusElGlobal.textContent = "FS · READY");

    FSM_showOverlay();
  }

  function FSM_enterActive() {
    FSM.phase = "FS_ACTIVE";
    setStageBadge("fs", STAGE_FS_LABEL);
    FSM_hideOverlay();
    FSM_showFsMode();
    FSM_renderHud();
    spinButton && (spinButton.disabled = true);
    devFsBtn   && (devFsBtn.disabled   = true);
    setTimeout(FSM_runNextFsSpin, FS_ENTER_ACTIVE_MS);
  }

  function FSM_runNextFsSpin() {
    if (FSM.phase !== "FS_ACTIVE") return;
    cancelWinSymCycle();
    statusElGlobal && (statusElGlobal.textContent =
      "FS · " + ((FSM.spinsTotal - FSM.spinsRemaining) + 1) + " / " + FSM.spinsTotal);

    /* HookBus: preSpin → blocks that arm per-spin state (anticipation,
       wild placement) run before the engine kicks. */
    if (typeof HookBus !== 'undefined') {
      HookBus.emit('preSpin', { duringFs: true });
    }
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
    FSM.spinsTotal += extraSpins;
    FSM.spinsRemaining += extraSpins;
    FSM.retrigCount++;
    FSM_renderHud();
    FSM_showToast("+" + extraSpins + " FREE SPINS", FS_RETRIGGER_TOAST_MS);
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
    FSM.phase = "BASE";
    setStageBadge("base", STAGE_BASE_LABEL);
    FSM_hideOverlay();
    FSM_hideFsMode();
    spinButton && (spinButton.disabled = false);
    devFsBtn   && (devFsBtn.disabled   = !FREESPINS.enabled);
    statusElGlobal && (statusElGlobal.textContent = "PRESS SPIN");
  }

  /* Placard CTA — advances the FSM. */
  if (fsPlacardCta) {
    fsPlacardCta.addEventListener("click", () => {
      if (FSM.phase === "FS_INTRO") FSM_enterActive();
      else if (FSM.phase === "FS_OUTRO") FSM_enterBase();
    });
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
  }
`;
}
