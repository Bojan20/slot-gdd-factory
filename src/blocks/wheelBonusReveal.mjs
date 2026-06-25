import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/wheelBonusReveal.mjs
 *
 * Wave W47.S18 — B72 · wheelBonusReveal block.
 *
 * Extension presenter that sits on top of the existing `wheelBonus.mjs`
 * (mini-game) and `weightedWheelSegments.mjs` (weighted resolution
 * layer). When the wheel settles on its winning segment, this block
 * draws a centered reveal banner — segment label + value — with a
 * configurable reveal animation, then auto-closes. Distinct from
 * `wheelBonus.mjs` which owns the WHEEL GAME STATE (segments, decel,
 * pointer); this block owns the post-settlement REVEAL surface only.
 *
 * Industry reference: ubiquitous post-wheel reveal banner. Vendor-neutral
 * baseline: ~1200ms banner, fade-in + scale punch, gold halo, optional
 * jackpot escalation tier when the chosen segment value clears a
 * configurable threshold.
 *
 * GDD knobs (consumed from model.wheelBonusReveal):
 *   enabled              boolean                                 (default false)
 *   revealStyle          'glow' | 'shake' | 'zoom' | 'fanfare'   (default 'zoom')
 *   highlightDurationMs  number — banner animation duration       (default 1200)
 *   autoCloseMs          number — extra hold after animation       (default 800)
 *   haloColor            'r,g,b'                                  (default '255,210,90')
 *   centerMessage        string — "YOU WON {label}" template      (default 'YOU WON {label}')
 *   jackpotMinValue      number — value floor for jackpot path    (default 100)
 *   jackpotMessage       string — jackpot template                 (default 'JACKPOT! {label}')
 *   jackpotHaloColor     'r,g,b'                                  (default '255,80,80')
 *
 * Public API:
 *   defaultConfig()                       → safe defaults
 *   resolveConfig(model)                  → merge + clamp
 *   emitWheelBonusRevealCSS(cfg)          → CSS string
 *   emitWheelBonusRevealMarkup(cfg)       → HTML string
 *   emitWheelBonusRevealRuntime(cfg)      → IIFE runtime
 *
 * Lifecycle (Runtime):
 *   listens : onWheelSettled (primary), onWheelJackpotHit (escalation)
 *   emits   : onWheelRevealStart, onWheelRevealEnd
 *
 * Accessibility:
 *   • role="status" + aria-live="polite" + dynamic aria-label
 *   • prefers-reduced-motion: hard motion-kill, banner stays static
 *
 * Performance budget:
 *   • 1 host overlay + 1 inner banner — no canvas, no SVG
 *   • Build-time keyframe selection — exactly 1 keyframe block ships
 *   • Single setTimeout for auto-close
 */

const DEFAULTS = Object.freeze({
  enabled: false,
  revealStyle: 'zoom',
  highlightDurationMs: 1200,
  autoCloseMs: 800,
  haloColor: '255,210,90',
  centerMessage: 'YOU WON {label}',
  jackpotMinValue: 100,
  jackpotMessage: 'JACKPOT! {label}',
  jackpotHaloColor: '255,80,80',
});

const REVEAL_STYLES = Object.freeze(['glow', 'shake', 'zoom', 'fanfare']);

const BOUNDS = Object.freeze({
  highlightDurationMs: { min: 200, max: 8000,    integer: true },
  autoCloseMs:         { min: 0,   max: 5000,    integer: true },
  jackpotMinValue:     { min: 1,   max: 1000000, integer: false },
});

export function defaultConfig() {
  return Object.freeze({ ...DEFAULTS });
}

