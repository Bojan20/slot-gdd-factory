/**
 * src/blocks/anticipationUniversal.mjs
 *
 * 2026-06-11 (Boki: "ne radi mi anticipacija u svim gridovima. potpuno
 * sredi anticipaciju u gridovima da bude dvojaka, po jedan na svakom rilu
 * i bilo gde, zavisno od gdd")
 *
 * Additive companion to src/blocks/anticipation.mjs. The original block
 * owns the column-level slowdown for shapes that use RECT_REELS (rect,
 * cluster, megaclusters, lock_respin, expanding, infinity, variable_reel,
 * diamond, pyramid, cross, l_shape). This block adds a SECOND cadence:
 *
 *   1. Per-cell scatter glow on EVERY grid (rect + non-rect). When a
 *      trigger symbol lands on any visible cell, that cell gets a
 *      .cell--anticipating-cell halo so the player can read the scatter
 *      count by eye, not just from the column dimmer/glow.
 *
 *   2. Progress badge top-right of the grid frame — "N / threshold"
 *      counter. Warms into a pulsing throb when scatters ≥ threshold-1
 *      (the classic "one short" beat). Fades out below 1 scatter.
 *
 *   3. Whole-host pulse for shapes WITHOUT reel columns (wheel / plinko /
 *      crash / hex / radial / dual / slingo). When the trigger is alive
 *      and bigger awards remain, the whole grid frame emits a soft gold
 *      ring so the suspense beat is communicated even on shapes whose
 *      engine animation doesn't have a column-stop cadence.
 *
 * This block NEVER touches RECT_REELS state — it only reads it. The
 * original column anticipation continues to own the stop-hold logic.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitAnticipationUniversalCSS(cfg)
 *   emitAnticipationUniversalRuntime(cfg)
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  pulseMs: 700,
  gold: '255,214,110',
  tickMs: 140,
  showBadge: true,
  skipDuringFs: false,
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

function isValidRGB(s) {
  if (typeof s !== 'string') return false;
  const parts = s.split(',').map(p => p.trim());
  if (parts.length !== 3) return false;
  return parts.every(p => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

export function resolveConfig(model) {
  const cfg = defaultConfig();
  const src = (model && model.anticipationUniversal) || (model && model.anticipation) || {};
  if (src.enabled === false) cfg.enabled = false;
  if (typeof src.pulseMs === 'number' && src.pulseMs >= 200 && src.pulseMs <= 5000) {
    cfg.pulseMs = Math.floor(src.pulseMs);
  }
  if (isValidRGB(src.gold)) cfg.gold = src.gold;
  if (typeof src.tickMs === 'number' && src.tickMs >= 60 && src.tickMs <= 1000) {
    cfg.tickMs = Math.floor(src.tickMs);
  }
  if (src.showBadge === false) cfg.showBadge = false;
  if (src.skipDuringFs === true) cfg.skipDuringFs = true;
  return cfg;
}

export function emitAnticipationUniversalCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ anticipationUniversal: cfg });
  if (!c.enabled) return '';
  return `
/* ─── anticipation (universal companion) ───────────────────────────
   Per-cell scatter glow + progress badge + whole-host pulse for shapes
   that have no reel-column anticipation metaphor. */
