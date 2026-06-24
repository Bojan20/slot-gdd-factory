import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/pickBonusReveal.mjs
 *
 * Wave W47.S16 — B71 · pickBonusReveal block.
 *
 * Reveal-celebration overlay that fires AFTER a pick-bonus game resolves
 * (bonusPick.mjs / bonusPickDeterministic) or after any other selection
 * payload arrives via HookBus. Plays one of four reveal animations
 * (flip / zoom / glow / shake), shows the prize label + value, then
 * fades out. Pure CSS keyframes + a lightweight DOM overlay — no canvas,
 * no SVG, no engine dependency.
 *
 * Industry reference: ubiquitous post-pick reveal banner. Vendor-neutral
 * baseline: 1500ms centred reveal, ±5deg shake or 0→1.1 zoom, gold halo.
 *
 * Distinct from `bonusPick.mjs` which owns the PICK GAME STATE
 * (tile board, click handlers, prize pool). This block owns the
 * post-resolution REVEAL surface — a single host element + animation
 * stack — and is composable with any pick / bonus / reward source.
 *
 * GDD knobs (consumed from model.pickBonusReveal):
 *   enabled        boolean                                       (default false)
 *   triggerEvent   'onBonusPickResolved' | 'onFsTrigger'
 *                  | 'onWheelAwardCollected'                     (default 'onBonusPickResolved')
 *   revealStyle    'flip' | 'zoom' | 'glow' | 'shake'             (default 'zoom')
 *   durationMs     number — total reveal duration                 (default 1500)
 *   haloColor      'r,g,b'                                        (default '255,214,110')
 *   messageTpl     string — "YOU WON {label}" template            (default 'YOU WON {label}')
 *   autoCloseMs    number — extra hold after animation             (default 700)
 *
 * Public API:
 *   defaultConfig()                       → safe defaults (isolated copy)
 *   resolveConfig(model)                  → merge + clamp
 *   emitPickBonusRevealCSS(cfg)           → CSS string
 *   emitPickBonusRevealMarkup(cfg)        → HTML string
 *   emitPickBonusRevealRuntime(cfg)       → IIFE runtime
 *
 * Lifecycle (Runtime):
 *   listens : exactly one of the three triggerEvent options
 *             (build-time dead-branch elimination)
 *   emits   : onPickRevealStart, onPickRevealEnd
 *
 * Accessibility:
 *   • role="status" + aria-live="polite" so the prize is announced
 *   • prefers-reduced-motion: kills the reveal animation, leaves
 *     the static prize banner
 *
 * Performance budget:
 *   • 1 host element + 1 inner label container
 *   • GPU-accelerated transform / opacity keyframe
 *   • Single setTimeout for the auto-close
 */

const DEFAULTS = Object.freeze({
  enabled: false,
  triggerEvent: 'onBonusPickResolved',
  revealStyle: 'zoom',
  durationMs: 1500,
  haloColor: '255,214,110',
  messageTpl: 'YOU WON {label}',
  autoCloseMs: 700,
});

const TRIGGER_EVENTS = Object.freeze(['onBonusPickResolved', 'onFsTrigger', 'onWheelAwardCollected']);
const REVEAL_STYLES  = Object.freeze(['flip', 'zoom', 'glow', 'shake']);