function isValidRgb(s) {
  if (typeof s !== 'string') return false;
  const parts = s.split(',').map(p => p.trim());
  if (parts.length !== 3) return false;
  return parts.every(p => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function isValidTemplate(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= 80;
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.wheelBonusReveal) || {};

  if (src.enabled != null) cfg.enabled = !!src.enabled;

  if (typeof src.revealStyle === 'string' && REVEAL_STYLES.includes(src.revealStyle)) {
    cfg.revealStyle = src.revealStyle;
  }
  if (isValidRgb(src.haloColor))         cfg.haloColor        = src.haloColor;
  if (isValidRgb(src.jackpotHaloColor))  cfg.jackpotHaloColor = src.jackpotHaloColor;
  if (isValidTemplate(src.centerMessage))  cfg.centerMessage  = src.centerMessage;
  if (isValidTemplate(src.jackpotMessage)) cfg.jackpotMessage = src.jackpotMessage;

  for (const key of Object.keys(BOUNDS)) {
    const v = src[key];
    const b = BOUNDS[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= b.min && v <= b.max) {
      cfg[key] = b.integer ? Math.floor(v) : v;
    }
  }

  /* Auto-enable when wheelBonus or weightedWheelSegments declared —
     the reveal is the natural celebration partner. */
  if (model && (model.wheelBonus || model.weightedWheelSegments)) {
    if (src.enabled !== false) cfg.enabled = true;
  }
  if (Array.isArray(model.features) && model.features.some(f =>
    typeof f === 'object' && f && (
      f.kind === 'wheel_bonus' ||
      f.kind === 'wheel_of_fortune' ||
      f.kind === 'weighted_wheel' ||
      f.kind === 'wheel_reveal'
    )
  )) {
    if (src.enabled !== false) cfg.enabled = true;
  }

  return cfg;
}

export function emitWheelBonusRevealCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';

  /* Build-time keyframe dispatch — exactly one block ships. */
  let keyframeName, styleBlock;
  switch (cfg.revealStyle) {
    case 'glow':
      keyframeName = 'wheelRevealGlow';
      styleBlock = `@keyframes wheelRevealGlow {
  0%   { transform: translate(-50%, -50%) scale(1);    opacity: 0; filter: brightness(1); }
  40%  { transform: translate(-50%, -50%) scale(1.05); opacity: 1; filter: brightness(1.5); }
  100% { transform: translate(-50%, -50%) scale(1);    opacity: 1; filter: brightness(1); }
}`;
      break;
    case 'shake':
      keyframeName = 'wheelRevealShake';
      styleBlock = `@keyframes wheelRevealShake {
  0%   { transform: translate(-50%, -50%) rotate(0deg);  opacity: 0; }
  20%  { transform: translate(-50%, -50%) rotate(-4deg); opacity: 1; }
  40%  { transform: translate(-50%, -50%) rotate(4deg);  opacity: 1; }
  60%  { transform: translate(-50%, -50%) rotate(-3deg); opacity: 1; }
  80%  { transform: translate(-50%, -50%) rotate(2deg);  opacity: 1; }
  100% { transform: translate(-50%, -50%) rotate(0deg);  opacity: 1; }
}`;
      break;
    case 'fanfare':
      keyframeName = 'wheelRevealFanfare';
      styleBlock = `@keyframes wheelRevealFanfare {
  0%   { transform: translate(-50%, -200%) scale(0.6); opacity: 0; }
  30%  { transform: translate(-50%, -50%)  scale(1.15); opacity: 1; }
  55%  { transform: translate(-50%, -50%)  scale(0.95); opacity: 1; }
  100% { transform: translate(-50%, -50%)  scale(1);    opacity: 1; }
}`;
      break;
    case 'zoom':
    default:
      keyframeName = 'wheelRevealZoom';
      styleBlock = `@keyframes wheelRevealZoom {
  0%   { transform: translate(-50%, -50%) scale(0.4); opacity: 0; }
  60%  { transform: translate(-50%, -50%) scale(1.1); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(1);   opacity: 1; }
}`;
      break;
  }

  return `
/* ─── wheelBonusReveal block — emitted by src/blocks/wheelBonusReveal.mjs ─ */
.wheel-reveal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.4);
  z-index: 96;
  background: rgba(0, 0, 0, 0.85);
  border: 2px solid rgba(${cfg.haloColor}, 0.85);
  border-radius: 18px;
  padding: 1.4rem 2.2rem;
  color: rgba(${cfg.haloColor}, 1);
  font-weight: 900;
  letter-spacing: 0.05em;
  text-align: center;
  text-shadow: 0 0 12px rgba(${cfg.haloColor}, 0.7);
  box-shadow: 0 0 40px rgba(${cfg.haloColor}, 0.6);
  display: none;
  pointer-events: none;
  min-width: 240px;
  max-width: 80vw;
}
.wheel-reveal[data-active="true"] {
  display: block;
  animation: ${keyframeName} ${cfg.highlightDurationMs}ms cubic-bezier(.34, 1.56, .64, 1) forwards;
}
.wheel-reveal[data-jackpot="true"] {
  border-color: rgba(${cfg.jackpotHaloColor}, 1);
  color: rgba(${cfg.jackpotHaloColor}, 1);
  text-shadow: 0 0 14px rgba(${cfg.jackpotHaloColor}, 0.85);
  box-shadow: 0 0 56px rgba(${cfg.jackpotHaloColor}, 0.75);
}
.wheel-reveal .wr-headline {
  font-size: 0.82rem;
  opacity: 0.82;
  letter-spacing: 0.1em;
  margin-bottom: 0.45rem;
}
.wheel-reveal .wr-prize {
  font-size: 1.5rem;
}
${styleBlock}
@media (prefers-reduced-motion: reduce) {
  .wheel-reveal[data-active="true"] {
    animation: none;
    transform: translate(-50%, -50%);
    opacity: 1;
  }
}
@media (max-width: 480px) {
  .wheel-reveal { padding: 1.1rem 1.5rem; min-width: 200px; }
  .wheel-reveal .wr-prize { font-size: 1.18rem; }
}
`;
}