.cell.cell--anticipating-cell {
  box-shadow: inset 0 0 0 2px rgba(${c.gold}, 0.78),
              inset 0 0 20px rgba(${c.gold}, 0.5),
              0 0 18px rgba(${c.gold}, 0.65) !important;
  animation: ant-uni-cell-pulse ${c.pulseMs}ms ease-in-out infinite !important;
  z-index: 3;
}
@keyframes ant-uni-cell-pulse {
  0%, 100% { box-shadow: inset 0 0 0 2px rgba(${c.gold}, 0.7),
                         inset 0 0 16px rgba(${c.gold}, 0.4),
                         0 0 14px rgba(${c.gold}, 0.5); }
  50%      { box-shadow: inset 0 0 0 2px rgba(255, 235, 178, 1),
                         inset 0 0 26px rgba(${c.gold}, 0.75),
                         0 0 26px rgba(${c.gold}, 0.8); }
}
.gridHost--ant-pulse {
  position: relative;
}
.gridHost--ant-pulse::after {
  content: '';
  position: absolute;
  inset: -6px;
  border-radius: 14px;
  pointer-events: none;
  box-shadow: 0 0 0 2px rgba(${c.gold}, 0.55),
              0 0 32px rgba(${c.gold}, 0.45);
  animation: ant-uni-host-pulse ${c.pulseMs}ms ease-in-out infinite;
  z-index: 1;
}
@keyframes ant-uni-host-pulse {
  0%, 100% { box-shadow: 0 0 0 2px rgba(${c.gold}, 0.5),
                         0 0 28px rgba(${c.gold}, 0.4); }
  50%      { box-shadow: 0 0 0 3px rgba(255, 235, 178, 0.9),
                         0 0 52px rgba(${c.gold}, 0.75); }
}
${c.showBadge ? `.ant-badge {
  position: absolute;
  top: 10px; right: 10px;
  z-index: 80;
  background: linear-gradient(180deg, rgba(40,30,8,0.92), rgba(20,14,4,0.95));
  border: 1px solid rgba(${c.gold}, 0.85);
  border-radius: 14px;
  padding: 0.42rem 0.85rem;
  color: rgba(${c.gold}, 1);
  font: 900 0.82rem/1 system-ui, -apple-system, "SF Pro Display", "Segoe UI", sans-serif;
  letter-spacing: 0.12em;
  text-shadow: 0 0 8px rgba(${c.gold}, 0.7);
  box-shadow: 0 0 14px rgba(${c.gold}, 0.5);
  opacity: 0;
  transform: translateY(-4px) scale(0.92);
  transition: opacity 220ms ease, transform 220ms cubic-bezier(.2,1.3,.4,1);
  pointer-events: none;
  user-select: none;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.ant-badge[data-show="true"] {
  opacity: 1;
  transform: translateY(0) scale(1);
}
.ant-badge[data-warm="true"] {
  animation: ant-badge-warm ${c.pulseMs}ms ease-in-out infinite;
}
@keyframes ant-badge-warm {
  0%, 100% { box-shadow: 0 0 14px rgba(${c.gold}, 0.5); }
  50%      { box-shadow: 0 0 26px rgba(${c.gold}, 0.95); }
}
.ant-badge__num { font-size: 1.05rem; }
.ant-badge__sep { opacity: 0.7; }` : ''}
@media (prefers-reduced-motion: reduce) {
  .cell.cell--anticipating-cell,
  .gridHost--ant-pulse::after${c.showBadge ? `,
  .ant-badge[data-warm="true"]` : ''} { animation: none; }
}
`;
}

export function emitAnticipationUniversalRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ anticipationUniversal: cfg });
  if (!c.enabled) return `/* anticipationUniversal: disabled */`;
  return `
