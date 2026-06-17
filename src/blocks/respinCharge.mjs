/**
 * src/blocks/respinCharge.mjs
 *
 * Wave H18 — Respin Charge (collect-N-charges-for-auto-respin meter).
 *
 * Industry baseline (vendor-neutral):
 *   Player collects "charges" (e.g. one per losing spin, or one per
 *   specific event) up to a configured threshold; when reached, the next
 *   spin is automatically converted into a respin with guaranteed feature.
 *
 * @module respinCharge
 */

const POSITIONS = new Set(['top', 'bottom', 'left', 'right']);
const TRIGGERS = new Set(['loss', 'spin', 'noWin', 'tumbleEnd', 'custom']);
const BOUNDS = Object.freeze({
  capacity:   [2, 99],
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
    capacity:       5,
    trigger:        'loss',         /* see TRIGGERS whitelist */
    autoRespin:     true,           /* when full, emit auto-trigger */
    resetOnTrigger: true,
    position:       'bottom',
    fontSizePx:     12,
    flashMs:        320,
    zIndex:         34,
    bgColor:        'rgba(0,0,0,0.55)',
    fgColor:        '#f2f2f2',
    fillColor:      '#c9a227',
    fullColor:      '#48d597',
    labelTemplate:  'RESPIN {N}/{M}',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.respinCharge) || {};
  const auto = !!model.respinCharge;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.capacity   = _clamp(m.capacity,   BOUNDS.capacity,   cfg.capacity);
  cfg.fontSizePx = _clamp(m.fontSizePx, BOUNDS.fontSizePx, cfg.fontSizePx);
  cfg.flashMs    = _clamp(m.flashMs,    BOUNDS.flashMs,    cfg.flashMs);
  cfg.zIndex     = _clamp(m.zIndex,     BOUNDS.zIndex,     cfg.zIndex);

  if (typeof m.position === 'string' && POSITIONS.has(m.position)) cfg.position = m.position;
  if (typeof m.trigger  === 'string' && TRIGGERS.has(m.trigger))   cfg.trigger  = m.trigger;
  if (typeof m.autoRespin === 'boolean')     cfg.autoRespin = m.autoRespin;
  if (typeof m.resetOnTrigger === 'boolean') cfg.resetOnTrigger = m.resetOnTrigger;

  cfg.bgColor    = _safe(m.bgColor,    64, cfg.bgColor);
  cfg.fgColor    = _safe(m.fgColor,    32, cfg.fgColor);
  cfg.fillColor  = _safe(m.fillColor,  48, cfg.fillColor);
  cfg.fullColor  = _safe(m.fullColor,  48, cfg.fullColor);
  if (typeof m.labelTemplate === 'string' && m.labelTemplate.length > 0 && m.labelTemplate.length <= 64) {
    cfg.labelTemplate = _safe(m.labelTemplate, 64, cfg.labelTemplate);
  }
  return cfg;
}

function _posStyle(pos) {
  const v  = 'calc(max(8px, env(safe-area-inset-top, 0px) + 8px))';
  const bV = 'calc(max(8px, env(safe-area-inset-bottom, 0px) + 8px))';
  switch (pos) {
    case 'top':    return `top: ${v}; left: 50%; transform: translateX(-50%);`;
    case 'left':   return `top: 50%; left: 8px; transform: translateY(-50%);`;
    case 'right':  return `top: 50%; right: 8px; transform: translateY(-50%);`;
    case 'bottom':
    default:       return `bottom: ${bV}; left: 50%; transform: translateX(-50%);`;
  }
}

