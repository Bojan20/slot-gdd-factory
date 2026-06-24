import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/superchargedFs.mjs
 *
 * Wave H14 — Supercharged FS (free-spins retrigger multiplier escalation).
 *
 * Industry baseline (vendor-neutral):
 *   Many modern slots escalate a session-multiplier each time the player
 *   re-triggers free spins inside the FS round. This block presents a
 *   "FS MULT ×N" badge and emits the escalation lifecycle.
 *
 *   Pure presenter — engine drives onFsTrigger / onFsRetrigger; this block
 *   tracks the count + computes multiplier via a configurable ladder.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitSuperchargedFsCSS(cfg)
 *   emitSuperchargedFsMarkup(cfg)
 *   emitSuperchargedFsRuntime(cfg)
 *
 * Lifecycle:
 *   subscribes:
 *     onFsTrigger        → init multiplier to ladder[0]
 *     onFsRetrigger      → step ladder index, emit escalation
 *     onFsEnd            → reset state, hide badge
 *   emits:
 *     onFsMultiplierEscalated { from, to, retriggerCount, ladderIdx }
 *     onFsSuperchargeReset    { reason }
 *
 * a11y:
 *   - role="status" + aria-live="polite" + aria-label="Free-spins multiplier".
 *   - prefers-reduced-motion kills the escalation pulse.
 *
 * Vendor-neutral.
 *
 * @module superchargedFs
 */

const POSITIONS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
const BOUNDS = Object.freeze({
  fontSizePx: [11, 28],
  pulseMs:    [200, 2000],
  zIndex:     [10, 99],
  ladderLen:  [2, 20],
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
    position:       'top-left',
    fontSizePx:     13,
    pulseMs:        540,
    zIndex:         35,
    labelTemplate:  'FS MULT ×{N}',
    bgColor:        'rgba(0,0,0,0.65)',
    fgColor:        '#ffd84d',
    activeBg:       '#ffd84d',
    activeFg:       '#03110a',
    hideWhenOne:    false,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.superchargedFs) || {};
  const auto = !!model.superchargedFs;
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
  if (typeof m.hideWhenOne === 'boolean') cfg.hideWhenOne = m.hideWhenOne;

  if (Array.isArray(m.ladder)) {
    var ladder = m.ladder
      .map(n => Number(n))
      .filter(n => Number.isFinite(n) && n >= 1 && n <= 1000);
    if (ladder.length >= BOUNDS.ladderLen[0] && ladder.length <= BOUNDS.ladderLen[1]) {
      /* Enforce monotonic non-decreasing — drop steps that violate. */
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
    case 'top-right':    return `top: ${v}; right: ${rH};`;
    case 'bottom-left':  return `bottom: ${bV}; left: ${h};`;
    case 'bottom-right': return `bottom: ${bV}; right: ${rH};`;
    case 'top-left':
    default:             return `top: ${v}; left: ${h};`;
  }
}

export function emitSuperchargedFsCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* superchargedFs — Wave H14 */
  .sfs-badge {
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
    border: 2px solid rgba(255,255,255,0.2);
    transition: background-color 220ms ease, color 220ms ease;
  }
  .sfs-badge[data-visible="true"] { display: inline-block; }
  .sfs-badge[data-escalating="true"] {
    background: ${cfg.activeBg};
    color: ${cfg.activeFg};
    animation: sfs-pulse ${cfg.pulseMs}ms ease-out;
  }
  @keyframes sfs-pulse {
    0%   { transform: scale(1.0); }
    40%  { transform: scale(1.18); }
    100% { transform: scale(1.0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .sfs-badge { transition: none; animation: none; }
  }
  `;
}

export function emitSuperchargedFsMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<div id="sfsBadge" class="sfs-badge" role="status" aria-live="polite" aria-label="Free-spins multiplier" data-visible="false" data-escalating="false" data-mult="1">FS MULT ×1</div>`, 'superchargedFs');
}

export function emitSuperchargedFsRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── superchargedFs BLOCK — Wave H14 ──────────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var LADDER = ${JSON.stringify(cfg.ladder)};
    var TEMPLATE = ${JSON.stringify(cfg.labelTemplate)};
    var PULSE = ${cfg.pulseMs};
    var HIDE_ONE = ${JSON.stringify(cfg.hideWhenOne)};
    var ladderIdx = -1;
    var retriggers = 0;
    var badge = (typeof document !== 'undefined') ? document.getElementById('sfsBadge') : null;

    function curMult() { return LADDER[Math.max(0, Math.min(LADDER.length - 1, ladderIdx))] || 1; }
    function render(escalating) {
      if (!badge) return;
      var v = curMult();
      badge.setAttribute('data-mult', String(v));
      badge.textContent = TEMPLATE.replace('{N}', String(v));
      var visible = !(HIDE_ONE && v === 1) && ladderIdx >= 0;
      badge.setAttribute('data-visible', visible ? 'true' : 'false');
      if (escalating) {
        badge.setAttribute('data-escalating', 'true');
        setTimeout(function () { badge && badge.setAttribute('data-escalating', 'false'); }, PULSE + 60);
      }
    }
    function init(source) {
      ladderIdx = 0;
      retriggers = 0;
      render(false);
    }
    function step(source) {
      var from = curMult();
      var next = Math.min(LADDER.length - 1, ladderIdx + 1);
      if (next === ladderIdx) return;
      ladderIdx = next;
      retriggers++;
      var to = curMult();
      render(true);
      try { window.HookBus.emit('onFsMultiplierEscalated', { from: from, to: to, retriggerCount: retriggers, ladderIdx: ladderIdx, source: source || 'auto' }); } catch (_) {}
    }
    function reset(reason) {
      ladderIdx = -1;
      retriggers = 0;
      if (badge) {
        badge.setAttribute('data-visible', 'false');
        badge.setAttribute('data-escalating', 'false');
      }
      try { window.HookBus.emit('onFsSuperchargeReset', { reason: reason || 'auto' }); } catch (_) {}
    }

    /* Bug #5 (2026-06-17, recursion guard) — superchargedFsAnnounceRetrigger
     * emits onFsRetrigger which this block also LISTENS to. If a downstream
     * listener calls Announce in response to onFsMultiplierEscalated, the
     * loop is infinite. Hard cap depth at 16. */
    var _reentrancyDepth = 0;
    var MAX_REENTRANCY = 16;

    window.HookBus.on('onFsTrigger',   function () { init('onFsTrigger'); });
    window.HookBus.on('onFsRetrigger', function () {
      if (_reentrancyDepth >= MAX_REENTRANCY) return;
      _reentrancyDepth++;
      try { step('onFsRetrigger'); }
      finally { _reentrancyDepth--; }
    });
    window.HookBus.on('onFsEnd',       function () { reset('onFsEnd'); });

    /* Public API. */
    window.superchargedFsStep   = function () { step('api'); };
    window.superchargedFsReset  = function () { reset('api'); };
    window.superchargedFsGet    = function () { return { mult: curMult(), retriggers: retriggers, ladderIdx: ladderIdx }; };
    /* Engine-facing announcement helper: emits onFsRetrigger from this block
     * so the canonical event has a sole owner per LEGO single-owner-emit.
     * Re-entrancy guarded above. */
    window.superchargedFsAnnounceRetrigger = function () {
      if (_reentrancyDepth >= MAX_REENTRANCY) return;
      try { window.HookBus.emit('onFsRetrigger', {}); } catch (_) {}
    };
  })();
  `;
}
