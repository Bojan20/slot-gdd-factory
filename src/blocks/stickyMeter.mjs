import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/stickyMeter.mjs
 *
 * Wave B70 — Sticky Symbol Counter HUD block.
 *
 * Industry baseline: many FS rounds expose a small counter that tracks
 * how many sticky symbols (typically wilds) are currently anchored on
 * the grid — e.g. "STICKY: 3 / 12". The player sees a persistent chip
 * with the running count + max cap so they understand how close they
 * are to a grid-fill condition. Distinct from `stickyWild` /
 * `expandingWild` / `holdAndWin` blocks which OWN the sticky-cell
 * STATE — this block owns the UI surface + announces count changes
 * the wider system can hook.
 *
 * Public API (server-side, ES module):
 *   defaultConfig()                       → safe defaults (disabled).
 *   resolveConfig(model)                  → merge defaults; auto-enable
 *                                          when model.stickyWild OR
 *                                          model.expandingWild OR
 *                                          model.holdAndWin OR
 *                                          model.stickyMeter declared.
 *   emitStickyMeterCSS(cfg)               → CSS rules for the pill.
 *   emitStickyMeterMarkup(cfg)            → host element with ARIA.
 *   emitStickyMeterRuntime(cfg)           → runtime: HookBus listeners +
 *                                          DOM probe + 1 emit.
 *
 * Lifecycle:
 *   subscribes:
 *     onFsTrigger        — show + reset count to 0
 *     preSpin            — record snapshot of current count for delta
 *     postSpin           — re-count locked cells, emit delta event
 *     onSpinResult       — same as postSpin (fallback when postSpin
 *                          isn't wired for the active engine)
 *     onTumbleStep       — re-count during cascades
 *     onFsEnd            — reset + hide
 *   emits:
 *     onStickyCountChange { from, to, max } — when count changes
 *
 * a11y:
 *   - role="status" + aria-live="polite" + dynamic aria-label.
 *   - prefers-reduced-motion kills the pulse transition.
 *   - Apple HIG 11 px font-size floor.
 *
 * Counting strategy
 *   - DOM probe via `document.querySelectorAll(cfg.stickySelector)`.
 *   - Default selector targets known sticky markers from sibling blocks:
 *     `.cell--sticky, .cell--locked, [data-sticky="true"], [data-locked="true"]`.
 *   - Custom selector via `cfg.stickySelector` for slot themes that mark
 *     cells with vendor-specific class names.
 *
 * Vendor-neutral. No game / studio strings.
 */

const BOUNDS = {
  fontSizePx: [11, 22],
  flashMs:    [120, 1000],
  zIndex:     [10, 99],
  maxCap:     [1, 999],
};

function clamp(v, [lo, hi], fb) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
}