const BOUNDS = Object.freeze({
  durationMs:  { min: 200,  max: 8000, integer: true },
  autoCloseMs: { min: 0,    max: 5000, integer: true },
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
  const src = (model && model.pickBonusReveal) || {};

  if (src.enabled != null) cfg.enabled = !!src.enabled;

  if (typeof src.triggerEvent === 'string' && TRIGGER_EVENTS.includes(src.triggerEvent)) {
    cfg.triggerEvent = src.triggerEvent;
  }
  if (typeof src.revealStyle === 'string' && REVEAL_STYLES.includes(src.revealStyle)) {
    cfg.revealStyle = src.revealStyle;
  }
  if (isValidRgb(src.haloColor))    cfg.haloColor  = src.haloColor;
  if (isValidTemplate(src.messageTpl)) cfg.messageTpl = src.messageTpl;

  for (const key of Object.keys(BOUNDS)) {
    const v = src[key];
    const b = BOUNDS[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= b.min && v <= b.max) {
      cfg[key] = b.integer ? Math.floor(v) : v;
    }
  }

  /* Auto-enable when bonusPick or bonusPickDeterministic is declared —
     the reveal is the natural celebration partner. */
  if (model && (model.bonusPick || model.bonusPickDeterministic)) {
    if (src.enabled !== false) cfg.enabled = true;
  }
  if (Array.isArray(model.features) && model.features.some(f =>
    typeof f === 'object' && f && (
      f.kind === 'pick_bonus' ||
      f.kind === 'bonus_pick' ||
      f.kind === 'pick_em' ||
      f.kind === 'pick_reveal'
    )
  )) {
    if (src.enabled !== false) cfg.enabled = true;
  }

  return cfg;
}

export function emitPickBonusRevealCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';

  /* Reveal-style keyframe selector — exactly one keyframe block is
     baked, dead branches never ship. */
  let keyframeName, styleBlock;
  switch (cfg.revealStyle) {
    case 'flip':
      keyframeName = 'pickRevealFlip';
      styleBlock = `@keyframes pickRevealFlip {
  0%   { transform: translate(-50%, -50%) rotateY(90deg); opacity: 0; }
  60%  { transform: translate(-50%, -50%) rotateY(0deg);   opacity: 1; }
  100% { transform: translate(-50%, -50%) rotateY(0deg);   opacity: 1; }
}`;
      break;
    case 'glow':
      keyframeName = 'pickRevealGlow';
      styleBlock = `@keyframes pickRevealGlow {
  0%   { transform: translate(-50%, -50%) scale(1);    opacity: 0; filter: brightness(1); }
  50%  { transform: translate(-50%, -50%) scale(1.06); opacity: 1; filter: brightness(1.45); }
  100% { transform: translate(-50%, -50%) scale(1);    opacity: 1; filter: brightness(1); }
}`;
      break;
    case 'shake':
      keyframeName = 'pickRevealShake';
      styleBlock = `@keyframes pickRevealShake {
  0%   { transform: translate(-50%, -50%) rotate(0deg);  opacity: 0; }
  20%  { transform: translate(-50%, -50%) rotate(-5deg); opacity: 1; }
  40%  { transform: translate(-50%, -50%) rotate(4deg);  opacity: 1; }
  60%  { transform: translate(-50%, -50%) rotate(-3deg); opacity: 1; }
  80%  { transform: translate(-50%, -50%) rotate(2deg);  opacity: 1; }
  100% { transform: translate(-50%, -50%) rotate(0deg);  opacity: 1; }
}`;
      break;
    case 'zoom':
    default:
      keyframeName = 'pickRevealZoom';
      styleBlock = `@keyframes pickRevealZoom {
  0%   { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
  60%  { transform: translate(-50%, -50%) scale(1.1); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(1);   opacity: 1; }
}`;
      break;
  }

  return `
/* ─── pickBonusReveal block — emitted by src/blocks/pickBonusReveal.mjs ─ */
.pick-reveal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.3);
  z-index: 95;
  background: rgba(0, 0, 0, 0.82);
  border: 2px solid rgba(${cfg.haloColor}, 0.85);
  border-radius: 18px;
  padding: 1.3rem 2rem;
  color: rgba(${cfg.haloColor}, 1);
  font-weight: 900;
  letter-spacing: 0.05em;
  text-align: center;
  text-shadow: 0 0 10px rgba(${cfg.haloColor}, 0.7);
  box-shadow: 0 0 36px rgba(${cfg.haloColor}, 0.55);
  display: none;
  pointer-events: none;
  min-width: 220px;
  max-width: 80vw;
}
.pick-reveal[data-active="true"] {
  display: block;
  animation: ${keyframeName} ${cfg.durationMs}ms cubic-bezier(.34, 1.56, .64, 1) forwards;
}
.pick-reveal .pr-headline {
  font-size: 0.78rem;
  opacity: 0.8;
  letter-spacing: 0.08em;
  margin-bottom: 0.4rem;
}
.pick-reveal .pr-prize {
  font-size: 1.4rem;
}
${styleBlock}
@media (prefers-reduced-motion: reduce) {
  .pick-reveal[data-active="true"] {
    animation: none;
    transform: translate(-50%, -50%);
    opacity: 1;
  }
}
@media (max-width: 480px) {
  .pick-reveal { padding: 1rem 1.4rem; min-width: 180px; }
  .pick-reveal .pr-prize { font-size: 1.1rem; }
}
`;
}

