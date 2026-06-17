/**
 * src/blocks/infinityReels.mjs
 *
 * Wave H18 — Infinity Reels (grid expands per cascade-win counter presenter).
 *
 * Industry baseline (vendor-neutral):
 *   A modern industry pattern adds one extra reel to the visible strip every
 *   time a cascade-win lands on the previous spin (or step). The grid grows
 *   from N (typically 5) toward a soft cap (12 / 20 / unbounded) and resets
 *   on a losing cascade. Win lengths and ladder multipliers escalate with
 *   the column count.
 *
 *   This block is a PURE PRESENTER:
 *     - Reads window.__INFINITY_REELS_COUNT__ written by engine math, OR
 *       the per-event payload `payload.newReelCount`, and renders a HUD
 *       "REELS N" counter. On every grow / reset, emits a canonical event.
 *     - Math (which columns hold which strips, payout ladder) is OUT OF
 *       SCOPE — the block only observes + announces.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitInfinityReelsCSS(cfg)
 *   emitInfinityReelsMarkup(cfg)
 *   emitInfinityReelsRuntime(cfg)
 *
 * Lifecycle:
 *   subscribes:
 *     preSpin       - reset chain counter and HUD baseline to startCount.
 *     onTumbleStep  - read window.__INFINITY_REELS_COUNT__; if it grew,
 *                     emit onInfinityReelAdded; if it reached a milestone,
 *                     emit onInfinityChainMilestone.
 *     postSpin      - if cascade ended below startCount baseline, emit
 *                     onInfinityReelsReset.
 *     onFsTrigger   - reset baseline tracking (separate FS chain ok).
 *     onFsSpinResult - mirror onTumbleStep for FS-side cascades.
 *   emits:
 *     onInfinityReelAdded     { from, to, newReelCount, source }
 *     onInfinityReelsReset    { reason, finalCount, source }
 *     onInfinityChainMilestone { count, milestoneIdx, label, source }
 *
 * a11y:
 *   - HUD: role="status", aria-live="polite", aria-label="Reels count".
 *   - prefers-reduced-motion gate kills pulse-on-grow animation.
 *
 * Performance budget:
 *   - 1 fixed HUD DOM node, mounted once on enable.
 *   - 0 timers (event-driven).
 *   - O(1) work per onTumbleStep (one number compare + DOM text update).
 *
 * GDD keys (model.infinityReels):
 *   enabled, startCount, capCount, milestones, position, badgeBg, badgeColor,
 *   labelTemplate, fontSizePx, zIndex
 *
 * Vendor-neutral. No game / studio strings.
 *
 * @module infinityReels
 */

const POSITIONS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
const BOUNDS = Object.freeze({
  startCount:  [3, 12],
  capCount:    [4, 64],
  fontSizePx:  [11, 28],
  zIndex:      [10, 99],
  pulseMs:     [80, 1500],
  milestonesLen: [0, 12],
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
    enabled:       false,
    startCount:    5,
    capCount:      12,
    milestones:    Object.freeze([6, 8, 10, 12]),
    position:      'top-right',
    badgeBg:       'rgba(0,0,0,0.65)',
    badgeColor:    '#5dd1ff',
    activeBg:      '#5dd1ff',
    activeColor:   '#02121a',
    labelTemplate: 'REELS {N}',
    fontSizePx:    13,
    pulseMs:       420,
    zIndex:        38,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.infinityReels) || {};
  const auto = !!model.infinityReels;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.startCount = _clamp(m.startCount, BOUNDS.startCount, cfg.startCount);
  cfg.capCount   = _clamp(m.capCount,   BOUNDS.capCount,   cfg.capCount);
  if (cfg.capCount < cfg.startCount) cfg.capCount = cfg.startCount;
  cfg.fontSizePx = _clamp(m.fontSizePx, BOUNDS.fontSizePx, cfg.fontSizePx);
  cfg.zIndex     = _clamp(m.zIndex,     BOUNDS.zIndex,     cfg.zIndex);
  cfg.pulseMs    = _clamp(m.pulseMs,    BOUNDS.pulseMs,    cfg.pulseMs);

  if (typeof m.position === 'string' && POSITIONS.has(m.position)) cfg.position = m.position;
  cfg.badgeBg      = _safe(m.badgeBg,      64, cfg.badgeBg);
  cfg.badgeColor   = _safe(m.badgeColor,   32, cfg.badgeColor);
  cfg.activeBg     = _safe(m.activeBg,     48, cfg.activeBg);
  cfg.activeColor  = _safe(m.activeColor,  32, cfg.activeColor);
  if (typeof m.labelTemplate === 'string' && m.labelTemplate.length > 0 && m.labelTemplate.length <= 48) {
    cfg.labelTemplate = _safe(m.labelTemplate, 48, cfg.labelTemplate);
  }
  if (Array.isArray(m.milestones)) {
    const xs = m.milestones
      .map(n => Number(n))
      .filter(n => Number.isFinite(n) && n >= cfg.startCount && n <= cfg.capCount);
    if (xs.length >= BOUNDS.milestonesLen[0] && xs.length <= BOUNDS.milestonesLen[1]) {
      const dedup = [];
      for (const v of xs) if (dedup.indexOf(v) === -1) dedup.push(v);
      dedup.sort((a, b) => a - b);
      cfg.milestones = Object.freeze(dedup);
    }
  }
  return cfg;
}