export function defaultConfig() {
  return Object.freeze({
    enabled:        false,
    maxCap:         30,                          // grid-fill ceiling
    showMaxCap:     true,                        // render "/ N" suffix
    position:       'bottom-left',
    labelTemplate:  'STICKY {N}',                // {N} → count, {M} → maxCap
    labelTemplateWithMax: 'STICKY {N}/{M}',
    fontSizePx:     12,
    bgColor:        'rgba(0,0,0,0.55)',
    fgColor:        '#f2f2f2',
    accentColor:    '#c9a227',
    flashMs:        220,
    zIndex:         34,                          // sits with ladder (33)
    stickySelector: '.cell--sticky, .cell--locked, [data-sticky="true"], [data-locked="true"]',
    /* When true, the chip stays visible during BASE game as well; default
     * false (FS-only is the industry baseline for sticky-wild meters). */
    showInBase:     false,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = model.stickyMeter || {};
  const auto = !!(model.stickyWild || model.expandingWild || model.holdAndWin || model.stickyMeter);
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.maxCap     = clamp(m.maxCap,     BOUNDS.maxCap,     cfg.maxCap);
  cfg.fontSizePx = clamp(m.fontSizePx, BOUNDS.fontSizePx, cfg.fontSizePx);
  cfg.flashMs    = clamp(m.flashMs,    BOUNDS.flashMs,    cfg.flashMs);
  cfg.zIndex     = clamp(m.zIndex,     BOUNDS.zIndex,     cfg.zIndex);

  if (typeof m.showMaxCap === 'boolean') cfg.showMaxCap = m.showMaxCap;
  if (typeof m.showInBase === 'boolean') cfg.showInBase = m.showInBase;
  if (['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(m.position)) cfg.position = m.position;
  if (typeof m.labelTemplate === 'string' && m.labelTemplate.length > 0) cfg.labelTemplate = m.labelTemplate;
  if (typeof m.labelTemplateWithMax === 'string' && m.labelTemplateWithMax.length > 0) cfg.labelTemplateWithMax = m.labelTemplateWithMax;
  if (typeof m.stickySelector === 'string' && m.stickySelector.length > 0) cfg.stickySelector = m.stickySelector;
  if (typeof m.bgColor    === 'string') cfg.bgColor    = m.bgColor;
  if (typeof m.fgColor    === 'string') cfg.fgColor    = m.fgColor;
  if (typeof m.accentColor === 'string') cfg.accentColor = m.accentColor;
  return cfg;
}

function positionStyle(pos) {
  const v  = 'calc(max(8px, env(safe-area-inset-top, 0px) + 8px))';
  const h  = 'calc(max(8px, env(safe-area-inset-left, 0px) + 8px))';
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

export function emitStickyMeterCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* stickyMeter — Wave B70 */
  .sticky-meter {
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
    transition: background ${cfg.flashMs}ms ease-out, color ${cfg.flashMs}ms ease-out, transform ${cfg.flashMs}ms ease-out;
    display: none;
  }
  .sticky-meter[data-visible="true"] { display: inline-block; }
  .sticky-meter[data-change="up"] {
    background: ${cfg.accentColor};
    color: #000;
    transform: scale(1.08);
  }
  .sticky-meter[data-full="true"] {
    background: ${cfg.accentColor};
    color: #000;
  }
  @media (prefers-reduced-motion: reduce) {
    .sticky-meter { transition: none; }
    .sticky-meter[data-change="up"] { transform: none; }
  }
  `;
}

export function emitStickyMeterMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const template = cfg.showMaxCap ? cfg.labelTemplateWithMax : cfg.labelTemplate;
  const label = String(template)
    .replace('{N}', '0')
    .replace('{M}', String(cfg.maxCap));
  /* WCAG 4.1.3 (F4 A3) — atomic so full "STICKY N/M" is re-spoken on every postSpin reCount, not diff. */
  return tagBlockMarkup(`<div id="stickyMeter" class="sticky-meter" role="status" aria-live="polite" aria-atomic="true" aria-label="Sticky symbol count" data-visible="false" data-count="0">${label}</div>`, 'stickyMeter');
}

export function emitStickyMeterRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const template = cfg.showMaxCap ? cfg.labelTemplateWithMax : cfg.labelTemplate;
  return `
  (function(){
    if (typeof window === 'undefined' || !window.HookBus) return;
    var host = document.getElementById('stickyMeter');
    if (!host) return;
    var SELECTOR = ${JSON.stringify(cfg.stickySelector)};
    var MAX = ${cfg.maxCap};
    var template = ${JSON.stringify(template)};
    var flashMs = ${cfg.flashMs};
    var showInBase = ${JSON.stringify(cfg.showInBase)};
    var count = 0, prevCount = 0;
    var fsActive = false;
    var resetTimer = null;

    function probeCount() {
      try {
        return Math.min(MAX, document.querySelectorAll(SELECTOR).length);
      } catch (_) { return 0; }
    }
    function render(n) {
      count = Math.max(0, Math.min(MAX, n | 0));
      host.textContent = template.replace('{N}', String(count)).replace('{M}', String(MAX));
      host.setAttribute('data-count', String(count));
      host.setAttribute('data-full', count >= MAX ? 'true' : 'false');
      host.setAttribute('aria-label', 'Sticky symbol count: ' + count + ' of ' + MAX);
    }
    function show() { host.setAttribute('data-visible', 'true'); }
    function hide() { host.setAttribute('data-visible', 'false'); }
    function flashUp() {
      host.setAttribute('data-change', 'up');
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(function () { host.setAttribute('data-change', 'none'); }, flashMs);
    }
    function reCount(label) {
      if (!fsActive && !showInBase) return;
      var fresh = probeCount();
      if (fresh === count) return;
      prevCount = count;
      var delta = fresh - count;
      render(fresh);
      if (delta > 0) flashUp();
      try { window.HookBus.emit('onStickyCountChange', { from: prevCount, to: count, max: MAX, source: label }); } catch (_) {}
    }
    function reset() {
      prevCount = count;
      count = 0;
      render(0);
      hide();
      if (prevCount > 0) {
        try { window.HookBus.emit('onStickyCountChange', { from: prevCount, to: 0, max: MAX, source: 'reset' }); } catch (_) {}
      }
    }

    HookBus.on('onFsTrigger', function () {
      fsActive = true;
      render(0);
      show();
    });
    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('preSpin',      function () { prevCount = count; }) : void 0);
    HookBus.on('postSpin',     function () { reCount('postSpin'); });
    HookBus.on('onSpinResult', function () { reCount('onSpinResult'); });
    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onTumbleStep', function () { reCount('onTumbleStep'); }) : void 0);
    HookBus.on('onFsEnd',      function () { fsActive = false; reset(); });

    /* Boot — show immediately in BASE if showInBase is set; otherwise
     * stay hidden until FS begins. */
    if (showInBase) { show(); render(probeCount()); }
    else            { render(0); }
  })();
  `;
}
