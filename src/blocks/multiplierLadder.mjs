/**
 * src/blocks/multiplierLadder.mjs
 *
 * Wave B67 — Persistent Multiplier Ladder UI block.
 *
 * Industry baseline: many FS rounds expose a discrete climbing-mult
 * ladder (e.g. 1× → 2× → 3× → 5× → 10×). The player sees the current
 * rung pinned in a corner and watches it climb on every winning spin
 * (or tumble). Distinct from `persistentMultiplier` which owns the
 * VALUE state — this block owns the UI surface + ladder VISUAL +
 * announces step lifecycle events the wider system can hook.
 *
 * Public API (server-side, ES module):
 *   defaultConfig()                       → safe defaults (disabled).
 *   resolveConfig(model)                  → merge defaults; auto-enable
 *                                          when model.persistentMultiplier
 *                                          OR model.multiplierLadder set.
 *   emitMultiplierLadderCSS(cfg)          → CSS rules for the rail.
 *   emitMultiplierLadderMarkup(cfg)       → host element with ARIA.
 *   emitMultiplierLadderRuntime(cfg)      → runtime: HookBus listeners +
 *                                          DOM update + 2 emits.
 *
 * Lifecycle:
 *   subscribes:
 *     onFsTrigger        — init ladder at startTier
 *     onFsSpinResult     — climb one rung when payload.award > 0
 *                          (or payload.tumbleWin > 0 when cascade)
 *     onTumbleStep       — climb one rung when payload.win > 0
 *     onMultChange       — synchronise to authoritative value
 *     onFsEnd            — reset to startTier; hide host
 *   emits:
 *     onMultLadderStep    { from, to, max }  — every visible step
 *     onMultLadderReset                       — when ladder resets
 *
 * a11y:
 *   - role="status" + aria-live="polite" + aria-label dynamic announce.
 *   - prefers-reduced-motion kills the rail-climb transition.
 *   - Apple HIG 11 px font-size floor.
 *
 * Vendor-neutral. No game / studio strings.
 */

const STEPS_DEFAULT = Object.freeze([1, 2, 3, 5, 10]);
const BOUNDS = {
  fontSizePx: [11, 22],
  flashMs:    [120, 1000],
  zIndex:     [10, 99],
};

function clamp(v, [lo, hi], fb) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
}