export function emitWheelBonusRevealMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<div id="wheelReveal" class="wheel-reveal" data-active="false" data-jackpot="false" role="status" aria-live="polite" aria-label="Wheel reveal" data-i18n-aria="wheelBonusReveal.0" data-i18n-aria-fallback="Wheel reveal">
  <div class="wr-headline" data-i18n="wheelBonusReveal.result" data-i18n-fallback="RESULT">RESULT</div>
  <!-- WCAG 4.1.3 (F4 A3) — wheel prize / JACKPOT is celebration; assertive interrupts so SR speaks full result. -->
  <div class="wr-prize" aria-live="assertive" aria-atomic="true">—</div>
</div>`, 'wheelBonusReveal');
}

export function emitWheelBonusRevealRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* wheelBonusReveal: disabled */`;
  return `/* ─── wheelBonusReveal runtime — emitted by src/blocks/wheelBonusReveal.mjs ─ */
(function _wheelBonusRevealRuntime() {
  var WR_DURATION_MS = ${cfg.highlightDurationMs};
  var WR_AUTO_CLOSE  = ${cfg.autoCloseMs};
  var WR_MESSAGE_TPL = ${JSON.stringify(cfg.centerMessage)};
  var WR_JP_TPL      = ${JSON.stringify(cfg.jackpotMessage)};
  var WR_JP_MIN      = ${cfg.jackpotMinValue};
  var WR_TOKEN       = 0;

  function _wrHost() {
    return (typeof document !== 'undefined') ? document.getElementById('wheelReveal') : null;
  }

  function _wrFire(label, value, isJackpot, payload) {
    var host = _wrHost();
    if (!host) return;
    var safeLabel = String(label == null ? '' : label).slice(0, 40);
    var tpl = isJackpot ? WR_JP_TPL : WR_MESSAGE_TPL;
    var msg = tpl.replace('{label}', safeLabel);
    var prizeEl = host.querySelector('.wr-prize');
    if (prizeEl) prizeEl.textContent = msg;
    host.dataset.jackpot = isJackpot ? 'true' : 'false';
    host.setAttribute('aria-label', (isJackpot ? 'Jackpot revealed: ' : 'Wheel reveal: ') + safeLabel);

    /* Re-entrancy + animation restart. */
    var token = ++WR_TOKEN;
    host.dataset.active = 'false';
    void host.offsetWidth;
    host.dataset.active = 'true';

    if (typeof HookBus !== 'undefined') {
      try { HookBus.emit('onWheelRevealStart', { label: safeLabel, value: value, jackpot: !!isJackpot, payload: payload || null, durationMs: WR_DURATION_MS }); } catch (_) {}
    }

    setTimeout(function () {
      if (token !== WR_TOKEN) return;
      host.dataset.active = 'false';
      if (typeof HookBus !== 'undefined') {
        try { HookBus.emit('onWheelRevealEnd', { label: safeLabel, value: value, jackpot: !!isJackpot, reason: 'natural' }); } catch (_) {}
      }
    }, WR_DURATION_MS + WR_AUTO_CLOSE);
  }

  if (typeof window !== 'undefined') {
    window.fireWheelBonusReveal = _wrFire;
  }

  if (typeof HookBus !== 'undefined') {
    /* Primary: wheel settles on a chosen segment. wheelBonus.mjs emits
       { index, segment: { label, value, color } }. */
    HookBus.on('onWheelSettled', function (evt) {
      var seg   = (evt && evt.segment) || {};
      var label = seg.label || 'PRIZE';
      var value = Number(seg.value);
      var jp    = Number.isFinite(value) && value >= WR_JP_MIN;
      _wrFire(label, value, jp, evt);
    });

    /* Escalation: weightedWheelSegments.mjs separately emits
       onWheelJackpotHit when the chosen segment carries a jackpotTier
       label. Treat this as forced-jackpot regardless of value threshold. */
    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onWheelJackpotHit', function (evt) {
      var label = (evt && (evt.label || evt.tier || 'JACKPOT'));
      var value = Number(evt && evt.value);
      _wrFire(label, Number.isFinite(value) ? value : 0, true, evt);
    }) : void 0);
  }
})();
`;
}
