/**
 * src/blocks/cascadeBooster.mjs
 *
 * Wave H15 — Cascade Booster (per-cascade-depth multiplier escalation).
 *
 * Industry baseline (vendor-neutral):
 *   Tumble/cascade-pays slots commonly escalate a session-multiplier each
 *   time a cascade step lands additional wins. The booster usually follows
 *   a ladder (e.g. ×1 → ×2 → ×3 → ×5 → ×10) and persists within the spin.
 *
 *   Pure presenter — listens to onTumbleStep with a winning step and bumps
 *   a chip badge. Engine logic is unchanged; this only mirrors state.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitCascadeBoosterCSS(cfg)
 *   emitCascadeBoosterMarkup(cfg)
 *   emitCascadeBoosterRuntime(cfg)
 *
 * Lifecycle:
 *   subscribes:
 *     preSpin           → reset chip to ladder[0]
 *     onTumbleStep      → bump on step with win
 *     postSpin          → keep chip visible until next preSpin
 *     onFsEnd           → reset
 *   emits:
 *     onCascadeBoosterTick { from, to, depth, ladderIdx }
 *     onCascadeBoosterReset { reason }
 *
 * a11y:
 *   - role="status" + aria-live="polite".
 *   - prefers-reduced-motion kills the escalation pulse.
 *
 * Vendor-neutral.
 *
 * @module cascadeBooster
 */

const POSITIONS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
const BOUNDS = Object.freeze({
  fontSizePx: [11, 24],
  pulseMs:    [200, 1500],
  zIndex:     [10, 99],
});

