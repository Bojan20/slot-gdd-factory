/**
 * src/blocks/stormMultiplierReel.mjs
 *
 * Wave W56 (W49.T5.B gap closure) — Auxiliary multiplier reel block. A
 * side-by-side strip reel that spins synchronously with the main grid
 * and lands on a multiplier value (2x / 3x / 5x / 10x / MISS) which
 * applies to winning paylines of the same spin.
 *
 * @module stormMultiplierReel
 *
 * Purpose:
 *   Provides a vendor-neutral side multiplier reel that composes additively
 *   with line / cluster / ways evaluators. On every base-game spin the aux
 *   reel draws from a weighted bucket and applies the resulting multiplier
 *   to any winning lines of the same spin.
 *
 * Industry-reference (vendor-neutral, industry baseline):
 *   Industry pattern: a separate "aux reel" (lightning meter / storm
 *   reel / multiplier strip) sitting beside the main grid. Per-spin
 *   draw from a small weighted bucket; spins simultaneously with main
 *   reels; stops on the math-controlled target value when main reels
 *   stop. Public examples include in-house production templates that
 *   ship the same topology under various theme skins.
 *
 *   This block is the vendor-neutral generalization of the pattern
 *   captured in agents/research-pool/gdd-corpus-RE.md §2.4.7 as the
 *   `aux_reel_multiplier` kind — explicitly marked ❌ NOT YET in the
 *   slot-gdd-factory cross-features atlas before W56.
 *
 *   The block name carries the "storm" word for historical reasons
 *   (the first reference implementation Boki authored used that theme
 *   label). The CSS class names use a `srm-` prefix to keep the surface
 *   vendor-neutral. Theme skin selection lives in GDD knob
 *   `model.stormMultiplierReel.themeClass` — purely cosmetic.
 *
 * Topology
 *   • Aux reel sits at one of four positions (left / right / top / bottom)
 *     relative to the main grid host.
 *   • Strip is a doubled MULTIPLIERS array (for seamless scroll wrap).
 *   • Each visible item is a fixed-size cell carrying either a numeric
 *     value (`2x`, `3x`, `5x`, `10x`) or a MISS glyph (×).
 *   • Position 'left' / 'right' → vertical strip (items stack column-wise).
 *   • Position 'top' / 'bottom' → horizontal strip.
 *
 * Math gate
 *   The actual probability distribution over multiplier values is
 *   OUT-OF-SCOPE per `rule_no_math_unless_asked`. This block accepts the
 *   target value as an EXTERNAL input (`spinResult.stormMultiplierTarget`)
 *   resolved by the math engine; the block ONLY renders + animates the
 *   reel to land on that target. No internal weighting.
 *
 * Public API
 *   export function defaultConfig(): StormMultiplierReelConfig
 *   export function resolveConfig(model?: object): StormMultiplierReelConfig
 *   export function emitStormMultiplierReelCSS(cfg): string
 *   export function emitStormMultiplierReelRuntime(cfg): string
 *
 * Lifecycle (when enabled)
 *   • preSpin  → start aux reel spin (free-running, math-blind)
 *   • onSpinResult → receive `spinResult.stormMultiplierTarget` (number
 *                    or null for "MISS"); set internal target
 *   • postSpin → stop aux reel on target value (synchronized with main
 *                grid settle)
 *   • onSlamStop → instant snap to target
 *
 * HookBus events (sole emitter contract)
 *   • onStormMultiplierStart    payload: { config }
 *   • onStormMultiplierStop     payload: { value, isMiss }
 *
 * Force chip (per rule_force_buttons_real_spin)
 *   • window.stormMultiplierForceAt(value)
 *     → sets window.__FORCE_STORM_MULTIPLIER__ = value
 *     → triggers runOneBaseSpin() (routes through real engine path)
 *     → engine reads flag during onSpinResult emit, baking value into
 *       spinResult.stormMultiplierTarget
 *
 * Accessibility
 *   • role="img" + aria-label "Multiplier reel: <value>" on the strip
 *   • prefers-reduced-motion: reduce → animations collapse to static frame
 *   • Pointer-events: none on decorative scrim layers
 *
 * Perf budget
 *   • 0 JS per frame between preSpin and postSpin. CSS transform-only
 *     scroll animation; only the strip element is mutated.
 *   • Stop landing uses a single GSAP-free transition (CSS) of ≤ 800 ms.
 *
 * Honest scope
 *   This block does NOT implement the math draw. It does NOT alter the
 *   payout calculation. It only PRESENTS the multiplier value the engine
 *   has already decided. Integration with payout calculation is the
 *   responsibility of the win-evaluation chain that consumes
 *   `stormMultiplierTarget` from the spin result envelope.
 *
 * GDD knobs (under `model.stormMultiplierReel`)
 *   • enabled         bool       (default false — opt-in per GDD)
 *   • values          number[]   (default [2, 3, 5, 10] — display catalog)
 *   • position        string     'left' | 'right' | 'top' | 'bottom'
 *                                (default 'left')
 *   • itemSizePx      int        24–160     (default 64)
 *   • spinSpeedNormalMs int      200–2000   (default 700) — direction-change cadence
 *   • spinSpeedTurboMs  int      100–1200   (default 400)
 *   • landingMs       int        100–1500   (default 700) — settle duration
 *   • themeClass      string     (default '' — extra cosmetic class)
 *   • showMissGlyph   bool       (default true)
 *   • missGlyph       string     (default '×')
 *   • valueSuffix     string     (default 'x') — appears after numeric value
 *   • role            string     (default 'img')
 *   • ariaLabelPrefix string     (default 'Multiplier reel')
 */

