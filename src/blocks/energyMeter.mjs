import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/energyMeter.mjs
 *
 * Wave B73 — Energy Meter side-feature gauge block.
 *
 * Industry baseline: many modern slot themes expose a metered side
 * feature (e.g. "ENERGY 7/10") that fills on qualifying events
 * (every spin, every win, every cascade step) and triggers a bonus
 * when full. This block owns the UI gauge + fill logic + announces
 * the trigger event; the actual bonus payload is the downstream
 * block's responsibility (it just hooks `onEnergyFull`).
 *
 * Public API (server-side, ES module):
 *   defaultConfig()                       → safe defaults (disabled).
 *   resolveConfig(model)                  → merge defaults; auto-enable
 *                                          when model.energyMeter declared.
 *   emitEnergyMeterCSS(cfg)               → CSS rules for the gauge.
 *   emitEnergyMeterMarkup(cfg)            → host element with ARIA.
 *   emitEnergyMeterRuntime(cfg)           → runtime: HookBus listeners +
 *                                          fill engine + 2 emits.
 *
 * Fill strategies (cfg.fillOn):
 *   'spin'        — +1 per spin
 *   'win'         — +1 per win (onSpinResult with award > 0)
 *   'tumble'      — +1 per tumble step with win
 *   'scatter'     — +N per scatter symbol landed
 *   'custom'      — operator emits onEnergyTick to bump manually
 *
 * Lifecycle:
 *   subscribes:
 *     preSpin            — show meter when first spin happens
 *     onSpinResult       — fill per 'spin' / 'win' / 'scatter' strategy
 *     onTumbleStep       — fill per 'tumble' strategy
 *     onEnergyTick       — fill per 'custom' strategy (operator-driven)
 *     onFsEnd            — optional reset based on resetOnFsEnd
 *   emits:
 *     onEnergyChange  { from, to, max }  — every visible delta
 *     onEnergyFull                        — when meter reaches max
 *
 * a11y:
 *   - role="progressbar" + aria-valuemin/max/now + aria-label.
 *   - prefers-reduced-motion kills the fill transition.
 *   - Apple HIG 11px font-size floor.
 *
 * Vendor-neutral. No game / studio strings.
 */

const BOUNDS = {
  capacity:    [1, 999],
  perStep:     [1, 99],
  fontSizePx:  [11, 22],
  flashMs:     [120, 1500],
  zIndex:      [10, 99],
};
const FILL_ON = new Set(['spin', 'win', 'tumble', 'scatter', 'custom']);

function clamp(v, [lo, hi], fb) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
}

