/**
 * Slot GDD Factory · postSpin BLOCK
 *
 * Emits the orchestration function called after every reel settles:
 *
 *   handlePostSpin(duringFs)
 *     1. Count visible trigger symbols (countTriggerSymbols)
 *     2. BASE + trigger? → settle pause → scatter celebration → FSM intro
 *     3. BASE + no trigger? → win-symbol highlight + re-enable spin button
 *     4. FS + retrigger? → FSM_handleRetrigger (capped at 3 chains)
 *     5. FS + every spin → progressive multiplier bump + fake-win accrual +
 *        win-symbol cycle + chain into next FS spin or FS_OUTRO
 *
 * GDD-driven configuration (consumed from `model.postSpin`):
 *   settlePauseMs        number ms — pause before celebration (organic)  (default 200)
 *   forcedSettlePauseMs  number ms — pause before celebration (dev FS)   (default 350)
 *   retriggerCap         number — max retrigger chains per round         (default 3)
 *   fsSpinBreathMs       number ms — breath before next FS spin          (default 250)
 *   fakeWinChance        number in [0,1] — chance a placeholder spin pays (default 0.4)
 *   fakeWinMaxX          number — placeholder fake-win max (×bet)        (default 25)
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitPostSpinRuntime(cfg)  → runtime JS string
 *
 * Runtime dependencies: FREESPINS, FSM, FORCE_TRIGGER, devFsBtn, spinButton,
 *   applyWinHighlight, clearWinHighlight, playScatterCelebration,
 *   FSM_enterIntro, FSM_runNextFsSpin, FSM_handleRetrigger, FSM_enterOutro,
 *   FSM_renderHud, countTriggerSymbols, spinsForCount.
 */