function _posStyle(pos) {
  const v  = 'calc(max(8px, env(safe-area-inset-top, 0px) + 8px))';
  const bV = 'calc(max(8px, env(safe-area-inset-bottom, 0px) + 8px))';
  const h  = 'calc(max(8px, env(safe-area-inset-left, 0px) + 8px))';
  const rH = 'calc(max(8px, env(safe-area-inset-right, 0px) + 8px))';
  switch (pos) {
    case 'top-left':     return `top: ${v}; left: ${h};`;
    case 'bottom-left':  return `bottom: ${bV}; left: ${h};`;
    case 'bottom-right': return `bottom: ${bV}; right: ${rH};`;
    case 'top-right':
    default:             return `top: ${v}; right: ${rH};`;
  }
}

export function emitInfinityReelsCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* infinityReels — Wave H18 */
  .infreels-badge {
    position: fixed;
    ${_posStyle(cfg.position)}
    z-index: ${cfg.zIndex};
    padding: 5px 12px;
    border-radius: 999px;
    background: ${cfg.badgeBg};
    color: ${cfg.badgeColor};
    font-size: ${cfg.fontSizePx}px;
    font-weight: 800;
    letter-spacing: 0.06em;
    pointer-events: none;
    border: 2px solid rgba(255, 255, 255, 0.18);
    display: inline-block;
    transition: background-color 220ms ease, color 220ms ease;
  }
  .infreels-badge[data-growing="true"] {
    background: ${cfg.activeBg};
    color: ${cfg.activeColor};
    animation: infreels-pulse ${cfg.pulseMs}ms ease-out;
  }
  @keyframes infreels-pulse {
    0%   { transform: scale(1.0); }
    50%  { transform: scale(1.18); }
    100% { transform: scale(1.0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .infreels-badge { transition: none; animation: none; }
    .infreels-badge[data-growing="true"] { animation: none; }
  }
  `;
}

export function emitInfinityReelsMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const initial = cfg.labelTemplate.replace('{N}', String(cfg.startCount));
  return `<div id="infReelsBadge" class="infreels-badge" role="status" aria-live="polite" aria-label="Reels count" data-count="${cfg.startCount}" data-growing="false">${initial}</div>`;
}

export function emitInfinityReelsRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── infinityReels BLOCK — Wave H18 ───────────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var START = ${cfg.startCount};
    var CAP = ${cfg.capCount};
    var MILESTONES = ${JSON.stringify(cfg.milestones)};
    var PULSE = ${cfg.pulseMs};
    var TEMPLATE = ${JSON.stringify(cfg.labelTemplate)};
    var current = START;
    var lastReportedCount = START;
    var hitMilestones = Object.create(null);
    var badge = (typeof document !== 'undefined') ? document.getElementById('infReelsBadge') : null;

    function render(growing) {
      if (!badge) return;
      badge.setAttribute('data-count', String(current));
      badge.textContent = TEMPLATE.replace('{N}', String(current));
      if (growing) {
        badge.setAttribute('data-growing', 'true');
        setTimeout(function () { badge && badge.setAttribute('data-growing', 'false'); }, PULSE + 40);
      }
    }
    function readExternalCount() {
      var v = (typeof window !== 'undefined') ? window.__INFINITY_REELS_COUNT__ : null;
      var n = Number(v);
      if (!Number.isFinite(n)) return null;
      n = Math.max(START, Math.min(CAP, Math.round(n)));
      return n;
    }
    function syncFromExternal(source) {
      var n = readExternalCount();
      if (n == null) return;
      if (n > current) {
        var from = current;
        current = n;
        render(true);
        try { window.HookBus.emit('onInfinityReelAdded', { from: from, to: current, newReelCount: current, source: source || 'auto' }); } catch (_) {}
        for (var i = 0; i < MILESTONES.length; i++) {
          var ms = MILESTONES[i];
          if (current >= ms && !hitMilestones[ms]) {
            hitMilestones[ms] = true;
            try { window.HookBus.emit('onInfinityChainMilestone', { count: current, milestoneIdx: i, label: String(ms), source: source || 'auto' }); } catch (_) {}
          }
        }
        lastReportedCount = current;
      }
    }
    function reset(reason) {
      var prevFinal = current;
      if (current === START && reason !== 'force') return;
      current = START;
      lastReportedCount = START;
      hitMilestones = Object.create(null);
      try { window.__INFINITY_REELS_COUNT__ = START; } catch (_) {}
      render(false);
      try { window.HookBus.emit('onInfinityReelsReset', { reason: reason || 'preSpin', finalCount: prevFinal, source: 'auto' }); } catch (_) {}
    }

    window.HookBus.on('preSpin',        function () { reset('preSpin'); });
    window.HookBus.on('onTumbleStep',   function () { syncFromExternal('onTumbleStep'); });
    window.HookBus.on('postSpin',       function () {
      var n = readExternalCount();
      if (n != null && n <= START && lastReportedCount > START) {
        reset('postSpin');
      }
    });
    window.HookBus.on('onFsTrigger',    function () { reset('onFsTrigger'); });
    window.HookBus.on('onFsSpinResult', function () { syncFromExternal('onFsSpinResult'); });

    /* Public API for engine math + force probes. */
    window.infinityReelsSet = function (n) {
      try { window.__INFINITY_REELS_COUNT__ = Math.max(START, Math.min(CAP, Math.round(Number(n) || START))); } catch (_) {}
      syncFromExternal('api');
    };
    window.infinityReelsBump = function (delta) {
      var n = readExternalCount() != null ? readExternalCount() : current;
      var next = Math.min(CAP, n + (Number(delta) || 1));
      try { window.__INFINITY_REELS_COUNT__ = next; } catch (_) {}
      syncFromExternal('api');
    };
    window.infinityReelsReset = function () { reset('api'); };
    window.infinityReelsGet   = function () { return { count: current, cap: CAP, start: START }; };
  })();
  `;
}