export function emitRespinChargeCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* respinCharge — Wave H18 */
  .respin-charge {
    position: fixed;
    ${_posStyle(cfg.position)}
    z-index: ${cfg.zIndex};
    padding: 4px 10px 6px;
    border-radius: 12px;
    background: ${cfg.bgColor};
    color: ${cfg.fgColor};
    font-size: ${cfg.fontSizePx}px;
    font-weight: 800;
    letter-spacing: 0.06em;
    pointer-events: none;
    min-width: 160px;
    text-align: center;
  }
  .respin-charge .rc-label { display: block; margin-bottom: 3px; }
  .respin-charge .rc-track {
    height: 8px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }
  .respin-charge .rc-fill {
    height: 100%;
    width: 0%;
    background: ${cfg.fillColor};
    border-radius: 999px;
    transition: width ${cfg.flashMs}ms ease-out, background ${cfg.flashMs}ms ease-out;
  }
  .respin-charge[data-full="true"] .rc-fill { background: ${cfg.fullColor}; }
  @media (prefers-reduced-motion: reduce) {
    .respin-charge .rc-fill { transition: none; }
  }
  `;
}

export function emitRespinChargeMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const label = String(cfg.labelTemplate).replace('{N}', '0').replace('{M}', String(cfg.capacity));
  return `<div id="respinCharge" class="respin-charge" role="progressbar" aria-valuemin="0" aria-valuemax="${cfg.capacity}" aria-valuenow="0" aria-label="Respin charge meter" data-full="false" data-value="0">
    <span class="rc-label">${label}</span>
    <span class="rc-track"><span class="rc-fill"></span></span>
  </div>`;
}

export function emitRespinChargeRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── respinCharge BLOCK — Wave H18 ────────────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var CAP = ${cfg.capacity};
    var TRIG = ${JSON.stringify(cfg.trigger)};
    var AUTO_RESPIN = ${JSON.stringify(cfg.autoRespin)};
    var RESET_ON_TRIG = ${JSON.stringify(cfg.resetOnTrigger)};
    var TEMPLATE = ${JSON.stringify(cfg.labelTemplate)};

    var charges = 0;
    var host = (typeof document !== 'undefined') ? document.getElementById('respinCharge') : null;
    var labelEl = host ? host.querySelector('.rc-label') : null;
    var fillEl  = host ? host.querySelector('.rc-fill')  : null;

    function render() {
      var v = Math.max(0, Math.min(CAP, charges | 0));
      var full = v >= CAP;
      if (labelEl) labelEl.textContent = TEMPLATE.replace('{N}', String(v)).replace('{M}', String(CAP));
      if (fillEl)  fillEl.style.width = ((v / CAP) * 100).toFixed(2) + '%';
      if (host) {
        host.setAttribute('data-value', String(v));
        host.setAttribute('data-full', full ? 'true' : 'false');
        host.setAttribute('aria-valuenow', String(v));
      }
    }
    function bump(delta, source) {
      var from = charges | 0;
      var to = Math.min(CAP, from + (delta | 0));
      if (to === from) return;
      charges = to;
      try { window.HookBus.emit('onRespinChargeBump', { from: from, to: to, max: CAP, source: source || 'auto' }); } catch (_) {}
      render();
      if (to >= CAP && AUTO_RESPIN) {
        try { window.HookBus.emit('onRespinChargeFull', { capacity: CAP, source: source || 'auto' }); } catch (_) {}
        if (RESET_ON_TRIG) setTimeout(function () { reset('autoReset'); }, ${cfg.flashMs} + 240);
      }
    }
    function reset(reason) {
      charges = 0;
      try { window.HookBus.emit('onRespinChargeReset', { reason: reason || 'manual' }); } catch (_) {}
      render();
    }

    window.HookBus.on('onSpinResult', function (p) {
      if (TRIG === 'spin') return bump(1, 'spin');
      if (TRIG === 'loss' || TRIG === 'noWin') {
        var win = p ? Number(p.award || p.win || 0) : 0;
        if (win <= 0) bump(1, TRIG);
      }
    });
    window.HookBus.on('onTumbleStep', function () {
      if (TRIG === 'tumbleEnd') bump(1, 'tumbleEnd');
    });
    window.HookBus.on('onRespinChargeTick', function (p) {
      if (TRIG === 'custom') bump((p && p.delta) | 0 || 1, 'custom');
    });
    window.HookBus.on('onFsEnd', function () { reset('fsEnd'); });

    window.respinChargeBump  = function (n) { bump(n | 0 || 1, 'api'); };
    window.respinChargeReset = function () { reset('api'); };
    /* Engine-facing announce helper for custom-trigger mode — emits
     * onRespinChargeTick so this block is the sole canonical owner. */
    window.respinChargeAnnounceTick = function (delta) {
      try { window.HookBus.emit('onRespinChargeTick', { delta: delta | 0 || 1 }); } catch (_) {}
    };

    render();
  })();
  `;
}
