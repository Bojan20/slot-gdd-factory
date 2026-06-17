/**
 * src/blocks/euAiActComplianceGate.mjs
 *
 * W58.J-EU — EU AI Act (Regulation 2024/1689) compliance gate.
 *
 * Centralized opt-in block that enforces three EU AI Act obligations
 * at boot time. The Regulation entered force August 2024 with staggered
 * applicability dates; Article 5 prohibited-AI-practices apply from
 * 2 February 2025. Slot games sit at a high-risk intersection of these
 * provisions because adaptive personalization (DDA, dynamic odds, mood
 * sensing) crosses two prohibition triggers.
 *
 *   Art.5(1)(a) Subliminal manipulation prohibition
 *     "Placing on the market, putting into service or using an AI system
 *     that deploys subliminal techniques beyond a person's consciousness
 *     or purposefully manipulative or deceptive techniques, with the
 *     objective or effect of materially distorting the behaviour of a
 *     person or group of persons."
 *     For slot games: any AI-driven outcome adjustment that the player
 *     cannot consciously perceive (mood-aware near-miss tuning, hidden
 *     loss-recovery hooks) is BANNED. This block sets a global
 *     `window.__EU_AI_SUBLIMINAL_BANNED__` flag asserting the template
 *     contains no such system.
 *
 *   Art.5(1)(b) Vulnerability exploitation prohibition
 *     "Placing on the market […] an AI system that exploits any of the
 *     vulnerabilities of a natural person or a specific group of persons
 *     due to their age, disability or a specific social or economic
 *     situation, with the objective or effect of materially distorting
 *     the behaviour of that person."
 *     For slot games: Dynamic Difficulty Adjustment (DDA) that profiles
 *     problem-gamblers and tunes wins/losses to keep them spinning is
 *     BANNED. This block sets `window.__EU_AI_ACT_DDA_PROHIBITED__` and
 *     fires onAiActDdaProhibited so downstream consumers know any DDA
 *     attempt must abort.
 *
 *   Art.50(1) Transparency on AI-generated content
 *     Operators MUST declare AI-generated or AI-personalized content to
 *     the player. This block sets `window.__EU_AI_DECLARATION_REQUIRED__`
 *     to true and fires onAiSystemDeclarationRequired. Operator-side
 *     session-init must surface the declaration UI (e.g., a "no AI
 *     personalization in play" notice) and flip the acknowledgement
 *     flag before first spin.
 *
 * Math gate
 *   ────────
 *   Block does NOT touch RTP / volatility / hit frequency. These are
 *   static-table jurisdiction parameters, not AI-personalized signals.
 *   Per `rule_no_math_unless_asked`.
 *
 * Public API
 *   export const EU_AI_ACT_PROHIBITED_PRACTICES
 *   export function defaultConfig(): EuAiActComplianceGateConfig
 *   export function resolveConfig(model?: object): EuAiActComplianceGateConfig
 *   export function emitEuAiActComplianceGateCSS(cfg): string  (no-op)
 *   export function emitEuAiActComplianceGateRuntime(cfg): string
 *
 * Lifecycle
 *   • Boot-time only. Listens to no HookBus events. Mounts no DOM.
 *     Sets three window flags + emits two audit events.
 *   • Emit-only block — registered in LEGO HOOK_REGISTRATION_OPT_OUT.
 *
 * HookBus events (sole emitter contract)
 *   • onAiActDdaProhibited              payload: { jurisdiction, rule }
 *   • onAiSystemDeclarationRequired     payload: { jurisdiction, rule }
 *
 * Accessibility
 *   Block is invisible to the player (boot-time DOM-free side effect).
 *   The Article 50 declaration UI is the operator's responsibility.
 *
 * GDD knobs (under `model.euAiActComplianceGate`)
 *   • enabled        bool   (default false — opt-in or auto when EU)
 *   • jurisdiction   string (3-key precedence)
 *   • declareNoAi    bool   (default true — asserts template is AI-free)
 *
 * Wave Legacy · industry baseline (vendor-neutral). Original block predates the
 * formal Wave Hxx naming + JSDoc kontrakt header pattern (auto-tagged by
 * tools/cortex-block-mega-fix.mjs).
 */

/* W59.H1 — Central jurisdiction precedence resolver. */
import { resolveJurisdiction } from './jurisdictionGate.mjs';

/* Frozen list of the three Article 5 obligations this block addresses.
 * Exported for cert-harness introspection + downstream block self-checks. */