const DEFAULTS = Object.freeze({
  settlePauseMs: 200,
  forcedSettlePauseMs: 350,
  retriggerCap: 3,
  fsSpinBreathMs: 250,
  fakeWinChance: 0.4,
  fakeWinMaxX: 25,
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}
function clampFloat(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return v;
}

export function resolveConfig(model) {
  const cfg = defaultConfig();
  const src = (model && model.postSpin) || {};
  const intMap = [
    ['settlePauseMs',       0, 2000],
    ['forcedSettlePauseMs', 0, 2000],
    ['retriggerCap',        0,   10],
    ['fsSpinBreathMs',      0, 2000],
    ['fakeWinMaxX',         0, 1000],
  ];
  for (const [k, lo, hi] of intMap) {
    if (k in src) {
      const v = clampInt(src[k], lo, hi);
      if (v !== null) cfg[k] = v;
    }
  }
  if ('fakeWinChance' in src) {
    const v = clampFloat(src.fakeWinChance, 0, 1);
    if (v !== null) cfg.fakeWinChance = v;
  }
  return cfg;
}

export function emitPostSpinRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ postSpin: cfg });
  return `
  /* ── postSpin BLOCK — emitted by src/blocks/postSpin.mjs ───────────────
     GDD knobs baked at build time:
       settlePauseMs        = ${c.settlePauseMs}
       forcedSettlePauseMs  = ${c.forcedSettlePauseMs}
       retriggerCap         = ${c.retriggerCap}
       fsSpinBreathMs       = ${c.fsSpinBreathMs}
       fakeWinChance        = ${c.fakeWinChance}
       fakeWinMaxX          = ${c.fakeWinMaxX}

     Post-spin orchestration. Called from both base-game spins and FS
     in-round spins; the duringFs flag decides whether a scatter hit is a
     fresh trigger (BASE) or a retrigger (FS). */
  function handlePostSpin(duringFs) {
    /* Win-highlight gating (Boki rule): scatter celebration and win-symbol
       highlight must never play simultaneously. During FS lifecycle
       (FS_INTRO → FS_ACTIVE → FS_OUTRO) win-highlight is fully suppressed;
       it resumes only after the round returns to BASE. */
    if (!FREESPINS.enabled) {
      applyWinHighlight();
      if (duringFs) FSM_runNextFsSpin();
      return;
    }
    const scatters = countTriggerSymbols();
    if (!duringFs) {
      const award = spinsForCount(scatters);
      if (award > 0) {
        /* Trigger flow — scatter celebration owns the visual stage.
           Sequence: reels settle (done) → settle pause → clearWinHighlight
           → scatter celebration (~1500ms) → FSM_enterIntro. */
        const wasForced = !!FORCE_TRIGGER;
        FORCE_TRIGGER = null;   /* one-shot — clear so next spin is normal */
        const settlePause = wasForced ? ${c.forcedSettlePauseMs} : ${c.settlePauseMs};
        setTimeout(() => {
          clearWinHighlight();
          playScatterCelebration().then(() => {
            FSM_enterIntro(award, scatters);
          });
        }, settlePause);
      } else {
        /* Plain BASE-game spin, no trigger → safe to play win-highlight. */
        applyWinHighlight();
        FORCE_TRIGGER = null;
        if (devFsBtn) devFsBtn.disabled = !FREESPINS.enabled;
        if (spinButton) spinButton.disabled = false;
      }
      return;
    }
    /* During FS: check for retrigger. Industry-standard cap at ${c.retriggerCap}
       chains per round (most operators cap retrigger chains at 2-5).
       Boki rule (Wave Q): retrigger must play the SAME scatter celebration
       as a fresh trigger — settle pause → clearWinHighlight → 1500ms gold
       pulse → toast/handleRetrigger. Pre-rule: just toast, no pulse. */
    const RETRIGGER_CAP = ${c.retriggerCap};
    const _isRetrigger = FREESPINS.retrigger && FREESPINS.retrigger.enabled &&
        scatters >= FREESPINS.retrigger.count &&
        FSM.retrigCount < RETRIGGER_CAP;
    if (_isRetrigger) {
      const _retrigPause = !!FORCE_TRIGGER ? ${c.forcedSettlePauseMs} : ${c.settlePauseMs};
      FORCE_TRIGGER = null;
      /* This-spin's countdown still applies. Multiplier still escalates. */
      FSM.spinsRemaining--;
      if (FREESPINS.multiplier && FREESPINS.multiplier.type === "progressive") {
        FSM.mult = Math.min(FSM.mult + FREESPINS.multiplier.step, FREESPINS.multiplier.cap);
      }
      FSM_renderHud();
      setTimeout(() => {
        clearWinHighlight();
        const _celeb = (typeof playScatterCelebration === 'function')
          ? playScatterCelebration()
          : Promise.resolve();
        _celeb.then(() => {
          FSM_handleRetrigger(FREESPINS.retrigger.spins);
          /* After retrigger toast — chain into next FS spin (or outro if 0). */
          setTimeout(() => {
            if (FSM.spinsRemaining <= 0) FSM_enterOutro();
            else FSM_runNextFsSpin();
          }, ${c.fsSpinBreathMs});
        });
      }, _retrigPause);
      return;
    }
    /* Progressive multiplier escalation — bump on every FS spin that doesn't
       blow the cap, regardless of win/loss. */
    if (FREESPINS.multiplier && FREESPINS.multiplier.type === "progressive") {
      FSM.mult = Math.min(FSM.mult + FREESPINS.multiplier.step, FREESPINS.multiplier.cap);
    }
    /* Placeholder per-spin "win" — pure visual filler until the math layer
       lands. ${(c.fakeWinChance * 100).toFixed(0)}% chance, max ${c.fakeWinMaxX}× bet (weighted toward zero). */
    const fakeWin = Math.random() < ${c.fakeWinChance}
      ? +(Math.random() * ${c.fakeWinMaxX} * (FSM.mult || 1)).toFixed(2)
      : 0;
    FSM.totalWin += fakeWin;

    FSM.spinsRemaining--;
    FSM_renderHud();

    /* Win-symbol cycle inside FS_ACTIVE (Boki rule). Run the same per-
       symbol event cycle as in BASE, then chain into the next FS spin
       (or FS_OUTRO if this was the last spin). */
    const tail = () => {
      if (FSM.spinsRemaining <= 0) {
        FSM_enterOutro();
      } else {
        setTimeout(FSM_runNextFsSpin, ${c.fsSpinBreathMs});
      }
    };
    applyWinHighlight().then(tail);
  }
`;
}
