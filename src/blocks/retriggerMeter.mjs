/**
 * src/blocks/retriggerMeter.mjs
 *
 * Wave H20 — Retrigger Meter (FS retrigger visual progress meter).
 *
 * Industry baseline (vendor-neutral):
 *   Modern free-spins rounds commonly grant additional spins when scatter
 *   symbols re-land inside the FS round. The "retrigger meter" is the HUD
 *   surface that shows the player the running tally — typically a bar that
 *   fills as scatters land plus a "+N FS" pop animation each time the
 *   threshold (e.g. 3 scatters) is crossed and N FS are added.
 *
 *   This block is a PURE PRESENTER. It LISTENS to onFsRetrigger (owned by
 *   superchargedFs.mjs in this template) for the canonical retrigger event,
 *   and to onFsSpinResult for incremental scatter-landed counting. It does
 *   NOT emit onFsRetrigger (single-owner emit rule). Its own emits are
 *   suffixed `Meter` to disambiguate.
 *
 *   Math (which scatter count grants which FS award) is OUT OF SCOPE — the
 *   block reads scatterPerSpin payload + cfg.scatterPerRetrigger threshold
 *   to draw the bar, and reads payload.addedCount on onFsRetrigger to drive
 *   the +N FS pop animation.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitRetriggerMeterCSS(cfg)
 *   emitRetriggerMeterMarkup(cfg)
 *   emitRetriggerMeterRuntime(cfg)
 *
 * Lifecycle:
 *   subscribes:
 *     onFsTrigger     - reset baseline, mount HUD.
 *     onFsSpinResult  - count scatter cells in payload.cells (or via grid
 *                       scan fallback); update bar fill ratio.
 *     onFsRetrigger   - read payload.addedCount, animate +N FS pop, emit
 *                       onRetriggerMeterCommit with newTotalFs.
 *     onFsEnd         - hide HUD, emit onRetriggerMeterReset.
 *   emits:
 *     onRetriggerMeterTick   { scattersThisSpin, scattersTotal, threshold, ratio, source }
 *     onRetriggerMeterCommit { addedCount, newTotalFs, scattersTotal, source }
 *     onRetriggerMeterReset  { reason, finalTotal, source }
 *
 * a11y:
 *   - HUD: role="progressbar", aria-valuenow, aria-valuemin, aria-valuemax,
 *     aria-label="Retrigger progress".
 *   - +N FS pop: aria-live="polite" announcement on update.
 *   - prefers-reduced-motion gate kills bar fill transition + pop animation.
 *
 * Performance budget:
 *   - 2 fixed DOM nodes (bar + pop badge), mounted once on FS trigger.
 *   - O(rows*cols) grid scan only when payload.cells missing.
 *   - Animation budget ≤ 600ms per pop; reduced-motion → instant snap.
 *
 * GDD keys (model.retriggerMeter):
 *   enabled, scatterSymbol, scatterPerRetrigger, fsPerRetrigger, position,
 *   barBg, barFill, popBg, popColor, fontSizePx, zIndex, popMs
 *
 * Vendor-neutral. No game / studio strings.
 *
 * @module retriggerMeter
 */

const POSITIONS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
const BOUNDS = Object.freeze({
  scatterPerRetrigger: [1, 12],
  fsPerRetrigger:      [1, 100],
  fontSizePx:          [11, 24],
  zIndex:              [10, 99],
  popMs:               [120, 2000],
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
    enabled:              false,
    scatterSymbol:        'S',
    scatterPerRetrigger:  3,
    fsPerRetrigger:       5,
    position:             'top-left',
    barBg:                'rgba(0,0,0,0.5)',
    barFill:              '#ffd84d',
    popBg:                '#ffd84d',
    popColor:             '#03110a',
    fontSizePx:           12,
    popMs:                540,
    zIndex:               42,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.retriggerMeter) || {};
  const auto = !!model.retriggerMeter;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.scatterPerRetrigger = _clamp(m.scatterPerRetrigger, BOUNDS.scatterPerRetrigger, cfg.scatterPerRetrigger);
  cfg.fsPerRetrigger      = _clamp(m.fsPerRetrigger,      BOUNDS.fsPerRetrigger,      cfg.fsPerRetrigger);
  cfg.fontSizePx          = _clamp(m.fontSizePx,          BOUNDS.fontSizePx,          cfg.fontSizePx);
  cfg.zIndex              = _clamp(m.zIndex,              BOUNDS.zIndex,              cfg.zIndex);
  cfg.popMs               = _clamp(m.popMs,               BOUNDS.popMs,               cfg.popMs);

  if (typeof m.position === 'string' && POSITIONS.has(m.position)) cfg.position = m.position;
  cfg.scatterSymbol = _safe(m.scatterSymbol, 12, cfg.scatterSymbol);
  cfg.barBg         = _safe(m.barBg,         64, cfg.barBg);
  cfg.barFill       = _safe(m.barFill,       48, cfg.barFill);
  cfg.popBg         = _safe(m.popBg,         48, cfg.popBg);
  cfg.popColor      = _safe(m.popColor,      32, cfg.popColor);
  return cfg;
}

