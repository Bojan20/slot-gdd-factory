import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/wildCollectionTrail.mjs
 *
 * Wave H12 — Wild Collection Trail (persistent wild-counter meter).
 *
 * Industry baseline (vendor-neutral):
 *   Modern slot themes track wild landings across spins and reward the player
 *   when a configurable threshold of collected wilds is reached (extra free
 *   spins, multiplier bump, instant cash bonus). This block owns the meter
 *   + trail icons + reward emission.
 *
 *   Pure PRESENTATION + STATE:
 *     • Reads `onSpinResult.events[].sym === wildSymbol` or fallback grid
 *       scan for `data-sym=W` cells per spin.
 *     • Owns `window.__SLOT_WILD_TRAIL__ = { count, max, rewardsFired }`.
 *     • Renders a horizontal trail of N slots, fills left-to-right.
 *     • Fires `onWildCollectionReward` at every reward step + clears at
 *       max if cfg.resetAtMax.
 *
 * Lifecycle:
 *   subscribes:
 *     preSpin            → no-op (state persists across spins)
 *     onSpinResult       → scan grid for wilds, bump counter
 *     onTumbleStep       → bump on cascade-landed wilds
 *     onFsEnd            → optional reset (cfg.resetOnFsEnd)
 *   emits:
 *     onWildTrailBump    { from, to, max, source }
 *     onWildCollectionReward { step, total, kind }
 *     onWildTrailReset   { reason, source }
 *
 * a11y:
 *   - role="progressbar" + aria-valuemin/max/now.
 *   - prefers-reduced-motion kills fill transition.
 *
 * Vendor-neutral.
 *
 * @module wildCollectionTrail
 */

const POSITIONS = new Set(['top', 'bottom', 'left', 'right']);
const REWARD_KINDS = new Set(['fsBonus', 'multBump', 'cashBonus', 'wildBoost']);
const BOUNDS = Object.freeze({
  capacity:   [2, 99],
  perSpin:    [1, 50],
  fontSizePx: [10, 22],
  flashMs:    [120, 1500],
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
    wildSymbol:     'W',
    capacity:       10,
    rewardSteps:    [5, 10],     /* trigger reward at these counts */
    rewardKind:     'fsBonus',
    perWildBump:    1,
    resetAtMax:     true,
    resetOnFsEnd:   false,
    position:       'top',
    fontSizePx:     11,
    fgColor:        '#f2f2f2',
    bgColor:        'rgba(0,0,0,0.55)',
    fillColor:      '#ffd84d',
    fullColor:      '#48d597',
    flashMs:        260,
    zIndex:         33,
    labelTemplate:  'WILDS {N}/{M}',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.wildCollectionTrail) || {};
  const auto = !!model.wildCollectionTrail;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.wildSymbol = _safe(m.wildSymbol, 12, cfg.wildSymbol);
  cfg.capacity   = _clamp(m.capacity,   BOUNDS.capacity,   cfg.capacity);
  cfg.perWildBump= _clamp(m.perWildBump,BOUNDS.perSpin,    cfg.perWildBump);
  cfg.fontSizePx = _clamp(m.fontSizePx, BOUNDS.fontSizePx, cfg.fontSizePx);
  cfg.flashMs    = _clamp(m.flashMs,    BOUNDS.flashMs,    cfg.flashMs);
  cfg.zIndex     = _clamp(m.zIndex,     BOUNDS.zIndex,     cfg.zIndex);

  cfg.fgColor    = _safe(m.fgColor,    48, cfg.fgColor);
  cfg.bgColor    = _safe(m.bgColor,    64, cfg.bgColor);
  cfg.fillColor  = _safe(m.fillColor,  48, cfg.fillColor);
  cfg.fullColor  = _safe(m.fullColor,  48, cfg.fullColor);

  if (typeof m.position === 'string' && POSITIONS.has(m.position)) cfg.position = m.position;
  if (typeof m.rewardKind === 'string' && REWARD_KINDS.has(m.rewardKind)) cfg.rewardKind = m.rewardKind;
  if (Array.isArray(m.rewardSteps)) {
    var steps = m.rewardSteps
      .map(n => parseInt(n, 10))
      .filter(n => Number.isFinite(n) && n >= 1 && n <= cfg.capacity)
      .sort((a, b) => a - b);
    if (steps.length) cfg.rewardSteps = steps;
  }
  if (typeof m.resetAtMax    === 'boolean') cfg.resetAtMax    = m.resetAtMax;
  if (typeof m.resetOnFsEnd  === 'boolean') cfg.resetOnFsEnd  = m.resetOnFsEnd;
  if (typeof m.labelTemplate === 'string' && m.labelTemplate.length > 0 && m.labelTemplate.length <= 64) {
    cfg.labelTemplate = _safe(m.labelTemplate, 64, cfg.labelTemplate);
  }
  return cfg;
}