/* ─── anticipation (universal companion) runtime ──────────────────── */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var ANT_UNI_TICK_MS = ${c.tickMs};
  var ANT_UNI_SHOW_BADGE = ${c.showBadge};
  ${c.skipDuringFs ? `var ANT_UNI_SKIP_FS = true;` : `var ANT_UNI_SKIP_FS = false;`}
  /* Shapes that own their suspense via engine animation (spinning pointer,
   * climbing multiplier, falling ball). For them we skip per-cell glow
   * (their grid often has no .cell elements anyway, e.g. wheel/radial
   * are SVG) and rely on the whole-host pulse + badge counter. */
  var ANT_UNI_ENGINE_PULSE_ONLY = new Set(['wheel', 'plinko', 'crash', 'radial', 'slingo']);

  /* ARMED gate — closed initially so idle random fillers that happen to
   * carry the trigger symbol DON'T get a halo before any spin has even
   * run. Industry-standard semantic: anticipation halo lives ONLY between
   * a postSpin landing and the NEXT preSpin start — i.e. while the player
   * is reading the just-landed scatter count. */
  var ANT_UNI_ARMED = false;
  var ANT_UNI_SPINNING = false;

  function _canRun() {
    if (!ANT_UNI_ARMED) return false;
    if (ANT_UNI_SPINNING) return false;
    if (ANT_UNI_SKIP_FS) {
      try {
        if (typeof window.FSM !== 'undefined' && window.FSM && window.FSM.phase &&
            window.FSM.phase !== 'BASE') return false;
      } catch (_) {}
    }
    try {
      if (window.FORCE_TRIGGER && window.FORCE_TRIGGER.scatterCount > 0) return false;
    } catch (_) {}
    return true;
  }

  function _readLadder() {
    var threshold = 3, topRung = 5;
    try {
      var fs = window.FREESPINS;
      if (fs) {
        threshold = (fs.triggerCounts && fs.triggerCounts[0]) ||
                    (fs.awards && fs.awards[0] && fs.awards[0].count) || 3;
        topRung = (fs.awards || []).reduce(function (m, a) {
          return Math.max(m, a.count);
        }, threshold);
      }
    } catch (_) {}
    return { threshold: threshold, topRung: topRung };
  }
  function _trigSym() {
    try {
      var fs = window.FREESPINS;
      if (fs) return String(fs.triggerSymbol || 'S').toUpperCase();
    } catch (_) {}
    return 'S';
  }
  function _shapeKind() {
    try {
      if (window.SHAPE && window.SHAPE.kind) return String(window.SHAPE.kind);
    } catch (_) {}
    return 'rectangular';
  }

  function _ensureBadge(host) {
    if (!ANT_UNI_SHOW_BADGE) return null;
    var badge = document.getElementById('antBadge');
    if (badge) return badge;
    badge = document.createElement('div');
    badge.id = 'antBadge';
    badge.className = 'ant-badge';
    badge.dataset.show = 'false';
    badge.innerHTML = '<span aria-hidden="true">🎯</span> ' +
      '<span class="ant-badge__num" id="antBadgeNum">0</span>' +
      '<span class="ant-badge__sep">/</span>' +
      '<span class="ant-badge__num" id="antBadgeThr">3</span>';
    var anchor = (host && host.parentElement) || host;
    if (anchor) {
      try {
        var cs = getComputedStyle(anchor);
        if (cs.position === 'static') anchor.style.position = 'relative';
      } catch (_) {}
      anchor.appendChild(badge);
    }
    return badge;
  }
  function _paintBadge(scatters, threshold, warm) {
    var host = document.getElementById('gridHost');
    if (!host) return;
    var badge = _ensureBadge(host);
    if (!badge) return;
    var n = document.getElementById('antBadgeNum');
    var t = document.getElementById('antBadgeThr');
    if (n) n.textContent = String(scatters);
    if (t) t.textContent = String(threshold);
    badge.dataset.show = scatters > 0 ? 'true' : 'false';
    badge.dataset.warm = warm ? 'true' : 'false';
  }

  function _tick() {
    if (!_canRun()) {
      /* Clean up state when we're in a phase that shouldn't show
       * anticipation (FS lifecycle, force-trigger spin). */
      _paintBadge(0, 3, false);
      var host = document.getElementById('gridHost');
      if (host) host.classList.remove('gridHost--ant-pulse');
      return;
    }
    var host = document.getElementById('gridHost');
    if (!host) return;
    var ladder = _readLadder();
    var trig = _trigSym();
    var kind = _shapeKind();

    var cells = host.querySelectorAll('.cell');
    if (cells.length === 0) {
      /* SVG-based shape (wheel/radial). Show badge only when FS enabled
       * + use whole-host pulse based on natural progress signals from
       * the engine. For these shapes the count cannot be derived from
       * .cell text so we just keep badge at 0. */
      _paintBadge(0, ladder.threshold, false);
      host.classList.remove('gridHost--ant-pulse');
      return;
    }

    var scatterCells = [];
    for (var i = 0; i < cells.length; i++) {
      var txt = (cells[i].textContent || '').trim().toUpperCase();
      if (txt === trig) scatterCells.push(cells[i]);
    }
    var scattersSoFar = scatterCells.length;

    /* Light up every visible trigger cell. */
    for (var j = 0; j < scatterCells.length; j++) {
      if (!scatterCells[j].classList.contains('cell--anticipating-cell')) {
        scatterCells[j].classList.add('cell--anticipating-cell');
      }
    }
    /* Strip from cells that no longer carry the trigger. */
    var marked = host.querySelectorAll('.cell.cell--anticipating-cell');
    for (var k = 0; k < marked.length; k++) {
      if (scatterCells.indexOf(marked[k]) === -1) {
        marked[k].classList.remove('cell--anticipating-cell');
      }
    }

    var warm = scattersSoFar >= Math.max(1, ladder.threshold - 1) && scattersSoFar < ladder.topRung;
    _paintBadge(scattersSoFar, ladder.threshold, warm);

    /* Whole-host pulse for non-rect shapes. */
    var useHostPulse = kind !== 'rectangular' &&
                       kind !== 'cluster' &&
                       kind !== 'megaclusters' &&
                       kind !== 'lock_respin' &&
                       kind !== 'expanding' &&
                       kind !== 'infinity' &&
                       kind !== 'variable_reel';
    if (useHostPulse && warm) host.classList.add('gridHost--ant-pulse');
    else host.classList.remove('gridHost--ant-pulse');
  }

  function _resetAll() {
    var host = document.getElementById('gridHost');
    if (!host) return;
    host.classList.remove('gridHost--ant-pulse');
    var marked = host.querySelectorAll('.cell.cell--anticipating-cell');
    for (var i = 0; i < marked.length; i++) {
      marked[i].classList.remove('cell--anticipating-cell');
    }
    _paintBadge(0, _readLadder().threshold, false);
  }
  function _disarm() {
    /* Player just started the next spin — strip last spin's halos
     * and close the gate until postSpin re-arms. */
    ANT_UNI_ARMED = false;
    ANT_UNI_SPINNING = true;
    _resetAll();
  }
  function _arm() {
    /* Spin landed. Open the gate so _tick can paint halos on the
     * just-resolved cells. */
    ANT_UNI_SPINNING = false;
    ANT_UNI_ARMED = true;
    _tick();   /* paint immediately so player sees halo on landed scatters
                * without waiting up to ANT_UNI_TICK_MS for next interval. */
  }
  if (typeof HookBus !== 'undefined') {
    try {
      HookBus.on('preSpin',     _disarm, { priority: 8 });
      HookBus.on('postSpin',    _arm,    { priority: 8 });
      HookBus.on('onTumbleStep', _arm,   { priority: 8 });
      HookBus.on('onFsTrigger', _disarm, { priority: 8 });
      HookBus.on('onFsEnd',     _disarm, { priority: 8 });
    } catch (_) {}
  }

  if (window.__ANT_UNI_TICK_ID__) clearInterval(window.__ANT_UNI_TICK_ID__);
  window.__ANT_UNI_TICK_ID__ = setInterval(_tick, ANT_UNI_TICK_MS);
  window._antUniTick = _tick;
})();
`;
}