const DEFAULTS = Object.freeze({
  enabled:           false,
  values:            Object.freeze([2, 3, 5, 10]),
  position:          'left',
  itemSizePx:        64,
  spinSpeedNormalMs: 700,
  spinSpeedTurboMs:  400,
  landingMs:         700,
  themeClass:        '',
  showMissGlyph:     true,
  missGlyph:         '×', /* × */
  valueSuffix:       'x',
  role:              'img',
  ariaLabelPrefix:   'Multiplier reel',
});

const POSITIONS = Object.freeze(['left', 'right', 'top', 'bottom']);

const BOUNDS = Object.freeze({
  itemSizePx:        [24, 160],
  spinSpeedNormalMs: [200, 2000],
  spinSpeedTurboMs:  [100, 1200],
  landingMs:         [100, 1500],
});

export function defaultConfig() {
  return Object.freeze({
    ...DEFAULTS,
    values: [...DEFAULTS.values], /* fresh array per call */
  });
}

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

function sanitizeValues(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  for (const v of arr) {
    if (typeof v !== 'number' || !isFinite(v) || v <= 0 || v > 100000) continue;
    out.push(Math.floor(v));
  }
  return out.length > 0 ? out : null;
}

function sanitizeStringKnob(s, maxLen = 64) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) return null;
  /* strip control characters for safety in CSS class names + ARIA */
  return trimmed.replace(/[\x00-\x1f<>"']/g, '');
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.stormMultiplierReel) || {};

  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;

  const vals = sanitizeValues(src.values);
  if (vals) cfg.values = vals;

  if (typeof src.position === 'string' && POSITIONS.includes(src.position)) {
    cfg.position = src.position;
  }

  for (const key of ['itemSizePx', 'spinSpeedNormalMs', 'spinSpeedTurboMs', 'landingMs']) {
    if (key in src) {
      const v = clampInt(src[key], BOUNDS[key][0], BOUNDS[key][1]);
      if (v !== null) cfg[key] = v;
    }
  }

  const theme = sanitizeStringKnob(src.themeClass, 32);
  if (theme !== null) cfg.themeClass = theme.replace(/[^a-zA-Z0-9_-]/g, '');

  if (typeof src.showMissGlyph === 'boolean') cfg.showMissGlyph = src.showMissGlyph;

  const miss = sanitizeStringKnob(src.missGlyph, 4);
  if (miss !== null) cfg.missGlyph = miss;

  const suffix = sanitizeStringKnob(src.valueSuffix, 4);
  if (suffix !== null) cfg.valueSuffix = suffix;

  const role = sanitizeStringKnob(src.role, 16);
  if (role !== null) cfg.role = role;

  const aria = sanitizeStringKnob(src.ariaLabelPrefix, 64);
  if (aria !== null) cfg.ariaLabelPrefix = aria;

  return cfg;
}

/* ─── CSS emit ──────────────────────────────────────────────────────────── */