export const EU_AI_ACT_PROHIBITED_PRACTICES = Object.freeze([
  { article: '5(1)(a)', short: 'subliminal-manipulation' },
  { article: '5(1)(b)', short: 'vulnerability-exploitation-dda' },
  { article: '50(1)',   short: 'ai-content-declaration' },
]);

/* Jurisdiction codes that auto-enable the gate. EU member states share
 * the Regulation directly (it has direct effect, no national transposition
 * required); 'EU' is the umbrella label. National flags (DE, NL, FR, IT,
 * ES, etc.) are also covered because they're EU member states, but the
 * block uses 'EU' to keep the cert-harness vocabulary explicit. */
const EU_AI_ACT_JURISDICTIONS = Object.freeze(['EU']);

const DEFAULTS = Object.freeze({
  enabled:      false,
  jurisdiction: null,
  declareNoAi:  true,
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

export function resolveConfig(model) {
  const cfg = defaultConfig();
  const src = (model && model.euAiActComplianceGate) || {};

  /* W59.H1 — Central jurisdiction precedence resolver. Same semantics:
   * regulator.profile > RG > euAiActComplianceGate.jurisdiction. */
  const jurisdiction = resolveJurisdiction(model, { fallbackKey: 'euAiActComplianceGate.jurisdiction' });
  cfg.jurisdiction = jurisdiction;

  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  if (jurisdiction && EU_AI_ACT_JURISDICTIONS.indexOf(jurisdiction) !== -1) {
    cfg.enabled = true;
  }

  if (typeof src.declareNoAi === 'boolean') cfg.declareNoAi = src.declareNoAi;

  return cfg;
}

/* ─── CSS emit (no-op) ──────────────────────────────────────────────────── */

export function emitEuAiActComplianceGateCSS(_cfg) {
  /* Operator-side renders the Article 50 declaration UI; this block has
   * no visual surface. Returning '' keeps the orchestrator clean. */
  return '';
}

/* ─── Runtime emit (boot-time only) ──────────────────────────────────────── */

export function emitEuAiActComplianceGateRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  const jurJSON = JSON.stringify(c.jurisdiction || '');
  const declareNoAi = c.declareNoAi;

  return `
/* euAiActComplianceGate runtime — Art.5(1)(a)(b) + Art.50(1) */
(function euAiActComplianceGateInit() {
  var JURISDICTION = ${jurJSON};
  var DECLARE_NO_AI = ${declareNoAi};

  if (typeof window === 'undefined') return;

  /* Art.5(1)(a) Subliminal-manipulation prohibition. The SGF slot
   * template contains no AI-driven subliminal techniques (no mood
   * sensing, no hidden behavior steering); we assert this via the
   * declaration flag. If declareNoAi is false (operator has bolted on
   * an AI layer), the flag is NOT set and the operator must surface
   * an Article 5 risk assessment to the regulator. */
  if (DECLARE_NO_AI) {
    window.__EU_AI_SUBLIMINAL_BANNED__ = true;
  }

  /* Art.5(1)(b) Vulnerability-exploitation (DDA) prohibition. SGF does
   * NOT implement Dynamic Difficulty Adjustment / problem-gambler
   * profiling / personalized odds tuning. Setting the flag asserts the
   * prohibition; any downstream block that attempted DDA would have to
   * explicitly disable this flag (and trigger a regulator audit). */
  window.__EU_AI_ACT_DDA_PROHIBITED__ = true;
  if (window.HookBus && typeof window.HookBus.emit === 'function') {
    try {
      window.HookBus.emit('onAiActDdaProhibited', {
        jurisdiction: JURISDICTION,
        rule: 'EU-AIAct-2024/1689-Art.5(1)(b)',
      });
    } catch (_) {}
  }

  /* Art.50(1) Transparency obligation. The operator's session-init layer
   * MUST surface a declaration ("no AI personalization in this game")
   * before first spin. We flag the requirement + fire the audit event;
   * the operator implementation is responsible for the UI. */
  window.__EU_AI_DECLARATION_REQUIRED__ = true;
  if (typeof window.__EU_AI_DECLARATION_ACK__ === 'undefined') {
    window.__EU_AI_DECLARATION_ACK__ = false;
  }
  if (window.HookBus && typeof window.HookBus.emit === 'function') {
    try {
      window.HookBus.emit('onAiSystemDeclarationRequired', {
        jurisdiction: JURISDICTION,
        rule: 'EU-AIAct-2024/1689-Art.50(1)',
      });
    } catch (_) {}
  }
})();
`;
}