function _clamp(v, [lo, hi], fb) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
}
function _safe(v, max, fb) {
  if (typeof v !== 'string') return fb;
  const s = v.replace(/[<>"'`]/g, '').slice(0, max);
  return s.length ? s : fb;
}

export function defaultConfig() {
  return Object.freeze({
    enabled:        false,
    ladder:         Object.freeze([1, 2, 3, 5, 10]),
    position:       'bottom-left',
    fontSizePx:     12,
    pulseMs:        420,
    zIndex:         32,
    labelTemplate:  'BOOST ×{N}',
    bgColor:        'rgba(0,0,0,0.55)',
    fgColor:        '#f2f2f2',
    activeBg:       '#ffd84d',
    activeFg:       '#03110a',
    requireStepWin: true,         /* only bump on step with stepWin > 0 */
    hideAtBase:     true,         /* hide when at ladder[0]=×1 */
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.cascadeBooster) || {};
  const auto = !!model.cascadeBooster;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  if (typeof m.position === 'string' && POSITIONS.has(m.position)) cfg.position = m.position;
  cfg.fontSizePx = _clamp(m.fontSizePx, BOUNDS.fontSizePx, cfg.fontSizePx);
  cfg.pulseMs    = _clamp(m.pulseMs,    BOUNDS.pulseMs,    cfg.pulseMs);
  cfg.zIndex     = _clamp(m.zIndex,     BOUNDS.zIndex,     cfg.zIndex);
  cfg.bgColor    = _safe(m.bgColor,    64, cfg.bgColor);
  cfg.fgColor    = _safe(m.fgColor,    32, cfg.fgColor);
  cfg.activeBg   = _safe(m.activeBg,   48, cfg.activeBg);
  cfg.activeFg   = _safe(m.activeFg,   32, cfg.activeFg);
  if (typeof m.labelTemplate === 'string' && m.labelTemplate.length > 0 && m.labelTemplate.length <= 48) {
    cfg.labelTemplate = _safe(m.labelTemplate, 48, cfg.labelTemplate);
  }
  if (typeof m.requireStepWin === 'boolean') cfg.requireStepWin = m.requireStepWin;
  if (typeof m.hideAtBase     === 'boolean') cfg.hideAtBase     = m.hideAtBase;

  if (Array.isArray(m.ladder)) {
    var ladder = m.ladder
      .map(n => Number(n))
      .filter(n => Number.isFinite(n) && n >= 1 && n <= 1000);
    if (ladder.length >= 2 && ladder.length <= 20) {
      var clean = [];
      for (var i = 0; i < ladder.length; i++) {
        if (clean.length === 0 || ladder[i] >= clean[clean.length - 1]) clean.push(ladder[i]);
      }
      if (clean.length >= 2) cfg.ladder = Object.freeze(clean);
    }
  }
  return cfg;
}

function _posStyle(pos) {
  const v = 'calc(max(8px, env(safe-area-inset-top, 0px) + 8px))';
  const h = 'calc(max(8px, env(safe-area-inset-left, 0px) + 8px))';
  const bV = 'calc(max(8px, env(safe-area-inset-bottom, 0px) + 8px))';
  const rH = 'calc(max(8px, env(safe-area-inset-right, 0px) + 8px))';
  switch (pos) {
    case 'top-left':     return `top: ${v}; left: ${h};`;
    case 'top-right':    return `top: ${v}; right: ${rH};`;
    case 'bottom-right': return `bottom: ${bV}; right: ${rH};`;
    case 'bottom-left':
    default:             return `bottom: ${bV}; left: ${h};`;
  }
}

export function emitCascadeBoosterCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* cascadeBooster — Wave H15 */
  .cb-chip {
    position: fixed;
    ${_posStyle(cfg.position)}
    z-index: ${cfg.zIndex};
    padding: 5px 12px;
    border-radius: 999px;
    background: ${cfg.bgColor};
    color: ${cfg.fgColor};
    font-size: ${cfg.fontSizePx}px;
    font-weight: 800;
    letter-spacing: 0.06em;
    pointer-events: none;
    display: none;
    border: 2px solid rgba(255,255,255,0.18);
    transition: background-color 220ms ease, color 220ms ease;
  }
  .cb-chip[data-visible="true"] { display: inline-block; }
  .cb-chip[data-bumping="true"] {
    background: ${cfg.activeBg};
    color: ${cfg.activeFg};
    animation: cb-chip-pulse ${cfg.pulseMs}ms ease-out;
  }
  @keyframes cb-chip-pulse {
    0%   { transform: scale(1.0); }
    50%  { transform: scale(1.15); }
    100% { transform: scale(1.0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .cb-chip { transition: none; animation: none; }
  }
  `;
}

export function emitCascadeBoosterMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="cbChip" class="cb-chip" role="status" aria-live="polite" aria-label="Cascade booster multiplier" data-visible="false" data-bumping="false" data-mult="1">BOOST ×1</div>`;
}

export function emitCascadeBoosterRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── cascadeBooster BLOCK — Wave H15 ──────────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var LADDER = ${JSON.stringify(cfg.ladder)};
    var TEMPLATE = ${JSON.stringify(cfg.labelTemplate)};
    var PULSE = ${cfg.pulseMs};
    var REQUIRE_WIN = ${JSON.stringify(cfg.requireStepWin)};
    var HIDE_BASE = ${JSON.stringify(cfg.hideAtBase)};
    var idx = 0;
    var depth = 0;
    var chip = (typeof document !== 'undefined') ? document.getElementById('cbChip') : null;

    function cur() { return LADDER[Math.max(0, Math.min(LADDER.length - 1, idx))] || 1; }
    function render(bumping) {
      if (!chip) return;
      var v = cur();
      chip.setAttribute('data-mult', String(v));
      chip.textContent = TEMPLATE.replace('{N}', String(v));
      var visible = !(HIDE_BASE && idx === 0);
      chip.setAttribute('data-visible', visible ? 'true' : 'false');
      if (bumping) {
        chip.setAttribute('data-bumping', 'true');
        setTimeout(function () { chip && chip.setAttribute('data-bumping', 'false'); }, PULSE + 60);
      }
    }
    function bump(source) {
      var from = cur();
      var next = Math.min(LADDER.length - 1, idx + 1);
      if (next === idx) return;
      idx = next;
      depth++;
      var to = cur();
      render(true);
      try { window.HookBus.emit('onCascadeBoosterTick', { from: from, to: to, depth: depth, ladderIdx: idx, source: source || 'auto' }); } catch (_) {}
    }
    function reset(reason) {
      idx = 0;
      depth = 0;
      render(false);
      try { window.HookBus.emit('onCascadeBoosterReset', { reason: reason || 'auto' }); } catch (_) {}
    }

    /* F3 priority 30 — decorator class (multiplier accumulator peer of
       multiplierOrb + persistentMultiplier). Mutates the cascade-depth
       booster after payout evaluators have settled per-step wins. */
    window.HookBus.on('preSpin', function () { reset('preSpin'); }, { priority: 30 });
    window.HookBus.on('onTumbleStep', function (p) {
      if (REQUIRE_WIN) {
        var win = p ? Number(p.stepWin || p.win || 0) : 0;
        if (win <= 0) return;
      }
      bump('onTumbleStep');
    }, { priority: 30 });
    window.HookBus.on('onFsEnd', function () { reset('onFsEnd'); }, { priority: 30 });

    window.cascadeBoosterBump  = function () { bump('api'); };
    window.cascadeBoosterReset = function () { reset('api'); };
    window.cascadeBoosterGet   = function () { return { mult: cur(), depth: depth, ladderIdx: idx }; };

    render(false);
  })();
  `;
}
