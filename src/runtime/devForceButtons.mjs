/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  src/runtime/devForceButtons.mjs
 *
 *  Purpose
 *  ───────
 *    Extracted runtime for the three QA / dev force buttons:
 *      • #devFsBtn   — forces a real spin into the FS-trigger outcome
 *      • #devBwBtn   — forces a real spin that crosses the top big-win tier
 *      • #devMultBtn — sets HookBus.setMult(value) then spins (cycle ladder)
 *
 *    Lives outside `src/blocks/` because these are QA infrastructure (not
 *    player-facing features). They get emitted only when the host markup
 *    declares the corresponding buttons (`themeCSS.mjs` controls visibility
 *    via host theme; we never assume the buttons are present and gate every
 *    handler attach on `if (btn)` defensively).
 *
 *  Industry rule alignment (Boki 05.06.2026)
 *  ─────────────────────────────────────────
 *    `rule_force_buttons_real_spin`: every force button MUST spin the reels
 *    (call `runOneBaseSpin()` with a one-shot flag the engine + presenter
 *    consume). Never shortcut into a synthetic banner. All three handlers
 *    here obey that rule:
 *      • FS  → sets `FORCE_TRIGGER = { scatterCount }` then `runOneBaseSpin()`
 *      • BW  → sets `window.__FORCE_BIG_WIN_TIER__ = maxTier` then spin
 *      • Mlt → calls `HookBus.setMult(value)` then `runOneBaseSpin()`
 *
 *  Public API
 *  ──────────
 *    resolveDevForceButtonsConfig(model) -> { hasMultFeature: boolean }
 *        Inspects the parsed model and decides whether the multiplier button
 *        should be live-enabled. Defensive on missing / malformed features.
 *
 *    emitDevForceButtonsRuntime(model) -> string
 *        Emits the three IIFE-guarded click-handler blocks. Must be emitted
 *        AFTER:
 *          • `devFsBtn` lookup line in the host (the variable is declared
 *            once upstream so the FS handler shares scope with status badge)
 *          • `emitPostSpinRuntime` / `emitFreeSpinsRuntime`
 *          • `spinButton` lookup
 *          • HookBus runtime (handlers register on `.on('postSpin', …)` and
 *            `.on('onBigWinTierEnd', …)`)
 *
 *  Composition contract
 *  ────────────────────
 *    Reads at runtime: `FREESPINS`, `FSM`, `FORCE_TRIGGER`, `spinButton`,
 *      `runOneBaseSpin`, `window.HookBus`, `window.BIG_WIN_TIER_STATE`.
 *    Writes at runtime: `FORCE_TRIGGER`, `window.__FORCE_BIG_WIN_TIER__`,
 *      `HookBus.setMult(value)`. Never mutates DOM beyond toggling the
 *      buttons' `disabled` attribute + `textContent` (mult cycle label).
 *
 *  Performance
 *  ───────────
 *    Cold path. Each handler is a single `addEventListener` registration at
 *    init. Click handlers are < 50 LOC each, no inner loops.
 *
 *  Accessibility
 *  ─────────────
 *    Disabled toggling carries through to ARIA (browser default behavior).
 *    Buttons should still be reachable via keyboard; the markup layer
 *    handles focus styling.
 *
 *  Vendor neutrality
 *  ─────────────────
 *    Zero game / vendor mentions. Only abstract references to "multiplier
 *    block", "big-win tier", "FS trigger".
 *
 *  GDD keys read
 *  ─────────────
 *    `model.features[*].kind` — only to decide whether multiplier button
 *    should live-enable. No other model fields read.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * @typedef {object} DevForceButtonsConfig
 * @property {boolean} hasMultFeature — whether GDD declares a multiplier-style feature.
 */

/** @type {RegExp} */
const MULT_FEATURE_KINDS = /^(multiplier|multiplier[_-]?orb|persistent[_-]?multiplier|lightning|progressive[_-]?free[_-]?spins)$/i;

/**
 * Inspects the parsed model and returns the dev-force-button live config.
 * Defensive on missing `features`, non-string `kind`, etc.
 * @param {object} model
 * @returns {DevForceButtonsConfig}
 */
export function resolveDevForceButtonsConfig(model) {
  const m = (model && typeof model === 'object') ? model : {};
  const feats = Array.isArray(m.features) ? m.features : [];
  const hasMultFeature = feats.some(
    (f) => f && typeof f.kind === 'string' && MULT_FEATURE_KINDS.test(f.kind),
  );
  return { hasMultFeature: !!hasMultFeature };
}

/**
 * Emits the three force-button click-handler IIFE blocks as a single JS
 * string ready to splice into the orchestrator's `<script>` template.
 * @param {object} model
 * @returns {string}
 */
