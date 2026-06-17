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
 *
 * Wave Legacy · industry baseline (vendor-neutral). Original block predates the
 * formal Wave Hxx naming + JSDoc kontrakt header pattern (auto-tagged by
 * tools/cortex-block-mega-fix.mjs).
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  pulseMs: 700,
  gold: '255,214,110',
  warmCore: '255,235,178',
  tickMs: 140,
  showBadge: true,
  skipDuringFs: false,
  /* Force-trigger spins are the dev/QA preview path — keep the halo
     visible by default. Flip to true via GDD to opt out. */
  suppressOnForceTrigger: false,
  fallbackThreshold: 3,
  fallbackTopRung: 5,
  fallbackTriggerSymbol: 'S',
  fallbackShapeKind: 'rectangular',
  badgeInsetPx: 6,
  badgeRadiusPx: 14,
  badgeTopPx: 10,
  badgeRightPx: 10,
  badgeOffsetPx: 4,
  badgeScale: 0.92,
  transitionMs: 220,
  zBadge: 80,
  zCell: 3,
  zHostPulse: 1,
  hookBusRetries: 20,
  hookBusRetryMs: 50,
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
  const cfg = { ...defaultConfig() };
  const src = (model && model.anticipationUniversal) || (model && model.anticipation) || {};
  if (src.enabled === false) cfg.enabled = false;
  if (typeof src.pulseMs === 'number' && src.pulseMs >= 200 && src.pulseMs <= 5000) {
    cfg.pulseMs = Math.floor(src.pulseMs);
  }
  if (isValidRGB(src.gold)) cfg.gold = src.gold;
  if (isValidRGB(src.warmCore)) cfg.warmCore = src.warmCore;
  if (typeof src.tickMs === 'number' && src.tickMs >= 60 && src.tickMs <= 1000) {
    cfg.tickMs = Math.floor(src.tickMs);
  }
  if (src.showBadge === false) cfg.showBadge = false;
  if (src.skipDuringFs === true) cfg.skipDuringFs = true;
  if (src.suppressOnForceTrigger === true) cfg.suppressOnForceTrigger = true;
  if (typeof src.fallbackThreshold === 'number' && src.fallbackThreshold >= 1) {
    cfg.fallbackThreshold = Math.floor(src.fallbackThreshold);
  }
  if (typeof src.fallbackTopRung === 'number' && src.fallbackTopRung >= 1) {
    cfg.fallbackTopRung = Math.floor(src.fallbackTopRung);
  }
  if (typeof src.fallbackTriggerSymbol === 'string' && src.fallbackTriggerSymbol.length > 0) {
    cfg.fallbackTriggerSymbol = String(src.fallbackTriggerSymbol).toUpperCase();
  }
  if (typeof src.fallbackShapeKind === 'string' && src.fallbackShapeKind.length > 0) {
    cfg.fallbackShapeKind = src.fallbackShapeKind;
  }
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
  z-index: ${c.zCell};
}
@keyframes ant-uni-cell-pulse {
  0%, 100% { box-shadow: inset 0 0 0 2px rgba(${c.gold}, 0.7),
                         inset 0 0 16px rgba(${c.gold}, 0.4),
                         0 0 14px rgba(${c.gold}, 0.5); }
  50%      { box-shadow: inset 0 0 0 2px rgba(${c.warmCore}, 1),
                         inset 0 0 26px rgba(${c.gold}, 0.75),
                         0 0 26px rgba(${c.gold}, 0.8); }
}
.gridHost--ant-pulse {
  position: relative;
}
.gridHost--ant-pulse::after {
  content: '';
  position: absolute;
  inset: -${c.badgeInsetPx}px;
  border-radius: ${c.badgeRadiusPx}px;
  pointer-events: none;
  box-shadow: 0 0 0 2px rgba(${c.gold}, 0.55),
              0 0 32px rgba(${c.gold}, 0.45);
  animation: ant-uni-host-pulse ${c.pulseMs}ms ease-in-out infinite;
  z-index: ${c.zHostPulse};
}
@keyframes ant-uni-host-pulse {
  0%, 100% { box-shadow: 0 0 0 2px rgba(${c.gold}, 0.5),
                         0 0 28px rgba(${c.gold}, 0.4); }
  50%      { box-shadow: 0 0 0 3px rgba(${c.warmCore}, 0.9),
                         0 0 52px rgba(${c.gold}, 0.75); }
}
${c.showBadge ? `.ant-badge {
  position: absolute;
  top: ${c.badgeTopPx}px; right: ${c.badgeRightPx}px;
  z-index: ${c.zBadge};
  background: linear-gradient(180deg, rgba(40,30,8,0.92), rgba(20,14,4,0.95));
  border: 1px solid rgba(${c.gold}, 0.85);
  border-radius: ${c.badgeRadiusPx}px;
  padding: 0.42rem 0.85rem;
  color: rgba(${c.gold}, 1);
  font: 900 0.82rem/1 system-ui, -apple-system, "SF Pro Display", "Segoe UI", sans-serif;
  letter-spacing: 0.12em;
  text-shadow: 0 0 8px rgba(${c.gold}, 0.7);
  box-shadow: 0 0 14px rgba(${c.gold}, 0.5);
  opacity: 0;
  transform: translateY(-${c.badgeOffsetPx}px) scale(${c.badgeScale});
  transition: opacity ${c.transitionMs}ms ease, transform ${c.transitionMs}ms cubic-bezier(.2,1.3,.4,1);
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
/* ─── anticipation (universal companion) runtime ────────────────────
 * PERF BUDGET: ≤ 0.4ms/tick @ 60 .cell, ${c.tickMs}ms interval.
 *   • Cell-diff uses Set membership (O(n)) instead of indexOf (O(n²)).
 *   • Badge writes diff textContent/dataset before mutating to avoid
 *     style-recalc churn on idle ticks.
 *   • HookBus subscription is sentinel-gated to survive hot-reload. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var ANT_UNI_TICK_MS = ${c.tickMs};
  var ANT_UNI_SHOW_BADGE = ${c.showBadge};
  ${c.skipDuringFs ? `var ANT_UNI_SKIP_FS = true;` : `var ANT_UNI_SKIP_FS = false;`}
  var ANT_UNI_SUPPRESS_ON_FORCE = ${c.suppressOnForceTrigger ? 'true' : 'false'};
  var ANT_UNI_FALLBACK_THRESHOLD = ${c.fallbackThreshold};
  var ANT_UNI_FALLBACK_TOPRUNG   = ${c.fallbackTopRung};
  var ANT_UNI_FALLBACK_TRIGSYM   = ${JSON.stringify(c.fallbackTriggerSymbol)};
  var ANT_UNI_FALLBACK_SHAPEKIND = ${JSON.stringify(c.fallbackShapeKind)};
  var ANT_UNI_HOOKBUS_RETRIES    = ${c.hookBusRetries};
  var ANT_UNI_HOOKBUS_RETRY_MS   = ${c.hookBusRetryMs};

  var ANT_UNI_FALLBACK_WARNED = false;
  function _warnFallback(field) {
    if (ANT_UNI_FALLBACK_WARNED) return;
    ANT_UNI_FALLBACK_WARNED = true;
    try { console.warn('[anticipationUniversal] FREESPINS schema missing/malformed — using fallback (' + field + ')'); } catch (_) {}
  }

  /* Shapes that own their suspense via engine animation (spinning pointer,
   * climbing multiplier, falling ball). For them we skip per-cell glow
   * (their grid often has no .cell elements anyway, e.g. wheel/radial
   * are SVG) and emit ONLY the host pulse + badge counter. */
  var ANT_UNI_ENGINE_PULSE_ONLY = new Set(['wheel', 'plinko', 'crash', 'radial', 'slingo']);

  /* Single-owner registry for rect-reel kinds — column anticipation lives
   * in anticipation.mjs. Read from window.__ANT_RECT_KINDS__ if that block
   * published one; fall back so this block keeps working standalone. */
  var ANT_UNI_RECT_KINDS = (window.__ANT_RECT_KINDS__ instanceof Set)
    ? window.__ANT_RECT_KINDS__
    : new Set(['rectangular','cluster','megaclusters','lock_respin','expanding','infinity','variable_reel','diamond','pyramid','cross','l_shape']);

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
    /* Force-trigger spins are the dev/QA preview surface — only suppress
     * the halo if the GDD explicitly opts in via suppressOnForceTrigger. */
    if (ANT_UNI_SUPPRESS_ON_FORCE) {
      try {
        if (window.FORCE_TRIGGER && window.FORCE_TRIGGER.scatterCount > 0) return false;
      } catch (_) {}
    }
    return true;
  }

  function _readLadder() {
    var threshold = ANT_UNI_FALLBACK_THRESHOLD;
    var topRung = ANT_UNI_FALLBACK_TOPRUNG;
    var usedFallback = true;
    try {
      var fs = window.FREESPINS;
      if (fs) {
        var t = (fs.triggerCounts && fs.triggerCounts[0]) ||
                (fs.awards && fs.awards[0] && fs.awards[0].count);
        if (t) { threshold = t; usedFallback = false; }
        if (Array.isArray(fs.awards) && fs.awards.length) {
          topRung = fs.awards.reduce(function (m, a) { return Math.max(m, a.count); }, threshold);
        }
      }
    } catch (_) {}
    if (usedFallback) _warnFallback('triggerCounts/awards');
    return { threshold: threshold, topRung: topRung };
  }
  function _trigSym() {
    try {
      var fs = window.FREESPINS;
      if (fs && fs.triggerSymbol) return String(fs.triggerSymbol).toUpperCase();
    } catch (_) {}
    _warnFallback('triggerSymbol');
    return ANT_UNI_FALLBACK_TRIGSYM;
  }
  function _shapeKind() {
    try {
      if (window.SHAPE && window.SHAPE.kind) return String(window.SHAPE.kind);
    } catch (_) {}
    return ANT_UNI_FALLBACK_SHAPEKIND;
  }

  function _ensureBadge(host) {
    if (!ANT_UNI_SHOW_BADGE) return null;
    var badge = document.getElementById('antBadge');
    if (badge) return badge;
    badge = document.createElement('div');
    badge.id = 'antBadge';
    badge.className = 'ant-badge';
    badge.dataset.show = 'false';
    /* Accessibility: numeric change "2 → 3 → 4" is invisible to assistive
     * tech without a live region. Sighted players read the throb; SR users
     * read the count update. */
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'polite');
    badge.setAttribute('aria-atomic', 'true');
    badge.setAttribute('aria-label', 'Scatter progress');
    badge.innerHTML = '<span aria-hidden="true">🎯</span> ' +
      '<span class="ant-badge__num" id="antBadgeNum">0</span>' +
      '<span class="ant-badge__sep">/</span>' +
      '<span class="ant-badge__num" id="antBadgeThr">' + String(ANT_UNI_FALLBACK_THRESHOLD) + '</span>';
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
    var nText = String(scatters);
    var tText = String(threshold);
    /* Diff before write — avoid style-recalc on idle ticks. */
    if (n && n.textContent !== nText) n.textContent = nText;
    if (t && t.textContent !== tText) t.textContent = tText;
    var showVal = scatters > 0 ? 'true' : 'false';
    var warmVal = warm ? 'true' : 'false';
    if (badge.dataset.show !== showVal) badge.dataset.show = showVal;
    if (badge.dataset.warm !== warmVal) badge.dataset.warm = warmVal;
  }

  function _tick() {
    if (!_canRun()) {
      /* Clean up state when we're in a phase that shouldn't show
       * anticipation (FS lifecycle, opt-in force-trigger suppression). */
      _paintBadge(0, ANT_UNI_FALLBACK_THRESHOLD, false);
      var host0 = document.getElementById('gridHost');
      if (host0) host0.classList.remove('gridHost--ant-pulse');
      return;
    }
    var host = document.getElementById('gridHost');
    if (!host) return;
    var ladder = _readLadder();
    var trig = _trigSym();
    var kind = _shapeKind();

    /* Engine-pulse-only shapes: no per-cell metaphor (SVG grids). Show
     * the badge + host pulse based on engine signals; skip cell logic. */
    if (ANT_UNI_ENGINE_PULSE_ONLY.has(kind)) {
      _paintBadge(0, ladder.threshold, false);
      host.classList.toggle('gridHost--ant-pulse', false);
      return;
    }

    var cells = host.querySelectorAll('.cell');
    if (cells.length === 0) {
      /* Non-rect grid that hasn't built .cell yet — keep badge at 0. */
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

    /* W47.S9 (B76 / scatterAnticipationV2) — mathematically-alive gate.
     *
     * Boki bug: "fake nada na rilima koji više ne mogu trigger". Pre-fix
     * the halo painted on every trigger cell + warm fired whenever
     * scattersSoFar crossed threshold-1, even when the remaining reels
     * could no longer contribute enough scatters to hit the threshold
     * (e.g. a 5-reel grid that already showed 0 scatters on reels 1-3
     * with threshold=3 is impossible to win, yet the halo on the lone
     * reel-4 scatter still teased the player).
     *
     * Fix: count reel columns + reels-with-a-trigger, compute the upper
     * bound maxAchievable = scattersSoFar + (reelCols - reelsWithTrigger)
     * (one trigger per remaining reel is the engine hard cap), and
     * STRIP every halo + force warm=false when maxAchievable < threshold.
     *
     * Tick polling stays cheap: one extra .reelCol querySelectorAll +
     * a Set membership scan per cell — O(n) once per tick, no extra
     * DOM writes when alive, just a single classList.remove when dead.
     * NOTE: plain ASCII quotes (no backticks) because this comment lives
     * inside a runtime template literal — W47.S1 lesson.
     */
    var reelCols = host.querySelectorAll('.reelCol');
    var reelColCount = reelCols.length;
    var reelsWithTrigger = 0;
    if (reelColCount > 0 && scattersSoFar > 0) {
      var seen = new Set();
      for (var rc = 0; rc < scatterCells.length; rc++) {
        /* Walk up the parents until we hit a .reelCol (or null). */
        var cur = scatterCells[rc].parentElement;
        while (cur && !cur.classList.contains('reelCol')) cur = cur.parentElement;
        if (cur && !seen.has(cur)) { seen.add(cur); reelsWithTrigger++; }
      }
    }
    /* When the column count is unknown (non-rect grid / shape that
     * doesn't use reel columns), fall back to the legacy behaviour by
     * setting maxAchievable = scattersSoFar + threshold so the gate
     * never fires. That matches pre-fix semantics for those shapes,
     * and the cheaper, kind-specific gates (engine pulse, host pulse)
     * still own the suspense there. */
    var maxAchievable = (reelColCount > 0)
      ? (scattersSoFar + Math.max(0, reelColCount - reelsWithTrigger))
      : (scattersSoFar + ladder.threshold);
    var mathAlive = maxAchievable >= ladder.threshold;

    /* Light up every visible trigger cell — OR strip them all when the
     * gate has decided the spin can no longer hit the threshold. */
    if (mathAlive) {
      for (var j = 0; j < scatterCells.length; j++) {
        if (!scatterCells[j].classList.contains('cell--anticipating-cell')) {
          scatterCells[j].classList.add('cell--anticipating-cell');
        }
      }
      /* Strip from cells that no longer carry the trigger — O(n) via Set. */
      var scatterSet = new Set(scatterCells);
      var marked = host.querySelectorAll('.cell.cell--anticipating-cell');
      for (var k = 0; k < marked.length; k++) {
        if (!scatterSet.has(marked[k])) {
          marked[k].classList.remove('cell--anticipating-cell');
        }
      }
    } else {
      /* Dead: clear every halo so the lone trigger doesn't tease. */
      var dead = host.querySelectorAll('.cell.cell--anticipating-cell');
      for (var dk = 0; dk < dead.length; dk++) {
        dead[dk].classList.remove('cell--anticipating-cell');
      }
    }

    var warm = mathAlive
      && scattersSoFar >= Math.max(1, ladder.threshold - 1)
      && scattersSoFar < ladder.topRung;
    _paintBadge(scattersSoFar, ladder.threshold, warm);

    /* Whole-host pulse for non-rect shapes — registry owned by anticipation.mjs. */
    var useHostPulse = !ANT_UNI_RECT_KINDS.has(kind);
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
  /* Sentinel-gated subscription — hot-reload / double-emit would otherwise
   * stack N copies of _arm/_disarm per phase, corrupting ARMED/SPINNING. */
  function _wireHooks() {
    if (window.__ANT_UNI_HOOKED__) return true;
    if (typeof HookBus === 'undefined') return false;
    try {
      HookBus.on('preSpin',     _disarm, { priority: 8 });
      HookBus.on('postSpin',    _arm,    { priority: 8 });
      HookBus.on('onTumbleStep', _arm,   { priority: 8 });
      HookBus.on('onFsTrigger', _disarm, { priority: 8 });
      HookBus.on('onFsEnd',     _disarm, { priority: 8 });
      window.__ANT_UNI_HOOKED__ = true;
      return true;
    } catch (_) {
      return false;
    }
  }
  if (!_wireHooks()) {
    /* HookBus loaded after this block — poll briefly so we don't fall back
     * to interval-only timing silently. */
    var __antUniHookRetries = 0;
    var __antUniHookRetryId = setInterval(function () {
      __antUniHookRetries++;
      if (_wireHooks() || __antUniHookRetries >= ANT_UNI_HOOKBUS_RETRIES) {
        clearInterval(__antUniHookRetryId);
        if (!window.__ANT_UNI_HOOKED__) {
          try { console.warn('[anticipationUniversal] HookBus not available after ' + __antUniHookRetries + ' retries — interval-only timing'); } catch (_) {}
        }
      }
    }, ANT_UNI_HOOKBUS_RETRY_MS);
  }

  if (window.__ANT_UNI_TICK_ID__) clearInterval(window.__ANT_UNI_TICK_ID__);
  window.__ANT_UNI_TICK_ID__ = setInterval(_tick, ANT_UNI_TICK_MS);
  window._antUniTick = _tick;
})();
`;
}