function _positionStyle(pos) {
  switch (pos) {
    case 'bottom': return 'bottom: 8px; left: 50%; transform: translateX(-50%);';
    case 'left':   return 'top: 50%; left: 8px; transform: translateY(-50%);';
    case 'right':  return 'top: 50%; right: 8px; transform: translateY(-50%);';
    case 'top':
    default:       return 'top: 8px; left: 50%; transform: translateX(-50%);';
  }
}

export function emitWildCollectionTrailCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* wildCollectionTrail — Wave H12 */
  .wild-trail {
    position: fixed;
    ${_positionStyle(cfg.position)}
    z-index: ${cfg.zIndex};
    padding: 4px 10px 6px;
    border-radius: 12px;
    background: ${cfg.bgColor};
    color: ${cfg.fgColor};
    font-size: ${cfg.fontSizePx}px;
    font-weight: 800;
    letter-spacing: 0.05em;
    line-height: 1.2;
    pointer-events: none;
    min-width: 160px;
    text-align: center;
  }
  .wild-trail .wt-label { display: block; margin-bottom: 4px; }
  .wild-trail .wt-track {
    height: 8px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }
  .wild-trail .wt-fill {
    height: 100%;
    width: 0%;
    background: ${cfg.fillColor};
    border-radius: 999px;
    transition: width ${cfg.flashMs}ms ease-out, background ${cfg.flashMs}ms ease-out;
  }
  .wild-trail[data-full="true"] .wt-fill { background: ${cfg.fullColor}; }
  @media (prefers-reduced-motion: reduce) {
    .wild-trail .wt-fill { transition: none; }
  }
  `;
}

export function emitWildCollectionTrailMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const label = String(cfg.labelTemplate).replace('{N}', '0').replace('{M}', String(cfg.capacity));
  return tagBlockMarkup(`<div id="wildTrail" class="wild-trail" role="progressbar" aria-valuemin="0" aria-valuemax="${cfg.capacity}" aria-valuenow="0" aria-label="Wild collection meter" data-full="false" data-value="0">
    <!-- WCAG 4.1.3 — label textContent is rewritten on every bump /
         reset; aria-live="polite" announces "WILDS 3/10" updates. -->
    <span class="wt-label" aria-live="polite" aria-atomic="true">${label}</span>
    <span class="wt-track"><span class="wt-fill"></span></span>
  </div>`, 'wildCollectionTrail');
}

export function emitWildCollectionTrailRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── wildCollectionTrail BLOCK — Wave H12 ─────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var WILD = ${JSON.stringify(cfg.wildSymbol)};
    var CAP = ${cfg.capacity};
    var PER = ${cfg.perWildBump};
    var STEPS = ${JSON.stringify(cfg.rewardSteps)};
    var KIND = ${JSON.stringify(cfg.rewardKind)};
    var RESET_MAX = ${JSON.stringify(cfg.resetAtMax)};
    var RESET_FS  = ${JSON.stringify(cfg.resetOnFsEnd)};
    var TEMPLATE = ${JSON.stringify(cfg.labelTemplate)};

    /* W47.S25 — symbol-density edge guard.
     * If a single onSpinResult / onTumbleStep delivers more wilds than
     * the meter's capacity (e.g., wild-reel feature on a 7x7 cluster
     * with 49 cells) the meter pegs to max and immediately resets —
     * the trail "fills" so fast the animation is invisible. Per-bump
     * cap holds the visual cadence smooth: never more than CAP/2 in
     * one tick so the player sees the meter sweep. Excess is dropped
     * (player perception: "huge wild density already triggered the
     * max-reward step, the rest doesn't matter").
     *
     * Also: signature-guard the same-grid re-emit. If onSpinResult
     * fires twice on identical visible cells (force-spin race, HMR),
     * the second emit MUST NOT double-bump. We snapshot a cheap
     * fingerprint after each consume and short-circuit if it matches. */
    var BUMP_SANITY_CAP = Math.max(1, Math.floor(CAP / 2));
    var state = window.__SLOT_WILD_TRAIL__ || { count: 0, max: CAP, rewardsFired: [], lastSig: '' };
    if (!('lastSig' in state)) state.lastSig = '';
    window.__SLOT_WILD_TRAIL__ = state;

    var host    = (typeof document !== 'undefined') ? document.getElementById('wildTrail') : null;
    var labelEl = host ? host.querySelector('.wt-label') : null;
    var fillEl  = host ? host.querySelector('.wt-fill')  : null;

    function render() {
      var v = Math.max(0, Math.min(CAP, state.count | 0));
      var full = v >= CAP;
      if (labelEl) labelEl.textContent = TEMPLATE.replace('{N}', String(v)).replace('{M}', String(CAP));
      if (fillEl) fillEl.style.width = ((v / CAP) * 100).toFixed(2) + '%';
      if (host) {
        host.setAttribute('data-value', String(v));
        host.setAttribute('data-full', full ? 'true' : 'false');
        host.setAttribute('aria-valuenow', String(v));
      }
    }
    function bump(delta, source) {
      if (!Number.isFinite(delta) || delta <= 0) return;
      /* W47.S25 sanity cap — clamp absurdly large single-tick deltas. */
      if (delta > BUMP_SANITY_CAP) delta = BUMP_SANITY_CAP;
      var from = state.count | 0;
      var to = Math.min(CAP, from + delta);
      if (to === from) return;
      state.count = to;
      try { window.HookBus.emit('onWildTrailBump', { from: from, to: to, max: CAP, source: source || 'auto' }); } catch (_) {}
      for (var i = 0; i < STEPS.length; i++) {
        var step = STEPS[i] | 0;
        if (from < step && to >= step && state.rewardsFired.indexOf(step) < 0) {
          state.rewardsFired.push(step);
          try { window.HookBus.emit('onWildCollectionReward', { step: step, total: to, kind: KIND }); } catch (_) {}
        }
      }
      render();
      if (to >= CAP && RESET_MAX) {
        setTimeout(function () { reset('atMax', 'autoReset'); }, ${cfg.flashMs} + 240);
      }
    }
    function reset(reason, source) {
      state.count = 0;
      state.rewardsFired = [];
      try { window.HookBus.emit('onWildTrailReset', { reason: reason || 'manual', source: source || 'auto' }); } catch (_) {}
      render();
    }
    /* Bug #2 (2026-06-17, DOM selector fix) — real engine renders cells as
     * <div class="cell">SYM</div> (gridRenderer.mjs:119). Previous selector
     * '.symbol-cell[data-sym]' matched 0 nodes → counter never bumped.
     * Now: dual selector + dual symbol source (data-sym attr OR textContent). */
    function countWildsOnGrid() {
      if (typeof document === 'undefined') return { n: 0, sig: '' };
      var cells = document.querySelectorAll('.symbol-cell, .cell');
      var n = 0;
      /* W47.S25 cheap signature — concat cell-symbol firstchars per
       * index. Same grid state → identical signature → spin-dedupe gate
       * below will reject re-emits. Avoids allocating a full array. */
      var sig = '';
      for (var i = 0; i < cells.length; i++) {
        var attr = cells[i].getAttribute && (cells[i].getAttribute('data-sym') || cells[i].getAttribute('data-symbol'));
        var text = (cells[i].textContent || '').trim();
        var s = attr || text;
        sig += (s.charAt(0) || '_');
        if (s === WILD) n++;
      }
      return { n: n, sig: sig };
    }

    window.HookBus.on('onSpinResult', function () {
      var grid = countWildsOnGrid();
      /* W47.S25 spin-dedupe — identical visible grid since last consume
       * means a re-emit (force-spin race, HMR) and MUST NOT re-bump. */
      if (grid.sig && grid.sig === state.lastSig) return;
      state.lastSig = grid.sig;
      if (grid.n > 0) bump(grid.n * PER, 'onSpinResult');
    });
    window.HookBus.on('onTumbleStep', function (p) {
      if (p && Array.isArray(p.landed)) {
        var n = 0;
        for (var i = 0; i < p.landed.length; i++) {
          if (p.landed[i] && p.landed[i].sym === WILD) n++;
        }
        if (n > 0) bump(n * PER, 'onTumbleStep');
      }
    });
    window.HookBus.on('onFsEnd', function () { if (RESET_FS) reset('fsEnd', 'onFsEnd'); });

    /* Public API. */
    window.wildTrailBump  = function (n) { bump(n | 0 || 1, 'api'); };
    window.wildTrailReset = function () { reset('api', 'api'); };

    render();
  })();
  `;
}