function _posStyle(pos) {
  const v  = 'calc(max(8px, env(safe-area-inset-top, 0px) + 8px))';
  const bV = 'calc(max(8px, env(safe-area-inset-bottom, 0px) + 8px))';
  const h  = 'calc(max(8px, env(safe-area-inset-left, 0px) + 8px))';
  const rH = 'calc(max(8px, env(safe-area-inset-right, 0px) + 8px))';
  switch (pos) {
    case 'top-right':    return `top: ${v}; right: ${rH};`;
    case 'bottom-left':  return `bottom: ${bV}; left: ${h};`;
    case 'bottom-right': return `bottom: ${bV}; right: ${rH};`;
    case 'top-left':
    default:             return `top: ${v}; left: ${h};`;
  }
}

export function emitRetriggerMeterCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* retriggerMeter — Wave H20 */
  .rtmeter {
    position: fixed;
    ${_posStyle(cfg.position)}
    z-index: ${cfg.zIndex};
    width: 156px;
    padding: 6px 10px;
    border-radius: 10px;
    background: ${cfg.barBg};
    color: #fff;
    font-size: ${cfg.fontSizePx}px;
    font-weight: 700;
    letter-spacing: 0.05em;
    border: 1px solid rgba(255, 255, 255, 0.16);
    display: none;
    pointer-events: none;
  }
  .rtmeter[data-visible="true"] { display: block; }
  .rtmeter-row { display: flex; align-items: center; gap: 6px; }
  .rtmeter-label { opacity: 0.85; }
  .rtmeter-bar {
    margin-top: 4px;
    height: 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.18);
    overflow: hidden;
  }
  .rtmeter-fill {
    height: 100%;
    width: 0%;
    background: ${cfg.barFill};
    transition: width 320ms ease-out;
  }
  .rtmeter-pop {
    position: fixed;
    ${_posStyle(cfg.position)}
    margin-top: 36px;
    z-index: ${cfg.zIndex + 1};
    padding: 5px 12px;
    border-radius: 999px;
    background: ${cfg.popBg};
    color: ${cfg.popColor};
    font-size: ${cfg.fontSizePx + 1}px;
    font-weight: 800;
    display: none;
    pointer-events: none;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
  }
  .rtmeter-pop[data-popping="true"] {
    display: inline-block;
    animation: rtmeter-pop ${cfg.popMs}ms ease-out;
  }
  @keyframes rtmeter-pop {
    0%   { transform: translateY(8px) scale(0.6); opacity: 0.0; }
    30%  { transform: translateY(0)    scale(1.18); opacity: 1.0; }
    100% { transform: translateY(-12px) scale(1.0); opacity: 0.0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .rtmeter-fill { transition: none; }
    .rtmeter-pop[data-popping="true"] { animation: none; }
  }
  `;
}

export function emitRetriggerMeterMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  <div id="rtMeter" class="rtmeter" role="progressbar" aria-label="Retrigger progress" aria-valuemin="0" aria-valuemax="${cfg.scatterPerRetrigger}" aria-valuenow="0" data-visible="false">
    <div class="rtmeter-row"><span class="rtmeter-label">RETRIGGER</span><span id="rtMeterCount">0/${cfg.scatterPerRetrigger}</span></div>
    <div class="rtmeter-bar"><div id="rtMeterFill" class="rtmeter-fill"></div></div>
  </div>
  <div id="rtMeterPop" class="rtmeter-pop" role="status" aria-live="polite" data-popping="false">+${cfg.fsPerRetrigger} FS</div>`;
}

