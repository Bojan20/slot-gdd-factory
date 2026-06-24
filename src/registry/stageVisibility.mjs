/**
 * src/registry/stageVisibility.mjs
 *
 * UQ-DEEP-AO · AO-6 · Stage-driven block visibility (IGT P1 adoption).
 *
 * IGT's design_tool `FrameworkSettingComponent` gate-uje block visibility
 * per game stage (BaseGame / FreeSpin / Bonus / …). Prior to AO-6 our HUD
 * je vidljiv stalno — bez stage gating-a — što ne odgovara industrijskom
 * pattern-u i pravi UX clutter u FreeSpin / Bonus fazama.
 *
 * AO-6 dodaje:
 *   • Vendor-neutral stage taxonomy (`STAGES` + `DEFAULT_STAGE`)
 *   • CSS injector koji sakriva svaki element sa `data-stage` koji NEMA
 *     `data-stage-active` (postavlja runtime na osnovu trenutne faze)
 *   • Runtime helper koji izlaže `window.SlotStage` API i auto-prati
 *     HookBus lifecycle event-ove (onFsTrigger / onFsEnd / onHnwTrigger /
 *     onHnwEnd) — block-ovi opt-in dodavanjem `data-stage="FreeSpin"`
 *     (ili space-separated lista) u svoj markup.
 *
 * ── Public surface ─────────────────────────────────────────────────────
 *   SCHEMA_VERSION                : '1'
 *   STAGES                        : frozen array of 6 canonical stage IDs
 *   DEFAULT_STAGE                 : 'BaseGame'
 *   emitStageVisibilityCSS()      : CSS string for <style> aggregation
 *   emitStageVisibilityRuntime()  : JS string for <script> aggregation
 *
 * Vendor-neutral implementation. No symbol or operator-name references.
 */

export const SCHEMA_VERSION = '1';

export const STAGES = Object.freeze([
  'BaseGame',
  'FreeSpin',
  'LockAndRespin',
  'Jackpot',
  'PickBonus',
  'EndGame'
]);

export const DEFAULT_STAGE = 'BaseGame';

/* CSS that hides elements which declare data-stage not matching current. */
export function emitStageVisibilityCSS() {
  return `
/* UQ-DEEP-AO AO-6 — stage-gated visibility.
 * Element opt-in: <div data-stage="FreeSpin"> shows only when current stage = FreeSpin.
 * Multi-stage: data-stage="FreeSpin BonusGame" shows for either.
 * Container scope: body[data-stage-current="X"]. */
body[data-stage-current] [data-stage]:not([data-stage-active]) { display: none; }
body[data-stage-current] [data-stage-always] { display: revert; }
`;
}

/* Runtime JS string — sets body[data-stage-current] + per-element activation
 * based on whether their data-stage attribute matches. */
export function emitStageVisibilityRuntime() {
  return `
/* UQ-DEEP-AO AO-6 — stage visibility runtime. */
(function() {
  if (window.__STAGE_VIS_WIRED__) return;
  window.__STAGE_VIS_WIRED__ = true;

  var currentStage = '${DEFAULT_STAGE}';

  function refreshActive() {
    document.body.setAttribute('data-stage-current', currentStage);
    var nodes = document.querySelectorAll('[data-stage]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var stages = (n.getAttribute('data-stage') || '').split(/\\s+/);
      if (stages.indexOf(currentStage) >= 0) {
        n.setAttribute('data-stage-active', '');
      } else {
        n.removeAttribute('data-stage-active');
      }
    }
  }

  window.SlotStage = {
    setStage: function(stage) {
      if (typeof stage !== 'string' || ${JSON.stringify(STAGES)}.indexOf(stage) < 0) return;
      currentStage = stage;
      refreshActive();
      if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
        HookBus.emit('onStageChanged', { stage: stage });
      }
    },
    getStage: function() { return currentStage; },
    schemaVersion: '1',
    stages: ${JSON.stringify(STAGES)}
  };

  /* Init on DOM ready. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refreshActive);
  } else {
    refreshActive();
  }

  /* Listen to lifecycle events for auto-stage progression. */
  if (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function') {
    HookBus.on('onFsTrigger', function() { window.SlotStage.setStage('FreeSpin'); });
    HookBus.on('onFsEnd',     function() { window.SlotStage.setStage('BaseGame'); });
    HookBus.on('onHnwTrigger', function() { window.SlotStage.setStage('LockAndRespin'); });
    HookBus.on('onHnwEnd',     function() { window.SlotStage.setStage('BaseGame'); });
  }
})();
`;
}