export function defaultConfig() {
  return Object.freeze({
    enabled:      false,
    steps:        STEPS_DEFAULT,
    startTier:    0,                // index into steps[]
    /* D-14.5 PRESENTATION ALIGN (2026-06-20): industry baseline (progressive
       FS multiplier ladders + side rail patterns across reference titles)
       renders the ladder as a side rail on the TOP-LEFT — opposite side
       from the persistent multiplier HUD chip on top-right, so the two
       don't visually fight. */
    position:     'top-left',       // top-left | top-right | bottom-left | bottom-right
    labelTemplate: '×{N}',          // {N} → current step value
    fontSizePx:   14,
    bgColor:      'rgba(0,0,0,0.55)',
    fgColor:      '#f2f2f2',
    accentColor:  '#c9a227',
    flashMs:      280,
    zIndex:       33,               // sits with fsProgressBar (32) + chips (35)
    /* If true, ladder also climbs on BASE-game tumble wins; default
     * false (FS-only is the industry baseline). */
    climbOnBaseTumble: false,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = model.multiplierLadder || {};
  const auto = !!model.persistentMultiplier || !!model.multiplierLadder;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  if (Array.isArray(m.steps) && m.steps.length > 0) {
    const cleaned = m.steps
      .map(s => Number(s))
      .filter(n => Number.isFinite(n) && n >= 1)
      .map(n => Math.floor(n));
    if (cleaned.length > 0) cfg.steps = Object.freeze(cleaned);
  }
  if (Number.isFinite(m.startTier)) {
    cfg.startTier = Math.max(0, Math.min(cfg.steps.length - 1, Math.floor(m.startTier)));
  }
  if (['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(m.position)) cfg.position = m.position;
  if (typeof m.labelTemplate === 'string' && m.labelTemplate.length > 0) cfg.labelTemplate = m.labelTemplate;
  cfg.fontSizePx = clamp(m.fontSizePx, BOUNDS.fontSizePx, cfg.fontSizePx);
  cfg.flashMs    = clamp(m.flashMs,    BOUNDS.flashMs,    cfg.flashMs);
  cfg.zIndex     = clamp(m.zIndex,     BOUNDS.zIndex,     cfg.zIndex);
  if (typeof m.bgColor    === 'string') cfg.bgColor    = m.bgColor;
  if (typeof m.fgColor    === 'string') cfg.fgColor    = m.fgColor;
  if (typeof m.accentColor === 'string') cfg.accentColor = m.accentColor;
  if (typeof m.climbOnBaseTumble === 'boolean') cfg.climbOnBaseTumble = m.climbOnBaseTumble;
  return cfg;
}

function positionStyle(pos) {
  const v = 'calc(max(8px, env(safe-area-inset-top, 0px) + 8px))';
  const h = 'calc(max(8px, env(safe-area-inset-left, 0px) + 8px))';
  const bV = 'calc(max(8px, env(safe-area-inset-bottom, 0px) + 8px))';
  const rH = 'calc(max(8px, env(safe-area-inset-right, 0px) + 8px))';
  switch (pos) {
    case 'top-left':     return `top: ${v}; left: ${h};`;
    case 'bottom-left':  return `bottom: ${bV}; left: ${h};`;
    case 'bottom-right': return `bottom: ${bV}; right: ${rH};`;
    case 'top-right':
    default:             return `top: ${v}; right: ${rH};`;
  }
}

export function emitMultiplierLadderCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* multiplierLadder — Wave B67 */
  .mult-ladder {
    position: fixed;
    ${positionStyle(cfg.position)}
    z-index: ${cfg.zIndex};
    padding: 4px 12px;
    border-radius: 999px;
    background: ${cfg.bgColor};
    color: ${cfg.fgColor};
    font-size: ${cfg.fontSizePx}px;
    font-weight: 800;
    letter-spacing: 0.05em;
    line-height: 1.4;
    pointer-events: none;
    transition: background ${cfg.flashMs}ms ease-out, color ${cfg.flashMs}ms ease-out;
    display: none;
  }
  .mult-ladder[data-visible="true"] { display: inline-block; }
  .mult-ladder[data-step="true"] {
    background: ${cfg.accentColor};
    color: #000;
  }
  @media (prefers-reduced-motion: reduce) {
    .mult-ladder { transition: none; }
  }
  `;
}

export function emitMultiplierLadderMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const startVal = cfg.steps[cfg.startTier] || 1;
  const label = String(cfg.labelTemplate || '×{N}').replace('{N}', String(startVal));
  return `<div id="multLadder" class="mult-ladder" role="status" aria-live="polite" aria-label="Multiplier ladder" data-visible="false" data-tier="${cfg.startTier}">${label}</div>`;
}

export function emitMultiplierLadderRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const stepsJson = JSON.stringify(cfg.steps);
  return `
  (function(){
    if (typeof window === 'undefined' || !window.HookBus) return;
    /* WASH PASS (2026-06-18) — wired-once sentinel so HMR / repeated
     * runtime bake does NOT stack the 5 listeners that this block
     * subscribes to (onFsTrigger/onFsSpinResult/onTumbleStep/onFsEnd/
     * onMultChange). */
    if (window.__MULT_LADDER_WIRED__) return;
    window.__MULT_LADDER_WIRED__ = true;
    var host = document.getElementById('multLadder');
    if (!host) return;
    var STEPS = ${stepsJson};
    var MAX = STEPS.length - 1;
    var template = ${JSON.stringify(cfg.labelTemplate)};
    var flashMs = ${cfg.flashMs};
    var startTier = ${cfg.startTier};
    var climbOnBase = ${JSON.stringify(cfg.climbOnBaseTumble)};
    var tier = startTier;
    var fsActive = false;
    var stepResetTimer = null;

    function render(t) {
      tier = Math.max(0, Math.min(MAX, t | 0));
      var v = STEPS[tier];
      host.textContent = template.replace('{N}', String(v));
      host.setAttribute('data-tier', String(tier));
      host.setAttribute('aria-label', 'Multiplier ladder: ' + template.replace('{N}', String(v)));
    }
    function show() { host.setAttribute('data-visible', 'true'); }
    function hide() { host.setAttribute('data-visible', 'false'); }
    function flash() {
      host.setAttribute('data-step', 'true');
      if (stepResetTimer) clearTimeout(stepResetTimer);
      stepResetTimer = setTimeout(function () { host.setAttribute('data-step', 'false'); }, flashMs);
    }
    function climb() {
      if (tier >= MAX) return;
      var from = tier;
      var to = tier + 1;
      render(to);
      flash();
      try { window.HookBus.emit('onMultLadderStep', { from: STEPS[from], to: STEPS[to], max: STEPS[MAX] }); } catch (_) {}
      /* D-14.1 (Boki 2026-06-20): "svaki multiplier mora da radi
       * besprekorno". Pre ovog bloka ladder je UI mirror koji sluša
       * onMultChange — ne podiže payout sam. Sad climb step direktno
       * podigne HookBus.setMultMax(new tier value) tako da sledeci win
       * stvarno bude multiplikovan tom vrednoscu. setMultMax sprecava
       * drift sa persistentMultiplier (oba pisu na isti mult state). */
      try {
        if (typeof window.HookBus.setMultMax === 'function') {
          window.HookBus.setMultMax(STEPS[to]);
        }
      } catch (_) {}
    }
    function reset() {
      tier = startTier;
      render(startTier);
      hide();
      try { window.HookBus.emit('onMultLadderReset'); } catch (_) {}
    }

    HookBus.on('onFsTrigger', function () {
      fsActive = true;
      render(startTier);
      show();
    });
    HookBus.on('onFsSpinResult', function (p) {
      if (!fsActive) return;
      if (!p) return;
      var win = Number(p.award || p.win || p.tumbleWin || 0);
      if (win > 0) climb();
      else if (win === 0) {
        /* D-14.4 (Boki 2026-06-20, industry-reference cross-ref):
         * Industry standard je da multiplier ladder RESETUJE na lose
         * spin (win = 0), ne samo na FS_END. Earlier impl je drzao
         * tier kroz lose spins → naredna win bi nastavila iz prethodnog
         * tier-a. Standard pattern: consecutive-win counter koji se
         * RESET na bilo koji lose. Same pravilo Skeleton Key Bonus tab. */
        if (tier !== startTier) {
          tier = startTier;
          render(startTier);
          try { window.HookBus.emit('onMultLadderReset'); } catch (_) {}
        }
      }
    });
    HookBus.on('onTumbleStep', function (p) {
      if (!climbOnBase && !fsActive) return;
      if (!p) return;
      var win = Number(p.win || p.stepWin || 0);
      if (win > 0) climb();
    });
    HookBus.on('onFsEnd', function () {
      fsActive = false;
      reset();
    });
    /* Synchronise to authoritative value when the canonical owner emits.
     * Idempotent — render is the only DOM mutation. */
    HookBus.on('onMultChange', function (p) {
      if (!p) return;
      var v = Number(p.value || p.mult || 0);
      if (!Number.isFinite(v) || v <= 0) return;
      var idx = STEPS.indexOf(v);
      if (idx < 0) return;
      render(idx);
    });

    /* Boot: pre-render at startTier but stay hidden until FS begins. */
    render(startTier);
  })();
  `;
}