export function emitPickBonusRevealMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<div id="pickReveal" class="pick-reveal" data-active="false" role="status" aria-live="polite" aria-label="Bonus prize reveal">
  <div class="pr-headline">PRIZE</div>
  <!-- WCAG 4.1.3 (F4 A3) — prize label is a big-win celebration; assertive interrupts so player hears full "YOU WON x5 MULTIPLIER". -->
  <div class="pr-prize" aria-live="assertive" aria-atomic="true">—</div>
</div>`, 'pickBonusReveal');
}

export function emitPickBonusRevealRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* pickBonusReveal: disabled */`;

  /* Build-time dispatch — exactly one trigger event source is wired. */
  let triggerBinding;
  switch (cfg.triggerEvent) {
    case 'onFsTrigger':
      triggerBinding = `    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsTrigger', function (evt) {
      var label = (evt && (evt.label || evt.prizeLabel)) || 'FREE SPINS';
      _prFire(label, evt);
    }) : void 0);`;
      break;
    case 'onWheelAwardCollected':
      triggerBinding = `    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onWheelAwardCollected', function (evt) {
      var label = (evt && (evt.label || evt.segmentLabel || evt.prize)) || 'PRIZE';
      _prFire(label, evt);
    }) : void 0);`;
      break;
    case 'onBonusPickResolved':
    default:
      triggerBinding = `    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onBonusPickResolved', function (evt) {
      var label = (evt && (evt.label || evt.prize || evt.tileLabel)) || 'PRIZE';
      _prFire(label, evt);
    }) : void 0);`;
      break;
  }

  return `/* ─── pickBonusReveal runtime — emitted by src/blocks/pickBonusReveal.mjs ─ */
(function _pickBonusRevealRuntime() {
  var PR_DURATION_MS  = ${cfg.durationMs};
  var PR_AUTO_CLOSE   = ${cfg.autoCloseMs};
  var PR_MESSAGE_TPL  = ${JSON.stringify(cfg.messageTpl)};
  var PR_TOKEN        = 0;

  function _prHost() {
    return (typeof document !== 'undefined') ? document.getElementById('pickReveal') : null;
  }

  function _prFire(label, payload) {
    var host = _prHost();
    if (!host) return;
    var safeLabel = String(label == null ? '' : label).slice(0, 40);
    var msg = PR_MESSAGE_TPL.replace('{label}', safeLabel);
    var prizeEl = host.querySelector('.pr-prize');
    if (prizeEl) prizeEl.textContent = msg;
    host.setAttribute('aria-label', 'Prize revealed: ' + safeLabel);

    /* Re-entrancy: invalidate any in-flight close timer. */
    var token = ++PR_TOKEN;
    /* Force animation restart by toggling data-active. */
    host.dataset.active = 'false';
    void host.offsetWidth;
    host.dataset.active = 'true';

    if (typeof HookBus !== 'undefined') {
      try { HookBus.emit('onPickRevealStart', { label: safeLabel, payload: payload || null, durationMs: PR_DURATION_MS }); } catch (_) {}
    }

    setTimeout(function () {
      if (token !== PR_TOKEN) return;
      host.dataset.active = 'false';
      if (typeof HookBus !== 'undefined') {
        try { HookBus.emit('onPickRevealEnd', { label: safeLabel, reason: 'natural' }); } catch (_) {}
      }
    }, PR_DURATION_MS + PR_AUTO_CLOSE);
  }

  if (typeof window !== 'undefined') {
    window.firePickBonusReveal = _prFire;
  }

  if (typeof HookBus !== 'undefined') {
${triggerBinding}
  }
})();
`;
}