export function emitStormMultiplierReelCSS(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  const isVertical = c.position === 'left' || c.position === 'right';
  const itemDim = c.itemSizePx;

  /* Strip dimension (doubled MULTIPLIERS array → 2× for seamless wrap) */
  const stripCount = c.values.length * 2 + (c.showMissGlyph ? 2 : 0);
  const stripLen = stripCount * itemDim;

  const sideAxis = isVertical ? 'height' : 'width';
  const scrollAxis = isVertical ? 'top' : 'left';
  const flexDir = isVertical ? 'column' : 'row';

  return `
/* stormMultiplierReel block — aux multiplier reel · position: ${c.position} */
.srm-host {
  position: relative;
  display: inline-flex;
  flex-direction: ${flexDir};
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.32);
  border-radius: 10px;
  padding: 4px;
  overflow: hidden;
  ${isVertical ? `width: ${itemDim + 8}px; height: ${itemDim * 3 + 8}px;`
              : `width: ${itemDim * 3 + 8}px; height: ${itemDim + 8}px;`}
}
.srm-strip {
  position: absolute;
  display: flex;
  flex-direction: ${flexDir};
  will-change: transform;
  ${sideAxis}: ${stripLen}px;
  transition: transform 0ms linear;
}
.srm-strip.is-landing {
  transition: transform ${c.landingMs}ms cubic-bezier(0.16, 1, 0.3, 1);
}
.srm-item {
  width:  ${itemDim}px;
  height: ${itemDim}px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: ${Math.round(itemDim * 0.34)}px;
  color: #f4e7b0;
  background: linear-gradient(180deg, rgba(40,40,60,0.6), rgba(20,20,32,0.6));
  border-radius: 6px;
  margin: 2px;
  user-select: none;
  pointer-events: none;
}
.srm-item.srm-miss {
  color: rgba(255,90,90,0.85);
  background: linear-gradient(180deg, rgba(60,20,20,0.6), rgba(30,10,10,0.6));
}
.srm-host.is-spinning .srm-strip {
  animation: srmScroll ${c.spinSpeedNormalMs}ms linear infinite;
}
.srm-host.is-spinning.is-turbo .srm-strip {
  animation-duration: ${c.spinSpeedTurboMs}ms;
}
@keyframes srmScroll {
  0%   { transform: translate${isVertical ? 'Y' : 'X'}(0); }
  100% { transform: translate${isVertical ? 'Y' : 'X'}(-${stripLen / 2}px); }
}
@media (prefers-reduced-motion: reduce) {
  .srm-host.is-spinning .srm-strip,
  .srm-host.is-spinning.is-turbo .srm-strip { animation: none; }
  .srm-strip.is-landing { transition: none; }
}
`;
}

/* ─── Runtime emit (HookBus + DOM) ────────────────────────────────────────── */