export function defaultConfig() {
  return Object.freeze({
    enabled:         false,
    capacity:        10,
    perStep:         1,
    fillOn:          'win',       // see FILL_ON whitelist
    scatterSymbol:   'S',         // used only when fillOn === 'scatter'
    autoResetOnFull: true,        // reset to 0 after onEnergyFull
    resetOnFsEnd:    true,        // reset when FS round ends
    position:        'top-left',  // 4-corner safe-area-aware
    labelTemplate:   'ENERGY {N}/{M}',
    fontSizePx:      12,
    bgColor:         'rgba(0,0,0,0.55)',
    fgColor:         '#f2f2f2',
    fillColor:       '#c9a227',
    fullColor:       '#48d597',
    flashMs:         300,
    zIndex:          35,           // sits with chips (35) — above ladder/sticky
    width:           120,          // gauge bar width in px
    showInBase:      true,         // visible in BASE; false → FS-only
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = model.energyMeter || {};
  const auto = !!model.energyMeter;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.capacity   = clamp(m.capacity,   BOUNDS.capacity,   cfg.capacity);
  cfg.perStep    = clamp(m.perStep,    BOUNDS.perStep,    cfg.perStep);
  cfg.fontSizePx = clamp(m.fontSizePx, BOUNDS.fontSizePx, cfg.fontSizePx);
  cfg.flashMs    = clamp(m.flashMs,    BOUNDS.flashMs,    cfg.flashMs);
  cfg.zIndex     = clamp(m.zIndex,     BOUNDS.zIndex,     cfg.zIndex);
  cfg.width      = clamp(m.width,      [40, 320],         cfg.width);

  if (typeof m.fillOn === 'string' && FILL_ON.has(m.fillOn)) cfg.fillOn = m.fillOn;
  if (typeof m.scatterSymbol === 'string' && m.scatterSymbol.length > 0) cfg.scatterSymbol = m.scatterSymbol;
  if (typeof m.autoResetOnFull === 'boolean') cfg.autoResetOnFull = m.autoResetOnFull;
  if (typeof m.resetOnFsEnd === 'boolean') cfg.resetOnFsEnd = m.resetOnFsEnd;
  if (typeof m.showInBase === 'boolean') cfg.showInBase = m.showInBase;
  if (['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(m.position)) cfg.position = m.position;
  if (typeof m.labelTemplate === 'string' && m.labelTemplate.length > 0) cfg.labelTemplate = m.labelTemplate;
  if (typeof m.bgColor    === 'string') cfg.bgColor    = m.bgColor;
  if (typeof m.fgColor    === 'string') cfg.fgColor    = m.fgColor;
  if (typeof m.fillColor  === 'string') cfg.fillColor  = m.fillColor;
  if (typeof m.fullColor  === 'string') cfg.fullColor  = m.fullColor;
  return cfg;
}

function positionStyle(pos) {
  const v  = 'calc(max(8px, env(safe-area-inset-top, 0px) + 8px))';
  const h  = 'calc(max(8px, env(safe-area-inset-left, 0px) + 8px))';
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

export function emitEnergyMeterCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* energyMeter — Wave B73 */
  .energy-meter {
    position: fixed;
    ${positionStyle(cfg.position)}
    z-index: ${cfg.zIndex};
    padding: 4px 8px 6px;
    border-radius: 10px;
    background: ${cfg.bgColor};
    color: ${cfg.fgColor};
    font-size: ${cfg.fontSizePx}px;
    font-weight: 700;
    letter-spacing: 0.04em;
    line-height: 1.2;
    pointer-events: none;
    display: none;
    min-width: ${cfg.width}px;
  }
  .energy-meter[data-visible="true"] { display: block; }
  .energy-meter .em-label {
    display: block;
    margin-bottom: 3px;
    font-size: ${cfg.fontSizePx}px;
  }
  .energy-meter .em-track {
    height: 6px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }
  .energy-meter .em-fill {
    height: 100%;
    width: 0%;
    background: ${cfg.fillColor};
    border-radius: 999px;
    transition: width ${cfg.flashMs}ms ease-out, background ${cfg.flashMs}ms ease-out;
  }
  .energy-meter[data-full="true"] .em-fill {
    background: ${cfg.fullColor};
  }
  @media (prefers-reduced-motion: reduce) {
    .energy-meter .em-fill { transition: none; }
  }
  `;
}

export function emitEnergyMeterMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const label = String(cfg.labelTemplate || 'ENERGY {N}/{M}')
    .replace('{N}', '0')
    .replace('{M}', String(cfg.capacity));
  return tagBlockMarkup(`<div id="energyMeter" class="energy-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${cfg.capacity}" aria-valuenow="0" aria-label="Energy meter" data-i18n-aria="energyMeter.0" data-i18n-aria-fallback="Energy meter" data-dynamic-aria="true" data-visible="false" data-value="0" data-full="false">
    <!-- WCAG 4.1.3 — em-label textContent is rewritten on every bump / reset.
         aria-live="polite" announces "ENERGY 3/10" updates to SR users. -->
    <span class="em-label" aria-live="polite" aria-atomic="true">${label}</span>
    <span class="em-track"><span class="em-fill"></span></span>
  </div>`, 'energyMeter');
}

export function emitEnergyMeterRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  (function(){
    if (typeof window === 'undefined' || !window.HookBus) return;
    var host = document.getElementById('energyMeter');
    if (!host) return;
    var labelEl = host.querySelector('.em-label');
    var fillEl  = host.querySelector('.em-fill');
    var CAP = ${cfg.capacity};
    var PER = ${cfg.perStep};
    var template = ${JSON.stringify(cfg.labelTemplate)};
    var fillOn = ${JSON.stringify(cfg.fillOn)};
    var scatterSym = ${JSON.stringify(cfg.scatterSymbol)};
    var autoReset = ${JSON.stringify(cfg.autoResetOnFull)};
    var resetOnFs = ${JSON.stringify(cfg.resetOnFsEnd)};
    var showInBase = ${JSON.stringify(cfg.showInBase)};
    var value = 0;
    var bootShown = false;

    function render(v) {
      value = Math.max(0, Math.min(CAP, v | 0));
      var full = value >= CAP;
      var label = template.replace('{N}', String(value)).replace('{M}', String(CAP));
      if (labelEl) labelEl.textContent = label;
      if (fillEl)  fillEl.style.width = ((value / CAP) * 100).toFixed(2) + '%';
      host.setAttribute('data-value', String(value));
      host.setAttribute('data-full', full ? 'true' : 'false');
      host.setAttribute('aria-valuenow', String(value));
      host.setAttribute('aria-label', 'Energy meter: ' + value + ' of ' + CAP);
    }
    function show() { host.setAttribute('data-visible', 'true'); bootShown = true; }
    function hide() { host.setAttribute('data-visible', 'false'); }
    function bump(delta, source) {
      if (!Number.isFinite(delta) || delta <= 0) return;
      var from = value;
      var to = Math.min(CAP, from + delta);
      if (to === from) return;
      render(to);
      try { window.HookBus.emit('onEnergyChange', { from: from, to: to, max: CAP, source: source }); } catch (_) {}
      if (to >= CAP) {
        try { window.HookBus.emit('onEnergyFull', { capacity: CAP, source: source }); } catch (_) {}
        if (autoReset) { setTimeout(function () { render(0); }, 1200); }
      }
    }
    function reset() { render(0); }

    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('preSpin', function () {
      if (!bootShown && showInBase) show();
    }) : void 0);
    HookBus.on('onSpinResult', function (p) {
      if (fillOn === 'spin') { bump(PER, 'spin'); return; }
      if (!p) return;
      var win = Number(p.award || p.win || 0);
      if (fillOn === 'win' && win > 0) { bump(PER, 'win'); return; }
      if (fillOn === 'scatter') {
        var n = Number(p.scatterCount || 0);
        if (n > 0) bump(n * PER, 'scatter');
      }
    });
    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onTumbleStep', function (p) {
      if (fillOn !== 'tumble') return;
      var win = p ? Number(p.win || p.stepWin || 0) : 0;
      if (win > 0) bump(PER, 'tumble');
    }) : void 0);
    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onEnergyTick', function (p) {
      if (fillOn !== 'custom') return;
      var d = p ? Number(p.delta || 1) : 1;
      bump(d, 'custom');
    }) : void 0);
    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsEnd', function () {
      if (resetOnFs) reset();
    }) : void 0);

    /* Boot — show immediately if BASE-game visible, otherwise wait. */
    if (showInBase) { show(); render(0); }
    else            { render(0); }
  })();
  `;
}