export function emitRetriggerMeterRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── retriggerMeter BLOCK — Wave H20 ──────────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var SYM = ${JSON.stringify(cfg.scatterSymbol)};
    var PER_RET = ${cfg.scatterPerRetrigger};
    var FS_PER = ${cfg.fsPerRetrigger};
    var POP_MS = ${cfg.popMs};
    var inFs = false;
    var scattersTotal = 0;
    var lastNewTotalFs = 0;
    var meter = (typeof document !== 'undefined') ? document.getElementById('rtMeter') : null;
    var count = (typeof document !== 'undefined') ? document.getElementById('rtMeterCount') : null;
    var fill  = (typeof document !== 'undefined') ? document.getElementById('rtMeterFill') : null;
    var pop   = (typeof document !== 'undefined') ? document.getElementById('rtMeterPop') : null;

    function scanScatters() {
      if (typeof document === 'undefined' || !document.querySelectorAll) return 0;
      var cells = document.querySelectorAll('.symbol-cell');
      var n = 0;
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i];
        var s = c.getAttribute && (c.getAttribute('data-sym') || c.getAttribute('data-symbol') || '');
        if (s === SYM) n++;
      }
      return n;
    }
    function readScattersFromPayload(p) {
      if (!p) return scanScatters();
      if (typeof p.scattersThisSpin === 'number') return p.scattersThisSpin;
      if (Array.isArray(p.cells)) {
        var n = 0;
        for (var i = 0; i < p.cells.length; i++) if (p.cells[i] && p.cells[i].sym === SYM) n++;
        return n;
      }
      return scanScatters();
    }
    function render(addedCount) {
      if (!meter) return;
      var step = scattersTotal % PER_RET;
      var ratio = Math.min(1, step / PER_RET);
      if (count) count.textContent = step + '/' + PER_RET;
      if (fill)  fill.setAttribute && fill.setAttribute('style', 'width:' + Math.round(ratio * 100) + '%');
      meter.setAttribute('aria-valuenow', String(step));
      meter.setAttribute('data-visible', 'true');
      if (addedCount && pop) {
        pop.textContent = '+' + addedCount + ' FS';
        pop.setAttribute('data-popping', 'true');
        setTimeout(function () { pop && pop.setAttribute('data-popping', 'false'); }, POP_MS + 40);
      }
    }
    function hide(reason) {
      if (meter) meter.setAttribute('data-visible', 'false');
      try { window.HookBus.emit('onRetriggerMeterReset', { reason: reason || 'auto', finalTotal: scattersTotal, source: 'auto' }); } catch (_) {}
      scattersTotal = 0;
      lastNewTotalFs = 0;
    }

    /* F3 priority 30 — decorator class. FS retrigger HUD meter listens to
       FS lifecycle; sibling decorator order not race-critical. */
    window.HookBus.on('onFsTrigger', function () {
      inFs = true;
      scattersTotal = 0;
      lastNewTotalFs = 0;
      render(0);
    }, { priority: 30 });
    window.HookBus.on('onFsSpinResult', function (p) {
      if (!inFs) return;
      var add = readScattersFromPayload(p);
      if (add > 0) {
        scattersTotal += add;
        var step = scattersTotal % PER_RET;
        var ratio = Math.min(1, step / PER_RET);
        render(0);
        try { window.HookBus.emit('onRetriggerMeterTick', { scattersThisSpin: add, scattersTotal: scattersTotal, threshold: PER_RET, ratio: ratio, source: 'onFsSpinResult' }); } catch (_) {}
      }
    }, { priority: 30 });
    window.HookBus.on('onFsRetrigger', function (p) {
      if (!inFs) return;
      var added = (p && Number(p.addedCount)) || FS_PER;
      var newTotal = (p && Number(p.newTotalFs));
      if (!Number.isFinite(newTotal)) newTotal = lastNewTotalFs + added;
      lastNewTotalFs = newTotal;
      render(added);
      try { window.HookBus.emit('onRetriggerMeterCommit', { addedCount: added, newTotalFs: newTotal, scattersTotal: scattersTotal, source: 'onFsRetrigger' }); } catch (_) {}
    }, { priority: 30 });
    window.HookBus.on('onFsEnd', function () {
      inFs = false;
      hide('onFsEnd');
    }, { priority: 30 });

    /* Public API for engine + force probes. */
    window.retriggerMeterTick = function (count) {
      var n = Number(count) | 0;
      if (n <= 0) return;
      scattersTotal += n;
      render(0);
      try { window.HookBus.emit('onRetriggerMeterTick', { scattersThisSpin: n, scattersTotal: scattersTotal, threshold: PER_RET, ratio: (scattersTotal % PER_RET) / PER_RET, source: 'api' }); } catch (_) {}
    };
    window.retriggerMeterCommit = function (addedCount, newTotalFs) {
      var a = Number(addedCount) | 0;
      var t = Number(newTotalFs) | 0;
      if (a <= 0) return;
      lastNewTotalFs = t || lastNewTotalFs + a;
      render(a);
      try { window.HookBus.emit('onRetriggerMeterCommit', { addedCount: a, newTotalFs: lastNewTotalFs, scattersTotal: scattersTotal, source: 'api' }); } catch (_) {}
    };
    window.retriggerMeterReset = function () { hide('api'); };
    window.retriggerMeterGet   = function () { return { inFs: inFs, scattersTotal: scattersTotal, threshold: PER_RET, newTotalFs: lastNewTotalFs }; };
  })();
  `;
}