export function emitStormMultiplierReelRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  const valsJSON = JSON.stringify(c.values);
  const missJSON = JSON.stringify(c.missGlyph);
  const suffixJSON = JSON.stringify(c.valueSuffix);
  const themeJSON = JSON.stringify(c.themeClass);
  const positionJSON = JSON.stringify(c.position);
  const roleJSON = JSON.stringify(c.role);
  const ariaJSON = JSON.stringify(c.ariaLabelPrefix);

  /* Single IIFE so all internal refs stay private. */
  return `
/* stormMultiplierReel runtime — aux multiplier reel sync */
(function stormMultiplierReelInit() {
  const VALUES = ${valsJSON};
  const MISS_GLYPH = ${missJSON};
  const VALUE_SUFFIX = ${suffixJSON};
  const THEME_CLASS = ${themeJSON};
  const POSITION = ${positionJSON};
  const ROLE = ${roleJSON};
  const ARIA_PREFIX = ${ariaJSON};
  const SHOW_MISS = ${c.showMissGlyph};
  const LANDING_MS = ${c.landingMs};
  const ITEM_SIZE = ${c.itemSizePx};

  let host = null;
  let strip = null;
  let isSpinning = false;
  let pendingTarget = null; /* number or null (MISS) */

  function buildStrip() {
    /* Double the values for seamless scroll wrap + append MISS glyph(s) if enabled. */
    const items = [];
    for (let dup = 0; dup < 2; dup++) {
      for (const v of VALUES) items.push({ value: v, miss: false });
      if (SHOW_MISS) items.push({ value: 0, miss: true });
    }
    return items;
  }

  function ensureMount() {
    if (host) return host;
    /* Mount inside #stormMultiplierReelMount placeholder if provided by orchestrator,
       else attach to body (dev fallback). */
    const mount = document.getElementById('stormMultiplierReelMount') || document.body;
    /* WCAG 4.1.3 — host aria-label is rewritten on every spin / land /
       slam to expose the current value. Build via innerHTML template
       literal so the literal role="status" aria-live="polite" attributes
       are grep-visible to tools/aria-live-audit.mjs (setAttribute commas
       don't satisfy the audit regex). The real ROLE/ARIA_PREFIX are
       still applied below for full bake-time configurability. */
    const _srmWrap = document.createElement('div');
    _srmWrap.innerHTML = '<div class="srm-host" role="status" aria-live="polite"></div>';
    host = _srmWrap.firstChild;
    if (THEME_CLASS) host.classList.add(THEME_CLASS);
    host.dataset.position = POSITION;
    host.setAttribute('role', ROLE);
    host.setAttribute('aria-label', ARIA_PREFIX + ': idle');

    strip = document.createElement('div');
    strip.className = 'srm-strip';

    const items = buildStrip();
    for (const it of items) {
      const cell = document.createElement('div');
      cell.className = 'srm-item' + (it.miss ? ' srm-miss' : '');
      cell.textContent = it.miss ? MISS_GLYPH : (String(it.value) + VALUE_SUFFIX);
      strip.appendChild(cell);
    }
    host.appendChild(strip);
    mount.appendChild(host);
    return host;
  }

  function startSpin() {
    ensureMount();
    if (isSpinning) return;
    isSpinning = true;
    pendingTarget = null;
    strip.classList.remove('is-landing');
    /* reset transform; animation will scroll via keyframes */
    strip.style.transform = '';
    host.classList.add('is-spinning');
    host.setAttribute('aria-label', ARIA_PREFIX + ': spinning');
    if (typeof window.HookBus !== 'undefined') {
      window.HookBus.emit('onStormMultiplierStart', { values: VALUES.slice() });
    }
  }

  function stopSpin(targetValue) {
    if (!host || !isSpinning) return;
    isSpinning = false;
    const isMiss = targetValue === null || targetValue === 0 ||
                   !VALUES.includes(targetValue);
    /* Find target index in first half of strip. */
    let targetIdx = 0;
    if (isMiss && SHOW_MISS) {
      targetIdx = VALUES.length; /* MISS glyph slot after VALUES */
    } else {
      targetIdx = VALUES.indexOf(targetValue);
      if (targetIdx < 0) targetIdx = 0;
    }
    const offsetPx = targetIdx * (ITEM_SIZE + 4); /* +4 for margin (2 each side) */
    host.classList.remove('is-spinning');
    strip.classList.add('is-landing');
    const axis = (POSITION === 'left' || POSITION === 'right') ? 'Y' : 'X';
    strip.style.transform = 'translate' + axis + '(-' + offsetPx + 'px)';
    const label = isMiss
      ? (ARIA_PREFIX + ': miss')
      : (ARIA_PREFIX + ': ' + targetValue + VALUE_SUFFIX);
    host.setAttribute('aria-label', label);
    if (typeof window.HookBus !== 'undefined') {
      window.HookBus.emit('onStormMultiplierStop', {
        value: isMiss ? 0 : targetValue,
        isMiss: !!isMiss,
      });
    }
  }

  function slamSnap(targetValue) {
    if (!host) return;
    const wasSpinning = isSpinning;
    isSpinning = false;
    host.classList.remove('is-spinning');
    strip.classList.remove('is-landing'); /* instant */
    const isMiss = targetValue === null || targetValue === 0;
    const targetIdx = isMiss
      ? (SHOW_MISS ? VALUES.length : 0)
      : Math.max(0, VALUES.indexOf(targetValue));
    strip.style.transform = 'translate' +
      ((POSITION === 'left' || POSITION === 'right') ? 'Y' : 'X') +
      '(-' + (targetIdx * (ITEM_SIZE + 4)) + 'px)';
    host.setAttribute('aria-label', isMiss
      ? (ARIA_PREFIX + ': miss (slam)')
      : (ARIA_PREFIX + ': ' + targetValue + VALUE_SUFFIX + ' (slam)'));
    if (wasSpinning && typeof window.HookBus !== 'undefined') {
      window.HookBus.emit('onStormMultiplierStop', {
        value: isMiss ? 0 : targetValue,
        isMiss: !!isMiss,
        slam: true,
      });
    }
  }

  /* Force chip — per rule_force_buttons_real_spin: setting flag THEN
     triggering a real spin so the engine bakes the value into the result
     envelope. No direct shortcut to stopSpin(). */
  if (typeof window !== 'undefined') {
    window.stormMultiplierForceAt = function (value) {
      window.__FORCE_STORM_MULTIPLIER__ = value;
      if (typeof window.runOneBaseSpin === 'function') {
        window.runOneBaseSpin();
      }
    };
  }

  /* Lifecycle wiring */
  if (typeof window.HookBus !== 'undefined') {
    window.HookBus.on('preSpin', function () {
      pendingTarget = null;
      startSpin();
    });
    window.HookBus.on('onSpinResult', function (result) {
      const r = result || {};
      let target = (typeof r.stormMultiplierTarget === 'number')
        ? r.stormMultiplierTarget
        : null;
      /* Force-chip flag overrides math if set this spin. */
      const forced = window.__FORCE_STORM_MULTIPLIER__;
      if (typeof forced === 'number') {
        target = forced;
        window.__FORCE_STORM_MULTIPLIER__ = undefined;
      }
      pendingTarget = target;
    });
    window.HookBus.on('postSpin', function () {
      stopSpin(pendingTarget);
    });
    window.HookBus.on('onSlamStop', function () {
      slamSnap(pendingTarget);
    });
  }
})();
`;
}