export function emitDevForceButtonsRuntime(model) {
  const cfg = resolveDevForceButtonsConfig(model);
  const hasMultJSON = JSON.stringify(cfg.hasMultFeature);
  return `
  /* ── Dev force buttons (extracted: src/runtime/devForceButtons.mjs) ── */

  /* Dev-only FS trigger — runs a real spin with the scatter outcome forced
     so the player sees the FULL trigger sequence: reels rotate, scatters
     land one by one with anticipation slowdown on the trigger reel, brief
     settle pause, THEN the cinematic intro placard fades in. */
  if (devFsBtn) {
    devFsBtn.disabled = !FREESPINS.enabled;
    devFsBtn.addEventListener("click", function () {
      if (FSM.phase !== "BASE" || !FREESPINS.enabled) return;
      var first = (FREESPINS.awards && FREESPINS.awards[0]) || { count: 3, spins: 10 };
      /* Disable both buttons immediately so a stray double-tap can't queue
         a second spin behind this one. They get re-enabled on
         FSM_enterBase (or by handlePostSpin if FS doesn't trigger). */
      devFsBtn.disabled = true;
      if (spinButton) spinButton.disabled = true;
      FORCE_TRIGGER = { scatterCount: first.count };
      runOneBaseSpin();
    });
  }

  /* Wave H5 — dev-only Big-Win force button. Per rule_force_buttons_real_spin
     (Boki 05.06.2026): force buttons MUST spin the reels, not shortcut into
     a synthetic banner. This click sets a one-shot
     window.__FORCE_BIG_WIN_TIER__ flag and kicks runOneBaseSpin(). The
     winPresentation block reads the flag and synthesises a pay event with
     payX big enough to cross that tier's GDD threshold; the normal cycle
     (rollup → onWinPresentationEnd → bigWinTier banner) then fires
     organically. Disabled when bigWinTier isn't enabled in the parsed model. */
  var devBwBtn = document.getElementById("devBwBtn");
  if (devBwBtn) {
    var bwEnabled = !!(window.BIG_WIN_TIER_STATE && window.BIG_WIN_TIER_STATE.enabled);
    devBwBtn.disabled = !bwEnabled;
    /* Always force the max tier so the block plays the full compound
       walkthrough tier 1 → … → final + emits onBigWinTierEnd. */
    devBwBtn.addEventListener("click", function () {
      if (!bwEnabled) return;
      if (FSM.phase !== "BASE") return;
      var maxTier = (window.BIG_WIN_TIER_STATE && Array.isArray(window.BIG_WIN_TIER_STATE.thresholds))
        ? window.BIG_WIN_TIER_STATE.thresholds.length : 5;
      devBwBtn.disabled = true;
      if (spinButton) spinButton.disabled = true;
      window.__FORCE_BIG_WIN_TIER__ = maxTier;
      runOneBaseSpin();
      /* Re-enable on onBigWinTierEnd (the WHOLE sequence completed,
         natural or skipped) so the next QA force-spin starts clean. */
      var reEnable = function () { if (devBwBtn) devBwBtn.disabled = !bwEnabled; };
      var oneShot = function () {
        if (window.HookBus && typeof window.HookBus.off === 'function') window.HookBus.off('onBigWinTierEnd', oneShot);
        reEnable();
      };
      if (window.HookBus && typeof window.HookBus.on === 'function') window.HookBus.on('onBigWinTierEnd', oneShot);
      setTimeout(reEnable, 30000);
    });
  }

  /* Wave I.2 — dev-only Multiplier force button. Boki rule 05.06.2026:
     "ako ima neka igra neki multiplier, onda da postoji dugme za taj force".
     Sets HookBus.setMult(value) BEFORE runOneBaseSpin so applyWinHighlight
     sees it on the first detector pass. Button enabled only if one of the
     multiplier-style feature blocks (multiplierOrb / persistentMultiplier /
     lightning / progressiveFreeSpins) is declared in the GDD. Cycles 2× →
     5× → 10× → 25× → 50× → 100× → 1× (reset). */
  var devMultBtn = document.getElementById("devMultBtn");
  if (devMultBtn) {
    var MULT_CYCLE = [2, 5, 10, 25, 50, 100, 1];
    var multIdx = 0;
    /* Baked at build time from the parsed GDD's feature list. */
    var HAS_MULT_FEATURE = ${hasMultJSON};
    function _multFeatureLive() { return HAS_MULT_FEATURE; }
    var multLive = _multFeatureLive();
    devMultBtn.disabled = !multLive;
    if (multLive) devMultBtn.textContent = "×" + MULT_CYCLE[multIdx];
    devMultBtn.addEventListener("click", function () {
      if (!_multFeatureLive()) return;
      if (FSM.phase !== "BASE") return;
      var val = MULT_CYCLE[multIdx];
      multIdx = (multIdx + 1) % MULT_CYCLE.length;
      devMultBtn.textContent = "×" + MULT_CYCLE[multIdx];
      if (window.HookBus && typeof window.HookBus.setMult === 'function') {
        window.HookBus.setMult(val);
      }
      devMultBtn.disabled = true;
      if (spinButton) spinButton.disabled = true;
      runOneBaseSpin();
      /* Re-enable on postSpin so the next force is available. Safety floor
         8 s in case postSpin is suppressed by a follow-on feature trigger
         (FS intro, big-win). */
      var reEnableMult = function () { if (devMultBtn) devMultBtn.disabled = !_multFeatureLive(); };
      var oneShotPS = function () {
        if (window.HookBus && typeof window.HookBus.off === 'function') window.HookBus.off('postSpin', oneShotPS);
        reEnableMult();
      };
      if (window.HookBus && typeof window.HookBus.on === 'function') window.HookBus.on('postSpin', oneShotPS);
      setTimeout(reEnableMult, 8000);
    });
  }
`;
}
